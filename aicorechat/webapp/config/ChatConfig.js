sap.ui.define([], function () {
    "use strict";

    return Object.freeze({
        AI_ACTION_URL:
            "/ai-core/askAI",

        AI_TITLE_ACTION_URL:
            "/ai-core/generateChatTitle",

        S4_SERVICE_ROOT:
            "/sap/opu/odata4/sap/zui_chat_04/" +
            "srvd_a2x/sap/zui_chat/0001/",

        CHAT_SESSION_ENTITY_SET:
            "ChatSession",

        MESSAGES_NAVIGATION_PROPERTY:
            "_Messages",

        SESSION_STATUS_ACTIVE:
            "ACTIVE",

        SESSION_STATUS_DELETED:
            "DELETED",

        SESSION_DELETE_CONFIRMATION_SECONDS:
            3,

        DEVELOPMENT_OWNER_STORAGE_KEY:
            "aicore.dev.ownerID",

        MAX_ATTACHMENT_COUNT:
            5,

        MAX_ATTACHMENT_FILE_SIZE:
            5 * 1024 * 1024,

        MAX_ATTACHMENT_TOTAL_SIZE:
            10 * 1024 * 1024,

        MAX_CHAT_TITLE_LENGTH:
            100,

        MAX_CONTEXT_CANDIDATE_MESSAGES:
            40,

        ROLE_USER:
            "USER",

        ROLE_ASSISTANT:
            "ASSISTANT",

        HISTORY_REQUEST_LIMIT:
            100,

        MESSAGE_REQUEST_LIMIT:
            1000
    });
});
