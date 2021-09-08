
/**
 * A type can be used as a key of a TermDict if:
 * - It has a readable value property
 * - It has an equals method usable on objects of the same type
 * 
 * To be valid, two objects that are equals must return true must have the same
 * value.
 */
export interface ValidKeyOfTermDict<T> {
  get value(): string;
  equals(other: T): boolean;
}

/**
 * A map that uses object.value as a key and the equal function to check if
 * two keys are actually equals.
 * 
 * Note: Keys are currently searched by performing a linear search within
 * the keys that have the same .value
 */
export default class TermDict<Key extends ValidKeyOfTermDict<Key>, Value> {
  map: {[key: string]: [Key, Value][]} = {};

  /**
   * Returns the value associated to the given key.
   * @param key The key
   * @returns The associated value or undefined if none were associated to the
   * given key
   */
  get(key: Key): Value | undefined {
    let list = this.map[key.value];
    if (list === undefined) return undefined;

    for (let term of list) {
      if (term[0].equals(key)) {
        return term[1];
      }
    }

    return undefined;
  }

  /**
   * Sets the given value for the given key
   * @param key The key
   * @param value The value
   */
  set(key: Key, value: Value) {
    let list = this.map[key.value];
    if (list === undefined) {
      list = [];
      this.map[key.value] = list;
    }

    for (let term of list) {
      if (term[0].equals(key)) {
        term[1] = value;
        return;
      }
    }

    list.push([key, value]);
  }

  /**
   * Checks if the term dict is empty
   * @returns True if this Term dict is empty
   */
  isEmpty(): boolean { return Object.keys(this.map).length === 0; }

  /**
   * Calls a function for every (key, value) pair stored in this term dict.
   * @param callback A bi-consumer of a key and a value
   */
  forEach(callback: (key: Key, value: Value) => void) {
    for (const kvPairWithSameHash of Object.values(this.map)) {
      for (const [key, value] of kvPairWithSameHash) {
        callback(key, value);
      }
    }
  }
}
