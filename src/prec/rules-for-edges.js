const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

const DStar = require('../dataset');
const TermDict = require('../TermDict');
const PrecUtils = require('../rdf/utils');
const QuadStar  = require('../rdf/quad-star.js');

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

/**
 * @template Key, Value
 * @typedef { import("../TermDict")<Key, Value> } TermDict<Key, Value>
 */

/** An individual edge rule */
class EdgeRule {
    // ==== IRIs related to edge

    static RuleType           = prec.EdgeRule;
    static DefaultTemplate    = prec.RDFReification;
    static MainLabel          = prec.edgeLabel;
    static PossibleConditions = [prec.sourceLabel, prec.destinationLabel]
    static TemplateBases      = [[prec.Edges, []]];
    static ShortcutIRI        = prec.IRIOfEdgeLabel;
    static SubstitutionTerm   = prec.edgeIRI;

    // ==== One rule

    /** Build an edge rule from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [];
        this.ruleNode = ruleNode;

        // prec:edgeLabel
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad($variable("edge")     , rdf.predicate, $variable("edgeLabel")),
                    $quad($variable("edgeLabel"), rdfs.label   , conditions.label     )
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
                    "Invalid state: found a condition of type " + key.value
                    + " but it should already have been filtered out"
                );
            }

            this.conditions.push(
                [
                    $quad($variable("edge") , predicate , $variable("node") ),
                    $quad($variable("node") , rdf.type  , $variable("label")),
                    $quad($variable("label"), rdfs.label, value            )
                ]
            );
        }
    }

    /**
     * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
     * the edges that match this manager with its rule node.
     */
    getFilter() {
        return {
            source: [
                $quad($variable("edge"), prec.__appliedEdgeRule, prec.Edges)
            ],
            conditions: this.conditions,
            destination: [
                $quad($variable("edge"), prec.__appliedEdgeRule, this.ruleNode)
            ]
        };
    }
}

/**
 * Throws an error if one of the templates is not a valid edge template.
 * 
 * @param {TermDict<Term, TermDict<Term, Quad[]>>} usableTemplatess The list of
 * usable templates
 */
function throwIfHasInvalidTemplate(usableTemplatess) {
    const pvarKey = pvar.propertyPredicate;
    const pvarVal = pvar.propertyObject;

    usableTemplatess.forEach((_, usableTemplates) => {
        usableTemplates.forEach((templateName, targetTemplate) => {
            for (const quad of targetTemplate) {
                // TODO: refine the verification and refactor with predicate
                // this check
                const pkeyAsPredicate = pvarKey.equals(quad.predicate);
                const pvalAsObject    = pvarVal.equals(quad.object);
                if (pkeyAsPredicate !== pvalAsObject) {
                    throw Error(`Edge template checker: ${templateName.value}`
                    + ` triples must conform to either`
                    + ` ?s pvar:propertyPredicate pvar:propertyObject `
                    + ` or have neither pvar:propertyPredicate and `
                    + `pvar:propertyObject.`);
                }
            }
        });
    });
}


// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 


/**
 * Transform the dataset to apply the edge related rules in the context
 * @param {DStar} dataset The dataset to modify
 * @param {Context} context The context instance
 */
function transformDataset(dataset, context) {
    // To transform the edge, we first identify the rule to apply to
    // each edge.
    // We do the identification process first to avoid conflicts between rules.

    // Mark every edge with the prec:Edges rule
    {
        const q = dataset.getQuads(null, rdf.type, pgo.Edge)
            .map(quad => quad.subject)
            .map(term => N3.DataFactory.quad(term, prec.__appliedEdgeRule, prec.Edges));

        dataset.addAll(q);
    }

    // Find the proper rule
    context.refineEdgeRules(dataset);

    // Do the transformations
    modifyEdgeRepresentation(dataset, context);
}

/**
 * Process every `prec:__appliedEdgeRule` request registered in the
 * store.
 * 
 * In other words, this function will map the PREC-0 representation of a
 * property graph edge to the representation requested by the user, through the
 * specified template for the rule.
 * 
 * @param {DStar} dataset The store that contains the quads to process
 * @param {Context} context The `Context` that contains the information about
 * the context given by the user
 */
function modifyEdgeRepresentation(dataset, context) {
    const edges = dataset.matchAndBind(
        [
            $quad($variable("edge"), rdf.type, pgo.Edge),
            $quad($variable("edge"), prec.__appliedEdgeRule, $variable("ruleNode")),
            $quad($variable("edge"), rdf.subject  , $variable("subject")  ),
            $quad($variable("edge"), rdf.predicate, $variable("predicate")),
            $quad($variable("edge"), rdf.object   , $variable("object")   )
        ]
    );

    let candidateLabelForDeletion = new TermDict();

    for (const edge of edges) {
        const label = dataset.getQuads(edge.predicate, rdfs.label, null, $defaultGraph());
        if (label.length !== 0) {
            edge.label = label[0].object;
        }

        const modifiedTheGraph = EdgeTemplateApplier.applyDesiredTemplate(dataset, context, edge);
        if (modifiedTheGraph) {
            candidateLabelForDeletion.set(edge.predicate, true);
        }
    }

    let l = [];
    candidateLabelForDeletion.forEach((node, _True) => l.push(node));
    filterOutDeletedEdgeLabel(dataset, l);

    // Remove target template to prec:Edges if its definition was not explicit
    dataset.deleteMatches(null, prec.__appliedEdgeRule, prec.Edges, $defaultGraph());
}

const EdgeTemplateApplier = {
    applyDesiredTemplate: function(dataset, context, bindings) {
        const behaviour = context.findEdgeTemplate(bindings.ruleNode);
    
        if (!Array.isArray(behaviour)) {
            return false;
        }
    
        // Build the patterns to map to
        const r = behaviour.map(term => QuadStar.remapPatternWithVariables(
            term,
            [
                [$variable('edge')             , pvar.self             ],
                [$variable('edge')             , pvar.edge             ],
                [$variable('subject')          , pvar.source           ],
                [$variable('predicate')        , pvar.edgeIRI          ],
                [$variable('label')            , pvar.label            ],
                [$variable('object')           , pvar.destination      ],
                [$variable('propertyPredicate'), pvar.propertyPredicate],
                [$variable('propertyObject')   , pvar.propertyObject   ]
            ]
        ));
    
        // Split the pattern
        const pattern = r.reduce(
            (previous, quad) => {
                if (QuadStar.containsTerm(quad, $variable('propertyPredicate'))
                    || QuadStar.containsTerm(quad, $variable('propertyObject'))) {
                    previous.properties.push(quad);
                } else {
                    previous.unique.push(quad);
                }
                
                return previous;
            },
            { unique: [], properties: [] }
        );
    
        // Find every properties to map them later
        let propertyQuads = dataset.getQuads(bindings.edge, null, null, $defaultGraph())
            .filter(
                quad => !PrecUtils.termIsIn(quad.predicate, [
                    rdf.type, prec.__appliedEdgeRule, rdf.subject, rdf.predicate, rdf.object
                ])
            );
    
        // Replace non property dependant quads
        dataset.replaceOneBinding(bindings, pattern.unique);
    
        // Replace property dependants quads
        EdgeTemplateApplier.transformProperties(dataset, bindings, propertyQuads, pattern.properties);
    
        return true;
    },

    transformProperties: function(dataset, bindings, propertyQuads, pattern) {        
        if (propertyQuads.length === 0) {
            return;
        }

        dataset.removeQuads(propertyQuads);
        bindings['@quads'] = []; // No more quad to delete during replaceOneBinding

        const quadsToDelete = [];
        const quadsToAdd    = [];

        // Asserted properties
        for (const propertyQuad of propertyQuads) {
            bindings.propertyPredicate = propertyQuad.predicate;
            bindings.propertyObject    = propertyQuad.object;

            quadsToAdd.push(...DStar.bindVariables(bindings, pattern));
        }

        // Embedded properties
        for (const quadInTheDataset of dataset.getRDFStarQuads()) {
            // - We are looking for nested quads in the form
            // ?entity ?propertyPredicate ?propertyObject
            // - But a property template can only have ?entity in subject-star
            // position
            // - It means that the ?entity ?propertyPredicate ?propertyObject
            // nested quads are only in subject position.

            const searchResult = EdgeTemplateApplier.searchInSubjectStarPlus(quadInTheDataset, propertyQuads);
            if (searchResult === null) {
                continue;
            }

            const { nestedMatchedQuad, depth } = searchResult;

            quadsToDelete.push(quadInTheDataset);

            bindings.propertyPredicate = nestedMatchedQuad.predicate;
            bindings.propertyObject    = nestedMatchedQuad.object;

            // DStar.bindVariables
            let newNestedMatchedQuads = [...DStar.bindVariables(bindings, pattern)];

            newNestedMatchedQuads = newNestedMatchedQuads.map(newNested =>
                remake(newNested, depth, quadInTheDataset)
            );

            quadsToAdd.push(...newNestedMatchedQuads);
        }

        // Modify the dataset
        dataset.removeQuads(quadsToDelete);
        dataset.addAll(quadsToAdd);
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
        if (!rdfs.label.equals(labelQuad.predicate) || !$defaultGraph().equals(labelQuad.graph)) return null;

        // Is part of a component?
        const inComponent = components.find(q => QuadStar.containsTerm(q, term));
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
 * 
 * @param {Term} newNested 
 * @param {number} depth 
 * @param {Quad} quadInTheDataset 
 * @returns {Quad}
 */
function remake(newNested, depth, quadInTheDataset) {
    if (depth === -1) return newNested;
    return N3.DataFactory.quad(
        remake(newNested, depth - 1, quadInTheDataset.subject),
        quadInTheDataset.predicate,
        quadInTheDataset.object,
        quadInTheDataset.graph
    );
}


// =============================================================================
// =============================================================================

module.exports = {
    // Context loading
    Rule: EdgeRule,
    throwIfHasInvalidTemplate,
    // Context application
    transformDataset,
    filterOutDeletedEdgeLabel,

    remake
};
