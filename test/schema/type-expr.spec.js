import { expect } from 'chai';
import { matches } from '../../src/schema/type-expr.cjs';
import DXNChar from '../../src/values/char.js';
import DXNSymbol from '../../src/values/symbol.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';
import DXNStruct from '../../src/values/struct.js';
import DXNRegex from '../../src/values/regex.js';
import DXNDecimal from '../../src/values/decimal.js';
import Validated from '../../src/schema/validated.cjs';

/** @param {string} name @returns {{form: 'primitive', name: string}} */
const prim = (name) => ({ form: 'primitive', name });

describe('schema/type-expr matches()', () => {
  it('any matches everything', () => {
    expect(matches({ form: 'any' }, null)).to.equal(true);
    expect(matches({ form: 'any' }, 42n)).to.equal(true);
    expect(matches({ form: 'any' }, new DXNChar(97))).to.equal(true);
  });

  describe('primitives', () => {
    const cases = /** @type {const} */ ([
      ['nil', null, true],
      ['nil', false, false],
      ['boolean', true, true],
      ['boolean', 1n, false],
      ['integer', 1n, true],
      ['integer', 1, false],
      ['float', 1.5, true],
      ['float', NaN, true],
      ['float', 1n, false],
      ['string', 'hi', true],
      ['string', 1n, false],
      ['array', [1, 2], true],
      ['array', new DXNList([]), false],
      ['list', new DXNList([]), true],
      ['list', [], false],
      ['map', new Map(), true],
      ['set', new Set(), true]
    ]);

    for (const [name, value, expected] of cases) {
      it(`${name} vs ${String(value)} -> ${expected}`, () => {
        expect(matches(prim(name), value)).to.equal(expected);
      });
    }

    it('keyword matches both a global Symbol.for and a DXNKeyword', () => {
      expect(matches(prim('keyword'), Symbol.for('ok'))).to.equal(true);
      expect(matches(prim('keyword'), new DXNKeyword('ok'))).to.equal(true);
      expect(matches(prim('keyword'), Symbol('ok'))).to.equal(true); // any symbol, per the primitive's own definition
      expect(matches(prim('keyword'), 'ok')).to.equal(false);
    });

    it('symbol matches only DXNSymbol, never a bare string', () => {
      expect(matches(prim('symbol'), new DXNSymbol('foo'))).to.equal(true);
      expect(matches(prim('symbol'), 'foo')).to.equal(false);
    });
  });

  describe('reference', () => {
    it('matches an opaque DXNStruct by its own name', () => {
      const struct = DXNStruct.positional('Point', [1n, 2n]);
      expect(matches({ form: 'reference', name: 'Point' }, struct)).to.equal(true);
      expect(matches({ form: 'reference', name: 'Other' }, struct)).to.equal(false);
    });

    it('matches a Validated value by its provenance name, unwrapping it', () => {
      const validated = new Validated('Point', { x: 1 });
      expect(matches({ form: 'reference', name: 'Point' }, validated)).to.equal(true);
      expect(matches({ form: 'reference', name: 'Other' }, validated)).to.equal(false);
    });

    it('with a registry, checks a plain instance constructor against the registered module', () => {
      class Point {}
      class Other {}
      const registry = /** @type {any} */ ({ fetchStructModule: (name) => (name === 'Point' ? Point : undefined) });
      expect(matches({ form: 'reference', name: 'Point' }, new Point(), registry)).to.equal(true);
      expect(matches({ form: 'reference', name: 'Point' }, new Other(), registry)).to.equal(false);
    });

    it('trusts an unregistered name or a value with no provenance at all', () => {
      expect(matches({ form: 'reference', name: 'Whatever' }, { x: 1 })).to.equal(true);
    });
  });

  describe('list-of / set-of / tuple-of / map-of', () => {
    it('list-of checks every DXNList element', () => {
      const type = { form: 'list-of', elem: prim('integer') };
      expect(matches(type, new DXNList([1n, 2n]))).to.equal(true);
      expect(matches(type, new DXNList([1n, 'x']))).to.equal(false);
      expect(matches(type, [1n, 2n])).to.equal(false); // a bare Array is not list-of's shape
    });

    it('set-of checks every Set element', () => {
      const type = { form: 'set-of', elem: prim('integer') };
      expect(matches(type, new Set([1n, 2n]))).to.equal(true);
      expect(matches(type, new Set([1n, 'x']))).to.equal(false);
    });

    it('tuple-of checks arity and each positional type', () => {
      const type = { form: 'tuple-of', elems: [prim('keyword'), prim('integer')] };
      expect(matches(type, new DXNTuple([Symbol.for('ok'), 200n]))).to.equal(true);
      expect(matches(type, new DXNTuple([Symbol.for('ok')]))).to.equal(false);
      expect(matches(type, new DXNTuple([Symbol.for('ok'), 'x']))).to.equal(false);
    });

    it('map-of checks every key and value', () => {
      const type = { form: 'map-of', key: prim('string'), value: prim('integer') };
      expect(matches(type, new Map([['a', 1n]]))).to.equal(true);
      expect(matches(type, new Map([['a', 'x']]))).to.equal(false);
    });
  });

  describe('enum', () => {
    it('matches a DXNKeyword literal against a global-Symbol value, and vice versa', () => {
      const type = { form: 'enum', literals: [new DXNKeyword('usd'), new DXNKeyword('eur')] };
      expect(matches(type, Symbol.for('usd'))).to.equal(true);
      expect(matches(type, new DXNKeyword('eur'))).to.equal(true);
      expect(matches(type, Symbol.for('gbp'))).to.equal(false);
    });

    it('matches non-keyword literals structurally', () => {
      const type = { form: 'enum', literals: [1n, 2n, 3n] };
      expect(matches(type, 2n)).to.equal(true);
      expect(matches(type, 4n)).to.equal(false);
    });
  });

  it('one-of matches if any variant matches', () => {
    const type = { form: 'one-of', variants: [prim('integer'), prim('string')] };
    expect(matches(type, 1n)).to.equal(true);
    expect(matches(type, 'x')).to.equal(true);
    expect(matches(type, 1.5)).to.equal(false);
  });

  it('all-of matches only if every variant matches', () => {
    const type = { form: 'all-of', variants: [prim('integer'), { form: 'refine', base: prim('integer'), constraints: { min: 0n } }] };
    expect(matches(type, 5n)).to.equal(true);
    expect(matches(type, -5n)).to.equal(false);
  });

  it('nilable accepts nil or the wrapped type', () => {
    const type = { form: 'nilable', elem: prim('integer') };
    expect(matches(type, null)).to.equal(true);
    expect(matches(type, 5n)).to.equal(true);
    expect(matches(type, 'x')).to.equal(false);
  });

  describe('refine constraints', () => {
    const refine = (base, constraints) => ({ form: 'refine', base, constraints });

    it('min/max/exclusive-min/exclusive-max', () => {
      expect(matches(refine(prim('integer'), { min: 0n, max: 10n }), 5n)).to.equal(true);
      expect(matches(refine(prim('integer'), { min: 0n, max: 10n }), 11n)).to.equal(false);
      expect(matches(refine(prim('float'), { 'exclusive-min': 0 }), 0)).to.equal(false);
      expect(matches(refine(prim('float'), { 'exclusive-min': 0 }), 0.1)).to.equal(true);
    });

    it('multiple-of', () => {
      expect(matches(refine(prim('integer'), { 'multiple-of': 5n }), 10n)).to.equal(true);
      expect(matches(refine(prim('integer'), { 'multiple-of': 5n }), 11n)).to.equal(false);
    });

    it('min-length/max-length count codepoints, not UTF-16 units', () => {
      const type = refine(prim('string'), { 'min-length': 1, 'max-length': 1 });
      expect(matches(type, '😀')).to.equal(true); // 1 codepoint, 2 UTF-16 units
    });

    it('pattern matches a string against a DXNRegex', () => {
      const type = refine(prim('string'), { pattern: new DXNRegex('^[a-z]+$') });
      expect(matches(type, 'abc')).to.equal(true);
      expect(matches(type, 'ABC')).to.equal(false);
    });

    it('min-count/max-count for list/tuple/sorted-set', () => {
      const type = refine(prim('list'), { 'min-count': 1 });
      expect(matches(type, new DXNList([1n]))).to.equal(true);
      expect(matches(type, new DXNList([]))).to.equal(false);
    });

    it('works with decimal/rational values via their own toNumber()', () => {
      const type = refine(prim('decimal'), { min: 10 });
      expect(matches(type, DXNDecimal.fromString('19.99'))).to.equal(true);
      expect(matches(type, DXNDecimal.fromString('5.00'))).to.equal(false);
    });
  });
});
