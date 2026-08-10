sap.ui.define([
    "aicore/aicorechat/config/ChatConfig"
], function (ChatConfig) {
    "use strict";

    class AttachmentService {
        async addFiles(fileList, existingAttachments) {
            var existing = Array.isArray(existingAttachments)
                ? existingAttachments
                : [];

            var files = Array.from(fileList || []);
            var acceptedFiles = [];
            var rejected = [];

            var totalSize = existing.reduce(
                function (sum, attachment) {
                    return sum + (
                        Number(attachment.size) || 0
                    );
                },
                0
            );

            files.forEach(function (file) {
                var rejection = this._validateFile(
                    file,
                    existing.length + acceptedFiles.length,
                    totalSize
                );

                if (rejection) {
                    rejected.push({
                        name: file.name,
                        reason: rejection
                    });

                    return;
                }

                acceptedFiles.push(file);
                totalSize += file.size;
            }.bind(this));

            return {
                attachments: await Promise.all(
                    acceptedFiles.map(
                        this._readFile.bind(this)
                    )
                ),
                rejected: rejected
            };
        }

        toDisplayAttachments(attachments) {
            return (attachments || []).map(
                function (attachment) {
                    return {
                        name: attachment.name,
                        mimeType: attachment.mimeType,
                        size: attachment.size
                    };
                }
            );
        }

        _validateFile(file, currentCount, currentTotalSize) {
            if (
                currentCount >=
                ChatConfig.MAX_ATTACHMENT_COUNT
            ) {
                return "Maximum je " +
                    ChatConfig.MAX_ATTACHMENT_COUNT +
                    " příloh.";
            }

            if (
                file.size >
                ChatConfig.MAX_ATTACHMENT_FILE_SIZE
            ) {
                return "Soubor překračuje limit 5 MB.";
            }

            if (
                currentTotalSize + file.size >
                ChatConfig.MAX_ATTACHMENT_TOTAL_SIZE
            ) {
                return "Přílohy dohromady překračují " +
                    "limit 10 MB.";
            }

            return "";
        }

        _readFile(file) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();

                reader.onload = function () {
                    var dataUrl = String(
                        reader.result || ""
                    );

                    var separatorIndex = dataUrl.indexOf(",");

                    if (separatorIndex < 0) {
                        reject(new Error(
                            "Soubor " + file.name +
                            " nelze převést do Base64."
                        ));

                        return;
                    }

                    resolve({
                        name: file.name,
                        mimeType: file.type ||
                            "application/octet-stream",
                        size: file.size,

                        // Store only the Base64 payload, without:
                        // data:<mime-type>;base64,
                        base64: dataUrl.slice(
                            separatorIndex + 1
                        )
                    });
                };

                reader.onerror = function () {
                    reject(new Error(
                        "Soubor " + file.name +
                        " se nepodařilo přečíst."
                    ));
                };

                reader.onabort = function () {
                    reject(new Error(
                        "Čtení souboru " + file.name +
                        " bylo zrušeno."
                    ));
                };

                reader.readAsDataURL(file);
            });
        }
    }

    return AttachmentService;
});