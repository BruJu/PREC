'use strict';

const N3            = require('n3');
const DStar         = require('../dataset/index.js');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const Context       = require("./context-loader.js");
const precUtils     = require("./utils.js")
const quadStar      = require('./quad-star.js');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"                 , N3.DataFactory);

const variable = N3.DataFactory.variable;
const defaultGraph = N3.DataFactory.defaultGraph;
const $quad = N3.DataFactory.quad;

// =============================================================================

/**
 * Transform the dataset by applying the given context.
 * @param {DStar} dataset The DStar dataset that contains the quad
 * @param {*} contextQuads The list of quads that are part of the context
 */
function applyContext(dataset, contextQuads) {
    const context = new Context(contextQuads);

    // -- Blank nodes transformation
    for (let typeOfNode in context.blankNodeMapping) {
        blankNodeMapping(
            dataset,
            N3.DataFactory.namedNode(typeOfNode),
            context.blankNodeMapping[typeOfNode]
        );
    }

    // -- Map generated IRI to existing IRIs
    transformProperties   (dataset, context);
    transformRelationships(dataset, context);
    transformNodeLabels   (dataset, context);

    // -- Remove the info that generated IRI were generated if there don't
    // appear anymore
    
    // Property: ?p a createdProp, ?p a Property, ?p rdfs.label Thing
    // Relationship Label: ?p a createdRelationShipLabel, ?p rdfs.label Thing
    // Node label : same
    removeUnusedCreatedVocabulary(dataset, prec.CreatedProperty, 3, 0, 0);
    removeUnusedCreatedVocabulary(dataset, prec.CreatedRelationshipLabel, 2, 0, 0);
    removeUnusedCreatedVocabulary(dataset, prec.CreatedNodeLabel, 2, 0, 0);

    // -- Remove provenance information if they are not required by the user
    if (context.getStateOf("KeepProvenance") === false) {
        removePGO(dataset);
    }
}

// =============================================================================
// =============================================================================

/**
 * Deletes every occurrence of pgo:Edge pgo:Node, prec:Property and prec:PropertyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the 
 */
function removePGO(dataset) {
    dataset.deleteMatches(null, rdf.type, pgo.Edge);
    dataset.deleteMatches(null, rdf.type, pgo.Node);
    dataset.deleteMatches(null, rdf.type, prec.Property);
    dataset.deleteMatches(null, rdf.type, prec.PropertyValue);
}

/**
 * Deletes form the dataset every occurrences of a named node whose type is
 * type and who appears expectedSubject times in subject position, ...
 */
function removeUnusedCreatedVocabulary(dataset, type, expectedSubject, expectedPredicate, expectedObject) {
    let r = dataset.matchAndBind([$quad(variable("voc"), rdf.type, type)]);

    for (let bind1 of r) {
        let asSubject   = dataset.getQuads(bind1.voc, null, null).length;
        let asPredicate = dataset.getQuads(null, bind1.voc, null).length;
        let asObject    = dataset.getQuads(null, null, bind1.voc).length;

        if (asSubject == expectedSubject
            && asPredicate == expectedPredicate
            && asObject == expectedObject) {
            dataset.deleteMatches(bind1.voc, null, null);
            dataset.deleteMatches(null, bind1.voc, null);
            dataset.deleteMatches(null, null, bind1.voc);
        }
    }

    if (dataset.getQuads(null, rdf.type, type).length == 0) {
        dataset.deleteMatches(type, null, null);
        dataset.deleteMatches(null, type, null);
        dataset.deleteMatches(null, null, type);
    }
}

function transformRelationships(dataset, addedVocabulary) {
    // To transform the relationship, we first identify the rule to apply to
    // each relationship.
    // We do the identification process first to avoid conflicts between rules.

    // Mark every relationship with a "neutral" rule
    {
        const q = dataset.getQuads(null, rdf.type, pgo.Edge)
            .map(quad => quad.subject)
            .map(term => N3.DataFactory.quad(term, prec.__appliedEdgeRule, prec.Relationships));

        dataset.addAll(q);
    }

    // Find the proper rule
    addedVocabulary.forEachRelation(
        relationship => {
            const { source, conditions, destination } = relationship.getFilter();
            dataset.findFilterReplace(source, conditions, destination);
        }
    );

    // Do the transformations
    modifyRelationships(dataset, addedVocabulary);
}

/**
 * Process every `prec:__appliedEdgeRule` request registered in the
 * store.
 * 
 * In other words, this function will map the PREC-0 representation of a
 * property graph edge to the representation requested by the user, through the
 * specified model for the rule.
 * 
 * @param {N3.Store} store The store that contains the quads to process
 * @param {Context} context The `Context` that contains the information about
 * the context given by the user
 */
function modifyRelationships(dataset, context) {
    const relations = dataset.matchAndBind(
        [
            $quad(variable("relation"), rdf.type, pgo.Edge),
            $quad(variable("relation"), prec.__appliedEdgeRule, variable("ruleNode")),
            $quad(variable("relation"), rdf.subject       , variable("subject")  ),
            $quad(variable("relation"), rdf.predicate     , variable("predicate")),
            $quad(variable("relation"), rdf.object        , variable("object")   )
        ]
    );

    let candidateLabelForDeletion = new precUtils.TermDict();

    for (const relation of relations) {
        const behaviour = context.findRelationshipModel(relation.ruleNode);

        if (Array.isArray(behaviour)) {
            candidateLabelForDeletion.set(relation.predicate, true);

            // Build the patterns to map to
            let r = behaviour.map(term => quadStar.remapPatternWithVariables(
                term,
                [
                    [variable('relation')     , pvar.self           ],
                    [variable('subject')      , pvar.source         ],
                    [variable('predicate')    , pvar.relationshipIRI],
                    [variable('object')       , pvar.destination    ],
                    [variable('propertyKey')  , pvar.propertyKey    ],
                    [variable('propertyValue'), pvar.propertyValue  ]
                ]
            ))
                .map(l => [l, 
                    quadStar.containsTerm(l, variable('propertyKey'))
                    || quadStar.containsTerm(l, variable('propertyValue'))
                ]);

            const nonPropertiesDependantPattern = r.filter(e => !e[1]).map(e => e[0]);
            const    propertiesDependantPattern = r.filter(e =>  e[1]).map(e => e[0]);

            // Find every properties to map them later
            let propertyQuads = dataset.getQuads(relation.relation, null, null, N3.DataFactory.defaultGraph())
                .filter(
                    quad => !precUtils.termIsIn(quad.predicate, [
                        rdf.type, prec.__appliedEdgeRule, rdf.subject, rdf.predicate, rdf.object
                    ])
                );

            // Replace non property dependant quads
            dataset.replaceOneBinding(relation, nonPropertiesDependantPattern);

            // Replace property dependants quads
            if (propertyQuads.length !== 0) {
                dataset.removeQuads(propertyQuads);
                relation['@quads'] = []; // No more quad to delete during replaceOneBinding

                for (let propertyQuad of propertyQuads) {
                    relation.propertyKey   = propertyQuad.predicate;
                    relation.propertyValue = propertyQuad.object;

                    dataset.replaceOneBinding(relation, propertiesDependantPattern);
                }
            } 
        }
    }

    let l = [];
    candidateLabelForDeletion.forEach((node, _True) => l.push(node));
    filterOutDeletedEdgeLabel(dataset, Object.values(l));

    // Remove target model to prec:Relationships if its definition was not explicit
    dataset.deleteMatches(null, prec.__appliedEdgeRule, prec.Relationships, defaultGraph());
}

/**
 * Remove from store every node in `nodesToDelete` that only have one occurence,
 * and for which the occurence is in the form
 * `?theNode rdfs:label ?_anything`
 */
function filterOutDeletedEdgeLabel(dataset, nodesToDelete) {
    let components = [];
    function addIfComposed(term) {
        if (term.termType === 'Quad') {
            components.push(term);
        }
    }

    function isDeletable(term) {
        // Find as P O G
        let inOtherPositions = dataset.getQuads(null, term).length !== 0
            || dataset.getQuads(null, null, term).length !== 0
            || dataset.getQuads(null, null, null, term).length !== 0;

        if (inOtherPositions) return null;
        
        // Find as S
        let asSubject = dataset.getQuads(term);
        if (asSubject.length !== 1) return null;

        // Is label quad?
        let labelQuad = asSubject[0];
        if (!rdfs.label.equals(labelQuad.predicate) || !defaultGraph().equals(labelQuad.graph)) return null;

        // Is part of a component?
        const inComponent = components.find(q => quadStar.containsTerm(q, term));
        if (inComponent !== undefined) return null;

        return labelQuad;
    }

    for (let quad of dataset.getQuads()) {
        addIfComposed(quad.subject);
        addIfComposed(quad.predicate);
        addIfComposed(quad.object);
        addIfComposed(quad.graph);
    }

    for (let nodeToDelete of nodesToDelete) {
        let deletable = isDeletable(nodeToDelete);
        if (deletable !== null) {
            dataset.delete(deletable);
        }
    }
}

/**
 * Transforms every node label specified in the context with its proper IRI
 * @param {DStar} dataset The data dataset
 * @param {Context} context The context
 */
function transformNodeLabels(dataset, context) {
    context.forEachNodeLabel((nodeLabel, correspondingIRI) => {
        dataset.findFilterReplace(
            [$quad(variable("node"), rdf.type, variable("nodeLabel"))],
            [
                [
                    $quad(variable("nodeLabel"), rdfs.label, N3.DataFactory.literal(nodeLabel)),
                    $quad(variable("nodeLabel"), rdf.type  , prec.CreatedNodeLabel)
                ]
            ],
            [$quad(variable("node"), rdf.type, correspondingIRI)]
        )
    });
}

function transformProperties(dataset, addedVocabulary) {
    // Mark every property value node
    {
        const q = dataset.getQuads(null, rdf.type, prec.Property, defaultGraph())
            .map(quad => quad.subject)
            .flatMap(propertyType => dataset.getQuads(null, propertyType, null, defaultGraph()))
            .map(quad => quad.object)
            .map(propertyBlankNode => $quad(propertyBlankNode, prec.__appliedPropertyRule, prec._NoPropertyRuleFound));

        dataset.addAll(q);
    }

    // Find the proper rule to apply
    addedVocabulary.forEachProperty(
        propertyManager => {
            const { source, conditions, destination } = propertyManager.getFilter();
            dataset.findFilterReplace(source, conditions, destination);
        }
    );

    // apply the new model
    applyPropertyModels(dataset, addedVocabulary);
}

/**
 * Transform the properties models to the required models.
 * 
 * The required model is noted with the quad
 * `?propertyBlankNode prec:__appliedPropertyRule ?ruleNode`.
 * @param {DStar} dataset The dataset that contains the quads
 * @param {Context} context The context to apply
 */
function applyPropertyModels(dataset, context) {
    let properties = dataset.matchAndBind(
        [
            $quad(variable("property"), prec.__appliedPropertyRule, variable("ruleNode")),
            $quad(variable("entity")  , variable("propertyKey")   , variable("property")),
            $quad(variable("property"), rdf.value                 , variable("propertyValue")),
            $quad(variable("property"), rdf.type, prec.PropertyValue)
        ]
    );

    const typeFinder = entity => {
        let qs = dataset.getQuads(entity, rdf.type, null, defaultGraph());
        for (let quad of qs) {
            let object = quad.object;
            if (pgo.Node.equals(object)) return prec.NodeProperties;
            if (pgo.Edge.equals(object)) return prec.RelationshipProperties;
        }
        return undefined; // Meta property
    };

    properties = properties.filter(
        propertyBindings => typeFinder(propertyBindings.entity) !== undefined
    );

    for (const property of properties) {
        const model = context.findPropertyModel(property.ruleNode, typeFinder(property.entity));

        if (Array.isArray(model)) {
            transformProperty(dataset, context, property, model);
        } else {
            dataset.delete($quad(property.property, prec.__appliedPropertyRule, property.ruleNode));
        }
    }

    dataset.deleteMatches(null, prec.__appliedPropertyRule, null, defaultGraph());
}

function transformProperty(dataset, context, bindings, model) {
    // Build the patterns to map to
    const r = model.map(term => quadStar.remapPatternWithVariables(term,
        [
            [variable("entity")           , pvar.entity           ],
            [variable("propertyKey")      , pvar.propertyKey      ],
            [variable("property")         , pvar.property         ],
            [variable("propertyValue")    , pvar.propertyValue    ],
            [variable("metaPropertyNode") , pvar.metaPropertyNode ],
            [variable("metaPropertyKey")  , pvar.metaPropertyKey  ],
            [variable("metaPropertyValue"), pvar.metaPropertyValue],
        ]
    ));

    let separation = r.reduce(
        (previous, quad) => {
            if (quadStar.containsTerm(quad, variable("metaPropertyKey"))
                || quadStar.containsTerm(quad, variable("metaPropertyValue")))
                previous.hasMeta.push(quad);
            else if (quadStar.containsTerm(quad, variable("metaPropertyNode")))
                previous.hasMetaNode.push(quad);
            else
                previous.unique.push(quad);
            
            return previous;
        },
        { unique: [], hasMetaNode: [], hasMeta: [] }
    );

    let metaNodeIdentityQuads = dataset.getQuads(bindings.property, prec.hasMetaProperties, null, defaultGraph());

    if (metaNodeIdentityQuads.length === 0) {
        // No match for hasMetaNode and hasMeta parts
        dataset.replaceOneBinding(bindings, separation.unique);
    } else {
        if (metaNodeIdentityQuads.length !== 1)
            throw Error("Invalid data graph: more than one meta node for " + bindings.property.value);

        const metaNode = metaNodeIdentityQuads[0].object;
        
        // Add the new found binding
        bindings.metaPropertyNode = metaNode;
        bindings['@quads'].push(metaNodeIdentityQuads[0]);

        // Apply the meta property model to the meta property
        transformMetaProperty(dataset, context, metaNode);

        // The property
        dataset.replaceOneBinding(bindings, separation.unique);
        bindings['@quads'] = [];
        dataset.replaceOneBinding(bindings, separation.hasMetaNode);

        // The meta properties
        dataset.evilFindAndReplace(
            bindings,
            [ $quad(variable('metaPropertyNode'), variable('metaPropertyKey'), variable('metaPropertyValue')) ],
            separation.hasMeta
        );
    }
}

function transformMetaProperty(dataset, context, node) {
    let properties = dataset.matchAndBind(
        [
            $quad(node                , variable("propertyKey")   , variable("property")),
            $quad(variable("property"), prec.__appliedPropertyRule, variable("ruleNode")),
            $quad(variable("property"), rdf.value                 , variable("propertyValue")),
            $quad(variable("property"), rdf.type, prec.PropertyValue)
        ]
    );

    for (const property of properties) {
        property.entity = node;
        const model = context.findPropertyModel(property.ruleNode, prec.MetaProperties);

        if (Array.isArray(model)) {
            transformProperty(dataset, context, property, model);
        } else {
            dataset.delete($quad(node, prec.__appliedPropertyRule, property.ruleNode));
        }
    }
}


/**
 * Transform the blank nodes of the given type to named nodes, by appending to
 * the given prefix the current name of the blank node.
 * @param {DStar} dataset The dataset that contains the quads
 * @param {*} typeOfMappedNodes The type of the IRIs to map
 * @param {*} prefixIRI The prefix used
 */
function blankNodeMapping(dataset, typeOfMappedNodes, prefixIRI) {
    let remapping = {};

    dataset.getQuads(null, rdf.type, typeOfMappedNodes, defaultGraph())
        .filter(quad => quad.subject.termType === "BlankNode")
        .map(quad => quad.subject.value)
        .forEach(blankNodeValue => remapping[blankNodeValue] = N3.DataFactory.namedNode(prefixIRI + blankNodeValue))
    
    let newContent = dataset.getQuads().map(quad => _quadBNMap(remapping, quad));
    
    dataset.removeQuads(dataset.getQuads());
    dataset.addAll(newContent);
}

/**
 * Provided a mapping blank node value => named node, maps the quad to another
 * quad, in which every blank node in the mapping is mapped to the named node
 */
function _quadBNMap(map, quad) {
    return quadStar.eventuallyRebuildQuad(quad, term => {
        if (term.termType === "BlankNode") {
            let mappedTo = map[term.value];
            if (mappedTo === undefined) return term;
            return mappedTo;
        } else {
            return term;
        }
    });
}

module.exports = applyContext;
