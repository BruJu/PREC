const assert = require('assert');
const N3 = require('n3');

const storeAlterer = require('../prec3/store-alterer-from-pattern');

const namespace = require('@rdfjs/namespace');
const ex = namespace("http://example.org/", N3.DataFactory);
const rdf = namespace("http://rdf.org/", N3.DataFactory);

const variable = N3.DataFactory.variable;

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
});


