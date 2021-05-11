const precUtils = require("../prec3/utils.js");
const assert = require('assert');


describe("TermDict", function() {
    const TermDict = precUtils.TermDict;

    class TwoInts {
        constructor(value, other) {
            this.value = value;
            this.other = other;
        }

        equals(other) {
            return this.value == other.value && this.other == other.other;
        }
    }

    const E = (a, b) => new TwoInts(a, b);

    it("get should return undefined if empty", function() {
        const d = new TermDict();
        assert.strictEqual(d.get(E(1, 2)), undefined);
        assert.strictEqual(d.get(E(7, 7)), undefined);
        assert.strictEqual(d.get(E(1, 1)), undefined);
        assert.strictEqual(d.get(E(1, 1)), undefined);
    })

    it("should be able to get back an inserted value", function() {
        const d = new TermDict();
        d.set(E(1, 1), "One-One");
        d.set(E(1, 2), "One-Two");
        d.set(E(2, 1), "Two-One");
        assert.strictEqual(d.get(E(1, 1)), "One-One");
        assert.strictEqual(d.get(E(1, 2)), "One-Two");
        assert.strictEqual(d.get(E(2, 1)), "Two-One");
    });

    it("should be able to replace a value", function() {
        const d = new TermDict();
        d.set(E(10, 10), "old");
        d.set(E(10, 11), "untouched");
        d.set(E(10, 10), "new");
        assert.strictEqual(d.get(E(10, 10)), "new");
        assert.strictEqual(d.get(E(10, 11)), "untouched");
    });


});
