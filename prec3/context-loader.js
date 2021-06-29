"use strict";

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');

const QuadStar         = require('./quad-star.js');
const MultiNestedStore = require('./quad-star-multinested-store.js');
const PrecUtils        = require('./utils.js');

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
    static DefaultModel       = prec.Prec0Property;
    static MainLabel          = prec.propertyName;
    static PossibleConditions = [prec.nodeLabel, prec.relationshipLabel]
    static ModelBases = [
        [prec.NodeProperties        , [prec.relationshipLabel]                ],
        [prec.RelationshipProperties, [                        prec.nodeLabel]],
        [prec.MetaProperties        , [prec.relationshipLabel, prec.nodeLabel]]
    ];
    static ShortcutIRI        = prec.IRIOfProperty;
    static SubstitutionTerm   = prec.propertyIRI;

    // ==== One rule management

    /** Build a Property Rule manager from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [
            [
                $quad(variable('propertyKey'), rdf.type, prec.Property)
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

        // prec:nodeLabel, prec:relationshipLabel
        let reservedFor = 'None';
        for (const [key, value] of conditions.other) {
            if (prec.nodeLabel.equals(key)) {
                if (reservedFor == 'Edge') {
                    throwError(p, "Found a node as object but this property is reserved for relationships by previous rule");
                }

                PropertyRule._processRestrictionOnEntity(value, this.conditions, pgo.Node, rdf.type, mess => throwError(e, mess));
                reservedFor = 'Node';
            } else if (prec.relationshipLabel.equals(key)) {
                if (reservedFor == 'Node') {
                    throwError(p, "Found a relationship as object but this property is reserved for nodes by previous rule");
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

    /** Adds the condition for a prec:nodeLabel / prec:relationshipLabel restriction */
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

const ModelChecker = {
    /**
     * Return true if every embedded triple used in the model is asserted.
     * @param {*} model An array of quads that constitute the model
     */
    embeddedTriplesAreAsserted: function(model) {
        const invalidTriple = model.find(triple => {
            return undefined !== ["subject", "predicate", "object", "graph"].find(role => {
                const embedded = triple[role];
                if (embedded.termType !== 'Quad') return false;
                return undefined === model.find(assertedTriple => assertedTriple.equals(embedded));
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
     * @param {*} model An array of quads that constitute the model
     * @param {*} onlyAsSubject The term that must only appear in subject-star
     * position
     */
    termMustBeInSubjectStarPosition: function(model, onlyAsSubject) {
        function _isInvalidTerm(term) {
            if (term.termType !== 'Quad') {
                return false;
            }
            
            if (QuadStar.containsTerm(term.predicate, onlyAsSubject)) return true;
            if (QuadStar.containsTerm(term.object   , onlyAsSubject)) return true;
            if (QuadStar.containsTerm(term.graph    , onlyAsSubject)) return true;
    
            return _isInvalidTerm(term.subject);
        }

        return undefined === model.find(quad => _isInvalidTerm(quad));
    }
};

/**
 * Check if there are no model that have pvar:entity at another place than
 * subject.
 * 
 * Throws if there is one
 * @param {PrecUtils.TermDict} models A map of map of models
 */
function _throwIfInvalidPropertyModels(models) {
    const pvarEntity = pvar.entity;

    function _hasInvalidMetaPropertyUsage(term) {
        // TODO: refine the verification
        const mpkey = term.predicate.equals(pvar.metaPropertyPredicate);
        const mpvalue = term.object.equals(pvar.metaPropertyObject);
        return mpkey !== mpvalue;
    }

    models.forEach((classModel, targetModels) => {
        targetModels.forEach((modelName, targetModel) => {
            // pvar:entity in subject-star position
            if (!ModelChecker.termMustBeInSubjectStarPosition(targetModel, pvarEntity)) {
                throw Error(
                    "Propriety Model checker: found pvar:entity somewhere" +
                    " else as subjet in model " + classModel.value + " x " +
                    modelName.value
                );
            }

            for (const quad of targetModel) {
                // ?s pvar:metaPropertyPredicate pvar:metaPropertyObject
                if (_hasInvalidMetaPropertyUsage(quad)) {
                    throw Error(
                        "Propriety Model checker: pvar:metaPropertyPredicate and pvar:metaPropertyObject" +
                        " may only be used in triples of form << ?s pvar:metaPropertyPredicate pvar:metaPropertyObject >>"
                        + " but the model { " + classModel.value + " x " + modelName.value + " } "
                        + " violates this restriction"
                    );
                }
            }

            // Used Embedded triples must be asserted
            if (!ModelChecker.embeddedTriplesAreAsserted(targetModel)) {
                throw Error("Property Model checker: the model " + modelName.value
                + " is used as a property model but contains an"
                + " embedded triple that is not asserted.");
            }
        });
    });
}

function _throwIfInvalidRelationshipModels(models) {
    const pvarKey = pvar.propertyPredicate;
    const pvarVal = pvar.propertyObject;

    models.forEach((_, targetModels) => {
        targetModels.forEach((modelName, targetModel) => {
            for (const quad of targetModel) {
                // TODO: refine the verification and refactor with predicate
                // this check
                const pkeyAsPredicate = pvarKey.equals(quad.predicate);
                const pvalAsObject    = pvarVal.equals(quad.object);
                if (pkeyAsPredicate !== pvalAsObject) {
                    throw Error(`Relationship model checker: ${modelName.value}`
                    + ` triples must conform to either ?s pvar:propertyPredicate pvar:propertyObject `
                    + ` or have neither pvar:propertyPredicate and pvar:propertyObject.`);
                }
            }
        });
    });
}

////////////////////////////////////////////////////////////////////////////////
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---

/** An individual relationship rule */
class RelationshipRule {
    // ==== IRIs related to relationship

    static RuleType           = prec.RelationshipRule;
    static DefaultModel       = prec.RDFReification;
    static MainLabel          = prec.relationshipLabel;
    static PossibleConditions = [prec.sourceLabel, prec.destinationLabel]
    static ModelBases         = [[prec.Relationships, []]];
    static ShortcutIRI        = prec.IRIOfRelationship;
    static SubstitutionTerm   = prec.relationshipIRI;

    // ==== One rule

    /** Build a relationship rule from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [];
        this.ruleNode = ruleNode;

        // prec:relationshipLabel
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad(variable("edge")     , rdf.predicate, variable("edgeLabel")),
                    $quad(variable("edgeLabel"), rdfs.label   , conditions.label     )
                ]
            );
        }

        // prec:priority
        if (conditions.explicitPriority !== undefined) {
            this.priority = [conditions.explicitPriority, hash];
        } else {
            this.priority = [undefined, hash];
        }

        // prec:sourceLabel, prec:destinationLabel
        for (const [key, value] of conditions.other) {
            let predicate;

            if (prec.sourceLabel.equals(key)) {
                predicate = rdf.subject;
            } else if (prec.destinationLabel.equals(key)) {
                predicate = rdf.object;
            } else {
                throw Error(
                    "Invalid state: found a condition of type "
                    + key.value + " but it should already have been filtered out"
                );
            }

            this.conditions.push(
                [
                    $quad(variable("edge") , predicate , variable("node") ),
                    $quad(variable("node") , rdf.type  , variable("label")),
                    $quad(variable("label"), rdfs.label, value            )
                ]
            );
        }
    }

    /**
     * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
     * the relationship that match this manager with its rule node.
     */
    getFilter() {
        return {
            source: [
                $quad(variable("edge"), prec.__appliedEdgeRule, prec.Relationships)
            ],
            conditions: this.conditions,
            destination: [
                $quad(variable("edge"), prec.__appliedEdgeRule, this.ruleNode)
            ]
        };
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
     * @param {N3.Store} contextStore The store
     * @param {*} ruleNode The node that represents the rule
     * @param {*} Cls Either `RelationshipRule` or `PropertyRule`. Its
     * static data are used to get the IRIs that should be considered valid
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
     *      modelAs: name of the model to model to,
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
                modelAs: undefined,
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
            } else if (prec.modelAs.equals(quad.predicate)) {
                if (r.materialization.modelAs !== undefined)
                    throw errorMalformedRule(`prec:modelAs should have at most one value.`);
                
                r.materialization.modelAs = quad.object;
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
     * = this rule have been filled with other things than a model and
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
 * Build the model from a list of materializations
 * @param {N3.Store} store The context store
 * @param {*} materializations The list of materializations that applies
 * @param {*} defaultModel The IRI of the default model if no model have been
 * specified
 * @returns The model (= destination pattern in find-filter-replace)
 */
function _buildModel(store, materializations, defaultModel) {
    let model = defaultModel;
    let substitutionRequests = new PrecUtils.TermDict();

    for (const materialization of materializations) {
        // Copy all substitution
        for (const sub of materialization.substitutions) {
            if (substitutionRequests.get(sub[0]) === undefined) {
                substitutionRequests.set(sub[0], sub[1]);
            }
        }

        // Is the model there?
        if (materialization.modelAs !== undefined) {
            model = materialization.modelAs;
            break;
        }
    }

    // Load the model
    let composedOf = store.getQuads(model, prec.composedOf, null, $defaultGraph())
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
        // List of known (and computed) models
        this.models = new PrecUtils.TermDict();

        let computeModel = materializations =>
            _buildModel(contextStore, materializations, Cls.DefaultModel)
        ;

        // Load the base models (prec:Relationships or prec:(Node|Relationships)Properties)
        let baseModels = new PrecUtils.TermDict();

        for (let [modelName, _] of Cls.ModelBases) {
            // Read the node, ensure it just have a model
            const splitted = SplitNamespace.splitDefinition(contextStore, modelName, Cls, substitutionTerms);
            SplitNamespace.throwIfNotMaterializationOnly(splitted, modelName);

            // The model can be used to compute other models
            baseModels.set(modelName, splitted.materialization);
            // Also a model that can be used
            let tm = new PrecUtils.TermDict();
            tm.set(modelName, computeModel([splitted.materialization]));
            this.models.set(modelName, tm);
        }

        // Load the models for user defined rules
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

            for (const [modelName, forbiddenPredicates] of Cls.ModelBases) {
                // Check if this model x the current base model are compatible
                let forbidden = forbiddenPredicates.find(forbiddenPredicate =>
                    splitted.conditions.other.find(c => c[0].equals(forbiddenPredicate)) !== undefined
                ) !== undefined;
                
                if (forbidden) continue;

                // Add the pair
                const model = computeModel([splitted.materialization, baseModels.get(modelName)])
                this.models.get(modelName).set(quad.subject, model);
            }
        }
        
        _sortArrayByPriority(this.iriRemapper)
    }

    /**
     * Return the model contained in the given description node
     * @param {*} descriptionNode The description node
     * @returns The model, or undefined if not specified by the user
     */
    getModelRelatedTo(ruleNode, type) {
        let modelsOfType = this.models.get(type);
        let model = modelsOfType.get(ruleNode);
        if (model !== undefined) {
            return model;
        } else {
            return modelsOfType.get(type);
        }
    }

    /**
     * Apply `consumer` on every known managed rule
     * @param {*} consumer The function to apply
     */
    forEachRule(consumer) {
        this.iriRemapper.forEach(consumer);
    }
}


////////////////////////////////////////////////////////////////////////////////
// Anything Goes

/** An individual node label rule */
class NodeLabelRule {
    // ==== IRIs related to relationship

    static RuleType           = prec.NodeLabelRule;
    static DefaultModel       = prec.NodeLabelsTypeOfLabelIRI;
    static MainLabel          = prec.nodeLabel;
    static PossibleConditions = [];
    static ModelBases         = [[prec.NodeLabels, []]];
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
 * `(pgo:Node | pgo:Edge | prec:Property) prec:mapBlankNodesToPrefix ?o`
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
 * Replaces every edge related term with its relationship related counterpart.
 * @param {N3.Store} store The store to modify
 */
function replaceSynonyms(store) {
    function makeSynonymsDict() {
        let dict = new PrecUtils.TermDict();
        dict.set(prec.EdgeRule         , prec.RelationshipRule);
        dict.set(prec.EdgeTemplate     , prec.RelationshipModel);
        dict.set(prec.edgeLabel        , prec.relationshipLabel);
        dict.set(prec.Edges            , prec.Relationships);
        dict.set(prec.IRIOfEdge        , prec.IRIOfRelationship);
        dict.set(prec.edgeIRI          , prec.relationshipIRI);
        dict.set(pvar.edgeIRI          , pvar.relationshipIRI);
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
 * prec:NodeProperties         ?p ?o ?g .
 * prec:RelationshipProperties ?p ?o ?g .
 * ```
 * @param {N3.Store} context The store that contains the context quads
 */
function _copyPropertiesValuesToSpecificProperties(context) {
    let quads = context.getQuads(prec.Properties, null, null, null);

    for (const quad of quads) {
        context.addQuad(prec.NodeProperties        , quad.predicate, quad.object, quad.graph);
        context.addQuad(prec.RelationshipProperties, quad.predicate, quad.object, quad.graph);
        context.addQuad(prec.MetaProperties        , quad.predicate, quad.object, quad.graph);
    }

    context.removeQuads(quads);
}

/**
 * A `Context` is an object that stores every data that is stored in a context
 * file in a way to make it possible to transform a store that contains a PREC0
 * RDF graph into a graph that is more suitable for the end user need = that
 * uses proper IRIs and easier to user reification models.
 */
class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        MultiNestedStore.addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/builtin_rules.ttl");
        replaceSynonyms(store);
        this.store = store;

        _removeSugarForRules(store, RelationshipRule);
        _removeSugarForRules(store, PropertyRule    );
        _removeSugarForRules(store, NodeLabelRule   );
        _copyPropertiesValuesToSpecificProperties(store);

        const substitutionTerms = new SubstitutionTerms(store);

        this.relations  = new EntitiesManager(store, substitutionTerms, RelationshipRule);
        _throwIfInvalidRelationshipModels(this.relations.models)
        this.properties = new EntitiesManager(store, substitutionTerms, PropertyRule    );
        _throwIfInvalidPropertyModels(this.properties.models)

        this.nodeLabels = new EntitiesManager(store, substitutionTerms, NodeLabelRule   );
        // TODO: throw if invalid node label model

        this.flags = readFlags(store);

        this.blankNodeMapping = readBlankNodeMapping(store);
    }

    forEachRelation(callback) {
        return this.relations.forEachRule(callback);
    }
    
    forEachProperty(callback) {
        return this.properties.forEachRule(callback);
    }

    forEachNodeLabel(callback) {
        return this.nodeLabels.forEachRule(callback);
    }

    getStateOf(flag) {
        return this.flags[flag];
    }

    /**
     * Fetch the model corresponding to the given `ruleNode`.
     * 
     * The source pattern is expected to be something like
     * 
     * ```javascript
     *  [
     *     [variable("relation"), rdf.type     , pgo.Edge             ],
     *     [variable("relation"), rdf.subject  , variable("subject")  ],
     *     [variable("relation"), rdf.predicate, variable("predicate")],
     *     [variable("relation"), rdf.object   , variable("object")   ]
     *  ]
     * ```
     * 
     * @param {*} ruleNode The rule node
     * @returns The pattern to give to the `storeAlterer.findFilterReplace`
     * function as the destination pattern.
     */
    findRelationshipModel(ruleNode) {
        return this.relations.getModelRelatedTo(ruleNode, prec.Relationships);
    }

    /**
     * Same as `findRelationshipModel` but for properties.
     * `type` should be either
     * `prec:NodeProperties` or `prec:RelationshipProperties`
     */
    findPropertyModel(ruleNode, type) {
        return this.properties.getModelRelatedTo(ruleNode, type);
    }

    findNodeLabelModel(ruleNode) {
        return this.nodeLabels.getModelRelatedTo(ruleNode, prec.NodeLabels);
    }
}

module.exports = Context;
