import { Quad } from '@rdfjs/types';
import { Parser } from 'n3';
import DStar from '../src/dataset/index';

function readQuads(turtleContent: string): Quad[] {
  const prefixes =
  `
    @prefix     : <http://test/>                                .
    @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>       .
    @prefix prec: <http://bruy.at/prec#>                        .
    @prefix pgo:  <http://ii.uwb.edu.pl/pgo#>                   .
    @prefix pvar: <http://bruy.at/prec-trans#>                  .
  `;

  const parser = new Parser();

  try {
    const p = parser.parse(prefixes + turtleContent);
    return p;
  } catch (e) {
    console.error("Passed turtle file is not valid\n" + turtleContent);
    throw e;
  }
}

export { readQuads as turtleToQuads };

export function turtleToDStar(content: string) {
  return new DStar(readQuads(content));
}
