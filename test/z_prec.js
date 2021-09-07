const testFolder = './test/prec/';
const fs = require('fs');
const N3 = require('n3');

const namespace = require('@rdfjs/namespace');
const prec = require('../prec.ts')
const { isSubstituableGraph } = require('../src/rdf/graph-substitution');
const assert = require('assert');
const { filenameToArrayOfQuads } = require('../src/rdf/parsing');

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

const precNS = namespace("http://bruy.at/prec#", N3.DataFactory);

function loadQuads(path) {
    const fileContent = fs.readFileSync(path);
    const quads = filenameToArrayOfQuads(fileContent);
    return quads;
}

describe("prec", function() {
    for (const file of fs.readdirSync(testFolder)) {
        if (file.endsWith(".ttl")) {
            describe(file, function() {
                const expected = new N3.Store(
                    new N3.Parser().parse(fs.readFileSync(testFolder + file, "utf-8"))
                );

                if (expected.getQuads(precNS.testMetaData, precNS.kind, N3.DataFactory.literal("SmallExamples")), N3.DataFactory.defaultGraph()) {
                    smallExample(expected);
                    return;
                }

                it("should work", function() {

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

                    const contextQuads = loadQuads(testFolder + contextPath.value);
                    const result = prec.precOnNeo4J(testFolder + pgPath.value, contextQuads);

                    const r = isSubstituableGraph(result.getQuads(), expected.getQuads());
                    assert.ok(r);
                })
            });
        }
    }
});


function get(store, subject, predicate) {
    const quads = store.getQuads(subject, predicate, null, N3.DataFactory.defaultGraph());

    if (quads.length != 1) return null;
    else return quads[0].object;
}


function extractGraph(store, graph) {
    const result = new N3.Store(
        store.getQuads(null, null, null, graph)
            .map(quad => N3.DataFactory.quad(quad.subject, quad.predicate, quad.object))
    );

    const parentGraphs = store.getQuads(null, prec.testIsBaseOf, graph, N3.DataFactory.defaultGraph());

    for (const parentGraph of parentGraphs) {
        result.addQuads(extractGraph(store, parentGraph.subject).getQuads());
    }

    return result;
}

function getContent(store, term) {
    while (term.termType !== "Literal") {
        const query = store.getQuads(term, prec.testContent, null, N3.DataFactory.defaultGraph());

        if (query.length === 0) {
            assert.ok(false, "Malformed test");
            return null;
        }

        term = query[0].object;
    }

    return term.value;
}

function smallExample(store) {
    for (const unitTest of store.getQuads(null, rdf.type, precNS.unitTest)) {
        const node = unitTest.subject;
        const context       = get(store, node, precNS.context);

        it(context.value, function() {
            const output        = get(store, node, precNS.output);
            const propertyGraph = get(store, node, precNS.propertyGraph);

            assert.notStrictEqual(context, null);
            assert.notStrictEqual(output, null);
            assert.notStrictEqual(propertyGraph, null);

            const contextGraph = extractGraph(store, context);
            const expectedGraph = extractGraph(store, output);
            const aaa = prec.precOnNeo4JString(getContent(store, propertyGraph), contextGraph.getQuads());

            const r = isSubstituableGraph(aaa.getQuads(), expectedGraph.getQuads());

            if (!r) {
                const precUtils = require('../src/rdf/utils')

                console.error("• Result:");
                console.error(precUtils.badToString(aaa.getQuads(), 7));
                console.error("• Expected:");
                console.error(precUtils.badToString(expectedGraph.getQuads(), 8));
            }

            assert.ok(r, context.value);
        });
    }
}
