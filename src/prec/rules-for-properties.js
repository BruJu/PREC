"use strict";

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

const DStar    = require('../dataset/index.js');
const QuadStar = require('../rdf/quad-star.js');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"                 , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);

const $quad         = N3.DataFactory.quad;
const $variable     = N3.DataFactory.variable;
const $defaultGraph = N3.DataFactory.defaultGraph;


/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 * @typedef { import("./context-loader") } Context
 */

// =============================================================================
// =============================================================================
//     ==== CONTEXT LOADING ==== CONTEXT LOADING ==== CONTEXT LOADING ==== 

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
    static PropertyHolderSubstitutionTerm = prec.entityIs;

    // ==== One rule management

    /** Build a Property Rule manager from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [
            [
                $quad($variable('propertyKey'), rdf.type, prec.PropertyKey)
            ]
        ];
        this.ruleNode = ruleNode;

        // prec:propertyKey
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad($variable('propertyKey'), rdfs.label, conditions.label)
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
                $quad($variable("entity"), rdf.type, type_)
            ]);
        } else if (object.termType === 'Literal') {
            conditions.push([
                $quad($variable("entity"), labelType , $variable("label")),
                $quad($variable("entity"), rdf.type  , type_            ),
                $quad($variable("label") , rdfs.label, object           )
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
                $quad($variable("property"), prec.__appliedPropertyRule, prec._NoPropertyRuleFound),
                $quad($variable("entity")  , $variable("propertyKey")   , $variable("property")     )
            ],
            conditions: this.conditions,
            destination: [
                $quad($variable("property"), prec.__appliedPropertyRule, this.ruleNode       ),
                $quad($variable("entity")  , $variable("propertyKey")   , $variable("property"))
            ]
        };
    }
}


// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 

function produceMarks(dataset, context) {
    // Mark every property node
    {
        const q = dataset.getQuads(null, rdf.type, prec.PropertyKey, $defaultGraph())
            .map(quad => quad.subject)
            .flatMap(propertyType => dataset.getQuads(null, propertyType, null, $defaultGraph()))
            .map(quad => quad.object)
            .map(propertyBlankNode => $quad(propertyBlankNode, prec.__appliedPropertyRule, prec._NoPropertyRuleFound));

        dataset.addAll(q);
    }

    // Find the proper rule to apply
    context.refinePropertyRules(dataset);
}

/* Return the inherited property rules for the entity */

/**
 * Return the type of the entity in the dataset, supposing it is either a node,
 * an edge or a property, and these types are exclusive.
 * @param {DStar} dataset The dataset
 * @param {Term} entity The entity
 * @returns {Term | undefined} The type of the entity if it is
 * not a property, its PGO type (`pgo.Node` or `pgo.Edge`) if it is one
 */
function findTypeOfEntity(dataset, entity) {
    if (dataset.has($quad(entity, rdf.type, pgo.Node))) {
        return prec.NodeProperties;
    }

    if (dataset.has($quad(entity, rdf.type, pgo.Edge))) {
        return prec.EdgeProperties;
    }

    // Probably a meta property
    return prec.MetaProperties;
}

/**
 * 
 * @param {DStar} destination 
 * @param {Quad} mark 
 * @param {DStar} input 
 * @param {Context} context 
 * @returns 
 */
function applyMark(destination, mark, input, context) {
    const src = [
        $quad($variable("entity"), $variable("propertyKey"), mark.subject),
        $quad(mark.subject, rdf.value, $variable("propertyValue")),
        $quad(mark.subject, rdf.type , prec.PropertyKeyValue)
    ];

    const bindingss = input.matchAndBind(src);

    if (bindingss.length !== 1) {
        throw Error(
            'rules-for-properties.js::applyMark logic error on '
            + mark.subject.value
        );
    }

    const bindings = bindingss[0];
    bindings.property = mark.subject;

    
    const typeOfHolder = findTypeOfEntity(input, bindings.entity);
    let template = context.findPropertyTemplate(mark.object, typeOfHolder);
    if (!Array.isArray(template)) {
        template = [
            ...src,
            // I hate the fact that this triple is optional
            $quad(mark.subject, prec.hasMetaProperties, $variable('metaPropertyNode'))
        ]
    }

    const { produced, usedProperties, listsToKeep } = instanciateProperty(input, mark.subject, template, context);

    destination.addAll(produced);

    for (const listToKeep of listsToKeep) {
        let list = listToKeep;
        while (!list.equals(rdf.nil)) {
            destination.addAll(input.getQuads(list));
            list = input.getQuads(list, rdf.rest)[0].object;
        }
    }
    
    return usedProperties;
}

/**
 * @typedef { {
 *   produced: Quad[],
 *   usedProperties: Term[],
 *   listsToKeep: Term[]
 * } } InstanciateResult
 */

/**
 * 
 * @param {DStar} input The input dataset
 * @param {Term} propertyNode The property node
 * @param {Quad[]} srcTemplate The destination pattern
 * @returns {InstanciateResult} The produced quads
 */
function instanciateProperty(input, propertyNode, srcTemplate, context) {
    const src = [
        $quad($variable("entity"), $variable("propertyKey"), propertyNode),
        $quad(propertyNode, rdf.value, $variable("propertyValue")),
        $quad(propertyNode, rdf.type , prec.PropertyKeyValue)
    ];
    const bindings = input.matchAndBind(src)[0];
    
    bindings.label = input.getQuads(bindings.propertyKey, rdfs.label, null, $defaultGraph())[0].object;
    bindings.property = propertyNode;

    const entities = deepResolve(bindings.entity, input, context);

    // Build the patterns to map to
    const r = srcTemplate.map(term => QuadStar.remapPatternWithVariables(term,
        [
            [$variable("entity")          , pvar.entity          ],
            [$variable("propertyKey")     , pvar.propertyKey     ],
            [$variable("label")           , pvar.label           ],
            [$variable("property")        , pvar.propertyNode    ],
            [$variable("propertyValue")   , pvar.propertyValue   ],
            [$variable("individualValue") , pvar.individualValue ],
            [$variable("metaPropertyNode"), pvar.metaPropertyNode],
        ]
    ))
        .filter(quad => !quad.predicate.equals(prec._forPredicate));


    // Split the template into 4 parts
    const pattern = r.reduce(
        (previous, quad) => {
            let containerName = "";

            if (QuadStar.containsTerm(quad, $variable("metaPropertyNode"))) {
                containerName = "optional";
            } else {
                containerName = "mandatory";
            }

            if (QuadStar.containsTerm(quad, $variable("individualValue"))) {
                containerName += "Individual";
            }

            previous[containerName].push(quad);
            
            return previous;
        },
        {
            mandatory: [], optional: [], mandatoryIndividual: [], optionalIndividual: []
        }
    );

    const individualValues = PropertyTemplateApplier.extractIndividualValues(
        input,
        bindings.propertyValue,
        pattern.mandatoryIndividual.length === 0
        && pattern.optionalIndividual.length === 0
    );
    
    const metaProperties = (() => {
        const theQuads = input.getQuads(propertyNode, prec.hasMetaProperties, null, $defaultGraph());
        if (theQuads.length === 0) return null;
        return theQuads[0].object;
    })();

    let addedQuads = [];
    for (const entity of entities) {
        bindings.entity = entity;
        addedQuads.push(...DStar.bindVariables(bindings, pattern.mandatory));

        let indiv = DStar.bindVariables(bindings, pattern.mandatoryIndividual)
        addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, indiv)));


        if (metaProperties !== null) {
            let [opt1, optN] = PropertyTemplateApplier.bindMultipleVariableSets(
                [bindings, { metaPropertyNode: metaProperties }],
                [
                    pattern.optional,
                    pattern.optionalIndividual
                ]
            );
    
            addedQuads.push(...opt1);
            addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, optN)));
        }
    }

    let result = {
        produced: addedQuads,
        usedProperties: [],
        listsToKeep: []
    }

    if (r.find(t => QuadStar.containsTerm(t, $variable('propertyValue'))) !== undefined
        && input.getQuads(bindings.propertyValue, rdf.first).length !== 0) {
            result.listsToKeep.push(bindings.propertyValue);
    }

    const woot = r.find(t => 
        QuadStar.containsTerm(t, $variable('propertyKey'))
        || QuadStar.containsTerm(t, bindings.propertyKey)
    );

    if (woot !== undefined) {
        result.usedProperties.push(bindings.propertyKey);
    }

    return result;
}


/**
 * Find the real identity of the term to resolve depending on the input dataset
 * and the context
 * @param {Term} termToResolve The term for which the final identity is required
 * @param {DStar} inputDataset The original PREC-0 dataset
 * @param {Context} context The context
 * @returns {Term[]} 
 */
function deepResolve(termToResolve, inputDataset, context) {
    const myType = findTypeOfEntity(inputDataset, termToResolve);

    if (myType.equals(prec.NodeProperties)) {
        // No rule can modify the identity of a node
        return [termToResolve];
    } else if (myType.equals(prec.EdgeProperties)) {
        const edgeBindings = inputDataset.matchAndBind([
            $quad(termToResolve, rdf.type, pgo.Edge),
            $quad(termToResolve, rdf.subject  , $variable("subject")  ),
            $quad(termToResolve, rdf.predicate, $variable("predicate")),
            $quad(termToResolve, rdf.object   , $variable("object")   )
        ])[0];
        edgeBindings.edge = termToResolve;

        const ruleNode = inputDataset.getQuads(termToResolve, prec.__appliedEdgeRule, null, $defaultGraph())[0].object;
        return context.findEdgeTemplate(ruleNode).filter(q => QuadStar.containsTerm(q, prec._forPredicate))
            .map(quad => {
                const theEntityTemplate = quad.subject;
                const trueEntityTemplate = QuadStar.remapPatternWithVariables(
                    theEntityTemplate,
                    [
                        [$variable('edge')     , pvar.self       ],
                        [$variable('edge')     , pvar.edge       ],
                        [$variable('subject')  , pvar.source     ],
                        [$variable('predicate'), pvar.edgeIRI    ],
                        [$variable('label')    , pvar.label      ],
                        [$variable('object')   , pvar.destination],
                    ]
                );
                return DStar.bindVariables(edgeBindings, $quad(trueEntityTemplate, prec._, prec._)).subject;
            });
    } else if (myType.equals(prec.MetaProperties)) {
        const binding = inputDataset.matchAndBind([
            $quad($variable('propertyNode'), prec.hasMetaProperties, termToResolve),
            $quad($variable('propertyNode'), prec.__appliedPropertyRule, $variable('ruleNode')),
            $quad($variable('entity'), $variable('whatever'), $variable('propertyNode'))
        ])[0];
        
        const ruleNode = binding.ruleNode;
        const propertyNode = binding.propertyNode;

        return context.findPropertyTemplate(ruleNode, findTypeOfEntity(inputDataset, binding.entity))
            .filter(quad => quad.predicate.equals(prec._forPredicate))
            .map(quad => $quad(quad.subject, prec._, prec._))
            .map(me => instanciateProperty(inputDataset, propertyNode, [me], context).produced)
            .flatMap(producedQuads => producedQuads.map(quad => quad.subject));
    } else {
        // Should not happen
        throw Error("logic erroc in deepResolve: unknown type", myType.value , "for", termToResolve.value);
    }
}


/* Namespace for the functions used to transform a property modelization */
const PropertyTemplateApplier = {
    extractIndividualValues: function(dataset, propertyValue, ignore) {
        if (ignore === true) return [];

        // A literal alone
        if (propertyValue.termType === 'Literal') {
            return [propertyValue];
        }

        // An RDF list
        let result = [];
        let currentList = propertyValue;

        while (!rdf.nil.equals(currentList)) {
            let theLiteral = dataset.getQuads(currentList, rdf.first, null, $defaultGraph());
            if (theLiteral.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theLiteral.length} values for rdf:first`);

            result.push(theLiteral[0].object);

            let theRest = dataset.getQuads(currentList, rdf.rest, null, $defaultGraph());
            if (theRest.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theRest.length} values for rdf:rest`);

            let nextElement = theRest[0].object;
            currentList = nextElement;
        }

        return result;
    },

    bindMultipleVariableSets: function(listOfBindings, pattern) {
        for (let bindings of listOfBindings) {
            pattern = DStar.bindVariables(bindings, pattern);
        }
        return pattern;
    },

}

// =============================================================================
// =============================================================================

module.exports = {
    // Context loading
    Rule: PropertyRule,
    
    // Context application
    produceMarks, applyMark
}
