/* Frequently used functions and terms */

import { DataFactory } from "n3";
import namespace from '@rdfjs/namespace';

export const prec = namespace("http://bruy.at/prec#"      , { factory: DataFactory });
export const pvar = namespace("http://bruy.at/prec-trans#", { factory: DataFactory });
export const pgo  = namespace("http://ii.uwb.edu.pl/pgo#" , { factory: DataFactory });

export const pvarSelf        = pvar.self;
export const pvarNode        = pvar.node;
export const pvarEdge        = pvar.edge;
export const pvarSource      = pvar.source;
export const pvarDestination = pvar.destination;
export const precValueOf     = prec._valueOf;

export const $quad         = DataFactory.quad;
export const $literal      = DataFactory.literal;
export const $variable     = DataFactory.variable;
export const $defaultGraph = DataFactory.defaultGraph();
