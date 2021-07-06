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
     * Return the arguments to pass to `DStar::findFilterReplace` to tag
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


function produceMarks(dataset, context) {
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
}

/**
 * 
 * @param {DStar} destination 
 * @param {Quad} mark 
 * @param {DStar} input 
 * @param {Context} context 
 */
function applyMark(destination, mark, input, context) {
    const src = [
        $quad(mark.subject, rdf.type, pgo.Edge),
        $quad(mark.subject, rdf.subject  , $variable("subject")  ),
        $quad(mark.subject, rdf.predicate, $variable("predicate")),
        $quad(mark.subject, rdf.object   , $variable("object")   )
    ]

    const bindingss = input.matchAndBind(src);

    if (bindingss.length !== 1) {
        throw Error("logic erroc in rules-for-edges.js::applyMark");
    }

    const bindings = bindingss[0];

    bindings.edge = mark.subject;
    bindings.ruleNode = mark.object;

    const label = input.getQuads(bindings.predicate, rdfs.label, null, $defaultGraph());
    if (label.length !== 0) {
        bindings.label = label[0].object;
    }

    const behaviour = context.findEdgeTemplate(bindings.ruleNode);
    if (!Array.isArray(behaviour)) {
        behaviour = src;
    }

    const pattern = behaviour.map(term => QuadStar.remapPatternWithVariables(
        term,
        [
            [$variable('edge')     , pvar.self       ],
            [$variable('edge')     , pvar.edge       ],
            [$variable('subject')  , pvar.source     ],
            [$variable('predicate'), pvar.edgeIRI    ],
            [$variable('label')    , pvar.label      ],
            [$variable('object')   , pvar.destination],
        ]
    ))
        // Remove metadata
        .filter(quad => ! (

            QuadStar.containsTerm(quad, pvar.propertyPredicate)
            || QuadStar.containsTerm(quad, pvar.propertyObject)
            )

        );

    // Replace non property dependant quads
    bindings['@quads'] = [];
    destination.replaceOneBinding(bindings, pattern);

    const woot = pattern.find(t => 
        /* Instanciated */ QuadStar.containsTerm(t, $variable('predicate'))
        /* Hard coded | Substituted */ || QuadStar.containsTerm(t, bindings.predicate)
    );
    return woot !== undefined ? [bindings.predicate] : [];
}


// =============================================================================
// =============================================================================

module.exports = {
    // Context loading
    Rule: EdgeRule,
    throwIfHasInvalidTemplate,
    // Context application

    produceMarks, applyMark

    
};
