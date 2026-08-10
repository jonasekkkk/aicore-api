const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_ATTACHMENT_COUNT = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS_PER_FILE = 40000;

const IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp"
]);

class AttachmentContextError extends Error {}

async function buildAttachmentContext(serializedAttachments) {
    const attachments = parseAttachments(serializedAttachments);
    const normalized = normalizeAndValidate(attachments);
    const textSections = [];
    const imageParts = [];

    for (const attachment of normalized) {
        if (IMAGE_MIME_TYPES.has(attachment.mimeType)) {
            imageParts.push({
                type: "image_url",
                image_url: {
                    url:
                        `data:${attachment.mimeType};base64,` +
                        attachment.base64
                }
            });

            textSections.push(createImageMarker(attachment));
            continue;
        }

        let extractedText;

        try {
            extractedText = await extractText(attachment);
        } catch (error) {
            throw new AttachmentContextError(
                `${attachment.name} could not be read: ${error.message}`
            );
        }

        textSections.push(
            createTextMarker(attachment, extractedText)
        );
    }

    return {
        attachmentCount: normalized.length,
        imageParts: imageParts,
        textContext: textSections.length > 0
            ? textSections.join("\n\n")
            : "Žádné uživatelské přílohy."
    };
}

function parseAttachments(serializedAttachments) {
    if (!serializedAttachments) {
        return [];
    }

    if (Array.isArray(serializedAttachments)) {
        return serializedAttachments;
    }

    try {
        const parsed = JSON.parse(
            String(serializedAttachments)
        );

        if (!Array.isArray(parsed)) {
            throw new Error();
        }

        return parsed;
    } catch (error) {
        throw new AttachmentContextError(
            "Attachments must be a valid JSON array."
        );
    }
}

function normalizeAndValidate(attachments) {
    if (attachments.length > MAX_ATTACHMENT_COUNT) {
        throw new AttachmentContextError(
            `A maximum of ${MAX_ATTACHMENT_COUNT} attachments is allowed.`
        );
    }

    let totalBytes = 0;

    return attachments.map(function (attachment, index) {
        const name = sanitizeName(
            attachment && attachment.name,
            index
        );

        const mimeType = inferMimeType(
            name,
            sanitizeMimeType(
                attachment && attachment.mimeType
            )
        );

        const base64 = normalizeBase64(
            attachment && attachment.base64,
            name
        );

        const buffer = Buffer.from(base64, "base64");

        if (buffer.length > MAX_FILE_BYTES) {
            throw new AttachmentContextError(
                `${name} exceeds the 5 MB attachment limit.`
            );
        }

        totalBytes += buffer.length;

        if (totalBytes > MAX_TOTAL_BYTES) {
            throw new AttachmentContextError(
                "Attachments exceed the 10 MB total limit."
            );
        }

        return {
            name: name,
            mimeType: mimeType,
            base64: base64,
            buffer: buffer
        };
    });
}

async function extractText(attachment) {
    if (isPdf(attachment)) {
        return extractPdfText(attachment.buffer);
    }

    if (isDocx(attachment)) {
        const result = await mammoth.extractRawText({
            buffer: attachment.buffer
        });

        return truncate(result.value);
    }

    if (isTextLike(attachment)) {
        return truncate(
            attachment.buffer.toString("utf8")
        );
    }

    return (
        "[Binární obsah tohoto formátu nelze převést na text. " +
        "Soubor je označen pouze názvem a MIME typem.]"
    );
}

async function extractPdfText(buffer) {
    const parser = new PDFParse({
        data: buffer
    });

    try {
        const result = await parser.getText();
        return truncate(result.text);
    } finally {
        await parser.destroy();
    }
}

function createImageMarker(attachment) {
    return [
        `[ATTACHMENT name="${attachment.name}"`,
        `mimeType="${attachment.mimeType}" kind="image"]`,
        "Obrazová data jsou přiložena jako samostatný multimodální vstup.",
        "[/ATTACHMENT]"
    ].join("\n");
}

function createTextMarker(attachment, text) {
    return [
        `[ATTACHMENT name="${attachment.name}"`,
        `mimeType="${attachment.mimeType}" kind="document"]`,
        text || "[Soubor neobsahuje čitelný text.]",
        "[/ATTACHMENT]"
    ].join("\n");
}

function isPdf(attachment) {
    return (
        attachment.mimeType === "application/pdf" ||
        attachment.name.toLowerCase().endsWith(".pdf")
    );
}

function isDocx(attachment) {
    return (
        attachment.mimeType ===
            "application/vnd.openxmlformats-officedocument." +
            "wordprocessingml.document" ||
        attachment.name.toLowerCase().endsWith(".docx")
    );
}

function isTextLike(attachment) {
    const supportedMimeTypes = [
        "application/json",
        "application/xml",
        "application/javascript",
        "application/sql"
    ];

    return (
        attachment.mimeType.startsWith("text/") ||
        supportedMimeTypes.includes(attachment.mimeType) ||
        /\.(md|txt|csv|json|xml|yaml|yml|js|ts|css|html|sql)$/i
            .test(attachment.name)
    );
}

function normalizeBase64(value, name) {
    const rawValue = String(value || "");
    const commaIndex = rawValue.indexOf(",");

    const base64 = (
        commaIndex >= 0
            ? rawValue.slice(commaIndex + 1)
            : rawValue
    ).replace(/\s/g, "");

    const isValid =
        base64 &&
        base64.length % 4 === 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(base64);

    if (!isValid) {
        throw new AttachmentContextError(
            `${name} does not contain valid Base64 data.`
        );
    }

    return base64;
}

function sanitizeName(value, index) {
    const fallbackName = `attachment-${index + 1}`;

    const name = String(value || fallbackName)
        .replace(/[\r\n\t]/g, " ")
        .trim();

    return name.slice(0, 255) || fallbackName;
}

function sanitizeMimeType(value) {
    const mimeType = String(
        value || "application/octet-stream"
    )
        .toLowerCase()
        .trim();

    return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)
        ? mimeType
        : "application/octet-stream";
}

function inferMimeType(name, mimeType) {
    if (mimeType !== "application/octet-stream") {
        return mimeType;
    }

    const extension = name
        .toLowerCase()
        .split(".")
        .pop();

    const inferredTypes = {
        csv: "text/csv",
        docx:
            "application/vnd.openxmlformats-officedocument." +
            "wordprocessingml.document",
        gif: "image/gif",
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        json: "application/json",
        md: "text/markdown",
        pdf: "application/pdf",
        png: "image/png",
        txt: "text/plain",
        webp: "image/webp",
        xml: "application/xml"
    };

    return inferredTypes[extension] || mimeType;
}

function truncate(value) {
    const text = String(value || "").trim();

    if (text.length <= MAX_TEXT_CHARS_PER_FILE) {
        return text;
    }

    return (
        text.slice(0, MAX_TEXT_CHARS_PER_FILE) +
        "\n[Obsah přílohy byl zkrácen kvůli limitu kontextu.]"
    );
}

module.exports = {
    AttachmentContextError: AttachmentContextError,
    buildAttachmentContext: buildAttachmentContext
};