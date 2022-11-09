
import { IdentityTo, CypherNode, CypherEdge } from './PGDefinitions';
import { Driver, QueryResult } from 'neo4j-driver'
import { isNode } from 'neo4j-driver-core';

export type ActualRecord = QueryResult['records'][number];

/**
 * Return all the node and edges in the PG that can be accessed through the
 * given driver.
 * @param driver The driver that has the connection to the Neo4j database
 * @returns All the nodes and edges
 */
export async function extractFromNeo4jProtocole(driver: Driver): Promise<{
  nodes: IdentityTo<CypherNode>,
  edges: IdentityTo<CypherEdge>
}> {
  return runNeo4jQuery(driver, 'match (src)-[edge]->(dest) return src, edge, dest;');
}


/**
 * Run the given Cypher Query and return the list of all returned nodes and
 * edges.
 * @param driver The driver that holds the connection to the Neo4j database
 * @param query The query to run
 * @returns The list of nodes and edges
 */
export async function runNeo4jQuery(driver: Driver, query: string): Promise<{
  nodes: IdentityTo<CypherNode>,
  edges: IdentityTo<CypherEdge>
}> {
  let result = {
    nodes: {} as IdentityTo<CypherNode>,
    edges: {} as IdentityTo<CypherEdge>
  };

  function addElement(record: ActualRecord & any) {
    const id = record.identity.toNumber();

    if (isNode(record)) {
      if (result.nodes[id]) return;

      const jsElement = recordToNode(record);
      result.nodes[jsElement.identity] = jsElement;
    } else {
      if (result.edges[id]) return;

      const jsElement = recordToEdge(record);
      result.edges[jsElement.identity] = jsElement;
    }
  }

  const session = driver.session();

  try {
    const result = await session.run(query);

    for (const singleRecord of result.records) {
      const length = singleRecord.length;
      for (let i = 0; i != length; ++i) {
        addElement(singleRecord.get(i));
      }
    }
  } finally {
    await session.close();
  }

  return result;
}


export function recordToNode(record: ActualRecord | any): CypherNode {
  return {
    identity: record.identity.toNumber(),
    labels: record.labels,
    properties: transformProperties(record.properties)
  };
}

export function recordToEdge(record: ActualRecord | any): CypherEdge {
  return {
    identity: record.identity.toNumber(),
    start: record.start.toNumber(),
    end: record.end.toNumber(),
    type: record.type,
    properties: transformProperties(record.properties)
  };
}

export function transformProperties(properties: {[key: string]: any}) {
  let result: (CypherNode['properties'] & CypherEdge['properties']) = {};

  for (let pName in properties) {
      result[pName] = transformProperty(properties[pName]);
  }

  return result;
}

export function transformProperty(value: any): number | string | (number | string)[] {
  if (typeof value === 'string') {
    return value;
  } else if (value.toNumber !== undefined) {
    return value.toNumber();
  } else if (Array.isArray(value)) {
    return value.map(v => transformProperty(v) as number | string);
  } else {
    throw Error(`Unknown value type for ${value}`);
  }
}
