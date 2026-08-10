sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "aicore/aicorechat/config/ChatConfig"
], function (
    Filter,
    FilterOperator,
    Sorter,
    ChatConfig
) {
    "use strict";

    class S4ChatRepository {
        constructor(
            odataModel,
            httpClient,
            idGenerator
        ) {
            if (
                !odataModel ||
                !httpClient ||
                !idGenerator
            ) {
                throw new Error(
                    "S4ChatRepository requires an " +
                    "OData model, HTTP client and " +
                    "ID generator."
                );
            }

            this._odataModel =
                odataModel;

            this._httpClient =
                httpClient;

            this._saveQueue =
                Promise.resolve();

            this._activeConversation = {
                sessionId: null
            };

            this._ownerId =
                idGenerator
                    .getOrCreateStoredUuid(
                        ChatConfig
                            .DEVELOPMENT_OWNER_STORAGE_KEY
                    );
        }

        getOwnerId() {
            return this._ownerId;
        }

        getActiveSessionId() {
            return this
                ._activeConversation
                .sessionId;
        }

        startNewSession() {
            this._activeConversation = {
                sessionId: null
            };
        }

        setActiveSession(sessionId) {
            if (!sessionId) {
                throw new Error(
                    "A database-generated " +
                    "session ID is required."
                );
            }

            this._activeConversation = {
                sessionId:
                    String(sessionId)
            };
        }

        async loadHistory() {
            var binding =
                this._odataModel.bindList(
                    "/" +
                    ChatConfig
                        .CHAT_SESSION_ENTITY_SET,
                    null,
                    [
                        new Sorter(
                            "lastMessageAt",
                            true
                        )
                    ],
                    [
                        new Filter(
                            "ownerID",
                            FilterOperator.EQ,
                            this._ownerId
                        ),
                        new Filter(
                            "status",
                            FilterOperator.NE,
                            ChatConfig
                                .SESSION_STATUS_DELETED
                        )
                    ],
                    {
                        "$select":
                            "sessionID,title," +
                            "lastMessageAt,status"
                    }
                );

            var contexts =
                await binding.requestContexts(
                    0,
                    ChatConfig
                        .HISTORY_REQUEST_LIMIT
                );

            return contexts
                .map(
                    this._mapSession.bind(this)
                )
                .filter(function (session) {
                    return (
                        session.status !==
                        ChatConfig
                            .SESSION_STATUS_DELETED
                    );
                });
        }

        async loadMessages(sessionPath) {
            if (!sessionPath) {
                throw new Error(
                    "A session path is required."
                );
            }

            var sessionBinding =
                this._odataModel.bindContext(
                    sessionPath
                );

            var sessionContext =
                sessionBinding
                    .getBoundContext();

            await sessionContext
                .requestObject();

            var messageBinding =
                this._odataModel.bindList(
                    ChatConfig
                        .MESSAGES_NAVIGATION_PROPERTY,
                    sessionContext
                );

            var contexts =
                await messageBinding
                    .requestContexts(
                        0,
                        ChatConfig
                            .MESSAGE_REQUEST_LIMIT
                    );

            return contexts.map(
                this._mapMessage
            );
        }

        queueExchange(exchange) {
            var conversation =
                this._activeConversation;

            var operation =
                this._saveQueue
                    .catch(function () {
                        // A failed save must not
                        // block later messages.
                    })
                    .then(
                        function () {
                            return this
                                ._saveExchange(
                                    exchange,
                                    conversation
                                );
                        }.bind(this)
                    );

            this._saveQueue =
                operation.catch(function () {
                    // Keep the internal queue
                    // operational.
                });

            return operation;
        }

        async updateSessionTitle(
            sessionId,
            title
        ) {
            if (!sessionId) {
                throw new Error(
                    "A database-generated " +
                    "session ID is required."
                );
            }

            var normalizedTitle =
                String(title || "")
                    .replace(/\s+/g, " ")
                    .trim();

            if (!normalizedTitle) {
                throw new Error(
                    "A non-empty chat title " +
                    "is required."
                );
            }

            normalizedTitle =
                Array.from(
                    normalizedTitle
                )
                    .slice(
                        0,
                        ChatConfig
                            .MAX_CHAT_TITLE_LENGTH
                    )
                    .join("")
                    .trim();

            await this._httpClient.patch(
                this._buildSessionPath(
                    sessionId
                ),
                {
                    title:
                        normalizedTitle
                }
            );

            return normalizedTitle;
        }

        async markSessionDeleted(
            sessionId
        ) {
            if (!sessionId) {
                throw new Error(
                    "A database-generated " +
                    "session ID is required."
                );
            }

            var normalizedSessionId =
                String(sessionId);

            var wasActive =
                this.getActiveSessionId() ===
                normalizedSessionId;

            await this._httpClient.patch(
                this._buildSessionPath(
                    normalizedSessionId
                ),
                {
                    status:
                        ChatConfig
                            .SESSION_STATUS_DELETED
                }
            );

            if (wasActive) {
                this.startNewSession();
            }

            return wasActive;
        }

        async _saveExchange(
            exchange,
            conversation
        ) {
            if (!conversation.sessionId) {
                conversation.sessionId =
                    await this
                        ._createSession();
            }

            var messagePath =
                this._buildMessagePath(
                    conversation.sessionId
                );

            await this._httpClient.post(
                messagePath,
                this._createMessagePayload({
                    role:
                        ChatConfig.ROLE_USER,
                    content:
                        exchange.prompt,
                    promptTokens:
                        exchange.promptTokens,
                    completionTokens:
                        0
                })
            );

            await this._httpClient.post(
                messagePath,
                this._createMessagePayload({
                    role:
                        ChatConfig
                            .ROLE_ASSISTANT,
                    content:
                        exchange.reply,
                    promptTokens:
                        0,
                    completionTokens:
                        exchange
                            .completionTokens
                })
            );

            return conversation.sessionId;
        }

        async _createSession() {
            var createdSession =
                await this._httpClient.post(
                    ChatConfig
                        .CHAT_SESSION_ENTITY_SET,
                    {
                        ownerID:
                            this._ownerId,
                        lastMessageAt:
                            this._formatTimestamp(
                                new Date()
                            ),
                        status:
                            ChatConfig
                                .SESSION_STATUS_ACTIVE
                    }
                );

            var sessionId =
                this._readGeneratedSessionId(
                    createdSession
                );

            if (!sessionId) {
                throw new Error(
                    "S4 created a session but " +
                    "did not return sessionID."
                );
            }

            return sessionId;
        }

        _createMessagePayload(message) {
            return {
                role:
                    message.role,
                content:
                    String(
                        message.content ||
                        ""
                    ),
                promptTokens:
                    this._normalizeTokenCount(
                        message.promptTokens
                    ),
                completionTokens:
                    this._normalizeTokenCount(
                        message
                            .completionTokens
                    )
            };
        }

        _readGeneratedSessionId(
            payload
        ) {
            var entity =
                payload &&
                (
                    payload.value ||
                    payload.d ||
                    payload
                );

            if (
                entity &&
                entity.sessionID
            ) {
                return String(
                    entity.sessionID
                );
            }

            var entityUrl =
                entity &&
                (
                    entity["@odata.id"] ||
                    entity[
                        "@odata.editLink"
                    ]
                );

            var match =
                entityUrl &&
                /ChatSession\((?:'([^']+)'|([^,)]+))\)/
                    .exec(entityUrl);

            if (!match) {
                return "";
            }

            return decodeURIComponent(
                match[1] ||
                match[2]
            )
                .replace(
                    /^guid'/,
                    ""
                )
                .replace(
                    /'$/,
                    ""
                );
        }

        _buildMessagePath(sessionId) {
            return (
                this._buildSessionPath(
                    sessionId
                ) +
                "/" +
                ChatConfig
                    .MESSAGES_NAVIGATION_PROPERTY
            );
        }

        _buildSessionPath(sessionId) {
            return (
                ChatConfig
                    .CHAT_SESSION_ENTITY_SET +
                "(" +
                String(sessionId) +
                ")"
            );
        }

        _formatTimestamp(date) {
            return date
                .toISOString()
                .replace(
                    /\.\d{3}Z$/,
                    "Z"
                );
        }

        _mapSession(context, index) {
            var session =
                context.getObject();

            var storedTitle =
                String(
                    session.title ||
                    ""
                ).trim();

            var date =
                session.lastMessageAt
                    ? new Date(
                        session.lastMessageAt
                    )
                    : null;

            var hasValidDate =
                date &&
                !Number.isNaN(
                    date.getTime()
                );

            return {
                path:
                    context.getPath(),
                sessionID:
                    session.sessionID,
                title:
                    storedTitle ||
                    "Konverzace " +
                    (
                        hasValidDate
                            ? date
                                .toLocaleString(
                                    "cs-CZ"
                                )
                            : "bez data"
                    ),
                tooltip:
                    "Otevřít konverzaci " +
                    (index + 1),
                status:
                    session.status
            };
        }

        _mapMessage(context) {
            var message =
                context.getObject();

            return {
                displayRole:
                    message.role ===
                    ChatConfig.ROLE_USER
                        ? "user"
                        : "machine",
                content:
                    message.content,
                timestamp:
                    ""
            };
        }

        _normalizeTokenCount(value) {
            var count =
                Number(value);

            return Number.isFinite(count)
                ? Math.max(
                    0,
                    Math.trunc(count)
                )
                : 0;
        }
    }

    return S4ChatRepository;
});