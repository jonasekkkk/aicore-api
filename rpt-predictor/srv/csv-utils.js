const csv = require('csv-parser');
const { Readable } = require('stream');

const MAX_ROWS = 66000;
const MAX_PREVIEW_ROWS = 5;
const MAX_QUERY_ROWS = 128;
const MAX_CONTEXT_ROWS = 8000;

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

function buildCsvProfile(rows, delimiter) {
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

    return {
        rowCount: rows.length,
        columnCount: columns.length,
        columns,
        delimiter: displayDelimiter(delimiter),
        missingCellCount: Object.values(missingByColumn)
            .reduce((total, count) => total + count, 0),
        missingByColumn,
        numericColumns,
        suggestedIndexColumn: suggestIndexColumn(columns),
        suggestedTargetColumn: suggestTargetColumn(columns, numericColumns),
        previewRows: rows.slice(0, MAX_PREVIEW_ROWS)
    };
}

function prepareRptPayload(rows, options) {
    const placeholder = options.predictionPlaceholder;
    const targetColumn = options.targetColumn;
    const contextRows = [];
    const queryRows = [];

    rows.forEach((row) => {
        const targetValue = String(row[targetColumn] ?? '').trim();
        if (!targetValue || targetValue === placeholder) {
            queryRows.push({ ...row, [targetColumn]: placeholder });
        } else {
            contextRows.push(row);
        }
    });

    if (!queryRows.length) {
        const error = new Error(
            `V cílovém sloupci „${targetColumn}“ není prázdná hodnota ani ${placeholder}.`
        );
        error.statusCode = 400;
        throw error;
    }

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
                target_columns: [
                    {
                        name: targetColumn,
                        task_type: options.taskType,
                        prediction_placeholder: placeholder
                    }
                ]
            },
            index_column: options.indexColumn,
            rows: selectedContextRows.concat(queryRows)
        },
        rowSelection: {
            availableContextRows: contextRows.length,
            selectedContextRows: selectedContextRows.length,
            queryRows: queryRows.length
        }
    };
}

function createMockPredictions(rows, indexColumn, targetColumn, taskType) {
    return rows.slice(0, 5).map((row, index) => {
        const currentValue = row[targetColumn];
        const numericValue = Number(String(currentValue ?? '').replace(',', '.'));
        const prediction = taskType === 'classification'
            ? ['Low', 'Medium', 'High'][index % 3]
            : Number.isFinite(numericValue)
                ? Number((numericValue * (0.97 + index * 0.01)).toFixed(2))
                : Number((10 + index * 2.4).toFixed(2));

        return {
            [indexColumn]: row[indexColumn] || `MOCK-${index + 1}`,
            [targetColumn]: [
                {
                    prediction,
                    confidence: taskType === 'classification'
                        ? Number((0.92 - index * 0.05).toFixed(2))
                        : null,
                    confidence_interval: taskType === 'regression'
                        ? [
                            Number((Number(prediction) * 0.9).toFixed(2)),
                            Number((Number(prediction) * 1.1).toFixed(2))
                        ]
                        : null
                }
            ]
        };
    });
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
    detectDelimiter,
    parseCsvBuffer,
    prepareRptPayload,
    toBuffer
};
