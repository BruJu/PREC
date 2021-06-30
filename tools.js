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
const WT             = require('@bruju/wasm-tree');
const namespace      = require('@rdfjs/namespace');
const argparse       = require('argparse');
const fs             = require('fs');
const N3             = require('n3');
const { isomorphic } = require("rdf-isomorphic");


// PREC
const precm1            = require('./rdf-to-pg.js');
const graphReducer      = require("./src/prec/graph-reducer.js");
const precMain          = require("./prec.js");

// Namespace
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", N3.DataFactory);
const prec = namespace("http://bruy.at/prec#", N3.DataFactory);

////////////////////////////////////////////////////////////////////////////////

function remapQuad(quad, destination, source) {
    function _remapTerm(term) {
        if (term.equals(source)) {
            return destination;
        } else if (term.termType === "Quad") {
            return N3.DataFactory.quad(
                _remapTerm(term.subject),
                _remapTerm(term.predicate),
                _remapTerm(term.object),
                _remapTerm(term.graph)
            );
        } else {
            return term;
        }
    }

    return _remapTerm(quad);
}

function loadRDFGraph(path) {
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
    fillParser: function(parser) {
        parser.add_argument('Graph1', { help: "Path to first graph" });
        parser.add_argument('Graph2', { help: "Path to second graph" });
    },
    handler: function (args) {
        function load(pathToGraph) {
            let quads = loadRDFGraph(pathToGraph);

            // Find every nodes and edges
            let toReplace = function(quads) {
                // TODO: Support RDF-star (which probably implies using N3 instead of WT / Graphy)
                const wtdataset = new WT.Dataset();
                wtdataset.addAll(quads);
                precm1.extendDataset_PathTravelling(wtdataset);
                let nodes = wtdataset.getNodesOfType(pgo.Node, N3.DataFactory.defaultGraph());
                let edges = wtdataset.getNodesOfType(pgo.Edge, N3.DataFactory.defaultGraph());
                let propertyValue = wtdataset.getNodesOfType(prec.PropertyKeyValue, N3.DataFactory.defaultGraph());
                wtdataset.free();
                return [...nodes, ...edges, ...propertyValue];
            }(quads);

            for (let term of toReplace) {
                if (term.termType === "NamedNode"
                    && term.value.startsWith("http://www.example.org/indiv/")) {
                    const newBlankNode = N3.DataFactory.blankNode();
                    quads = quads.map(quad => remapQuad(quad, newBlankNode, term));
                }
            }

            precMain.outputTheStore(new N3.Store(quads));

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
    fillParser: function(parser) {
        parser.add_argument('PRECRDFGraph', { help: "Path to the RDF Graph generated by PREC" });
        parser.add_argument('Context'     , { help: "Path to the context" });
    },
    handler: function (args) {
        const store = new N3.Store(loadRDFGraph(args.PRECRDFGraph));
        const context = loadRDFGraph(args.Context);
        graphReducer(store, context);
        precMain.outputTheStore(store);
    }
};



////////////////////////////////////////////////////////////////////////////////
//// Tool hub

/** The list of every supported tools */
const TOOLS = [
    TOOL_PrecGeneratedIsomorphism,
    TOOL_Contextualize
];

function main() {
    const parser = new argparse.ArgumentParser({
        description: "PREC - Miscellaneous tools"
    });

    let subparser = parser.add_subparsers();
    let handlers = {};

    function addTool(tool) {
        let parser = subparser.add_parser(tool.command, { help: tool.help });
        parser.add_argument("CHOICE", {default: tool.command, nargs:"?", help: argparse.SUPPRESS});
        tool.fillParser(parser);
        handlers[tool.command] = tool.handler;
    }

    TOOLS.forEach(addTool);

    let args = parser.parse_args();

    if (args.CHOICE == "" || args.CHOICE === undefined) {
        parser.print_help();
    } else {
        handlers[args.CHOICE](args);
    }
}

if (require.main === module) {
    main();
}
