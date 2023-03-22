import fs from 'fs';
import * as N3 from 'n3';
import path from 'path';
import * as RDF from "@rdfjs/types";

import { apocToRDF, stringToApocDocuments } from '../prec';
import assert from 'assert';
import { filenameToArrayOfQuads } from '../src/rdf/parsing';

const testFolder = './test/prec/';

import { rdf, prec, $quad, $literal, $defaultGraph } from '../src/PRECNamespace';
import checkIsomorphism from '@bruju/rdf-test-util';
import { followThrough } from '../src/rdf/path-travelling';

function extractGraph(store: N3.Store, graph: RDF.Quad_Graph) {
  const result = new N3.Store(
    store.getQuads(null, null, null, graph)
      .map(quad => $quad(quad.subject, quad.predicate, quad.object))
  );

  const parentGraphs = store.getQuads(null, prec.testIsBaseOf, graph, $defaultGraph);

  for (const parentGraph of parentGraphs) {
    result.addQuads(
      extractGraph(store, parentGraph.subject).getQuads(null, null, null, null)
    );
  }

  return result;
}

function getContent(store: N3.Store, term: RDF.Term) {
  while (term.termType !== "Literal") {
    const next = followThrough(store, term as RDF.Quad_Subject, prec.testContent);
    if (next === null) assert.ok(false, "Malformed test");
    term = next;
  }

  return term.value;
}


describe("prec", () => {
  for (const file of fs.readdirSync(testFolder)) {
    if (!file.endsWith(".ttl")) continue;

    describe(file, () => {
      const expected = new N3.Store(
        new N3.Parser().parse(fs.readFileSync(testFolder + file, "utf-8"))
      );

      if (expected.has($quad(prec.testMetaData, prec.kind, $literal("SmallExamples")))) {
        smallExample(expected);
        return;
      }

      it("should work", function() {
        const meta = expected.getQuads(prec.testMetaData, null, null, $defaultGraph);
        assert.ok(meta.length === 3);

        const pgPath      = followThrough(expected, prec.testMetaData, prec.pgPath)!;
        const pgSource    = followThrough(expected, prec.testMetaData, prec.pgSource)!;
        const contextPath = followThrough(expected, prec.testMetaData, prec.contextPath)!;

        expected.removeQuads(meta);

        assert.ok(
          pgSource.equals(N3.DataFactory.namedNode("https://neo4j.com/developer/neo4j-apoc/")),
          "The only PG supported model is currently NEO4J APOC Json export"
        );

        const contextQuads = filenameToArrayOfQuads(path.join(__dirname, 'prec', contextPath.value));
        const content = fs.readFileSync(path.join(__dirname, 'prec', pgPath.value), 'utf-8');

        checkIfcorrectOutput(content, contextQuads, expected);
      });
    });
  }
});

function smallExample(store: N3.Store) {
  for (const unitTest of store.getQuads(null, rdf.type, prec.unitTest, $defaultGraph)) {
    const node = unitTest.subject;
    const context = followThrough(store, node, prec.context)! as RDF.Quad_Predicate;

    it(context.value, () => {
      const output        = followThrough(store, node, prec.output) as RDF.Quad_Predicate;
      const propertyGraph = followThrough(store, node, prec.propertyGraph) as RDF.Quad_Predicate;

      assert.notStrictEqual(context, null);
      assert.notStrictEqual(output, null);
      assert.notStrictEqual(propertyGraph, null);

      const contextGraph = extractGraph(store, context);
      const expectedGraph = extractGraph(store, output);
      const apocDocumentsAsString = getContent(store, propertyGraph);

      checkIfcorrectOutput(
        apocDocumentsAsString,
        contextGraph.getQuads(null, null, null, null),
        expectedGraph
      );
    });
  }
}

function checkIfcorrectOutput(graphContent: string, context: RDF.Quad[], expected: N3.Store) {
  const apocDocuments = stringToApocDocuments(graphContent);
  const result = apocToRDF(apocDocuments, context);

  const isoResult = checkIsomorphism([...result], [...expected]);
  assert.ok(isoResult.areIsomorphic, isoResult.text);
}
