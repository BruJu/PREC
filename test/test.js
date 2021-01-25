const assert = require('assert');
const N3 = require('N3');

const storeAlterer = require('../prec3/store-alterer-from-pattern');

const namespace = require('@rdfjs/namespace');
const ex = namespace("http://example.org/", N3.DataFactory);

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
    })
});


