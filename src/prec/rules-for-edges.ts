import { DataFactory } from 'n3';

import DStar from '../dataset';
import * as QuadStar from '../rdf/quad-star';
import { FilterProvider, RuleDomain, RuleType } from './RuleType';
import { SplitDefConditions } from './context-loader';
import { Quad, Quad_Subject } from '@rdfjs/types';
import { Quad_Object } from '@rdfjs/types';
import Context from './Context';
import { Term } from '@rdfjs/types';

import {
  rdf, rdfs, prec, pvar, pgo,
  $quad, $variable
} from '../PRECNamespace';

const $defaultGraph = DataFactory.defaultGraph;

class EdgesRuleClass implements RuleType {
  readonly domain: RuleDomain = {
    RuleType          : prec.EdgeRule,
    DefaultTemplate   : prec.RDFReification,
    MainLabel         : prec.edgeLabel,
    PossibleConditions: [prec.sourceLabel, prec.destinationLabel],
    TemplateBases     : [[prec.Edges, []]],
    ShortcutIRI       : prec.IRIOfEdgeLabel,
    SubstitutionTerm  : prec.edgeIRI,
  
    PropertyHolderSubstitutionTerm: prec.edgeIs,
    EntityIsHeuristic: [
      [pvar.edge],
      [pvar.self],
      [pvar.source, pvar.edgeIRI, pvar.destination]
    ]
  }

  readonly mark = prec.__appliedEdgeRule;

  makeOneRuleFilter(conditions: SplitDefConditions, hash: string, ruleNode: Quad_Subject): FilterProvider {
    return new EdgeRule(conditions, hash, ruleNode);
  }

  addInitialMarks(dataset: DStar): void {
    // To transform the edge, we first identify the rule to apply to
    // each edge.
    // We do the identification process first to avoid conflicts between rules.

    // Mark every edge with the prec:Edges rule
    const q = dataset.getQuads(null, rdf.type, pgo.Edge)
        .map(quad => quad.subject)
        .map(term => DataFactory.quad(term, this.mark, prec.Edges));

    dataset.addAll(q);
  }

  applyMark(destination: DStar, mark: Quad, input: DStar, context: Context): Term[] {
    const src = [
      $quad(mark.subject, rdf.type, pgo.Edge),
      $quad(mark.subject, rdf.subject  , $variable("subject")  ),
      $quad(mark.subject, rdf.predicate, $variable("predicate")),
      $quad(mark.subject, rdf.object   , $variable("object")   )
    ]
  
    const bindingss = input.matchAndBind(src);
  
    if (bindingss.length !== 1) {
      throw Error("logic erroc in rules-for-edges.ts::applyMark");
    }
  
    const bindings = bindingss[0];
  
    bindings.edge = mark.subject;
    bindings.ruleNode = mark.object;
  
    const label = input.getQuads(bindings.predicate as Term, rdfs.label, null, $defaultGraph());
    if (label.length !== 0) {
      bindings.label = label[0].object;
    }
  
    const behaviour = context.findEdgeTemplate(bindings.ruleNode as Quad_Subject).quads;
  
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
    .filter(quad => !QuadStar.containsTerm(quad, prec._forPredicate)) as Quad[];
  
    // Replace non property dependant quads
    bindings['@quads'] = [];
    destination.replaceOneBinding(bindings, pattern);
  
    const woot = pattern.find(t => 
      /* Instanciated */ QuadStar.containsTerm(t, $variable('predicate'))
      /* Hard coded | Substituted */ || QuadStar.containsTerm(t, bindings.predicate as Term)
    );
    return woot !== undefined ? [bindings.predicate as Term] : [];
  }
}

/** An individual edge rule */
class EdgeRule implements FilterProvider {
  conditions: Quad[][];
  ruleNode: Quad_Subject;
  priority: [number | undefined, string];

  /** Build an edge rule from its definition */
  constructor(conditions: SplitDefConditions, hash: string, ruleNode: Quad_Subject) {
    this.conditions = [];
    this.ruleNode = ruleNode;

    // prec:edgeLabel
    if (conditions.label !== undefined) {
      this.conditions.push([
        $quad($variable("edge")     , rdf.predicate, $variable("edgeLabel")),
        $quad($variable("edgeLabel"), rdfs.label   , conditions.label     )
      ]);
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

      this.conditions.push([
        $quad($variable("edge") , predicate , $variable("node") ),
        $quad($variable("node") , rdf.type  , $variable("label")),
        $quad($variable("label"), rdfs.label, value as Quad_Object)
      ]);
    }
  }

  /**
   * Return the arguments to pass to `DStar::findFilterReplace` to tag
   * the edges that match this manager with its rule node.
   */
  getFilter() {
    return {
      source: [$quad($variable("edge"), prec.__appliedEdgeRule, prec.Edges)],
      conditions: this.conditions,
      destination: [$quad($variable("edge"), prec.__appliedEdgeRule, this.ruleNode)]
    };
  }
}

const instance = new EdgesRuleClass();
export default instance;
