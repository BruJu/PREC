const N3 = require('n3');

/** 
 * This file contains a (slow) graph substitution implementation. It is used for
 * PREC unit tests
 * 
 * @see proxyIsSubstituableGraph for a definition of a valid graph substitution
 */

/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 */

/**
 * Checks if the given term-star is or contains a blank node.
 * @param {Term} term The term-star to explore
 * @returns {boolean} True if the term is or contains a blank node
 */
function hasBlankNode(term) {
    if (term.termType === "BlankNode") return true;
    if (term.termType !== "Quad") return false;

    return hasBlankNode(term.subject)
        || hasBlankNode(term.predicate)
        || hasBlankNode(term.object)
        || hasBlankNode(term.graph);
}

/**
 * Returns the given node if it doesn't contain a blank node, null if it
 * contains any
 * @param {Term} term The term
 * @returns {Term|null} The term if it doesn't contain any blank node, null if
 * it does.
 */
function bNodeLess(term) {
    return hasBlankNode(term) ? null : term;
}

/**
 * A class that prepares the list fo blank nodes from a list of quads, to be
 * able to find substitutions of these blank nodes for other terms to match a
 * store.
 */
class BlankNodeExplorer {
    /**
     * Construct a blank node explorer: an objet that knows the list of blank
     * node that will need to be substitued.
     * 
     * The list of blank nodes and informations about where the blank node
     * appears are stored in this class.
     * 
     * @param {*} patternQuads The list of quads that contains the blank node
     * @param {*} range An array of two integers, the first is the number of the
     * lowest numbered blank node. The second is the number of the highest
     * numbered blank node + 1. Only blank nodes in this range will be
     * substitued.
     */
    constructor(patternQuads, range) {
        let scores = {};    // Blank node name -> number of non nested occurrences
        let values = [];    // The list of blank nodes

        const patternStore = new N3.Store(patternQuads);

        // For each blank node to substitute, we count the number of times it
        // appears. Then we will able to sort them from the blank node that
        // appears the most often to the less often.
        // The counting is heuristic as it doesn't account for nested blank
        // nodes.
        for (let i = range[0] ; i != range[1] ; ++i) {
            const blankNode = N3.DataFactory.blankNode("" + i);

            values.push(blankNode);

            scores[i] = patternStore.getQuads(blankNode, null, null, null).length +
                        patternStore.getQuads(null, blankNode, null, null).length + 
                        patternStore.getQuads(null, null, blankNode, null).length +
                        patternStore.getQuads(null, null, null, blankNode).length;
        }

        // The list of blank nodes in store, 
        this.blankNodes = values.sort((a, b) => scores[a.value] > scores[b.value]);

        // Blank nodes details is a mapping from
        // blank node -> [ s, p, o, g, filter, finder ]
        // See makeDetails for more details
        this.blankNodesDetails = BlankNodeExplorer.makeDetails(patternStore);
        this.i = 0; // Next node to explore: the first one
    }

    /**
     * For each blank nodes, gives a path to retrieve a quad with a similar
     * shape from the store.
     * Example: if the blank node is in the quad "ex:s ex:p _:bn", we want to
     * to know that similar quads are the ones with a "ex:s ex:p ???" pattern.
     *
     * The path is splitted in 6 parts : s, p, o, g, filter, finder
     * - s, p, o, g : Parameters to give to the getQuads method to filter the
     * quads.
     * - filter: a predicate function on quad, that filters the wrong nested
     * quads.
     * - finder: a function that if given the right quad, retrieves the blank
     * node. In other word, in run throught the path of nested quads.
     * 
     * @param {*} store 
     * @returns 
     */
    static makeDetails(store) {
        function merge(details, term, s, p, o, g, zzz, conditions) {
            if (term.termType === "BlankNode") {
                if (details[term.value] === undefined) {
                    details[term.value] = [
                        s, p, o, g,
                        quad => conditions.every(c => c(quad)),
                        quad => zzz(quad)
                    ];
                }
            } else if (term.termType === "Quad") {
                for (const tt of ["subject", "predicate", "object", "graph"]) {
                    const copy = [...conditions];

                    for (const tt_ of ["subject", "predicate", "object", "graph"]) {
                        if (tt != tt_) {
                            const bl = bNodeLess(term[tt_]);
                            copy.push(quad => bl === null || zzz(quad)[tt_].equals(bl));
                        }
                    }

                    merge(
                        details,
                        term[tt],
                        s, p, o, g,
                        quad => zzz(quad)[tt],
                        copy
                    );    
                }
            }
        }

        let details = {};

        function identity(q) { return q; }

        for (const quad of store.getQuads()) {
            for (const where of ["subject", "predicate", "object", "graph"]) {
                if (quad[where].termType === "Quad") {
                    merge(
                        details,
                        quad[where],
                        where === "subject"   ? null : bNodeLess(quad.subject)  ,
                        where === "predicate" ? null : bNodeLess(quad.predicate),
                        where === "object"    ? null : bNodeLess(quad.object)   ,
                        where === "graph"     ? null : bNodeLess(quad.graph)    ,
                        q => q[where],
                        []
                    );
                } else if (quad[where].termType === "BlankNode") {
                    details[quad[where].value] = [
                        where === "subject"   ? null : bNodeLess(quad.subject)  ,
                        where === "predicate" ? null : bNodeLess(quad.predicate),
                        where === "object"    ? null : bNodeLess(quad.object)   ,
                        where === "graph"     ? null : bNodeLess(quad.graph)    ,
                        identity,
                        q => q[where]
                    ];
                }
            }
        }

        return details;
    }

    /**
     * Returns true if the store is empty of blank node or if there are no more
     * blank node to explore
     * 
     * TODO: Both should be equivalent by construction?
     */
    hasNonBlankQuad(store) {
        if (this.i == this.blankNodes.length) {
            return true;
        }

        for (const quad of store.getQuads()) {
            if (!hasBlankNode(quad)) {
                return true;
            }
        }

        return false;
    }

    nextListOfSubstitution(target) {
        const blankNode = this.blankNodes[this.i];
        const [subject, predicate, object, graph, filter, finder] = this.blankNodesDetails[blankNode.value];
    
        return [
            blankNode,
        // 2/ Find all corresponding quads in target
            target
            .getQuads(subject, predicate, object, graph)
            .filter(filter)
        // 3/ Make the list
            .map(quad => finder(quad))
        ];
    }

    /**
     * Given a predicate that checks if a proposed subsititution is valid or
     * not, explores every possible subsitution until one is valid.
     * 
     * The main purpose of this function is to ensure the blank node exploration
     * index (this.i) is properly moved
     * 
     * @param {*} actualStore The current state of the destination store
     * @param {*} substituableChecker A predicate that returns true if the
     * proposed substitution is valid
     */
    forEachPossibleSubstitution(actualStore, substituableChecker) {
        // Find a list of candidates
        const [blankNode, listOfSubstitutions] = this.nextListOfSubstitution(actualStore);
        
        // If another call to nextListOfSubstitution is made in the loop, we
        // want it to explore the next blank node.
        ++this.i;

        // See if there exists a valid subsitution for this blank node
        for (const substitution of listOfSubstitutions) {
            if (substituableChecker(blankNode, substitution)) {
                // Yes: we forward true
                --this.i;       // ensure the object remains in a valid state
                return true;
            }
        }

        // No more candidate
        --this.i;
        return false;
    }
}


/** Replace the components of the quad equals to source with destination */
function deepSubstituteOneQuad(quad, source, destination) {
    function r(term) {
        if (source.equals(term)) {
            return destination;
        } else if (term.termType === "Quad") {
            return deepSubstituteOneQuad(term, source, destination);
        } else {
            return term;
        }
    }

    return N3.DataFactory.quad(
        r(quad.subject),
        r(quad.predicate),
        r(quad.object),
        r(quad.graph)
    );
}

/**
 * Build a new list of quads for which the quads in listOfQuads have the member
 * equals to source replaced with destination
 */
function deepSubstitute(listOfQuads, source, destination) {
    const result = [];

    for (const quad of listOfQuads) {
        result.push(deepSubstituteOneQuad(quad, source, destination));
    }

    return result;
}

function _isSubstituableGraph(actualQuads, pattern, blankNodeExplorer) {
    // 1) Transform the list of quads into N3 stores
    const actualStore = new N3.Store(actualQuads);
    const patternStore = new N3.Store(pattern);

    // 2) If different sizes, they are not substituable
    if (actualStore.size != patternStore.size) {
        return false;
    }

    // 3) Remove quads that appear in both graphs
    for (const quad of actualStore.getQuads()) {
        const p = patternStore.getQuads(quad.subject, quad.predicate, quad.object, quad.graph);

        if (p.length == 1) {
            // The quad is in the pattern store
            actualStore.removeQuads([quad]);
            patternStore.removeQuads([quad]);
        }
    }

    // 4) If both graph are empty, they are obviously substituable (they are strictly equal)
    if (actualStore.size == 0 && patternStore.size == 0) {
        return true;
    }
    
    // 5) If there is no blank node in the pattern store, we won't be able to do an substitution = fail
    if (blankNodeExplorer.hasNonBlankQuad(patternStore)) {
        return false;
    }

    // 6) Substitute a blank node of pattern to a term of actualQuads
    return blankNodeExplorer.forEachPossibleSubstitution(actualStore, (blankNode, substitution) => {
        // We are given a blank node and a candidate substitution, we have to
        // check if it is valid
        return _isSubstituableGraph(
            actualStore.getQuads(),
            deepSubstitute(patternStore.getQuads(), blankNode, substitution),
            blankNodeExplorer
        )
    });
}

/** Computes the list of blank nodes that composes the quad */
function findBlankNodes(quad) {
    let m = new Set();

    function read(term) {
        if (term.termType === "Quad") {
            read(term.subject);
            read(term.predicate);
            read(term.object);
            read(term.graph);
        } else if (term.termType === "BlankNode") {
            m.add(term.value);
        }
    }

    read(quad.subject);
    read(quad.predicate);
    read(quad.object);
    read(quad.graph);

    return m;
}

/**
 * Given a quad and a mapping between old blank node names and new blank node
 * names, map every blank node in the quad to the blank node assigned in the
 * mapping.
 * 
 * In other world, this function renames the blank node of a quad
 * 
 * Precondition: Every blank node name must appear in mapping
 * 
 * @param {*} quad The quad
 * @param {*} mapping The correspondance of old blank node names to new ones
 * @returns A quad for which every blank node is remapped to a new blank node
 * according to mapping
 */
function _renameBlankNodesOfQuad(quad, mapping) {
    function renameBlankNodesOfTerm(term) {
        if (term.termType === "Quad") {
            return N3.DataFactory.quad(
                renameBlankNodesOfTerm(term.subject),
                renameBlankNodesOfTerm(term.predicate),
                renameBlankNodesOfTerm(term.object),
                renameBlankNodesOfTerm(term.graph)
            );
        } else if (term.termType === "BlankNode") {
            return N3.DataFactory.blankNode(mapping[term.value]);
        } else {
            return term;
        }
    }

    return N3.DataFactory.quad(
        renameBlankNodesOfTerm(quad.subject),
        renameBlankNodesOfTerm(quad.predicate),
        renameBlankNodesOfTerm(quad.object),
        renameBlankNodesOfTerm(quad.graph)
    );
}

/**
 * Remap every blank node in the list of quads to blank nodes from nextBlankNodeId
 * to nextBlankNodeId + the number of blank nodes
 * 
 * Returns [the list of remapped quads, the next number of blank node that would have been
 * attributed].
 * @param {Quad[]} listOfQuads The list of quads
 * @param {Number} nextBlankNodeId The first number of blank node, default is 1
 * @returns {[Quad[], Number]}
 */
function rebuildBlankNodes(listOfQuads, nextBlankNodeId) {
    if (nextBlankNodeId === undefined) {
        nextBlankNodeId = 1;
    }

    // Make the list of blank nodes in list of quads
    let newBlankNodes = {};

    let oldBlankNodes = {};

    for (let quad of listOfQuads) {
        const listOfBlankNodes = findBlankNodes(quad);

        for (const blankNodeName of listOfBlankNodes) {
            if (oldBlankNodes[blankNodeName] === undefined) {
                oldBlankNodes[blankNodeName] = "" + (nextBlankNodeId);

                newBlankNodes[nextBlankNodeId] = blankNodeName;

                nextBlankNodeId++;
            }
        }
    }

    // Do not rename blank nodes to blank nodes names that already appears
    for (let attributedNumber in newBlankNodes) {
        if (oldBlankNodes[attributedNumber] !== undefined) {
            // We have :
            // oldBlankNode             newBlankNode
            // [a] = 0                  [0] = a
            // [0] = 1                  [1] = 0
            //
            // where 0 is attributedNumber
            // a is oldBlankNodes[attributedNumber]

            // Swap oldBlankNodes
            const oldTarget = oldBlankNodes[attributedNumber];

            let a = newBlankNodes[attributedNumber];

            if (oldBlankNodes[a] !== attributedNumber) {
                // Should never happen
                return false;
            }

            oldBlankNodes[a] = oldBlankNodes[attributedNumber];
            oldBlankNodes[attributedNumber] = attributedNumber;

            // Swap newBlankNodes
            newBlankNodes[oldTarget] = a;
            newBlankNodes[attributedNumber] = attributedNumber;
        }
    }

    // Make the substitution
    const rebuilt = [];

    for (const quad of listOfQuads) {
        rebuilt.push(_renameBlankNodesOfQuad(quad, oldBlankNodes));
    }

    return [rebuilt, nextBlankNodeId];
}

/**
 * Returns true if pattern is substituable to actualQuads.
 * 
 * A pattern graph is substituable to another one if a mapping from the blank
 * nodes of the pattern graph to the terms of the other graph exists, in which
 * every blank node is mapped to a different term.
 */
function proxyIsSubstituableGraph(actualQuads, pattern) {
    // Ensure that the blank nodes used in the two lists of quads are different
    let [rebuiltActualQuads, endNumber] = rebuildBlankNodes(actualQuads, 0);
    let [rebuiltPattern    , trueEnd  ] = rebuildBlankNodes(pattern    , endNumber);

    // Policy for blank node exploration
    const blankNodeExplorer = new BlankNodeExplorer(rebuiltPattern, [endNumber, trueEnd]);
    
    // Check if the two list of nodes are "isomorphic".
    return _isSubstituableGraph(rebuiltActualQuads, rebuiltPattern, blankNodeExplorer);
}

module.exports = {
    isSubstituableGraph: proxyIsSubstituableGraph,
    rebuildBlankNodes: rebuildBlankNodes,
    findBlankNodes: findBlankNodes
};

