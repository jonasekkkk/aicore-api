sap.ui.define([
    "sap/m/Button",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Text",
    "sap/m/VBox",
    "aicore/aicorechat/config/ChatConfig"
], function (
    Button,
    Dialog,
    Input,
    Text,
    VBox,
    ChatConfig
) {
    "use strict";

    class SessionDialogService {
        constructor(idFactory) {
            this._createId =
                typeof idFactory === "function"
                    ? idFactory
                    : function (id) {
                        return id;
                    };

            this._activeDialog = null;
        }

        requestRename(currentTitle) {
            this._closeActiveDialog();

            return new Promise(
                function (resolve) {
                    var result = null;
                    var saveButton;

                    var input = new Input({
                        id:
                            this._id(
                                "renameSessionInput"
                            ),
                        value:
                            String(
                                currentTitle ||
                                ""
                            ),
                        maxLength:
                            ChatConfig
                                .MAX_CHAT_TITLE_LENGTH,
                        width:
                            "100%",
                        placeholder:
                            "Zadejte název konverzace",
                        liveChange:
                            function (event) {
                                var value =
                                    this
                                        ._normalizeTitle(
                                            event
                                                .getParameter(
                                                    "value"
                                                )
                                        );

                                saveButton
                                    .setEnabled(
                                        Boolean(value)
                                    );

                                input
                                    .setValueState(
                                        "None"
                                    );
                            }.bind(this)
                    });

                    input.addStyleClass(
                        "sapUiTinyMarginTop"
                    );

                    var dialog;

                    saveButton = new Button({
                        id:
                            this._id(
                                "confirmRenameSessionButton"
                            ),
                        text:
                            "Uložit",
                        type:
                            "Emphasized",
                        enabled:
                            Boolean(
                                this
                                    ._normalizeTitle(
                                        currentTitle
                                    )
                            ),
                        press:
                            function () {
                                var title =
                                    this
                                        ._normalizeTitle(
                                            input
                                                .getValue()
                                        );

                                if (!title) {
                                    input
                                        .setValueState(
                                            "Error"
                                        );

                                    input
                                        .setValueStateText(
                                            "Název nesmí být prázdný."
                                        );

                                    input.focus();
                                    return;
                                }

                                result = title;
                                dialog.close();
                            }.bind(this)
                    });

                    var cancelButton =
                        new Button({
                            id:
                                this._id(
                                    "cancelRenameSessionButton"
                                ),
                            text:
                                "Zrušit",
                            press:
                                function () {
                                    dialog.close();
                                }
                        });

                    dialog = new Dialog({
                        id:
                            this._id(
                                "renameSessionDialog"
                            ),
                        title:
                            "Přejmenovat konverzaci",
                        type:
                            "Message",
                        contentWidth:
                            "28rem",
                        stretchOnPhone:
                            true,
                        content: [
                            new VBox({
                                id:
                                    this._id(
                                        "renameSessionContent"
                                    ),
                                items: [
                                    new Text({
                                        id:
                                            this._id(
                                                "renameSessionDescription"
                                            ),
                                        text:
                                            "Zadejte nový název " +
                                            "konverzace " +
                                            "(maximálně 100 znaků)."
                                    }),
                                    input
                                ]
                            }).addStyleClass(
                                "sapUiSmallMargin"
                            )
                        ],
                        beginButton:
                            saveButton,
                        endButton:
                            cancelButton,
                        afterOpen:
                            function () {
                                input.focus();

                                input.selectText(
                                    0,
                                    input
                                        .getValue()
                                        .length
                                );
                            },
                        afterClose:
                            function () {
                                if (
                                    this._activeDialog ===
                                    dialog
                                ) {
                                    this._activeDialog =
                                        null;
                                }

                                dialog.destroy();
                                resolve(result);
                            }.bind(this)
                    });

                    this._activeDialog =
                        dialog;

                    dialog.open();
                }.bind(this)
            );
        }

        confirmDeletion(sessionTitle) {
            this._closeActiveDialog();

            return new Promise(
                function (resolve) {
                    var confirmed = false;
                    var timer = null;

                    var remaining =
                        ChatConfig
                            .SESSION_DELETE_CONFIRMATION_SECONDS;

                    var countdownText =
                        new Text({
                            id:
                                this._id(
                                    "deleteSessionCountdown"
                                ),
                            text:
                                this._getCountdownText(
                                    remaining
                                )
                        });

                    countdownText
                        .addStyleClass(
                            "sapUiSmallMarginTop"
                        );

                    var dialog;

                    var deleteButton =
                        new Button({
                            id:
                                this._id(
                                    "confirmDeleteSessionButton"
                                ),
                            text:
                                this
                                    ._getDeleteButtonText(
                                        remaining
                                    ),
                            type:
                                "Default",
                            enabled:
                                false,
                            press:
                                function () {
                                    if (
                                        !deleteButton
                                            .getEnabled()
                                    ) {
                                        return;
                                    }

                                    confirmed = true;
                                    dialog.close();
                                }
                        });

                    var cancelButton =
                        new Button({
                            id:
                                this._id(
                                    "cancelDeleteSessionButton"
                                ),
                            text:
                                "Zrušit",
                            press:
                                function () {
                                    dialog.close();
                                }
                        });

                    dialog = new Dialog({
                        id:
                            this._id(
                                "deleteSessionDialog"
                            ),
                        title:
                            "Odstranit konverzaci?",
                        type:
                            "Message",
                        state:
                            "Error",
                        contentWidth:
                            "30rem",
                        stretchOnPhone:
                            true,
                        content: [
                            new VBox({
                                id:
                                    this._id(
                                        "deleteSessionContent"
                                    ),
                                items: [
                                    new Text({
                                        id:
                                            this._id(
                                                "deleteSessionWarning"
                                            ),
                                        text:
                                            this
                                                ._getDeletionWarning(
                                                    sessionTitle
                                                )
                                    }),
                                    countdownText
                                ]
                            }).addStyleClass(
                                "sapUiSmallMargin"
                            )
                        ],
                        beginButton:
                            deleteButton,
                        endButton:
                            cancelButton,
                        afterOpen:
                            function () {
                                timer =
                                    setInterval(
                                        function () {
                                            remaining -=
                                                1;

                                            if (
                                                remaining >
                                                0
                                            ) {
                                                deleteButton
                                                    .setText(
                                                        this
                                                            ._getDeleteButtonText(
                                                                remaining
                                                            )
                                                    );

                                                countdownText
                                                    .setText(
                                                        this
                                                            ._getCountdownText(
                                                                remaining
                                                            )
                                                    );

                                                return;
                                            }

                                            clearInterval(
                                                timer
                                            );

                                            timer = null;

                                            deleteButton
                                                .setText(
                                                    "Odstranit konverzaci"
                                                );

                                            deleteButton
                                                .setType(
                                                    "Reject"
                                                );

                                            deleteButton
                                                .setEnabled(
                                                    true
                                                );

                                            countdownText
                                                .setText(
                                                    "Odstranění je nyní " +
                                                    "možné potvrdit."
                                                );
                                        }.bind(this),
                                        1000
                                    );
                            }.bind(this),
                        afterClose:
                            function () {
                                if (timer) {
                                    clearInterval(
                                        timer
                                    );

                                    timer = null;
                                }

                                if (
                                    this._activeDialog ===
                                    dialog
                                ) {
                                    this._activeDialog =
                                        null;
                                }

                                dialog.destroy();

                                resolve(
                                    confirmed
                                );
                            }.bind(this)
                    });

                    this._activeDialog =
                        dialog;

                    dialog.open();
                }.bind(this)
            );
        }

        destroy() {
            this._closeActiveDialog();
        }

        _closeActiveDialog() {
            if (this._activeDialog) {
                this._activeDialog.close();
            }
        }

        _normalizeTitle(value) {
            return Array.from(
                String(value || "")
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim()
            )
                .slice(
                    0,
                    ChatConfig
                        .MAX_CHAT_TITLE_LENGTH
                )
                .join("")
                .trim();
        }

        _getDeletionWarning(
            sessionTitle
        ) {
            var title =
                this._normalizeTitle(
                    sessionTitle
                ) ||
                "tato konverzace";

            return (
                "Konverzace „" +
                title +
                "“ zmizí z historie a " +
                "v aplikaci k ní trvale " +
                "ztratíte přístup. Tuto akci " +
                "nelze v aplikaci vrátit zpět."
            );
        }

        _getDeleteButtonText(
            remaining
        ) {
            return (
                "Odstranit (" +
                remaining +
                ")"
            );
        }

        _getCountdownText(
            remaining
        ) {
            return (
                "Potvrzení bude dostupné za " +
                remaining +
                (
                    remaining === 1
                        ? " sekundu."
                        : " sekundy."
                )
            );
        }

        _id(localId) {
            return this._createId(
                localId
            );
        }
    }

    return SessionDialogService;
}); 