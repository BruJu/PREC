// RDF -> Property Graph Experimental Converter
// Or more like PREC-1

// We use Graphy instead of WasmTree because currently WT 
const graphy_dataset = require("@graphy/memory.dataset.fast")
const N3 = require("n3");
const WasmTree = require("@bruju/wasm-tree");

const precMain = require('./prec.js');
const { ArgumentParser } = require('argparse');
const fs = require('fs');

const namespace     = require('@rdfjs/namespace');
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory)
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);

/** Read the turtle (not star) file in filepath and builds a WT Dataset from it */
function readDataset(filepath) {
    const parser = new N3.Parser();
    let quads = parser.parse(fs.readFileSync(filepath, "utf8"));

    const dataset = new WasmTree.Dataset();
    dataset.addAll(quads);
    return dataset;
}

// TODO: forbid named graphs somewhere as PREC never generates them.

// TODO: an expansion of "this" instance of WT.Dataset? As many methods takes
// a dataset as the first parameter...

/** Return the list of terms that are of type type in the given dataset */
function getNodesOfType(dataset, type) {
    return [...dataset.match(null, rdf.type, type)]
        .map(quad => quad.subject);
}

/** Return true if searchedTerm is in the term list. */
function containsTerm(termList, searchedTerm) {
    return termList.some(listedTerm => listedTerm.equals(searchedTerm));
}

function followThrough(dataset, subject, predicate, otherAuthorizedQuads, strict) {
    if (otherAuthorizedQuads === undefined) {
        let match = dataset.match(subject, predicate);
        if (match.size !== 1) return null;

        for (let q of match) {
            return q.object;
        }
    } else {
        let match = dataset.match(subject);

        if (strict && match.size != 1 + otherAuthorizedQuads.length) return null;

        let result = null;

        for (let quad of match) {
            let noMatch = true;

            // Is the quad in the list?
            for (let i = 0 ; i != otherAuthorizedQuads.length; ++i) {
                if (quad.equals(otherAuthorizedQuads[i])) {
                    otherAuthorizedQuads.splice(i);
                    noMatch = false;
                    break;
                }
            }

            if (noMatch) {
                // Not in the list of authorized
                if (result) {
                    return null; // Result won't be unique
                } else if (quad.predicate.equals(predicate)) {
                    result = quad.object;   // Found the result
                } else {
                    return null;    // Wrong predicate
                }
            }
        }

        return result;
    }
}



function getPathsFrom(dataset, source, ignoreList) {
    return dataset.match(source)
        .filter(quad => !containsTerm(ignoreList, quad.predicate));
}


function extractPropertyName(dataset, property) {
    if (!dataset.has(N3.DataFactory.quad(property, rdf.type, prec.Property))) {
        throw "Invalid RDF Graph - Property Name is not a property " + property.value;
    }

    let realLabel = followThrough(dataset, property, rdfs.label,
        [
            N3.DataFactory.quad(property, rdf.type, prec.CreatedProperty),
            N3.DataFactory.quad(property, rdf.type, prec.Property)
        ],
        false
    );

    // TODO : this code is duplicated

    if (realLabel === null) {
        throw "Invalid RDF Graph - Bad Property Label for " + property.value;
    } else if (realLabel.termType !== "Literal") {
        throw "Invalid RDF Graph - Property Label is not literal";
    } else {
        // TODO: check if xsd:string
        return realLabel.value;
    }
}

function extractAndDeletePropertyValue(dataset, value) {
    let trueValue = followThrough(dataset, value, rdf.value,
        [
            N3.DataFactory.quad(value, rdf.type, prec.PropertyValue)
        ],
        true
    );

    if (trueValue === null) {
        throw "Invalid RDF Graph - Bad value for property value " + value.value;
    } else if (trueValue.termType !== "Literal") {
        // TODO : rdf:list
        throw "Invalid RDF Graph - Property is not a literal"
    }
    // TODO : xsd:integer
    
    dataset.delete(N3.DataFactory.quad(value, rdf.value, trueValue));
    return trueValue.value;
}

function getRealLabel(term, dataset, labelType) {
    let realLabel = followThrough(dataset, term, rdfs.label,
        [
            N3.DataFactory.quad(term, rdf.type, labelType)
        ],
        false
    );

    if (realLabel === null) {
        throw "Invalid RDF Graph - Bad Label";
    } else if (realLabel.termType !== "Literal") {
        throw "Invalid RDF Graph - Label is not literal";
    } else {
        // TODO: check if xsd:string
        return realLabel.value;
    }
}

function extractEdgeSPO(dataset, rdfEdge) {
    function extractConnectedNodeToEdge(dataset, rdfEdge, predicate) {
        let result = followThrough(dataset, rdfEdge, predicate);
        if (!result) throw "Edge has no " + predicate.value + " " + rdfEdge.value;
        if (!dataset.has(N3.DataFactory.quad(result, rdf.type, pgo.Node))) {
            throw "Edge connected to something that is not a node";
        }
        return result;
    }

    function extractLabel(dataset, rdfEdge, predicate) {
        let result = followThrough(dataset, rdfEdge, predicate);
        if (!result) throw "Edge has no " + predicate.value;
        return [result, getRealLabel(result, dataset, prec.CreatedRelationshipLabel)];
    }


    return [
        extractConnectedNodeToEdge(dataset, rdfEdge, rdf.subject),
        extractConnectedNodeToEdge(dataset, rdfEdge, rdf.object),
        extractLabel(dataset, rdfEdge, rdf.predicate)
    ];
}

class PseudoPGBuilder {
    constructor() {
        this.propertyGraphStructure = {
            nodes: [],
            edges: []
        };

        this.iriToNodes = {};
    }

    toPropertyGraph() {
        return this.propertyGraphStructure;
    }

    addNode(identifier) {
        if (this.iriToNodes[identifier] === undefined) {
            this.iriToNodes[identifier] = {};
            this.iriToNodes[identifier].id = identifier;

            this.propertyGraphStructure.nodes.push(this.iriToNodes[identifier]);
        }

        return this.iriToNodes[identifier];
    }

    addEdge(sourceIdentifier, destinationIdentifier) {
        let edge = {};
        this.propertyGraphStructure.edges.push(edge);
        edge.source = this.addNode(sourceIdentifier);
        edge.destination = this.addNode(destinationIdentifier);
        return edge;
    }

    static from(dataset) {
        //try {
            let builder = new PseudoPGBuilder();

            // TODO : pgo:Node, pgo:Edge etc are disjoint types

            // A property is:
            // - _e prop propBN - propBN rdf:value a_literal
            // - prop rdf:type prec:Property
            // - propBN rdf:type propBN
            // - propBN is only used here
            // => We currently don't support meta properties
            function extractProperties(dataset, rdfNode, type) {
                let ignoreList;
                if (type == "Node") {
                    ignoreList = [ rdf.type ];
                } else if (type == "Edge") {
                    ignoreList = [
                        rdf.subject, rdf.predicate, rdf.object, rdf.type
                    ];
                } else {
                    throw "extractProperties invalid type" + type;
                }

                const pathsFrom = getPathsFrom(dataset, rdfNode, ignoreList);

                let properties = {};

                for (const path of pathsFrom) {
                    const propertyName = extractPropertyName(dataset, path.predicate);
                    const propertyValue = extractAndDeletePropertyValue(dataset, path.object);

                    if (properties[propertyName] !== undefined) {
                        // Note : we could relax this so several times the same
                        // predicate name means it was a list.
                        // But this wouldn't catch the case of empty and one
                        // element lists.
                        throw "Invalid RDF graph: several times the same property " + propertyName;
                    }

                    properties[propertyName] = propertyValue;

                    dataset.delete(path);
                }

                return properties;
            }

            function extractLabels(dataset, node) {
                let otherTypes = dataset.match(node, rdf.type);

                let result = [...otherTypes].map(quad => quad.object);
                for (let r of result) {
                    dataset.delete(N3.DataFactory.quad(node, rdf.type, r));
                }

                return result.map(term => getRealLabel(term, dataset, prec.CreatedNodeLabel));
            }

            // Edges should be:
            // - this rdf:subject s, s is a pgo.Node
            // - this rdf:predicate y, y is a (relationship) label
            // - this rdf:object o, o is a pgo.Node
            // Edges may have some other things that are properties
            for (let rdfEdge of getNodesOfType(dataset, pgo.Edge)) {
                // rdf:subject/predicate/object
                let [source, destination, label] = extractEdgeSPO(dataset, rdfEdge);
                let pgEdge = builder.addEdge(source.value, destination.value)
                pgEdge.label = label[1].value;

                // Remove from the RDF graph to be able to check if we consumed
                // the whole graph.
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.subject  , source     ));
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.predicate, label[0]   ));
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.object   , destination));

                // Some other things that are properties
                pgEdge.properties = extractProperties(dataset, rdfEdge, "Edge");
            }

            // Nodes
            // - A node is something of type pgo.Node. It may have properties
            for (let rdfNode of getNodesOfType(dataset, pgo.Node)) {
                // The node itself
                let pgNode = builder.addNode(rdfNode.value);
                dataset.delete(N3.DataFactory.quad(rdfNode, rdf.type, pgo.Node));

                // Labels and properties
                pgNode.labels = extractLabels(dataset, rdfNode);
                pgNode.properties = extractProperties(dataset, rdfNode, "Node");
            }

            // Delete from the RDF graph the triples that are "prec related".
            // TODO: ^

            // End
            console.error(dataset.size + " remaining quads");
            // TODO: fail if dataset is not empty at this point

            //dataset.forEach(console.error);

            return builder.toPropertyGraph();
        //} catch (e) {
        //    console.error(e);
        //    return null;
        //}
    }
}


function main() {
    const parser = new ArgumentParser({
        description: 'PREC-1 (Property Graph <- RDF Experimental Converter)'
    });

    parser.add_argument(
        "RDFPath",
        { help: "Path to the RDF graph to convert back" }
    );

    const args = parser.parse_args();

    const dataset = readDataset(args.RDFPath);
    
    let pg = PseudoPGBuilder.from(dataset)

    console.log(JSON.stringify(pg, null, 2));
}

if (require.main === module) {
    main();
}


