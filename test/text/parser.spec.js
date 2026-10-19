import { expect } from 'chai';
import { parse, ParseError, LexError } from '../../src/text/parser.cjs';
import DXNChar from '../../src/values/char.js';
import DXNSymbol from '../../src/values/symbol.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';
import DXNOrderedMap from '../../src/values/ordered-map.js';
import DXNSortedSet from '../../src/values/sorted-set.js';
import DXNStruct from '../../src/values/struct.js';
import DXNDecimal from '../../src/values/decimal.js';
import DXNRational from '../../src/values/rational.js';
import DXNUUID from '../../src/values/uuid.js';
import DXNURI from '../../src/values/uri.js';
import DXNBytes from '../../src/values/bytes.js';
import DXNRegex from '../../src/values/regex.js';
import DXNCustomTag from '../../src/values/custom-tag.js';
import DXNTimestamp from '../../src/values/timestamp.js';
import DXNDate from '../../src/values/date.js';

describe('text/parser', () => {
  describe('scalars', () => {
    it('parses nil/true/false', () => {
      expect(parse('nil')).to.equal(null);
      expect(parse('true')).to.equal(true);
      expect(parse('false')).to.equal(false);
    });

    it('parses integers as BigInt, arbitrary precision', () => {
      expect(parse('42')).to.equal(42n);
      expect(parse('-42')).to.equal(-42n);
      expect(parse('123456789012345678901234567890')).to.equal(123456789012345678901234567890n);
    });

    it('parses floats as native numbers, including NaN/Infinity', () => {
      expect(parse('3.14')).to.equal(3.14);
      expect(parse('5e10')).to.equal(5e10);
      expect(Number.isNaN(parse('NaN'))).to.equal(true);
      expect(parse('Infinity')).to.equal(Infinity);
      expect(parse('-Infinity')).to.equal(-Infinity);
    });

    it('parses a decimal literal, stripping the M suffix', () => {
      const d = parse('19.99M');
      expect(d).to.be.instanceOf(DXNDecimal);
      expect(d.toString()).to.equal('19.99');
    });

    it('parses a rational literal, never reduced', () => {
      const r = parse('44/14');
      expect(r).to.be.instanceOf(DXNRational);
      expect(r.numerator).to.equal(44n);
      expect(r.denominator).to.equal(14n);
    });

    it('rejects a rational with a zero denominator', () => {
      expect(() => parse('1/0')).to.throw();
    });

    it('parses a string, decoding escapes', () => {
      expect(parse('"hi\\nthere"')).to.equal('hi\nthere');
    });

    it('parses a char literal', () => {
      expect(parse('?a').equals(new DXNChar(97))).to.equal(true);
      expect(parse('?s').equals(new DXNChar(0x20))).to.equal(true); // "s" means space
      expect(parse('?\\n').equals(new DXNChar(10))).to.equal(true);
    });

    it('parses a bare identifier as a symbol', () => {
      expect(parse('foo').equals(new DXNSymbol('foo'))).to.equal(true);
    });

    it('parses a keyword as a global Symbol.for by default (trusted)', () => {
      const kw = parse(':ok');
      expect(typeof kw).to.equal('symbol');
      expect(kw).to.equal(Symbol.for('ok'));
    });

    it('parses a keyword as DXNKeyword when trusted: false', () => {
      const kw = parse(':ok', { trusted: false });
      expect(kw.equals(new DXNKeyword('ok'))).to.equal(true);
    });

    it('parses a quoted keyword', () => {
      const kw = parse(':"has space"', { trusted: false });
      expect(kw.equals(new DXNKeyword('has space'))).to.equal(true);
    });
  });

  describe('collections', () => {
    it('parses a list literal as DXNList', () => {
      const v = parse('[1 2 3]');
      expect(v).to.be.instanceOf(DXNList);
      expect(v.items).to.deep.equal([1n, 2n, 3n]);
    });

    it('parses a tuple literal as DXNTuple', () => {
      const v = parse('{1 2 3}');
      expect(v).to.be.instanceOf(DXNTuple);
      expect(v.items).to.deep.equal([1n, 2n, 3n]);
    });

    it('parses a set literal as native Set', () => {
      const v = parse('@{1 2 3}');
      expect(v).to.be.instanceOf(Set);
      expect(Array.from(v)).to.deep.equal([1n, 2n, 3n]);
    });

    it('parses a map literal as a Map keyed by value, both shorthand and arrow forms', () => {
      const v = parse('%{x: 1, :y => 2}', { trusted: false });
      expect(v).to.be.instanceOf(Map);
      expect(v.get(new DXNKeyword('x'))).to.equal(1n); // a DXNMap: an equal key finds the entry (DXN.md §1.6)
      expect(Array.from(v.entries())).to.deep.equal([
        [new DXNKeyword('x'), 1n],
        [new DXNKeyword('y'), 2n]
      ]);
    });

    it('parses a keyed struct literal as DXNStruct with plain string field names', () => {
      const v = parse('%Point{x: 1, y: 2}');
      expect(v).to.be.instanceOf(DXNStruct);
      expect(v.name).to.equal('Point');
      expect(v.fields).to.deep.equal({
        type: 'keyed',
        pairs: [
          ['x', 1n],
          ['y', 2n]
        ]
      });
    });

    it('parses a positional struct literal', () => {
      const v = parse('%Point[1, 2]');
      expect(v.fields).to.deep.equal({ type: 'positional', values: [1n, 2n] });
    });
  });

  describe('built-in tags', () => {
    it('@ordered requires and preserves map entry order', () => {
      const v = parse('@ordered %{a: 1, b: 2}');
      expect(v).to.be.instanceOf(DXNOrderedMap);
      expect(v.pairs.map(([k]) => k.description ?? k.name)).to.deep.equal(['a', 'b']);
    });

    it('@ordered rejects a non-map argument', () => {
      expect(() => parse('@ordered [1 2]')).to.throw();
    });

    it('@sorted-set sorts and dedupes a set literal', () => {
      const v = parse('@sorted-set @{3 1 2 1}');
      expect(v).to.be.instanceOf(DXNSortedSet);
      expect(v.items).to.deep.equal([1n, 2n, 3n]);
    });

    it('@sorted-set rejects a non-set argument', () => {
      expect(() => parse('@sorted-set [1 2]')).to.throw();
    });

    it('@array converts a list literal to a native Array', () => {
      const v = parse('@array[1 2 3]');
      expect(Array.isArray(v)).to.equal(true);
      expect(v).to.deep.equal([1n, 2n, 3n]);
    });

    it('@array rejects a non-list argument', () => {
      expect(() => parse('@array {1 2}')).to.throw();
    });

    it('@uuid parses the canonical string form', () => {
      const v = parse('@uuid "550e8400-e29b-41d4-a716-446655440000"');
      expect(v).to.be.instanceOf(DXNUUID);
      expect(v.toString()).to.equal('550e8400-e29b-41d4-a716-446655440000');
    });

    it('@uri wraps the raw string', () => {
      expect(parse('@uri "https://example.com"').equals(new DXNURI('https://example.com'))).to.equal(true);
    });

    it('@bytes decodes base64', () => {
      const v = parse('@bytes "aGVsbG8="');
      expect(v).to.be.instanceOf(DXNBytes);
      expect(Buffer.from(v.data).toString()).to.equal('hello');
    });

    it('@datetime parses an offset datetime', () => {
      const v = parse('@datetime "2024-03-15T12:00:00+05:00"');
      expect(v.offsetMinutes).to.equal(300);
    });

    it('@duration parses an ISO 8601 duration', () => {
      const v = parse('@duration "P1DT2H"');
      expect(v.days).to.equal(1);
      expect(v.hours).to.equal(2);
    });
  });

  describe('sigils', () => {
    it('~D parses a date', () => {
      expect(parse('~D[2024-03-15]').equals(new DXNDate(2024, 3, 15))).to.equal(true);
    });

    it('~T parses a time', () => {
      const v = parse('~T[12:30:00]');
      expect(v).to.include({ hour: 12, minute: 30, second: 0, microsecond: 0 });
    });

    it('~U parses a UTC timestamp', () => {
      expect(parse('~U[1990-01-01 00:00:00Z]')).to.be.instanceOf(DXNTimestamp);
    });

    it('~r parses a regex with flags', () => {
      const v = parse('~r/^[a-z]+$/im');
      expect(v).to.be.instanceOf(DXNRegex);
      expect(v.pattern).to.equal('^[a-z]+$');
      expect(v.flags.i).to.equal(true);
      expect(v.flags.m).to.equal(true);
      expect(v.flags.s).to.equal(false);
    });
  });

  describe('custom tags', () => {
    it('an unrecognized tag decodes as DXNCustomTag (no registry yet)', () => {
      const v = parse('@my-app/money 100');
      expect(v).to.be.instanceOf(DXNCustomTag);
      expect(v.name).to.equal('my-app/money');
      expect(v.value).to.equal(100n);
    });
  });

  describe('discard (@_)', () => {
    it('parses and throws away a value, contributing nothing to the result', () => {
      expect(parse('@_ 5 42')).to.equal(42n);
      expect(parse('[1 @_ 2 3]').items).to.deep.equal([1n, 3n]);
    });

    it('"@_5" (no space) is an ordinary identifier, not a discard', () => {
      const v = parse('@_5 42');
      expect(v).to.be.instanceOf(DXNCustomTag);
      expect(v.name).to.equal('_5');
    });
  });

  describe('comments and header', () => {
    it('strips # comments entirely', () => {
      expect(parse('# a comment\n42 # trailing')).to.equal(42n);
    });

    it('consumes an optional @dxn header before the real value', () => {
      expect(parse('@dxn "1.0"\n%{x: 1}')).to.be.instanceOf(Map);
    });
  });

  describe('errors', () => {
    it('throws ParseError on trailing content after the document value', () => {
      expect(() => parse('1 2')).to.throw(ParseError);
    });

    it('throws LexError on invalid syntax', () => {
      expect(() => parse('`')).to.throw(LexError);
    });
  });
});
