import assert from 'assert';

import { DataFactory, Parser } from 'n3';
import namespace from '@rdfjs/namespace';
import * as WT from '@bruju/wasm-tree';
import { DatasetCore, NamedNode, Quad, Quad_Predicate, Quad_Subject, Term } from '@rdfjs/types';
import { checkAndFollow, followThrough, getNodesOfType, getPathsFrom } from '../../src/rdf/path-travelling';

const ex = namespace("http://ex.org/", { factory: DataFactory });
const quad = DataFactory.quad;

function toQuads(turtleContent: string): Quad[] {
  return new Parser({
    format: 'application/turtle',
    baseIRI: "http://ex.org/"
  }).parse(turtleContent);
}

function toWTDataset(turtleContent: string): WT.Dataset {
  return new WT.Dataset(toQuads(turtleContent));
}

function testRdfModelSetEquality(result: Term[], expected: Term[]) {
  let expectedMutable = [...expected];

  if (result.length !== expected.length) return false;

  for (let element of result) {
    const j = expectedMutable.findIndex(e => e.equals(element));
    if (j === -1) return false;

    expectedMutable.splice(j, 1);
  }

  return true;
}

function toStringArrayOfTerms(arraysOfTerms: Term[] | null) {
  let s = "[\n";

  if (arraysOfTerms != null) {
    s += arraysOfTerms.map(term => JSON.stringify(term)).join(",\n");
  }

  return s + "\n]";
}

function toStringArrayOfQuads(arraysOfQuads: Quad[] | DatasetCore | null) {
  let s = "[\n";

  if (arraysOfQuads != null) {
    let isFirst = true;
    for (const quad of arraysOfQuads) {
      if (!isFirst) s += " .\n";
      isFirst = false;
      s += "  ";
      s += JSON.stringify(quad.subject) + " / " + JSON.stringify(quad.predicate) + " / " + JSON.stringify(quad.object);
    }
  }

  return s + "\n]";
}

function expectQuad(computed: Term | null, expected: Term | null) {
  function toString(quad: Term | null) {
    if (quad == null) return "null";
    return quad.value;
  }

  assert.ok(
    expected == null ? computed == null : expected.equals(computed),
    "Computed " + toString(computed) + " ; Expected " + toString(expected)
  );
}

describe("Path Travelling Expansion", () => {
  function toDataset(turtleContent: string): WT.Dataset {
    return toWTDataset(
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n" +
      turtleContent
    );
  }

  describe("getNodesOfType", () => {        
    function testNodes(type: NamedNode, turtleContent: string, expectedResult: Term[]) {
      let result = getNodesOfType(toDataset(turtleContent), type);

      assert.ok(testRdfModelSetEquality(result, expectedResult),
        "Nodes of type " + type.value + " of the file\n"
        + turtleContent + '\n'
        + "should be\n"
        + toStringArrayOfTerms(expectedResult)
        + "\nbut is computed as \n"
        + toStringArrayOfTerms(result)
      );
    }

    it("should return an empty list if there are no types", function() {
      testNodes(ex.a, ""             , []);
      testNodes(ex.b, ""             , []);
      testNodes(ex.b, "<s> <p> <o> .", []);
    });

    it("should return an empty list if the given type does not appear as a type", function() {
      testNodes(ex.type2, "<s> rdf:type <type1> .", []);
    });

    it("should return the right subjects if a valid type if given", function() {
      testNodes(ex.type, "<s> rdf:type <type> . ", [ ex.s ]);
      testNodes(ex.type, "<s> rdf:type <type> . <s> rdf:type <type2> .", [ ex.s ]);
      testNodes(ex.type, "<s> rdf:type <type> . <s2> rdf:type <type> . <s3> rdf:type <type2> .", [ ex.s2, ex.s ]);
    });
  });

  describe("getPathsFrom", () => {
    function testPaths(subject: Quad_Subject, ignoreList: Quad_Predicate[] | null, turtleContent: string, expectedResult: Quad[]) {
      let result = getPathsFrom(toDataset(turtleContent), subject, ignoreList || undefined);

      assert.ok(testRdfModelSetEquality(result, expectedResult),
        "Paths from " + subject.value + " of the file\n"
        + turtleContent + '\n'
        + "with ignore list\n"
        + toStringArrayOfTerms(ignoreList)
        + "\nshould be\n"
        + toStringArrayOfQuads(expectedResult)
        + "\nbut is computed as \n"
        + toStringArrayOfQuads(result)
      );
    }

    it("should not return any value if no valid path", function() {
      testPaths(ex.s, null  , "", []);
      testPaths(ex.s, null  , "<s2> <p> <o> .", []);
      testPaths(ex.s, [ex.p], "<s> <p> <o> .", []);
    });

    it("should return all the valid paths", function() {
      testPaths(ex.s, null, "<s> <p> <o> .", [quad(ex.s, ex.p, ex.o)]);
      testPaths(ex.s, null, "<s> <p> <o>, <o2> .", [quad(ex.s, ex.p, ex.o), quad(ex.s, ex.p, ex.o2)]);
      testPaths(ex.s, [ex.p], "<s> <p> <o>; <p2> <o2> .", [quad(ex.s, ex.p2, ex.o2)]);
    });
  });

  describe("following", function() {
    it("followThrough should work", function() {
      expectQuad(followThrough(toDataset(
        ""
      ), ex.subject, ex.predicate), null);

      expectQuad(followThrough(toDataset(
        "<subject> <notpredicate> <object> . "
      ), ex.subject, ex.predicate), null);
      
      expectQuad(followThrough(toDataset(
        "<subject> <predicate>    <object> . "
      ), ex.subject, ex.predicate), ex.object);
      
      expectQuad(followThrough(toDataset(
        "<subject> <predicate>    <object> . \n" +
        "<subject> <notpredicate> <object> . "
      ), ex.subject, ex.predicate), ex.object);

      expectQuad(followThrough(toDataset(
        "<subject> <predicate>    <object> . \n" +
        "<subject> <notpredicate> <object> . "
      ), ex.subject, ex.notpredicate), ex.object);

      expectQuad(followThrough(toDataset(
        "<subject> <predicate>    <object> . \n" +
        "<subject> <notpredicate> <object> . "
      ), ex.subject, ex.predicate), ex.object);

      expectQuad(followThrough(toDataset(
        "<subject> <predicate>    <object1> . \n" +
        "<subject> <predicate>    <object2> . "
      ), ex.subject, ex.predicate), null);

      expectQuad(followThrough(toDataset(
        "<subjectx> <predicate1>   <object1> . \n" +
        "<subjectx> <predicate1>   <object2> . \n" +
        "<subjectx> <predicate2>   <object2> . \n"
      ), ex.subjectx, ex.predicate1), null);

      expectQuad(followThrough(toDataset(
        "<subjectx> <predicate1>   <object1> . \n" +
        "<subjectx> <predicate1>   <object2> . \n" +
        "<subjectx> <predicate2>   <object2> . \n"
      ), ex.subjectx, ex.predicate2), ex.object2);
    });


    it("checkAndFollow", function () {
      // Empty dataset
      expectQuad(checkAndFollow(toDataset(
        ""
      ), 
        ex.subject, ex.predicate,
        [],
        []
      ), null);

      // One triple that matches
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <object> . "
      ), 
        ex.subject, ex.predicate,
        [],
        []
      ), ex.object);

      // One triple that doesn't matches
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <object> . "
      ), 
        ex.subject, ex.wrongpredicate,
        [],
        []
      ), null);

      // Duplicated path
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <object1> . \n" +
        "<subject> <predicate> <object2> ."
      ), 
        ex.subject, ex.predicate,
        [],
        []
      ), null);

      // Bad extra path
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> . \n" +
        "<subject> <otherpath> <objectSecond> ."
      ), 
        ex.subject, ex.predicate,
        [],
        []
      ), null);

      // Required extra path
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> . \n" +
        "<subject> <otherpath> <objectSecond> ."
      ), 
        ex.subject, ex.predicate,
        [[ex.otherpath, ex.objectSecond]],
        []
      ), ex.objectMain);

      // Possible extra path
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> . \n" +
        "<subject> <otherpath> <objectSecond> ."
      ), 
        ex.subject, ex.predicate,
        [],
        [[ex.otherpath, ex.objectSecond]]
      ), ex.objectMain);

      // Missing path
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> ."
      ), 
        ex.subject, ex.predicate,
        [[ex.otherpath, ex.objectSecond]],
        []
      ), null);

      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> ."
      ), 
        ex.subject, ex.predicate,
        [],
        [[ex.otherpath, ex.objectSecond]]
      ), ex.objectMain);

      // 
      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> . \n" +
        "<subject> <otherpath> <objectSecond> . \n" +
        "<subject> <alternate> <objectTer> ."
      ),
        ex.subject, ex.predicate,
        [[ex.alternate, ex.objectTer   ]],
        [[ex.otherpath, ex.objectSecond]]
      ), ex.objectMain);

      expectQuad(checkAndFollow(toDataset(
        "<subject> <predicate> <objectMain> . \n" +
        "<subject> <otherpath> <objectSecond> ."
      ), 
        ex.subject, ex.predicate,
        [[ex.alternate, ex.objectTer   ]],
        [[ex.otherpath, ex.objectSecond]]
      ), null);
    });
  });
});


// TODO:
// -- extendDataset_RWPRECGenerated
// readLabelOf
// readPropertyName
// getRealLabel

