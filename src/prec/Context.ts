import SHACLValidator from 'rdf-validate-shacl';
import fs from 'fs';
import path from 'path';
import * as n3 from 'n3';
import DStar from '../dataset';
import factory from 'rdf-ext';

import RulesForEdges from './rules-for-edges';
import RulesForNodeLabels from './rules-for-nodelabels';
import RulesForProperties from './rules-for-properties';
import * as XX from './context-loader';

import { NamedNode, Quad, Quad_Subject } from '@rdfjs/types';
import { Template } from './RuleType';

import { prec } from '../PRECNamespace';

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

  entityManagers: XX.EntitiesManager[];

  keepProvenance: boolean;
  blankNodeMapping: { [domain: string]: string; };

  constructor(contextQuads: Quad[]) {
    const dataset = new DStar(contextQuads);
    XX.addBuiltIn(dataset, __dirname + "/../builtin_rules.ttl");
    XX.replaceSynonyms(dataset);

    if (!isShaclValidContext(dataset)) {
      throw Error("SHACL validation failed");
    }

    const substitutionTerms = new XX.SubstitutionTerms(dataset);

    XX.removeSugarForRules(dataset, RulesForEdges.domain);
    this.edges      = new XX.EntitiesManager(dataset, substitutionTerms, RulesForEdges);
    
    XX.removeSugarForRules(dataset, RulesForProperties.domain);
    XX.copyPropertiesValuesToSpecificProperties(dataset);
    this.properties = new XX.EntitiesManager(dataset, substitutionTerms, RulesForProperties);

    XX.removeSugarForRules(dataset, RulesForNodeLabels.domain   );
    this.nodeLabels = new XX.EntitiesManager(dataset, substitutionTerms, RulesForNodeLabels);

    this.entityManagers = [this.edges, this.properties, this.nodeLabels];

    this.keepProvenance = trueIfUndefined(XX.keepProvenance(dataset));
    this.blankNodeMapping = XX.readBlankNodeMapping(dataset);
  }

  produceMarks(dataset: DStar) {
    for (const entityManager of this.entityManagers) {
      entityManager.ruleset.addInitialMarks(dataset);
      entityManager.refineRules(dataset);
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
  findEdgeTemplate(ruleNode: Quad_Subject): Template {
    return this.edges.getTemplateFor(ruleNode, prec.Edges)!;
  }

  /**
   * Same as `findEdgeTemplate` but for properties.
   * `type` should be `prec:(Node|Edge|Meta)Properties`
   */
  findPropertyTemplate(ruleNode: Quad_Subject, type: NamedNode): Template {
    return this.properties.getTemplateFor(ruleNode, type)!;
  }

  getNodeLabelTemplateQuads(ruleNode: Quad_Subject) {
    return this.nodeLabels.getTemplateFor(ruleNode, prec.NodeLabels)!.quads;
  }
}

function trueIfUndefined(b: boolean | undefined) {
  return b === undefined ? true : b;
}


let contextValidator: SHACLValidator | undefined = undefined;

/**
 * Return true if the dataset is a valid context according to the context shape
 * graph
 * @param dataset The context
 */
export function isShaclValidContext(dataset: DStar): boolean {
  if (contextValidator === undefined) {
    const shapePath = path.join(__dirname, "..", "..", "data", "PRECContextShape.ttl");
    const shapeContent = fs.readFileSync(shapePath, 'utf-8');
    const shapeStore = new n3.Store(new n3.Parser().parse(shapeContent));
  
    contextValidator = new SHACLValidator(shapeStore, { factory });
  }

  return contextValidator.validate(dataset).conforms;
}
