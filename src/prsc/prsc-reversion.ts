import TermMap from "@rdfjs/term-map";
import TermSet from "@rdfjs/term-set";
import * as RDF from "@rdfjs/types";
import DStar from "../dataset";
import { characterizeTemplateTriple, extractBnsIn, haveSameStrings, PRSCContext, PRSCRule } from "./PrscContext";
import { SignatureTripleOf } from "./reversion-type-identification";
import * as RDFString from 'rdf-string';
import { $blankNode, prec, pvarDestination, pvarSource, rdf, rdfs, pgo, $quad, $literal } from "../PRECNamespace";
import { NodePlaceholder } from "./well-behaved-check";
import { isEdgeUniqueTemplate } from "./PrscRule";
import namespace from "@rdfjs/namespace";
import { DataFactory } from "n3";

const ex   = namespace("http://www.example.org/"                    , { factory: DataFactory });

export type RDFPGraph = {
  nodes: RDFPGNode[];
  edges: RDFPGEdge[];
};

export type RDFPGElement = {
  self: RDF.BlankNode;
  rule: PRSCRule;
  properties: Map<string, RDF.Term>;  
};

export type RDFPGNode = RDFPGElement;

export type RDFPGEdge = RDFPGElement & {
  source: RDF.BlankNode, destination: RDF.BlankNode
};

/**
 * Convert the given RDF graph into a PG-like structure using the given
 * context
 * @param rdfGraph The RDF graph
 * @param context The PRSC well behaved context
 * @returns The PG-like structure
 */
export function rdfToPG(rdfGraph: RDF.DatasetCore, context: PRSCContext): RDFPGraph {
  const elements: RDF.BlankNode[] = findElements(rdfGraph);

  const signatures = context.getAllSignatures();

  const typeOf: TermMap<RDF.BlankNode, PRSCRule> = findTypeOfElements(rdfGraph, signatures, elements);
  const { builtFrom, edgeUniqueQuads } = associateTriplesWithElements(rdfGraph, typeOf);
  const pg = buildPropertyGraph(typeOf, builtFrom);

  const edgeUniqueEdges = extractEdgeUniques(edgeUniqueQuads, context);
  pg.edges.push(...edgeUniqueEdges);
  return pg;
}

/**
 * Conver thte given RDF graph into an PREC-0 RDF-graph
 * @param rdfGraph The RDF graph
 * @param context The well behaved PRSC context
 */
export function rdfToPREC0(rdfGraph: RDF.DatasetCore, context: PRSCContext): DStar {
  const typedBlankNodePropertyGraph = rdfToPG(rdfGraph, context);

  const output = new DStar();

  for (const element of [...typedBlankNodePropertyGraph.nodes, ...typedBlankNodePropertyGraph.edges]) {
    const kind = element.rule.kind;

    const pgoType = kind === "node" ? pgo.Node : pgo.Edge;
    const labelType = kind === 'node' ? prec.CreatedNodeLabel : prec.CreatedEdgeLabel;
    const linkFromElement = kind === 'node' ? rdf.type : rdf.predicate;

    output.add($quad(element.self, rdf.type, pgoType));

    element.rule.labels.forEach(label => {
      const labelBlankNode = ex["vocab/" + kind + "/label/" + label];
      output.addAll([
        $quad(element.self, linkFromElement, labelBlankNode),
        $quad(labelBlankNode, rdfs.label, $literal(label)),
        $quad(labelBlankNode, rdf.type, labelType),
        $quad(labelType, rdfs.subClassOf, prec.CreatedVocabulary)
      ]);
    });

    const labelsM = [...element.rule.labels].sort().join("-");

    for (const [propertyKey, propertyValue] of element.properties) {
      const pn = ex["vocab/" + kind + "/property/" + propertyKey + "/" + labelsM];
      const bn = $blankNode();

      output.addAll([
        $quad(element.self, pn, bn),
        $quad(pn, rdfs.label, $literal(propertyKey)),
        $quad(bn, rdf.value, propertyValue as RDF.Quad_Object),
        $quad(bn, rdf.type, prec.PropertyKeyValue),
        $quad(pn, rdf.type, prec.PropertyKey),
        $quad(pn, rdf.type, prec.CreatedPropertyKey),
        $quad(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary)
      ]);
    }
  }

  for (const edge of typedBlankNodePropertyGraph.edges) {
    output.addAll([
      $quad(edge.self, rdf.subject, edge.source),
      $quad(edge.self, rdf.object, edge.destination)
    ]);
  }

  return output;
}

/** Return the list of blank nodes in the RDF graph */
function findElements(rdfGraph: RDF.DatasetCore) {
  const result = new TermSet<RDF.BlankNode>();

  for (const quad of rdfGraph) {
    for (const blankNode of extractBnsIn(quad)) {
      result.add(blankNode);
    }
  }

  return [...result];
}

/**
 * Find the types of the elements of the PG from the signatures and the RDF
 * graph.
 * @param rdfGraph The RDF graph to revert
 * @param signatures The list of signatures / rule pairs. Should not contain
 * the same rule twice.
 * @param elements The list of elements of the RDF graph / PG
 * @returns The mapping from the elements to their types
 */
function findTypeOfElements(rdfGraph: RDF.DatasetCore, signatures: SignatureTripleOf[], elements: RDF.BlankNode[]) {
  // Map-pize the signatures
  const signaturesMap = new TermMap<RDF.Quad, SignatureTripleOf>();
  for (const signature of signatures) {
    if (signature.kind === 'edge-unique') continue;

    const kappaValue = characterizeTemplateTriple(signature.signature);

    const alreadyPlaced = signaturesMap.get(kappaValue);
    if (alreadyPlaced === undefined) {
      signaturesMap.set(kappaValue, signature);
    } else {
      throw Error(`The rules ${RDFString.termToString(signature.rule.identity)} and ${RDFString.termToString(alreadyPlaced.rule.identity)} have the same signatures`);
    }
  }

  // Find the candidates
  const allCandidates = new TermMap<RDF.BlankNode, { node: PRSCRule[], edge: PRSCRule[] }>();

  for (const quad of rdfGraph) {
    const kappaValue = characterizeTemplateTriple(quad);

    const signatureOf = signaturesMap.get(kappaValue);
    if (signatureOf === undefined) continue;

    for (const element of extractBnsIn(quad)) {
      let candidates = allCandidates.get(element);
      if (candidates === undefined) {
        candidates = { node: [], edge: [] }
        allCandidates.set(element, candidates);
      }

      const rules = candidates[signatureOf.rule.kind];

      if (!rules.includes(signatureOf.rule)) {
        rules.push(signatureOf.rule);
      }
    }
  }

  const result = new TermMap<RDF.BlankNode, PRSCRule>();

  for (const element of elements) {
    const candidates = allCandidates.get(element);
    if (candidates === undefined) {
      throw Error(`Could not find the type of ${RDFString.termToString(element)} (no candidate)`);
    }

    if (candidates.node.length == 0 && candidates.edge.length === 1) {
      result.set(element, candidates.edge[0]);
    } else if (candidates.node.length === 1) {
      result.set(element, candidates.node[0])
    } else {
      throw Error(`Could not find the type of ${RDFString.termToString(element)} (invalid number of candidates)`);
    }
  }

  return result;
}

/**
 * Return the list of triples related to each element
 * @param rdfGraph The RDF graph
 * @param typeOf The type of each elements
 * @returns The list of triples generated by each element and the list of
 * triples (probably) coming from edge unique edges.
 */
function associateTriplesWithElements(
  rdfGraph: RDF.DatasetCore, typeOf: TermMap<RDF.BlankNode, PRSCRule>
  ): { builtFrom: TermMap<RDF.BlankNode, RDF.Quad[]>, edgeUniqueQuads: RDF.Quad[] } {
  const builtFrom = new TermMap<RDF.BlankNode, RDF.Quad[]>();
  const edgeUniqueQuads = [] as RDF.Quad[];

  function addTo(element: RDF.BlankNode, quad: RDF.Quad) {
    let quads = builtFrom.get(element);
    if (quads === undefined) {
      quads = [];
      builtFrom.set(element, quads);
    }
    quads.push(quad);
  }

  for (const quad of rdfGraph) {
    const bns = extractBnsIn(quad);

    if (bns.length === 0) continue;

    if (bns.length === 1) {
      addTo(bns[0], quad);
      continue;
    }

    const edges = bns.filter(bn => typeOf.get(bn)?.kind === 'edge');
    if (edges.length > 1) {
      throw Error("More than one edge found in an edge");
    } else if (edges.length === 1) {
      addTo(edges[0], quad);
    } else {
      const nodes = bns.filter(bn => typeOf.get(bn)?.kind === 'node');

      if (nodes.length === 2) {
        edgeUniqueQuads.push(quad);
      } else {
        throw Error("Found a a triple with 0 edge and >= 3 nodes");
      }
    }
  }

  return { builtFrom, edgeUniqueQuads };
}

/**
 * Build a PG-like structure from the triples generated by well-behaved rules
 * @param typeOf The types of each element
 * @param builtFrom The triples generated for each element
 * @returns The PG-like structure
 */
function buildPropertyGraph(
  typeOf: TermMap<RDF.BlankNode, PRSCRule>, builtFrom: TermMap<RDF.BlankNode, RDF.Quad[]>
  ): { nodes: RDFPGNode[], edges: RDFPGEdge[] } {
  const propertyGraph = { nodes: [] as RDFPGNode[], edges: [] as RDFPGEdge[] };

  const elements = new TermSet([...typeOf.keys(), ...builtFrom.keys()]);

  for (const element of elements) {
    const typeOfElement = typeOf.get(element);
    const subGraph = builtFrom.get(element);

    if (typeOfElement === undefined || subGraph === undefined) {
      throw Error("Missing information about " + RDFString.termToString(element));
    }

    const { properties, source, destination } = computeProperties(subGraph, typeOfElement.template);

    if (!haveSameStrings([...properties.keys()], typeOfElement.properties)) {
      throw Error(
        "An element do not have all its properties "
        + RDFString.termToString(element)
        + " ; Expected: " + typeOfElement.properties.join("/")
        + " - Actual: " + [...properties.keys()].join("/")
        );
    }

    if (typeOfElement.kind === "node") {
      if (source !== null || destination !== null) {
        throw Error("A node has a source or a destination");
      }

      propertyGraph.nodes.push({
        self: element,
        rule: typeOfElement,
        properties: properties
      });
    } else {
      if (source === null || destination === null) {
        throw Error("An edge has no source and/or no destination");
      }

      propertyGraph.edges.push({
        self: element,
        rule: typeOfElement,
        properties: properties,
        source: source,
        destination: destination
      });
    }
  }

  return propertyGraph;
}

function computeProperties(
  subGraph: RDF.Quad[], template: RDF.Quad[]
  ): {
    properties: Map<string, RDF.Term>,
    source: RDF.BlankNode | null,
    destination: RDF.BlankNode | null
  } {
  const access = computeAccessibleProperties(template);

  const properties = new Map<string, RDF.Term>();
  let source: RDF.BlankNode | null = null;
  let destination: RDF.BlankNode | null = null;

  for (const quad of subGraph) {
    const kappaValue = characterizeTemplateTriple(quad);
    const accessible = access.get(kappaValue);
    if (accessible === undefined || accessible === null) continue;

    for (const accessor of accessible) {
      const kind = accessor.kind;
      const value = accessor.access(quad);

      if (value === undefined) {
        throw Error("Invalid value accessed");
      }

      if (kind === NodePlaceholder.Source) {
        if (value.termType !== 'BlankNode') {
          throw Error("Invalid value accessed");
        } else if (source !== null && !source.equals(value)) {
          throw Error("Inconsistant property value");
        }

        source = value;
      } else if (kind === NodePlaceholder.Destination) {
        if (value.termType !== 'BlankNode') {
          throw Error("Invalid value accessed");
        } else if (destination !== null && !destination.equals(value)) {
          throw Error("Inconsistant property value");
        }

        destination = value;
      } else {
        if (value.termType !== 'Literal') {
          throw Error("Invalid value accessed");
        }
        
        const placed = properties.get(kind);
        if (placed === undefined) {
          properties.set(kind, value);
        } else if (placed !== value) {
          throw Error("Inconsistant property value");
        }
      }
    }
  }

  return { properties, source, destination };
}

class Accessor {
  readonly kind: string | NodePlaceholder;
  readonly path: ('subject' | 'predicate' | 'object')[];

  // Use
  access(term: RDF.Quad): RDF.Term | undefined {
    return Accessor.follow(term, this.path, 0);
  }

  static follow(term: RDF.Term, path: ('subject' | 'predicate' | 'object')[], i: number): RDF.Term | undefined {
    if (i === path.length) return term;
    if (term.termType !== 'Quad') return undefined;
    return this.follow(term[path[i]], path, i + 1);
  }

  // Construction
  private constructor(kind: string | NodePlaceholder, path: ('subject' | 'predicate' | 'object')[]) {
    this.kind = kind;
    this.path = path;
  }

  static generate(templateTriple: RDF.Quad): Accessor[] {
    function visit(templateTerm: RDF.Term): Accessor[] {
      if (templateTerm.termType === 'BlankNode') {
        return [];
      } else if (templateTerm.termType === 'DefaultGraph') {
        return [];
      } else if (templateTerm.termType === 'Literal') {
        if (templateTerm.datatype.equals(prec._valueOf)) {
          return [new Accessor(templateTerm.value, [])];
        } else {
          return [];
        }
      } else if (templateTerm.termType === 'Variable') {
        return [];
      } else if (templateTerm.termType === 'NamedNode') {
        if (templateTerm.equals(pvarSource)) {
          return [new Accessor(NodePlaceholder.Source, [])];
        } else if (templateTerm.equals(pvarDestination)) {
          return [new Accessor(NodePlaceholder.Destination, [])];
        } else {
          return [];
        }
      } else {
        return [
          ...visit(templateTerm.subject).map(a => a.addFront('subject')),
          ...visit(templateTerm.predicate).map(a => a.addFront('predicate')),
          ...visit(templateTerm.object).map(a => a.addFront('object'))
        ];
      }
    }

    return visit(templateTriple);
  }
  
  private addFront(where: 'subject' | 'predicate' | 'object') {
    this.path.unshift(where);
    return this;
  }
}

function computeAccessibleProperties(templateGraph: RDF.Quad[]): TermMap<RDF.Quad, Accessor[]> {
  // Compute unique template triples
  const uniqueTemplates = new TermMap<RDF.Quad, RDF.Quad | null>();

  for (const templateTriple of templateGraph) {
    const kappaValue = characterizeTemplateTriple(templateTriple);

    const alreadyInPlace = uniqueTemplates.get(kappaValue);
    if (alreadyInPlace === undefined) {
      uniqueTemplates.set(kappaValue, templateTriple);
    } else if (alreadyInPlace !== null) {
      uniqueTemplates.set(kappaValue, null);
    }
  }

  // Build accessors
  const allAccessors = new TermMap<RDF.Quad, Accessor[]>();

  for (const [kappaValue, uniqueTemplateTriple] of uniqueTemplates.entries()) {
    if (uniqueTemplateTriple === null) continue;

    const accessors = Accessor.generate(uniqueTemplateTriple);
    if (accessors.length > 0) {
      allAccessors.set(kappaValue, accessors);
    }
  }

  return allAccessors;
}

function extractEdgeUniques(edgeUniqueQuads: RDF.Quad[], context: PRSCContext) {
  const kappaToGenerator = new TermMap<RDF.Quad, { template: RDF.Quad | null, rule: PRSCRule }>();

  for (const rule of context.prscRules) {
    if (rule.kind !== "edge") continue;
    if (!isEdgeUniqueTemplate(rule.template)) continue;

    for (const templateTriple of rule.template) {
      const kappaValue = characterizeTemplateTriple(templateTriple);

      const generator = kappaToGenerator.get(kappaValue);
      if (generator === undefined) {
        kappaToGenerator.set(kappaValue, { template: templateTriple, rule: rule });
      } else if (generator.rule === rule) {
        // Can not use this template triple as it is not unique, but we can
        // still manage to revert if we ignore both templates
        generator.template = null;
      } else {
        throw Error(`Not all triples in edge unique type ${RDFString.termToString(rule.identity)} are signature and unique`);
      }
    }
  }

  const edgeUniqueEdges: RDFPGEdge[] = [];

  for (const dataTriple of edgeUniqueQuads) {
    const kappa = characterizeTemplateTriple(dataTriple);
    const generator = kappaToGenerator.get(kappa);
    if (generator === undefined) {
      throw Error(`The data triple ${RDFString.termToString(dataTriple)} seems to comes from an edge unique edge but could not find which`);
    }
    if (generator.template === null) continue; // Unusable triple

    const accessors = Accessor.generate(generator.template);
    const values = accessors.map(accessor => ({
      kind: accessor.kind,
      value: accessor.access(dataTriple)
    }));

    const source = values.find(v => v.kind === NodePlaceholder.Source)?.value;
    const destination = values.find(v => v.kind === NodePlaceholder.Destination)?.value;

    if (source === undefined || destination === undefined) {
      throw Error("A edge unique data triple did not return the source or destination");
    }

    if (source.termType !== 'BlankNode' || destination.termType !== 'BlankNode') {
      throw Error("A edge unique data triple did not return the source or destination as a blank node");
    }

    let edgeUniqueEdge = edgeUniqueEdges.find(eue => 
      eue.source.equals(source)
      && eue.destination.equals(destination)
      && eue.rule === generator.rule
      );

    if (edgeUniqueEdge === undefined) {
      edgeUniqueEdge = {
        self: $blankNode(),
        rule: generator.rule,
        source: source,
        destination: destination,
        properties: new Map()
      };

      edgeUniqueEdges.push(edgeUniqueEdge);
    }

    for (const accessedValue of values) {
      if (accessedValue.value === undefined) {
        throw Error("Bad value access");
      }

      if (typeof accessedValue.kind === 'string') {
        edgeUniqueEdge.properties.set(accessedValue.kind, accessedValue.value);
      }
    }
  }

  for (const eue of edgeUniqueEdges) {
    if (!haveSameStrings([...eue.properties.keys()], eue.rule.properties)) {
      throw Error("An edge unique edge do not have all its properties");
    }
  }

  return edgeUniqueEdges;
}
