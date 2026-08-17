const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCsvProfile,
    createMockPredictions,
    detectDelimiter,
    detectPredictionTargets,
    parseCsvBuffer,
    prepareRptPayload,
    toBuffer
} = require('../srv/csv-utils');

test('detectDelimiter rozpozná čárku i středník', () => {
    assert.equal(detectDelimiter('id,name,target\n1,A,10'), ',');
    assert.equal(detectDelimiter('id;name;target\n1;A;10'), ';');
});

test('parseCsvBuffer načte quoted CSV a vytvoří profil', async () => {
    const source = Buffer.from(
        'id_transakce,nazev,mnozstvi_prodano\n' +
        'TX-1,"Rohlík, celozrnný",10\n' +
        'TX-2,Houska,20\n'
    );
    const parsed = await parseCsvBuffer(source);
    const profile = buildCsvProfile(parsed.rows, parsed.delimiter);

    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].nazev, 'Rohlík, celozrnný');
    assert.equal(profile.columnCount, 3);
    assert.equal(profile.suggestedIndexColumn, 'id_transakce');
    assert.equal(profile.suggestedTargetColumn, 'mnozstvi_prodano');
});

test('prepareRptPayload najde všechny prázdné buňky a odhadne typ úlohy', () => {
    const result = prepareRptPayload(
        [
            { id: 'Q-1', feature: 'A', amount: '', category: 'Gold' },
            { id: 'Q-2', feature: 'B', amount: '15', category: '' },
            { id: 'C-1', feature: 'B', amount: '12', category: 'Silver' },
            { id: 'C-2', feature: 'C', amount: '18', category: 'Gold' }
        ],
        {
            indexColumn: 'id'
        }
    );

    assert.equal(result.payload.index_column, 'id');
    assert.equal(result.payload.rows[0].id, 'C-1');
    assert.equal(result.payload.rows[2].id, 'Q-1');
    assert.equal(result.rowSelection.queryRows, 2);
    assert.equal(result.rowSelection.predictionCells, 2);
    assert.deepEqual(result.payload.prediction_config.target_columns, [
        {
            name: 'amount',
            task_type: 'regression',
            prediction_placeholder: ''
        },
        {
            name: 'category',
            task_type: 'classification',
            prediction_placeholder: ''
        }
    ]);
});

test('prepareRptPayload odmítne dataset bez prázdného řádku', () => {
    assert.throws(
        () => prepareRptPayload(
            [{ id: 'C-1', target: '12' }],
            {
                indexColumn: 'id',
                targetColumn: 'target',
                taskType: 'regression'
            }
        ),
        /neobsahuje žádné prázdné buňky/
    );
});

test('mock predikce vrátí pouze pole s prázdnými buňkami', () => {
    const rows = [
        { id: 'C-1', amount: '100', category: 'Gold' },
        { id: 'Q-1', amount: '', category: 'Gold' },
        { id: 'Q-2', amount: '120', category: '' }
    ];
    const targets = detectPredictionTargets(rows);
    const predictions = createMockPredictions(
        rows,
        'id',
        targets
    );

    assert.equal(predictions.length, 2);
    assert.equal(predictions[0].id, 'Q-1');
    assert.equal(predictions[0].amount[0].prediction, 107.8);
    assert.equal(predictions[0].category, undefined);
    assert.equal(predictions[1].id, 'Q-2');
    assert.equal(predictions[1].amount, undefined);
    assert.equal(predictions[1].category[0].prediction, 'Gold');
});

test('toBuffer dekóduje OData Base64 payload', () => {
    const encoded = Buffer.from('id,target\n1,2\n').toString('base64');
    assert.equal(toBuffer(encoded).toString('utf8'), 'id,target\n1,2\n');
});