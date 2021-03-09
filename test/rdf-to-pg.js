const assert = require('assert');

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const ex = namespace("http://ex.org/", N3.DataFactory);
const WT = require('@bruju/wasm-tree');
const quad = N3.DataFactory.quad;
const rpec = require('../rdf-to-pg.js');

function toQuads(turtleContent) {
    return new N3.Parser(
        {
            format: 'application/turtle',
            baseIRI: "http://ex.org/"
        }
    ).parse(turtleContent);
}

function toWTDataset(turtleContent) {
    let dataset = new WT.Dataset();
    dataset.addAll(toQuads(turtleContent));
    return dataset;
}

function testRdfModelSetEquality(result, expected) {
    let expectedMutable = [...expected];

    for (let element of result) {
        const j = expectedMutable.findIndex(e => e.equals(element));

        if (j === -1) {
            return false;
        }

        expectedMutable.splice(j, 1);
    }

    return expectedMutable.length === 0;
}

function toStringArrayOfTerms(arraysOfTerms) {
    let s = "[\n";

    if (arraysOfTerms != null) {
        for (let i = 0 ; i != arraysOfTerms.length ; ++i) {
            if (i != 0) s += ",\n";
            s += "  " + JSON.stringify(arraysOfTerms[i]);
        }
    }

    return s + "\n]";
}

function toStringArrayOfQuads(arraysOfQuads) {
    let s = "[\n";

    if (arraysOfQuads != null) {
        let isFirst = true;
        for (const quad of arraysOfQuads) {
            if (!isFirst) s += " .\n";
            isFirst = false;
            s += "  ";
            s += JSON.stringify(quad.subject) + " / " + JSON.stringify(quad.predicate) + " / " + JSON.stringify(quad.object);
        }
    }

    return s + "\n]";
}

describe("Path Travelling Expansion", function() {
    function toDataset(turtleContent) {
        let dataset = toWTDataset(
            "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n" +
            turtleContent
        );
        rpec.extendDataset_PathTravelling(dataset);
        return dataset;
    }


    describe("getNodesOfType", function() {        
        function testNodes(type, turtleContent, expectedResult) {
            let result = toDataset(turtleContent).getNodesOfType(type);

            assert.ok(testRdfModelSetEquality(result, expectedResult),
                "Nodes of type " + type.value + " of the file\n"
                + turtleContent + '\n'
                + "should be\n"
                + toStringArrayOfTerms(expectedResult)
                + "\nbut is computed as \n"
                + toStringArrayOfTerms(result)
            );
        }

        it("should return an empty list if there are no types", function() {
            testNodes(ex.a, ""             , []);
            testNodes(ex.b, ""             , []);
            testNodes(ex.b, "<s> <p> <o> .", []);
        });

        it("should return an empty list if the given type does not appear as a type", function() {
            testNodes(ex.type2, "<s> rdf:type <type1> .", []);
        });

        it("should return the right subjects if a valid type if given", function() {
            testNodes(ex.type, "<s> rdf:type <type> . ", [ ex.s ]);
            testNodes(ex.type, "<s> rdf:type <type> . <s> rdf:type <type2> .", [ ex.s ]);
            testNodes(ex.type, "<s> rdf:type <type> . <s2> rdf:type <type> . <s3> rdf:type <type2> .", [ ex.s2, ex.s ]);
        });
    });

    
    describe("getPathsFrom", function() {
        function testPaths(subject, ignoreList, turtleContent, expectedResult) {
            let result = toDataset(turtleContent).getPathsFrom(subject, ignoreList);

            assert.ok(testRdfModelSetEquality(result, expectedResult),
                "Paths from " + subject.value + " of the file\n"
                + turtleContent + '\n'
                + "with ignore list\n"
                + toStringArrayOfTerms(ignoreList)
                + "\nshould be\n"
                + toStringArrayOfQuads(expectedResult)
                + "\nbut is computed as \n"
                + toStringArrayOfQuads(result)
            );
        }

        it("should not return any value if no valid path", function() {
            testPaths(ex.s, null  , "", []);
            testPaths(ex.s, null  , "<s2> <p> <o> .", []);
            testPaths(ex.s, [ex.p], "<s> <p> <o> .", []);
        });

        it("should return all the valid paths", function() {
            testPaths(ex.s, null, "<s> <p> <o> .", [quad(ex.s, ex.p, ex.o)]);
            testPaths(ex.s, null, "<s> <p> <o>, <o2> .", [quad(ex.s, ex.p, ex.o), quad(ex.s, ex.p, ex.o2)]);
            testPaths(ex.s, [ex.p], "<s> <p> <o>; <p2> <o2> .", [quad(ex.s, ex.p2, ex.o2)]);
        });
    });

    // TODO:
    // followThrough
    // checkAndFollow
});


// TODO:
// -- extendDataset_RWPRECGenerated
// readLabelOf
// readPropertyName
// getRealLabel

