import { NamedNode } from '@rdfjs/types';
import fs from 'fs';
import { Store, Parser, Prefixes, Writer } from 'n3';

export function filenameToArrayOfQuads(filename: string) {
  const trig = fs.readFileSync(filename, 'utf-8');
  return trigToArrayOfQuads(trig);
}

export function trigToArrayOfQuads(trig: string) {
  const parser = new Parser();
  return parser.parse(trig);
}

export function outputTheStore(store: Store, prefixes?: Prefixes<NamedNode | string>) {
  const writer = new Writer({ prefixes: prefixes });
  store.forEach(
    quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph),
    null, null, null, null
  );
  writer.end((_error, result) => console.log(result));
  console.error(store.size + " triples");
}


