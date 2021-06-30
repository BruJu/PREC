"use strict";

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');

const QuadStar         = require('./quad-star.js');
const MultiNestedStore = require('./quad-star-multinested-store.js');
const PrecUtils        = require('./utils.js');
const RulesForEdges = require('./rules-for-edges');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
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
 * @typedef { import("../dataset") } DStar
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
     * context store.
     * @param {N3.Store} store A store that contains all the quads of the context
     */
    constructor(store) {
        this.data = store.getQuads(null, prec.substitutionTarget, null, $defaultGraph())
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
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  

/** An individual property rule */
class PropertyRule {
    // ==== IRIs related to property rules, to discover the rules and build the
    // definition

    static RuleType           = prec.PropertyRule;
    static DefaultTemplate    = prec.Prec0Property;
    static MainLabel          = prec.propertyName;
    static PossibleConditions = [prec.nodeLabel, prec.edgeLabel]
    static TemplateBases = [
        [prec.NodeProperties, [prec.edgeLabel]                ],
        [prec.EdgeProperties, [                prec.nodeLabel]],
        [prec.MetaProperties, [prec.edgeLabel, prec.nodeLabel]]
    ];
    static ShortcutIRI        = prec.IRIOfProperty;
    static SubstitutionTerm   = prec.propertyIRI;

    // ==== One rule management

    /** Build a Property Rule manager from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [
            [
                $quad(variable('propertyKey'), rdf.type, prec.PropertyLabel)
            ]
        ];
        this.ruleNode = ruleNode;

        // prec:propertyName
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad(variable('propertyKey'), rdfs.label, conditions.label)
                ]
            );
        }

        // prec:priority
        if (conditions.explicitPriority !== undefined) {
            this.priority = [conditions.explicitPriority, hash];
        } else {
            this.priority = [undefined, hash];
        }

        function throwError(predicate, message) {
            throw Error(
                `${iri.value} prec:IRIOfProperty ${description.value} - Error on the description node : ` +
                `${predicate.value} ${message}`
            );
        }

        // prec:nodeLabel, prec:edgeLabel
        let reservedFor = 'None';
        for (const [key, value] of conditions.other) {
            if (prec.nodeLabel.equals(key)) {
                if (reservedFor == 'Edge') {
                    throwError(p, "Found a node as object but this property rule is reserved for edges by previous rule");
                }

                PropertyRule._processRestrictionOnEntity(value, this.conditions, pgo.Node, rdf.type, mess => throwError(e, mess));
                reservedFor = 'Node';
            } else if (prec.edgeLabel.equals(key)) {
                if (reservedFor == 'Node') {
                    throwError(p, "Found an edge as object but this property rule is reserved for nodes by previous rule");
                }

                PropertyRule._processRestrictionOnEntity(value, this.conditions, pgo.Edge, rdf.predicate, mess => throwError(e, mess));
                reservedFor = 'Edge';
            } else {
                throw Error(
                    "Invalid state: found a condition of type "
                    + key.value + " but it should already have been filtered out"
                );
            }
        }
    }

    /** Adds the condition for a prec:nodeLabel / prec:edgeLabel restriction */
    static _processRestrictionOnEntity(object, conditions, type_, labelType, throwError) {
        if (prec.any.equals(object)) {
            conditions.push([
                $quad(variable("entity"), rdf.type, type_)
            ]);
        } else if (object.termType === 'Literal') {
            conditions.push([
                $quad(variable("entity"), labelType , variable("label")),
                $quad(variable("entity"), rdf.type  , type_            ),
                $quad(variable("label") , rdfs.label, object           )
            ]);
        } else {
            throwError(p, "has invalid object");
        }
    }

    /**
     * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
     * the properties that match this manager with its rule node.
     */
    getFilter() {
        return {
            source: [
                $quad(variable("property"), prec.__appliedPropertyRule, prec._NoPropertyRuleFound),
                $quad(variable("entity")  , variable("propertyKey")   , variable("property")     )
            ],
            conditions: this.conditions,
            destination: [
                $quad(variable("property"), prec.__appliedPropertyRule, this.ruleNode       ),
                $quad(variable("entity")  , variable("propertyKey")   , variable("property"))
            ]
        };
    }
}

const TemplateChecker = {
    /**
     * Return true if every embedded triple used in the template is asserted.
     * @param {Quad[]} template An array of quads that constitute the template
     */
    embeddedTriplesAreAsserted: function(template) {
        const invalidTriple = template.find(triple => {
            return undefined !== ["subject", "predicate", "object", "graph"].find(role => {
                const embedded = triple[role];
                if (embedded.termType !== 'Quad') return false;
                return undefined === template.find(assertedTriple => assertedTriple.equals(embedded));
            });
        });

        return invalidTriple === undefined;
    },

    /**
     * Return true if the given term only appear in subject-star position.
     * 
     * Subject-star means that the term can only be the subject, the subject
     * of the embedded triple in subject (subject-subject), ...
     * In other words, in a N-Triple-star document, it is the first pure RDF
     * term that appears in the triple.
     * @param {Quad[]} template An array of quads that constitute the template
     * @param {Term} onlyAsSubject The term that must only appear in subject-star
     * position
     */
    termMustBeInSubjectStarPosition: function(template, onlyAsSubject) {
        function _isInvalidTerm(term) {
            if (term.termType !== 'Quad') {
                return false;
            }
            
            if (QuadStar.containsTerm(term.predicate, [onlyAsSubject])) return true;
            if (QuadStar.containsTerm(term.object   , [onlyAsSubject])) return true;
            if (QuadStar.containsTerm(term.graph    , [onlyAsSubject])) return true;
    
            return _isInvalidTerm(term.subject);
        }

        return undefined === template.find(quad => _isInvalidTerm(quad));
    }
};

/**
 * Check if there are no template that have pvar:entity at another place than
 * subject.
 * 
 * Throws if there is one
 * @param {PrecUtils.TermDict} templatess A map of map of templates
 */
function _throwIfInvalidPropertyTemplates(templatess) {
    const pvarEntity = pvar.entity;

    function _hasInvalidMetaPropertyUsage(term) {
        // TODO: refine the verification
        const mpkey = term.predicate.equals(pvar.metaPropertyPredicate);
        const mpvalue = term.object.equals(pvar.metaPropertyObject);
        return mpkey !== mpvalue;
    }

    templatess.forEach((classRule, templates) => {
        templates.forEach((templateName, template) => {
            // pvar:entity in subject-star position
            if (!TemplateChecker.termMustBeInSubjectStarPosition(template, pvarEntity)) {
                throw Error(
                    "Propriety Template checker: found pvar:entity somewhere" +
                    " else as subjet in template " + classRule.value + " x " +
                    templateName.value
                );
            }

            for (const quad of template) {
                // ?s pvar:metaPropertyPredicate pvar:metaPropertyObject
                if (_hasInvalidMetaPropertyUsage(quad)) {
                    throw Error(
                        "Propriety Template checker: pvar:metaPropertyPredicate and pvar:metaPropertyObject" +
                        " may only be used in triples of form << ?s pvar:metaPropertyPredicate pvar:metaPropertyObject >>"
                        + " but the template { " + classRule.value + " x " + templateName.value + " } "
                        + " violates this restriction"
                    );
                }
            }

            // Used Embedded triples must be asserted
            if (!TemplateChecker.embeddedTriplesAreAsserted(template)) {
                throw Error("Property Template checker: the template "
                + templateName.value
                + " is used as a property template but contains an"
                + " embedded triple that is not asserted.");
            }
        });
    });
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
     * @param {N3.Store} contextStore The store
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
    static splitDefinition(contextStore, ruleNode, Cls, substitutionTerms) {
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
        
        for (const quad of contextStore.getQuads(ruleNode, null, null, $defaultGraph())) {
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
 * Build the concrete template from a list of materializations
 * @param {N3.Store} store The context store
 * @param {*} materializations The list of materializations that applies
 * @param {Term} defaultTemplate The IRI of the default template if no template
 * have been specified
 * @returns {Quad[]} The template (= destination pattern in find-filter-replace)
 */
function _buildTemplate(store, materializations, defaultTemplate) {
    let template = defaultTemplate;
    let substitutionRequests = new PrecUtils.TermDict();

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

    // Load the abstract template
    let composedOf = store.getQuads(template, prec.composedOf, null, $defaultGraph())
        .map(quad => quad.object)
        .map(term => MultiNestedStore.remakeMultiNesting(store, term));
    
    // Apply the substitutions if any
    if (substitutionRequests.isEmpty()) {
        return composedOf;
    }

    return composedOf.map(term => QuadStar.eventuallyRebuildQuad(
        term,
        t => {
            let r = substitutionRequests.get(t);
            if (r === undefined) return t;
            return r;
        }
    ));
}

/**
 * A manager manage every rules of a kind
 */
class EntitiesManager {
    /**
     * Build an `EntitiesManager` from the `contextStore`.
     * @param {N3.Store} contextStore The store that contains the context
     * @param {SubstitutionTerms} substitutionTerms The list of term substitutions
     * @param {*} Cls The class that manages an individual rule. It must also
     * contain as static data the list of IRIs related to this rule.
     */
    constructor(contextStore, substitutionTerms, Cls) {
        // List of rules to apply
        this.iriRemapper = [];
        // List of known (and computed) templates
        this.templatess = new PrecUtils.TermDict();

        // TODO: what is a materialization?
        // TODO: what happens here?

        let makeTemplate = materializations =>
            _buildTemplate(contextStore, materializations, Cls.DefaultTemplate)
        ;

        // Load the base templates
        let baseTemplates = new PrecUtils.TermDict();

        for (let [templateName, _] of Cls.TemplateBases) {
            // Read the node, ensure it just have a template
            const splitted = SplitNamespace.splitDefinition(contextStore, templateName, Cls, substitutionTerms);
            SplitNamespace.throwIfNotMaterializationOnly(splitted, templateName);

            // The template can be used to compute other templates
            baseTemplates.set(templateName, splitted.materialization);
            // Also a tempalte that can be used
            let tm = new PrecUtils.TermDict();
            tm.set(templateName, makeTemplate([splitted.materialization]));
            this.templatess.set(templateName, tm);
        }

        // Load the templates for user defined rules
        let existingNodes = {};
        for (let quad of contextStore.getQuads(null, rdf.type, Cls.RuleType, $defaultGraph())) {
            const splitted = SplitNamespace.splitDefinition(contextStore, quad.subject, Cls, substitutionTerms);
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

/** An individual node label rule */
class NodeLabelRule {
    // ==== IRIs related to nodes

    static RuleType           = prec.NodeLabelRule;
    static DefaultTemplate    = prec.NodeLabelsTypeOfLabelIRI;
    static MainLabel          = prec.nodeLabel;
    static PossibleConditions = [];
    static TemplateBases      = [[prec.NodeLabels, []]];
    static ShortcutIRI        = prec.IRIOfNodeLabel;
    static SubstitutionTerm   = prec.nodeLabelIRI;

    // ==== One rule

    /** Build a node label rule from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [];
        this.ruleNode = ruleNode;

        // prec:nodeLabel
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad(variable("node")     , rdf.type  , variable("nodeLabel")),
                    $quad(variable("nodeLabel"), rdfs.label, conditions.label)
                ]
            );
        }

        // prec:priority
        if (conditions.explicitPriority !== undefined) {
            this.priority = [conditions.explicitPriority, hash];
        } else {
            this.priority = [undefined, hash];
        }
    }

    /**
     * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
     * the nodes that matches this rule with its rule node.
     */
    getFilter() {
        const markedTriple = $quad(
            variable("node"), rdf.type, variable("nodeLabel")
        );

        return {
            source: [
                $quad(markedTriple, prec.__appliedNodeRule, prec.NodeLabels)
            ],
            conditions: this.conditions,
            destination: [
                $quad(markedTriple, prec.__appliedNodeRule, this.ruleNode)
            ]
        };
    }
}

/**
 * Read the `prec:?s prec:flagState true|false` triples
 * and return a map of `?s -> true|false`
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
 * `(pgo:Node | pgo:Edge | prec:PropertyLabel) prec:mapBlankNodesToPrefix ?o`
 * triples and return the map `[s.value] = ?o`.
 * 
 * This extracts the prefix to map each type of elements from the property graph
 * @param {N3.Store} store The context store
 */
function readBlankNodeMapping(store) {
    let s = {};
    for (const quad of store.getQuads(null, prec.mapBlankNodesToPrefix, null, $defaultGraph())) {
        let target = quad.subject;

        if (!target.equals(pgo.Node)
            && !target.equals(pgo.Edge)
            && !target.equals(prec.PropertyLabel)) {
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
 * Read the quads from a Turtle-star file and add them to the store.
 * 
 * This function enables to store multi nested quads by using `prec:_` as a
 * special `owl:sameAs` predicate.
 * @param {N3.Store} store The store to populate
 * @param {String} file The path to the Turtle-star file
 */
function addBuiltIn(store, file) {
    const trig = fs.readFileSync(file, 'utf-8');
    MultiNestedStore.addQuadsWithoutMultiNesting(store, (new N3.Parser()).parse(trig));
}

/**
 * Replaces every relationship related term with its edge related counterpart.
 * @param {N3.Store} store The store to modify
 */
function replaceSynonyms(store) {
    function makeSynonymsDict() {
        let dict = new PrecUtils.TermDict();
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
     * Transform the store by replacing the terms found in the dict to the one
     * it maps to
     * @param {N3.Store} store 
     * @param {PrecUtils.TermDict<Term, Term>} dict A Term to term dict
     */
    function transformStore(store, dict) {
        const toDelete = [];
        const toAdd = [];

        for (const quad of store.getQuads()) {

            const newQuad = QuadStar.eventuallyRebuildQuad(quad,
                term => dict.get(term) || term
            );

            if (quad !== newQuad) {
                toDelete.push(quad);
                toAdd.push(newQuad);
            }
        }

        store.removeQuads(toDelete);
        store.addQuads(toAdd);
    }

    transformStore(store, makeSynonymsDict());
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
 * @param {N3.Store} store The context
 * @param {*} IRIs An object that contains the different IRIs
 */
function _removeSugarForRules(store, IRIs) {
    let sugared = store.getQuads(null, IRIs.ShortcutIRI, null, $defaultGraph());

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
        store.addQuad($quad(ruleNode, rdf.type             , IRIs.RuleType));
        store.addQuad($quad(ruleNode, IRIs.MainLabel       , label));
        store.addQuad($quad(ruleNode, IRIs.SubstitutionTerm, iri));
    }

    store.removeQuads(sugared);
}

/**
 * Replace every quad in the form `prec:Properties ?p ?o ?g` with the quads :
 * ```
 * prec:NodeProperties ?p ?o ?g .
 * prec:EdgeProperties ?p ?o ?g .
 * prec:MetaProperties ?p ?o ?g .
 * ```
 * @param {N3.Store} context The store that contains the context quads
 */
function _copyPropertiesValuesToSpecificProperties(context) {
    let quads = context.getQuads(prec.Properties, null, null, null);

    for (const quad of quads) {
        context.addQuad(prec.NodeProperties, quad.predicate, quad.object, quad.graph);
        context.addQuad(prec.EdgeProperties, quad.predicate, quad.object, quad.graph);
        context.addQuad(prec.MetaProperties, quad.predicate, quad.object, quad.graph);
    }

    context.removeQuads(quads);
}

/**
 * A `Context` is an object that stores every data that is stored in a context
 * file in a way to make it possible to transform a store that contains a PREC0
 * RDF graph into a graph that is more suitable for the end user need = that
 * uses proper IRIs and easier to use reification representations.
 */
class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        MultiNestedStore.addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/../builtin_rules.ttl");
        replaceSynonyms(store);
        this.store = store;


        const substitutionTerms = new SubstitutionTerms(store);

        _removeSugarForRules(store, RulesForEdges.Rule);
        this.edges  = new EntitiesManager(store, substitutionTerms, RulesForEdges.Rule);
        RulesForEdges.throwIfHasInvalidTemplate(this.edges.templatess)
        
        _removeSugarForRules(store, PropertyRule    );
        _copyPropertiesValuesToSpecificProperties(store);
        this.properties = new EntitiesManager(store, substitutionTerms, PropertyRule );
        _throwIfInvalidPropertyTemplates(this.properties.templatess)

        _removeSugarForRules(store, NodeLabelRule   );
        this.nodeLabels = new EntitiesManager(store, substitutionTerms, NodeLabelRule);
        // TODO: throw if there are invalid node label template

        this.flags = readFlags(store);

        this.blankNodeMapping = readBlankNodeMapping(store);
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
     * @returns {Quad[]} The template to give to the
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

    findNodeLabelTemplate(ruleNode) {
        return this.nodeLabels.getTemplateFor(ruleNode, prec.NodeLabels);
    }
}

module.exports = Context;
