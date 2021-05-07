"use strict";

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const fs = require('fs');

const QuadStar         = require('./quad-star.js');
const MultiNestedStore = require('./quad-star-multinested-store.js');
const PrecUtils        = require('./utils.js');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"             , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"       , N3.DataFactory);
const xsd  = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"        , N3.DataFactory);

const variable     = N3.DataFactory.variable;
const defaultGraph = N3.DataFactory.defaultGraph;
const $blankNode    = N3.DataFactory.blankNode;
const $defaultGraph = N3.DataFactory.defaultGraph;
const $quad         = N3.DataFactory.quad;


// ==== Semantic:
// :iri prec:IRIOfRelationship [ prec:modelAs :model ]
//                             ^^^^^^^^^^^^^^^^^^^^^^^
//                  this blank node is a called description node
// A model description node is a description node that only contains:
// - prec:modelAs
// - predicates that are of type prec:SubstitutionTerm


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
        this.data = store.getQuads(null, prec.substitutionTarget, null, defaultGraph())
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

    get(term) {
        return this.data.find(t => t[0].equals(term))[1];
    }
}


////////////////////////////////////////////////////////////////////////////////
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  

class PropertyMapper {
    // ==== CONST VARIABLES USED BY ENTITIESMANAGER TO DISCOVER THE RULES

    static RuleType = prec.PropertyRule;
    static DefaultModel = prec.Prec0Property;
    static MainLabel = prec.propertyName;
    static PossibleConditions = [prec.nodeLabel, prec.relationshipLabel]
    static ModelBases = [
        [prec.NodeProperties        , prec.relationshipLabel],
        [prec.RelationshipProperties, prec.nodeLabel        ]
    ];
    static ShortcutIRI      = prec.IRIOfProperty;
    static SubstitutionTerm = prec.propertyIRI;

    // ==== One rule management

    constructor(conditions, hash, ruleNode) {
        this.conditions = [
            [
                [variable('propertyKey'), rdf.type, prec.Property]
            ]
        ];
        this.ruleNode = ruleNode;

        // prec:propertyName
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    [variable('propertyKey'), rdfs.label, conditions.label]
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

                PropertyMapper._processRestrictionOnEntity(value, this.conditions, pgo.Node, rdf.type, mess => throwError(e, mess));
                reservedFor = 'Node';
            } else if (prec.relationshipLabel.equals(key)) {
                if (reservedFor == 'Node') {
                    throwError(p, "Found a relationship as object but this property is reserved for nodes by previous rule");
                }

                PropertyMapper._processRestrictionOnEntity(value, this.conditions, pgo.Edge, rdf.predicate, mess => throwError(e, mess));
                reservedFor = 'Edge';
            } else {
                throw Error(
                    "Invalid state: found a condition of type "
                    + key.value + " but it should already have been filtered out"
                );
            }
        }
    }

    static _processRestrictionOnEntity(object, conditions, type_, labelType, throwError) {
        if (prec.any.equals(object)) {
            conditions.push([
                [variable("entity"), rdf.type, type_]
            ]);
        } else if (object.termType === 'Literal') {
            conditions.push([
                [variable("entity"), labelType , variable("label")],
                [variable("entity"), rdf.type  , type_            ],
                [variable("label") , rdfs.label, object           ]
            ]);
        } else {
            throwError(p, "has invalid object");
        }
    }

    getTransformationSource() {
        return [
            [variable("property"), prec.__appliedPropertyRule, prec._NoPropertyRuleFound]
          , [variable("entity")  , variable("propertyKey"), variable("property") ]
       // , [variable("property"), rdf.value              , variable("propertyValue")]
        ];
    }

    getTransformationConditions() { return this.conditions; }

    getTransformationTarget() {
        return [
            [variable("property"), prec.__appliedPropertyRule, this.ruleNode]
          , [variable("entity")  , variable("propertyKey"), variable("property") ]
     // , [variable("entity")  , this.iri                     , variable("property")]
        ];
    }
}

/**
 * 
 * @param {PrecUtils.TermDict} models 
 */
function _throwIfInvalidPropertyModels(models) {
    const pvarEntity = pvar.entity;

    models.forEach((classModel, targetModels) => {
        targetModels.forEach((modelName, targetModel) => {
            for (const quad of targetModel.model) {
                if (QuadStar.containsTerm(pvarEntity, quad.predicate)
                    || QuadStar.containsTerm(pvarEntity, quad.object)
                    || QuadStar.containsTerm(pvarEntity, quad.graph)) {
                    throw Error("Propriety Model checker: found pvar:entity somewhere else as subjet in model " + classModel.value + " x " + modelName.value);
                }
            }
        });
    });
}

////////////////////////////////////////////////////////////////////////////////
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---

/** Manager for a single `?iri prec:IRIOfRelationship ?descriptionode` quad */
class RelationshipManager {
    // ==== CONST VARIABLES USED BY ENTITIESMANAGER TO DISCOVER THE RULES

    static RuleType = prec.RelationshipRule;
    static DefaultModel = prec.RDFReification;
    static MainLabel = prec.relationshipLabel;
    static PossibleConditions = [prec.sourceLabel, prec.destinationLabel]
    static ModelBases = [[prec.Relationships, null]];
    static ShortcutIRI      = prec.IRIOfRelationship;
    static SubstitutionTerm = prec.relationshipIRI;

    // ==== One rule


    /**
     * Build a RelationshipManager to replace a relationship modeled with PREC0
     * into a relationship with a required `iri` and conforming to `description`
     * node that contains extra conditions (for example condition on the
     * types/labels of the source node) and eventually information about how to
     * change the model format to a format that is more suitable for the user.
     * 
     * This constructor throws an error if invalid informations are found.
     * @param {*} iri The IRI to map to
     * @param {*} description The description node that describes the condition to use this IRI and how to model it
     * @param {N3.Store} store The store that contains the context
     * @param {*} subTermsKey The list of known renaming terms
     */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [];
        this.ruleNode = ruleNode;

        // prec:relationshipLabel
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    [variable("edge")     , rdf.predicate, variable("edgeLabel")],
                    [variable("edgeLabel"), rdfs.label   , conditions.label     ]
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
                    [variable("edge") , predicate , variable("node") ],
                    [variable("node") , rdf.type  , variable("label")],
                    [variable("label"), rdfs.label, value            ]
                ]
            );
        }
    }

    /**
     * Return the source pattern of the relations that match this
     * prec:IRIOfRelationship
     */
    getTransformationSource() {
        return [
            [variable("edge"), prec.__appliedEdgeRule, prec.Relationships   ]
        ];
    }

    /**
     * Return the condition pattern of the relations that match this
     * prec:IRIOfRelationship
     */
    getTransformationConditions() { return this.conditions; }

    /**
     * Return the target pattern to map to for the relations of this
     * prec:IRIOfRelationship. It doesn't apply the model: instead the 
     * description node is added as a thing todo.
     */
    getTransformationTarget() {
        return [
            [variable("edge"), prec.__appliedEdgeRule, this.ruleNode]
        ]
    }
}

////////////////////////////////////////////////////////////////////////////////
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  



class SplitNamespace {
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
                // TODO: check if integer type
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


class Model {
    constructor(store, materializations, Cls) {
        let model = undefined;
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

        if (model === undefined) model = Cls.DefaultModel;

        // Load the model
        let composedOf = store.getQuads(model, prec.composedOf, null, $defaultGraph())
            .map(quad => quad.object)
            .map(term => MultiNestedStore.remakeMultiNesting(store, term));
        
        if (substitutionRequests.isEmpty()) {
            this.model = composedOf;
        } else {
            this.model = composedOf.map(term => QuadStar.eventuallyRebuildQuad(
                term,
                t => {
                    let r = substitutionRequests.get(t);
                    if (r === undefined) return t;
                    return r;
                }
            ));
        }
    }
}

/**
 * A class that contains every `prec:IRIOf[something]` quads, containing both
 * the IRIs to map to, the conditions, and the models.
 */
class EntitiesManager {
    /**
     * Build an `EntitiesManager` from the `contextStore`.
     * @param {N3.Store} contextStore The store that contains the context
     * @param {SubstitutionTerms} substitutionTerms The list of term substitutions
     * @param {*} baseModel The target model if unspecified
     * @param {*} managerInstancier A function to instanciate the manager for
     * one entitie.
     */
    constructor(contextStore, substitutionTerms, Cls) {
        // List of rules to apply
        this.iriRemapper = [];
        // List of known (and computed) models
        this.models = new PrecUtils.TermDict();

        let computeModel = materializations => {
            let m = new Model(contextStore, materializations, Cls)
            //if (materializations.length > 1) {
            //    console.error(JSON.stringify(materializations, null, 2));
            //    console.error(m);
            //}
            return m;
        };

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
        for (let quad of contextStore.getQuads(null, rdf.type, Cls.RuleType, defaultGraph())) {
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

            for (const [modelName, forbiddenPredicate] of Cls.ModelBases) {
                // Check if this model x the current base model are compatible
                let forbidden = forbiddenPredicate !== null
                    && splitted.conditions.other.find(c => c[0].equals(forbiddenPredicate));
                
                if (forbidden !== false && forbidden !== undefined)
                    continue;

                // Add the pair
                let modelList = this.models.get(modelName);

                modelList.set(
                    quad.subject,
                    computeModel(
                        [
                            splitted.materialization,
                            baseModels.get(modelName)
                        ]
                    )
                );
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
     * Apply `consumer` on every known managed entity, which
     * corresponds to the quads with the "IriOfEntity" predicate given in the
     * constructor.
     * @param {*} consumer The function to apply
     */
    forEachRule(consumer) {
        this.iriRemapper.forEach(consumer);
    }
}


////////////////////////////////////////////////////////////////////////////////
// Anything Goes

function _readNodeLabels(store) {
    let labelsToIRI = {};

    let quads = store.getQuads(null, prec.IRIOfNodeLabel, null, defaultGraph());

    function invalidTriple(triple, reason) {
        return Error(
            "Vocabulary Node Labels: Invalid triple found with prec:IRIOfNodeLabel predicate "
            + `(${triple.subject.value} ${triple.predicate.value} ${triple.object.value}): `
            + reason
        );
    }

    for (const baseRule of quads) {
        if (baseRule.subject.termType !== "NamedNode")
            throw invalidTriple(baseRule, "Subject should be a named node");
        if (baseRule.object.termType !== "Literal")
            throw invalidTriple(baseRule, "Object should be a literal")

        const sourceLabel = baseRule.object.value;
        if (labelsToIRI[sourceLabel] !== undefined)
            throw invalidTriple(baseRule, "Several triples maps the same node label");

        labelsToIRI[sourceLabel] = baseRule.subject;
    }

    return labelsToIRI;
}

function readFlags(store) {
    let s = {
        "KeepProvenance": true
    };

    for (const quad of store.getQuads(null, prec.flagState, null)) {
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
    MultiNestedStore.addQuadsWithoutMultiNesting(store, (new N3.Parser()).parse(trig));
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
    let sugared = store.getQuads(null, IRIs.ShortcutIRI, null, defaultGraph());

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
    }

    context.removeQuads(quads);
}

class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        MultiNestedStore.addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/builtin_rules.ttl");
        this.store = store;

        _removeSugarForRules(store, RelationshipManager);
        _removeSugarForRules(store, PropertyMapper     );
        _copyPropertiesValuesToSpecificProperties(store);

        const substitutionTerms = new SubstitutionTerms(store);

        this.relations  = new EntitiesManager(store, substitutionTerms, RelationshipManager);
        this.properties = new EntitiesManager(store, substitutionTerms, PropertyMapper     );
        _throwIfInvalidPropertyModels(this.properties.models)

        this.nodeLabels = _readNodeLabels(store);

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
        for (const nodeLabel in this.nodeLabels) {
            callback(nodeLabel, this.nodeLabels[nodeLabel]);
        }
    }

    getStateOf(flag) {
        return this.flags[flag];
    }

    /**
     * Fetch the pattern corresponding to the given `modelDescriptionNode``.
     * 
     * The given term is a description node that has been processed at the
     * construction of this `Context`.
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
     * @param {*} modelDescriptionNode The description node
     * @returns The pattern to give to the `storeAlterer.findFilterReplace`
     * function as the destination pattern.
     */
    findRelationshipModel(modelDescriptionNode) {
//        console.error(modelDescriptionNode);
//        console.error(PrecUtils.badToString(this.relations.getModelRelatedTo(modelDescriptionNode, prec.Relationships).model, 2));
        return this.relations.getModelRelatedTo(modelDescriptionNode, prec.Relationships).model;
    }

    findPropertyModel(modelDescriptionNode, type) {
        return this.properties.getModelRelatedTo(modelDescriptionNode, type).model;
    }
}

module.exports = Context;
