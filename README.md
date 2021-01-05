# PG->RDF Experimental Converter

Some experiments about PG to RDF conversion.

## Quick start

- `npm install`
- `node attempt2-hardcode.js annlikesdan.json`

### Less quick start

- [The data folder](data) contains Neo4J (small) exported property graphs.
- Check [notes.md](notes.md) for details about some of the examples approach


## Neo4j

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

