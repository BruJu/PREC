import { IdentityTo } from "../../src/prec-0/PGDefinitions";

/** Something that can have properties */
class PropertyHolder<Value> {
  #properties: Property<Value>[] = [];
  #uid: number;

  /**
   * Builds a property holder with the given unique id.
   * @param uniqueId A unique id
   */
  constructor(uniqueId: number) {
    this.#uid = uniqueId;
  }

  /**
   * Returns the unique id passed during construction
   * @returns The unique id
   */
  getId(): number {
    return this.#uid;
  }

  /**
   * Add a property to this object. 
   * @param propertyKey The property key
   * @param propertyValue The property value
   */
  addProperty(propertyKey: string, propertyValue: Value) {
    const prop = new Property<Value>(propertyKey, propertyValue);
    this.#properties.push(prop);
    return prop;
  }
  
  /**
   * Return all the properties
   * @returns All the properties
   */
  getProperties(): Property<Value>[] {
    return this.#properties;
  }

  /**
   * Return the values stored for the given property key
   * @param key The key
   * @returns The values of the given key
   */
  getProperty(key: string): Value[] {
    return this.#properties
      .filter(prop => prop.key === key)
      .map(prop => prop.value);
  }
}

/**
 * A property
 */
class Property<Value> extends PropertyHolder<Value> {
  key: string;
  value: Value;

  constructor(key: string, value: Value) {
    super(0);
    this.key = key;
    this.value = value;
  }
}


/** A node in the graph */
export class Node<Value> extends PropertyHolder<Value> {
  #labels: string[] = [];

  /**
   * Adds the given label to the node.
   * 
   * The labels of a node are a set
   * @param theLabel The label to add
   */
  addLabel(theLabel: string) {
    if (!this.#labels.includes(theLabel)) {
      this.#labels.push(theLabel);
    }
    return this;
  }

  /**
   * Returns the labels of this node
   * @returns The labels of this node
   */
  getLabels(): string[] {
    return this.#labels;
  }
}

/** An edge in the graph */
class Edge<Value> extends PropertyHolder<Value> {
  #source: Node<Value>;
  #destination: Node<Value>;
  #label: string;

  /**
   * Builds a new edge that goes from source to destination.
   * @param uid An unique id
   * @param source The source of the edge
   * @param destination The destination of the edge
   * @param label The label of the edge
   */
  constructor(uid: number, source: Node<Value>, destination: Node<Value>, label: string) {
    super(uid);
    this.#source = source;
    this.#destination = destination;
    this.#label = label;
  }

  /**
   * Returns the label of this edge
   * @returns The label of this edge
   */
  getLabel(): string {
    return this.#label;
  }

  /**
   * Returns the source node
   * @returns The source node
   */
  getSource(): Node<Value> {
    return this.#source;
  }

  /**
   * Returns the destination node
   * @returns The destination node
   */
  getDestination(): Node<Value> {
    return this.#destination;
  }
}

/** A Property Graph */
export class PropertyGraph<Value = any> {
  #nodes: Node<Value>[] = [];
  #edges: Edge<Value>[] = [];
  #nextUniqueId: number = 1;

  getNodes() {
    return this.#nodes;
  }

  getEdges() {
    return this.#edges;
  }

  getNbOfNodes() {
    return this.#nodes.length;
  }

  getNbOfEdges() {
    return this.#edges.length;
  }

  /**
   * Adds a new node to the graph
   * @param labels Labels of the node 
   * @returns The created node
   */
  addNode(...labels: string[]) {
    const node = new Node<Value>(this.#nextUniqueId++);
    this.#nodes.push(node);
    labels.forEach(label => node.addLabel(label));
    return node;
  }

  /**
   * Adds a new edge to the graph.
   * 
   * The two given nodes are supposed to be in the graph
   * @param source The source node 
   * @param label The label of the edge
   * @param destination The destination node
   * @returns The created edge
   */
  addEdge(source: Node<Value>, label: string, destination: Node<Value>): Edge<Value> {
    const edge = new Edge<Value>(this.#nextUniqueId++, source, destination, label);
    this.#edges.push(edge);
    return edge;
  }

  convertToProductFromTinkerProp() {
    type TKProps = TKProp[];
    type TKProp = { key: string, value: Value, meta?: TKProps }

    function convertProperties(propertyHolder: PropertyHolder<Value>): TKProps {
      const result = [];

      for (const property of propertyHolder.getProperties()) {
        let tpProperty: TKProp = {
          key: property.key,
          value: property.value
        };

        if (property.getProperties().length !== 0) {
          tpProperty.meta = convertProperties(property);
        }

        result.push(tpProperty)
      }
      
      return result;
    }

    const nodes: IdentityTo<{
      identity: number, properties: TKProps;
      labels: string[];
    }> = {};

    const edges: IdentityTo<{
      identity: number; properties: TKProps;
      start: number; end: number; type: string;
    }> = {};

    for (const node of this.#nodes) {
      const tpNode = {
        identity  : node.getId(),
        labels    : node.getLabels(),
        properties: convertProperties(node)
      };

      nodes[node.getId()] = tpNode;
    }

    for (const edge of this.#edges) {
      edges[edge.getId()] = {
        identity:   edge.getId(),
        start:      edge.getSource().getId(),
        end:        edge.getDestination().getId(),
        type:       edge.getLabel(),
        properties: convertProperties(edge)
      };
    }

    return { nodes, edges };
  }
}
