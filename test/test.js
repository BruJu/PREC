const assert = require('assert');
const N3 = require('n3');

const DStar = require("../dataset/index.js");

const namespace = require('@rdfjs/namespace');
const ex = namespace("http://example.org/", N3.DataFactory);
const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

const variable = N3.DataFactory.variable;
const $quad = N3.DataFactory.quad;

require("./dataset/DatasetCore.test.js")(
{
    quad: N3.DataFactory.quad,
    literal: N3.DataFactory.literal,
    blankNode: N3.DataFactory.blankNode,
    dataset: t => new (require('../dataset/index.js'))(t)
});

describe('StoreAlterer', function() {
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


    describe("DStar", function() {
        describe("searchInStore", function() {
            const Quad = N3.DataFactory.quad;

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

            it("should work on non rdf-star calls", function() {
                let r = dstar.matchPattern(
                    Quad(
                        variable("s"),
                        variable("p"),
                        variable("o"),
                        variable("g")
                    )
                );

                assert.strictEqual(r.length, dstar.size);

                r = dstar.matchPattern(
                    N3.DataFactory.quad(variable("subjectWithP1"), ex.p1, ex.o)
                );

                assert.strictEqual(r.length, 2);

                r = dstar.matchPattern(
                    N3.DataFactory.quad(ex.s2, ex.p2, variable("o"))
                );

                assert.strictEqual(r.length, 1);
                assert.ok(r[0].o.equals(ex.otherO));
            });
            
            it("should work on rdf-star calls", function() {
                let r = dstar.matchPattern(
                    N3.DataFactory.quad(
                        N3.DataFactory.quad(
                            ex.ss,
                            ex.so,
                            variable("thesubjectpredicate")
                        ),
                        ex.starP,
                        variable("starO")
                    )
                );

                assert.strictEqual(r.length, 2);
            });

        })

    })
});


