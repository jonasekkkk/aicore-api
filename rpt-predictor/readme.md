# RPT Predictor

Diagnostický CAP dashboard pro přípravu CSV dat a volání SAP RPT 1.5 Large přes SAP BTP destination.

## Co dashboard umí

- kontrola dostupnosti CAP/OData služby,
- zobrazení runtime konfigurace bez citlivých údajů,
- oddělený mock a live test RPT deploymentu,
- načtení CSV, detekce oddělovače, datový profil a náhled,
- konfigurace indexového a cílového sloupce,
- podrobný request/response log včetně časování a HTTP stavů,
- stažení nebo zkopírování technického logu.

Mock režim je vždy viditelně označený a nevolá externí službu. Live režim používá destination `RPT_Destination`.

## Lokální spuštění v SAP BAS

```sh
npm ci
npm start
```

Dashboard se otevře na adrese vypsané CAP serverem, obvykle `http://localhost:4004/`.

## Volitelná runtime konfigurace

| Proměnná | Výchozí hodnota |
| --- | --- |
| `RPT_DESTINATION_NAME` | `RPT_Destination` |
| `RPT_DEPLOYMENT_ID` | `da7b7f89b9428ee7` |
| `RPT_RESOURCE_GROUP` | `default` |
| `RPT_MODEL_NAME` | `SAP RPT 1.5 Large` |

## Kontroly

```sh
npm run check
npm test
```
