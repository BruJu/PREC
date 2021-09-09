import assert from 'assert';
import * as N3 from 'n3';
import namespace from '@rdfjs/namespace';
const ex = namespace("http://example.org/", { factory: N3.DataFactory });
const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: N3.DataFactory });


import DStar, { Bindings, bindVariables } from "../../src/dataset/index";
import { Quad, Term } from '@rdfjs/types';

const variable = N3.DataFactory.variable;
const $quad = N3.DataFactory.quad;

// TODO: change DStar::allUsageOfAre signature to make TypeScript happy
function $$quad(
  subject: Term | null | undefined,
  predicate: Term | null | undefined,
  object: Term | null | undefined,
  graph?: Term | null | undefined,
) {
  // @ts-ignore
  return $quad(subject, predicate, object, graph);
}

type Pattern = Quad | Pattern[];

function equalsPattern(bind: Bindings, source: Pattern, expected: Pattern) {
  return _equalsPattern(bindVariables(bind, source), expected);
}

function _equalsPattern(pattern1: Pattern, pattern2: Pattern) {
  if (Array.isArray(pattern1) && Array.isArray(pattern2)) {
    if (pattern1.length != pattern2.length) {
      return false;
    }

    for (let i = 0 ; i != pattern1.length ; ++i) {
      if (!_equalsPattern(pattern1[i], pattern2[i])) {
        return false;
      }
    }

    return true;
  } else if (!Array.isArray(pattern1) && !Array.isArray(pattern2)) {
    return pattern1.equals(pattern2);
  } else {
    return false;
  }
}

describe('DStar', () => {
  describe('forEach', () => {
    it('should iterate on every quads', () => {
      const quads = [
        $quad(ex.subject, ex.predicate, ex.object1),
        $quad(ex.subject, ex.predicate, ex.object2)
      ];

      const dstar = new DStar(quads);

      const result: Quad[] = [];
      dstar.forEach(quad => result.push(quad));

      assert.ok(quads.length === result.length);
      quads.forEach(quad => assert.ok(undefined !== result.find(q => q.equals(quad))));
    });
  })


  describe('bindVariables', () => {
    it('should do nothing on empty patterns', () => {
      assert.ok(equalsPattern({}                       , [], []));
      assert.ok(equalsPattern({ "someNode": ex.SomeURI}, [], []));
    });

    it('should work', () => {
      assert.ok(equalsPattern(
        {},
        [$quad(variable("a"), variable("b"), ex.object)],
        [$quad(variable("a"), variable("b"), ex.object)]
      ));

      assert.ok(equalsPattern(
        { a: ex.Value },
        [$quad(variable("a"), variable("b"), ex.object)],
        [$quad(ex.Value     , variable("b"), ex.object)]
      ));
    });
  });

  describe("findFilterReplace", function() {
    it("should work", function() {
      const dstar = new DStar();
      dstar.addFromTurtleStar(
        `
        @prefix ex:  <http://example.org/> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        
        ex:a ex:b  ex:c .
        ex:a a     ex:typeA .
        `
      );

      dstar.findFilterReplace(
        [$quad(variable("a"), ex.b, ex.c)],
        [[$quad(variable("a"), rdf.type, ex.typeA)]],
        [$quad(variable("a"), ex.b, ex.d)]
      );

      assert.strictEqual(dstar.size, 2);
      assert.strictEqual(dstar.getQuads(ex.a, ex.b    , ex.d    ).length, 1);
      assert.strictEqual(dstar.getQuads(ex.a, rdf.type, ex.typeA).length, 1);
    });

    it("should work", function() {
      const dstar = new DStar();
      dstar.addFromTurtleStar(
        `
        @prefix ex:  <http://example.org/> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        
        ex:a ex:b     ex:c     .
        ex:a rdf:type ex:typeA .
        ex:b rdf:type ex:typeA .
        `
      );

      dstar.findFilterReplace(
        [$quad(variable("a"), ex.b, ex.c)],
        [[$quad(variable("a"), rdf.type, ex.typeB)]],
        []
      );

      assert.strictEqual(dstar.size, 3);
      assert.strictEqual(dstar.getQuads(ex.a, ex.b    , ex.c    ).length, 1);
      assert.strictEqual(dstar.getQuads(ex.a, rdf.type, ex.typeA).length, 1);
    });
  });


  describe("searchInStore", () => {
    const dstar = new DStar();
    dstar.addFromTurtleStar(
      `
        @prefix ex: <http://example.org/> .
        ex:s  ex:p1 ex:o .
        ex:s  ex:p2 ex:o .
        ex:s1 ex:p1 ex:o .
        ex:s2 ex:p2 ex:otherO .
        << ex:ss ex:so    ex:sp1 >> ex:starP ex:starO .
        << ex:ss ex:so    ex:sp2 >> ex:starP ex:starO .
        << ex:ss ex:sobad ex:sp3 >> ex:starP ex:starO .
      `
    );

    it("should work on non rdf-star calls", () => {
      let r = dstar.matchPattern(
        $quad(variable("s"), variable("p"), variable("o"), variable("g"))
      );

      assert.strictEqual(r.length, dstar.size);

      r = dstar.matchPattern($quad(variable("subjectWithP1"), ex.p1, ex.o));

      assert.strictEqual(r.length, 2);

      r = dstar.matchPattern($quad(ex.s2, ex.p2, variable("o")));

      assert.strictEqual(r.length, 1);
      assert.ok((r[0].o as Term).equals(ex.otherO));
    });
    
    it("should work on rdf-star calls", () => {
      let r = dstar.matchPattern(
        $quad(
          $quad(ex.ss, ex.so, variable("thesubjectpredicate")),
          ex.starP,
          variable("starO")
        )
      );

      assert.strictEqual(r.length, 2);
    });
  });

  describe("allUsageOfAre", () => {
    it('should work with vanilla RDF', () => {
      const dstar = new DStar();
      dstar.addFromTurtleStar(
        `
          @prefix ex:  <http://example.org/> .
          @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
          
          ex:subject ex:predicate1 ex:object .
          ex:subject ex:predicate2 ex:object .
          ex:other ex:predicate1 ex:object .
        `
      );

      assert.ok(null !== dstar.allUsageOfAre(ex.subject,
        [$$quad(ex.subject, undefined, ex.object)]
      ));

      assert.ok(null !== dstar.allUsageOfAre(ex.other,
        [$$quad(ex.other, undefined, undefined)]
      ));

      assert.ok(null === dstar.allUsageOfAre(ex.object,
        [$$quad(ex.other, undefined, ex.object)]
      ));
    });

    it('should work with RDF-star', () => {
      const dstar = new DStar();
      dstar.addFromTurtleStar(
        `
          @prefix ex:  <http://example.org/> .
          @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
          
          ex:a_former_twitter_user ex:says << ex:toto ex:likes ex:anna >> .
        `
      );

      assert.ok(null !== dstar.allUsageOfAre(ex.toto,
        [$$quad(ex.a_former_twitter_user, ex.says, $$quad(ex.toto, undefined, undefined))]
      ));

      assert.ok(null === dstar.allUsageOfAre(ex.toto,
        [$$quad(undefined, undefined, $$quad(ex.anna, undefined, undefined))]
      ));
    });
  });
});
