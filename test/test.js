const assert = require('assert');
const N3 = require('n3');

const DStar = require("../src/dataset/index.js");

const namespace = require('@rdfjs/namespace');
const ex = namespace("http://example.org/", N3.DataFactory);
const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

const variable = N3.DataFactory.variable;
const $quad = N3.DataFactory.quad;


describe('DStar', function() {
    describe('bindVariables', function() {
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
                DStar.bindVariables(bind, source),
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
                [$quad(variable("a"), variable("b"), ex.object)],
                [$quad(variable("a"), variable("b"), ex.object)]
            ));

            assert.ok(equalsPattern(
                { a: ex.Value },
                [$quad(variable("a"), variable("b"), ex.object)],
                [$quad(ex.Value     , variable("b"), ex.object)]
            ));
        })
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

    describe("allUsageOfAre", function () {
        it('test1', function () {
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

            assert.ok(
                dstar.allUsageOfAre(ex.subject,
                    [
                        $quad(ex.subject, null, ex.object)
                    ]
                ) !== null
            );

            assert.ok(
                dstar.allUsageOfAre(ex.other,
                    [
                        $quad(ex.other, null, null)
                    ]
                ) !== null
            );

            assert.ok(
                dstar.allUsageOfAre(ex.object,
                    [
                        $quad(ex.other, null, ex.object)
                    ]
                ) === null
            );
        })
    });
});


