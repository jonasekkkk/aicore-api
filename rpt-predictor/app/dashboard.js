sap.ui.define([
    'sap/m/App',
    'sap/m/Page',
    'sap/m/Toolbar',
    'sap/m/ToolbarSpacer',
    'sap/m/VBox',
    'sap/m/HBox',
    'sap/m/FlexBox',
    'sap/m/Panel',
    'sap/m/Title',
    'sap/m/Text',
    'sap/m/Label',
    'sap/m/ObjectStatus',
    'sap/m/Button',
    'sap/m/Select',
    'sap/m/TextArea',
    'sap/m/MessageStrip',
    'sap/m/Table',
    'sap/m/Column',
    'sap/m/ColumnListItem',
    'sap/m/MessageToast',
    'sap/ui/unified/FileUploader',
    'sap/ui/model/json/JSONModel',
    'sap/ui/core/Item',
    'sap/ui/core/Icon',
    'rptpredictor/result-utils',
    'sap/m/Input',
    'sap/m/Popover',
], function (
    App,
    Page,
    Toolbar,
    ToolbarSpacer,
    VBox,
    HBox,
    FlexBox,
    Panel,
    Title,
    Text,
    Label,
    ObjectStatus,
    Button,
    Select,
    TextArea,
    MessageStrip,
    Table,
    Column,
    ColumnListItem,
    MessageToast,
    FileUploader,
    JSONModel,
    Item,
    Icon,
    ResultUtils,
    Input,
    Popover,
) {
    'use strict';

    var stateModel = new JSONModel({
        busy: false,
        lastRefresh: 'čeká na první kontrolu',
        statuses: {
            frontend: {
                text: 'Načteno',
                state: 'Success'
            },
            cap: {
                text: 'Kontroluji…',
                state: 'Information'
            },
            destination: {
                text: 'Netestováno',
                state: 'None'
            },
            deployment: {
                text: 'Netestováno',
                state: 'None'
            },
            csv: {
                text: 'Čeká na soubor',
                state: 'None'
            }
        },
        file: {
            loaded: false,
            name: 'Žádný soubor',
            size: '—',
            rows: 0,
            columns: 0,
            delimiter: '—',
            missing: 0,
            targets: 0,
            predictionCells: 0
        },
        requestText: '',
        responseText: 'Zatím nebyl spuštěn žádný test.',
        result: {
            ready: false,
            httpStatus: '—',
            mode: 'Čeká na predikci',
            completedAt: '—',
            duration: '—',
            predictions: 0,
            rows: 0,
            targets: 0,
            requestId: '—',
            statusMessage: 'Nahrajte CSV s prázdnými buňkami a spusťte predikci.',
            messageType: 'Information'
        },
        consoleText: ''
    });
    var previewModel = new JSONModel({ rows: [] });
    var resultModel = new JSONModel({ rows: [] });
    var selectedFile = null;
    var csvProfile = null;
    var lastUpdatedRows = null;
    var logEntries = [];

    var indexSelect = new Select({
        width: '100%',
        change: function () {
            resetPredictionResults();
            updateRequestPreview();
        }
    });

    var detectedTargetsArea = new TextArea({
        value: 'Nejprve načtěte CSV.',
        editable: false,
        width: '100%',
        rows: 4
    }).addStyleClass('rptTargetSummary');

    var requestArea = new TextArea({
        value: '{/requestText}',
        editable: false,
        width: '100%',
        rows: 14
    }).addStyleClass('rptRequestArea');

    var responseArea = new TextArea({
        value: '{/responseText}',
        editable: false,
        width: '100%',
        rows: 14
    }).addStyleClass('rptResponseArea');

    var consoleArea = new TextArea({
        value: '{/consoleText}',
        editable: false,
        width: '100%',
        rows: 18
    }).addStyleClass('rptConsole');

    var previewTable = new Table({
        width: '100%',
        fixedLayout: false,
        growing: false,
        noDataText: 'Nahrajte CSV nebo načtěte ukázkový soubor.'
    }).addStyleClass('rptPreviewTable');
    previewTable.setModel(previewModel, 'preview');

    var resultTable = new Table({
        width: '100%',
        fixedLayout: false,
        growing: true,
        growingThreshold: 20,
        noDataText: 'Výsledky se zobrazí po úspěšné mock nebo live predikci.'
    }).addStyleClass('rptResultTable');
    resultTable.setModel(resultModel, 'result');

    var downloadResultButton = new Button({
        text: 'Stáhnout aktualizované CSV',
        icon: 'sap-icon://download',
        type: 'Emphasized',
        enabled: '{/result/ready}',
        press: downloadUpdatedCsv
    });

    var uploadControl = new FileUploader({
        width: '100%',
        buttonText: 'Vybrat CSV',
        placeholder: 'Vyberte lokální .csv soubor',
        fileType: ['csv'],
        sameFilenameAllowed: true,
        change: function (event) {
            var files = event.getParameter('files');
            var file = files && files[0];

            if (!file) {
                log('WARN', 'CSV', 'FileUploader nevrátil žádný soubor.');
                return;
            }

            loadCsvFile(file, 'upload');
        },
        typeMissmatch: function () {
            MessageToast.show('Vyberte soubor ve formátu CSV.');
            log('WARN', 'CSV', 'Odmítnut soubor s nepodporovanou příponou.');
        }
    });

    var app = new App();
    var page = new Page({
        showHeader: true,
        customHeader: createHeader(),
        content: [createMainContent()],
        busy: '{/busy}',
        busyIndicatorDelay: 100
    }).addStyleClass('rptPage');
    page.setModel(stateModel);
    app.addPage(page);
    app.placeAt('content');

    updateRequestPreview();
    log('INFO', 'FRONTEND', 'SAP Horizon diagnostický dashboard byl inicializován.', {
        ui5Theme: 'sap_horizon',
        serviceRoot: '/odata/v4/predictor'
    });

    Promise.resolve()
        .then(refreshDiagnostics)
        .then(runDestinationCheck)
        .then(loadDemoFile)
        .catch(function (error) {
            log('ERROR', 'STARTUP', 'Úvodní kontrola nebyla dokončena.', {
                message: error.message
            });
        });

    function createHeader() {
        return new Toolbar({
            content: [
                new Icon({ src: 'sap-icon://business-objects-experience' })
                    .addStyleClass('rptBrandMark'),
                new Title({ text: 'RPT Predictor', level: 'H2' }),
                new Text({ text: 'Diagnostics & Data Lab' }).addStyleClass('rptMuted'),
                new ToolbarSpacer(),
                new ObjectStatus({
                    text: 'SAP BTP / BAS',
                    icon: 'sap-icon://cloud',
                    state: 'Information'
                }),
                new Button({
                    icon: 'sap-icon://synchronize',
                    type: 'Transparent',
                    tooltip: 'Obnovit diagnostiku',
                    press: refreshDiagnostics
                })
            ]
        }).addStyleClass('rptShellBar');
    }

    function createMainContent() {
        return new VBox({
            width: '100%',
            items: [
                createHero(),
                new Title({ text: 'Stav systému', level: 'H2' })
                    .addStyleClass('rptSectionTitle'),
                createStatusGrid(),
                new Title({ text: 'Data a predikce', level: 'H2' })
                    .addStyleClass('rptSectionTitle'),
                new MessageStrip({
                    text: 'Prázdné buňky v souboru se automaticky detekují a zařadí do predikce. Mock test nic neposílá mimo aplikaci; live test volá RPT_Destination.',
                    type: 'Information',
                    showIcon: true,
                    showCloseButton: false
                }).addStyleClass('rptModeStrip'),
                createWorkspace(),
                createResultPanel(),
                new Title({ text: 'Technické detaily', level: 'H2' })
                    .addStyleClass('rptSectionTitle'),
                createTechnicalWorkspace(),
                createLogPanel()
            ]
        }).addStyleClass('rptMain');
    }

    function createHero() {
        return new VBox({
            width: '100%',
            items: [
                new HBox({
                    wrap: 'Wrap',
                    items: [
                        new ObjectStatus({
                            text: 'SAP RPT 1.5 Large',
                            icon: 'sap-icon://machine',
                            state: 'Information'
                        }).addStyleClass('rptHeroBadge'),
                        new ObjectStatus({
                            text: 'Destination: RPT_Destination',
                            icon: 'sap-icon://connected',
                            state: 'Information'
                        }).addStyleClass('rptHeroBadge'),
                        new ObjectStatus({
                            text: 'Deployment: da7b7f89b9428ee7',
                            icon: 'sap-icon://instance',
                            state: 'Information'
                        }).addStyleClass('rptHeroBadge')
                    ]
                }).addStyleClass('sapUiSmallMarginBottom'),
                new Title({ text: 'Prediction Control Center', level: 'H1' })
                    .addStyleClass('rptHeroTitle'),
                new Text({
                    text: 'Jedno místo pro kontrolu CAP služby, BTP destinace, RPT deploymentu, CSV profilu a kompletního request/response toku.'
                }).addStyleClass('rptHeroSubtitle'),
                new FlexBox({
                    wrap: 'Wrap',
                    items: [
                        new Button({
                            text: 'Spustit mock request',
                            icon: 'sap-icon://simulate',
                            type: 'Emphasized',
                            press: runMockPing
                        }),
                        new Button({
                            text: 'Ověřit destinaci',
                            icon: 'sap-icon://cloud-check',
                            type: 'Default',
                            press: runDestinationCheck
                        }),
                        new Button({
                            text: 'Otestovat live RPT',
                            icon: 'sap-icon://journey-arrive',
                            type: 'Default',
                            press: runLivePing
                        }),
                    ]
                }).addStyleClass('rptHeroActions')
            ]
        }).addStyleClass('rptHero');
    }

    function createStatusGrid() {
        return new FlexBox({
            width: '100%',
            wrap: 'Wrap',
            items: [
                createStatusCard(
                    'Frontend',
                    'frontend',
                    'sap-icon://monitor-payments',
                    'SAPUI5 · Horizon theme'
                ),
                createStatusCard(
                    'CAP API',
                    'cap',
                    'sap-icon://technical-object',
                    '/odata/v4/predictor'
                ),
                createStatusCard(
                    'BTP Destination',
                    'destination',
                    'sap-icon://connected',
                    'RPT_Destination'
                ),
                createStatusCard(
                    'RPT Deployment',
                    'deployment',
                    'sap-icon://machine',
                    'da7b7f89b9428ee7'
                ),
                createStatusCard(
                    'CSV Pipeline',
                    'csv',
                    'sap-icon://table-view',
                    'Parse · Profile · Predict'
                )
            ]
        }).addStyleClass('rptStatusGrid');
    }

    function createStatusCard(title, key, icon, hint) {
        return new HBox({
            alignItems: 'Center',
            items: [
                new Icon({ src: icon }).addStyleClass('rptStatusIcon'),
                new VBox({
                    items: [
                        new Title({ text: title, level: 'H4' }),
                        new ObjectStatus({
                            text: '{/statuses/' + key + '/text}',
                            state: '{/statuses/' + key + '/state}'
                        }),
                        new Text({ text: hint, maxLines: 1 })
                            .addStyleClass('rptCardHint')
                    ]
                })
            ]
        }).addStyleClass('rptStatusCard');
    }

    function createWorkspace() {
        return new FlexBox({
            width: '100%',
            wrap: 'Wrap',
            alignItems: 'Start',
            items: [
                createDataPanel(),
                createControlPanel()
            ]
        }).addStyleClass('rptWorkspace rptPrimaryWorkspace');
    }

    function createControlPanel() {
        return new Panel({
            headerToolbar: panelToolbar(
                'Konfigurace CSV requestu',
                'sap-icon://activity-2'
            ),
            content: [
                new FlexBox({
                    wrap: 'Wrap',
                    items: [
                        createField('Indexový sloupec', indexSelect),
                        createField(
                            'Automaticky nalezené cíle',
                            detectedTargetsArea,
                            'rptFieldWide'
                        )
                    ]
                }).addStyleClass('rptFieldRow rptSpacerTop'),
                new FlexBox({
                    wrap: 'Wrap',
                    items: [
                        new Button({
                            text: 'Analyzovat CSV — mock',
                            icon: 'sap-icon://inspect',
                            press: runCsvMock
                        }),
                        new Button({
                            text: 'Predikovat CSV — live',
                            icon: 'sap-icon://activate',
                            type: 'Emphasized',
                            press: runCsvLive
                        })
                    ]
                }).addStyleClass('rptButtonRow rptSpacerTop')
            ]
        }).addStyleClass('rptPanel rptControlPanel');
    }

    function createDataPanel() {
        return new Panel({
            headerToolbar: panelToolbar(
                'CSV Data Lab',
                'sap-icon://table-view',
                new Button({
                    text: 'Demo soubor',
                    icon: 'sap-icon://download-from-cloud',
                    type: 'Transparent',
                    press: loadDemoFile
                })
            ),
            content: [
                new VBox({
                    items: [
                        uploadControl,
                        new Text({
                            text: 'Podporovaný formát: CSV · Doporučená velikost do 10 MB'
                        }).addStyleClass('rptMuted')
                    ]
                }).addStyleClass('rptUploadBox'),
                new FlexBox({
                    wrap: 'Wrap',
                    items: [
                        createMetaChip('Soubor', '/file/name'),
                        createMetaChip('Velikost', '/file/size'),
                        createMetaChip('Řádky', '/file/rows'),
                        createMetaChip('Sloupce', '/file/columns'),
                        createMetaChip('Oddělovač', '/file/delimiter'),
                        createMetaChip('Prázdné buňky', '/file/missing'),
                        createMetaChip('Cílové sloupce', '/file/targets'),
                        createMetaChip('Prázdné buňky', '/file/predictionCells')
                    ]
                }).addStyleClass('rptMetaRow rptSpacerTop sapUiSmallMarginBottom'),
                previewTable
            ]
        }).addStyleClass('rptPanel rptDataPanel');
    }

    function createResultPanel() {
        return new Panel({
            headerToolbar: panelToolbar(
                'Výsledky predikce',
                'sap-icon://table-chart',
                downloadResultButton
            ),
            content: [
                new MessageStrip({
                    text: '{/result/statusMessage}',
                    type: '{/result/messageType}',
                    showIcon: true,
                    showCloseButton: false
                }).addStyleClass('rptResultMessage'),
                resultTable,
                new Title({ text: 'Souhrn odpovědi', level: 'H4' })
                    .addStyleClass('rptResultMetaTitle'),
                new FlexBox({
                    wrap: 'Wrap',
                    items: [
                        createMetaChip('HTTP', '/result/httpStatus'),
                        createMetaChip('Režim', '/result/mode'),
                        createMetaChip('Dokončeno', '/result/completedAt'),
                        createMetaChip('Doba', '/result/duration'),
                        createMetaChip('Predikované buňky', '/result/predictions'),
                        createMetaChip('Řádky výsledku', '/result/rows'),
                        createMetaChip('Cílové sloupce', '/result/targets'),
                        createMetaChip('Request ID', '/result/requestId')
                    ]
                }).addStyleClass('rptMetaRow')
            ]
        }).addStyleClass('rptPanel rptFullPanel rptResultPanel');
    }

    function createTechnicalWorkspace() {
        return new FlexBox({
            width: '100%',
            wrap: 'Wrap',
            alignItems: 'Start',
            items: [
                createRequestPanel(),
                createResponsePanel()
            ]
        }).addStyleClass('rptWorkspace rptTechnicalWorkspace');
    }

    function createRequestPanel() {
        return new Panel({
            expandable: true,
            expanded: false,
            headerToolbar: panelToolbar(
                'Request payload',
                'sap-icon://outbox'
            ),
            content: [requestArea]
        }).addStyleClass('rptPanel rptTechnicalPanel');
    }

    function createResponsePanel() {
        return new Panel({
            expandable: true,
            expanded: false,
            headerToolbar: panelToolbar(
                'Raw response',
                'sap-icon://inbox'
            ),
            content: [responseArea]
        }).addStyleClass('rptPanel rptTechnicalPanel');
    }

    function createLogPanel() {
        return new Panel({
            headerToolbar: panelToolbar(
                'Live request log',
                'sap-icon://developer-settings',
                new HBox({
                    items: [
                        new Button({
                            icon: 'sap-icon://copy',
                            type: 'Transparent',
                            tooltip: 'Kopírovat log',
                            press: copyLogs
                        }),
                        new Button({
                            icon: 'sap-icon://download',
                            type: 'Transparent',
                            tooltip: 'Stáhnout log',
                            press: downloadLogs
                        }),
                        new Button({
                            icon: 'sap-icon://delete',
                            type: 'Transparent',
                            tooltip: 'Vyčistit log',
                            press: clearLogs
                        })
                    ]
                })
            ),
            content: [consoleArea]
        }).addStyleClass('rptPanel rptLogPanel');
    }

    function panelToolbar(title, icon, trailingControl) {
        var content = [
            new Icon({ src: icon }),
            new Title({ text: title, level: 'H3' }),
            new ToolbarSpacer()
        ];

        if (trailingControl) {
            content.push(trailingControl);
        }

        return new Toolbar({ content: content });
    }

    function createField(label, control, styleClass) {
        return new VBox({
            items: [
                new Label({ text: label, labelFor: control }),
                control
            ]
        }).addStyleClass('rptField' + (styleClass ? ' ' + styleClass : ''));
    }

    function createMetaChip(label, path) {
        return new HBox({
            alignItems: 'Center',
            items: [
                new Text({ text: label + ':' }),
                new Text({ text: '{' + path + '}' })
            ]
        }).addStyleClass('rptMetaChip');
    }

    async function refreshDiagnostics() {
        setStatus('cap', 'Kontroluji…', 'Information');
        log('INFO', 'CAP', 'Spouštím kontrolu OData metadata a diagnostické akce.');
        setBusy(true);

        try {
            var metadataStarted = performance.now();
            var metadataResponse = await fetch('/odata/v4/predictor/$metadata', {
                headers: { Accept: 'application/xml' }
            });
            var metadataDuration = Math.round(performance.now() - metadataStarted);

            if (!metadataResponse.ok) {
                throw new Error('Metadata endpoint vrátil HTTP ' + metadataResponse.status);
            }

            log('SUCCESS', 'CAP', 'OData metadata jsou dostupná.', {
                httpStatus: metadataResponse.status,
                durationMs: metadataDuration,
                url: '/odata/v4/predictor/$metadata'
            });

            var diagnostics = await requestAction('getDiagnostics', {}, 'CAP diagnostics');
            setStatus('cap', 'Dostupné', 'Success');
            setStatus(
                'destination',
                diagnostics.destination.runtimeBindings.destinationBindingDetected
                    ? 'Binding nalezen'
                    : 'Binding nenalezen',
                diagnostics.destination.runtimeBindings.destinationBindingDetected
                    ? 'Information'
                    : 'Warning'
            );
            setStatus('deployment', 'Čeká na live test', 'Information');
            stateModel.setProperty('/lastRefresh', formatTime(new Date()));
            stateModel.setProperty('/responseText', pretty(diagnostics));

            log('INFO', 'CONFIG', 'Načtena runtime konfigurace bez tajných údajů.', {
                destination: diagnostics.destination,
                deployment: diagnostics.deployment,
                capabilities: diagnostics.capabilities
            });
        } catch (error) {
            setStatus('cap', 'Nedostupné', 'Error');
            setStatus('destination', 'Nelze ověřit', 'Warning');
            log('ERROR', 'CAP', 'Kontrola CAP služby selhala.', {
                message: error.message
            });
            MessageToast.show('CAP diagnostika selhala. Podrobnosti jsou v logu.');
        } finally {
            setBusy(false);
        }
    }

    async function runDestinationCheck() {
        setBusy(true);
        setStatus('destination', 'Načítám…', 'Information');

        try {
            var result = await requestAction(
                'checkDestination',
                {},
                'Destination lookup'
            );
            stateModel.setProperty('/responseText', pretty(result));

            if (!result.ok) {
                var bindingDetected = result.runtimeBindings
                    && result.runtimeBindings.destinationBindingDetected;
                setStatus(
                    'destination',
                    bindingDetected ? 'Destination nenalezena' : 'Chybí binding',
                    'Error'
                );
                setStatus('deployment', 'Čeká na destinaci', 'Warning');
                log('ERROR', 'DESTINATION', 'RPT_Destination se nepodařilo načíst.', {
                    runtimeBindings: result.runtimeBindings,
                    error: result.error
                });
                MessageToast.show('Destinace není dostupná. Přesná příčina je v logu.');
                return result;
            }

            setStatus('destination', 'Načtena · ' + result.durationMs + ' ms', 'Success');
            log('SUCCESS', 'DESTINATION', 'RPT_Destination byla úspěšně načtena.', {
                destination: result.destination,
                runtimeBindings: result.runtimeBindings,
                durationMs: result.durationMs
            });
            return result;
        } catch (error) {
            setStatus('destination', 'Kontrola selhala', 'Error');
            handleUiError('Kontrola destinace selhala.', error);
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function runMockPing() {
        setBusy(true);
        setStatus('deployment', 'Mock běží…', 'Information');

        try {
            var result = await requestAction(
                'pingModel',
                { useMock: true },
                'RPT mock ping'
            );
            stateModel.setProperty('/responseText', pretty(result));
            setStatus('deployment', 'Mock OK · ' + result.durationMs + ' ms', 'Success');
            log('SUCCESS', 'MOCK', 'Simulovaná predikce byla dokončena.', {
                durationMs: result.durationMs,
                predictions: result.response && result.response.predictions
            });
        } catch (error) {
            setStatus('deployment', 'Mock selhal', 'Error');
            handleUiError('Mock request selhal.', error);
        } finally {
            setBusy(false);
        }
    }

    async function runLivePing() {
        setBusy(true);
        setStatus('destination', 'Testuji…', 'Information');
        setStatus('deployment', 'Volám model…', 'Information');

        try {
            var result = await requestAction(
                'pingModel',
                { useMock: false },
                'RPT live ping'
            );
            stateModel.setProperty('/responseText', pretty(result));

            if (!result.ok) {
                setStatus('destination', 'Chyba spojení', 'Error');
                setStatus('deployment', 'Nedostupné', 'Error');
                log('ERROR', 'RPT', 'Live RPT test vrátil chybu.', result.error);
                MessageToast.show('Live RPT test selhal. Podrobnosti jsou v logu.');
                return;
            }

            setStatus('destination', 'Dostupné', 'Success');
            setStatus('deployment', 'Running · ' + result.durationMs + ' ms', 'Success');
            log('SUCCESS', 'RPT', 'Live RPT request byl úspěšný.', {
                httpStatus: result.httpStatus,
                durationMs: result.durationMs
            });
        } catch (error) {
            setStatus('destination', 'Chyba spojení', 'Error');
            setStatus('deployment', 'Nelze ověřit', 'Error');
            handleUiError('Live RPT test selhal.', error);
        } finally {
            setBusy(false);
        }
    }

    async function runCsvMock() {
        return runCsvAction(true);
    }

    async function runCsvLive() {
        return runCsvAction(false);
    }

    async function runCsvAction(useMock) {
        if (!selectedFile || !csvProfile) {
            MessageToast.show('Nejprve nahrajte nebo načtěte CSV soubor.');
            log('WARN', 'CSV', 'CSV akce byla zastavena, protože není načten soubor.');
            return;
        }

        var config = getCsvConfig();
        if (!config.targets.length) {
            MessageToast.show('CSV neobsahuje žádné prázdné buňky k predikci.');
            log('WARN', 'CSV', 'Predikce byla zastavena: nebyl nalezen žádný cíl s prázdnými buňkami.');
            return;
        }

        resetPredictionResults();
        setBusy(true);
        setStatus('csv', useMock ? 'Mock analýza…' : 'Live predikce…', 'Information');

        try {
            var base64 = await fileToBase64(selectedFile);
            var result = await requestAction(
                'predictMissingData',
                {
                    file: base64,
                    fileName: selectedFile.name,
                    delimiter: csvProfile.delimiterRaw,
                    indexColumn: config.indexColumn,
                    predictionPlaceholder: '',
                    useMock: useMock
                },
                useMock ? 'CSV mock analysis' : 'CSV live prediction'
            );

            stateModel.setProperty('/responseText', pretty(result));
            renderPredictionResults(result, config, useMock);
            setStatus(
                'csv',
                (useMock ? 'Mock OK · ' : 'Predikce OK · ') + result.durationMs + ' ms',
                'Success'
            );

            if (!useMock) {
                setStatus('destination', 'Dostupné', 'Success');
                setStatus('deployment', 'Running', 'Success');
            }

            log('SUCCESS', 'CSV', 'CSV pipeline byla dokončena.', {
                mode: result.mode,
                profile: result.profile,
                rowSelection: result.rowSelection,
                predictionCount: result.predictions
                    ? result.predictions.length
                    : result.response && result.response.predictions
                        ? result.response.predictions.length
                        : null
            });
        } catch (error) {
            setStatus('csv', 'Akce selhala', 'Error');
            stateModel.setProperty(
                '/result/statusMessage',
                'Predikce selhala: ' + (error.message || String(error))
            );
            stateModel.setProperty('/result/messageType', 'Error');
            handleUiError(
                useMock ? 'Mock analýza CSV selhala.' : 'Live predikce CSV selhala.',
                error
            );
        } finally {
            setBusy(false);
        }
    }

    function renderPredictionResults(result, config, useMock) {
        var predictions = ResultUtils.getPredictions(result);
        var modelResponse = ResultUtils.getModelResponse(result);
        var merged = ResultUtils.mergePredictionResults({
            rows: csvProfile.rows,
            indexColumn: config.indexColumn,
            targets: config.targets,
            predictionPlaceholder: '',
            predictions: predictions
        });
        var columns = selectResultColumns(config);
        var tableRows = merged.resultRows.map(function (entry) {
            var mapped = {};

            columns.forEach(function (column, index) {
                var predictionInfo = entry.predictedColumns[column];
                var isApplied = predictionInfo && predictionInfo.applied;

                mapped['c' + index] = ResultUtils.formatValue(entry.row[column]);
                mapped['s' + index] = isApplied ? 'Success' : 'None';
                mapped['i' + index] = isApplied ? 'sap-icon://machine' : '';
                mapped['t' + index] = predictionInfo
                    ? predictionInfo.tooltip
                    : ResultUtils.formatValue(entry.row[column]);
                
                mapped['isPred' + index] = Boolean(isApplied);
            });

            return mapped;
        });

        lastUpdatedRows = merged.updatedRows;
        rebuildResultTable(columns, config.targets, tableRows);

        var metadata = modelResponse.metadata || {};
        var predictionCount = firstDefined(
            metadata.num_predictions,
            metadata.numPredictions,
            merged.appliedPredictionCount
        );
        var hasMissingPredictions = merged.missingPredictionCount > 0;
        var statusMessage = hasMissingPredictions
            ? 'Některé prázdné buňky model nevrátil. Zkontrolujte raw response.'
            : merged.appliedPredictionCount
                + ' prázdných buněk bylo úspěšně vyplněno predikcí SAP RPT.';

        stateModel.setProperty('/result', {
            ready: merged.appliedPredictionCount > 0,
            httpStatus: result.httpStatus || 200,
            mode: useMock ? 'Mock' : 'Live RPT',
            completedAt: formatTime(
                result.completedAt ? new Date(result.completedAt) : new Date()
            ),
            duration: result.durationMs + ' ms',
            predictions: predictionCount,
            rows: merged.resultRows.length,
            targets: config.targets.length,
            requestId: modelResponse.id || '—',
            statusMessage: statusMessage,
            messageType: hasMissingPredictions ? 'Warning' : 'Success'
        });

        window.setTimeout(function () {
            var dom = resultTable.getDomRef();
            if (dom) {
                dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    function selectResultColumns(config) {
        var targets = config.targets.map(function (target) {
            return target.name;
        });

        var selected = [config.indexColumn];

        var allColumns = csvProfile ? csvProfile.headers : [];

        var availableContext = allColumns.filter(function (col) {
            return col !== config.indexColumn && !targets.includes(col);
        });

        var contextColumns = availableContext.slice(0, 3);

        return selected.concat(contextColumns).concat(targets);
    }

    function rebuildResultTable(columns, targets, rows) {
        var targetNames = targets.map(function (target) {
            return target.name;
        });

        resultTable.removeAllColumns();
        columns.forEach(function (column) {
            var isTarget = targetNames.includes(column);
            var header = isTarget
                ? new VBox({
                    items: [
                        new Label({ text: column }),
                        new Text({ text: 'AI target' }).addStyleClass('rptAiHeaderHint')
                    ]
                })
                : new Label({ text: column });

            resultTable.addColumn(new Column({
                width: isTarget ? '13rem' : '11rem',
                importance: isTarget ? 'High' : 'Medium',
                header: header
            }));
        });

        resultModel.setProperty('/rows', rows);
        resultTable.bindItems({
            path: 'result>/rows',
            template: new ColumnListItem({
                highlight: 'Information',
                cells: columns.map(function (column, index) {
                 return new ObjectStatus({
                        text: '{result>c' + index + '}',
                        state: '{result>s' + index + '}',
                        icon: '{result>i' + index + '}',
                        tooltip: '{result>t' + index + '}',
                        active: '{result>isPred' + index + '}', 
                        press: handlePredictionClick
                    })
                    .data('colIndex', index) 
                    .data('colName', column)
                    .addStyleClass('rptNoSelect');
                })
            }),
            templateShareable: false
        });
    }

    var oPredictionPopover = null;
    var currentEditContext = null;

    function handlePredictionClick(oEvent) {
        var oSource = oEvent.getSource();
        var oContext = oSource.getBindingContext('result');
        
        currentEditContext = {
            path: oContext.getPath(),
            colIndex: oSource.data('colIndex'),
            colName: oSource.data('colName'),
            currentValue: oContext.getProperty('c' + oSource.data('colIndex')),
            tooltipText: oContext.getProperty('t' + oSource.data('colIndex'))
        };

        if (!oPredictionPopover) {
            var oInfoText = new Text({ width: '100%' }).addStyleClass('sapUiTinyMarginBottom');
            var oInput = new Input({ 
                width: '100%', 
                visible: false,
                submit: function() {
                    resultModel.setProperty(currentEditContext.path + '/c' + currentEditContext.colIndex, oInput.getValue());
                    oPredictionPopover.close();
                }
            });
            
            var oAcceptBtn = new Button({
                text: 'Ok', 
                type: 'Emphasized',
                press: function() {
                    if (oInput.getVisible()) {
                        resultModel.setProperty(currentEditContext.path + '/c' + currentEditContext.colIndex, oInput.getValue());
                    }
                    oPredictionPopover.close();
                }
            });

            var oEditBtn = new Button({
                text: 'Upravit', 
                type: 'Default',
                press: function() {
                    oInput.setVisible(true);
                    oEditBtn.setVisible(false);
                    oAcceptBtn.setText('Uložit úpravu');
                }
            });

            var oRejectBtn = new Button({
                text: 'Odmítnout', 
                type: 'Transparent',
                press: function() {
                    var path = currentEditContext.path;
                    var idx = currentEditContext.colIndex;
                    
                    resultModel.setProperty(path + '/c' + idx, '');
                    
                    oPredictionPopover.close();
                }
            });

            oPredictionPopover = new Popover({
                title: 'Predikce umělé inteligence',
                placement: 'Auto',
                contentWidth: '280px',
                content: [
                    new VBox({
                        items: [ oInfoText, oInput ]
                    }).addStyleClass('sapUiSmallMargin')
                ],
                footer: new Toolbar({
                    content: [
                        oRejectBtn,
                        new ToolbarSpacer(),
                        oEditBtn,
                        oAcceptBtn
                    ]
                })
            });
            
            oPredictionPopover._oInfoText = oInfoText;
            oPredictionPopover._oInput = oInput;
            oPredictionPopover._oEditBtn = oEditBtn;
            oPredictionPopover._oAcceptBtn = oAcceptBtn;
        }

        oPredictionPopover._oInfoText.setText(currentEditContext.tooltipText);

        oPredictionPopover._oInput.setValue(currentEditContext.currentValue);
        oPredictionPopover._oInput.setVisible(false);
        
        oPredictionPopover._oEditBtn.setVisible(true);
        oPredictionPopover._oAcceptBtn.setText('Ok');
        
        oPredictionPopover.openBy(oSource);
    }

    function resetPredictionResults() {
        lastUpdatedRows = null;
        resultTable.removeAllColumns();
        resultTable.unbindItems();
        resultModel.setProperty('/rows', []);
        stateModel.setProperty('/result', {
            ready: false,
            httpStatus: '—',
            mode: 'Čeká na predikci',
            completedAt: '—',
            duration: '—',
            predictions: 0,
            rows: 0,
            targets: 0,
            requestId: '—',
            statusMessage: 'Spusťte mock nebo live predikci. Výsledné řádky se zobrazí zde.',
            messageType: 'Information'
        });
    }

    function downloadUpdatedCsv() {
        if (!csvProfile) {
            MessageToast.show('Nejprve nahrajte soubor a spusťte predikci.');
            return;
        }

        var currentTableRows = resultModel.getProperty('/rows') || [];
        if (!currentTableRows.length) {
            MessageToast.show('Nejsou k dispozici žádná data k uložení.');
            return;
        }

        var headers = csvProfile.headers;
        var delimiter = csvProfile.delimiterRaw;

        var rowsToExport = currentTableRows.map(function (tableRow, rowIndex) {
            var originalRow = csvProfile.rows[rowIndex] || {};
            var updatedRow = Object.assign({}, originalRow);

            headers.forEach(function (header, index) {
                var val = tableRow['c' + index];
                if (val !== undefined) {
                    updatedRow[header] = val;
                }
            });
            return updatedRow;
        });

        var csvText = [headers.map(function (header) {
            return escapeCsvValue(header, delimiter);
        }).join(delimiter)].concat(rowsToExport.map(function (row) {
            return headers.map(function (header) {
                return escapeCsvValue(row[header], delimiter);
            }).join(delimiter);
        })).join('\r\n');

        var blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
        var link = document.createElement('a');
        var originalName = selectedFile ? selectedFile.name.replace(/\.csv$/i, '') : 'export';

        link.href = URL.createObjectURL(blob);
        link.download = originalName + '-reviewed.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
            URL.revokeObjectURL(link.href);
        }, 0);

        log('INFO', 'CSV', 'Revidované CSV s uživatelskými úpravami bylo staženo.', {
            fileName: link.download,
            rows: rowsToExport.length
        });
    }

    function escapeCsvValue(value, delimiter) {
        var textValue = ResultUtils.formatValue(value);
        var mustQuote = textValue.includes(delimiter)
            || textValue.includes('"')
            || /[\r\n]/.test(textValue);
        var escaped = textValue.replace(/"/g, '""');
        return mustQuote ? '"' + escaped + '"' : escaped;
    }

    function firstDefined() {
        for (var index = 0; index < arguments.length; index += 1) {
            if (arguments[index] !== undefined && arguments[index] !== null) {
                return arguments[index];
            }
        }
        return 0;
    }

    async function loadDemoFile() {
        setBusy(true);
        log('INFO', 'CSV', 'Načítám přiložený demo dataset.', {
            url: 'mock/mock_sklad_1000.csv'
        });

        try {
            var response = await fetch('mock/mock_sklad_1000.csv');
            if (!response.ok) {
                throw new Error('Demo CSV vrátilo HTTP ' + response.status);
            }

            var blob = await response.blob();
            var file = new File(
                [blob],
                'mock_sklad_1000.csv',
                { type: 'text/csv' }
            );
            await loadCsvFile(file, 'demo');
        } catch (error) {
            handleUiError('Demo CSV se nepodařilo načíst.', error);
        } finally {
            setBusy(false);
        }
    }

    async function loadCsvFile(file, source) {
        var started = performance.now();

        try {
            if (!/\.csv$/i.test(file.name || '')) {
                throw new Error('Soubor nemá příponu .csv.');
            }

            if (file.size > 10 * 1024 * 1024) {
                throw new Error('Soubor překračuje limit 10 MB.');
            }

            var text = await file.text();
            var delimiter = detectDelimiter(text);
            var matrix = parseCsv(text, delimiter);

            if (matrix.length < 2) {
                throw new Error('CSV neobsahuje hlavičku a datové řádky.');
            }

            selectedFile = file;
            csvProfile = profileCsv(matrix, delimiter);
            updateCsvUi();
            resetPredictionResults();
            updateRequestPreview();
            setCsvReadyStatus();

            log('SUCCESS', 'CSV', 'CSV soubor byl načten a naprofilován.', {
                source: source,
                name: file.name,
                sizeBytes: file.size,
                durationMs: Math.round(performance.now() - started),
                rows: csvProfile.rows.length,
                columns: csvProfile.headers.length,
                delimiter: displayDelimiter(delimiter),
                missingCells: csvProfile.missingCells,
                suggestedIndexColumn: csvProfile.suggestedIndex,
                predictionTargets: csvProfile.predictionTargets,
                predictionCellCount: csvProfile.predictionCellCount
            });
        } catch (error) {
            setStatus('csv', 'Neplatný soubor', 'Error');
            handleUiError('CSV se nepodařilo načíst.', error);
            throw error;
        }
    }

    function updateCsvUi() {
        stateModel.setProperty('/file', {
            loaded: true,
            name: selectedFile.name,
            size: formatBytes(selectedFile.size),
            rows: csvProfile.rows.length,
            columns: csvProfile.headers.length,
            delimiter: displayDelimiter(csvProfile.delimiterRaw),
            missing: csvProfile.missingCells,
            targets: csvProfile.predictionTargets.length,
            predictionCells: csvProfile.predictionCellCount
        });

        indexSelect.removeAllItems();
        csvProfile.headers.forEach(function (header) {
            indexSelect.addItem(new Item({ key: header, text: header }));
        });
        indexSelect.setSelectedKey(csvProfile.suggestedIndex);
        updateTargetSummary();
        rebuildPreviewTable();
    }

    function updateTargetSummary() {
        if (!csvProfile || !csvProfile.predictionTargets.length) {
            detectedTargetsArea.setValue('V souboru nebyly nalezeny žádné prázdné buňky k predikci.');
            return;
        }

        detectedTargetsArea.setValue(csvProfile.predictionTargets.map(function (target) {
            var taskLabel = target.taskType === 'regression' ? 'regrese' : 'klasifikace';
            return target.name + ' · ' + taskLabel + ' · ' + target.predictionCellCount + '× prázdných';
        }).join('\n'));
    }

    function setCsvReadyStatus() {
        if (!csvProfile.predictionTargets.length) {
            setStatus('csv', 'Chybí prázdné buňky', 'Warning');
            return;
        }

        setStatus(
            'csv',
            csvProfile.predictionTargets.length + ' cílů · ' + csvProfile.predictionCellCount + ' prázdných buněk',
            'Success'
        );
    }

    function rebuildPreviewTable() {
        var columns = csvProfile.headers;

        previewTable.removeAllColumns();
        columns.forEach(function (header) {
            previewTable.addColumn(new Column({
                importance: 'High',
                header: new Label({ text: header })
            }));
        });

        var previewSource = csvProfile.rows.slice(0, 5);
        csvProfile.rows.filter(function (row) {
            return csvProfile.predictionTargets.some(function (target) {
                return isPredictionValue(row[target.name]);
            });
        }).forEach(function (row) {
            if (previewSource.length < 10 && !previewSource.includes(row)) {
                previewSource.push(row);
            }
        });
        csvProfile.rows.forEach(function (row) {
            if (previewSource.length < 10 && !previewSource.includes(row)) {
                previewSource.push(row);
            }
        });

        var previewRows = previewSource.map(function (row) {
            var mapped = {};
            columns.forEach(function (header, index) {
                var val = row[header];
                var isPredict = isPredictionValue(val);
                
                mapped['c' + index] = val;
                mapped['s' + index] = isPredict ? 'Success' : 'None';
                mapped['i' + index] = isPredict ? 'sap-icon://pending' : '';
                mapped['t' + index] = isPredict ? 'Detekce chybějící buňky' : '';
            })
            return mapped;
        });

        previewModel.setProperty('/rows', previewRows);
        previewTable.bindItems({
            path: 'preview>/rows',
            template: new ColumnListItem({
                cells: columns.map(function (_header, index) {
                    return new ObjectStatus({
                        text: '{preview>c' + index + '}',
                        state: '{preview>s' + index + '}',
                        icon: '{preview>i' + index + '}',
                        tooltip: '{preview>t' + index + '}'
                    });
                })
            }),
            templateShareable: false
        });
    }

    function updateRequestPreview() {
        var config = getCsvConfig();
        var rows;
        if (csvProfile) {
            var contextRows = csvProfile.rows.filter(function (row) {
                return !config.targets.some(function (target) {
                    return isPredictionValue(row[target.name]);
                });
            }).slice(0, 2);
            var queryRows = csvProfile.rows.filter(function (row) {
                return config.targets.some(function (target) {
                    return isPredictionValue(row[target.name]);
                });
            }).slice(0, 3);
            rows = contextRows.concat(queryRows).map(function (row) {
                return Object.assign({}, row);
            });
        } else {
            rows = [
                { sample_id: 'CTX-001', category: 'A', amount: 10, target_value: 12 },
                { sample_id: 'QUERY-001', category: 'B', amount: 12, target_value: '' }
            ];
        }

        var targetColumns = config.targets.length
            ? config.targets.map(function (target) {
                return {
                    name: target.name,
                    task_type: target.taskType,
                    prediction_placeholder: ''
                };
            })
            : [{
                name: 'target_value',
                task_type: 'regression',
                prediction_placeholder: ''
            }];

        stateModel.setProperty('/requestText', pretty({
            destinationName: 'RPT_Destination',
            method: 'POST',
            url: '/predict',
            headers: {
                'AI-Resource-Group': '<server configuration>',
                'Content-Type': 'application/json'
            },
            body: {
                prediction_config: {
                    target_columns: targetColumns
                },
                index_column: config.indexColumn || 'sample_id',
                rows: rows
            },
            dashboardPreview: csvProfile
                ? 'Zobrazeny jsou nejvýše 2 context a 3 query řádky; server odešle všechny povolené řádky.'
                : 'Ukázkový request bez CSV.'
        }));
    }

    function getCsvConfig() {
        return {
            indexColumn: indexSelect.getSelectedKey(),
            predictionPlaceholder: '',
            targets: csvProfile ? csvProfile.predictionTargets : []
        };
    }

    async function requestAction(actionName, body, label) {
        var url = '/odata/v4/predictor/' + actionName;
        var started = performance.now();
        var safeBody = redactBody(body);

        log('REQUEST', 'HTTP', label + ' — POST ' + url, {
            request: safeBody
        });

        var response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(body || {})
        });
        var duration = Math.round(performance.now() - started);
        var rawText = await response.text();
        var payload = parseJson(rawText) || { value: rawText };

        if (!response.ok) {
            var errorMessage = readODataError(payload)
                || 'HTTP ' + response.status + ' ' + response.statusText;
            log('ERROR', 'HTTP', label + ' selhal.', {
                url: url,
                httpStatus: response.status,
                durationMs: duration,
                response: payload
            });
            throw new Error(errorMessage);
        }

        var value = payload.value !== undefined ? payload.value : payload;
        var parsedValue = typeof value === 'string'
            ? parseJson(value) || value
            : value;

        log('RESPONSE', 'HTTP', label + ' dokončen.', {
            url: url,
            httpStatus: response.status,
            durationMs: duration,
            response: parsedValue
        });

        return parsedValue;
    }

    function log(level, source, message, details) {
        var entry = {
            timestamp: new Date().toISOString(),
            level: level,
            source: source,
            message: message,
            details: details || null
        };
        logEntries.push(entry);
        if (logEntries.length > 500) {
            logEntries.shift();
        }

        stateModel.setProperty('/consoleText', logEntries.map(formatLogEntry).join('\n'));
        window.setTimeout(function () {
            var dom = consoleArea.getDomRef('inner');
            if (dom) {
                dom.scrollTop = dom.scrollHeight;
            }
        }, 0);
    }

    function formatLogEntry(entry) {
        var header = '[' + entry.timestamp + ']'
            + '[' + entry.level.padEnd(8, ' ') + ']'
            + '[' + entry.source + '] '
            + entry.message;

        if (!entry.details) {
            return header;
        }

        return header + '\n' + indent(pretty(entry.details), '    ');
    }

    function clearLogs() {
        logEntries = [];
        stateModel.setProperty('/consoleText', '');
        log('INFO', 'FRONTEND', 'Log byl vyčištěn uživatelem.');
    }

    async function copyLogs() {
        try {
            await navigator.clipboard.writeText(stateModel.getProperty('/consoleText'));
            MessageToast.show('Log byl zkopírován.');
        } catch (error) {
            handleUiError('Log se nepodařilo zkopírovat.', error);
        }
    }

    function downloadLogs() {
        var blob = new Blob(
            [stateModel.getProperty('/consoleText')],
            { type: 'text/plain;charset=utf-8' }
        );
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'rpt-predictor-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log';
        link.click();
        URL.revokeObjectURL(link.href);
        log('INFO', 'FRONTEND', 'Technický log byl stažen.');
    }

    function handleUiError(message, error) {
        log('ERROR', 'FRONTEND', message, {
            name: error.name || 'Error',
            message: error.message || String(error)
        });
        stateModel.setProperty('/responseText', pretty({
            ok: false,
            message: message,
            error: error.message || String(error)
        }));
        MessageToast.show(message + ' Podrobnosti jsou v logu.');
    }

    function setStatus(key, text, state) {
        stateModel.setProperty('/statuses/' + key + '/text', text);
        stateModel.setProperty('/statuses/' + key + '/state', state);
    }

    function setBusy(value) {
        stateModel.setProperty('/busy', Boolean(value));
    }

    function redactBody(body) {
        var copy = Object.assign({}, body || {});
        if (copy.file) {
            copy.file = '<base64 payload: ' + copy.file.length + ' znaků>';
        }
        return copy;
    }

    function readODataError(payload) {
        var message = payload && payload.error && payload.error.message;
        if (message && typeof message === 'object') {
            return message.value;
        }
        return message || null;
    }

    function parseJson(value) {
        try {
            return JSON.parse(value);
        } catch (_error) {
            return null;
        }
    }

    function pretty(value) {
        return JSON.stringify(value, null, 2);
    }

    function indent(value, prefix) {
        return String(value).split('\n').map(function (line) {
            return prefix + line;
        }).join('\n');
    }

    function formatTime(date) {
        return date.toLocaleTimeString('cs-CZ', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function formatBytes(bytes) {
        if (!bytes) {
            return '0 B';
        }

        var units = ['B', 'KB', 'MB', 'GB'];
        var index = Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            units.length - 1
        );
        return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)
            + ' ' + units[index];
    }

    function displayDelimiter(delimiter) {
        return delimiter === '\t' ? 'TAB' : delimiter;
    }

    async function fileToBase64(file) {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var chunkSize = 0x8000;
        var binary = '';

        for (var offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode.apply(
                null,
                bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
            );
        }

        return btoa(binary);
    }

    function detectDelimiter(text) {
        var firstLine = String(text || '')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .find(function (line) { return line.trim(); }) || '';
        var candidates = [',', ';', '\t', '|'];
        var best = ',';
        var bestCount = -1;

        candidates.forEach(function (candidate) {
            var count = 0;
            var quoted = false;

            for (var index = 0; index < firstLine.length; index += 1) {
                if (firstLine[index] === '"') {
                    quoted = !quoted;
                } else if (!quoted && firstLine[index] === candidate) {
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

    function parseCsv(text, delimiter) {
        var rows = [];
        var row = [];
        var field = '';
        var quoted = false;

        for (var index = 0; index < text.length; index += 1) {
            var character = text[index];
            var next = text[index + 1];

            if (character === '"') {
                if (quoted && next === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (character === delimiter && !quoted) {
                row.push(field);
                field = '';
            } else if ((character === '\n' || character === '\r') && !quoted) {
                if (character === '\r' && next === '\n') {
                    index += 1;
                }
                row.push(field);
                if (row.some(function (value) { return value !== ''; })) {
                    rows.push(row);
                }
                row = [];
                field = '';
            } else {
                field += character;
            }
        }

        if (field || row.length) {
            row.push(field);
            rows.push(row);
        }

        return rows;
    }

    function profileCsv(matrix, delimiter) {
        var headers = matrix[0].map(function (header) {
            return String(header || '').replace(/^\uFEFF/, '').trim();
        });
        var rows = matrix.slice(1).map(function (values) {
            var row = {};
            headers.forEach(function (header, index) {
                row[header] = values[index] === undefined ? '' : values[index];
            });
            return row;
        });
        var missingCells = 0;
        var numericColumns = [];

        headers.forEach(function (header) {
            var populated = 0;
            var numeric = 0;

            rows.forEach(function (row) {
                var value = String(row[header] || '').trim();
                if (!value) {
                    missingCells += 1;
                } else {
                    populated += 1;
                    if (Number.isFinite(Number(value.replace(',', '.')))) {
                        numeric += 1;
                    }
                }
            });

            if (populated && numeric / populated >= 0.8) {
                numericColumns.push(header);
            }
        });

        var predictionTargets = detectPredictionTargets(rows);

        return {
            delimiterRaw: delimiter,
            headers: headers,
            rows: rows,
            missingCells: missingCells,
            numericColumns: numericColumns,
            predictionTargets: predictionTargets,
            predictionCellCount: predictionTargets.reduce(function (total, target) {
                return total + target.predictionCellCount;
            }, 0),
            suggestedIndex: headers.find(function (header) {
                return /^id([_-]|$)/i.test(header);
            }) || headers[0] || ''
        };
    }

    function detectPredictionTargets(rows) {
        var headers = Object.keys(rows[0] || {});

        return headers.map(function (header) {
            var values = rows.map(function (row) {
                return String(row[header] === undefined ? '' : row[header]).trim();
            });
            var predictionCellCount = values.filter(function (value) {
                return value === '';
            }).length;
            var knownValues = values.filter(function (value) {
                return value !== '';
            });
            var numericCount = knownValues.filter(function (value) {
                return Number.isFinite(Number(value.replace(',', '.')));
            }).length;

            return {
                name: header,
                taskType: knownValues.length && numericCount / knownValues.length >= 0.8
                    ? 'regression'
                    : 'classification',
                predictionCellCount: predictionCellCount,
                knownValueCount: knownValues.length
            };
        }).filter(function (target) {
            return target.predictionCellCount > 0;
        });
    }

    function isPredictionValue(value) {
        return String(value === undefined || value === null ? '' : value).trim() === '';
    }

    return {};
});