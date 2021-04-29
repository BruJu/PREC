const assert = require('assert');
const N3 = require('n3');

const storeAlterer = require('../prec3/store-alterer-from-pattern');

const namespace = require('@rdfjs/namespace');
const ex = namespace("http://example.org/", N3.DataFactory);
const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

const variable = N3.DataFactory.variable;

require("./dataset/DatasetCore.test.js")(
{
    quad: N3.DataFactory.quad,
    literal: N3.DataFactory.literal,
    blankNode: N3.DataFactory.blankNode,
    dataset: t => new (require('../dataset/index.js'))(t)
});

describe('StoreAlterer', function() {
    describe('mapPattern', function() {
        function _equalsPattern(pattern1, pattern2) {
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

        function equalsPattern(bind, source, expected) {
            return _equalsPattern(
                storeAlterer.mapPattern(bind, source),
                expected
            );
        }

        it('should do nothing on empty patterns', function() {
            assert.ok(equalsPattern({}                       , [], []));
            assert.ok(equalsPattern({ "someNode": ex.SomeURI}, [], []));
        })

        it('should work', function() {
            assert.ok(equalsPattern(
                {},
                [[variable("a"), variable("b")]],
                [[variable("a"), variable("b")]]
            ));

            assert.ok(equalsPattern(
                { a: ex.Value },
                [[variable("a"), variable("b")]],
                [[ex.Value, variable("b")]]
            ));
        })
    });


    describe("findFilterReplace", function() {



        it("should work", function() {
            const store = new N3.Store();
            store.addQuad(ex.a, ex.b    , ex.c);
            store.addQuad(ex.a, rdf.type, ex.typeA);

            storeAlterer.findFilterReplace(
                store,
                [[variable("a"), ex.b, ex.c]],
                [[[variable("a"), rdf.type, ex.typeA]]],
                [[variable("a"), ex.b, ex.d]]
            );

            assert.equal(store.size, 2);
            assert.equal(store.getQuads(ex.a, ex.b    , ex.d    ).length, 1);
            assert.equal(store.getQuads(ex.a, rdf.type, ex.typeA).length, 1);
        });

        it("should work", function() {
            const store = new N3.Store();
            store.addQuad(ex.a, ex.b    , ex.c);
            store.addQuad(ex.a, rdf.type, ex.typeA);
            store.addQuad(ex.b, rdf.type, ex.typeA);

            storeAlterer.findFilterReplace(
                store,
                [[variable("a"), ex.b, ex.c]],
                [[[variable("a"), rdf.type, ex.typeB]]],
            );

            assert.equal(store.size, 3);
            assert.equal(store.getQuads(ex.a, ex.b    , ex.c    ).length, 1);
            assert.equal(store.getQuads(ex.a, rdf.type, ex.typeA).length, 1);
        });



    });


    describe("findFilterReplaceRecursive", function() {
        describe("searchInStore", function() {
            const store = new N3.Store();
            store.addQuad(ex.s, ex.p1, ex.o);
            store.addQuad(ex.s, ex.p2, ex.o);
            store.addQuad(ex.s1, ex.p1, ex.o);
            store.addQuad(ex.s2, ex.p2, ex.otherO);
            store.addQuad(N3.DataFactory.quad(ex.ss, ex.so   , ex.sp1), ex.starP, ex.starO);
            store.addQuad(N3.DataFactory.quad(ex.ss, ex.so   , ex.sp2), ex.starP, ex.starO);
            store.addQuad(N3.DataFactory.quad(ex.ss, ex.sobad, ex.sp3), ex.starP, ex.starO);

            it("should work on non rdf-star calls", function() {
                let r = storeAlterer.findFilterReplaceRecursiveHelper.searchInStore(
                    store,
                    N3.DataFactory.quad(
                        N3.DataFactory.variable("s"),
                        N3.DataFactory.variable("p"),
                        N3.DataFactory.variable("o"),
                        N3.DataFactory.variable("g"),
                    )
                );

                assert.strictEqual(r.length, store.size);

                r = storeAlterer.findFilterReplaceRecursiveHelper.searchInStore(
                    store,
                    N3.DataFactory.quad(variable("subjectWithP1"), ex.p1, ex.o)
                );

                assert.strictEqual(r.length, 2);

                r = storeAlterer.findFilterReplaceRecursiveHelper.searchInStore(
                    store,
                    N3.DataFactory.quad(ex.s2, ex.p2, variable("o"))
                );

                assert.strictEqual(r.length, 1);
                assert.ok(r[0].o.equals(ex.otherO));
            });
            
            it("should work on rdf-star calls", function() {
                let r = storeAlterer.findFilterReplaceRecursiveHelper.searchInStore(
                    store,
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


