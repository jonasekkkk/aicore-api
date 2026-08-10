@cds.server.body_parser.limit: '16mb'
@path: '/ai-core'
service AICoreService {
    type AIResult {
        reply            : LargeString;
        promptTokens     : Integer;
        completionTokens : Integer;
    }

    type ChatTitleResult {
        title : String(100);
    }

    action askAI(
        prompt      : LargeString,
        attachments : LargeString
    ) returns AIResult;

    action generateChatTitle(
        prompt : LargeString,
        reply  : LargeString
    ) returns ChatTitleResult;
}