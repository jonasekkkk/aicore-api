const csv = require('csv-parser');
const { Readable } = require('stream');

const MAX_ROWS = 66000;
const MAX_PREVIEW_ROWS = 5;
const MAX_QUERY_ROWS = 512;
const MAX_CONTEXT_ROWS = 8000;
const MAX_TARGET_COLUMNS = 10;

function toBuffer(value) {
    if (!value) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(value)) {
        return value;
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }

    const rawValue = String(value);
    const base64 = rawValue.includes(',')
        ? rawValue.slice(rawValue.indexOf(',') + 1)
        : rawValue;

    return Buffer.from(base64, 'base64');
}

function detectDelimiter(text) {
    const firstLine = String(text || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .find((line) => line.trim()) || '';
    const candidates = [',', ';', '\t', '|'];
    let best = ',';
    let bestCount = -1;

    candidates.forEach((candidate) => {
        let count = 0;
        let quoted = false;

        for (let index = 0; index < firstLine.length; index += 1) {
            const character = firstLine[index];

            if (character === '"') {
                quoted = !quoted;
            } else if (!quoted && character === candidate) {
                count += 1;
            }
        }

        if (count > bestCount) {
            best = candidate;
            bestCount = count;
        }
    });

    return best;
}

function parseCsvBuffer(buffer, requestedDelimiter) {
    const delimiter = normalizeDelimiter(
        requestedDelimiter || detectDelimiter(buffer.toString('utf8', 0, 8192))
    );
    const rows = [];

    return new Promise((resolve, reject) => {
        let settled = false;
        const parser = csv({
            separator: delimiter,
            mapHeaders: ({ header }) => String(header || '').replace(/^\uFEFF/, '').trim()
        });

        parser.on('data', (row) => {
            if (settled) {
                return;
            }

            if (rows.length >= MAX_ROWS) {
                settled = true;
                const error = new Error(`CSV překračuje limit ${MAX_ROWS} řádků.`);
                error.statusCode = 413;
                parser.destroy(error);
                reject(error);
                return;
            }

            rows.push(row);
        });

        parser.on('end', () => {
            if (settled) {
                return;
            }

            settled = true;
            if (!rows.length) {
                const error = new Error('CSV neobsahuje žádné datové řádky.');
                error.statusCode = 400;
                reject(error);
                return;
            }

            resolve({ delimiter, rows });
        });

        parser.on('error', (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });

        Readable.from([buffer]).pipe(parser);
    });
}

function buildCsvProfile(rows, delimiter, predictionPlaceholder = '[PREDICT]') {
    const columns = Object.keys(rows[0] || {});
    const missingByColumn = {};
    const numericColumns = [];

    columns.forEach((column) => {
        let missing = 0;
        let numeric = 0;
        let populated = 0;

        rows.forEach((row) => {
            const value = String(row[column] ?? '').trim();

            if (!value) {
                missing += 1;
                return;
            }

            populated += 1;
            if (Number.isFinite(Number(value.replace(',', '.')))) {
                numeric += 1;
            }
        });

        missingByColumn[column] = missing;
        if (populated > 0 && numeric / populated >= 0.8) {
            numericColumns.push(column);
        }
    });

    const predictionTargets = detectPredictionTargets(
        rows,
        predictionPlaceholder
    );

    return {
        rowCount: rows.length,
        columnCount: columns.length,
        columns,
        delimiter: displayDelimiter(delimiter),
        missingCellCount: Object.values(missingByColumn)
            .reduce((total, count) => total + count, 0),
        missingByColumn,
        numericColumns,
        predictionTargets,
        predictionCellCount: predictionTargets.reduce(
            (total, target) => total + target.predictionCellCount,
            0
        ),
        predictionRowCount: rows.filter((row) => predictionTargets.some(
            (target) => isPredictionValue(
                row[target.name],
                predictionPlaceholder
            )
        )).length,
        suggestedIndexColumn: suggestIndexColumn(columns),
        suggestedTargetColumn: suggestTargetColumn(columns, numericColumns),
        previewRows: rows.slice(0, MAX_PREVIEW_ROWS)
    };
}

function prepareRptPayload(rows, options) {
    const placeholder = String(options.predictionPlaceholder || '[PREDICT]');
    const targets = detectPredictionTargets(rows, placeholder);
    const contextRows = [];
    const queryRows = [];

    if (!targets.length) {
        const error = new Error(
            `CSV neobsahuje žádnou buňku s hodnotou ${placeholder}.`
        );
        error.statusCode = 400;
        throw error;
    }

    if (targets.length > MAX_TARGET_COLUMNS) {
        const error = new Error(
            `CSV obsahuje ${targets.length} cílových sloupců; maximum jednoho requestu je ${MAX_TARGET_COLUMNS}.`
        );
        error.statusCode = 400;
        throw error;
    }

    rows.forEach((row) => {
        const containsPrediction = targets.some((target) =>
            isPredictionValue(row[target.name], placeholder)
        );

        if (containsPrediction) {
            queryRows.push({ ...row });
        } else {
            contextRows.push(row);
        }
    });

    if (queryRows.length > MAX_QUERY_ROWS) {
        const error = new Error(
            `Soubor obsahuje ${queryRows.length} predikčních řádků; maximum jednoho requestu je ${MAX_QUERY_ROWS}.`
        );
        error.statusCode = 400;
        throw error;
    }

    const selectedContextRows = contextRows.slice(-MAX_CONTEXT_ROWS);

    return {
        payload: {
            prediction_config: {
                target_columns: targets.map((target) => ({
                    name: target.name,
                    task_type: target.taskType,
                    prediction_placeholder: placeholder
                }))
            },
            index_column: options.indexColumn,
            rows: selectedContextRows.concat(queryRows)
        },
        rowSelection: {
            availableContextRows: contextRows.length,
            selectedContextRows: selectedContextRows.length,
            queryRows: queryRows.length,
            targetColumns: targets.length,
            predictionCells: targets.reduce(
                (total, target) => total + target.predictionCellCount,
                0
            )
        },
        targets
    };
}

function createMockPredictions(
    rows,
    indexColumn,
    targets,
    predictionPlaceholder = '[PREDICT]'
) {
    const referenceValues = Object.fromEntries(targets.map((target) => [
        target.name,
        rows.map((row) => String(row[target.name] ?? '').trim())
            .filter((value) => value && value !== predictionPlaceholder)
    ]));
    const queryRows = rows.filter((row) => targets.some((target) =>
        isPredictionValue(row[target.name], predictionPlaceholder)
    ));

    return queryRows.map((row, rowIndex) => {
        const result = {
            [indexColumn]: row[indexColumn] || `MOCK-${rowIndex + 1}`
        };

        targets.forEach((target) => {
            if (!isPredictionValue(row[target.name], predictionPlaceholder)) {
                return;
            }

            const values = referenceValues[target.name];
            const prediction = createMockValue(values, target.taskType, rowIndex);
            result[target.name] = [{
                prediction,
                confidence: target.taskType === 'classification'
                    ? Number(Math.max(0.55, 0.92 - rowIndex * 0.01).toFixed(2))
                    : null,
                confidence_interval: target.taskType === 'regression'
                    ? [
                        Number((Number(prediction) * 0.9).toFixed(2)),
                        Number((Number(prediction) * 1.1).toFixed(2))
                    ]
                    : null
            }];
        });

        return result;
    });
}

function detectPredictionTargets(rows, predictionPlaceholder = '[PREDICT]') {
    const columns = Object.keys(rows[0] || {});

    return columns.map((column) => {
        const values = rows.map((row) => String(row[column] ?? '').trim());
        const predictionCellCount = values.filter(
            (value) => value === predictionPlaceholder
        ).length;
        const knownValues = values.filter(
            (value) => value && value !== predictionPlaceholder
        );

        return {
            name: column,
            taskType: inferTaskType(knownValues),
            predictionCellCount,
            knownValueCount: knownValues.length
        };
    }).filter((target) => target.predictionCellCount > 0);
}

function inferTaskType(values) {
    if (!values.length) {
        return 'classification';
    }

    const numericValues = values.filter((value) =>
        Number.isFinite(Number(String(value).replace(',', '.')))
    );
    return numericValues.length / values.length >= 0.8
        ? 'regression'
        : 'classification';
}

function isPredictionValue(value, placeholder) {
    return String(value ?? '').trim() === placeholder;
}

function createMockValue(values, taskType, rowIndex) {
    if (taskType === 'classification') {
        const distinctValues = [...new Set(values)];
        return distinctValues[rowIndex % distinctValues.length]
            || ['Low', 'Medium', 'High'][rowIndex % 3];
    }

    const numericValues = values
        .map((value) => Number(String(value).replace(',', '.')))
        .filter(Number.isFinite);
    const average = numericValues.length
        ? numericValues.reduce((total, value) => total + value, 0)
            / numericValues.length
        : 10;
    return Number((average * (1 + (rowIndex % 5 - 2) * 0.01)).toFixed(2));
}

function suggestIndexColumn(columns) {
    return columns.find((column) => /^id([_-]|$)/i.test(column))
        || columns.find((column) => /(^|[_-])(id|key|index)([_-]|$)/i.test(column))
        || columns[0]
        || '';
}

function suggestTargetColumn(columns, numericColumns) {
    const preferredPatterns = [
        /mnozstvi_prodano/i,
        /trzba/i,
        /marze/i,
        /target/i,
        /prediction/i
    ];

    for (const pattern of preferredPatterns) {
        const match = columns.find((column) => pattern.test(column));
        if (match) {
            return match;
        }
    }

    return numericColumns[numericColumns.length - 1]
        || columns[columns.length - 1]
        || '';
}

function normalizeDelimiter(value) {
    if (value === '\\t' || value === 'tab') {
        return '\t';
    }

    return [',', ';', '\t', '|'].includes(value) ? value : ',';
}

function displayDelimiter(value) {
    return value === '\t' ? 'TAB' : value;
}

module.exports = {
    buildCsvProfile,
    createMockPredictions,
    detectPredictionTargets,
    detectDelimiter,
    parseCsvBuffer,
    prepareRptPayload,
    toBuffer
};
