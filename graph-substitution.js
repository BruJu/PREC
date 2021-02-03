const N3 = require('N3');

/** Returns true if the quad has a blank node */
function hasBlankNode(quad) {
    function m(term) {
        if (term.termType === "BlankNode") return true;
        if (term.termType === "Quad") return hasBlankNode(term);
        return false;
    }

    return m(quad.subject) || m(quad.predicate) || m(quad.object) || m(quad.graph);
}


function bNodeLess(node) {
    if (node.termType === "BlankNode") {
        return null;
    } else if (node.termType === "Quad") {
        if (bNodeLess(node.subject) !== null
        && bNodeLess(node.predicate) !== null
        && bNodeLess(node.object) !== null
        && bNodeLess(node.graph) !== null) {
            return node;
        } else {
            return null;
        }

    } else {
        return node;
    }
}

class BlankNodeExplorer {
    constructor(store, range) {
        let scores = {};
        let values = [];

        const patternStore = new N3.Store(store);

        for (let i = range[0] ; i != range[1] ; ++i) {
            const blankNode = N3.DataFactory.blankNode("" + i);

            values.push(blankNode);

            scores[i] = patternStore.getQuads(blankNode, null, null, null).length +
                        patternStore.getQuads(null, blankNode, null, null).length + 
                        patternStore.getQuads(null, null, blankNode, null).length +
                        patternStore.getQuads(null, null, null, blankNode).length;
        }

        this.blankNodes = values.sort((a, b) => scores[a.value] > scores[b.value]);
        this.blankNodesDetails = BlankNodeExplorer.makeDetails(patternStore);
        this.i = 0;
    }

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

        function alwaysTrue(q) { return q; }

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
                        alwaysTrue,
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

    abort() { --this.i; }

    nextListOfSubstitution(target) {
        const blankNode = this.blankNodes[this.i++];
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

    //console.error("<deepSubstitute>");
    //console.error(listOfQuads);
    //console.error(source);
    //console.error(destination);
    //console.error(result);
    //console.error("</deepSubstitute>");

    return result;
}

function _isSubstituableGraph(actualQuads, pattern, blankNodeExplorer) {
    const actualStore = new N3.Store(actualQuads);
    const patternStore = new N3.Store(pattern);

    if (actualStore.size != patternStore.size) {
        return false;
    }

    for (const quad of actualStore.getQuads()) {
        const p = patternStore.getQuads(quad.subject, quad.predicate, quad.object, quad.graph);

        if (p.length == 1) {
            // The quad is in the pattern store
            actualStore.removeQuads([quad]);
            patternStore.removeQuads([quad]);
        }
    }

    if (actualStore.size == 0 && patternStore.size == 0) {
        return true;
    } else if (blankNodeExplorer.hasNonBlankQuad(patternStore)) {
        return false;
    } else {
        const [blankNode, listOfSubstitutions] = blankNodeExplorer.nextListOfSubstitution(actualStore);

        for (const substitution of listOfSubstitutions) {
            if (_isSubstituableGraph(
                actualStore.getQuads(),
                deepSubstitute(patternStore.getQuads(), blankNode, substitution),
                blankNodeExplorer
            )) {
                blankNodeExplorer.abort();
                return true;
            }
        }

        blankNodeExplorer.abort();
        return false;
    }
}

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

function quadWithRemappedBlankNodes(quad, mapping) {
    function remap(term) {
        if (term.termType === "Quad") {
            return N3.DataFactory.quad(
                remap(term.subject),
                remap(term.predicate),
                remap(term.object),
                remap(term.graph)
            );
        } else if (term.termType === "BlankNode") {
            return N3.DataFactory.blankNode(mapping[term.value]);
        } else {
            return term;
        }
    }

    return N3.DataFactory.quad(
        remap(quad.subject),
        remap(quad.predicate),
        remap(quad.object),
        remap(quad.graph)
    );
}

/**
 * Remap every blank nodes in the list of quads to blank nodes from nextBlankNodeId
 * to nextBlankNodeId + the number of blank nodes
 * 
 * Returns [the list of remapped quads, the next number of blank node that would have been
 * attributed].
 * @param {*} listOfQuads The list of quads
 * @param {Number} nextBlankNodeId The first number of blank node, default is 1
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
        rebuilt.push(quadWithRemappedBlankNodes(quad, oldBlankNodes));
    }

    return [rebuilt, nextBlankNodeId];
}

function proxyIsSubstituableGraph(actualQuads, pattern) {
    let [rebuiltActualQuads, endNumber] = rebuildBlankNodes(actualQuads, 0);
    let [rebuiltPattern    , trueEnd  ] = rebuildBlankNodes(pattern    , endNumber);

    const blankNodeExplorer = new BlankNodeExplorer(rebuiltPattern, [endNumber, trueEnd]);
    
    return _isSubstituableGraph(rebuiltActualQuads, rebuiltPattern, blankNodeExplorer);
}

module.exports = {
    isSubstituableGraph: proxyIsSubstituableGraph,
    rebuildBlankNodes: rebuildBlankNodes,
    findBlankNodes: findBlankNodes
};

