@cds.server.body_parser.limit: '12mb'
service PredictorService {
    action getDiagnostics() returns LargeString;

    action pingModel(
        useMock : Boolean
    ) returns LargeString;

    action predictMissingData(
        file                  : LargeBinary,
        fileName              : String,
        delimiter             : String,
        indexColumn           : String,
        targetColumn          : String,
        taskType              : String,
        predictionPlaceholder : String,
        useMock               : Boolean
    ) returns LargeString;
}
