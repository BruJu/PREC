import fs from 'fs';
import * as N3 from 'n3';
import path from 'path';
import * as RDF from "@rdfjs/types";

import { apocToRDF, stringToApocDocuments } from '../prec';
import assert from 'assert';

const testFolder = './test/prec/';

import { rdf, prec, $quad, $defaultGraph, xsd } from '../src/PRECNamespace';
import checkIsomorphism from '@bruju/rdf-test-util';
import { followThrough } from '../src/rdf/path-travelling';
import { termToString } from 'rdf-string';

function extractGraph(store: N3.Store, graph: RDF.Term) {
  if (graph.termType === 'Literal') {
    if (graph.datatype.equals(xsd.string)) {
      return new N3.Store(new N3.Parser().parse(graph.value));
    } else if (graph.datatype.equals(prec.relativePath)) {
      const p = path.join(__dirname, 'prec', graph.value);
      return new N3.Store(new N3.Parser().parse(fs.readFileSync(p, "utf-8")));
    } else {
      throw Error("Unexpected value found: " + termToString(graph));
    }
  }

  if (graph.termType !== 'BlankNode' && graph.termType !== 'NamedNode') {
    throw Error("Unexpected value found: " + termToString(graph));
  }


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

  if (term.datatype.equals(prec.relativePath)) {
    const p = path.join(__dirname, 'prec', term.value);
    return fs.readFileSync(p, "utf-8");
  } else {
    return term.value;
  }
}


describe("prec", () => {
  for (const file of fs.readdirSync(testFolder)) {
    if (!file.endsWith(".ttl")) continue;

    describe(file, () => {
      const expected = new N3.Store(
        new N3.Parser().parse(fs.readFileSync(testFolder + file, "utf-8"))
      );
      
      for (const unitTest of expected.getQuads(null, rdf.type, prec.UnitTest, $defaultGraph)) {
        const node = unitTest.subject;
        const context = followThrough(expected, node, prec.context)!;

        it(context.value, () => {
          const output        = followThrough(expected, node, prec.output)!;
          const propertyGraph = followThrough(expected, node, prec.propertyGraph)!;

          assert.notStrictEqual(context, null);
          assert.notStrictEqual(output, null);
          assert.notStrictEqual(propertyGraph, null);

          const contextGraph = extractGraph(expected, context);
          const expectedGraph = extractGraph(expected, output);
          const apocDocumentsAsString = getContent(expected, propertyGraph);

          checkIfcorrectOutput(
            apocDocumentsAsString,
            contextGraph.getQuads(null, null, null, null),
            expectedGraph
          );
        });
      }

    });
  }
});


function checkIfcorrectOutput(graphContent: string, context: RDF.Quad[], expected: N3.Store) {
  const apocDocuments = stringToApocDocuments(graphContent);
  const result = apocToRDF(apocDocuments, context);

  const isoResult = checkIsomorphism([...result], [...expected]);
  assert.ok(isoResult.areIsomorphic, isoResult.text);
}
