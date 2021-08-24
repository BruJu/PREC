import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace';

import * as QuadStar from '../rdf/quad-star';
import { FilterProvider, FilterProviderConstructor, RuleDomain } from './RuleType';
import { Quad_Subject } from 'rdf-js';
import { SplitDefConditions } from './context-loader';
import { Quad } from '@rdfjs/types';
import DStar from '../dataset/index';
import Context from './Context';

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });

const $quad         = DataFactory.quad;
const $variable     = DataFactory.variable;
const $defaultGraph = DataFactory.defaultGraph;


// =============================================================================
// =============================================================================
//     ==== CONTEXT LOADING ==== CONTEXT LOADING ==== CONTEXT LOADING ==== 

/** An individual node label rule */
const NodeLabelRule: RuleDomain & FilterProviderConstructor =
class NodeLabelRule implements FilterProvider {
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

  conditions: Quad[][] = [];
  ruleNode: Quad_Subject;
  priority: [number | undefined, string];

  /** Build a node label rule from its definition */
  constructor(conditions: SplitDefConditions, hash: string, ruleNode: Quad_Subject) {
    this.conditions = [];
    this.ruleNode = ruleNode;

    // prec:nodeLabel
    if (conditions.label !== undefined) {
      this.conditions.push([
        $quad($variable("node")     , rdf.type  , $variable("nodeLabel")),
        $quad($variable("nodeLabel"), rdfs.label, conditions.label)
      ]);
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
    const markedTriple = $quad($variable("node"), rdf.type, $variable("nodeLabel"));

    return {
      source: [$quad(markedTriple, prec.__appliedNodeRule, prec.NodeLabels)],
      conditions: this.conditions,
      destination: [$quad(markedTriple, prec.__appliedNodeRule, this.ruleNode)]
    };
  }
}

export { NodeLabelRule as Rule };

// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 

export function produceMarks(dataset: DStar, context: Context) {
  const bindings = dataset.matchAndBind([
    $quad($variable('node'), rdf.type, pgo.Node),
    $quad($variable('node'), rdf.type, $variable('pgLabeliri')),
    $quad($variable('pgLabeliri'), rdfs.label, $variable('trueLabel'))
  ]);

  bindings.forEach(binding => {
    if (Array.isArray(binding.node)) return;

    dataset.add(
      $quad(
        $quad(binding.node as Quad_Subject, rdf.type, binding.pgLabeliri as Quad_Subject),
        prec.__appliedNodeRule,
        prec.NodeLabels
      )
    );
  });

  context.refineNodeLabelRules(dataset);
}

export function applyMark(destination: DStar, mark: Quad, input: DStar, context: Context) {
  const variableValues: any = {
    node: (mark.subject as Quad).subject,
    labelIRI: (mark.subject as Quad).object,
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
  )) as Quad[];

  variableValues['@quads'] = [];
  destination.replaceOneBinding(variableValues, target);

  const woot = target.find(t => 
    /* Hard coded or substituted */ QuadStar.containsTerm(t, variableValues.labelIRI)
    /* Instancied */ || QuadStar.containsTerm(t, $variable('labelIRI'))
  );
  return woot !== undefined ? [variableValues.labelIRI] : [];
}
