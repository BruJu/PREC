'use strict';

const fs = require('fs');

/// Returns the content of filename, line by line
function fileToString(filename) {
    if (format === "JSON") {
        return filename;
    }
    
    return fs.readFileSync(filename, 'utf-8').split(/\r?\n/);
}

/// Transforms an array of strings, each strings being a JSON representation,
/// into an array of JS objects
function stringsToJsObjects(file_content) {
    let collection = [];

    for (const line of file_content) {
        if (line.trim() == "") {
            continue;
        }

        collection.push(JSON.parse(line));
    }

    return collection;
}

module.exports = {
    "fromNeo4j": filename => stringsToJsObjects(fileToString(filename)),
    "fromNeo4jString": content => stringsToJsObjects(content.split(/\r?\n/))
};
