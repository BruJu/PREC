# PG->RDF Experimental Converter

PREC is a WIP set of tools to convert any Property Graph into RDF.

Its main differences with other converters are:
- It intends to convert the PG into RDF graphs that looks like usual RDF graphs,
by limiting the amount of boilterplate due to the data being from a Property
Graph
- It enables the user to map some of the labels and prorpety names used in the
PG to an existing vocabulary, by providing a *context* written in Turtle format.

PREC uses the PREC ontology that is described at https://bruy.at/prec. The PREC
ontology is mostly used to describe how to convert an RDF graph generated by
PREC with its default modelization into a more user friendly graph.

## Quick start from the repository

The repository contains a data folder with some exportation of Neo4j data by
using the APOC plugin. PREC can be quickly experimented by using these provided
example files.

- `git clone https://github.com/BruJu/PREC`
- `npm install --save-dev`

- Example 1: A Property Graph with a node about the POTUS
    - `npx ts-node prec.ts apoc2rdf data\ex1_potus.json -c data\ex1_potus.ttl`
    - `data\ex1_potus.json` contains the exportation of a Neo4J Property Graph
    about the POTUS and the USA.
    - `data\ex1_potus.ttl` is a context. *In this project, we call a*
    *Context a Turtle File that describes a mapping from the elements of Property*
    *Graph to an RDF ontology*. This context maps labels of the PG into IRIs
    mainly from DBpedia and Schema.org

- Example 2: The node Ann likes the node Dan
    - `npx ts-node prec.ts apoc2rdf data\ex2_annlikesdan1.json data\anndan.ttl`


## Using PREC as a library

It is possible to import PREC to get access to functions to produce RDF graphs
from a Gremin or a Neo4j connection. The produced output will be an
[RDF/JS DatasetCore](https://rdf.js.org/dataset-spec/#datasetcore-interface).

*Example*: In this example, we want to count the number of nodes and edges in
a local instance of a Neo4j property graph. Because simply looking at
Neo4j Desktop or using properly the Neo4j JS API would be too easy, we are going
to use PREC and count the nodes and edges in the PG thanks to the produced RDF
graph.

```js
// Property Graph API
import neo4j from 'neo4j-driver';
// Some useful RDF imports
import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace';
const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const pgo = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
// PREC
import { cypherToRDF } from 'prec';

// Open the connection
const auth = neo4j.auth.basic('neo4j', 'password');
const driver = neo4j.driver('neo4j://localhost:7687/neo4j', auth);    

// Build an RDF graph
cypherToRDF(driver)
.then(graph => {
  // We can now count
  console.log(graph.match(undefined, rdf.type, pgo.Node).size + " nodes in the PG");
  console.log(graph.match(undefined, rdf.type, pgo.Edge).size + " edges in the PG");
})
.finally(() => driver.close());
```

## Using PREC with CLI

Run `npx prec -h` to have a full list of the current tools.

**PG -> RDF**

- If you want to provide a context, use the `--context path/to/your/context`
option.

- From the Cypher or the Gremlin API
  - `npx prec cypher2rdf` translates Property Graphs from Neo4J to RDF. This
  tool connects itself to the Neo4J instance to extract the nodes
  and relationships (named edges in the rest of PREC).
  - `npx prec gremlin2rdf` translates "Tinkerpop enabled"
  property graphs to RDF. It works by connecting to the Gremlin API and making
  requests to extract the graph.

- From a JSON file:
  - `npx prec apoc2rdf` and `npx prec cypherJson2rdf` translates Property
  Graphs to RDF. The input is the result of some operations (documented below)
  that you have to do.

- From an RDF graph:
  - `npx prec applyContext` applies a context to an RDF graph previously
  generated by another command that did not have any context applied to.


**RDF -> PG**

- `npx prec reczero2rdf` allows to come back to Property Graphs from a RDF previously generated by PREC without applying any context.
    - Example of usage:
        - First we create an RDF graph with a PREC-0 description
        `npx prec apoc2rdf data/ex2_annlikesdan3.json > ignore/anndanRDF0.ttl`
        - Then we can print the Cypher query to create this graph
        `npx prec preczero2rdf print-cypher ignore/anndanRDF0.ttl`
    - Supported format are: a custom representation of the PG, printing the
    cypher query on the console, populating a Cypher compatible database and
    populating a Tinkerpop compatible database.

### Converting your own Property Graph to RDF

![](docs/general_process.svg)

The easiest way to transform a Property Graph is by providing a Cypher or a
Gremlin connection, and optionally a *Context* to get a nicer output.

In the graph, an arrow means the step ends here, a hook means the process
will continue.

For example, if you provide a Gremlin connection, you will get an "Idiomatic RDF
Graph" (if you didn't provide a context, the Idiomatic RDF Graph is equals to
the structural description of the PG in RDF).

### From Neo4j
`

#### By letting PREC connect to the Neo4j database

You can also extract directly the graph from your Neo4J database.

- `npx prec cypher-to-rdf username password (uri-to-your-neo4j-instance) (-c=contextfile.ttl)`

Default username should be neo4j and password is the one you entered when
creating the database. Default uri is the local instance with the default Neo4j
parameters.


#### With the result of a Cypher query

Run a Cypher query like this one:
- `match (src)-[edge]->(dest) return src,edge,dest LIMIT 5`
- The return instruction must return nodes and edges.
    - you can't write src.myProperty
- Get the result in JSON format (in Neo4J Browser : choose Export JSON after running the query)
- Use the `cypherJson2rdf` subcommand, for example if your output file is `data\movies_cypher_all.json`
    - `npx prec cypherJson2rdf data\movies_cypher_all.json`


#### From a Json Representation of the Property Graph using APOC


You can also use the APOC plugin to extract the content of your Property Graph.

To export a Neo4J property graph from your database, you need to activate APOC file export:
- Go in your database configuration (click the ... right to the database name -> Manage)
- Plugins -> Install APOC
- Settings -> add `set apoc.export.file.enabled=true` -> Apply

To export the graph structure, use this Cypher instruction: 
`CALL apoc.export.json.all("propertygraph.json",{useTypes:true})`

- `npx prec apoc2rdf /path/to/your/propertygraph.json` will output the
*Strucural description of the PG in RDF* from the
*Json Representation of the Property Graph*.


### From TinkerPop

`npx prec gremlin2rdf (URI to connect to) [-c Context]`

Default URI is the URI of a local TinkerPop Server.



### Misc.

- [The data folder](data) contains Neo4J (small) exported property graphs.


## License

[PREC is licensied under the MIT License by Julian Bruyat / INSA Lyon](LICENSE)

The repository includes code from other authors, also licensied under the MIT
License. See [test/dataset/DatasetCore.test.js](test/dataset/DatasetCore.test.js).
