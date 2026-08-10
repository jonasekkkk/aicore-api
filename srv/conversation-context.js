const DEFAULT_LIMITS = Object.freeze({
    workingTokenBudget: 16000,
    outputTokenReserve: 600,
    systemTokenReserve: 800,
    groundingTokenReserve: 3500,
    maxHistoryTokens: 5000,
    maxAttachmentTokens: 6000,
    maxPromptTokens: 4000,
    maxCandidateMessages: 40,
    maxMessageChars: 6000,
    maxSerializedHistoryChars: 250000,
    messageOverheadTokens: 8,
    charsPerToken: 3,
    imageTokenEstimate: 1200
});

class ConversationContextError extends Error {}

function estimateTextTokens(value, limits = DEFAULT_LIMITS) {
    return Math.ceil(
        String(value || "").length /
        limits.charsPerToken
    );
}

function buildConversationContext(serializedHistory, options = {}) {
    const limits = Object.assign(
        {},
        DEFAULT_LIMITS,
        options.limits || {}
    );

    const promptTokens = estimateTextTokens(
        options.currentPrompt,
        limits
    );

    if (promptTokens > limits.maxPromptTokens) {
        throw new ConversationContextError(
            "Prompt exceeds the configured context limit."
        );
    }

    const attachmentTokens = normalizeTokenCount(
        options.attachmentTokens
    );

    const availableTokens = Math.max(
        0,
        limits.workingTokenBudget -
            limits.outputTokenReserve -
            limits.systemTokenReserve -
            limits.groundingTokenReserve -
            promptTokens -
            attachmentTokens
    );

    const historyBudget = Math.min(
        limits.maxHistoryTokens,
        availableTokens
    );

    const parsed = parseHistory(
        serializedHistory,
        limits
    );

    const normalized = normalizeMessages(
        parsed,
        limits
    );

    const exchanges = createCompletedExchanges(
        normalized,
        limits
    );

    const selected = selectRecentExchanges(
        exchanges,
        historyBudget
    );

    const messages = selected.exchanges.flatMap(
        function (exchange) {
            return exchange.messages;
        }
    );

    return {
        messages: messages,
        estimatedTokens: selected.tokens,
        messageCount: messages.length,
        droppedMessageCount: Math.max(
            0,
            parsed.length - messages.length
        ),
        historyBudget: historyBudget,
        promptTokens: promptTokens,
        attachmentTokens: attachmentTokens
    };
}

function parseHistory(serializedHistory, limits) {
    if (!serializedHistory) {
        return [];
    }

    if (Array.isArray(serializedHistory)) {
        return serializedHistory;
    }

    const value = String(serializedHistory);

    if (value.length > limits.maxSerializedHistoryChars) {
        throw new ConversationContextError(
            "Conversation history exceeds the request limit."
        );
    }

    try {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
            throw new Error();
        }

        return parsed;
    } catch (error) {
        throw new ConversationContextError(
            "Conversation history must be a valid JSON array."
        );
    }
}

function normalizeMessages(messages, limits) {
    return messages
        .slice(-limits.maxCandidateMessages)
        .map(function (message) {
            const role = normalizeRole(
                message &&
                (message.role || message.displayRole)
            );

            const content = truncateMessage(
                message && message.content,
                limits.maxMessageChars
            );

            return role && content
                ? { role: role, content: content }
                : null;
        })
        .filter(Boolean);
}

function normalizeRole(value) {
    const role = String(value || "").toUpperCase();

    if (role === "USER") {
        return "user";
    }

    if (role === "ASSISTANT" || role === "MACHINE") {
        return "assistant";
    }

    return "";
}

function truncateMessage(value, maxChars) {
    const content = String(value || "").trim();

    if (content.length <= maxChars) {
        return content;
    }

    const marker = "\n[… starší zpráva byla zkrácena …]\n";

    if (maxChars <= marker.length) {
        return content.slice(0, maxChars);
    }

    const available = Math.max(
        0,
        maxChars - marker.length
    );
    const headLength = Math.ceil(available * 0.75);
    const tailLength = available - headLength;

    return (
        content.slice(0, headLength) +
        marker +
        (
            tailLength > 0
                ? content.slice(-tailLength)
                : ""
        )
    );
}

function createCompletedExchanges(messages, limits) {
    const exchanges = [];
    let pendingUser = null;

    messages.forEach(function (message) {
        if (message.role === "user") {
            pendingUser = message;
            return;
        }

        if (!pendingUser || message.role !== "assistant") {
            return;
        }

        const pair = [pendingUser, message];
        const tokens = pair.reduce(
            function (total, item) {
                return (
                    total +
                    estimateTextTokens(item.content, limits) +
                    limits.messageOverheadTokens
                );
            },
            0
        );

        exchanges.push({
            messages: pair,
            tokens: tokens
        });

        pendingUser = null;
    });

    return exchanges;
}

function selectRecentExchanges(exchanges, tokenBudget) {
    const selected = [];
    let tokens = 0;

    for (let index = exchanges.length - 1; index >= 0; index -= 1) {
        const exchange = exchanges[index];

        if (tokens + exchange.tokens > tokenBudget) {
            break;
        }

        selected.unshift(exchange);
        tokens += exchange.tokens;
    }

    return {
        exchanges: selected,
        tokens: tokens
    };
}

function normalizeTokenCount(value) {
    const count = Number(value);

    return Number.isFinite(count)
        ? Math.max(0, Math.trunc(count))
        : 0;
}

module.exports = {
    ConversationContextError: ConversationContextError,
    DEFAULT_LIMITS: DEFAULT_LIMITS,
    buildConversationContext: buildConversationContext,
    estimateTextTokens: estimateTextTokens
};
