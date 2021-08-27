import assert from 'assert';
import * as utility from "../utility";
import PREC_C from "../../src/prec/graph-reducer";

module.exports = () => {
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
