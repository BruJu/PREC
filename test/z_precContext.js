
const N3 = require("n3");
const utility = require("./utility.js");
const graphReducer = require("../src/prec/graph-reducer.js");
const assert = require('assert');


function storeToString(store) {
    return store.getQuads()
        .map(q =>
            q.subject.value
            + " " + q.predicate.value
            + " " + q.object.value
            + " " + q.graph.value
        )
        .join("\n");
}

/**
 * Checks if the two stores have the same quads
 * @param {N3.Store} store1 
 * @param {N3.Store} store2 
 */
function assertEqualStores(store1, store2) {
    const areEquals = (store1, store2) => {
        let s1 = store1.getQuads();
        let s2 = store2.getQuads();

        if (s1.length != s2.length) {
            return false;
        }

        for (let quad of s1) {
            let i = s2.findIndex(q => quad.equals(q));
            if (i == -1) return false;
        }
    };

    if (areEquals(store1, store2)) {
        assert.ok(true, "stores should be equals");
    } else {
        assert.ok(false, "Both stores should be equals\n"
            + storeToString(store1)
            + "\nand\n"
            + storeToString(store2)
        );
    }
}

describe("PREC context applier", function () {
    it("should map blank nodes", function() {
        let store = utility.turtleToDStar("_:toto a pgo:Node .");
        assert.strictEqual(store.size, 1);

        let context = utility.turtleToQuads("pgo:Node prec:mapBlankNodesToPrefix <http://totoland/> .");

        graphReducer(store, context);
        
        assert.strictEqual(store.size, 1);
        assert.strictEqual(store.getQuads()[0].subject.termType, "NamedNode")
        assert.ok(store.getQuads()[0].subject.value.startsWith("http://totoland/"))
    })
});
