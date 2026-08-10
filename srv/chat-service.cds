service ChatService {
    entity ChatSessions {
        key SessionId : String;
        Title         : String;
        CreatedAt     : Timestamp;
    }
    
    entity ChatMessages {
        key MessageId : String;
        SessionId     : String;
        Role          : String;
        Content       : String;
        CreatedAt     : Timestamp;
    }
}