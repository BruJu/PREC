
/**
 * A map that uses object.value as a key and the equal function to check if
 * two keys are actually equals.
 * 
 * Note: Keys are currently searched by performing a linear search within
 * the keys that have the same .value
 * 
 * @template Key The type of the keys
 * @template Value The type of the values
 */
 class TermDict {
    /** Build an empty `TermDict` */
    constructor() {
        this.map = {};
    }

    /**
     * Returns the value associated to the given key.
     * @param {Key} key The key
     * @returns {Value?} The associated value or undefined if none were
     * associated to the given key
     */
    /** Return the value stored for key */
    get(key) {
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
     * @param {Key} key The key
     * @param {Value} value The value
     */
    set(key, value) {
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
     * @returns {boolean} True if this Term dict is empty
     */
    isEmpty() {
        return Object.keys(this.map).length === 0;
    }

    /**
     * Calls a function for every (key, value) pair stored in this term dict.
     * @param {function(Key, Value)} callback A consumer of a key and a value
     */
    forEach(callback) {
        for (const kvPairWithSameHash of Object.values(this.map)) {
            for (const [key, value] of kvPairWithSameHash) {
                callback(key, value);
            }
        }
    }
}

module.exports = TermDict;
