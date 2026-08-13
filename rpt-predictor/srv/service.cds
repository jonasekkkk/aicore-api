service PredictorService {
    action predictMissingData(file: LargeBinary) returns String;
    
    // Náš nový testovací endpoint
    action pingModel() returns String; 
}

