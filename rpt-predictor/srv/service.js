const cds = require('@sap/cds');
const { getDestination } = require('@sap-cloud-sdk/connectivity');
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
    process.env.RPT_RESOURCE_GROUP || 'GroundingMgmt-Kleprlik';
const MODEL_NAME =
    process.env.RPT_MODEL_NAME || 'SAP RPT 1.5 Large';
const PREDICT_ENDPOINT =
    process.env.RPT_PREDICT_ENDPOINT || '/predict';

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
        const runtimeBindings = getRuntimeBindingDiagnostics();

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
                availability: 'not tested',
                runtimeBindings
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
                destinationLookup: true,
                mockRequest: true,
                liveDestinationTest: true,
                csvProfiling: true,
                liveCsvPrediction: true,
                csvDownload: true
            },
            sampleRequest: SAMPLE_REQUEST
        });
    });

    this.on('checkDestination', async () => {
        const startedAt = Date.now();
        const runtimeBindings = getRuntimeBindingDiagnostics();

        try {
            const destination = await getDestination({
                destinationName: DESTINATION_NAME,
                useCache: false
            });

            if (!destination) {
                return asJson({
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    durationMs: Date.now() - startedAt,
                    destinationName: DESTINATION_NAME,
                    runtimeBindings,
                    error: {
                        message: `Destination „${DESTINATION_NAME}“ nebyla nalezena.`
                    }
                });
            }

            return asJson({
                ok: true,
                checkedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                destination: sanitizeDestination(destination),
                runtimeBindings
            });
        } catch (error) {
            console.error('Destination lookup failed', formatErrorForLog(error));

            return asJson({
                ok: false,
                checkedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                destinationName: DESTINATION_NAME,
                runtimeBindings,
                error: formatErrorForLog(error)
            });
        }
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
            const predictionPlaceholder =
                String(req.data.predictionPlaceholder || '[PREDICT]');
            const profile = buildCsvProfile(
                parsed.rows,
                parsed.delimiter,
                predictionPlaceholder
            );
            const indexColumn = req.data.indexColumn || profile.suggestedIndexColumn;
            const useMock = req.data.useMock !== false;

            if (!indexColumn || !profile.columns.includes(indexColumn)) {
                return req.reject(400, 'Vybraný indexový sloupec v CSV neexistuje.');
            }

            const payloadInfo = prepareRptPayload(parsed.rows, {
                indexColumn,
                predictionPlaceholder
            });

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
                        targets: payloadInfo.targets,
                        predictionPlaceholder
                    },
                    profile,
                    rowSelection: payloadInfo.rowSelection,
                    predictions: createMockPredictions(
                        parsed.rows,
                        indexColumn,
                        payloadInfo.targets,
                        predictionPlaceholder
                    ),
                    httpStatus: 200,
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - startedAt,
                    note: 'Výsledky jsou simulované a nebyly vytvořeny modelem.'
                });
            }

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
                    targets: payloadInfo.targets,
                    predictionPlaceholder
                },
                profile,
                rowSelection: payloadInfo.rowSelection,
                request: buildRequestLog(payloadInfo.payload),
                response: response.data,
                httpStatus: response.status,
                completedAt: new Date().toISOString(),
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

function formatErrorForLog(error) {
    return {
        name: error.name || 'Error',
        message: error.message || 'Unknown error',
        httpStatus: error.response?.status || null,
        response: error.response?.data || null,
        causeChain: getErrorCauseChain(error),
        destination: DESTINATION_NAME,
        endpoint: PREDICT_ENDPOINT
    };
}

function getRuntimeBindingDiagnostics() {
    const result = {
        vcapServicesPresent: Boolean(process.env.VCAP_SERVICES),
        serviceBindingRootPresent: Boolean(process.env.SERVICE_BINDING_ROOT),
        localDestinationsPresent: Boolean(process.env.destinations),
        serviceLabels: [],
        destinationBindingDetected: false,
        cdsEnvironment: process.env.CDS_ENV || 'default'
    };

    if (process.env.VCAP_SERVICES) {
        try {
            const services = JSON.parse(process.env.VCAP_SERVICES);
            result.serviceLabels = Object.keys(services);
            result.destinationBindingDetected = result.serviceLabels.some(
                (label) => /destination/i.test(label)
            );
        } catch (_error) {
            result.vcapServicesValidJson = false;
        }
    }

    if (result.localDestinationsPresent) {
        result.destinationBindingDetected = true;
    }

    return result;
}

function sanitizeDestination(destination) {
    return {
        name: destination.name || DESTINATION_NAME,
        url: sanitizeUrl(destination.url),
        authentication: destination.authentication || null,
        proxyType: destination.proxyType || null,
        forwardAuthToken: Boolean(destination.forwardAuthToken)
    };
}

function sanitizeUrl(value) {
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    } catch (_error) {
        return '<configured URL>';
    }
}

function getErrorCauseChain(error) {
    const messages = [];
    let current = error;

    while (current && messages.length < 5) {
        const message = current.message || String(current);
        if (!messages.includes(message)) {
            messages.push(message);
        }
        current = current.cause;
    }

    return messages;
}

function asJson(value) {
    return JSON.stringify(value);
}
