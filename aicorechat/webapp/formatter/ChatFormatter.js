sap.ui.define([], function () {
    "use strict";

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /**
     * Converts the supported Markdown subset into safe HTML for
     * sap.m.FormattedText.
     *
     * Supported syntax:
     * - level-three headings
     * - numbered line prefixes
     * - bold text
     * - line breaks
     *
     * @param {string} text Message content.
     * @returns {string} Escaped and formatted HTML.
     */
    function formatMarkdown(text) {
        if (!text) {
            return "";
        }

        return escapeHtml(text)
            .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
            .replace(
                /^(\d+)\.\s+/gm,
                "<strong>$1.</strong>&nbsp;&nbsp;&nbsp;&nbsp;"
            )
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n/g, "<br>");
    }

    return Object.freeze({
        formatMarkdown: formatMarkdown
    });
});