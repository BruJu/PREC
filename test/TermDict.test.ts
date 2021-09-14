import TermDict from "../src/TermDict";
import { ok, strictEqual } from 'assert';

describe("TermDict", () => {
  class TwoInts {
    _value: number;
    _other: number;

    constructor(value: number, other: number) {
      this._value = value;
      this._other = other;
    }

    equals(other: TwoInts) {
      return this._value == other._value && this._other == other._other;
    }

    get value(): string { return this._value.toString(); }
  }

  const E = (a: number, b: number) => new TwoInts(a, b);

  it("get should return undefined if empty", function() {
    const d = new TermDict<TwoInts, number>();
    strictEqual(d.get(E(1, 2)), undefined);
    strictEqual(d.get(E(7, 7)), undefined);
    strictEqual(d.get(E(1, 1)), undefined);
    strictEqual(d.get(E(1, 1)), undefined);
  })

  it("should be able to get back an inserted value", function() {
    const d = new TermDict<TwoInts, string>();
    d.set(E(1, 1), "One-One");
    d.set(E(1, 2), "One-Two");
    d.set(E(2, 1), "Two-One");
    strictEqual(d.get(E(1, 1)), "One-One");
    strictEqual(d.get(E(1, 2)), "One-Two");
    strictEqual(d.get(E(2, 1)), "Two-One");
    strictEqual(d.get(E(1, 3)), undefined);
  });

  it("should be able to replace a value", function() {
    const d = new TermDict<TwoInts, string>();
    d.set(E(10, 10), "old");
    d.set(E(10, 11), "untouched");
    d.set(E(10, 10), "new");
    strictEqual(d.get(E(10, 10)), "new");
    strictEqual(d.get(E(10, 11)), "untouched");
  });

  it("should detect whetever it is empty or not", () => {
    const d = new TermDict<TwoInts, string>();
    ok(d.isEmpty());
    d.set(E(7, 77), "hey");
    ok(!d.isEmpty());
  });
});
