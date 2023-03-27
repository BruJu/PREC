import * as QuadStar from '../rdf/quad-star';
import { FilterProvider, RuleDomain, RuleType } from '../prec-c/RuleType';
import { SplitDefConditions } from '../prec-c/context-loader';
import * as RDF from '@rdfjs/types';
import DStar from '../dataset/index';
import Context from './Context';

import {
  rdf, rdfs, prec, pvar, pgo,
  $quad, $variable, $defaultGraph
} from '../PRECNamespace';

class NLRuleClass implements RuleType {
  readonly domain: RuleDomain = {
    RuleType          : prec.NodeLabelRule,
    DefaultTemplate   : prec.NodeLabelsTypeOfLabelIRI,
    MainLabel         : prec.label,
    PossibleConditions: [],
    TemplateBases     : [prec.NodeLabels],
    ShortcutIRI       : prec.IRIOfNodeLabel,
    SubstitutionTerm  : prec.nodeLabelIRI,
  
    PropertyHolderSubstitutionTerm: null,
    EntityIsHeuristic: null,
  };

  readonly mark = prec.__appliedNodeRule;

  makeOneRuleFilter(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject) {
    return new NodeLabelRule(conditions, hash, ruleNode);
  }

  addInitialMarks(dataset: DStar): void {
    const bindings = dataset.matchAndBind([
      $quad($variable('node'), rdf.type, pgo.Node),
      $quad($variable('node'), rdf.type, $variable('pgLabeliri')),
      $quad($variable('pgLabeliri'), rdfs.label, $variable('trueLabel'))
    ]);
  
    bindings.forEach(binding => {
      if (Array.isArray(binding.node)) return;
  
      dataset.add(
        $quad(
          $quad(binding.node as RDF.Quad_Subject, rdf.type, binding.pgLabeliri as RDF.Quad_Subject),
          prec.__appliedNodeRule,
          prec.NodeLabels
        )
      );
    });
  }

  applyMark(destination: DStar, mark: RDF.Quad, input: DStar, context: Context): RDF.Term[] {
    const variableValues: any = {
      node: (mark.subject as RDF.Quad).subject,
      labelIRI: (mark.subject as RDF.Quad).object,
      ruleNode: mark.object
    };
  
    const label = input.getQuads(variableValues.labelIRI, rdfs.label, null, $defaultGraph);
    if (label.length !== 0) {
      variableValues.label = label[0].object;
    }
  
    const template = context.getNodeLabelTemplateQuads(variableValues.ruleNode);
  
    const target = template.map(term => QuadStar.remapPatternWithVariables(
      term,
      [
        [$variable('node'), pvar.node],
        [$variable('node'), pvar.self],
        // labelIRI, captured by the pattern of nodesToLabels
        [$variable("labelIRI"), pvar.nodeLabelIRI],
        // label as a string, captured at the beginning of this loop
        [$variable("label")   , pvar.label]
      ]
    )) as RDF.Quad[];
  
    variableValues['@quads'] = [];
    destination.replaceOneBinding(variableValues, target);
  
    const woot = target.find(t => 
      /* Hard coded or substituted */ QuadStar.containsTerm(t, variableValues.labelIRI)
      /* Instancied */ || QuadStar.containsTerm(t, $variable('labelIRI'))
    );
    return woot !== undefined ? [variableValues.labelIRI] : [];
  }
}

/** An individual node label rule */
class NodeLabelRule implements FilterProvider {
  conditions: RDF.Quad[][] = [];
  ruleNode: RDF.Quad_Subject;
  priority: [number | undefined, string];

  /** Build a node label rule from its definition */
  constructor(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject) {
    this.conditions = [];
    this.ruleNode = ruleNode;

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
  getFilters() {
    const markedTriple = $quad($variable("node"), rdf.type, $variable("nodeLabel"));

    return [{
      source: [$quad(markedTriple, prec.__appliedNodeRule, prec.NodeLabels)],
      conditions: this.conditions,
      destination: [$quad(markedTriple, prec.__appliedNodeRule, this.ruleNode)]
    }];
  }
}

const instance = new NLRuleClass();
export default instance;
