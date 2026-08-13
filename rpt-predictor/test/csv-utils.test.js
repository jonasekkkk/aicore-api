const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCsvProfile,
    createMockPredictions,
    detectDelimiter,
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

test('prepareRptPayload řadí context před query a zachová kontrakt RPT', () => {
    const result = prepareRptPayload(
        [
            { id: 'Q-1', feature: 'A', target: '[PREDICT]' },
            { id: 'C-1', feature: 'B', target: '12' },
            { id: 'C-2', feature: 'C', target: '18' }
        ],
        {
            indexColumn: 'id',
            targetColumn: 'target',
            taskType: 'regression',
            predictionPlaceholder: '[PREDICT]'
        }
    );

    assert.equal(result.payload.index_column, 'id');
    assert.equal(result.payload.rows[0].id, 'C-1');
    assert.equal(result.payload.rows[2].id, 'Q-1');
    assert.equal(result.rowSelection.queryRows, 1);
});

test('prepareRptPayload odmítne dataset bez predikčního řádku', () => {
    assert.throws(
        () => prepareRptPayload(
            [{ id: 'C-1', target: '12' }],
            {
                indexColumn: 'id',
                targetColumn: 'target',
                taskType: 'regression',
                predictionPlaceholder: '[PREDICT]'
            }
        ),
        /není prázdná hodnota/
    );
});

test('mock predikce mají strukturu RPT response', () => {
    const predictions = createMockPredictions(
        [{ id: 'TX-1', target: '100' }],
        'id',
        'target',
        'regression'
    );

    assert.equal(predictions[0].id, 'TX-1');
    assert.equal(predictions[0].target[0].prediction, 97);
    assert.deepEqual(predictions[0].target[0].confidence_interval, [87.3, 106.7]);
});

test('toBuffer dekóduje OData Base64 payload', () => {
    const encoded = Buffer.from('id,target\n1,2\n').toString('base64');
    assert.equal(toBuffer(encoded).toString('utf8'), 'id,target\n1,2\n');
});
