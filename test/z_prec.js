const testFolder = './test/prec/';
const fs = require('fs');
const N3 = require('n3');

const namespace = require('@rdfjs/namespace');
const prec = require('../prec.js')
const { isSubstituableGraph } = require('../graph-substitution.js');
const assert = require('assert');

const precNS = namespace("http://bruy.at/prec#", N3.DataFactory);


describe("prec", function() {
    for (const file of fs.readdirSync(testFolder)) {
        if (file.endsWith(".ttl")) {
            it(file, function() {

                const expected = new N3.Store(
                    new N3.Parser().parse(fs.readFileSync(testFolder + file, "utf-8"))
                );

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

