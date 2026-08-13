# RPT Predictor

Diagnostický CAP dashboard pro přípravu CSV dat a volání SAP RPT 1.5 Large přes SAP BTP destination.

## Co dashboard umí

- kontrola dostupnosti CAP/OData služby,
- zobrazení runtime konfigurace bez citlivých údajů,
- oddělený mock a live test RPT deploymentu,
- načtení CSV, detekce oddělovače, datový profil a náhled,
- automatická detekce všech buněk označených `[PREDICT]` ve všech sloupcích,
- automatický odhad regrese nebo klasifikace pro každý cílový sloupec,
- oddělená kontrola načtení BTP destination bez volání modelu,
- podrobný request/response log včetně časování a HTTP stavů,
- stažení nebo zkopírování technického logu.

Mock režim je vždy viditelně označený a nevolá externí službu. Live režim používá destination `RPT_Destination`.

## Lokální spuštění v SAP BAS

Pro mock režim:

```sh
npm ci
npm start
```

Pro live volání v BAS nejprve připojte lokální CAP proces k existující
Destination service instanci (její jméno ověřte přes `cf services`):

```sh
cf target
cf services
cds bind destinations --to aicore_api-destination
cds watch --profile hybrid
```

Příkaz `cds bind` vytvoří lokální `.cdsrc-private.json`; soubor je v
`.gitignore` a nesmí se commitovat. Pokud BAS nezná příkaz `cds`, instalace
bez `sudo` je:

```sh
npm install --global @sap/cds-dk
```

V BTP subaccountu musí existovat destination přesně pojmenovaná
`RPT_Destination`. Její URL má končit kořenem deploymentu, například
`/v2/inference/deployments/<deployment-id>/`; aplikace k ní připojí `/predict`.
Po spuštění použijte v dashboardu nejprve tlačítko
**Načíst destinaci** a až potom **Live model**.

Dashboard se otevře na adrese vypsané CAP serverem, obvykle `http://localhost:4004/`.

## Volitelná runtime konfigurace

| Proměnná | Výchozí hodnota |
| --- | --- |
| `RPT_DESTINATION_NAME` | `RPT_Destination` |
| `RPT_DEPLOYMENT_ID` | `da7b7f89b9428ee7` |
| `RPT_RESOURCE_GROUP` | `GroundingMgmt-Kleprlik` |
| `RPT_MODEL_NAME` | `SAP RPT 1.5 Large` |
| `RPT_PREDICT_ENDPOINT` | `/predict` |

## Kontroly

```sh
npm run check
npm test
```
