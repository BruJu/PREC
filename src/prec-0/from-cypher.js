

/**
 * 
 * @param {import("neo4j-driver").Driver} driver 
 * @returns 
 */
async function extractFromNeo4jProtocole(driver) {
    let result = {
        nodes: {},
        edges: {}
    };

    function addNode(record) {
        result.nodes[record.identity.toNumber()] = {
            identity: record.identity.toNumber(),
            labels: record.labels,
            properties: transformProperties(record.properties)
        };
    }

    function addEdge(record) {
        result.edges[record.identity.toNumber()] = {
            identity: record.identity.toNumber(),
            start: record.start.toNumber(),
            end: record.end.toNumber(),
            type: record.type,
            properties: transformProperties(record.properties)
        };
    }

    const session = driver.session();

    try {
        const result = await session.run(
            'match (src)-[edge]->(dest) return src, edge, dest;'
        );

        for (let singleRecord of result.records) {
            addNode(singleRecord.get(0 /* "src"  */));
            addEdge(singleRecord.get(1 /* "edge" */));
            addNode(singleRecord.get(2 /* "dest" */));
        };
    } finally {
        await session.close();
    }

    return result;
}

function transformProperty(value) {
    if (typeof value === 'string' || value instanceof String) {
        return value;
    } else if (value.toNumber !== undefined) {
        return value.toNumber();
    } else if (Array.isArray(value)) {
        return value.map(v => transformProperty(v));
    } else {
        console.error("Unknown value type");
        console.error(value);
        return null;
    }
}

function transformProperties(properties) {
    let result = {};

    for (let pName in properties) {
        result[pName] = transformProperty(properties[pName]);
    }

    return result;
}

module.exports = { extractFromNeo4jProtocole };
