const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildAttachmentContext
} = require("../srv/attachment-context");

function createTextAttachment(name, content) {
    return {
        name: name,
        mimeType: "text/plain",
        base64: Buffer.from(content).toString("base64")
    };
}

test("shares the attachment budget across text files", async function () {
    const context = await buildAttachmentContext([
        createTextAttachment("first.txt", "A".repeat(1000)),
        createTextAttachment("second.txt", "B".repeat(1000))
    ], {
        maxTokens: 200
    });

    assert.equal(context.attachmentCount, 2);
    assert.match(context.textContext, /first\.txt/);
    assert.match(context.textContext, /second\.txt/);
    assert.match(context.textContext, /zkrácen/);
    assert.ok(context.estimatedTokens <= 205);
});

test("accounts for images with a fixed token estimate", async function () {
    const context = await buildAttachmentContext([
        {
            name: "diagram.png",
            mimeType: "image/png",
            base64: Buffer.from("image-data").toString("base64")
        }
    ], {
        maxTokens: 2000,
        imageTokenEstimate: 900
    });

    assert.equal(context.imageParts.length, 1);
    assert.equal(context.estimatedTokens, 900);
});
