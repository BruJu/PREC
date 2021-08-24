
const assert = require('assert');
const utility = require("../utility.js");
const { default: PREC_C } = require("../../src/prec/graph-reducer");

module.exports = function () {
  describe("Blank node mapping", () => {
    it("should map nodes", () => {
      let store = utility.turtleToDStar("_:toto a pgo:Node .");
      assert.strictEqual(store.size, 1);

      let context = utility.turtleToQuads("pgo:Node prec:mapBlankNodesToPrefix <http://totoland/> .");

      PREC_C(store, context);
      
      assert.strictEqual(store.size, 1);
      assert.strictEqual(store.getQuads()[0].subject.termType, "NamedNode")
      assert.ok(store.getQuads()[0].subject.value.startsWith("http://totoland/"))
    });
  });
};
