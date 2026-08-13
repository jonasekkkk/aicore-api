sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (JSONModel, Device) {
    "use strict";

    function createDeviceModel() {
        var model = new JSONModel(Device);
        model.setDefaultBindingMode("OneWay");
        return model;
    }

    function createViewModel() {
        return new JSONModel({
            isBusy: false,
            isReadingAttachments: false,
            prompt: "",
            attachments: []
        });
    }

    function createChatModel() {
        return new JSONModel({
            ChatMessages: []
        });
    }

    function createHistoryModel() {
        return new JSONModel({
            sessions: []
        });
    }

    return Object.freeze({
        createDeviceModel: createDeviceModel,
        createViewModel: createViewModel,
        createChatModel: createChatModel,
        createHistoryModel: createHistoryModel
    });
});