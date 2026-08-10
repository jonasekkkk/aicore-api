sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "aicore/aicorechat/model/models",
    "aicore/aicorechat/util/IdGenerator",
    "aicore/aicorechat/service/AIService",
    "aicore/aicorechat/service/AttachmentService",
    "aicore/aicorechat/service/S4HttpClient",
    "aicore/aicorechat/service/S4ChatRepository",
    "aicore/aicorechat/formatter/ChatFormatter"
], function (
    Controller,
    MessageBox,
    MessageToast,
    models,
    IdGenerator,
    AIService,
    AttachmentService,
    S4HttpClient,
    S4ChatRepository,
    ChatFormatter
) {
    "use strict";

    return Controller.extend(
        "aicore.aicorechat.controller.View1",
        {
            onInit: function () {
                this._initializeModels();
                this._initializeServices();

                this._loadHistory().catch(
                    function (error) {
                        console.error(
                            "Loading chat history failed",
                            error
                        );
                    }
                );
            },

            onPostMessage: async function (event) {
                var viewModel =
                    this.getView().getModel("view");

                var prompt =
                    this._getPrompt(
                        event,
                        viewModel
                    );

                var attachments =
                    this._getAttachments(
                        viewModel
                    );

                if (
                    (
                        !prompt &&
                        attachments.length === 0
                    ) ||
                    viewModel.getProperty(
                        "/isBusy"
                    ) ||
                    viewModel.getProperty(
                        "/isReadingAttachments"
                    )
                ) {
                    return;
                }

                var isFirstExchange =
                    this._isFirstExchange();

                var submittedPrompt =
                    prompt ||
                    "Analyzuj prosím přiložené soubory.";

                viewModel.setProperty(
                    "/prompt",
                    ""
                );

                viewModel.setProperty(
                    "/attachments",
                    []
                );

                this._setBusy(true);

                this._addMessage(
                    "user",
                    submittedPrompt,
                    attachments
                );

                var aiResult;

                try {
                    aiResult =
                        await this
                            ._aiService
                            .ask(
                                submittedPrompt,
                                attachments
                            );

                    this._addMessage(
                        "machine",
                        aiResult.reply
                    );
                } catch (error) {
                    console.error(
                        "AI request failed",
                        error
                    );

                    MessageBox.error(
                        error.message ||
                        "AI odpověď se nepodařilo načíst."
                    );
                } finally {
                    this._setBusy(false);
                    this._scrollToBottom();
                }

                if (aiResult) {
                    this
                        ._saveExchangeInBackground(
                            {
                                prompt:
                                    submittedPrompt,
                                reply:
                                    aiResult.reply,
                                promptTokens:
                                    aiResult
                                        .promptTokens,
                                completionTokens:
                                    aiResult
                                        .completionTokens
                            },
                            isFirstExchange
                        );
                }
            },

            onFilesSelected:
                async function (event) {
                    var uploader =
                        event.getSource();

                    var files =
                        event.getParameter(
                            "files"
                        );

                    var viewModel =
                        this.getView()
                            .getModel("view");

                    if (
                        !files ||
                        files.length === 0
                    ) {
                        return;
                    }

                    viewModel.setProperty(
                        "/isReadingAttachments",
                        true
                    );

                    try {
                        var existing =
                            this._getAttachments(
                                viewModel
                            );

                        var result =
                            await this
                                ._attachmentService
                                .addFiles(
                                    files,
                                    existing
                                );

                        viewModel.setProperty(
                            "/attachments",
                            existing.concat(
                                result.attachments
                            )
                        );

                        if (
                            result.attachments
                                .length > 0
                        ) {
                            MessageToast.show(
                                result.attachments
                                    .length === 1
                                    ? "Příloha byla přidána."
                                    : result.attachments
                                        .length +
                                        " příloh bylo přidáno."
                            );
                        }

                        if (
                            result.rejected
                                .length > 0
                        ) {
                            MessageBox.warning(
                                result.rejected
                                    .map(
                                        function (
                                            item
                                        ) {
                                            return (
                                                item.name +
                                                ": " +
                                                item.reason
                                            );
                                        }
                                    )
                                    .join("\n")
                            );
                        }
                    } catch (error) {
                        console.error(
                            "Reading attachments failed",
                            error
                        );

                        MessageBox.error(
                            error.message
                        );
                    } finally {
                        viewModel.setProperty(
                            "/isReadingAttachments",
                            false
                        );

                        uploader.clear();
                    }
                },

            onRemoveAttachment:
                function (event) {
                    var context =
                        event
                            .getSource()
                            .getBindingContext(
                                "view"
                            );

                    if (!context) {
                        return;
                    }

                    var index = Number(
                        context
                            .getPath()
                            .split("/")
                            .pop()
                    );

                    var viewModel =
                        this.getView()
                            .getModel("view");

                    var attachments =
                        this._getAttachments(
                            viewModel
                        );

                    attachments.splice(
                        index,
                        1
                    );

                    viewModel.setProperty(
                        "/attachments",
                        attachments
                    );
                },

            formatFileSize:
                function (bytes) {
                    var size =
                        Number(bytes) || 0;

                    if (size < 1024) {
                        return size + " B";
                    }

                    if (
                        size <
                        1024 * 1024
                    ) {
                        return (
                            (
                                size /
                                1024
                            ).toFixed(1) +
                            " KB"
                        );
                    }

                    return (
                        (
                            size /
                            (
                                1024 *
                                1024
                            )
                        ).toFixed(1) +
                        " MB"
                    );
                },

            onNewChat: function () {
                this._chatRepository
                    .startNewSession();

                this.getView()
                    .getModel("chat")
                    .setProperty(
                        "/ChatMessages",
                        []
                    );

                this.getView()
                    .getModel("view")
                    .setProperty(
                        "/prompt",
                        ""
                    );

                this.getView()
                    .getModel("view")
                    .setProperty(
                        "/attachments",
                        []
                    );

                this.byId(
                    "chatInput"
                ).focus();
            },

            onOpenChat:
                async function (event) {
                    var context =
                        event
                            .getSource()
                            .getBindingContext(
                                "history"
                            );

                    if (!context) {
                        return;
                    }

                    this._setBusy(true);

                    try {
                        var session =
                            context.getObject();

                        var messages =
                            await this
                                ._chatRepository
                                .loadMessages(
                                    session.path
                                );

                        this._chatRepository
                            .setActiveSession(
                                session.sessionID
                            );

                        this.getView()
                            .getModel("chat")
                            .setProperty(
                                "/ChatMessages",
                                messages
                            );

                        this.getView()
                            .getModel("view")
                            .setProperty(
                                "/attachments",
                                []
                            );

                        this._scrollToBottom();
                    } catch (error) {
                        console.error(
                            "Loading chat failed",
                            error
                        );

                        MessageBox.error(
                            "Uložený chat se " +
                            "nepodařilo načíst."
                        );
                    } finally {
                        this._setBusy(false);
                    }
                },

            onMessagesRendered:
                function () {
                    this._scrollToBottom();
                },

            onAmongUsPress:
                function () {
                    MessageToast.show(
                        "Emergency meeting " +
                        "vyvolán! 🚨 " +
                        "Všichni do konference."
                    );
                },

            formatMarkdown:
                ChatFormatter.formatMarkdown,

            _initializeModels:
                function () {
                    var view =
                        this.getView();

                    view.setModel(
                        models
                            .createViewModel(),
                        "view"
                    );

                    view.setModel(
                        models
                            .createChatModel(),
                        "chat"
                    );

                    view.setModel(
                        models
                            .createHistoryModel(),
                        "history"
                    );
                },

            _initializeServices:
                function () {
                    var odataModel =
                        this
                            .getOwnerComponent()
                            .getModel();

                    var idGenerator =
                        new IdGenerator();

                    var httpClient =
                        new S4HttpClient();

                    this._aiService =
                        new AIService();

                    this._attachmentService =
                        new AttachmentService();

                    this._chatRepository =
                        new S4ChatRepository(
                            odataModel,
                            httpClient,
                            idGenerator
                        );
                },

            _getPrompt: function (
                event,
                viewModel
            ) {
                return String(
                    event.getParameter(
                        "value"
                    ) ||
                    viewModel.getProperty(
                        "/prompt"
                    ) ||
                    ""
                ).trim();
            },

            _getAttachments:
                function (viewModel) {
                    var attachments =
                        viewModel.getProperty(
                            "/attachments"
                        );

                    return Array.isArray(
                        attachments
                    )
                        ? attachments.slice()
                        : [];
                },

            _setBusy:
                function (isBusy) {
                    this.getView()
                        .getModel("view")
                        .setProperty(
                            "/isBusy",
                            isBusy
                        );
                },

            _loadHistory:
                async function () {
                    var sessions =
                        await this
                            ._chatRepository
                            .loadHistory();

                    this.getView()
                        .getModel("history")
                        .setProperty(
                            "/sessions",
                            sessions
                        );
                },

            _isFirstExchange:
                function () {
                    var messages =
                        this.getView()
                            .getModel("chat")
                            .getProperty(
                                "/ChatMessages"
                            ) ||
                        [];

                    var hasAssistantMessage =
                        messages.some(
                            function (
                                message
                            ) {
                                return (
                                    message
                                        .displayRole ===
                                    "machine"
                                );
                            }
                        );

                    return (
                        !this
                            ._chatRepository
                            .getActiveSessionId() &&
                        !hasAssistantMessage
                    );
                },

            _saveExchangeInBackground:
                function (
                    exchange,
                    shouldGenerateTitle
                ) {
                    this._persistExchange(
                        exchange,
                        shouldGenerateTitle
                    ).catch(
                        function (error) {
                            console.error(
                                "Unexpected background " +
                                "persistence failure",
                                error
                            );
                        }
                    );
                },

            _persistExchange:
                async function (
                    exchange,
                    shouldGenerateTitle
                ) {
                    var titlePromise =
                        shouldGenerateTitle
                            ? this
                                ._generateTitleSafely(
                                    exchange
                                )
                            : Promise.resolve(
                                ""
                            );

                    var sessionId;

                    try {
                        sessionId =
                            await this
                                ._chatRepository
                                .queueExchange(
                                    exchange
                                );
                    } catch (error) {
                        console.error(
                            "Saving messages " +
                            "to S4 failed",
                            error
                        );

                        MessageBox.warning(
                            "Odpověď byla přijata, " +
                            "ale uložení zpráv " +
                            "selhalo. " +
                            (
                                error.message ||
                                "Neznámá chyba."
                            )
                        );

                        return;
                    }

                    var title =
                        await titlePromise;

                    if (title) {
                        await this
                            ._saveTitleSafely(
                                sessionId,
                                title
                            );
                    }

                    try {
                        await this
                            ._loadHistory();
                    } catch (error) {
                        console.error(
                            "Reloading chat " +
                            "history failed",
                            error
                        );
                    }
                },

            _generateTitleSafely:
                async function (
                    exchange
                ) {
                    try {
                        return await this
                            ._aiService
                            .generateTitle(
                                exchange.prompt,
                                exchange.reply
                            );
                    } catch (error) {
                        console.error(
                            "Generating chat " +
                            "title failed",
                            error
                        );

                        return "";
                    }
                },

            _saveTitleSafely:
                async function (
                    sessionId,
                    title
                ) {
                    try {
                        await this
                            ._chatRepository
                            .updateSessionTitle(
                                sessionId,
                                title
                            );
                    } catch (error) {
                        console.error(
                            "Saving chat title " +
                            "to S4 failed",
                            error
                        );

                        MessageToast.show(
                            "Konverzace byla " +
                            "uložena, ale název " +
                            "se nepodařilo uložit."
                        );
                    }
                },

            _addMessage: function (
                displayRole,
                content,
                attachments
            ) {
                var chatModel =
                    this.getView()
                        .getModel("chat");

                var messages =
                    chatModel
                        .getProperty(
                            "/ChatMessages"
                        )
                        .slice();

                messages.push({
                    displayRole:
                        displayRole,
                    content:
                        content,
                    attachments:
                        this
                            ._attachmentService
                            .toDisplayAttachments(
                                attachments
                            ),
                    timestamp:
                        new Date()
                            .toLocaleTimeString(
                                "cs-CZ",
                                {
                                    hour:
                                        "2-digit",
                                    minute:
                                        "2-digit"
                                }
                            )
                });

                chatModel.setProperty(
                    "/ChatMessages",
                    messages
                );

                this._scrollToBottom(
                    true
                );
            },

            _scrollToBottom:
                function (smooth) {
                    setTimeout(
                        function () {
                            var scrollContainer =
                                this.byId(
                                    "chatScrollContainer"
                                );

                            var root =
                                scrollContainer &&
                                scrollContainer
                                    .getDomRef();

                            var viewport =
                                root &&
                                root.querySelector(
                                    ".sapMScrollContScroll"
                                );

                            if (viewport) {
                                viewport.scrollTo({
                                    top:
                                        viewport
                                            .scrollHeight,
                                    behavior:
                                        smooth
                                            ? "smooth"
                                            : "auto"
                                });
                            }
                        }.bind(this)
                    );
                }
        }
    );
});