import assert from 'assert';

import path from 'path';
import * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import fs from 'fs';
import { PRSCSchema } from '../src/prec-c/PrscContext';
import TermMap from '@rdfjs/term-map';
import * as RDFString from 'rdf-string';

import * as WBC from '../src/prsc/WellBehavedCheck';

import namespace from '@rdfjs/namespace';
import { xsdBoolToBool } from '../src/rdf/utils';
const prec = namespace("http://bruy.at/prec#"                       , { factory: N3.DataFactory });
const thisns = namespace("http://bruy.at/prec#name=", { factory: N3.DataFactory });

describe('WellBehavedCheck', () => {
  const tests = readResourceFile(path.join(__dirname, 'WellBehavedCheck.ttl'));

  for (const test of tests) {
    it(RDFString.termToString(test.name), () => {
      const schema = new PRSCSchema(test.quads);

      for (const [ident, conditions] of test.testRules) {
        if (conditions.elementIdentification !== undefined) {
          const rule = schema.prscRules.find(r => r.identity.equals(ident));
          assert.ok(rule !== undefined);
          const r = WBC.elementIdentification(rule);
          assert.ok(
            r === conditions.elementIdentification,
            RDFString.termToString(ident)
            + " is"
            + (conditions.elementIdentification ? "" : " not")
            + " expected to comply with the element identification criteria"
          );
        }

        if (conditions.noValueLoss !== undefined) {
          const rule = schema.prscRules.find(r => r.identity.equals(ident));
          assert.ok(rule !== undefined);
          const r = WBC.noValueLoss(rule);
          assert.ok(
            r === conditions.noValueLoss,
            RDFString.termToString(ident)
            + " is"
            + (conditions.noValueLoss ? "" : " not")
            + " expected to comply with the no value loss criteria"
          );
        }
      }

      if (test.signatureTriple !== undefined) {
        assert.ok(
          (WBC.signatureTriple(schema.prscRules).length === 0) === test.signatureTriple,
          "The context should have "
          + (test.signatureTriple ? "all rules with " : "some rules without ")
          + "a signature"
        );
      }

      if (test.isWellBehaved !== undefined) {
        assert.ok(
          WBC.default(schema) === test.isWellBehaved,
          "The context should " + ( test.isWellBehaved ? "" : "not " )
          + "be considered well behaved"
        );
      }
    });
  }
});


type TestGraph = {
  name: RDF.Term;
  quads: RDF.Quad[];
  isWellBehaved?: boolean;
  signatureTriple?: boolean;
  testRules: TermMap<RDF.Term, TestRule>;
};

type TestRule = {
  elementIdentification?: boolean;
  noValueLoss?: boolean;
};

function readResourceFile(path: string): TestGraph[] {
  const content = fs.readFileSync(path, 'utf-8');
  const quads = new N3.Parser().parse(content);
  
  const testGraphs = new TermMap<RDF.Term, TestGraph>();

  quads.forEach(quad => {
    const graph = quad.graph;
    if (graph.equals(N3.DataFactory.defaultGraph())) return;

    let x: TestGraph | undefined = testGraphs.get(graph);
    if (x === undefined) {
      x = { name: graph, quads: [], testRules: new TermMap() };
      testGraphs.set(graph, x);
    }

    if (quad.subject.equals(thisns.all)) {
      if (quad.predicate.equals(prec.well_behaved)) {
        x.isWellBehaved = xsdBoolToBool(quad.object);
      } else 
      if (quad.predicate.equals(prec.signature)) {
        x.signatureTriple = xsdBoolToBool(quad.object);
      } else {
        throw Error("Unsupported quad: " + RDFString.termToString(quad));
      }
    } else {
      if (quad.predicate.equals(prec.element_identification)) {
        let y = x.testRules.get(quad.subject);
        if (y === undefined) {
          y = {};
          x.testRules.set(quad.subject, y);
        }

        y.elementIdentification = xsdBoolToBool(quad.object);
      } else if (quad.predicate.equals(prec.no_value_loss)) {
        let y = x.testRules.get(quad.subject);
        if (y === undefined) {
          y = {};
          x.testRules.set(quad.subject, y);
        }

        y.noValueLoss = xsdBoolToBool(quad.object);
      } else {
        x.quads.push(N3.DataFactory.quad(
          quad.subject, quad.predicate, quad.object
        ));
      }
    }
  });

  return [...testGraphs.values()];
}
