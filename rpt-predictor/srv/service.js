const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const csv = require('csv-parser');
const { Readable } = require('stream');

module.exports = cds.service.impl(async function() {
    this.on('pingModel', async (req) => {
    try {
        console.log("Zkouším pingnout RPT model...");
        
        const response = await executeHttpRequest(
            { destinationName: 'RPT_AI_CORE' },
            {
                method: 'POST',
                url: '/v2/inference/deployments/da7b7f89b9428ee7/predict', 
                data: {
                    // Pošleme mu úplný nesmysl, jen ať vidíme, jestli odpoví
                    inputs: [{ "TestColumn": "TestValue" }] 
                }
            }
        );

        return `✅ Destinace žije! Model vrátil: ${JSON.stringify(response.data)}`;

    } catch (error) {
        console.error("Chyba při pingu:", error);
        // Vrátíme to přímo do frontendu, ať vidíš na obrazovce, co přesně spadlo
        return `❌ Chyba spojení: ${error.message}`; 
    }
});
    
    this.on('predictMissingData', async (req) => {
        try {
            // 1. Získání dat ze streamu z uploadu
            const fileBuffer = req.data.file; 
            if (!fileBuffer) return req.error(400, "Nebyl nahrán žádný soubor bráško.");

            const results = [];
            
            // Uděláme z bufferu stream, abychom nezahltili paměť, jak jsme se bavili prve
            const stream = Readable.from(fileBuffer); 

            // 2. Univerzální parsování CSV (dynamicky bere všechny sloupce a řádky)
            await new Promise((resolve, reject) => {
                stream
                    .pipe(csv({ separator: ',' })) // Bacha, u českých Excelů to někdy bývá středník (';')
                    .on('data', (data) => results.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`Načteno ${results.length} řádků z CSV. Posílám do AI...`);

            // 3. Volání tvého konkrétního RPT deploymentu přes BTP Destinaci
            const response = await executeHttpRequest(
                { destinationName: 'RPT_Destination' },
                {
                    method: 'POST',
                    url: '/v2/inference/deployments/da7b7f89b9428ee7/predict', 
                    data: {
                        inputs: results 
                    }
                }
            );

            const aiPredictions = response.data;
            
            // 4. Zatím to jen vypíšeme, tady by pak přišel kód na zápis zpět
            return `Úspěch! Model sežvýkal ${results.length} řádků. Zpátky vrátil tohle: ${JSON.stringify(aiPredictions)}`;

        } catch (error) {
            console.error("Chyba při komunikaci s RPT modelem:", error);
            req.error(500, "Něco lehlo při volání AI. Zkontroluj destinaci.");
        }
    });
});