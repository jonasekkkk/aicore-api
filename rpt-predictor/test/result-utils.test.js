const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getPredictions,
    mergePredictionResults
} = require('../app/result-utils');

test('mergePredictionResults aktualizuje jen označené buňky', () => {
    const rows = [
        { id: 'C-1', amount: '10', category: 'Gold' },
        { id: 'Q-1', amount: '[PREDICT]', category: 'Gold' },
        { id: 'Q-2', amount: '20', category: '[PREDICT]' }
    ];
    const predictions = [
        {
            id: 'Q-1',
            amount: [{ prediction: 14.5, confidence_interval: [12, 17] }]
        },
        {
            id: 'Q-2',
            category: [{ prediction: 'Silver', confidence: 0.91 }]
        }
    ];
    const merged = mergePredictionResults({
        rows,
        indexColumn: 'id',
        targets: [
            { name: 'amount' },
            { name: 'category' }
        ],
        predictionPlaceholder: '[PREDICT]',
        predictions
    });

    assert.equal(merged.updatedRows[1].amount, 14.5);
    assert.equal(merged.updatedRows[1].category, 'Gold');
    assert.equal(merged.updatedRows[2].amount, '20');
    assert.equal(merged.updatedRows[2].category, 'Silver');
    assert.equal(merged.appliedPredictionCount, 2);
    assert.equal(merged.resultRows.length, 2);
    assert.match(
        merged.resultRows[1].predictedColumns.category.tooltip,
        /confidence 91.0 %/
    );
});

test('mergePredictionResults použije pořadí query řádků jako fallback', () => {
    const merged = mergePredictionResults({
        rows: [{ id: 'Q-1', target: '[PREDICT]' }],
        indexColumn: 'id',
        targets: [{ name: 'target' }],
        predictions: [{ target: [{ prediction: 'Done' }] }]
    });

    assert.equal(merged.updatedRows[0].target, 'Done');
});

test('getPredictions podporuje mock i live response', () => {
    assert.equal(getPredictions({ predictions: [{ id: 1 }] }).length, 1);
    assert.equal(getPredictions({ response: { predictions: [{ id: 2 }] } }).length, 1);
});
