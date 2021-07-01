'use strict';

const N3            = require('n3');
const DStar         = require('../dataset/index.js');
const namespace     = require('@rdfjs/namespace');

const Context       = require("./context-loader.js");
const TermDict      = require('../TermDict');
const quadStar      = require('../rdf/quad-star');

const RulesForEdges = require('./rules-for-edges');

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
    RulesForEdges.transformDataset(dataset, context);
    transformNodeLabels   (dataset, context);

    // -- Remove the info that generated IRI were generated if there don't
    // appear anymore
    
    // Property: ?p a createdProp, ?p a Property, ?p rdfs.label Thing
    // Edge label: ?p a CreatedEdgeLabel, ?p rdfs.label Thing
    // Node label : same
    removeUnusedCreatedVocabulary(dataset, prec.CreatedPropertyKey, 3, 0, 0);
    removeUnusedCreatedVocabulary(dataset, prec.CreatedEdgeLabel, 2, 0, 0);
    removeUnusedCreatedVocabulary(dataset, prec.CreatedNodeLabel, 2, 0, 0);

    // -- Remove provenance information if they are not required by the user
    if (context.getStateOf("KeepProvenance") === false) {
        removePGO(dataset);
    }
}

// =============================================================================
// =============================================================================

/**
 * Deletes every occurrence of pgo:Edge pgo:Node, prec:PropertyKey and prec:PropertyKeyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the 
 */
function removePGO(dataset) {
    dataset.deleteMatches(null, rdf.type, pgo.Edge);
    dataset.deleteMatches(null, rdf.type, pgo.Node);
    dataset.deleteMatches(null, rdf.type, prec.PropertyKey);
    dataset.deleteMatches(null, rdf.type, prec.PropertyKeyValue);
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


function filterOutDeletedNodeLabel(dataset, nodesToDelete) {
    RulesForEdges.filterOutDeletedEdgeLabel(dataset, nodesToDelete);
}

/**
 * Transforms every node label specified in the context with its proper IRI
 * @param {DStar} dataset The data dataset
 * @param {Context} context The context
 */
function transformNodeLabels(dataset, context) {
    // Add mark
    {
        const bindings = dataset.matchAndBind([
            $quad(variable('node'), rdf.type, pgo.Node),
            $quad(variable('node'), rdf.type, variable('pgLabeliri')),
            $quad(variable('pgLabeliri'), rdfs.label, variable('trueLabel'))
        ]);

        bindings.forEach(binding => {
            dataset.add(
                $quad(
                    $quad(binding.node, rdf.type, binding.pgLabeliri),
                    prec.__appliedNodeRule,
                    prec.NodeLabels
                )
            );
        });
    }

    // Look for more refined rules
    context.refineNodeLabelRules(dataset);

    // Boom
    {
        const nodesToLabels = dataset.matchAndBind(
            [
                $quad(
                    $quad(variable('node'), rdf.type, variable('labelIRI')),
                    prec.__appliedNodeRule,
                    variable("ruleNode"),
                ),
                $quad(variable('node'), rdf.type, variable('labelIRI'))
            ]
        );
    
        let candidateLabelForDeletion = new TermDict();
    
        for (const nodeToLabel of nodesToLabels) {
            const label = dataset.getQuads(nodeToLabel.labelIRI, rdfs.label, null, defaultGraph());
            if (label.length !== 0) {
                nodeToLabel.label = label[0].object;
            }
    
            const template = context.findNodeLabelTemplate(nodeToLabel.ruleNode)
            if (!Array.isArray(template)) {
                continue;
            }

            const target = template.map(term => quadStar.remapPatternWithVariables(
                term,
                [
                    [variable('node'), pvar.node],
                    // labelIRI, captured by the pattern of nodesToLabels
                    [variable("labelIRI"), pvar.nodeLabelIRI],
                    // label as a string, captured at the beginning of this loop
                    [variable("label")   , pvar.label]
                ]
            ));

            dataset.replaceOneBinding(nodeToLabel, target);
            
            candidateLabelForDeletion.set(nodeToLabel.labelIRI, true);
        }
    
        // Cleanup
        let l = [];
        candidateLabelForDeletion.forEach((node, _True) => l.push(node));
        filterOutDeletedNodeLabel(dataset, l);
    
        dataset.deleteMatches(null, prec.__appliedNodeRule, prec.NodeLabels, defaultGraph());
    }
}

function transformProperties(dataset, context) {
    // Mark every property value node
    {
        const q = dataset.getQuads(null, rdf.type, prec.PropertyKey, defaultGraph())
            .map(quad => quad.subject)
            .flatMap(propertyType => dataset.getQuads(null, propertyType, null, defaultGraph()))
            .map(quad => quad.object)
            .map(propertyBlankNode => $quad(propertyBlankNode, prec.__appliedPropertyRule, prec._NoPropertyRuleFound));

        dataset.addAll(q);
    }

    // Find the proper rule to apply
    context.refinePropertyRules(dataset);

    // apply the new modelization
    PropertyTemplateApplier.applyPropertyTemplates(dataset, context);
}

/* Namespace for the functions used to transform a property modelization */
const PropertyTemplateApplier = {
    /* Return the inherited property rules for the entity */
    findTypeInDataset: function(dataset, entity) {
        if (dataset.has($quad(entity, rdf.type, pgo.Node))) {
            return prec.NodeProperties;
        }

        if (dataset.has($quad(entity, rdf.type, pgo.Edge))) {
            return prec.EdgeProperties;
        }

        // Probably a meta property
        return undefined;
    },

    /**
     * Applies the desired template to the properties
     * 
     * The required template name is noted with the quad
     * `?propertyBlankNode prec:__appliedPropertyRule ?ruleNode`.
     * @param {DStar} dataset The dataset that contains the quads
     * @param {Context} context The context to apply
     */
    applyPropertyTemplates: function(dataset, context) {
        const properties = dataset.matchAndBind(
            [
                $quad(variable("property"), prec.__appliedPropertyRule, variable("ruleNode")),
                $quad(variable("entity")  , variable("propertyKey")   , variable("property")),
                $quad(variable("property"), rdf.value                 , variable("propertyValue")),
                $quad(variable("property"), rdf.type, prec.PropertyKeyValue)
            ]
        )
            .map(bindings => [bindings, PropertyTemplateApplier.findTypeInDataset(dataset, bindings.entity)])
            .filter(bindings => bindings[1] !== undefined);

        for (const [property, typeOfHolder] of properties) {
            const label = dataset.getQuads(property.propertyKey, rdfs.label, null, defaultGraph());
            if (label.length !== 0) {
                property.label = label[0].object;
            }

            PropertyTemplateApplier.transformProperty(dataset, context, property, typeOfHolder);
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
                $quad(variable("property"), rdf.type, prec.PropertyKeyValue)
            ]
        );
    
        for (const property of properties) {
            property.entity = node;
            const t = prec.MetaProperties;
            PropertyTemplateApplier.transformProperty(dataset, context, property, t);
        }
    },

    transformProperty: function(dataset, context, bindings, typeOfHolder) {
        const template = context.findPropertyTemplate(bindings.ruleNode, typeOfHolder);
        if (!Array.isArray(template)) {
            dataset.delete($quad(bindings.property, prec.__appliedPropertyRule, bindings.ruleNode));
            return;
        }
    
        // Build the patterns to map to
        const r = template.map(term => quadStar.remapPatternWithVariables(term,
            [
                [variable("entity")               , pvar.entity               ],
                [variable("propertyKey")          , pvar.propertyKey          ],
                [variable("label")                , pvar.label                ],
                [variable("property")             , pvar.propertyNode         ],
                [variable("propertyValue")        , pvar.propertyValue        ],
                [variable("individualValue")      , pvar.individualValue      ],
                [variable("metaPropertyNode")     , pvar.metaPropertyNode     ],
                [variable("metaPropertyPredicate"), pvar.metaPropertyPredicate],
                [variable("metaPropertyObject")   , pvar.metaPropertyObject   ],
            ]
        ));
    
        // Split the pattern in 3 parts
        let pattern = r.reduce(
            (previous, quad) => {
                let containerName = "";

                if (quadStar.containsTerm(quad, variable("metaPropertyPredicate"))
                    || quadStar.containsTerm(quad, variable("metaPropertyObject"))) {
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

        const { individualValues, track } = PropertyTemplateApplier.extractIndividualValues(
            dataset,
            bindings.propertyValue,
            pattern.mandatoryIndividual.length === 0
            && pattern.optionalIndividual.length === 0
            && pattern.metaValuesIndividual.length === 0
        );

        let indiv = DStar.bindVariables(bindings, pattern.mandatoryIndividual)
        addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, indiv)));


        const metaProperties = PropertyTemplateApplier.findAndEraseMetaProperties(
            dataset, context,
            bindings.property,
            pattern.optional.length === 0
            && pattern.metaValues.length === 0
            && pattern.optionalIndividual.length === 0
            && pattern.metaValuesIndividual.length === 0
        );

        if (metaProperties !== null) {
            deletedQuads.push(metaProperties.optionalPart['@quad']);

            let [opt1, metaValues1, optN, metaValuesN] = PropertyTemplateApplier.bindMultipleVariableSets(
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

                let x = pattern => PropertyTemplateApplier.remake(metaValue, pattern);
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

        // Apply the meta property template to the meta property
        // = setup the definitive
        // (?metaPropertyNode, ?metaPropertyPredicate, ?metaPropertyObjet)
        // triples
        PropertyTemplateApplier.transformMetaProperty(dataset, context, metaNode);

        // Extract the ?mPN ?mPK ?mPV values
        const mPNmPKmPV = dataset.getQuads(
            /* ?metaPropertyNode      */ metaNode,
            /* ?metaPropertyPredicate */ null,
            /* ?metaPropertyObject    */ null,
            defaultGraph()
        );

        let everyRdfStarQuads = dataset.getRDFStarQuads();

        result.metaValues = mPNmPKmPV.map(quad => {
            return {
                "@quad": quad,
                "@depth": 0,
                metaPropertyPredicate: quad.predicate,
                metaPropertyObject   : quad.object
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
                            metaPropertyPredicate: isMine.predicate,
                            metaPropertyObject   : isMine.object
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

    // TODO: rename this function
    remake: function(foundBinding, destinationPattern) {
        return destinationPattern.map(templateQuad =>
            RulesForEdges.remake(
                DStar.bindVariables(foundBinding, templateQuad),
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
