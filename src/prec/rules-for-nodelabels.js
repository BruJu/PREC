const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

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
 * @typedef { import('../dataset') } DStar
 * @typedef { import("./context-loader") } Context
 */


// =============================================================================
// =============================================================================
//     ==== CONTEXT LOADING ==== CONTEXT LOADING ==== CONTEXT LOADING ==== 

/** An individual node label rule */
class NodeLabelRule {
    // ==== IRIs related to node labels

    static RuleType           = prec.NodeLabelRule;
    static DefaultTemplate    = prec.NodeLabelsTypeOfLabelIRI;
    static MainLabel          = prec.nodeLabel;
    static PossibleConditions = [];
    static TemplateBases      = [[prec.NodeLabels, []]];
    static ShortcutIRI        = prec.IRIOfNodeLabel;
    static SubstitutionTerm   = prec.nodeLabelIRI;
    
    static PropertyHolderSubstitutionTerm = null;
    static EntityIsHeuristic = null;

    // ==== One rule

    /** Build a node label rule from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [];
        this.ruleNode = ruleNode;

        // prec:nodeLabel
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad($variable("node")     , rdf.type  , $variable("nodeLabel")),
                    $quad($variable("nodeLabel"), rdfs.label, conditions.label)
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
     * Return the arguments to pass to `DStar::findFilterReplace` to tag
     * the nodes that matches this rule with its rule node.
     */
    getFilter() {
        const markedTriple = $quad(
            $variable("node"), rdf.type, $variable("nodeLabel")
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


// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 


function produceMarks(dataset, context) {
    addMark(dataset);
    context.refineNodeLabelRules(dataset);
}


/**
 * Mark every (node, node label) pair
 * @param {DStar} dataset The dataset
 */
function addMark(dataset) {
    const bindings = dataset.matchAndBind([
        $quad($variable('node'), rdf.type, pgo.Node),
        $quad($variable('node'), rdf.type, $variable('pgLabeliri')),
        $quad($variable('pgLabeliri'), rdfs.label, $variable('trueLabel'))
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


/**
 * 
 * @param {DStar} destination 
 * @param {Quad} mark 
 * @param {DStar} input 
 * @param {Context} context 
 */
function applyMark(destination, mark, input, context) {
    const variableValues = {
        node: mark.subject.subject,
        labelIRI: mark.subject.object,
        ruleNode: mark.object
    };

    const label = input.getQuads(variableValues.labelIRI, rdfs.label, null, $defaultGraph());
    if (label.length !== 0) {
        variableValues.label = label[0].object;
    }

    const template = context.getNodeLabelTemplateQuads(variableValues.ruleNode);

    const target = template.map(term => QuadStar.remapPatternWithVariables(
        term,
        [
            [$variable('node'), pvar.node],
            // labelIRI, captured by the pattern of nodesToLabels
            [$variable("labelIRI"), pvar.nodeLabelIRI],
            // label as a string, captured at the beginning of this loop
            [$variable("label")   , pvar.label]
        ]
    ));

    variableValues['@quads'] = [];
    destination.replaceOneBinding(variableValues, target);

    const woot = target.find(t => 
        /* Hard coded or substituted */ QuadStar.containsTerm(t, variableValues.labelIRI)
        /* Instancied */ || QuadStar.containsTerm(t, $variable('labelIRI'))
    );
    return woot !== undefined ? [variableValues.labelIRI] : [];
}

// =============================================================================
// =============================================================================

module.exports = {
    // Context loading
    Rule: NodeLabelRule,
    // Context application
    produceMarks, applyMark
}
