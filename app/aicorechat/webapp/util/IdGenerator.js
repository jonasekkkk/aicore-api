sap.ui.define([], function () {
    "use strict";

    var UUID_PATTERN =
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

    class IdGenerator {
        constructor(storage) {
            this._lastTimestamp = 0;
            this._sequence = 0;
            this._storage = storage === undefined
                ? this._resolveLocalStorage()
                : storage;
        }

        /**
         * Creates an uppercase, time-based UUIDv7.
         * @returns {string} A UUID suitable for S4 key fields.
         */
        createUuidV7() {
            var bytes = new Uint8Array(16);
            var timestamp = Date.now();
            var sequence = this._nextSequence(timestamp);

            this._getCrypto().getRandomValues(bytes);
            this._writeTimestamp(bytes, timestamp);

            bytes[6] = (bytes[6] & 0x0F) | 0x70;
            bytes[8] = (bytes[8] & 0x3F) | 0x80;
            bytes[14] = sequence >> 8;
            bytes[15] = sequence & 0xFF;

            return this._formatUuid(bytes);
        }

        /**
         * Returns a valid UUID from storage or creates and stores a new one.
         * @param {string} storageKey Browser storage key.
         * @returns {string} Stable UUID for the current browser profile.
         */
        getOrCreateStoredUuid(storageKey) {
            if (!storageKey) {
                throw new Error("A storage key is required.");
            }

            var storedUuid = this._readStoredValue(storageKey);

            if (this.isValidUuid(storedUuid)) {
                return storedUuid;
            }

            var newUuid = this.createUuidV7();
            this._writeStoredValue(storageKey, newUuid);

            return newUuid;
        }

        isValidUuid(value) {
            return UUID_PATTERN.test(value || "");
        }

        _nextSequence(timestamp) {
            if (timestamp === this._lastTimestamp) {
                this._sequence = (this._sequence + 1) & 0xFFFF;
            } else {
                this._sequence = 0;
            }

            this._lastTimestamp = timestamp;
            return this._sequence;
        }

        _writeTimestamp(bytes, timestamp) {
            for (var index = 5; index >= 0; index -= 1) {
                bytes[index] = timestamp % 256;
                timestamp = Math.floor(timestamp / 256);
            }
        }

        _formatUuid(bytes) {
            var hex = Array.from(bytes, function (byte) {
                return byte.toString(16).padStart(2, "0");
            }).join("").toUpperCase();

            return [
                hex.slice(0, 8),
                hex.slice(8, 12),
                hex.slice(12, 16),
                hex.slice(16, 20),
                hex.slice(20)
            ].join("-");
        }

        _getCrypto() {
            if (!window.crypto || !window.crypto.getRandomValues) {
                throw new Error("Secure UUID generation is not available.");
            }

            return window.crypto;
        }

        _resolveLocalStorage() {
            try {
                return window.localStorage;
            } catch (error) {
                console.warn("Local storage is not available.", error);
                return null;
            }
        }

        _readStoredValue(storageKey) {
            if (!this._storage) {
                return "";
            }

            try {
                return this._storage.getItem(storageKey) || "";
            } catch (error) {
                console.warn("Could not read the stored UUID.", error);
                return "";
            }
        }

        _writeStoredValue(storageKey, value) {
            if (!this._storage) {
                return;
            }

            try {
                this._storage.setItem(storageKey, value);
            } catch (error) {
                console.warn("Could not store the generated UUID.", error);
            }
        }
    }

    return IdGenerator;
});