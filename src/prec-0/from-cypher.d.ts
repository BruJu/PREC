import { IdentityTo, CypherNode, CypherEdge } from './PGDefinitions';
import { Driver } from 'neo4j-driver'

declare function extractFromNeo4jProtocole(
  driver: Driver
): Promise<{
  nodes: IdentityTo<CypherNode>,
  edges: IdentityTo<CypherEdge>
}>;
