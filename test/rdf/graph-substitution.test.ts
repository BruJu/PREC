import assert from 'assert';

import * as N3 from 'n3';
import namespace from '@rdfjs/namespace';

import {
  isSubstituableGraph,
  rebuildBlankNodes,
  findBlankNodes
} from "../../src/rdf/graph-substitution";
import { Quad } from '@rdfjs/types';

const ex = namespace("http://ex.org/", { factory: N3.DataFactory });

const quad = N3.DataFactory.quad;
const $quad = quad;
const blankNode = N3.DataFactory.blankNode;


function equalsArrayOfQuads(a: Quad[], b: Quad[]) {
  if (a.length != b.length) return false;

  for (const quad of a) {
    if (b.find(qb => quad.equals(qb)) === undefined) {
      return false;
    }
  }

  return true;
}

describe("findBlankNodes", () => {
  it("should work", () => {
    // No blank node
    assert.deepStrictEqual(
      findBlankNodes(quad(ex.a, ex.b, ex.c)),
      new Set()
    );

    // One blank node
    assert.deepStrictEqual(
      findBlankNodes(quad(blankNode("77"), ex.b, ex.c)),
      new Set(["77"])
    );

    // Two blank nodes
    assert.deepStrictEqual(
      findBlankNodes(quad(blankNode("77"), ex.b, blankNode("334"))),
      new Set(["77", "334"])
    );

    // With an embedded Blank node
    assert.deepStrictEqual(
      findBlankNodes(
        quad(
          quad(blankNode("77"), ex.a, blankNode("798496")),
          ex.b,
          blankNode("334")
        )
      ),
      new Set(["77", "798496", "334"])
    );
  });
});

describe("rebuildBlankNodes", () => {
  it("should be a function", () => {
    assert(typeof rebuildBlankNodes === 'function');
  });

  it("should not remap non blank nodes quads", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, ex.c),
        quad(ex.z, ex.x, N3.DataFactory.literal("chaton"), ex.ea)
      ])[0],
      [
        quad(ex.z, ex.x, N3.DataFactory.literal("chaton"), ex.ea),
        quad(ex.a, ex.b, ex.c)
      ]
    ));
  });

  it("should map blank nodes", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, blankNode("azjlnrozara"))
      ])[0],
      [
        quad(ex.a, ex.b, blankNode("1"))
      ]
    ));
  });

  it("should map several blank nodes", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, blankNode("azjlnrozara")),
        quad(ex.a, ex.z, ex.azae),
        quad(ex.a, ex.azae, blankNode("second")),
      ])[0],
      [
        quad(ex.a, ex.b, blankNode("1")),
        quad(ex.a, ex.z, ex.azae),
        quad(ex.a, ex.azae, blankNode("2")),
      ]
    ));
  });

  it("should not replace existing blank nodes in range", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, blankNode("2")),
        quad(ex.a, ex.z, ex.azae),
        quad(blankNode("second"), ex.a, ex.azae),
      ])[0],
      [
        quad(ex.a, ex.b, blankNode("2")),
        quad(ex.a, ex.z, ex.azae),
        quad(blankNode("1"), ex.a, ex.azae),
      ]
    ));
  });

  it("should replace embeeded blank node", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("this is me i'm hidden")))
      ])[0],
      [
        quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("1")))
      ]
    ));
  });

  it("Use the same renaming for the same blank node", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("this is me i'm hidden"))),
        quad(ex.s, ex.azeazea, ex.ezroea, blankNode("blankgraph")),
        quad(ex.theHiddenQuad, ex.was, blankNode("this is me i'm hidden"))
      ])[0],
      [
        quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("1"))),
        quad(ex.s, ex.azeazea, ex.ezroea, blankNode("2")),
        quad(ex.theHiddenQuad, ex.was, blankNode("1"))
      ]
    ));
  });

  it("should use the parameter", () => {
    assert(equalsArrayOfQuads(
      rebuildBlankNodes([
        quad(blankNode("azjlnrozara"), ex.p, ex.o)
      ], 777)[0],
      [
        quad(blankNode("777"), ex.p, ex.o)
      ]
    ));
  });

  it("should return the number of blank nodes", () => {
    assert.strictEqual(
      rebuildBlankNodes([
        quad(blankNode("azjlnrozara"), ex.p, ex.o)
      ], 0)[1],
      1
    );
  });
});

describe("Graph Substitution", () => {
  function eq(a: string, b: string, shouldBe: boolean = true) {
    const quadsA = new N3.Parser({ format: 'application/trig-star' }).parse("PREFIX ex: <http://example.org/>\n\n" + a);
    const quadsB = new N3.Parser({ format: 'application/trig-star' }).parse("PREFIX ex: <http://example.org/>\n\n" + b);
      
    const s = shouldBe ? "" : "not ";

    assert.ok(
      isSubstituableGraph(quadsA, quadsB) == shouldBe,
      "== Should " + s + "be substituable: " +
      "///////\n" +
      JSON.stringify(quadsA, null, 2) + "\n" +
      "///////\n" +
      JSON.stringify(quadsB, null, 2) + "\n" +
      "///////\n"
    );
  }

  it("should exist", () => {
    assert(typeof isSubstituableGraph === 'function');
  });

  it("should return true for empty graphs", () => {
    assert(isSubstituableGraph([], []));
  });

  it("should return true if identical", () => {
    const l = [$quad(ex.s, ex.p, ex.o, ex.g)];
    assert(isSubstituableGraph(l, l), "Same with size = 1");

    l.push($quad(ex.s1, ex.p1, ex.o1));
    assert(isSubstituableGraph(l, l), "Same with size = 2");

    l.push($quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney")));
    assert(isSubstituableGraph(l, l), "Same with size = 3 and literal");
  });

  it("should return false if not identical", () => {
    // Obviously differents
    const l1 = [$quad(ex.s, ex.p, ex.o, ex.g)];
    const l2 = [$quad(ex.s, ex.p, ex.o, ex.g1)];
    const l3 = [$quad(ex.s1, ex.p2, ex.o3, ex.g4)];
    assert(!isSubstituableGraph(l1, l2));
    assert(!isSubstituableGraph(l1, l3));
    assert(!isSubstituableGraph(l2, l3));

    // Different literal
    const poney       = [$quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney"))];
    const kitten      = [$quad(ex.s1, ex.p1, N3.DataFactory.literal("Kitten"))];
    const frenchPoney = [$quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney", "fr"))];

    assert(!isSubstituableGraph(poney, kitten));
    assert(!isSubstituableGraph(poney, frenchPoney));
  });

  
  it("should work from trig-star examples", () => {
    eq(
      "ex:a ex:b ex:c .",
      "ex:a ex:b ex:c ."
    );

    eq(
      "ex:a ex:b ex:c .",
      "_:z  ex:b ex:c ."
    );

    eq(
      "<< ex:a ex:b ex:c >> ex:d ex:e .",
      "<< ex:a ex:b ex:c >> ex:d _:BLANK ."
    );

    eq(
      "ex:a ex:p ex:c . ex:a ex:p ex:d . ex:d ex:p ex:d1 . ex:c ex:p ex:c1 .",
      "ex:a ex:p _:d  . _:d ex:p ex:d1 . ex:a ex:p _:c   . _:c  ex:p ex:c1 ."
    );

    eq(
      "ex:a ex:p ex:c . ex:a ex:p ex:d . ex:d ex:p ex:d1 . ex:c ex:p ex:c1 .",
      "ex:a ex:p _:c  . ex:a ex:p _:d  . _:d  ex:p ex:d1 . _:c  ex:p ex:c1 ."
    );
    
    eq(
      "<< ex:a ex:b ex:c >> ex:d ex:e .",
      "<< _:z  ex:b ex:c >> ex:d ex:e ."
    );
    
    eq(
      "<< ex:a ex:b ex:c >> ex:d ex:e .",
      "<< ex:a ex:c _:c  >> ex:d ex:e .",
      false
    );

    eq(
      "ex:a ex:b ex:d .",
      "ex:a ex:c _:z  .",
      false
    );

    // Graph entailment from 1st to 2nd would say true here, but we want false
    eq(
      "ex:s1 ex:p ex:o . ",
      "_:s1  ex:p ex:o . _:s2  ex:p  ex:o .",
      false
    );
  });
});
