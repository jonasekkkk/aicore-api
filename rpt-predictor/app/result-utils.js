(function (factory) {
    if (typeof sap !== 'undefined' && sap.ui && sap.ui.define) {
        sap.ui.define([], factory);
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    }
}(function () {
    'use strict';

    function getPredictions(result) {
        if (Array.isArray(result && result.predictions)) {
            return result.predictions;
        }

        if (Array.isArray(result && result.response && result.response.predictions)) {
            return result.response.predictions;
        }

        return [];
    }

    function getModelResponse(result) {
        return result && result.response ? result.response : result || {};
    }

    function mergePredictionResults(options) {
        var rows = options.rows || [];
        var indexColumn = options.indexColumn;
        var targets = options.targets || [];
        var placeholder = options.predictionPlaceholder || '[PREDICT]';
        var predictions = options.predictions || [];
        var updatedRows = rows.map(function (row) {
            return Object.assign({}, row);
        });
        var predictionQueues = buildPredictionQueues(predictions, indexColumn);
        var resultRows = [];
        var appliedPredictionCount = 0;
        var missingPredictionCount = 0;
        var queryIndex = 0;

        updatedRows.forEach(function (row) {
            var predictedTargets = targets.filter(function (target) {
                return isPredictionValue(row[target.name], placeholder);
            });

            if (!predictedTargets.length) {
                return;
            }

            var prediction = takePrediction(
                predictionQueues,
                predictions,
                row[indexColumn],
                queryIndex
            );
            var predictedColumns = {};

            predictedTargets.forEach(function (target) {
                var predictionItem = readPredictionItem(
                    prediction && prediction[target.name]
                );

                if (!predictionItem || predictionItem.prediction === undefined) {
                    missingPredictionCount += 1;
                    predictedColumns[target.name] = {
                        applied: false,
                        tooltip: 'Model pro tuto buňku nevrátil predikci.'
                    };
                    return;
                }

                row[target.name] = predictionItem.prediction;
                appliedPredictionCount += 1;
                predictedColumns[target.name] = {
                    applied: true,
                    tooltip: buildPredictionTooltip(predictionItem)
                };
            });

            resultRows.push({
                row: row,
                predictedColumns: predictedColumns
            });
            queryIndex += 1;
        });

        return {
            updatedRows: updatedRows,
            resultRows: resultRows,
            appliedPredictionCount: appliedPredictionCount,
            missingPredictionCount: missingPredictionCount
        };
    }

    function buildPredictionQueues(predictions, indexColumn) {
        var queues = {};

        predictions.forEach(function (prediction) {
            var key = normalizeKey(prediction && prediction[indexColumn]);
            if (!key) {
                return;
            }

            queues[key] = queues[key] || [];
            queues[key].push(prediction);
        });

        return queues;
    }

    function takePrediction(queues, predictions, indexValue, queryIndex) {
        var key = normalizeKey(indexValue);
        if (key && queues[key] && queues[key].length) {
            return queues[key].shift();
        }

        return predictions[queryIndex] || null;
    }

    function readPredictionItem(value) {
        if (Array.isArray(value)) {
            return value[0] || null;
        }

        if (value && typeof value === 'object') {
            return value;
        }

        return value === undefined ? null : { prediction: value };
    }

    function buildPredictionTooltip(item) {
        var details = ['Predikce SAP RPT'];

        if (Number.isFinite(Number(item.confidence))) {
            details.push(
                'confidence ' + (Number(item.confidence) * 100).toFixed(1) + ' %'
            );
        }

        if (Array.isArray(item.confidence_interval)) {
            details.push(
                'interval ' + item.confidence_interval.map(formatValue).join(' – ')
            );
        }

        return details.join(' · ');
    }

    function normalizeKey(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function isPredictionValue(value, placeholder) {
        return String(value === undefined || value === null ? '' : value).trim()
            === placeholder;
    }

    function formatValue(value) {
        if (typeof value === 'number') {
            return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
        }

        return value === undefined || value === null ? '' : String(value);
    }

    return {
        formatValue: formatValue,
        getModelResponse: getModelResponse,
        getPredictions: getPredictions,
        mergePredictionResults: mergePredictionResults
    };
}));
