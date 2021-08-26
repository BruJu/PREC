/**
 * This file provides various tools that are related to PREc, that might be
 * usefull, but does not justify having its own file.
 * 
 * Its purpose is to reduce the number of entry points in PREC by having a
 * grouped entry points for small features. They are grouped and provided by
 * using subcommands.
 */

////////////////////////////////////////////////////////////////////////////////
// ==== Namespaces

// External libraries
import namespace from '@rdfjs/namespace';
import { Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Term } from '@rdfjs/types';
import argparse from 'argparse';
import fs from 'fs';
import * as N3 from 'n3';
import { isomorphic } from "rdf-isomorphic";

// PREC
import graphReducer from "./src/prec/graph-reducer";
import { outputTheStore } from './src/rdf/parsing';
import { getNodesOfType } from './src/rdf/path-travelling';
import DStar from './src/dataset/index';

// Namespace
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", { factory: N3.DataFactory });
const prec = namespace("http://bruy.at/prec#"     , { factory: N3.DataFactory });

////////////////////////////////////////////////////////////////////////////////

function remapQuad(quad: Quad, destination: Term, source: Term): Quad {
  function _remapTerm(term: Term): Term {
    if (term.equals(source)) {
      return destination;
    } else if (term.termType === "Quad") {
      return N3.DataFactory.quad(
        _remapTerm(term.subject) as Quad_Subject,
        _remapTerm(term.predicate) as Quad_Predicate,
        _remapTerm(term.object) as Quad_Object,
        _remapTerm(term.graph) as Quad_Graph
      );
    } else {
      return term;
    }
  }

  return _remapTerm(quad) as Quad;
}

function loadRDFGraph(path: string): Quad[] {
  const trig = fs.readFileSync(path, 'utf-8');
  const parser = new N3.Parser();
  return parser.parse(trig);
}

////////////////////////////////////////////////////////////////////////////////
//// Tool for checking isomorphism

// TODO: test + improve performance as today, the movie database which is very
// small can't be checked.

const TOOL_PrecGeneratedIsomorphism = {
  command: "GeneratedIsomorphism",
  help: "Checks if two graphs generated by PREC are isomorphics if the nodes and edges IRI are replaced with blank nodes.",
  fillParser: function(parser: argparse.ArgumentParser) {
    parser.add_argument('Graph1', { help: "Path to first graph" });
    parser.add_argument('Graph2', { help: "Path to second graph" });
  },
  handler: function (args: any) {
    function load(pathToGraph: string) {
      let quads = loadRDFGraph(pathToGraph);

      // Find every nodes and edges
      let toReplace = function(quads) {
        const dataset = new N3.Store(quads);
        let nodes = getNodesOfType(dataset, pgo.Node, N3.DataFactory.defaultGraph());
        let edges = getNodesOfType(dataset, pgo.Edge, N3.DataFactory.defaultGraph());
        let propertyValue = getNodesOfType(dataset, prec.PropertyKeyValue, N3.DataFactory.defaultGraph());
        return [...nodes, ...edges, ...propertyValue];
      }(quads);

      for (let term of toReplace) {
        if (term.termType === "NamedNode" && term.value.startsWith("http://www.example.org/indiv/")) {
          const newBlankNode = N3.DataFactory.blankNode();
          quads = quads.map(quad => remapQuad(quad, newBlankNode, term));
        }
      }

      outputTheStore(new N3.Store(quads));

      return quads;
    }

    // Load
    const graph1 = load(args.Graph1);
    const graph2 = load(args.Graph2);

    // Test isomorphism
    const isomorphics = isomorphic(graph1, [... graph2]);
    console.log(isomorphics ? "The graphs are isomorphics" : "The graphs are not isomorphics");
  }
};


////////////////////////////////////////////////////////////////////////////////
//// Contextualization of already translated Property Graphs

const TOOL_Contextualize = {
  command: "ApplyContext",
  help: "Applies a given context to an RDF expanded graph generated by PREC",
  fillParser: function(parser: argparse.ArgumentParser) {
    parser.add_argument('PRECRDFGraph', { help: "Path to the RDF Graph generated by PREC" });
    parser.add_argument('Context'     , { help: "Path to the context" });
  },
  handler: function (args: any) {
    const store = new DStar(loadRDFGraph(args.PRECRDFGraph));
    const context = loadRDFGraph(args.Context);
    graphReducer(store, context);
    outputTheStore(new N3.Store([...store]));
  }
};



////////////////////////////////////////////////////////////////////////////////
//// Tool hub

type Tool = {
  command: string;
  help: string;
  fillParser: (parser: argparse.ArgumentParser) => void;
  handler: (args: any) => void;
}

/** The list of every supported tools */
const TOOLS: Tool[] = [
  TOOL_PrecGeneratedIsomorphism,
  TOOL_Contextualize
];

function main() {
  const parser = new argparse.ArgumentParser({
    description: "PREC - Miscellaneous tools"
  });

  let subparser = parser.add_subparsers();
  let handlers = new Map<string, (args: any) => void>();

  function addTool(tool: Tool) {
    let parser = subparser.add_parser(tool.command, { help: tool.help });
    parser.add_argument("CHOICE", {default: tool.command, nargs:"?", help: argparse.SUPPRESS});
    tool.fillParser(parser);
    handlers.set(tool.command, tool.handler);
  }

  TOOLS.forEach(addTool);

  let args = parser.parse_args();

  if (args.CHOICE == "" || args.CHOICE === undefined) {
    parser.print_help();
  } else {
    const handler = handlers.get(args.CHOICE);
    if (handler === undefined) parser.print_help();
    else handler(args);
  }
}

if (require.main === module) {
  main();
}
