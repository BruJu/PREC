"use strict";

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');

const quadStar         = require('./quad-star.js');
const multiNestedStore = require('./quad-star-multinested-store.js');

const prec = namespace("http://bruy.at/prec#"             , N3.DataFactory);
const xsd  = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"        , N3.DataFactory);


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

            let r = [];
            r.id = baseRule.object;

            founds[sourceLabel].push({
                "destination": baseRule.subject,
                "extraRules" : r,
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

            extra.id = baseRule.object;

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
        prec.IRIOfProperty,
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

function findTermIn(term, list) {
    return list.find(t => t.equals(term));
}

function readRelations(store, subTerms) {
    let subTermsKey = subTerms.map(t => t[0]);

    return readThings(store, prec.IRIOfRelationship, true, 
        quads => {
            let source = undefined;
            let rules = [];
            let priority = 0;
            let forcedPriority = null;

            for (let quad of quads) {
                const p = quad.predicate;
                
                if (prec.relationshipLabel.equals(p)) {
                    source = quad.object.value;
                } else if (prec.priority.equals(p)) {
                    // TODO : check if type is integer
                    forcedPriority = parseInt(quad.object.value);
                } else {
                    let ignored = findTermIn(p, [prec.modelAs, prec.useRdfStar]);
                    if (ignored !== undefined) continue;

                    let sourceOrDest = findTermIn(p, [prec.sourceLabel, prec.destinationLabel]);
                    if (sourceOrDest !== undefined) {
                        ++priority;
                        rules.push([p, readInfo(store, quad.object)]);
                        continue;
                    }

                    let isRenaming = findTermIn(p, subTermsKey);
                    if (!isRenaming) {
                        console.error("- Relationship rule error");
                        console.error("Unrecognized " + p.value + " for " + quad.subject.value);
                    }
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
    multiNestedStore.addQuadsWithoutMultiNesting(store, (new N3.Parser()).parse(trig));
}

/**
 * 
 * @param {N3.Store} store 
 */
function readSubstitutionTerms(store) {
    return store.getQuads(null, prec.substitutionTarget, null, N3.DataFactory.defaultGraph())
        .map(quad => [quad.subject, quad.object]);
}

class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        multiNestedStore.addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/builtin_rules.ttl");

        this.substitutionTerms = readSubstitutionTerms(store);
        this.properties = readProperties(store);
        this.relations  = readRelations(store, this.substitutionTerms);
        this.nodeLabels = readThings(store, prec.IRIOfNodeLabel, true, false);

        this.flags = readFlags(store);

        this.blankNodeMapping = readBlankNodeMapping(store);

        this.store = store;

        this.cachedModels = {};
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

    useRelationshipRule(task, rule) {
        const key = JSON.stringify(rule);

        let composedOf;

        if (this.cachedModels[key] !== undefined) {
            composedOf = this.cachedModels[key];
        } else {
            composedOf = this.store.getQuads(rule, prec.composedOf)
                .map(q => q.object)
                .map(term => multiNestedStore.remakeMultiNesting(this.store, term))

            this.cachedModels[key] = composedOf;
        }

        let rewritePart;
        if (task.rewrite === undefined) {
            rewritePart = this.readOldRelationshipRewrite(task.task);
        } else {
            rewritePart = task.rewrite;
        }      

        return this.rewrite(composedOf, rewritePart);
    }

    /**
     * 
     * @param {Array} composedOf 
     * @param {Array} rewrite 
     * @returns 
     */
    rewrite(composedOf, rewrite) {
        if (rewrite === undefined) return composedOf;

        return composedOf.map(term => quadStar.eventuallyRebuildQuad(
            term,
            t => {
                let r = rewrite.find(x => x[0].equals(t));
                if (r === undefined) return t;
                return r[1];
            }
        ));
    }

    readOldRelationshipRewrite(task) {
        const that = this;
        let d = undefined;
        function find(precTerm, rdfTerm) {
            let quads = that.store.getQuads(task, precTerm, null, N3.DataFactory.defaultGraph());
            if (quads.length !== 1) return;

            d = d || [];
            d.push([rdfTerm, quads[0].object]);
        }

        for (const substitutable of this.substitutionTerms) {
            find(substitutable[0], substitutable[1]);
        }

        return d;
    }

    getRelationshipTransformationRelatedTo(task) {
        if (task.termType === 'Literal') return undefined;

        let useRdfStar = this.store.getQuads(task, prec.useRdfStar, null, N3.DataFactory.defaultGraph());

        if (useRdfStar.length !== 0) {
            const o = useRdfStar[0].object;

            if (N3.DataFactory.literal("false", xsd.boolean).equals(o)) {
                return this.useRelationshipRule({ task: task }, prec.RDFReification);
            } else if (prec.AsOccurrences.equals(o)) {
                return this.useRelationshipRule({ task: task }, prec.RdfStarOccurrence);
            } else if (prec.AsUnique.equals(o)) {
                return this.useRelationshipRule({ task: task }, prec.RdfStarUnique);
            } else {
                console.error("task " + task.value + " has invalid prec:useRdfStar -> " + o.value);
                throw "Context::getRelTrans::useRdfStar";
            }
        }

        let modelAs = this.store.getQuads(task, prec.modelAs, null, N3.DataFactory.defaultGraph());

        if (modelAs.length !== 0) {
            return this.useRelationshipRule({ task: task }, modelAs[0].object);
        }

        // Implicit false
        let rewrite = this.readOldRelationshipRewrite(task);
        if (rewrite === undefined) return undefined;
        return this.useRelationshipRule({ rewrite: rewrite }, prec.RDFReification);
    }
}

module.exports = Context;
