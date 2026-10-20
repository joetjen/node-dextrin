import { expect } from 'chai';
import { print, isBareIdentifier } from '../../src/text/printer.cjs';
import { parse } from '../../src/text/parser.cjs';
import DXNKeyword from '../../src/values/keyword.js';
import DXNCustomTag from '../../src/values/custom-tag.js';

describe('text/printer', () => {
  it('prints scalars', () => {
    expect(print(null)).to.equal('nil');
    expect(print(true)).to.equal('true');
    expect(print(false)).to.equal('false');
    expect(print(42n)).to.equal('42');
    expect(print(-42n)).to.equal('-42');
  });

  it('always prints a float with a decimal point or exponent, never bare digits', () => {
    expect(print(1)).to.equal('1.0'); // native number 1 is a float here, must stay distinct from integer 1n
    expect(print(1.5)).to.equal('1.5');
    expect(print(5e30)).to.match(/[.e]/);
  });

  it('prints the three non-finite floats as their reserved words', () => {
    expect(print(NaN)).to.equal('NaN');
    expect(print(Infinity)).to.equal('Infinity');
    expect(print(-Infinity)).to.equal('-Infinity');
  });

  it('prints a string with escaping', () => {
    expect(print('a"b\nc')).to.equal('"a\\"b\\nc"');
  });

  it('prints a keyword with the colon shorthand when the name is a bare identifier', () => {
    expect(print(Symbol.for('ok'))).to.equal(':ok');
    expect(print(new DXNKeyword('ok'))).to.equal(':ok');
  });

  it('falls back to the quoted arrow-compatible form when the name is not a bare identifier', () => {
    expect(print(new DXNKeyword('has space'))).to.equal(':"has space"');
    expect(print(new DXNKeyword(''))).to.equal(':""');
  });

  it('prints a custom tag as "@name value"', () => {
    expect(print(new DXNCustomTag('my-tag', 42n))).to.equal('@my-tag 42');
  });

  // Jan, 2026-10-20: `@array[` is the preferred spelling; `@array [`
  // still reads.
  it('prints an array with its bracket against the tag', () => {
    expect(print([1n, 2n])).to.equal('@array[1 2]');
    expect(print(parse('@array [1 2]'))).to.equal('@array[1 2]');
  });

  it('throws TypeError for a value with no DXN representation', () => {
    expect(() => print(() => {})).to.throw(TypeError);
    expect(() => print({ plain: 'object' })).to.throw(TypeError);
  });

  describe('isBareIdentifier', () => {
    it('accepts ordinary identifiers, including hyphenated and namespaced ones', () => {
      expect(isBareIdentifier('foo')).to.equal(true);
      expect(isBareIdentifier('sorted-set')).to.equal(true);
      expect(isBareIdentifier('Ns/Name')).to.equal(true);
    });

    it('rejects reserved words, empty strings, and non-identifier text', () => {
      expect(isBareIdentifier('nil')).to.equal(false);
      expect(isBareIdentifier('true')).to.equal(false);
      expect(isBareIdentifier('')).to.equal(false);
      expect(isBareIdentifier('has space')).to.equal(false);
      expect(isBareIdentifier('1starts-with-digit')).to.equal(false);
    });
  });

  describe('print(parse(x)) round-trips to a stable form', () => {
    const cases = [
      'nil',
      '42',
      '-42',
      '3.14',
      'NaN',
      '-Infinity',
      '19.99M',
      '-3.50M',
      '22/7',
      '"hello world"',
      '?a',
      '?s',
      'foo',
      ':ok',
      '[1 2 3]',
      '{1 2 3}',
      '@{1 2 3}',
      '%{x:1,y:2}',
      '%Point{x:1,y:2}',
      '%Point[1,2]',
      '@ordered %{a:1,b:2}',
      '@sorted-set @{3 1 2}',
      '@array[1 2 3]',
      '@uuid "550e8400-e29b-41d4-a716-446655440000"',
      '@uri "https://example.com"',
      '~D[2024-03-15]',
      '~T[12:30:00]',
      '~U[1990-01-01 00:00:00Z]',
      '@datetime "2024-03-15T12:00:00+05:00"',
      '@duration "P1Y2M3DT4H5M6.5S"',
      '~r/^[a-z]+$/i',
      '@my-tag 42',
      '{:ok,200}',
      '@bytes "aGVsbG8="'
    ];

    for (const src of cases) {
      it(`is idempotent for ${JSON.stringify(src)}`, () => {
        const once = print(parse(src));
        const twice = print(parse(once));
        expect(twice).to.equal(once);
      });
    }
  });
});
