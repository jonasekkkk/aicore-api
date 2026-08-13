sap.ui.define([
    "aicore/aicorechat/config/ChatConfig"
], function (ChatConfig) {
    "use strict";

    class AIService {
        constructor(fetchFunction) {
            this._fetch =
                fetchFunction ||
                window.fetch.bind(window);
        }

        async ask(prompt, attachments, history) {
            var normalizedPrompt =
                String(prompt || "").trim();

            var normalizedAttachments =
                this._normalizeAttachments(
                    attachments
                );

            var normalizedHistory =
                this._normalizeHistory(
                    history
                );

            if (
                !normalizedPrompt &&
                normalizedAttachments.length === 0
            ) {
                throw new Error(
                    "Prompt or attachment is required."
                );
            }

            var response = await this._fetch(
                ChatConfig.AI_ACTION_URL,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        prompt:
                            normalizedPrompt,
                        attachments:
                            JSON.stringify(
                                normalizedAttachments
                            ),
                        history:
                            JSON.stringify(
                                normalizedHistory
                            )
                    })
                }
            );

            var payload =
                await this._readPayload(response);

            if (!response.ok) {
                throw new Error(
                    this._getErrorMessage(
                        payload,
                        response.status
                    )
                );
            }

            return this._normalizeResult(
                payload
            );
        }

        async generateTitle(
            prompt,
            reply
        ) {
            var normalizedPrompt =
                String(prompt || "").trim();

            var normalizedReply =
                String(reply || "").trim();

            if (
                !normalizedPrompt ||
                !normalizedReply
            ) {
                throw new Error(
                    "Prompt and reply are required " +
                    "to generate a title."
                );
            }

            var response = await this._fetch(
                ChatConfig.AI_TITLE_ACTION_URL,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        prompt:
                            normalizedPrompt,
                        reply:
                            normalizedReply
                    })
                }
            );

            var payload =
                await this._readPayload(response);

            if (!response.ok) {
                throw new Error(
                    this._getErrorMessage(
                        payload,
                        response.status
                    )
                );
            }

            return this._normalizeTitle(
                payload
            );
        }

        _normalizeAttachments(
            attachments
        ) {
            if (!Array.isArray(attachments)) {
                return [];
            }

            return attachments.map(
                function (attachment) {
                    return {
                        name: String(
                            attachment.name ||
                            "attachment"
                        ),
                        mimeType: String(
                            attachment.mimeType ||
                            "application/octet-stream"
                        ),
                        size:
                            Number(
                                attachment.size
                            ) || 0,
                        base64: String(
                            attachment.base64 ||
                            ""
                        )
                    };
                }
            );
        }

        _normalizeHistory(history) {
            if (!Array.isArray(history)) {
                return [];
            }

            return history
                .slice(
                    -ChatConfig
                        .MAX_CONTEXT_CANDIDATE_MESSAGES
                )
                .map(function (message) {
                    var role = String(
                        message.role ||
                        message.displayRole ||
                        ""
                    ).toUpperCase();

                    if (role === "MACHINE") {
                        role = ChatConfig
                            .ROLE_ASSISTANT;
                    }

                    if (
                        role !== ChatConfig.ROLE_USER &&
                        role !== ChatConfig.ROLE_ASSISTANT
                    ) {
                        return null;
                    }

                    var content = String(
                        message.content || ""
                    ).trim();

                    return content
                        ? {
                            role: role,
                            content: content
                        }
                        : null;
                })
                .filter(Boolean);
        }

        async _readPayload(response) {
            var text =
                await response.text();

            if (!text) {
                return {};
            }

            try {
                return JSON.parse(text);
            } catch (error) {
                return {
                    value: text
                };
            }
        }

        _normalizeResult(payload) {
            var result =
                payload.value !== undefined
                    ? payload.value
                    : payload;

            var reply =
                typeof result === "string"
                    ? result
                    : result && result.reply;

            if (!reply) {
                throw new Error(
                    "AI služba nevrátila text odpovědi."
                );
            }

            return {
                reply:
                    reply,
                promptTokens:
                    this._normalizeTokenCount(
                        result.promptTokens
                    ),
                completionTokens:
                    this._normalizeTokenCount(
                        result.completionTokens
                    ),
                contextMessagesUsed:
                    this._normalizeTokenCount(
                        result.contextMessagesUsed
                    ),
                contextMessagesDropped:
                    this._normalizeTokenCount(
                        result.contextMessagesDropped
                    ),
                estimatedContextTokens:
                    this._normalizeTokenCount(
                        result.estimatedContextTokens
                    )
            };
        }

        _normalizeTitle(payload) {
            var result =
                payload.value !== undefined
                    ? payload.value
                    : payload;

            var title =
                typeof result === "string"
                    ? result
                    : result && result.title;

            title = String(title || "")
                .replace(/\s+/g, " ")
                .trim();

            if (!title) {
                throw new Error(
                    "AI služba nevrátila " +
                    "název konverzace."
                );
            }

            return Array.from(title)
                .slice(
                    0,
                    ChatConfig
                        .MAX_CHAT_TITLE_LENGTH
                )
                .join("")
                .trim();
        }

        _normalizeTokenCount(value) {
            var count = Number(value);

            return Number.isFinite(count)
                ? Math.max(
                    0,
                    Math.trunc(count)
                )
                : 0;
        }

        _getErrorMessage(
            payload,
            status
        ) {
            var message =
                payload.error &&
                payload.error.message;

            if (
                message &&
                typeof message === "object"
            ) {
                message = message.value;
            }

            return (
                message ||
                payload.message ||
                "AI služba vrátila chybu " +
                    status +
                    "."
            );
        }
    }

    return AIService;
});
