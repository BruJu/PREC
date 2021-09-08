# Property graph examples

This folder contains Neo4J (small) exported property graphs.


They are all exported from Neo4J using the APOC plugin

- `ex1_potus.json`: A PG with two nodes.
- `ex2_annlikesdan1.json`: A PG with two nodes and one edge.
- `ex2_annlikesdan3.json`: A PG with 3 times the same edge.
    - The Ann and Dan example is the one used by Jesus Barrasa in one of his
    presentations.


## Movies

Based on the "Movies" example of Neo4J.

- [movies.json](movies.json) - The structure of the Property Graph exported by APOC json
- [movies_vocab.ttl](movies_vocab.ttl) - A small context which maps the relationships labelled "acted_in" to the
proper IRI in schema.org
- [movies_neo4j.ttl](movies_neo4j.ttl) - Contains the exportation of the Property Graph using NeoSemantics

Movies files content (movies_*.json files) is extracted from Neo4J:
https://neo4j.com/developer/example-data/ 

