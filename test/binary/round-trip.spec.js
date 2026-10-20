import { expect } from 'chai';
import { parse } from '../../src/text/parser.cjs';
import { print } from '../../src/text/printer.cjs';
import { encode } from '../../src/binary/encoder.cjs';
import { decode } from '../../src/binary/decoder.cjs';
import { dxnEquals } from '../../src/values/equality.js';
import DXNStruct from '../../src/values/struct.js';

/**
 * One `.dxn` source per DXN.md §1.3 type, decoded through the text
 * parser and round-tripped through the binary codec — every one is
 * expected to come back `dxnEquals`-equal to the value the text
 * parser produced, mirroring `dextrin`'s own
 * `test/round_trip_by_type_test.exs`.
 */
const CASES = {
  nil: 'nil',
  boolean: 'true',
  'integer (small)': '42',
  'integer (negative)': '-42',
  'integer (64-bit boundary)': '18446744073709551615',
  'integer (bignum, positive overflow)': '18446744073709551616',
  'integer (bignum, negative overflow)': '-18446744073709551617',
  float: '3.14',
  'float NaN': 'NaN',
  'float Infinity': 'Infinity',
  'float -Infinity': '-Infinity',
  decimal: '19.99M',
  'decimal (negative, trailing zero preserved)': '-3.50M',
  rational: '22/7',
  string: '"hello world"',
  char: '?a',
  'char (space)': '?s',
  symbol: 'foo',
  keyword: ':ok',
  list: '[1 2 3]',
  tuple: '{1 2 3}',
  map: '%{x: 1, y: 2}',
  'ordered-map': '@ordered %{a: 1, b: 2}',
  set: '@{1 2 3}',
  'sorted-set': '@sorted-set @{3 1 2}',
  'struct (positional)': '%Point[1, 2]',
  array: '@array[1 2 3]',
  date: '@date "2024-03-15"',
  'date before the year 100': '@date "0050-03-01"',
  time: '@time "12:30:00"',
  'time (fractional)': '@time "12:30:00.5"',
  'time to the nanosecond': '@time "12:00:00.123456789"',
  'local datetime': '@local-datetime "1990-01-01T12:00:00.5"',
  'datetime to the nanosecond': '@datetime "1990-01-01T12:00:00.000000001+02:00"',
  instant: '@datetime "1990-01-01T00:00:00Z"',
  datetime: '@datetime "2024-03-15T12:00:00+05:00"',
  duration: '@duration "P1Y2M3DT4H5M6.5S"',
  uuid: '@uuid "550e8400-e29b-41d4-a716-446655440000"',
  uri: '@uri "https://example.com"',
  bytes: '@bytes "aGVsbG8="',
  regex: '@regex(i) "^[a-z0-9_]{3,20}$"',
  'regex all flags': '@regex(imsuxfr) "^a.b$"',
  'regex inline flags': '@regex "(?i)^a.b$"',
  'custom tag': '@my-app/money 100'
};

describe('.dxnb binary round-trip, by type', () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(`round-trips ${name} (${JSON.stringify(src)})`, () => {
      const value = parse(src, { trusted: false });
      const decoded = decode(encode(value), { trusted: false });
      expect(dxnEquals(decoded, value), `binary round-trip mismatch: ${print(decoded)} !== ${print(value)}`).to.equal(true);
    });
  }

  it('a keyed struct loses its field names (positional-only wire form) — matches Elixir exactly', () => {
    const keyed = DXNStruct.keyed('Point', [
      ['x', 1n],
      ['y', 2n]
    ]);
    const decoded = decode(encode(keyed));
    expect(decoded.fields).to.deep.equal({ type: 'positional', values: [1n, 2n] });
  });

  it('round-trips trusted keyword decode (global Symbol.for) through binary too', () => {
    const value = parse(':ok', { trusted: true });
    const decoded = decode(encode(value), { trusted: true });
    expect(decoded).to.equal(Symbol.for('ok'));
  });
});
