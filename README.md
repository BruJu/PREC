# PG->RDF Experimental Converter

Some experiments about PG to RDF conversion.

## Quick start

- `npm install`

- ~~`node prec.js "data\annlikesdan.json" RRAstar RRRstar NoLabel NoPGO`~~
- ~~`node prec.js data/annlikesdan.json Vocab data/anndan.ttl RRAstar RRRstar`~~

### Less quick start

- [The data folder](data) contains Neo4J (small) exported property graphs.

## Converting your own Property Graph to RDF

![](doc/general_procesS.svg)

Currently, only Neo4j graphs is supported

## From Neo4j (converting a Neo4j Property Graph into a Json representation of the tile)

To export a Neo4J property graph from your database, you need to activate APOC file export:
- Go in your database configuration (click the ... right to the database name -> Manage)
- Plugins -> Install APOC
- Settings -> add `set apoc.export.file.enabled=true` -> Apply

To export the graph structure, use this cypher instruction
`CALL apoc.export.json.all("propertygraph.json",{useTypes:true})`

An easy (and hack-y) way to find where the file is is to use an invalid path like
`CALL apoc.export.json.all("/this/is/invalid",{useTypes:true})`
so the Java exception tells the complete path

**TODO:** `apoc.import.file.use_neo4j_config=false` to use absolute paths?

## Running the script itself

- `node prec.js /path/to/your/propertygraph.json` will output the *Expanded RDF Graph*
from the *Json Representation of the Property Graph*.

## Using a context

You can write a context in Turtle format and use it to output an *Usable RDF Graph*
from the *Json Representation of the Property Graph*.

- `node prec.js /path/to/your/propertygraph.json /path/to/your/context.ttl`


