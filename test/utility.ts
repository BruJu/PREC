import { Quad } from '@rdfjs/types';
import { Parser } from 'n3';
import DStar from '../src/dataset/index';
import { badToString, approximateIsomorphism } from '../src/rdf/utils';

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

export function toStringWithDiffColor(quads1: Quad[], quads2: Quad[], indent: number = 8) {
  function toStringWithColor(quads: Quad[], match: (number | undefined)[], indent: number) {
    let asString = badToString(quads, indent).split(/\r?\n/);

    for (let i = 0 ; i != quads.length ; ++i) {
      if (match[i] === undefined) continue;

      if (match[i]! >= 0) asString[i] = "\x1b[36m" + asString[i] + "\x1b[0m";
    }
  
    return asString.join("\n");
  }

  let [s1, s2] = approximateIsomorphism(quads1, quads2)
  return [
    toStringWithColor(quads1, s1, indent),
    toStringWithColor(quads2, s2, indent)
  ];
}

export function generateMessage(
  input: DStar | string,
  context: Quad[] | string,
  output: DStar,
  expected: DStar
) {
  let msg = '\x1b[0m' + "• Base Graph:";
  msg += '\n' + (typeof input === 'string' ? input : badToString(input.getQuads(), 2));
  msg += '\n' + "• Context:";
  msg += '\n' + (typeof context === 'string' ? context : badToString(context, 2));

  const [r, e] = toStringWithDiffColor(output.getQuads(), expected.getQuads(), 2);

  msg += '\n' + `• Result (${output.size} quads):`;
  msg += '\n' + r;
  msg += '\n' + `• Expected (${expected.size} quads):`;
  msg += '\n' + e;
  return msg;
}

