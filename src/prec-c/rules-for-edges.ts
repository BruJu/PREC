import { DataFactory } from 'n3';

import DStar from '../dataset';
import * as QuadStar from '../rdf/quad-star';
import { FilterProvider, RuleDomain, RuleType } from './RuleType';
import { SplitDefConditions } from './context-loader';
import * as RDF from '@rdfjs/types';
import Context from './Context';

import {
  rdf, rdfs, prec, pvar, pgo,
  $quad, $variable, $defaultGraph
} from '../PRECNamespace';

class EdgesRuleClass implements RuleType {
  readonly domain: RuleDomain = {
    RuleType             : prec.EdgeRule,
    DefaultTemplate      : prec.RDFReification,
    MainLabel            : prec.label,
    PossibleConditions   : [prec.sourceLabel, prec.destinationLabel],
    TemplateBases        : [prec.Edges],
    ShortcutIRI          : prec.IRIOfEdgeLabel,
    SubstitutionPredicate: prec.edgeIRI,
  
    SelfIdentityIs: prec.selfIs,
    SelfIdentityHeuristic: [
      [pvar.edge],
      [pvar.self],
      [pvar.source, pvar.edgeIRI, pvar.destination]
    ]
  }

  readonly mark = prec.__appliedEdgeRule;

  makeOneRuleFilter(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject): FilterProvider {
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

  applyMark(destination: DStar, mark: RDF.Quad, input: DStar, context: Context): RDF.Term[] {
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
  
    const label = input.getQuads(bindings.predicate as RDF.Term, rdfs.label, null, $defaultGraph);
    if (label.length !== 0) {
      bindings.label = label[0].object;
    }
  
    const behaviour = context.findEdgeTemplate(bindings.ruleNode as RDF.Quad_Subject).quads;
  
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
    )) as RDF.Quad[];
  
    // Replace non property dependant quads
    bindings['@quads'] = [];
    destination.replaceOneBinding(bindings, pattern);
  
    const woot = pattern.some(t => 
      /* Instanciated */ QuadStar.containsTerm(t, $variable('predicate'))
      /* Hard coded | Substituted */ || QuadStar.containsTerm(t, bindings.predicate as RDF.Term)
    );
    return woot ? [bindings.predicate as RDF.Term] : [];
  }
}

/** An individual edge rule */
class EdgeRule implements FilterProvider {
  conditions: RDF.Quad[][];
  ruleNode: RDF.Quad_Subject;
  priority: [number | undefined, string];

  /** Build an edge rule from its definition */
  constructor(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject) {
    this.conditions = [];
    this.ruleNode = ruleNode;

    // prec:label
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
        $quad($variable("label"), rdfs.label, value as RDF.Quad_Object)
      ]);
    }
  }

  /**
   * Return the arguments to pass to `DStar::findFilterReplace` to tag
   * the edges that match this manager with its rule node.
   */
  getFilters() {
    return [{
      source: [$quad($variable("edge"), prec.__appliedEdgeRule, prec.Edges)],
      conditions: this.conditions,
      destination: [$quad($variable("edge"), prec.__appliedEdgeRule, this.ruleNode)]
    }];
  }
}

const instance = new EdgesRuleClass();
export default instance;
