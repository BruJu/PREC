'use strict';

const N3        = require('n3');
const namespace = require('@rdfjs/namespace');
const quadStar  = require('./quad-star.js');

const prec = namespace("http://bruy.at/prec#"             , N3.DataFactory);


// ==== N3.Store population with multi level nested quads
// Problem : << << :a :b :c >> :d :e >> :f :g can't be stored in a N3.Store
// Solution: A multi nested quad Q is replaced with `[ prec:_ Q ]`
// `prec:_` is similar to `owl:sameAs`

/** A function that generates blank nodes prefixes with PREC_ */
function blankNodeGenerator() {
    ++blankNodeGenerator.id;
    return N3.DataFactory.blankNode("PREC_" + blankNodeGenerator.id);
}
blankNodeGenerator.id = 1;

/** Helper namespace for addQuadsWithoutMultiNesting */
let addQuadsWithoutMultiNesting_ = {
    /**
     * A conform quad is a quad that doesn't contain 2 level nested quad or more
     * @param {*} quad 
     * @param {*} todoList 
     */
    zeroLevel: function(quad, todoList) {
        let [cs, s] = this.firstLevel(quad.subject  , todoList);
        let [cp, p] = this.firstLevel(quad.predicate, todoList);
        let [co, o] = this.firstLevel(quad.object   , todoList);
        let [cg, g] = this.firstLevel(quad.graph    , todoList);

        if (cs && cp && co && cg) return quad;
        return N3.DataFactory.quad(s, p, o, g);
    },
    
    firstLevel: function(term, todoList) {
        if (term.termType !== 'Quad') return [true, term];
    
        // 1 level nested quad
        let [cs, s] = this.secondLevel(term.subject  , todoList);
        let [cp, p] = this.secondLevel(term.predicate, todoList);
        let [co, o] = this.secondLevel(term.object   , todoList);
        let [cg, g] = this.secondLevel(term.graph    , todoList);
    
        if (cs && cp && co && cg) return [true, term];
        return [false, N3.DataFactory.quad(s, p, o, g)];
    },

    secondLevel: function(term, todoList) {
        if (term.termType !== 'Quad') return [true, term];
    
        // 2 level nested quad, we have to replace with a blank node
        const bn = blankNodeGenerator();
    
        // We have to add the request to add the blank node semantic
        todoList.push(N3.DataFactory.quad(bn, prec._, term));
    
        return [false, bn];
    }
};

/**
 * Add the given quads to the store. If a quad has multi level nested quads,
 * the multi level will be removed.
 * 
 * Currently, N3.Store does not support storing quads which contains nested
 * quads with several labels.
 * 
 * This function bypass this limitation with the blank nodes using a
 * [ owl:sameAs << s p o >> ] pattern (but prec:_ takes the place of owl:sameAs)
 * @param {N3.Store} store 
 * @param {String} quads 
 */
function addQuadsWithoutMultiNesting(store, quads) {
    if (quads === undefined) return;
    
    // List of quads to add. This list can be extended during the loop
    let todo = [...quads];

    // todo.length is not const!
    for (let i = 0 ; i != todo.length ; ++i) {
        store.addQuad(addQuadsWithoutMultiNesting_.zeroLevel(todo[i], todo));
    }
}

/**
 * Transform a quad that has been un-multi-level-nested into a
 * possibily-nested quad.
 * @param {N3.Store} store 
 * @param {*} quad 
 */
function remakeMultiNesting(store, quad) {
    return quadStar.eventuallyRebuildQuad(
        quad,
        term => {
            if (term.termType === 'BlankNode') {
                let quads = store.getQuads(term, prec._, null, N3.DataFactory.defaultGraph());
                if (quads.length === 0) return term;
                return remakeMultiNesting(store, quads[0].object);
            } else {
                return term;
            }
        }
    )
}

module.exports = { addQuadsWithoutMultiNesting, remakeMultiNesting };
