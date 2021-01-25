# Property graph examples

They are all exported from Neo4J using the APOC plugin


- `annlikesdan.json`: A PG with 3 times the same edge
- `julian.json`: A PG with a very loose semantic on `name`.


## Movies

Based on the "Movies" example of Neo4J.

- [movies.json](movies.json) - The structure of the Property Graph exported by APOC json
- [movies_vocab.ttl](movies_vocab.ttl) - A small context which maps the relationships labelled "acted_in" to the
proper IRI in schema.org
- [movies_neo4j.ttl](movies_neo4j.ttl) - Contains the exportation of the Property Graph using NeoSemantics
