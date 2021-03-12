'use strict';

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

const prec = namespace("http://bruy.at/prec#", N3.DataFactory);
const xsd  = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);
const pgo = namespace("http://ii.uwb.edu.pl/pgo#", N3.DataFactory);

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

function readRelDefault(quads) {
    if (quads.length != 1) return N3.DataFactory.literal("false", xsd.boolean);
    
    if (quads[0].object.equals(prec.AsOccurrences)) {
        return prec.AsOccurrences;
    }

    //if (quads[0].object.equals(prec.FlattenUnique)) {
    //    return prec.FlattenUnique;
    //}

    return quads[0].object;
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

class Context {
    constructor(contextQuads) {
        const store = new N3.Store(contextQuads);
    
        this.properties = readProperties(store);
        this.relations  = readRelations(store);
        this.nodeLabels = readThings(store, prec.nodeLabelIRIOf, true, false);

        this.flags = readFlags(store);

        this.blankNodeMapping = readBlankNodeMapping(store);

        this.relationshipsDefault = readRelDefault(store.getQuads(prec.Relationships, prec.useRdfStar, null));
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
