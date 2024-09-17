import namespace from '@rdfjs/namespace';
import * as RDF from "@rdfjs/types";
import assert from 'assert';
import { DataFactory } from "n3";
import * as RDFString from 'rdf-string';

import {
  $quad, $literal, $blankNode,
  precValueOf, pvarSelf, pvarSource, pvarDestination
} from '../src/PRECNamespace';
import { characterizeTriple } from '../src/prsc';

const ex   = namespace("http://example.org/"       , { factory: DataFactory });

const propVal = (name: string) => DataFactory.literal(name, precValueOf);


function areKappaEqual(template: RDF.Quad, data: RDF.Quad): boolean {
  const templateKappa = characterizeTriple(template);
  const dataKappa = characterizeTriple(data);
  return templateKappa.equals(dataKappa);
}

describe("Template and Data kappa-value sharing", () => {
  function shareKappa(template: RDF.Quad, data: RDF.Quad) {
    it(RDFString.termToString(template) + " |> " + RDFString.termToString(data), () => {
      const r = areKappaEqual(template, data);
      assert.ok(r, "should be produced");
    });
  }

  function doNotShareKappa(template: RDF.Quad, data: RDF.Quad) {
    it(RDFString.termToString(template) + " not |> " + RDFString.termToString(data), () => {
      const r = areKappaEqual(template, data);
      assert.ok(!r, "should not be produced");
    });
  }

  describe("Without variables", () => {
    // Regular triple
    shareKappa(
      $quad(ex.subject, ex.predicate, ex.object),
      $quad(ex.subject, ex.predicate, ex.object)
    );

    // RDF-star
    shareKappa(
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object),
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object)
    );

    // Bad RDF-star
    doNotShareKappa(
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object),
      $quad(ex.subject, ex.predicate, ex.object)
    );

    // Literal
    shareKappa(
      $quad(ex.subject, ex.predicate, $literal(3)),
      $quad(ex.subject, ex.predicate, $literal(3))
    );

    shareKappa(
      $quad(ex.subject, ex.predicate, $literal("3")),
      $quad(ex.subject, ex.predicate, $literal("3"))
    );

    shareKappa(
      $quad(ex.subject, ex.predicate, $literal("3")),
      $quad(ex.subject, ex.predicate, $literal(3))
    );

    // Mismatch
    doNotShareKappa(
      $quad(ex.subject, ex.predicate, ex.three),
      $quad(ex.subject, ex.predicate, $literal(3))
    );
  });

  describe("With variables", () => {
    // Trivially possible
    shareKappa(
      $quad(pvarSelf   , ex.rdftype, ex.Person),
      $quad($blankNode("toto"), ex.rdftype, ex.Person)
    );

    shareKappa(
      $quad(pvarSource , ex.knows, pvarDestination),
      $quad($blankNode("toto"), ex.knows, $blankNode("titi"))
    );

    shareKappa(
      $quad(ex.toto, ex.age, propVal("age")),
      $quad(ex.toto, ex.age, $literal(5))
    )

    shareKappa(
      $quad(pvarSelf   , ex.age, propVal("age")),
      $quad($blankNode("toto"), ex.age, $literal(5))
    )

    // Trivially impossible
    doNotShareKappa(
      $quad(pvarSelf   , ex.age, propVal("age")),
      $quad($blankNode("toto"), ex.age, $blankNode("three"))
    );

    doNotShareKappa(
      $quad(pvarSelf, ex.age, propVal("age")),
      $quad(ex.toto , ex.age, $literal(3))
    );

    // Variable evaluation consistency
    shareKappa(
      $quad(pvarSelf   , ex.knows, pvarSelf),
      $quad($blankNode("toto"), ex.knows, $blankNode("toto"))
    );

    shareKappa(
      $quad(pvarSelf   , ex.knows, pvarSelf),
      $quad($blankNode("toto"), ex.knows, $blankNode("titi"))
    );
  });
});
