import DStar from '../dataset';

import RulesForEdges from './rules-for-edges';
import RulesForNodeLabels from './rules-for-nodelabels';
import RulesForProperties from './rules-for-properties';
import * as XX from './context-loader';

import * as RDF from '@rdfjs/types';
import TermSet from '@rdfjs/term-set';
import { Template } from './RuleType';

import { prec } from '../PRECNamespace';

/**
 * A `Context` is an object that stores every data that is stored in a context
 * file in a way to make it possible to transform a store that contains a PREC0
 * RDF graph into a graph that is more suitable for the end user need = that
 * uses proper IRIs and easier to use reification representations.
 */
export default class Context {
  edges: XX.NEPManager;
  properties: XX.NEPManager;
  nodeLabels: XX.NEPManager;

  nepManagers: XX.NEPManager[];

  keepProvenance: boolean;
  blankNodeMapping: { [domain: string]: string; };

  constructor(contextQuads: RDF.Quad[]) {
    const dataset = new DStar(contextQuads);
    XX.addBuiltIn(dataset, __dirname + "/../builtin_rules.ttl");
    XX.replaceSynonyms(dataset);

    const substitutionPredicates = new XX.SubstitutionPredicates(dataset);

    XX.removeSugarForRules(dataset, RulesForEdges.domain);
    this.edges      = new XX.NEPManager(dataset, substitutionPredicates, RulesForEdges);
    
    XX.removeSugarForRules(dataset, RulesForProperties.domain);
    XX.copyPropertiesValuesToSpecificProperties(dataset);
    this.properties = new XX.NEPManager(dataset, substitutionPredicates, RulesForProperties);

    XX.removeSugarForRules(dataset, RulesForNodeLabels.domain   );
    this.nodeLabels = new XX.NEPManager(dataset, substitutionPredicates, RulesForNodeLabels);

    this.nepManagers = [this.edges, this.properties, this.nodeLabels];

    this.keepProvenance = trueIfUndefined(XX.keepProvenance(dataset));
    this.blankNodeMapping = XX.readBlankNodeMapping(dataset);
  }

  produceMarks(dataset: DStar) {
    for (const nepManager of this.nepManagers) {
      nepManager.ruleset.addInitialMarks(dataset);
      nepManager.refineRules(dataset);
    }
  }

  /**
   * Fetches the template corresponding to the given `ruleNode`.
   * 
   * The source pattern is expected to be something like
   * 
   * ```javascript
   *  [
   *     [variable("edge"), rdf.type     , pgo.Edge             ],
   *     [variable("edge"), rdf.subject  , variable("subject")  ],
   *     [variable("edge"), rdf.predicate, variable("predicate")],
   *     [variable("edge"), rdf.object   , variable("object")   ]
   *  ]
   * ```
   * 
   * @param ruleNode The rule node
   * @returns The template to give to the
   * `storeAlterer.findFilterReplace` function as the destination pattern
   * after replacing the variables with actual terms.
   */
  findEdgeTemplate(ruleNode: RDF.Quad_Subject): Template {
    return this.edges.getTemplateFor(ruleNode, prec.Edges)!;
  }

  /**
   * Same as `findEdgeTemplate` but for properties.
   * `type` should be `prec:(Node|Edge|Meta)Properties`
   */
  findPropertyTemplate(ruleNode: RDF.Quad_Subject, type: RDF.NamedNode): Template {
    return this.properties.getTemplateFor(ruleNode, type)!;
  }

  getNodeLabelTemplateQuads(ruleNode: RDF.Quad_Subject) {
    return this.nodeLabels.getTemplateFor(ruleNode, prec.NodeLabels)!.quads;
  }
}


/**
 * Return the list of all terms related to PREC-C contexts
 */
export function allPRECCExclusiveTerms() {
  const subjects = new TermSet();
  const predicates = new TermSet();
  const types = new TermSet();

  for (const rule of [RulesForEdges, RulesForNodeLabels, RulesForProperties]) {
    types.add(rule.domain.RuleType);
    predicates.add(rule.domain.ShortcutIRI);
    rule.domain.TemplateBases.forEach(base => subjects.add(base));
  }

  subjects.add(prec.Properties);

  return { subjects, predicates, types };
}

function trueIfUndefined(b: boolean | undefined) {
  return b === undefined ? true : b;
}
