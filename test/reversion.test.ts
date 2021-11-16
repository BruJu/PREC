import namespace from '@rdfjs/namespace';
import * as RDF from "@rdfjs/types";
import assert from 'assert';
import { DataFactory } from "n3";
import * as RDFString from 'rdf-string';
import { canTemplateProduceData } from "../src/prec-c/PrscContext";

const prec = namespace("http://bruy.at/prec#"      , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#", { factory: DataFactory });
const ex   = namespace("http://example.org/"       , { factory: DataFactory });

const $quad         = DataFactory.quad;
const $literal      = DataFactory.literal;
const $bn           = DataFactory.blankNode;

const pvarSelf    = pvar.self;
const pvarSource  = pvar.source;
const pvarDest    = pvar.destination;
const precValueOf = prec._valueOf;
const propVal = (name: string) => DataFactory.literal(name, precValueOf);


describe("Template - Data reversion", () => {
  function isFrom(template: RDF.Quad, data: RDF.Quad) {
    it(RDFString.termToString(template) + " |> " + RDFString.termToString(data), () => {
      const r = canTemplateProduceData(template, data);
      assert.ok(r, "should be produced");
    });
  }

// @ts-ignore
  function isNotFrom(template: RDF.Quad, data: RDF.Quad) {
    it(RDFString.termToString(template) + " not |> " + RDFString.termToString(data), () => {
      const r = canTemplateProduceData(template, data);
      assert.ok(!r, "should not be produced");
    });
  }

  describe("Without variables", () => {
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

  describe("With variables", () => {
    // Trivially possible
    isFrom(
      $quad(pvarSelf   , ex.rdftype, ex.Person),
      $quad($bn("toto"), ex.rdftype, ex.Person)
    );

    isFrom(
      $quad(pvarSource , ex.knows, pvarDest),
      $quad($bn("toto"), ex.knows, $bn("titi"))
    );

    isFrom(
      $quad(ex.toto, ex.age, propVal("age")),
      $quad(ex.toto, ex.age, $literal(5))
    )

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
      $quad(pvarSelf   , ex.knows, pvarSelf),
      $quad($bn("toto"), ex.knows, $bn("toto"))
    );

    isNotFrom(
      $quad(pvarSelf   , ex.knows, pvarSelf),
      $quad($bn("toto"), ex.knows, $bn("titi"))
    );
  });
});
