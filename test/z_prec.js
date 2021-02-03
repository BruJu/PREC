const testFolder = './test/prec/';
const fs = require('fs');
const N3 = require('n3');

const namespace = require('@rdfjs/namespace');
const prec = require('../prec.js')
const { isSubstituableGraph } = require('../graph-substitution.js');
const assert = require('assert');

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

const precNS = namespace("http://bruy.at/prec#", N3.DataFactory);


describe("prec", function() {
    for (const file of fs.readdirSync(testFolder)) {
        if (file.endsWith(".ttl")) {
            it(file, function() {

                const expected = new N3.Store(
                    new N3.Parser().parse(fs.readFileSync(testFolder + file, "utf-8"))
                );

                if (expected.getQuads(precNS.testMetaData, precNS.kind, N3.DataFactory.literal("SmallExamples")), N3.DataFactory.defaultGraph()) {
                    smallExample(expected);
                    return;
                }

                const meta = expected.getQuads(precNS.testMetaData);
                assert(meta.length === 3);

                const pgPath      = expected.getQuads(precNS.testMetaData, precNS.pgPath)[0].object;
                const pgSource    = expected.getQuads(precNS.testMetaData, precNS.pgSource)[0].object;
                const contextPath = expected.getQuads(precNS.testMetaData, precNS.contextPath)[0].object;

                expected.removeQuads(meta);

                assert.ok(
                    pgSource.equals(N3.DataFactory.namedNode("https://neo4j.com/developer/neo4j-apoc/")),
                    "The only PG supported model is currently NEO4J APOC Json export"
                );

                const result = prec.precOnNeo4J(testFolder + pgPath.value, testFolder + contextPath.value);

                // prec.outputTheStore(result);
                // prec.outputTheStore(expected);

                assert.ok(isSubstituableGraph(result.getQuads(), expected.getQuads()));
            });
        }
    }
});


function get(store, subject, predicate) {
    const quads = store.getQuads(subject, predicate, null, N3.DataFactory.defaultGraph());

    if (quads.length != 1) return null;
    else return quads[0].object;
}

function smallExample(store) {
    for (const unitTest of store.getQuads(null, rdf.type, precNS.unitTest)) {
        const node = unitTest.subject;

        const context       = get(store, node, precNS.context);
        const output        = get(store, node, precNS.output);
        const propertyGraph = get(store, node, precNS.propertyGraph);

        assert.notStrictEqual(context, null);
        assert.notStrictEqual(output, null);
        assert.notStrictEqual(propertyGraph, null);

        // TODO


    }
}
