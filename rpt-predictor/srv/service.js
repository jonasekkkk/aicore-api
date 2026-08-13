const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const {
    buildCsvProfile,
    createMockPredictions,
    parseCsvBuffer,
    prepareRptPayload,
    toBuffer
} = require('./csv-utils');

const DESTINATION_NAME =
    process.env.RPT_DESTINATION_NAME || 'RPT_Destination';
const DEPLOYMENT_ID =
    process.env.RPT_DEPLOYMENT_ID || 'da7b7f89b9428ee7';
const RESOURCE_GROUP =
    process.env.RPT_RESOURCE_GROUP || 'default';
const MODEL_NAME =
    process.env.RPT_MODEL_NAME || 'SAP RPT 1.5 Large';
const PREDICT_ENDPOINT =
    `/v2/inference/deployments/${DEPLOYMENT_ID}/predict`;

const SAMPLE_REQUEST = Object.freeze({
    prediction_config: {
        target_columns: [
            {
                name: 'target_value',
                task_type: 'regression',
                prediction_placeholder: '[PREDICT]'
            }
        ]
    },
    index_column: 'sample_id',
    rows: [
        { sample_id: 'CTX-001', category: 'A', amount: 10, target_value: 12 },
        { sample_id: 'CTX-002', category: 'B', amount: 20, target_value: 24 },
        { sample_id: 'CTX-003', category: 'A', amount: 15, target_value: 18 },
        { sample_id: 'QUERY-001', category: 'B', amount: 12, target_value: '[PREDICT]' }
    ]
});

module.exports = cds.service.impl(function () {
    this.on('getDiagnostics', async () => {
        return asJson({
            ok: true,
            mode: 'diagnostics',
            checkedAt: new Date().toISOString(),
            service: {
                name: 'PredictorService',
                endpoint: '/odata/v4/predictor',
                nodeVersion: process.version,
                cdsVersion: cds.version
            },
            destination: {
                name: DESTINATION_NAME,
                source: process.env.RPT_DESTINATION_NAME
                    ? 'environment'
                    : 'application default',
                availability: 'not tested'
            },
            deployment: {
                id: DEPLOYMENT_ID,
                model: MODEL_NAME,
                resourceGroup: RESOURCE_GROUP,
                endpoint: PREDICT_ENDPOINT,
                availability: 'not tested'
            },
            capabilities: {
                capHealth: true,
                mockRequest: true,
                liveDestinationTest: true,
                csvProfiling: true,
                liveCsvPrediction: true,
                csvDownload: false
            },
            sampleRequest: SAMPLE_REQUEST
        });
    });

    this.on('pingModel', async (req) => {
        const startedAt = Date.now();
        const useMock = req.data.useMock !== false;

        if (useMock) {
            return asJson({
                ok: true,
                mode: 'mock',
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                request: buildRequestLog(SAMPLE_REQUEST),
                response: {
                    id: 'mock-request-001',
                    metadata: {
                        numColumns: 4,
                        numRows: 4,
                        numQueryRows: 1,
                        numPredictions: 1
                    },
                    predictions: [
                        {
                            sample_id: 'QUERY-001',
                            target_value: [
                                {
                                    prediction: 14.6,
                                    confidence: null,
                                    confidence_interval: [12.1, 17.3]
                                }
                            ]
                        }
                    ],
                    status: { code: 0, message: 'mock ok' }
                }
            });
        }

        try {
            const response = await callRptModel(SAMPLE_REQUEST);

            return asJson({
                ok: true,
                mode: 'live',
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                httpStatus: response.status,
                request: buildRequestLog(SAMPLE_REQUEST),
                response: response.data
            });
        } catch (error) {
            console.error('RPT destination test failed', formatErrorForLog(error));

            return asJson({
                ok: false,
                mode: 'live',
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                request: buildRequestLog(SAMPLE_REQUEST),
                error: formatErrorForLog(error)
            });
        }
    });

    this.on('predictMissingData', async (req) => {
        const startedAt = Date.now();

        try {
            const fileBuffer = toBuffer(req.data.file);

            if (!fileBuffer.length) {
                return req.reject(400, 'Nebyl nahrán žádný CSV soubor.');
            }

            if (fileBuffer.length > 10 * 1024 * 1024) {
                return req.reject(413, 'CSV soubor překračuje limit 10 MB.');
            }

            const parsed = await parseCsvBuffer(
                fileBuffer,
                req.data.delimiter
            );
            const profile = buildCsvProfile(parsed.rows, parsed.delimiter);
            const indexColumn = req.data.indexColumn || profile.suggestedIndexColumn;
            const targetColumn = req.data.targetColumn || profile.suggestedTargetColumn;
            const taskType = normalizeTaskType(req.data.taskType);
            const predictionPlaceholder =
                String(req.data.predictionPlaceholder || '[PREDICT]');
            const useMock = req.data.useMock !== false;

            if (!indexColumn || !profile.columns.includes(indexColumn)) {
                return req.reject(400, 'Vybraný indexový sloupec v CSV neexistuje.');
            }

            if (!targetColumn || !profile.columns.includes(targetColumn)) {
                return req.reject(400, 'Vybraný cílový sloupec v CSV neexistuje.');
            }

            if (useMock) {
                return asJson({
                    ok: true,
                    mode: 'mock',
                    file: {
                        name: req.data.fileName || 'uploaded.csv',
                        sizeBytes: fileBuffer.length,
                        delimiter: parsed.delimiter
                    },
                    config: {
                        indexColumn,
                        targetColumn,
                        taskType,
                        predictionPlaceholder
                    },
                    profile,
                    predictions: createMockPredictions(
                        parsed.rows,
                        indexColumn,
                        targetColumn,
                        taskType
                    ),
                    durationMs: Date.now() - startedAt,
                    note: 'Výsledky jsou simulované a nebyly vytvořeny modelem.'
                });
            }

            const payloadInfo = prepareRptPayload(parsed.rows, {
                indexColumn,
                targetColumn,
                taskType,
                predictionPlaceholder
            });

            const response = await callRptModel(payloadInfo.payload);

            return asJson({
                ok: true,
                mode: 'live',
                file: {
                    name: req.data.fileName || 'uploaded.csv',
                    sizeBytes: fileBuffer.length,
                    delimiter: parsed.delimiter
                },
                config: {
                    indexColumn,
                    targetColumn,
                    taskType,
                    predictionPlaceholder
                },
                profile,
                rowSelection: payloadInfo.rowSelection,
                request: buildRequestLog(payloadInfo.payload),
                response: response.data,
                httpStatus: response.status,
                durationMs: Date.now() - startedAt
            });
        } catch (error) {
            console.error('CSV prediction failed', formatErrorForLog(error));

            if (error.statusCode) {
                return req.reject(error.statusCode, error.message);
            }

            return req.reject(
                500,
                `CSV analýza nebo volání RPT selhalo: ${error.message}`
            );
        }
    });
});

async function callRptModel(data) {
    return executeHttpRequest(
        { destinationName: DESTINATION_NAME },
        {
            method: 'POST',
            url: PREDICT_ENDPOINT,
            headers: {
                'AI-Resource-Group': RESOURCE_GROUP,
                'Content-Type': 'application/json'
            },
            data,
            timeout: 120000
        }
    );
}

function buildRequestLog(data) {
    return {
        destinationName: DESTINATION_NAME,
        deploymentId: DEPLOYMENT_ID,
        resourceGroup: RESOURCE_GROUP,
        method: 'POST',
        url: PREDICT_ENDPOINT,
        body: data
    };
}

function normalizeTaskType(value) {
    return value === 'classification' ? 'classification' : 'regression';
}

function formatErrorForLog(error) {
    return {
        name: error.name || 'Error',
        message: error.message || 'Unknown error',
        httpStatus: error.response?.status || null,
        response: error.response?.data || null,
        destination: DESTINATION_NAME,
        endpoint: PREDICT_ENDPOINT
    };
}

function asJson(value) {
    return JSON.stringify(value);
}
