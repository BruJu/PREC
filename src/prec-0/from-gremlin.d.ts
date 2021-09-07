import { IdentityTo, TinkerPopEdge, TinkerPopNode } from './PGDefinitions';
import gremlin from 'gremlin';
import DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;

declare function extractFromGremlin(
  connection: DriverRemoteConnection
): Promise<{
  nodes: IdentityTo<TinkerPopNode>,
  edges: IdentityTo<TinkerPopEdge>
}>;

export = extractFromGremlin;
