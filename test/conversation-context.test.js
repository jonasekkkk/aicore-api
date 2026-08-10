const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ConversationContextError,
    buildConversationContext,
    estimateTextTokens
} = require("../srv/conversation-context");

function createExchange(number) {
    return [
        {
            role: "USER",
            content: `Question ${number}`
        },
        {
            role: "ASSISTANT",
            content: `Answer ${number}`
        }
    ];
}

test("estimates text tokens conservatively", function () {
    assert.equal(estimateTextTokens("123456"), 2);
    assert.equal(estimateTextTokens("1234567"), 3);
});

test("keeps completed exchanges in chronological order", function () {
    const history = [
        ...createExchange(1),
        ...createExchange(2)
    ];

    const result = buildConversationContext(history, {
        currentPrompt: "Follow-up"
    });

    assert.deepEqual(
        result.messages.map(function (message) {
            return message.content;
        }),
        ["Question 1", "Answer 1", "Question 2", "Answer 2"]
    );
});

test("drops orphaned and incomplete messages", function () {
    const history = [
        { role: "ASSISTANT", content: "Orphan answer" },
        ...createExchange(1),
        { role: "USER", content: "Unanswered question" }
    ];

    const result = buildConversationContext(history, {
        currentPrompt: "New question"
    });

    assert.deepEqual(result.messages, [
        { role: "user", content: "Question 1" },
        { role: "assistant", content: "Answer 1" }
    ]);
    assert.equal(result.droppedMessageCount, 2);
});

test("selects the newest complete exchanges when budget is limited", function () {
    const history = [
        ...createExchange(1),
        ...createExchange(2),
        ...createExchange(3),
        ...createExchange(4)
    ];

    const result = buildConversationContext(history, {
        currentPrompt: "Next",
        limits: {
            workingTokenBudget: 102,
            outputTokenReserve: 10,
            systemTokenReserve: 10,
            groundingTokenReserve: 10,
            maxHistoryTokens: 70
        }
    });

    assert.deepEqual(
        result.messages.map(function (message) {
            return message.content;
        }),
        ["Question 2", "Answer 2", "Question 3", "Answer 3", "Question 4", "Answer 4"]
    );
});

test("reduces history when attachments consume the shared budget", function () {
    const history = [
        ...createExchange(1),
        ...createExchange(2),
        ...createExchange(3)
    ];

    const result = buildConversationContext(history, {
        currentPrompt: "Next",
        attachmentTokens: 25,
        limits: {
            workingTokenBudget: 102,
            outputTokenReserve: 10,
            systemTokenReserve: 10,
            groundingTokenReserve: 10,
            maxHistoryTokens: 70
        }
    });

    assert.deepEqual(
        result.messages.map(function (message) {
            return message.content;
        }),
        ["Question 3", "Answer 3"]
    );
});

test("truncates oversized historical messages", function () {
    const result = buildConversationContext([
        { role: "USER", content: "U".repeat(100) },
        { role: "ASSISTANT", content: "A".repeat(100) }
    ], {
        currentPrompt: "Next",
        limits: {
            maxMessageChars: 50
        }
    });

    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].content.length, 50);
    assert.match(result.messages[0].content, /zkrácena/);
});

test("rejects malformed history and oversized prompts", function () {
    assert.throws(
        function () {
            buildConversationContext("{}", {
                currentPrompt: "Next"
            });
        },
        ConversationContextError
    );

    assert.throws(
        function () {
            buildConversationContext([], {
                currentPrompt: "x".repeat(20),
                limits: {
                    maxPromptTokens: 2
                }
            });
        },
        /Prompt exceeds/
    );
});
