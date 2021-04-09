'use strict';

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');
const precUtils = require('./utils.js')

const prec = namespace("http://bruy.at/prec#"             , N3.DataFactory);
const xsd  = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"        , N3.DataFactory);


////////////////////////////////////////////////////////////////////////////////
// ==== N3.Store population with mutli level nested quads
// Solution: A multi nested quad Q are replaced with `[ prec:_ Q ]`
// `prec:_` is similar to `owl:sameAs`

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
        const bn = N3.DataFactory.blankNode();
    
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
    return precUtils.eventuallyRebuildQuad(
        quad,
        term => {
            if (term.termType === 'BlankNode') {
                let quads = store.getQuads(quad, prec._, null, N3.DataFactory.defaultGraph());
                if (quads.length === 0) return quad;
                return getRealQuadFromPrec_(store, quads[0].object);
            } else {
                return term;
            }
        }
    )
}


////////////////////////////////////////////////////////////////////////////////


function readThings(store, predicateIRI, acceptsLiteral, moreComplex) {
    let founds = {};

    let quads = store.getQuads(null, predicateIRI, null);

    for (const baseRule of quads) {
        if (baseRule.subject.termType !== "NamedNode") {
            console.error("Invalid vocab triple:");
            console.error(baseRule);
            console.error("Subject must be an IRI.");
            console.error("Because predicate is: ");
            console.error(predicateIRI);
            continue;
        }

        if (baseRule.object.termType === "Literal") {
            if (!acceptsLiteral) {
                console.error("Invalid vocab triple:");
                console.error(baseRule);
                console.error("Can't use a simple rule for this predicate.");
                continue;
            }

            let sourceLabel = baseRule.object.value;

            if (founds[sourceLabel] === undefined) {
                founds[sourceLabel] = [];
            }

            founds[sourceLabel].push({
                "destination": baseRule.subject,
                "extraRules" : [],
                "priority": 0
            });
        } else {
            // Named node or Blank node are both ok
            if (moreComplex === false) {
                console.error("Invalid vocab triple:");
                console.error(baseRule);
                console.error("Can't use a complex rule for this predicate.");
                continue;
            }

            let mapped = moreComplex(
                store.getQuads(baseRule.object, null, null)
            );

            if (mapped === undefined || mapped == null) {
                console.error("Invalid vocab triple (more complex error):");
                console.error(baseRule);
                continue;
            }

            const [source, extra, priority] = mapped;

            if (source == undefined || extra == undefined) {
                console.error("Invalid vocab triple (???):");
                console.error(baseRule);
                continue;
            }

            if (founds[source] == undefined) {
                founds[source] = [];
            }

            founds[source].push({
                destination: baseRule.subject,
                extraRules : extra,
                priority   : priority
            });
        }
    }

    for (const key in founds) {
        founds[key] = founds[key].sort((lhs, rhs) => {
            let prioDiff = rhs.priority - lhs.priority;

            if (prioDiff !== 0) return prioDiff;

            if (lhs.destination.value < rhs.destination.value) {
                return -1;
            } else if (lhs.destination.value > rhs.destination.value) {
                return 1;
            } else {
                return 0;
            }
        });
    }

    return founds;
}

function readProperties(store) {
    return readThings(
        store,
        prec.propertyIRIOf,
        true,
        quads => {
            let source = undefined;
            let rules = [];
            let priority = 0;
            let forcedPriority = null;

            for (let quad of quads) {
                if (quad.predicate.equals(prec.propertyName)
                    && quad.object.termType == "Literal") {
                    source = quad.object.value;
                } else if (quad.predicate.equals(prec.nodeLabel)
                    && quad.object.termType == "Literal") {
                    rules.push({
                        "@category": "NodeLabel",
                        "nodeLabel": quad.object.value
                    });

                    priority += 1;
                } else if (quad.predicate.equals(prec.relationshipLabel)
                    && quad.object.termType == "Literal") {
                    rules.push({
                        "@category": "RelationshipLabel",
                        "relationshipLabel": quad.object.value
                    });

                    priority += 1;
                } else if (quad.predicate.equals(prec.multiValue) && quad.object.equals(prec.asSet)) {
                    rules.push( { "@category": "AsSet" })
                } else if (quad.predicate.equals(prec.priority)) {
                    // TODO : check if type is integer
                    forcedPriority = parseInt(quad.object.value);
                } else {
                    console.error("Unknown rule description:");
                    console.error(quad);
                    return null;
                }
            }

            if (forcedPriority !== null) {
                priority = forcedPriority;
            }

            return [source, rules, priority];
        }
    );
}

function readInfo(store, term) {
    if (term.termType == "BlankNode") {
        const quads = store.getQuads(term, null, null);

        return quads.map(quad => [quad.predicate, readInfo(store, quad.object)]);
    } else {
        return term;
    }
}

function readRelations(store) {
    return readThings(store, prec.relationshipIRIOf, true, 
        quads => {
            let source = undefined;
            let rules = [];
            let priority = 0;
            let forcedPriority = null;

            for (let quad of quads) {
                if (quad.predicate.equals(prec.relationshipLabel)) {
                    source = quad.object.value;
                } else if (quad.predicate.equals(prec.priority)) {
                    // TODO : check if type is integer
                    forcedPriority = parseInt(quad.object.value);
                } else {
                    if (quad.predicate.equals(prec.sourceLabel)) {
                        ++priority;
                    } else if (quad.predicate.equals(prec.destinationLabel)) {
                        ++priority;
                    }

                    rules.push([quad.predicate, readInfo(store, quad.object)]);
                }
            }

            if (forcedPriority !== null) {
                priority = forcedPriority;
            }

            return source === undefined ? null : [source, rules, priority];
        }
    );
}

function xsdBoolToBool(term) {
    if (term.termType !== "Literal" || !xsd.boolean.equals(term.datatype)) {
        return null;
    }

    if (term.value === "true") {
        return true;
    } else if (term.value === "false") {
        return false;
    } else {
        return null;
    }
}

function readFlags(store) {
    let s = {
        "MetaProperty": true,
        "KeepProvenance": true
    };

    for (const quad of store.getQuads(null, prec.flagState, null)) {
        const object = xsdBoolToBool(quad.object);

        if (object === null) {
            console.error("prec.flagState quad object is invalid");
            console.error(quad);
            continue;
        }

        if (quad.subject.termType == "NamedNode") {
            if (quad.subject.value.startsWith("http://bruy.at/prec#")) {
                const suffix = quad.subject.value.substring("http://bruy.at/prec#".length);

                if (s[suffix] === undefined) {
                    console.error("Unrecognized quad (subject is unknown)");
                    console.error(quad);
                } else {
                    s[suffix] = object;
                }
            }
        } else {
            console.error("Unrecognized quad (subject is unknown)");
            console.error(quad);
        }
    }

    return s;
}

function readRelDefault(store) {
    let quads = store.getQuads(prec.Relationships, prec.useRdfStar, null);

    if (quads.length == 1) {
        if (quads[0].object.equals(prec.AsOccurrences)) {
            return prec.AsOccurrences;
        }
    
        return quads[0].object;
    } else {
        let quads = store.getQuads(prec.Relationships, prec.apply, null);
        if (quads.length !== 1) {
            return N3.DataFactory.literal("false", xsd.boolean);
        }

        let composedOf = store.getQuads(quads[0].object, prec.composedOf)
            .map(q => q.object)
            .map(term => remakeMultiNesting(store, term));

        return composedOf;
    } 
    
}

function readBlankNodeMapping(quads) {
    let s = {};
    for (const quad of quads.getQuads(null, prec.mapBlankNodesToPrefix)) {
        let target = quad.subject;

        if (!target.equals(pgo.Node)
            && !target.equals(pgo.Edge)
            && !target.equals(prec.Property)) {
            console.error("Unknown subject of mapTo " + target.value);
            continue;
        }

        if (quad.object.termType !== "NamedNode") {
            console.error("Object of mapTo must be of type named node");
            continue;
        }

        s[target.value] = quad.object.value;
    }

    return s;
}

/**
 * 
 * @param {N3.Store} store 
 * @param {String} file 
 */
function addBuiltIn(store, file) {
    const trig = fs.readFileSync(file, 'utf-8');
    addQuadsWithoutMultiNesting(store, (new N3.Parser()).parse(trig));
}

class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/builtin_rules.ttl");

        this.properties = readProperties(store);
        this.relations  = readRelations(store);
        this.nodeLabels = readThings(store, prec.nodeLabelIRIOf, true, false);

        this.flags = readFlags(store);

        this.blankNodeMapping = readBlankNodeMapping(store);

        this.relationshipsDefault = readRelDefault(store);
    }

    static _forEachKnown(r, callback) {
        for (let source in r) {
            for (const ruleset of r[source]) {
                callback(source, ruleset["destination"], ruleset["extraRules"]);
            }
        }
    }

    forEachRelation(callback) {
        return Context._forEachKnown(this.relations , callback);
    }
    
    forEachProperty(callback) {
        return Context._forEachKnown(this.properties, callback);
    }

    forEachNodeLabel(callback) {
        return Context._forEachKnown(this.nodeLabels, callback);
    }

    getStateOf(flag) {
        return this.flags[flag];
    }

    getRelationshipDefault() {
        return this.relationshipsDefault;
    }
}

module.exports = Context;
