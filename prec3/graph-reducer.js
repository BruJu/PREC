'use strict';

const N3            = require('n3');
const DStar         = require('../dataset/index.js');
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
 * @param {DStar} dataset The store that contains the quads to process
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
        const label = dataset.getQuads(relation.predicate, rdfs.label, null, defaultGraph());
        if (label.length !== 0) {
            relation.label = label[0].object;
        }

        const appliedTheModel = RelationshipModelApplier.transformTheModel(dataset, context, relation);
        if (appliedTheModel) {
            candidateLabelForDeletion.set(relation.predicate, true);
        }
    }

    let l = [];
    candidateLabelForDeletion.forEach((node, _True) => l.push(node));
    filterOutDeletedEdgeLabel(dataset, l);

    // Remove target model to prec:Relationships if its definition was not explicit
    dataset.deleteMatches(null, prec.__appliedEdgeRule, prec.Relationships, defaultGraph());
}

const RelationshipModelApplier = {
    transformTheModel: function(dataset, context, relation) {
        const behaviour = context.findRelationshipModel(relation.ruleNode);
    
        if (!Array.isArray(behaviour)) {
            return false;
        }
    
        // Build the patterns to map to
        const r = behaviour.map(term => quadStar.remapPatternWithVariables(
            term,
            [
                [variable('relation')     , pvar.self           ],
                [variable('subject')      , pvar.source         ],
                [variable('predicate')    , pvar.relationshipIRI],
                [variable('label')        , pvar.label          ],
                [variable('object')       , pvar.destination    ],
                [variable('propertyKey')  , pvar.propertyKey    ],
                [variable('propertyValue'), pvar.propertyValue  ]
            ]
        ));
    
        // Split the pattern
        const pattern = r.reduce(
            (previous, quad) => {
                if (quadStar.containsTerm(quad, variable('propertyKey'))
                    || quadStar.containsTerm(quad, variable('propertyValue'))) {
                    previous.properties.push(quad);
                } else {
                    previous.unique.push(quad);
                }
                
                return previous;
            },
            { unique: [], properties: [] }
        );
    
        // Find every properties to map them later
        let propertyQuads = dataset.getQuads(relation.relation, null, null, defaultGraph())
            .filter(
                quad => !precUtils.termIsIn(quad.predicate, [
                    rdf.type, prec.__appliedEdgeRule, rdf.subject, rdf.predicate, rdf.object
                ])
            );
    
        // Replace non property dependant quads
        dataset.replaceOneBinding(relation, pattern.unique);
    
        // Replace property dependants quads
        RelationshipModelApplier.transformProperties(dataset, relation, propertyQuads, pattern.properties);
    
        return true;
    },

    transformProperties: function(dataset, relation, propertyQuads, pattern) {        
        if (propertyQuads.length === 0) {
            return;
        }

        dataset.removeQuads(propertyQuads);
        relation['@quads'] = []; // No more quad to delete during replaceOneBinding

        const quadsToDelete = [];
        const quadsToAdd    = [];

        // Asserted properties
        for (const propertyQuad of propertyQuads) {
            relation.propertyKey = propertyQuad.predicate;
            relation.propertyValue = propertyQuad.object;

            quadsToAdd.push(...DStar.bindVariables(relation, pattern));
        }

        // Embedded properties
        for (const quadInTheDataset of dataset.getRDFStarQuads()) {
            // - We are looking for nested quads in the form
            // ?entity ?propertyKey ?propertyValue
            // - But a property model can only have ?entity in subject-star
            // position
            // - It means that the ?entity ?propertyKey ?propertyValue
            // nested quads are only in subject position.

            const searchResult = RelationshipModelApplier.searchInSubjectStarPlus(quadInTheDataset, propertyQuads);
            if (searchResult === null) {
                continue;
            }

            const { nestedMatchedQuad, depth } = searchResult;

            quadsToDelete.push(quadInTheDataset);

            relation.propertyKey = nestedMatchedQuad.predicate;
            relation.propertyValue = nestedMatchedQuad.object;

            // DStar.bindVariables
            let newNestedMatchedQuads = [...DStar.bindVariables(relation, pattern)];

            newNestedMatchedQuads = newNestedMatchedQuads.map(newNested =>
                RelationshipModelApplier.remake(newNested, depth, quadInTheDataset)
            );

            quadsToAdd.push(...newNestedMatchedQuads);
        }

        // Modify the dataset
        dataset.removeQuads(quadsToDelete);
        dataset.addAll(quadsToAdd);
    },

    remake: function(newNested, depth, quadInTheDataset) {
        if (depth === -1) return newNested;
        return N3.DataFactory.quad(
            RelationshipModelApplier.remake(newNested, depth - 1, quadInTheDataset.subject),
            quadInTheDataset.predicate,
            quadInTheDataset.object,
            quadInTheDataset.graph
        );
    },

    searchInSubjectStarPlus: function(quad, searchedQuads) {
        let depth = 0;
        
        while (quad.subject.termType === 'Quad') {
            let found = searchedQuads.find(q => q.equals(quad.subject));
            if (found !== undefined) {
                return {
                    nestedMatchedQuad: found,
                    depth: depth
                };
            }

            quad = quad.subject;
            ++depth;
        }

        return null;
    }

};

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
    PropertyModelApplier.applyPropertyModels(dataset, addedVocabulary);
}

/* Namespace for the funtions used to transform a property model */
const PropertyModelApplier = {
    /* Return the inherited property rules for the entity */
    findTypeInDataset: function(dataset, entity) {
        if (dataset.has($quad(entity, rdf.type, pgo.Node))) {
            return prec.NodeProperties;
        }

        if (dataset.has($quad(entity, rdf.type, pgo.Edge))) {
            return prec.RelationshipProperties;
        }

        // Probably a meta property
        return undefined;
    },

    /**
     * Transform the properties models to the required models.
     * 
     * The required model is noted with the quad
     * `?propertyBlankNode prec:__appliedPropertyRule ?ruleNode`.
     * @param {DStar} dataset The dataset that contains the quads
     * @param {Context} context The context to apply
     */
    applyPropertyModels: function(dataset, context) {
        const properties = dataset.matchAndBind(
            [
                $quad(variable("property"), prec.__appliedPropertyRule, variable("ruleNode")),
                $quad(variable("entity")  , variable("propertyKey")   , variable("property")),
                $quad(variable("property"), rdf.value                 , variable("propertyValue")),
                $quad(variable("property"), rdf.type, prec.PropertyValue)
            ]
        )
            .map(bindings => [bindings, PropertyModelApplier.findTypeInDataset(dataset, bindings.entity)])
            .filter(bindings => bindings[1] !== undefined);

        for (const [property, typeOfHolder] of properties) {
            const label = dataset.getQuads(property.propertyKey, rdfs.label, null, defaultGraph());
            if (label.length !== 0) {
                property.propertyKeyLabel = label[0].object;
            }

            PropertyModelApplier.transformProperty(dataset, context, property, typeOfHolder);
        }

        dataset.deleteMatches(null, prec.__appliedPropertyRule, null, defaultGraph());
    },

    /**
     * Transform the given meta property by applying the given context.
     * 
     * @param {DStar} dataset The dataset which contains the dataset
     * @param {Context} context The context
     * @param {*} node The node that represents the meta property
     */
    transformMetaProperty: function(dataset, context, node) {
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
            const t = prec.MetaProperties;
            PropertyModelApplier.transformProperty(dataset, context, property, t);
        }
    },

    transformProperty: function(dataset, context, bindings, typeOfHolder) {
        const model = context.findPropertyModel(bindings.ruleNode, typeOfHolder);
        if (!Array.isArray(model)) {
            dataset.delete($quad(bindings.property, prec.__appliedPropertyRule, bindings.ruleNode));
            return;
        }
    
        // Build the patterns to map to
        const r = model.map(term => quadStar.remapPatternWithVariables(term,
            [
                [variable("entity")           , pvar.entity           ],
                [variable("propertyKey")      , pvar.propertyKey      ],
                [variable("propertyKeyLabel") , pvar.propertyKeyLabel ],
                [variable("property")         , pvar.property         ],
                [variable("propertyValue")    , pvar.propertyValue    ],
                [variable("individualValue")  , pvar.individualValue  ],
                [variable("metaPropertyNode") , pvar.metaPropertyNode ],
                [variable("metaPropertyKey")  , pvar.metaPropertyKey  ],
                [variable("metaPropertyValue"), pvar.metaPropertyValue],
            ]
        ));
    
        // Split the pattern in 3 parts
        let pattern = r.reduce(
            (previous, quad) => {
                let containerName = "";

                if (quadStar.containsTerm(quad, variable("metaPropertyKey"))
                    || quadStar.containsTerm(quad, variable("metaPropertyValue"))) {
                    containerName = "metaValues";
                } else if (quadStar.containsTerm(quad, variable("metaPropertyNode"))) {
                    containerName = "optional";
                } else {
                    containerName = "mandatory";
                }

                if (quadStar.containsTerm(quad, variable("individualValue"))) {
                    containerName += "Individual";
                }

                previous[containerName].push(quad);
                
                return previous;
            },
            {
                mandatory: [], optional: [], metaValues: [],
                mandatoryIndividual: [], optionalIndividual: [], metaValuesIndividual: [],
            }
        );

        let addedQuads = [];
        let deletedQuads = [];
        
        addedQuads.push(...DStar.bindVariables(bindings, pattern.mandatory));
        deletedQuads.push(...bindings['@quads']);

        const { individualValues, track } = PropertyModelApplier.extractIndividualValues(
            dataset,
            bindings.propertyValue,
            pattern.mandatoryIndividual.length === 0
            && pattern.optionalIndividual.length === 0
            && pattern.metaValuesIndividual.length === 0
        );

        let indiv = DStar.bindVariables(bindings, pattern.mandatoryIndividual)
        addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, indiv)));


        const metaProperties = PropertyModelApplier.findAndEraseMetaProperties(
            dataset, context,
            bindings.property,
            pattern.optional.length === 0
            && pattern.metaValues.length === 0
            && pattern.optionalIndividual.length === 0
            && pattern.metaValuesIndividual.length === 0
        );

        if (metaProperties !== null) {
            deletedQuads.push(metaProperties.optionalPart['@quad']);

            let [opt1, metaValues1, optN, metaValuesN] = PropertyModelApplier.bindMultipleVariableSets(
                [bindings, { metaPropertyNode: metaProperties.optionalPart.metaPropertyNode }],
                [
                    pattern.optional,
                    pattern.metaValues,
                    pattern.optionalIndividual,
                    pattern.metaValuesIndividual
                ]
            );

            addedQuads.push(...opt1);
            addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, optN)));

            metaProperties.metaValues.forEach(metaValue => {
                deletedQuads.push(metaValue['@quad']);

                let x = pattern => PropertyModelApplier.remake(metaValue, pattern);
                addedQuads.push(...x(metaValues1));
                addedQuads.push(...x(individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, metaValuesN))));
            });
        }

        dataset.removeQuads(deletedQuads);
        dataset.addAll(addedQuads);

        for (const term of track) {
            const r = dataset.allUsageOfAre(term, [
                $quad(term, rdf.first), $quad(term, rdf.rest)
            ]);

            if (r !== null) {
                dataset.removeQuads(r);
            }
        }
    },

    extractIndividualValues: function(dataset, propertyValue, ignore) {
        if (ignore === true) return { individualValues: [], track: [] };

        // A literal alone
        if (propertyValue.termType === 'Literal') {
            return { individualValues: [propertyValue], track: [] };
        }

        // An RDF list
        let result = [];
        let track = [];
        let currentList = propertyValue;

        while (!rdf.nil.equals(currentList)) {
            let theLiteral = dataset.getQuads(currentList, rdf.first, null, defaultGraph());
            if (theLiteral.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theLiteral.length} values for rdf:first`);

            result.push(theLiteral[0].object);

            let theRest = dataset.getQuads(currentList, rdf.rest, null, defaultGraph());
            if (theRest.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theRest.length} values for rdf:rest`);

            let nextElement = theRest[0].object;
            track.push(currentList);
            currentList = nextElement;
        }

        return { individualValues: result, track: track };
    },

    findAndEraseMetaProperties: function(dataset, context, propertyNode, ignore) {
        if (ignore === true) return null;

        const metaNodeIdentityQuads = dataset.getQuads(propertyNode, prec.hasMetaProperties, null, defaultGraph());

        if (metaNodeIdentityQuads.length === 0) return null;

        if (metaNodeIdentityQuads.length !== 1)
            throw Error("Invalid data graph: more than one meta node for " + propertyNode.value);

        const metaNode = metaNodeIdentityQuads[0].object;

        let result = {
            optionalPart: {
                "@quad": metaNodeIdentityQuads[0],
                metaPropertyNode: metaNode
            },
            metaValues: []
        };

        // Apply the meta property model to the meta property
        // = setup the definitive ?metaPropertyNode ?metaPropertyKey ?metaPropertyValue triples
        PropertyModelApplier.transformMetaProperty(dataset, context, metaNode);

        // Extract the ?mPN ?mPK ?mPV values
        const mPNmPKmPV = dataset.getQuads(
            /* ?metaPropertyNode  */ metaNode,
            /* ?metaPropertyKey   */ null,
            /* ?metaPropertyValue */ null,
            defaultGraph()
        );

        let everyRdfStarQuads = dataset.getRDFStarQuads();

        result.metaValues = mPNmPKmPV.map(quad => {
            return {
                "@quad": quad,
                "@depth": 0,
                metaPropertyKey: quad.predicate,
                metaPropertyValue: quad.object
            };
        })

        for (const rdfStarQuad of everyRdfStarQuads) {
            let depth = 1;

            let currentTerm = rdfStarQuad.subject;

            while (currentTerm.termType === 'Quad') {
                let isMine = mPNmPKmPV.find(e => currentTerm.equals(e));

                if (isMine !== undefined) {
                    result.metaValues.push(
                        {
                            "@quad": rdfStarQuad,
                            "@depth": depth,
                            metaPropertyKey: isMine.predicate,
                            metaPropertyValue: isMine.object
                        }
                    )

                    break;
                }

                currentTerm = currentTerm.subject;
                ++depth;
            }
        }

        return result;
    },

    bindMultipleVariableSets: function(listOfBindings, pattern) {
        for (let bindings of listOfBindings) {
            pattern = DStar.bindVariables(bindings, pattern);
        }
        return pattern;
    },

    remake: function(foundBinding, destinationPattern) {
        return destinationPattern.map(modelQuad =>
            RelationshipModelApplier.remake(
                DStar.bindVariables(foundBinding, modelQuad),
                foundBinding['@depth'] - 1, foundBinding['@quad']
            )
        );
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
