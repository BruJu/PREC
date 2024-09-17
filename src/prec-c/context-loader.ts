import DStar from '../dataset/index';

import fs from 'fs';
import * as N3 from 'n3';
import * as RDF from '@rdfjs/types';
import TermMap from '@rdfjs/term-map';
import TermSet from '@rdfjs/term-set';
import * as QuadStar from '../rdf/quad-star';
import * as PrecUtils from '../rdf/utils';
import { FilterProvider, Priorisable, RuleDomain, RuleType, Template } from './RuleType';

import {
  rdf, xsd, prec, pvar, pgo,
  $quad, $blankNode, $variable, $defaultGraph
} from '../PRECNamespace';
import { termToString } from 'rdf-string';

// This file contains utility functions for the Context.ts file

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/**
 * Sort the elements an array by `element.priority`. The
 * higher the priority, the lower the element is.
 * @param array The array to sort
 */
function sortArrayByPriority(array: Priorisable[]) {
  array.sort((lhs_, rhs_) => {
    let lhs = lhs_.priority;
    let rhs = rhs_.priority;

    // User defined priority
    if (lhs[0] === undefined) {
      if (rhs[0] !== undefined) return -1;
    } else if (rhs[0] === undefined) {
      return 1;
    } else if (lhs[0] !== rhs[0]) {
      return lhs[0] - rhs[0];
    }

    // Our priority
    if (lhs[1] < rhs[1]) return -1;
    if (lhs[1] > rhs[1]) return 1;
    return 0;
  });
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/** Manager for a list of terms that are substituable in a given context. */
export class SubstitutionPredicates {
  data: { key: RDF.Term, value: RDF.Term }[];
  keys: RDF.Term[];

  /**
   * Build a `SubstitutionPredicates` with the subsitution terms described in the
   * context dataset.
   * @param dataset A dataset that contains all the quads of the context
   */
  constructor(dataset: DStar) {
    this.data = dataset.getQuads(null, prec.substitutionTarget, null, $defaultGraph)
      .map(quad => Object.freeze({ key: quad.subject, value: quad.object }));

    this.keys = this.data.map(t => t.key);
    
    Object.freeze(this.data);
    Object.freeze(this.keys);
  }

  /**
  * Return the list of substituable terms.
  * @returns The list of substituable terms
  */
  getKeys() { return this.keys; }

  /**
   * Return the term that is targetted by the given substitution term
   * @param term An RDF/JS term
   * @returns The term that is targetted by this term
   */
  get(term: RDF.Term) {
    const f = this.data.find(t => t.key.equals(term));
    return f !== undefined ? f.value : undefined;
  }
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//  --- NEP MANAGER  ---  NEP MANAGER  ---    NEP MANAGER  ---  
//  --- NEP MANAGER  ---  NEP MANAGER  ---    NEP MANAGER  ---  

type SplitDef = {
  type: RDF.Term | undefined;

  conditions: SplitDefConditions;
  materialization: SplitDefMaterialization;
};

export type SplitDefConditions = {
  label: RDF.Literal | undefined;
  explicitPriority: number | undefined;
  otherLength: number;
  other: [RDF.Term, RDF.Term][];
};

type SplitDefMaterialization = {
  templatedBy: RDF.Term | undefined;
  substitutions: [RDF.Term, RDF.Term][];
};

/**
 * Helper functions that read a rule and split its values in a JS dictionnary.
 */
class SplitNamespace {
  /**
   * Reads all the quads about a rule and builds a JS object from it
   * @param contextDataset The store
   * @param ruleNode The node that represents the rule
   * @param Cls A dict that contains the IRI related to the kind of rules
   * to manage.
   * @param substitutionPredicates The list of substitution predicates known in
   * the context graph.
   * @returns An object with the data about the node. Throws if the rule is
   * invalid.
   * 
   * The object has the form:
   * ```
   * {
   *   type: type of the rule,
   * 
   *   conditions: {
   *     label: undefined | the relatiosnip label or property name targetted
   * by this rule (value of Cls.MainLabel),
   *     explicitPriority: value of prec:priority,
   *     otherLength: - other.length,
   *     other: The list of [condition, value], where condition is a term
   * from Cls.PossibleConditions, and value is its value. It contains the
   * conditions on other things than the label.
   *   }
   * 
   *   materialization: {
   *      templatedBy: name of the template to template with,
   *      substitutions: list of pairs of [substitutedTerm, substitutitedWith]
   *   }
   * }
   * ```
   */
  static splitDefinition(
    contextDataset: DStar,
    ruleNode: RDF.Quad_Subject,
    Cls: RuleDomain,
    substitutionPredicates: SubstitutionPredicates
  ) {
    let r: SplitDef = {
      type: undefined,

      conditions: {
        label: undefined,
        explicitPriority: undefined,
        otherLength: 0,
        other: []
      },

      materialization: {
        templatedBy: undefined,
        substitutions: []
      }
    };
  
    function errorMalformedRule(message: string) {
      return Error(`Rule ${ruleNode.value} is malformed - ${message}`);
    }
  
    function throwIfNotALiteral(term: RDF.Term, predicate: RDF.Term): RDF.Literal {
      if (term.termType !== "Literal")
        throw errorMalformedRule(`${predicate.value} value (${term.value}) is not a literal.`)
      
      return term;
    }
      
    for (const quad of contextDataset.getQuads(ruleNode, null, null, $defaultGraph)) {
      if (rdf.type.equals(quad.predicate)) {
        r.type = quad.object;
      } else if (Cls.MainLabel.equals(quad.predicate)) {
        if (r.conditions.label !== undefined)
          throw errorMalformedRule(`${quad.predicate.value} should appear only once.`);
        
        const object = throwIfNotALiteral(quad.object, quad.predicate);
        r.conditions.label = object;
      } else if (prec.priority.equals(quad.predicate)) {
        if (r.conditions.explicitPriority !== undefined)
          throw errorMalformedRule(`prec:priority should have at most one value.`);
        
        const object = throwIfNotALiteral(quad.object, quad.predicate);
        if (!xsd.integer.equals(object.datatype)) {
          throw errorMalformedRule(`prec:priority object should be of type xsd:integer`);
        }
        
        r.conditions.explicitPriority = parseInt(quad.object.value);
      } else if (PrecUtils.termIsIn(quad.predicate, Cls.PossibleConditions)) {
        r.conditions.other.push([quad.predicate, quad.object]);
      } else if (prec.templatedBy.equals(quad.predicate)) {
        if (r.materialization.templatedBy !== undefined)
          throw errorMalformedRule(`prec:templatedBy should have at most one value.`);
        
        r.materialization.templatedBy = quad.object;
      } else if (PrecUtils.termIsIn(quad.predicate, substitutionPredicates.getKeys())) {
        let substitutedTerm = substitutionPredicates.get(quad.predicate)!;
        r.materialization.substitutions.push([substitutedTerm, quad.object]);
      } else {
        throw errorMalformedRule(`Unknown predicate ${quad.predicate.value}`);
      }
    }

    r.conditions.otherLength = -r.conditions.other.length;

    r.conditions.other.sort((lhs, rhs) => {
      const l = JSON.stringify(lhs);
      const r = JSON.stringify(rhs);

      if (l < r) return -1;
      if (l > r) return 1;
      return 0;
    });

    return r;
  }

  /**
   * Throw if other fields than the one in materialization have been filled
   * = this rule have been filled with other things than a template name and
   * substitution terms.
   */
  static throwIfNotMaterializationOnly(splitDefinition: SplitDef, rule: RDF.Term) {
    let r = splitDefinition.type === undefined
      && splitDefinition.conditions.label === undefined
      && splitDefinition.conditions.explicitPriority === undefined
      && splitDefinition.conditions.otherLength === 0;
    
    if (!r) {
      throw Error(`Rule ${rule.value} is malformed: It should not have`
        + ` have any condition and should not be typed.`
        + "\n" + JSON.stringify(splitDefinition, null, 2)
      );
    }
  }

  /**
   * Throw if the condition fields have not been filled = this rule is
   * incomplete.
   */
  static throwIfHaveNoCondition(splitDefinition: SplitDef, rule: RDF.Term, Cls: RuleDomain) {
    function throwError(message: string) {
      throw Error(`Rule ${rule.value} is malformed: ${message}`)
    }

    if (splitDefinition.type === undefined) {
      throwError("Unknown type");
    }

    if (splitDefinition.conditions.label === undefined) {
      throwError(`It should have a value for ${Cls.MainLabel.value}`)
    }
  }
}

export function readRawTemplate(dataset: DStar, template: RDF.Term, ruleDomain: RuleDomain)
: { templateGraph: RDF.Quad[], selfIs: RDF.Term[] }
{
  // Load the abstract template
  let templateGraph = dataset.getQuads(template, prec.produces, null, $defaultGraph)
    .map(quad => quad.object) as RDF.Quad[];
  
  // Non Backward compatibility
  const forbiddenTerms = new TermSet<RDF.Term>([
    pvar.propertyPredicate, pvar.propertyObject,
    pvar.metaPropertyPredicate, pvar.metaPropertyObject
  ]);

  const allPositions = ['subject', 'predicate', 'object', 'graph'] as const;
  
  for (const templateQuad of templateGraph) {
    if (templateQuad.termType !== 'Quad') {
      throw Error('Object of template quad must be a quad');
    }

    if (allPositions.some(position => forbiddenTerms.has(templateQuad[position]))) {
      const str = "Invalid template, pvar:(metaP|p)roperty(Object|Predicate) are obsolete. Use [] "
        + termToString(ruleDomain.SelfIdentityIs) + " instead."

      throw Error(str);
    }
  }
    
  let selfIs: RDF.Term[] = [];
      
  if (ruleDomain.SelfIdentityIs !== null) {
    selfIs = dataset
      .getQuads(template, ruleDomain.SelfIdentityIs, null, $defaultGraph)
      .map(q => q.object);

    if (selfIs.length === 0) {
      selfIs = findImplicitSelfIdentity(ruleDomain.SelfIdentityHeuristic || [], templateGraph) || [];
    }
  }

  return { templateGraph, selfIs };
}

/**
 * Build the concrete template from a list of materializations
 * @param dataset The context store
 * @param materializations The list of materializations that applies
 * @param ruleDomain The List of IRIs related ot the type of rule
 * @returns The template (= destination pattern in find-filter-replace)
 */
function _buildTemplate(dataset: DStar, materializations: SplitDefMaterialization[], ruleDomain: RuleDomain): Template {
  let template = ruleDomain.DefaultTemplate;
  let substitutionRequests = new TermMap<RDF.Term, RDF.Term>();

  for (const materialization of materializations) {
    // Copy all substitution
    for (const sub of materialization.substitutions) {
      if (substitutionRequests.get(sub[0]) === undefined) {
        substitutionRequests.set(sub[0], sub[1]);
      }
    }

    // Is the template there?
    if (materialization.templatedBy !== undefined) {
      template = materialization.templatedBy;
      break;
    }
  }
    
  const { templateGraph, selfIs } = readRawTemplate(dataset, template, ruleDomain);

  function remapFunc(term: RDF.Quad) {
    return QuadStar.eventuallyRebuildQuad(
      term,
      t => substitutionRequests.get(t) || t
    )
  }

  return {
    quads: templateGraph.map(remapFunc),
    selfIs: selfIs.map(term => remapFunc($quad(prec._, prec._, term as RDF.Quad_Object)).object)
  };
}

/**
 * Returns true if term is either the subject, the predicate, the object
 * or the graph of the quad
 * @param term The term
 * @param quad The quad
 */
function isAMainComponentOf(term: RDF.Term, quad: RDF.Quad): boolean {
  return quad.subject.equals(term)
    || quad.predicate.equals(term)
    || quad.object.equals(term)
    || quad.graph.equals(term);
}

function findImplicitSelfIdentity(searchedTermss: RDF.NamedNode[][], quads: RDF.Quad[]) {
  for (const searchedTerms of searchedTermss) {
    const c = quads.filter(q => searchedTerms.every(term => isAMainComponentOf(term, q)));

    if (c.length === 0) continue;
    if (searchedTerms.length === 1) return searchedTerms;

    const td = new TermSet<RDF.Quad>(c);
    const l = [...td.keys()];

    if (l.length !== 1) return null;
    return l;
  }

  return null;
}

/**
 * A manager manage all rules of a kind
 */
export class NEPManager {
  /** List of rules to apply */
  iriRemapper: FilterProvider[] = [];

  // List of known (and computed) templates
  templatess = new TermMap<RDF.Quad_Subject, TermMap<RDF.Quad_Subject, Template>>();
  
  ruleset: RuleType;

  /**
   * Build a `NEPManager` from the `contextDataset`.
   * @param contextDataset The store that contains the context
   * @param substitutionPredicates The list of substitutions predicates
   * @param Cls The class that manages an individual rule. It must also
   * contain as static data the list of IRIs related to this rule.
   */
  constructor(contextDataset: DStar, substitutionPredicates: SubstitutionPredicates, Cls: RuleType) {
    this.ruleset = Cls;
    const domain = Cls.domain;

    function makeTemplate(materializations: SplitDefMaterialization[]) {
      return _buildTemplate(contextDataset, materializations, domain);
    }

    // Load the base templates
    let baseTemplates = new TermMap<RDF.Quad_Subject, SplitDefMaterialization>();

    for (const templateName of domain.TemplateBases) {
      // Read the node, ensure it just have a template
      const splitted = SplitNamespace.splitDefinition(contextDataset, templateName, domain, substitutionPredicates);
      SplitNamespace.throwIfNotMaterializationOnly(splitted, templateName);

      // The template can be used to compute other templates
      baseTemplates.set(templateName, splitted.materialization);
      // Also a tempalte that can be used
      let tm = new TermMap<RDF.Quad_Subject, Template>();
      tm.set(templateName, makeTemplate([splitted.materialization]));
      this.templatess.set(templateName, tm);
    }

    // Load the templates for user defined rules
    let existingNodes: {[k: string]: RDF.Quad_Subject} = {};

    for (let quad of contextDataset.getQuads(null, rdf.type, domain.RuleType, $defaultGraph)) {
      const splitted = SplitNamespace.splitDefinition(contextDataset, quad.subject, domain, substitutionPredicates);
      SplitNamespace.throwIfHaveNoCondition(splitted, quad.subject, domain);

      let conditions = JSON.stringify(splitted.conditions);
      if (existingNodes[conditions] !== undefined) {
        throw Error(
          `Invalid context: nodes ${existingNodes[conditions].value} `
          + `and ${quad.subject.value} have the exact same target`
        );
      }
      existingNodes[conditions] = quad.subject;

      // Read remapping=
      this.iriRemapper.push(Cls.makeOneRuleFilter(splitted.conditions, conditions, quad.subject));

      for (const templateName of domain.TemplateBases) {
        // Add the pair template name - template
        const template = makeTemplate([splitted.materialization, baseTemplates.get(templateName)!])
        this.templatess.get(templateName)!.set(quad.subject, template);
      }
    }
    
    sortArrayByPriority(this.iriRemapper)
  }

  /**
   * Return the template contained in the given description node
   * @param {Term} descriptionNode The description node
   * @returns The template, or undefined if not specified by the user
   */
  getTemplateFor(ruleNode: RDF.Quad_Subject, type: RDF.Quad_Subject) {
    let templatesOfType = this.templatess.get(type)!;
    return templatesOfType.get(ruleNode)
        // If not found, use to the one used for the whole type instead
        || templatesOfType.get(type);
  }

  /**
   * Refine the rules to apply depending on the kind of rule of this manager
   * @param {DStar} dataset The marked dataset
   */
  refineRules(dataset: DStar) {
    this.iriRemapper.forEach(rule => {
      for (const { source, conditions, destination } of rule.getFilters()) {
        dataset.findFilterReplace(source, conditions, destination);
      }
    });
  }
}


////////////////////////////////////////////////////////////////////////////////
// Anything Goes

/**
 * Read the `prec:KeepProvenance prec:flagState true|false` quad
 * @param store 
 */
export function keepProvenance(store: DStar | N3.Store) {
  const quads = store.getQuads(prec.KeepProvenance, prec.flagState, null, $defaultGraph);
  if (quads.length === 0) return true;
  return PrecUtils.xsdBoolToBool(quads[0].object);
}

/**
 * Read the
 * `(pgo:Node | pgo:Edge | prec:PropertyKey) prec:mapBlankNodesToPrefix ?o`
 * triples and return the map `[s.value] = ?o`.
 * 
 * This extracts the prefix to map each type of elements from the property graph
 * @param store The context store
 */
export function readBlankNodeMapping(store: DStar | N3.Store): {[domain: string]: string} {
  let s: {[domain: string]: string} = {};
  for (const quad of store.getQuads(null, prec.mapBlankNodesToPrefix, null, $defaultGraph)) {
    let target = quad.subject;

    if (!target.equals(pgo.Node)
      && !target.equals(pgo.Edge)
      && !target.equals(prec.PropertyKey)) {
      console.error("Unknown subject of mapTo " + target.value);
      continue;
    }

    if (quad.object.termType !== "NamedNode") {
      console.error("Object of mapTo must be of type named node");
      continue;
    }

    s[target.value] = quad.object.value;
  }

  return s;
}

/**
 * Read the quads from a Turtle-star file and add them to the dataset.
 * @param dataset The dataset to populate
 * @param file The path to the Turtle-star file
 */
export function addBuiltIn(dataset: DStar, file: string) {
  const trig = fs.readFileSync(file, 'utf-8');
  dataset.addAll((new N3.Parser()).parse(trig));
}

/**
 * Replaces every relationship related term with its edge related counterpart.
 * @param dataset The store to modify
 */
export function replaceSynonyms(dataset: DStar) {
  function makeSynonymsDict() {
    let dict = new TermMap<RDF.Term, RDF.Term>();
    dict.set(prec.RelationshipRule      , prec.EdgeRule);
    dict.set(prec.RelationshipTemplate  , prec.EdgeTemplate);
    dict.set(prec.Relationships         , prec.Edges);
    dict.set(prec.RelationshipProperties, prec.EdgeProperties);
    dict.set(prec.IRIOfRelationshipLabel, prec.IRIOfEdgeLabel);
    dict.set(prec.relationshipIRI       , prec.edgeIRI);
    dict.set(pvar.relationshipIRI       , pvar.edgeIRI);
    dict.set(pvar.relationship          , pvar.edge);
    return dict;
  }

  /**
   * Transform the dataset by replacing the terms found in the dict to the one
   * it maps to
   * @param dataset 
   * @param dict A Term to term dict
   */
  function transformStore(dataset: DStar, dict: TermMap<RDF.Term, RDF.Term>) {
    const toDelete: RDF.Quad[] = [];
    const toAdd: RDF.Quad[] = [];

    for (const quad of dataset) {
      const newQuad = QuadStar.eventuallyRebuildQuad(quad,
        term => dict.get(term) || term
      );

      if (quad !== newQuad) {
        toDelete.push(quad);
        toAdd.push(newQuad);
      }
    }

    toDelete.forEach(quad => dataset.delete(quad));
    dataset.addAll(toAdd);
  }

  transformStore(dataset, makeSynonymsDict());
}

/**
 * Replace the triples in the form `iri prec:IRIOfThing label .` in the store
 * with a fully developed rule.
 * 
 * The fully developed rule is:
 * ```
 * [] a <IRIs.RuleType> ; <IRIs.MainLabel> label ; <IRIs.SubstitutionPredicate> iri .
 * ```
 * with prec:IRIOfThing = `IRIs.ShortcutIRI`
 * 
 * @param dstar The context
 * @param IRIs An object that contains the different IRIs
 */
export function removeSugarForRules(dstar: DStar, IRIs: RuleDomain) {
  let sugared = dstar.getQuads(null, IRIs.ShortcutIRI, null, $defaultGraph);

  for (let quad of sugared) {
    const iri = quad.subject;
    const label = quad.object;

    if (label.termType !== 'Literal') {
      throw Error(
        `${IRIs.ShortcutIRI.value} only accepts literal in object position - `
        + `found ${label.value} (a ${label.termType}) for ${iri.value}`
      );
    }

    const ruleNode = $blankNode("SugarRule[" + label.value + "=>" + iri.value + "]");
    dstar.add($quad(ruleNode, rdf.type                  , IRIs.RuleType));
    dstar.add($quad(ruleNode, IRIs.MainLabel            , label));
    dstar.add($quad(ruleNode, IRIs.SubstitutionPredicate, iri));
  }

  dstar.removeQuads(sugared);
}

/**
 * Replace every quad in the form `prec:Properties ?p ?o ?g` with the quads :
 * ```
 * prec:NodeProperties ?p ?o ?g .
 * prec:EdgeProperties ?p ?o ?g .
 * prec:MetaProperties ?p ?o ?g .
 * ```
 * @param context The dataset that contains the context quads
 */
export function copyPropertiesValuesToSpecificProperties(context: DStar) {
  context.findFilterReplace([
      $quad(prec.Properties    , $variable('p'), $variable('o'), $variable('g'))
    ], [], [
      $quad(prec.NodeProperties, $variable('p'), $variable('o'), $variable('g')),
      $quad(prec.EdgeProperties, $variable('p'), $variable('o'), $variable('g')),
      $quad(prec.MetaProperties, $variable('p'), $variable('o'), $variable('g')),
    ]
  )
}
