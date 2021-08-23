"use strict";

const N3 = require('n3');
const DStar = require('../dataset');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');

const QuadStar         = require('../rdf/quad-star');
const PrecUtils        = require('../rdf/utils');
const RulesForEdges      = require('./rules-for-edges');
const RulesForNodeLabels = require('./rules-for-nodelabels');
const RulesForProperties = require('./rules-for-properties');
const { default: TermDict } = require('../TermDict');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const xsd  = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"             , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"       , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"        , N3.DataFactory);

const variable     = N3.DataFactory.variable;
const $blankNode    = N3.DataFactory.blankNode;
const $defaultGraph = N3.DataFactory.defaultGraph;
const $quad         = N3.DataFactory.quad;

/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 * @typedef { import("rdf-js").Dataset } Dataset
 * @typedef { import("../dataset") } DStar
 * @typedef { import("./RuleType").RuleDomain } RuleDomain
 */

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/**
 * Sort the elements an array by `element.priority`. The
 * higher the priority, the lower the element is.
 * @param {Array} array The array to sort
 */
function _sortArrayByPriority(array) {
    array.sort((lhs_, rhs_) => {
        let lhs = lhs_.priority;
        let rhs = rhs_.priority;

        // User defined priority
        if (lhs[0] !== rhs[0]) {
            return rhs[0] - lhs[0]
        }

        // Our priority
        if (lhs[1] < rhs[1]) return -1;
        if (lhs[1] > rhs[1]) return 1;
        return 0;
    });
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/** Manager for a list of terms that are substituable in a given context. */
class SubstitutionTerms {
    /**
     * Build a `SubstitutionTerms` with the subsitution terms described in the
     * context dataset.
     * @param {DStar} dataset A dataset that contains all the quads of the
     * context
     */
    constructor(dataset) {
        this.data = dataset.getQuads(null, prec.substitutionTarget, null, $defaultGraph())
            .map(quad => [quad.subject, quad.object]);

        this.keys = this.data.map(t => t[0]);
        
        Object.freeze(this.data);
        Object.freeze(this.keys);
    }

    /**
    * Return the list of substituable terms.
    * @returns The list of substituable terms
    */
    getKeys() { return this.keys; }

    /**
     * Return the term that is targetted by the given substitution term
     * @param {*} term An RDF/JS term
     * @returns The term that is targetted by this term
     */
    get(term) {
        return this.data.find(t => t[0].equals(term))[1];
    }
}

////////////////////////////////////////////////////////////////////////////////
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  

/**
 * Helper functions that read a rule and split its values in a JS dictionnary.
 */
class SplitNamespace {
    /**
     * Reads all the quads about a rule and builds a JS object from it
     * @param {DStar} contextDataset The store
     * @param {*} ruleNode The node that represents the rule
     * @param {*} Cls A dict that contains the IRI related to the kind of rules
     * to manage.
     * @param {SubstitutionTerms} substitutionTerms The list of substitution
     * terms known in the context graph.
     * @returns An object with the data about the node. Throws if the rule is
     * invalid.
     * 
     * The object has the form:
     * ```
     * {
     *   type: type of the rule,
     * 
     *   conditions: {
     *     label: undefined | the relatiosnip label or property name targetted
     * by this rule (value of Cls.MainLabel),
     *     explicitPriority: value of prec:priority,
     *     otherLength: - other.length,
     *     other: The list of [condition, value], where condition is a term
     * from Cls.PossibleConditions, and value is its value. It contains the
     * conditions on other things than the label.
     *   }
     * 
     *   materialization: {
     *      templatedBy: name of the template to template with,
     *      substitutions: list of pairs of [substitutedTerm, substitutitedWith]
     *   }
     * }
     * ```
     */
    static splitDefinition(contextDataset, ruleNode, Cls, substitutionTerms) {
        let r = {
            type: undefined,
    
            conditions: {
                label: undefined,
                explicitPriority: undefined,
                otherLength: 0,
                other: []
            },
    
            materialization: {
                templatedBy: undefined,
                substitutions: []
            }
        };
    
        function errorMalformedRule(message) {
            return Error(`Rule ${ruleNode.value} is malformed - ${message}`);
        }
    
        function throwIfNotALiteral(term, predicate) {
            if (term.termType !== "Literal")
                throw errorMalformedRule(`${predicate.value} value (${term.value}) is not a literal.`)
        }
        
        for (const quad of contextDataset.getQuads(ruleNode, null, null, $defaultGraph())) {
            if (rdf.type.equals(quad.predicate)) {
                r.type = quad.object;
            } else if (Cls.MainLabel.equals(quad.predicate)) {
                if (r.conditions.label !== undefined)
                    throw errorMalformedRule(`${predicate.value} should appear only once.`);
                
                throwIfNotALiteral(quad.object, quad.predicate);
                r.conditions.label = quad.object;
            } else if (prec.priority.equals(quad.predicate)) {
                if (r.conditions.explicitPriority !== undefined)
                    throw errorMalformedRule(`prec:priority should have at most one value.`);
                
                throwIfNotALiteral(quad.object, quad.predicate);
                if (!xsd.integer.equals(quad.object.datatype)) {
                    throw errorMalformedRule(`prec:priority object should be of type xsd:integer`);
                }
                
                r.conditions.explicitPriority = parseInt(quad.object.value);
            } else if (PrecUtils.termIsIn(quad.predicate, Cls.PossibleConditions)) {
                r.conditions.other.push([quad.predicate, quad.object]);
            } else if (prec.templatedBy.equals(quad.predicate)) {
                if (r.materialization.templatedBy !== undefined)
                    throw errorMalformedRule(`prec:templatedBy should have at most one value.`);
                
                r.materialization.templatedBy = quad.object;
            } else if (PrecUtils.termIsIn(quad.predicate, substitutionTerms.getKeys())) {
                let substitutedTerm = substitutionTerms.get(quad.predicate);
                r.materialization.substitutions.push([substitutedTerm, quad.object]);
            } else {
                throw errorMalformedRule(`Unknown predicate ${quad.predicate.value}`);
            }
        }

        r.conditions.otherLength = -r.conditions.other.length;

        r.conditions.other.sort((lhs, rhs) => {
            const l = JSON.stringify(lhs);
            const r = JSON.stringify(rhs);

            if (l < r) return -1;
            if (l > r) return 1;
            return 0;
        })
    
        return r;
    }

    /**
     * Throw if other fields than the one in materialization have been filled
     * = this rule have been filled with other things than a template name and
     * substitution terms.
     */
    static throwIfNotMaterializationOnly(splitDefinition, rule) {
        let r = splitDefinition.type === undefined
            && splitDefinition.conditions.label === undefined
            && splitDefinition.conditions.explicitPriority === undefined
            && splitDefinition.conditions.otherLength === 0;
        
        if (!r) {
            throw Error(`Rule ${rule.value} is malformed: It should not have`
                + ` have any condition and should not be typed.`
                + "\n" + JSON.stringify(splitDefinition, null, 2)
            );
        }
    }

    /**
     * Throw if the condition fields have not been filled = this rule is
     * incomplete.
     */
    static throwIfHaveNoCondition(splitDefinition, rule, Cls) {
        function throwError(message) {
            throw Error(`Rule ${rule.value} is malformed: ${message}`)
        }

        if (splitDefinition.type === undefined) {
            throwError("Unknown type");
        }

        if (splitDefinition.conditions.label === undefined) {
            throwError(`It should have a value for ${Cls.MainLabel.value}`)
        }
    }
}

/**
 * 
 * @param {DStar | N3.Store} dataset 
 * @param {Term} template 
 * @param {RuleDomain} ruleDomain 
 * @returns { { composedOf: Quad[], entityIs: null | Term[]) } }
 */
function readRawTemplate(dataset, template, ruleDomain) {
    // Load the abstract template
    let composedOf = dataset.getQuads(template, prec.composedOf, null, $defaultGraph())
        .map(quad => quad.object)
    
    // We keep backward compatibility until our first paper on PREC is rejected
    const toRemove = [];
    for (const templateQuad of composedOf) {
        let po = false;

        if (templateQuad.predicate.equals(pvar.propertyPredicate)) {
            if (templateQuad.object.equals(pvar.propertyObject)) {
                po = true;
            } else {
                throw Error('Invalid template');
            }
        } else if (templateQuad.predicate.equals(pvar.metaPropertyPredicate)) {
            if (templateQuad.object.equals(pvar.metaPropertyObject)) {
                po = true;
            } else {
                throw Error('Invalid template');
            }
        } else {
            if (QuadStar.containsTerm(pvar.propertyPredicate)
                || QuadStar.containsTerm(pvar.propertyObject)
                || QuadStar.containsTerm(pvar.metaPropertyPredicate)
                || QuadStar.containsTerm(pvar.metaPropertyObject)) {
                throw Error('Invalid template');
            }
        }

        if (po) {
            toRemove.push(templateQuad);
        }
    }

    composedOf = composedOf.filter(q => !toRemove.includes(q));
    
    let entityIs = toRemove.map(q => $quad(q.subject, prec._forPredicate, prec._forPredicate));
        
    if (ruleDomain.PropertyHolderSubstitutionTerm !== null) {
        entityIs.push(...
            dataset.getQuads(template, ruleDomain.PropertyHolderSubstitutionTerm, null, $defaultGraph())
                .map(q => $quad(q.object, prec._forPredicate, prec._forPredicate))
        );

        if (entityIs.length === 0) {
            entityIs = findImplicitEntity(ruleDomain.EntityIsHeuristic, composedOf)
                ?.map(t => $quad(t, prec._forPredicate, prec._forPredicate))
                || null;
        }
    }

    return { composedOf, entityIs };
}

/**
 * Build the concrete template from a list of materializations
 * @param {DStar} dataset The context store
 * @param {*} materializations The list of materializations that applies
 * @param {RuleDomain} ruleDomain The List of IRIs related ot the type of rule
 * @returns {Template} The template (= destination pattern in find-filter-replace)
 */
function _buildTemplate(dataset, materializations, ruleDomain) {
    let template = ruleDomain.DefaultTemplate;
    let substitutionRequests = new TermDict();

    for (const materialization of materializations) {
        // Copy all substitution
        for (const sub of materialization.substitutions) {
            if (substitutionRequests.get(sub[0]) === undefined) {
                substitutionRequests.set(sub[0], sub[1]);
            }
        }

        // Is the template there?
        if (materialization.templatedBy !== undefined) {
            template = materialization.templatedBy;
            break;
        }
    }
    
    const { composedOf, entityIs } = readRawTemplate(dataset, template, ruleDomain);

    function remapFunc(term) {
        return QuadStar.eventuallyRebuildQuad(
            term,
            t => {
                let r = substitutionRequests.get(t);
                if (r === undefined) return t;
                return r;
            }
        )
    }

    return {
        quads: composedOf.map(remapFunc),
        entityIs: entityIs === null ? null : entityIs.map(remapFunc)
    };
}

/**
 * Returns true if term is either the subject, the predicate, the object
 * or the graph of the quad
 * @param {Term} term The term
 * @param {Quad} quad The quad
 * @returns {boolean}
 */
function isAMainComponentOf(term, quad) {
    return quad.subject.equals(term)
        || quad.predicate.equals(term)
        || quad.object.equals(term)
        || quad.graph.equals(term);
}

/**
 * 
 * @param {Term[][]} searchedTermss 
 * @param {Quad[]} quads 
 * @returns 
 */
function findImplicitEntity(searchedTermss, quads) {
    for (const searchedTerms of searchedTermss) {
        const c = quads.filter(q => searchedTerms.every(term => isAMainComponentOf(term, q)));

        if (c.length === 0) continue;

        if (searchedTerms.length === 1) {
            return searchedTerms;
        }

        const td = new TermDict();
        
        c.forEach(t => td.set(t, true));
        
        let l = [];
        td.forEach(unique => l.push(unique));
        
        if (l.length !== 1) return null;
        return l;
    }

    return null;
}

/**
 * A manager manage every rules of a kind
 */
class EntitiesManager {
    /**
     * Build an `EntitiesManager` from the `contextDataset`.
     * @param {DStar} contextDataset The store that contains the context
     * @param {SubstitutionTerms} substitutionTerms The list of term substitutions
     * @param {RuleDomain & any} Cls The class that manages an individual rule. It must also
     * contain as static data the list of IRIs related to this rule.
     */
    constructor(contextDataset, substitutionTerms, Cls) {
        // List of rules to apply
        this.iriRemapper = [];
        // List of known (and computed) templates
        this.templatess = new TermDict();

        // TODO: what is a materialization?
        // TODO: what happens here?

        let makeTemplate = materializations => _buildTemplate(contextDataset, materializations, Cls);

        // Load the base templates
        let baseTemplates = new TermDict();

        for (let [templateName, _] of Cls.TemplateBases) {
            // Read the node, ensure it just have a template
            const splitted = SplitNamespace.splitDefinition(contextDataset, templateName, Cls, substitutionTerms);
            SplitNamespace.throwIfNotMaterializationOnly(splitted, templateName);

            // The template can be used to compute other templates
            baseTemplates.set(templateName, splitted.materialization);
            // Also a tempalte that can be used
            let tm = new TermDict();
            tm.set(templateName, makeTemplate([splitted.materialization]));
            this.templatess.set(templateName, tm);
        }

        // Load the templates for user defined rules
        let existingNodes = {};
        for (let quad of contextDataset.getQuads(null, rdf.type, Cls.RuleType, $defaultGraph())) {
            const splitted = SplitNamespace.splitDefinition(contextDataset, quad.subject, Cls, substitutionTerms);
            SplitNamespace.throwIfHaveNoCondition(splitted, quad.subject, Cls);

            let conditions = JSON.stringify(splitted.conditions);
            if (existingNodes[conditions] !== undefined) {
                throw Error(
                    `Invalid context: nodes ${existingNodes[conditions].value} `
                    + `and ${quad.subject.value} `
                    + `have the exact same target`
                );
            }
            existingNodes[conditions] = quad.subject;

            // Read remapping=
            this.iriRemapper.push(new Cls(splitted.conditions, conditions, quad.subject));

            for (const [templateName, forbiddenPredicates] of Cls.TemplateBases) {
                // Check if this template x the current base template are compatible
                let forbidden = forbiddenPredicates.find(forbiddenPredicate =>
                    splitted.conditions.other.find(c => c[0].equals(forbiddenPredicate)) !== undefined
                ) !== undefined;
                
                if (forbidden) continue;

                // Add the pair
                const template = makeTemplate([splitted.materialization, baseTemplates.get(templateName)])
                this.templatess.get(templateName).set(quad.subject, template);
            }
        }
        
        _sortArrayByPriority(this.iriRemapper)
    }

    /**
     * Return the template contained in the given description node
     * @param {Term} descriptionNode The description node
     * @returns The template, or undefined if not specified by the user
     */
    getTemplateFor(ruleNode, type) {
        let templatesOfType = this.templatess.get(type);
        return templatesOfType.get(ruleNode)
            // If not found, use to the one used for the whole type instead
            || templatesOfType.get(type);
    }

    /**
     * Refine the rules to apply depending on the kind of rule of this manager
     * @param {DStar} dataset The marked dataset
     */
    refineRules(dataset) {
        this.iriRemapper.forEach(rule => {
            const { source, conditions, destination } = rule.getFilter();
            dataset.findFilterReplace(source, conditions, destination);
        });
    }
}


////////////////////////////////////////////////////////////////////////////////
// Anything Goes

/**
 * Read the `prec:?s prec:flagState true|false` triples
 * and return a map of `?s -> true|false`
 * @param {N3.Store|DStar} store 
 */
function readFlags(store) {
    let s = {
        "KeepProvenance": true
    };

    for (const quad of store.getQuads(null, prec.flagState, null, $defaultGraph())) {
        const object = PrecUtils.xsdBoolToBool(quad.object);

        if (object === undefined) {
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

/**
 * Read the
 * `(pgo:Node | pgo:Edge | prec:PropertyKey) prec:mapBlankNodesToPrefix ?o`
 * triples and return the map `[s.value] = ?o`.
 * 
 * This extracts the prefix to map each type of elements from the property graph
 * @param {N3.Store|DStar} store The context store
 */
function readBlankNodeMapping(store) {
    let s = {};
    for (const quad of store.getQuads(null, prec.mapBlankNodesToPrefix, null, $defaultGraph())) {
        let target = quad.subject;

        if (!target.equals(pgo.Node)
            && !target.equals(pgo.Edge)
            && !target.equals(prec.PropertyKey)) {
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
 * Read the quads from a Turtle-star file and add them to the dataset.
 * @param {Dataset} dataset The dataset to populate
 * @param {String} file The path to the Turtle-star file
 */
function addBuiltIn(dataset, file) {
    const trig = fs.readFileSync(file, 'utf-8');
    dataset.addAll((new N3.Parser()).parse(trig));
}

/**
 * Replaces every relationship related term with its edge related counterpart.
 * @param {Dataset} dataset The store to modify
 */
function replaceSynonyms(dataset) {
    function makeSynonymsDict() {
        let dict = new TermDict();
        dict.set(prec.RelationshipRule      , prec.EdgeRule);
        dict.set(prec.RelationshipTemplate  , prec.EdgeTemplate);
        dict.set(prec.relationshipLabel     , prec.edgeLabel);
        dict.set(prec.Relationships         , prec.Edges);
        dict.set(prec.RelationshipProperties, prec.EdgeProperties);
        dict.set(prec.IRIOfRelationshipLabel, prec.IRIOfEdgeLabel);
        dict.set(prec.relationshipIRI       , prec.edgeIRI);
        dict.set(pvar.relationshipIRI       , pvar.edgeIRI);
        dict.set(pvar.relationship          , pvar.edge);
        return dict;
    }

    /**
     * Transform the dataset by replacing the terms found in the dict to the one
     * it maps to
     * @param {Dataset} dataset 
     * @param {TermDict<Term, Term>} dict A Term to term dict
     */
    function transformStore(dataset, dict) {
        const toDelete = [];
        const toAdd = [];

        for (const quad of dataset) {
            const newQuad = QuadStar.eventuallyRebuildQuad(quad,
                term => dict.get(term) || term
            );

            if (quad !== newQuad) {
                toDelete.push(quad);
                toAdd.push(newQuad);
            }
        }

        toDelete.forEach(quad => dataset.delete(quad));
        dataset.addAll(toAdd);
    }

    transformStore(dataset, makeSynonymsDict());
}

/**
 * Replace the triples in the form `iri prec:IRIOfThing label .` in the store
 * with a fully developed rule.
 * 
 * The fully developed rule is:
 * ```
 * [] a <IRIs.RuleType> ; <IRIs.MainLabel> label ; <IRIs.SubstitutionTerm> iri .
 * ```
 * with prec:IRIOfThing = `IRIs.ShortcutIRI`
 * 
 * @param {DStar} dstar The context
 * @param {*} IRIs An object that contains the different IRIs
 */
function _removeSugarForRules(dstar, IRIs) {
    let sugared = dstar.getQuads(null, IRIs.ShortcutIRI, null, $defaultGraph());

    for (let quad of sugared) {
        const iri = quad.subject;
        const label = quad.object;

        if (label.termType !== 'Literal') {
            throw Error(
                `${IRIs.ShortcutIRI.value} only accepts literal in object position - `
                + `found ${label.value} (a ${label.termType}) for ${iri.value}`
            );
        }
        const ruleNode = $blankNode("SugarRule[" + label.value + "=>" + iri.value + "]");
        dstar.add($quad(ruleNode, rdf.type             , IRIs.RuleType));
        dstar.add($quad(ruleNode, IRIs.MainLabel       , label));
        dstar.add($quad(ruleNode, IRIs.SubstitutionTerm, iri));
    }

    dstar.removeQuads(sugared);
}

/**
 * Replace every quad in the form `prec:Properties ?p ?o ?g` with the quads :
 * ```
 * prec:NodeProperties ?p ?o ?g .
 * prec:EdgeProperties ?p ?o ?g .
 * prec:MetaProperties ?p ?o ?g .
 * ```
 * @param {DStar} context The dataset that contains the context quads
 */
function _copyPropertiesValuesToSpecificProperties(context) {
    context.findFilterReplace([
            $quad(prec.Properties    , variable('p'), variable('o'), variable('g'))
        ], [], [
            $quad(prec.NodeProperties, variable('p'), variable('o'), variable('g')),
            $quad(prec.EdgeProperties, variable('p'), variable('o'), variable('g')),
            $quad(prec.MetaProperties, variable('p'), variable('o'), variable('g')),
        ]
    )
}

/**
 * A `Context` is an object that stores every data that is stored in a context
 * file in a way to make it possible to transform a store that contains a PREC0
 * RDF graph into a graph that is more suitable for the end user need = that
 * uses proper IRIs and easier to use reification representations.
 */
class Context {
    constructor(contextQuads) {
        const dataset = new DStar(contextQuads);
        addBuiltIn(dataset, __dirname + "/../builtin_rules.ttl");
        replaceSynonyms(dataset);

        const substitutionTerms = new SubstitutionTerms(dataset);

        _removeSugarForRules(dataset, RulesForEdges.Rule);
        this.edges      = new EntitiesManager(dataset, substitutionTerms, RulesForEdges.Rule);
        
        _removeSugarForRules(dataset, RulesForProperties.Rule);
        _copyPropertiesValuesToSpecificProperties(dataset);
        this.properties = new EntitiesManager(dataset, substitutionTerms, RulesForProperties.Rule);

        _removeSugarForRules(dataset, RulesForNodeLabels.Rule   );
        this.nodeLabels = new EntitiesManager(dataset, substitutionTerms, RulesForNodeLabels.Rule);

        this.flags = readFlags(dataset);
        this.blankNodeMapping = readBlankNodeMapping(dataset);
    }

    /**
     * Refine the rule to apply for RDF nodes that has been marked with 
     * `?node prec:__appliedEdgeRule, prec:Edges`
     * @param {DStar} dataset The dataset 
     */
    refineEdgeRules(dataset) { this.edges.refineRules(dataset); }

    /**
     * Refine the rule to apply for RDF nodes that has been marked with 
     * `?node prec:XXXX, prec:XXX`
     * @param {DStar} dataset The dataset 
     */
    refinePropertyRules(dataset) { this.properties.refineRules(dataset); }

    /**
     * Refine the rule to apply for RDF nodes that has been marked with 
     * `?node prec:XXX, prec:XXX`
     * @param {DStar} dataset The dataset 
     */
    refineNodeLabelRules(dataset) { this.nodeLabels.refineRules(dataset); }


    getStateOf(flag) {
        return this.flags[flag];
    }

    /**
     * Fetches the template corresponding to the given `ruleNode`.
     * 
     * The source pattern is expected to be something like
     * 
     * ```javascript
     *  [
     *     [variable("edge"), rdf.type     , pgo.Edge             ],
     *     [variable("edge"), rdf.subject  , variable("subject")  ],
     *     [variable("edge"), rdf.predicate, variable("predicate")],
     *     [variable("edge"), rdf.object   , variable("object")   ]
     *  ]
     * ```
     * 
     * @param {Term} ruleNode The rule node
     * @returns {Template} The template to give to the
     * `storeAlterer.findFilterReplace` function as the destination pattern
     * after replacing the variables with actual terms.
     */
    findEdgeTemplate(ruleNode) {
        return this.edges.getTemplateFor(ruleNode, prec.Edges);
    }

    /**
     * Same as `findEdgeTemplate` but for properties.
     * `type` should be `prec:(Node|Edge|Meta)Properties`
     */
    findPropertyTemplate(ruleNode, type) {
        return this.properties.getTemplateFor(ruleNode, type);
    }

    getNodeLabelTemplateQuads(ruleNode) {
        return this.nodeLabels.getTemplateFor(ruleNode, prec.NodeLabels).quads;
    }
}

module.exports = Context;
module.exports.readRawTemplate = readRawTemplate;
