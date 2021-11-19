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
const prec   = namespace("http://bruy.at/prec#"     , { factory: N3.DataFactory });
const thisns = namespace("http://bruy.at/prec#name=", { factory: N3.DataFactory });

describe('WellBehavedCheck', () => {
  const tests = readResourceFile(path.join(__dirname, 'WellBehavedCheck.ttl'));

  for (const test of tests) {
    it(RDFString.termToString(test.name), () => {
      let atLeastOneCheck = false;

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

          atLeastOneCheck = true;
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

          atLeastOneCheck = true;
        }
      }

      if (test.signatureTriple !== undefined) {

        for (const signatureTest of test.signatureTriple) {
          const rules = signatureTest.rules === undefined ? schema.prscRules
            : signatureTest.rules.map(ruleName => {
              const x = schema.prscRules.find(rule => rule.identity.equals(ruleName));
              if (x === undefined) {
                throw Error(
                  `Did not find the rule ${RDFString.termToString(ruleName)}`
                  + ` but it was required by ${RDFString.termToString(signatureTest.name)}`
                  + ` for a prec:all_signed test`);
              }
              return x;
            });

          assert.ok(
            (WBC.signatureTriple(rules).length === 0) === signatureTest.expectedResult,
            "The context should have "
            + (test.signatureTriple ? "all rules with " : "some rules without ")
            + "a signature within " + RDFString.termToString(signatureTest.name)
          );

          atLeastOneCheck = true;
        }
      }

      if (test.isWellBehaved !== undefined) {
        const r = WBC.default(schema);
        if (test.isWellBehaved) {
          assert.ok(r === true,
            "The context should be consider well behaved "
            +
            (r === true ? "" : (
              (r as WBC.WellBehavedViolation[])
              .map(violation => `${RDFString.termToString(violation.rule.identity)}: ${violation.reason}`)
              .join(" -- ")
            ))
          );
        } else {
          assert.ok(r !== true,
            "The context should not be considered well behaved"
          );
        }


        atLeastOneCheck = true;
      }

      assert.ok(atLeastOneCheck, "At least one thing should be tested");
    });
  }
});


type TestGraph = {
  name: RDF.Term;
  quads: RDF.Quad[];
  isWellBehaved?: boolean;
  signatureTriple?: SignatureTripleTest[];
  testRules: TermMap<RDF.Term, TestRule>;
};

type SignatureTripleTest = {
  name: RDF.Term;
  /** List of rules to test against. undefined = whole context */
  rules: undefined | RDF.Term[];
  expectedResult: boolean;
}

type TestRule = {
  elementIdentification?: boolean;
  noValueLoss?: boolean;
};

function readResourceFile(path: string): TestGraph[] {
  const content = fs.readFileSync(path, 'utf-8');
  const quads = new N3.Parser().parse(content);
  
  const testGraphs = new TermMap<RDF.Term, TestGraph>();
  const wipAllSigneds = new TermMap<
    /* Graph name */ RDF.Term,
    TermMap</* all signed local name */ RDF.Term, Partial<SignatureTripleTest>>
  >();

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
      } else if (quad.predicate.equals(prec.all_signed)) {
        const expected = xsdBoolToBool(quad.object);
        if (expected === undefined) {
          throw Error("The value of prec:all_signed should be an xsd:boolean");
        }
        
        x.signatureTriple = x.signatureTriple || [];
        x.signatureTriple.push({
          name: quad.graph, rules: undefined, expectedResult: expected
        });
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
      } else if (quad.predicate.equals(prec.all_signed)) {
        let wipAllSignedForGraph = wipAllSigneds.get(graph);
        if (wipAllSignedForGraph === undefined) {
          wipAllSignedForGraph = new TermMap();
          wipAllSigneds.set(graph, wipAllSignedForGraph);
        }

        let x = wipAllSignedForGraph.get(quad.subject);
        if (x === undefined) {
          x = {};
          wipAllSignedForGraph.set(quad.subject, x);
        }

        if (quad.object.termType === 'Literal') {
          const expected = xsdBoolToBool(quad.object);
          if (expected === undefined) {
            throw Error("If the object of prec:all_signed is a literal, it should be true or false");
          }
          x.expectedResult = expected;
        } else {
          x.rules = x.rules || [];
          x.rules.push(quad.object);
        }
      } else {
        x.quads.push(N3.DataFactory.quad(
          quad.subject, quad.predicate, quad.object
        ));
      }
    }
  });

  for (const [graphName, wipAllSignedsInGraph] of wipAllSigneds) {
    let graph = testGraphs.get(graphName);
    if (graph === undefined) {
      graph = { name: graphName, quads: [], testRules: new TermMap() };
      testGraphs.set(graphName, graph);
    }

    for (const [testName, block] of wipAllSignedsInGraph) {
      graph.signatureTriple = graph.signatureTriple || [];

      if (block.expectedResult === undefined) {
        throw Error(`${RDFString.termToString(testName)} has no expected value for prec:all_signed`);
      }

      graph.signatureTriple.push({
        name: testName,
        expectedResult: block.expectedResult,
        rules : block.rules || []
      });
    }
  }

  return [...testGraphs.values()];
}
