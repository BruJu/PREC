const assert = require('assert');

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const ex = namespace("http://ex.org/", N3.DataFactory);

const { isSubstituableGraph, rebuildBlankNodes, findBlankNodes } = require("../graph-substitution.js");

function equalsArrayOfQuads(a, b) {
    if (a.length != b.length) return false;

    for (let quad of a) {
        if (b.every(qb => !quad.equals(qb))) {
            return false;
        }
    }

    return true;
}

// Test equals array of quads
() => {
    assert(equalsArrayOfQuads([], []));
    assert(equalsArrayOfQuads([
        N3.DataFactory.quad(ex.a, ex.b, ex.c)
    ], [
        N3.DataFactory.quad(ex.a, ex.b, ex.c)
    ]));
    assert(equalsArrayOfQuads([
        N3.DataFactory.quad(ex.a, ex.b, ex.c),
        N3.DataFactory.quad(ex.a, ex.b, ex.d)
    ], [
        N3.DataFactory.quad(ex.a, ex.b, ex.d),
        N3.DataFactory.quad(ex.a, ex.b, ex.c)
    ]));
    assert(!equalsArrayOfQuads([
        N3.DataFactory.quad(ex.a, ex.b, ex.c),
        N3.DataFactory.quad(ex.a, ex.b, ex.d)
    ], [
        N3.DataFactory.quad(ex.a, ex.b, ex.e),
        N3.DataFactory.quad(ex.a, ex.b, ex.c)
    ]));
}


describe("findBlankNodes", function() {
    const quad = N3.DataFactory.quad;
    const blankNode = N3.DataFactory.blankNode;

    it("should work", function() {
        // No blank node
        assert.deepStrictEqual(
            findBlankNodes(quad(ex.a,ex.b,ex.c)),
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

describe("rebuildBlankNodes", function() {
    const quad = N3.DataFactory.quad;
    const blankNode = N3.DataFactory.blankNode;

    it("should be a function", function() {
        assert(typeof rebuildBlankNodes === 'function');
    });

    it("should not remap non blank nodes quads", function() {
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
    })

    it("should map blank nodes", function() {
        assert(equalsArrayOfQuads(
            rebuildBlankNodes([
                quad(ex.a, ex.b, blankNode("azjlnrozara"))
            ])[0],
            [
                quad(ex.a, ex.b, blankNode("1"))
            ]
        ));
    })

    it("should map several blank nodes", function() {
        assert(equalsArrayOfQuads(
            rebuildBlankNodes([
                quad(ex.a, ex.b, blankNode("azjlnrozara")),
                quad(ex.a, ex.z, ex.azae),
                quad(ex.a, blankNode("second"), ex.azae),
            ])[0],
            [
                quad(ex.a, ex.b, blankNode("1")),
                quad(ex.a, ex.z, ex.azae),
                quad(ex.a, blankNode("2"), ex.azae),
            ]
        ));
    })

    it("should not replace existing blank nodes in range", function() {
        assert(equalsArrayOfQuads(
            rebuildBlankNodes([
                quad(ex.a, ex.b, blankNode("2")),
                quad(ex.a, ex.z, ex.azae),
                quad(ex.a, blankNode("second"), ex.azae),
            ])[0],
            [
                quad(ex.a, ex.b, blankNode("2")),
                quad(ex.a, ex.z, ex.azae),
                quad(ex.a, blankNode("1"), ex.azae),
            ]
        ));
    })

    it("should replace embeeded blank node", function() {
        assert(equalsArrayOfQuads(
            rebuildBlankNodes([
                quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("this is me i'm hidden")))
            ])[0],
            [
                quad(ex.a, ex.b, quad(ex.z, ex.e, blankNode("1")))
            ]
        ));
    })

    it("Use the same renaming for the same blank node", function() {
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
    })

    it("should use the parameter", function() {
        assert(equalsArrayOfQuads(
            rebuildBlankNodes([
                quad(blankNode("azjlnrozara"), ex.p, ex.o)
            ], 777)[0],
            [
                quad(blankNode("777"), ex.p, ex.o)
            ]
        ));
    })

    it("should return the number of blank nodes", function() {
        assert.strictEqual(
            rebuildBlankNodes([
                quad(blankNode("azjlnrozara"), ex.p, ex.o)
            ], 0)[1],
            1
        );
    })
});


describe("Graph Substitution", function() {
    function eq(a, b, shouldBe) {
        if (shouldBe === undefined) {
            shouldBe = true;
        }

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

    it("should work from trig-star examples", function() {
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


    });
    


    it("should exist", function() {
        assert(typeof isSubstituableGraph === 'function');
    });

    it("should return true for empty graphs", function() {
        assert(isSubstituableGraph([], []));
    });

    it("should return true if identical", function() {
        const l = [N3.DataFactory.quad(ex.s, ex.p, ex.o, ex.g)];
        assert(isSubstituableGraph(l, l), "Same with size = 1");

        l.push(N3.DataFactory.quad(ex.s1, ex.p1, ex.o1));
        assert(isSubstituableGraph(l, l), "Same with size = 2");

        l.push(N3.DataFactory.quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney")));
        assert(isSubstituableGraph(l, l), "Same with size = 3 and literal");
    });

    it("should return false if not identical", function() {
        // Obviously differents
        const l1 = [N3.DataFactory.quad(ex.s, ex.p, ex.o, ex.g)];
        const l2 = [N3.DataFactory.quad(ex.s, ex.p, ex.o, ex.g1)];
        const l3 = [N3.DataFactory.quad(ex.s1, ex.p2, ex.o3, ex.g4)];
        assert(!isSubstituableGraph(l1, l2));
        assert(!isSubstituableGraph(l1, l3));
        assert(!isSubstituableGraph(l2, l3));

        // Different literal
        const poney       = [N3.DataFactory.quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney"))];
        const kitten      = [N3.DataFactory.quad(ex.s1, ex.p1, N3.DataFactory.literal("Kitten"))];
        const frenchPoney = [N3.DataFactory.quad(ex.s1, ex.p1, N3.DataFactory.literal("Poney", "fr"))];

        assert(!isSubstituableGraph(poney, kitten));
        assert(!isSubstituableGraph(poney, frenchPoney));
    });



});



