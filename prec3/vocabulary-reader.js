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


// ==== Semantic:
// :iri prec:IRIOfRelationship [ prec:modelAs :model ]
//                             ^^^^^^^^^^^^^^^^^^^^^^^
//                  this blank node is a called description node
// A model description node is a description node that only contains:
// - prec:modelAs
// - predicates that are of type prec:SubstitutionTerm


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////


/** Convert term into its boolean value. Return undefined if it's not a valid boolean */
function xsdBoolToBool(term) {
    if (term.termType !== "Literal" || !xsd.boolean.equals(term.datatype)) {
        return undefined;
    }

    if (term.value === "true") {
        return true;
    } else if (term.value === "false") {
        return false;
    } else {
        return undefined;
    }
}

/**
 * Sort the elements an array by `element.priority` then `element.iri`. The
 * higher the priority, the lower the element is.
 * @param {Array} array The array to sort
 */
 function _sortArrayByPriorityThenIri(array) {
    array.sort((lhs, rhs) => {
        const prioDiff = rhs.priority - lhs.priority;
        if (prioDiff !== 0) return prioDiff;

        if (lhs.iri.value < rhs.iri.value) {
            return -1;
        } else if (lhs.iri.value > rhs.iri.value) {
            return 1;
        } else {
            return 0;
        }
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

    /**
     * Applies `consumer` for each substituable term.
     * @param {*} consumer 
     */
    forEach(consumer) { this.data.forEach(consumer); }
}

/** An object that reads models (ok) */
class ModelManager {
    /**
     * Build a model manager using the given substitution terms and using the
     * given default target model.
     * @param {SubstitutionTerms} substitutionTerms The list of substituable
     * terms
     * @param {*} defaultTargetModel The default target model, used if there are
     * substitutions terms contained in the description node but no explicit
     * model.
     */
    constructor(substitutionTerms, defaultTargetModel) {
        this.substitutionTerms = substitutionTerms;
        this.defaultTargetModel = defaultTargetModel;
    }

    /**
     * Throws an error if the given `descriptionNode` is not a pure description
     * node model.
     * 
     * A pure description model can contains at most one `modelAs` predicate and
     * predicates recognized as substitution terms.
     * 
     * @param {N3.Store} store The store that contains the context
     * @param {*} descriptionNode The description node
     */
    throwIfNotAModelDescriptionPredicate(store, descriptionNode) {
        // TODO: receive a list of predicates instead to be able to check with this function every description node
        // the idea would be to throw every unrecognized predicate to this function at the end of every processing of
        // a description node and see if it throws instead of checking and throwing outself
        const instanciated = store.getQuads(descriptionNode, null, null, defaultGraph()).map(q => q.predicate);

        const bad = instanciated.find(p =>
            !p.equals(prec.modelAs) && !PrecUtils.termIsIn(p, this.substitutionTerms.getKeys())
        );
        
        if (bad !== undefined) {
            throw Error(`Malformed model description node ${descriptionNode.value} - has a ${bad.value} predicate`);
        }
    }

    readModel(store, descriptionNode) {
        if (descriptionNode.termType === 'Literal') return undefined;

        let modelAs = store.getQuads(descriptionNode, prec.modelAs, null, defaultGraph());
        if (modelAs.length > 1)
            throw Error(`Malformed description node ${descriptionNode.value} - has more than one model`);

        let targetModel = undefined;
        if (modelAs.length === 1) {
            targetModel = modelAs[0].object;
        }

        let termRedefinitions = undefined;

        function findRedefinition(substituable) {
            const [precTerm, rdfTerm] = substituable;
            let quads = store.getQuads(descriptionNode, precTerm, null, defaultGraph());
            if (quads.length !== 1) return;

            termRedefinitions = termRedefinitions || [];
            termRedefinitions.push([rdfTerm, quads[0].object]);
        }

        this.substitutionTerms.forEach(findRedefinition);

        if (targetModel === undefined) {
            if (termRedefinitions === undefined) {
                return undefined;
            } else {
                targetModel = this.defaultTargetModel;
            }
        }

        let composedOf = store.getQuads(targetModel, prec.composedOf, null, defaultGraph())
            .map(q => q.object)
            .map(term => MultiNestedStore.remakeMultiNesting(store, term))

        if (termRedefinitions === undefined) return composedOf;

        return composedOf.map(term => QuadStar.eventuallyRebuildQuad(
            term,
            t => {
                let r = termRedefinitions.find(x => x[0].equals(t));
                if (r === undefined) return t;
                return r[1];
            }
        ));
    }
}



////////////////////////////////////////////////////////////////////////////////
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  
//     --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  --- PROPERTIES  ---  

class PropertyMapper {
    constructor(iri, description, store, subTermsKey) {
        // TODO: there is a lot of code duplication with `RelationshipManager::RelationshipManager()`.
        // There might be some refactor that is possible.

        // TODO: Or a least, a common function that returns the individual predicates to actually process?
        this.iri             = iri;
        this.descriptionNode = description;

        if (iri.termType !== 'NamedNode') {
            throw Error(`Only Named Nodes can be used as a subject of prec:IRIOfProperty, found ${iri.value} (a ${iri.termType})`);
        }

        if (description.termType === 'Literal') {
            this.conditions = [[[variable('propertyKey'), rdfs.label, description]]]
            this.priority = 0;
            return;
        }

        const descriptionQuads = store.getQuads(description, null, null, defaultGraph());

        let propertyKeyLabel = undefined;
        let priority = 0;
        let forcedPriority = null;
        let modeledAs = undefined;

        function throwError(predicate, message) {
            throw Error(
                `${iri.value} prec:IRIOfProperty ${description.value} - Error on the description node : ` +
                `${predicate.value} ${message}`
            );
        }

        let conditions = [];
        let reservedFor = "None";

        for (const quad of descriptionQuads) {
            const p = quad.predicate;

            if (quad.predicate.equals(prec.propertyName)) {
                if (propertyKeyLabel !== undefined) throwError(p, "have more than one value");

                if (quad.object.termType !== 'Literal') {
                    throwError(p, `object should be a literal but found ${quad.object.termType}`);
                }

                propertyKeyLabel = quad.object;
            } else if (quad.predicate.equals(prec.nodeLabel)) {
                if (reservedFor == 'Edge') {
                    throwError(p, "Found a node as object but this property is reserved for relationships by previous rule");
                }

                PropertyMapper._processRestrictionOnEntity(quad.object, conditions, pgo.Node, rdf.type, mess => throwError(e, mess));
                priority += 1;
                reservedFor = 'Node';
            } else if (quad.predicate.equals(prec.relationshipLabel)) {
                if (reservedFor == 'Node') {
                    throwError(p, "Found a relationship as object but this property is reserved for nodes by previous rule");
                }

                PropertyMapper._processRestrictionOnEntity(quad.object, conditions, pgo.Edge, rdf.predicate, mess => throwError(e, mess));
                priority += 1;
                reservedFor = 'Edge';
            } else if (prec.priority.equals(p)) {
                // TODO : check if type is integer
                forcedPriority = parseInt(quad.object.value);
            } else if (prec.modelAs.equals(p)) {
                if (modeledAs !== undefined) throwError(p, "has more than one value");
                modeledAs = quad.object;
            } else {
                let isRenaming = PrecUtils.termIsIn(p, subTermsKey);
                if (!isRenaming) throwError(p, "is not recognized");
            }
        }

        if (propertyKeyLabel === undefined) throwError(prec.propertyName, "doesn't have any value");

        if (forcedPriority !== null) {
            priority = forcedPriority;
        }

        this.conditions = [
            [
                [variable('propertyKey'), rdfs.label, propertyKeyLabel],
                [variable('propertyKey'), rdf.type, prec.Property]
            ],
            ...conditions
        ];

        this.priority = priority;
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
            [variable("property"), prec.__targetDescriptionModel, prec.Properties],
            [variable("entity")  , variable("propertyKey"), variable("property") ]
       // , [variable("property"), rdf.value              , variable("propertyValue")]
        ];
    }

    getTransformationConditions() {
        return this.conditions;
    }

    getTransformationTarget() {
        return [
            [variable("property"), prec.__targetDescriptionModel, this.descriptionNode],
            [variable("entity")  , this.iri                     , variable("property")]
        ];
    }
}

function _throwIfInvalidPropertyModels(models) {
    const precReceiveFrom = prec.receiveFrom;
    const pvarEntity = pvar.entity;

    for (const [modelName, targetModel] of models) {
        let numberOfReceiveFromPredicates = 0;

        for (const quad of targetModel) {
            if (QuadStar.containsTerm(pvarEntity, quad.predicate)
                || QuadStar.containsTerm(pvarEntity, quad.object)
                || QuadStar.containsTerm(pvarEntity, quad.graph)) {
                throw Error("Propriety Model checker: found pvar:entity somewhere else as subjet in model " + modelName.value);
            }

            if (quad.predicate.equals(precReceiveFrom)) {
                ++numberOfReceiveFromPredicates;
            }
        }

        if (numberOfReceiveFromPredicates > 0) {
            throw Error("Propriety Model Checker: prec:receiveFrom is not yet supported");
        }
    }
}

////////////////////////////////////////////////////////////////////////////////
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---
//--- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS  --- RELATIONSHIPS ---

/** Manager for a single `?iri prec:IRIOfRelationship ?descriptionode` quad */
class RelationshipManager {
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
     constructor(iri, description, store, subTermsKey) {
        this.iri             = iri;
        this.descriptionNode = description;

        if (iri.termType !== 'NamedNode') {
            throw Error(`Only Named Nodes can be used as a subject of prec:IRIOfRelationship, found ${iri.value} (a ${iri.termType})`);
        }

        if (description.termType === 'Literal') {
            this.conditions = [[[variable("edgeLabel"), rdfs.label, description]]];
            this.priority = 0;
            return;
        }

        const descriptionQuads = store.getQuads(description, null, null, defaultGraph());

        let edgeLabel = undefined;
        let priority = 0;
        let forcedPriority = null;
        let modeledAs = undefined;

        function throwError(predicate, message) {
            throw Error(
                `${iri.value} prec:IRIOfRelationship ${description.value} - Error on the description node : ` +
                `${predicate.value} ${message}`
            );
        }
        
        let conditions = [];

        for (let quad of descriptionQuads) {
            const p = quad.predicate;
            
            if (prec.relationshipLabel.equals(p)) {
                if (edgeLabel !== undefined) throwError(p, "have more than one value");

                if (quad.object.termType !== 'Literal') {
                    throwError(p, `object should be a literal but found ${quad.object.termType}`);
                }

                edgeLabel = quad.object.value;
            } else if (prec.priority.equals(p)) {
                // TODO : check if type is integer
                forcedPriority = parseInt(quad.object.value);
            } else if (prec.sourceLabel.equals(p)) {
                let ok = RelationshipManager._onSubjectOrPredicate_nodeType(quad.object, conditions, 'subject');
                if (!ok) throwError(p, "has invalid object");
                ++priority;
            } else if (prec.destinationLabel.equals(p)) {
                let ok = RelationshipManager._onSubjectOrPredicate_nodeType(quad.object, conditions, 'object');
                if (!ok) throwError(p, "has invalid object");
                ++priority;
            } else if (prec.modelAs.equals(p)) {
                if (modeledAs !== undefined) throwError(p, "has more than one value")
                modeledAs = quad.object;
            } else {
                let isRenaming = PrecUtils.termIsIn(p, subTermsKey);
                if (!isRenaming) throwError(p, "is not recognized");
            }
        }

        if (edgeLabel === undefined) throwError(prec.relationshipLabel, "doesn't have exactly one value");

        if (forcedPriority !== null) {
            priority = forcedPriority;
        }

        this.conditions = [
            // [[variable("edge"), rdf.type, pgo.Edge]] --> Implicit thanks to prec.__targetDescriptionModel
            [[variable("edgeLabel"), rdfs.label, N3.DataFactory.literal(edgeLabel)]],
            ...conditions
        ]
        
        this.priority = priority;
    }

    /** Helper function for `prec:sourceLabel` and `prec:destinationLabel` */
    static _onSubjectOrPredicate_nodeType(labelTarget, conditions, subjectOrObject) {
        if (labelTarget.termType !== "Literal") return false;
    
        const predicate = rdf[subjectOrObject];
        const object = variable(subjectOrObject);
    
        // Because conditions is an array of pattern, it is ok if distinct
        // conditions shares the same variables names.
        conditions.push(
            [
                [variable("edge")                   , predicate , object                             ],
                [object                             , rdf.type  , variable("label" + subjectOrObject)],
                [variable("label" + subjectOrObject), rdfs.label, labelTarget                        ]
            ]
        );
    
        return true;
    }

    /**
     * Return the source pattern of the relations that match this
     * prec:IRIOfRelationship
     */
    getTransformationSource() {
        return [
            [variable("edge"), prec.__targetDescriptionModel, prec.Relationships   ],
            [variable("edge"), rdf.predicate                , variable("edgeLabel")]
        ];
    }

    /**
     * Return the condition pattern of the relations that match this
     * prec:IRIOfRelationship
     */
    getTransformationConditions() {
        return this.conditions;
    }

    /**
     * Return the target pattern to map to for the relations of this
     * prec:IRIOfRelationship. It doesn't apply the model: instead the 
     * description node is added as a thing todo.
     */
    getTransformationTarget() {
        return [
            [variable("edge"), prec.__targetDescriptionModel, this.descriptionNode],
            [variable("edge"), rdf.predicate                , this.iri            ]
        ]
    }
}

////////////////////////////////////////////////////////////////////////////////
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  
//  --- ENTITIES MANAGER  ---  ENTITIES MANAGER  ---    ENTITIES MANAGER  ---  

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
     * @param {*} extraModels List of extra models to load
     * @param {*} managerInstancier A function to instanciate the manager for
     * one entitie.
     */
     constructor(contextStore, substitutionTerms, iriOfEntity, baseModel, extraModels, managerInstancier) {
        const subTermsKey = substitutionTerms.getKeys();
        const modelManager = new ModelManager(substitutionTerms, baseModel);

        this.iriRemapper = [];
        this.models = [];

        // `prec:IRIOfRelationship` quads management
        for (let quad of contextStore.getQuads(null, iriOfEntity, null, defaultGraph())) {
            // Read remapping
            this.iriRemapper.push(managerInstancier(quad.subject, quad.object, contextStore, subTermsKey));

            // Read model if relevant
            let model = modelManager.readModel(contextStore, quad.object);
            if (model !== undefined) this.models.push([quad.object, model]);
        }
        
        _sortArrayByPriorityThenIri(this.iriRemapper)
        
        for (let extraModel of extraModels) {
            modelManager.throwIfNotAModelDescriptionPredicate(contextStore, extraModel);
            
            const model = modelManager.readModel(contextStore, extraModel);
            if (model !== undefined) {
                this.models.push([extraModel, model]);
            }
        }
    }

    /**
     * Return the model contained in the given description node
     * @param {*} descriptionNode The description node
     * @returns The model, or undefined if not specified by the user
     */
    getModelRelatedTo(descriptionNode) {
        let foundModel = this.models.find(model => model[0].equals(descriptionNode));
        if (foundModel === undefined) return undefined;
        return foundModel[1];
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
            throw invalidTriple(baseRule, "Subject should be a blank node");
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
        const object = xsdBoolToBool(quad.object);

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

class Context {
    constructor(contextQuads) {
        const store = new N3.Store();
        MultiNestedStore.addQuadsWithoutMultiNesting(store, contextQuads);
        addBuiltIn(store, __dirname + "/builtin_rules.ttl");
        this.store = store;

        const substitutionTerms = new SubstitutionTerms(store);

        this.properties = new EntitiesManager(
            store,
            substitutionTerms,
            prec.IRIOfProperty,
            prec.Prec0Property,
            [prec.Properties, prec.NodeProperties, prec.RelationshipProperties],
            (a, b, c, d) => new PropertyMapper(a, b, c, d)
        );

        this.relations  = new EntitiesManager(
            store,
            substitutionTerms,
            prec.IRIOfRelationship,
            prec.RDFReification,
            [prec.Relationships],
            (a, b, c, d) => new RelationshipManager(a, b, c, d)
        );
        _throwIfInvalidPropertyModels(this.relations.models)

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
        if (!modelDescriptionNode.equals(prec.Relationships)) {
            const r = this.relations.getModelRelatedTo(modelDescriptionNode);
            if (r !== undefined) return r;
        }

        return this.relations.getModelRelatedTo(prec.Relationships);
    }


    findPropertyModel(modelDescriptionNode, alternateDescriptionNodeFinder) {
        if (!modelDescriptionNode.equals(prec.Properties)) {
            const r = this.properties.getModelRelatedTo(modelDescriptionNode);
            if (r !== undefined) return r;
        }

        const alternate = alternateDescriptionNodeFinder();
        if (alternate !== undefined) {
            const r = this.properties.getModelRelatedTo(alternate);
            if (r !== undefined) return r;
        }

        return this.properties.getModelRelatedTo(prec.Properties);
    }
}

module.exports = Context;
