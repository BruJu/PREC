import * as RDF from "@rdfjs/types";
import * as RDFString from 'rdf-string';
import assert from 'assert';

import { DataFactory } from "n3";

import namespace from '@rdfjs/namespace';
import { isPossibleSourceFor } from "../src/prec-c/PrscContext";

const $quad         = DataFactory.quad;
const $literal      = DataFactory.literal;
const $bn           = DataFactory.blankNode;

const prec = namespace("http://bruy.at/prec#"      , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#", { factory: DataFactory });
const ex   = namespace("http://example.org/"       , { factory: DataFactory });

const pvarSelf    = pvar.self;

// @ts-ignore
const pvarSource  = pvar.source;

// @ts-ignore
const pvarDest    = pvar.destination;
const precValueOf = prec._valueOf;

// @ts-ignore
const propVal = (name: string) => DataFactory.literal(name, precValueOf);


describe("Template - Data reversion", () => {
  function isFrom(template: RDF.Quad, data: RDF.Quad) {
    const r = isPossibleSourceFor(template, data);

    assert.ok(
      r,
      RDFString.termToString(template)
      + " should be able to produce "
      + RDFString.termToString(data)
    );
  }

// @ts-ignore
  function isNotFrom(template: RDF.Quad, data: RDF.Quad) {
    const r = !isPossibleSourceFor(template, data);

    assert.ok(
      r,
      RDFString.termToString(template)
      + " should not be able to produce "
      + RDFString.termToString(data)
    );
  }

  it("Without variables", () => {
    // Regular triple
    isFrom(
      $quad(ex.subject, ex.predicate, ex.object),
      $quad(ex.subject, ex.predicate, ex.object)
    );

    // RDF-star
    isFrom(
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object),
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object)
    );

    // Bad RDF-star
    isNotFrom(
      $quad($quad(ex.s, ex.p, ex.o), ex.predicate, ex.object),
      $quad(ex.subject, ex.predicate, ex.object)
    );

    // Literal
    isFrom(
      $quad(ex.subject, ex.predicate, $literal(3)),
      $quad(ex.subject, ex.predicate, $literal(3))
    );

    isFrom(
      $quad(ex.subject, ex.predicate, $literal("3")),
      $quad(ex.subject, ex.predicate, $literal("3"))
    );

    isNotFrom(
      $quad(ex.subject, ex.predicate, $literal("3")),
      $quad(ex.subject, ex.predicate, $literal(3))
    );

    // Mismatch
    isNotFrom(
      $quad(ex.subject, ex.predicate, ex.three),
      $quad(ex.subject, ex.predicate, $literal(3))
    );
  });

  it("With variables", () => {
    // Trivially possible
    isFrom(
      $quad(pvarSelf   , ex.rdftype, ex.Person),
      $quad($bn("toto"), ex.rdftype, ex.Person)
    );

    isFrom(
      $quad(pvarSource , ex.knows  , pvarDest),
      $quad($bn("toto"), ex.rdftype, $bn("titi"))
    );

    isFrom(
      $quad(pvarSelf   , ex.age, propVal("age")),
      $quad($bn("toto"), ex.age, $literal(5))
    )

    // Trivially impossible
    isNotFrom(
      $quad(pvarSelf   , ex.age, propVal("age")),
      $quad($bn("toto"), ex.age, $bn("three"))
    );

    isNotFrom(
      $quad(pvarSelf, ex.age, propVal("age")),
      $quad(ex.toto , ex.age, $literal(3))
    );

    // Variable evaluation consistency
    isFrom(
      $quad(pvarSelf   , ex.knows  , pvarSelf),
      $quad($bn("toto"), ex.rdftype, $bn("toto"))
    );

    isNotFrom(
      $quad(pvarSelf   , ex.knows  , pvarSelf),
      $quad($bn("toto"), ex.rdftype, $bn("titi"))
    );
  });
});
