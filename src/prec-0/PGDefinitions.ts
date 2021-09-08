
export type APOCDocument = APOCNode | APOCEdge;

export type APOCNode = {
  type: 'node';
  id: number;
  labels?: string[];
  properties?: {[key: string]: string | number | (string | number)[]};
};

export type APOCEdge = {
  type: 'relationship';
  id: number;
  start: APOCNode;
  end: APOCNode;
  label: string;
  properties?: {[key: string]: string | number | (string | number)[]};
};

export type CypherEntry = {
  src: CypherNode;
  edge: CypherEdge;
  dest: CypherNode;
}

export type CypherNode = {
  identity: number;
  labels: string[];
  properties: {[key: string]: string | number | (string | number)[]} | undefined;
};

export type CypherEdge = {
  identity: number;
  start: number;
  end: number;
  type: string;
  properties: {[key: string]: string | number | (string | number)[]} | undefined;
}

export type IdentityTo<T> = {[identity: number]: T};


export type TinkerPopNode = {
  identity: number;
  labels: string[];
  properties: TinkerPopProperties;
}

export type TinkerPopEdge = {
  identity: number;
  start: number;
  end: number;
  type: string;
  properties: TinkerPopProperties;
}

export type TinkerPopProperties = {
  key: string;
  value: string | number | (string | number)[];
  meta?: {[key: string]: string | number | (string | number)[]};
}[];
