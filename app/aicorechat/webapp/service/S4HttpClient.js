sap.ui.define([
    "aicore/aicorechat/config/ChatConfig"
], function (ChatConfig) {
    "use strict";

    class S4HttpClient {
        constructor(
            fetchFunction,
            serviceRoot
        ) {
            this._fetch =
                fetchFunction ||
                window.fetch.bind(window);

            this._serviceRoot =
                this._normalizeServiceRoot(
                    serviceRoot ||
                    ChatConfig.S4_SERVICE_ROOT
                );

            this._csrfToken = null;
        }

        post(relativePath, payload) {
            return this._send(
                relativePath,
                "POST",
                payload,
                false
            );
        }

        patch(relativePath, payload) {
            return this._send(
                relativePath,
                "PATCH",
                payload,
                false
            );
        }

        clearCsrfToken() {
            this._csrfToken = null;
        }

        async _send(
            relativePath,
            method,
            payload,
            retried
        ) {
            var headers = {
                "Accept":
                    "application/json",
                "Content-Type":
                    "application/json",
                "Prefer":
                    "return=representation",
                "X-CSRF-Token":
                    await this
                        ._getCsrfToken()
            };

            if (method === "PATCH") {
                /*
                 * S4 requires conditional updates
                 * for ChatSession entities.
                 */
                headers["If-Match"] = "*";
            }

            var response =
                await this._fetch(
                    this._buildUrl(
                        relativePath
                    ),
                    {
                        method:
                            method,
                        credentials:
                            "same-origin",
                        headers:
                            headers,
                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

            if (
                response.status === 403 &&
                !retried
            ) {
                this.clearCsrfToken();

                return this._send(
                    relativePath,
                    method,
                    payload,
                    true
                );
            }

            if (!response.ok) {
                throw await this
                    ._createError(
                        response
                    );
            }

            return this
                ._readSuccessPayload(
                    response
                );
        }

        async _getCsrfToken() {
            if (this._csrfToken) {
                return this._csrfToken;
            }

            var response =
                await this._fetch(
                    this._buildUrl(
                        "$metadata"
                    ),
                    {
                        credentials:
                            "same-origin",
                        headers: {
                            "X-CSRF-Token":
                                "Fetch"
                        }
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "S4 metadata/CSRF " +
                    "request failed: HTTP " +
                    response.status
                );
            }

            this._csrfToken =
                response.headers.get(
                    "x-csrf-token"
                );

            if (!this._csrfToken) {
                throw new Error(
                    "S4 did not return " +
                    "a CSRF token."
                );
            }

            return this._csrfToken;
        }

        async _readSuccessPayload(
            response
        ) {
            var payload =
                await this._readPayload(
                    response
                );

            var location =
                response.headers.get(
                    "location"
                );

            if (
                payload &&
                typeof payload === "object"
            ) {
                if (
                    location &&
                    !payload["@odata.id"]
                ) {
                    payload["@odata.id"] =
                        location;
                }

                return payload;
            }

            return location
                ? {
                    "@odata.id":
                        location
                }
                : payload;
        }

        async _createError(response) {
            var payload =
                await this._readPayload(
                    response
                ) ||
                {};

            var message =
                payload.error &&
                payload.error.message;

            if (
                message &&
                typeof message === "object"
            ) {
                message =
                    message.value;
            }

            var error = new Error(
                "S4 HTTP " +
                response.status +
                ": " +
                (
                    message ||
                    payload.message ||
                    payload.raw ||
                    "Unknown error"
                )
            );

            error.status =
                response.status;

            error.payload =
                payload;

            return error;
        }

        async _readPayload(response) {
            var text =
                await response.text();

            if (!text) {
                return null;
            }

            try {
                return JSON.parse(text);
            } catch (error) {
                return {
                    raw: text
                };
            }
        }

        _buildUrl(relativePath) {
            return (
                this._serviceRoot +
                String(relativePath)
                    .replace(
                        /^\/+/,
                        ""
                    )
            );
        }

        _normalizeServiceRoot(
            serviceRoot
        ) {
            return (
                String(serviceRoot)
                    .replace(
                        /\/+$/,
                        ""
                    ) +
                "/"
            );
        }
    }

    return S4HttpClient;
});