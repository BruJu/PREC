import DStar from '../dataset';

import * as RulesForEdges from './rules-for-edges';
import * as RulesForNodeLabels from './rules-for-nodelabels';
import * as RulesForProperties from './rules-for-properties';
import * as XX from './context-loader';

import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace';
import { NamedNode, Quad, Quad_Subject } from '@rdfjs/types';
const prec = namespace("http://bruy.at/prec#", { factory: DataFactory });

/**
 * A `Context` is an object that stores every data that is stored in a context
 * file in a way to make it possible to transform a store that contains a PREC0
 * RDF graph into a graph that is more suitable for the end user need = that
 * uses proper IRIs and easier to use reification representations.
 */
export default class Context {
  edges: XX.EntitiesManager;
  properties: XX.EntitiesManager;
  nodeLabels: XX.EntitiesManager;

  keepProvenance: boolean;
  blankNodeMapping: { [domain: string]: string; };

  constructor(contextQuads: Quad[]) {
    const dataset = new DStar(contextQuads);
    XX.addBuiltIn(dataset, __dirname + "/../builtin_rules.ttl");
    XX.replaceSynonyms(dataset);

    const substitutionTerms = new XX.SubstitutionTerms(dataset);

    XX.removeSugarForRules(dataset, RulesForEdges.Rule);
    this.edges      = new XX.EntitiesManager(dataset, substitutionTerms, RulesForEdges.Rule);
    
    XX.removeSugarForRules(dataset, RulesForProperties.Rule);
    XX.copyPropertiesValuesToSpecificProperties(dataset);
    this.properties = new XX.EntitiesManager(dataset, substitutionTerms, RulesForProperties.Rule);

    XX.removeSugarForRules(dataset, RulesForNodeLabels.Rule   );
    this.nodeLabels = new XX.EntitiesManager(dataset, substitutionTerms, RulesForNodeLabels.Rule);

    this.keepProvenance = trueIfUndefined(XX.keepProvenance(dataset));
    this.blankNodeMapping = XX.readBlankNodeMapping(dataset);
  }

  /**
   * Refine the rule to apply for RDF nodes that has been marked with 
   * `?node prec:__appliedEdgeRule, prec:Edges`
   * @param dataset The dataset 
   */
  refineEdgeRules(dataset: DStar) { this.edges.refineRules(dataset); }

  /**
   * Refine the rule to apply for RDF nodes that has been marked with 
   * `?node prec:XXXX, prec:XXX`
   * @param dataset The dataset 
   */
  refinePropertyRules(dataset: DStar) { this.properties.refineRules(dataset); }

  /**
   * Refine the rule to apply for RDF nodes that has been marked with 
   * `?node prec:XXX, prec:XXX`
   * @param dataset The dataset 
   */
  refineNodeLabelRules(dataset: DStar) { this.nodeLabels.refineRules(dataset); }

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
   * @param {Term} ruleNode The rule node
   * @returns {Template} The template to give to the
   * `storeAlterer.findFilterReplace` function as the destination pattern
   * after replacing the variables with actual terms.
   */
  findEdgeTemplate(ruleNode: Quad_Subject) {
    return this.edges.getTemplateFor(ruleNode, prec.Edges)!;
  }

  /**
   * Same as `findEdgeTemplate` but for properties.
   * `type` should be `prec:(Node|Edge|Meta)Properties`
   */
  findPropertyTemplate(ruleNode: Quad_Subject, type: NamedNode) {
    return this.properties.getTemplateFor(ruleNode, type)!;
  }

  getNodeLabelTemplateQuads(ruleNode: Quad_Subject) {
    return this.nodeLabels.getTemplateFor(ruleNode, prec.NodeLabels)!.quads;
  }
}

function trueIfUndefined(b: boolean | undefined) {
  return b === undefined ? true : b;
}

export const readRawTemplate = XX.readRawTemplate;
