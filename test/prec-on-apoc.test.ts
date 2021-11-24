import fs from 'fs';
import * as N3 from 'n3';
import path from 'path';

import { apocToRDF, stringToApocDocuments } from '../prec';
import { isSubstituableGraph } from '../src/rdf/graph-substitution';
import assert from 'assert';
import { filenameToArrayOfQuads } from '../src/rdf/parsing';

import { badToString } from '../src/rdf/utils';
import { Quad, Quad_Graph, Quad_Predicate, Quad_Subject, Term } from 'rdf-js';

const testFolder = './test/prec/';

import { rdf, prec, $quad, $literal, $defaultGraph } from '../src/PRECNamespace';

function get(store: N3.Store, subject: Quad_Subject, predicate: Quad_Predicate) {
  const quads = store.getQuads(subject, predicate, null, N3.DataFactory.defaultGraph());

  if (quads.length != 1) return null;
  else return quads[0].object;
}

function extractGraph(store: N3.Store, graph: Quad_Graph) {
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

function getContent(store: N3.Store, term: Term) {
  while (term.termType !== "Literal") {
    const next = get(store, term as Quad_Subject, prec.testContent);
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

        const pgPath      = get(expected, prec.testMetaData, prec.pgPath)!;
        const pgSource    = get(expected, prec.testMetaData, prec.pgSource)!;
        const contextPath = get(expected, prec.testMetaData, prec.contextPath)!;

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
    const context = get(store, node, prec.context)! as Quad_Predicate;

    it(context.value, () => {
      const output        = get(store, node, prec.output) as Quad_Predicate;
      const propertyGraph = get(store, node, prec.propertyGraph) as Quad_Predicate;

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

function checkIfcorrectOutput(graphContent: string, context: Quad[], expected: N3.Store) {
  const apocDocuments = stringToApocDocuments(graphContent);
  const result = apocToRDF(apocDocuments, context);

  const r = isSubstituableGraph(result.getQuads(), expected.getQuads(null, null, null, null));

  if (!r) {
    console.error("• Result:");
    console.error(badToString(result.getQuads(), 7));
    console.error("• Expected:");
    console.error(badToString(expected.getQuads(null, null, null, null), 8));
  }

  assert.ok(r);
}
