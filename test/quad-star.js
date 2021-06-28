const assert = require('assert');

const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const ex = namespace("http://ex.org/", N3.DataFactory);
const $Quad = N3.DataFactory.quad;

const QuadStar = require('../prec3/quad-star');


describe('QuadStar', function () {
	describe('matches', function () {
		it('should work for non RDF-star quads', function () {
			assert.ok(
				QuadStar.matches(
					$Quad(ex.a, ex.b, ex.c),
					$Quad(ex.a, ex.b, ex.c),
				)
			);

			assert.ok(
				QuadStar.matches(
					$Quad(ex.a, ex.b, ex.c),
					$Quad(ex.a, ex.b, null),
				)
			);
			
			assert.ok(
				!QuadStar.matches(
					$Quad(ex.a, ex.different, ex.object),
					$Quad(ex.a, ex.b        , ex.object),
				)
			);

			assert.ok(
				!QuadStar.matches(
					$Quad(ex.a, ex.different, ex.c),
					$Quad(ex.a, ex.b        , null),
				)
			);
		});

		it('should work with RDF-star', function () {

			assert.ok(
				QuadStar.matches(
					$Quad($Quad(ex.s, ex.p, ex.o), ex.b, ex.c),
					$Quad($Quad(ex.s, ex.p, ex.o), ex.b, ex.c),
				)
			);

			assert.ok(
				!QuadStar.matches(
					$Quad($Quad(ex.s, ex.p, ex.o), ex.b, ex.c),
					$Quad($Quad(ex.s, ex.p, ex.X), ex.b, ex.c),
				)
			);

			assert.ok(
				QuadStar.matches(
					$Quad($Quad(ex.s, ex.p, ex.o), ex.b, ex.c),
					$Quad($Quad(ex.s, ex.p, null), ex.b, ex.c),
				)
			);
			
			assert.ok(
				!QuadStar.matches(
					$Quad(       ex.spo          , ex.b, ex.c),
					$Quad($Quad(ex.s, ex.p, null), ex.b, ex.c),
				)
			);
		})
	});



})


