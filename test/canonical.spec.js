import { expect } from 'chai';
import { canonical, decode, DXNError } from '../src/dextrin.js';
import DXNKeyword from '../src/values/keyword.js';

// The canonical form of DXN.md §1.5: one rendering fixed down to the
// byte, which is what the Dextrin Conformance Suite compares across
// implementations. Most cases decode text and print what it came to,
// which is exactly what this implementation answers the suite with.
const canonicalOf = (text) => canonical(decode(text));

describe('canonical', () => {
  it('writes scalars as themselves', () => {
    expect(canonicalOf('nil')).to.equal('nil');
    expect(canonicalOf('true')).to.equal('true');
    expect(canonicalOf('-7')).to.equal('-7');
    expect(canonicalOf('123456789012345678901234567890')).to.equal('123456789012345678901234567890');
  });

  it('keeps a decimal as it was given: its scale and its sign', () => {
    expect(canonicalOf('1.50M')).to.equal('1.50M');
    expect(canonicalOf('-0.0M')).to.equal('-0.0M');
  });

  it('does not reduce a rational', () => {
    expect(canonicalOf('2/4')).to.equal('2/4');
  });

  it('writes a float with .0, written out down to a millionth and up to 21 digits', () => {
    expect(canonicalOf('1.0')).to.equal('1.0');
    expect(canonicalOf('100.0')).to.equal('100.0');
    expect(canonicalOf('0.1')).to.equal('0.1');
    expect(canonicalOf('0.000001')).to.equal('0.000001');
    expect(canonicalOf('123456789012345680000.0')).to.equal('123456789012345680000.0');
  });

  it('writes a float beyond that with an exponent and no plus', () => {
    expect(canonicalOf('0.00000015')).to.equal('1.5e-7');
    expect(canonicalOf('1e21')).to.equal('1.0e21');
    expect(canonicalOf('2.5E+300')).to.equal('2.5e300');
  });

  it('keeps the sign of negative zero', () => {
    expect(canonical(-0)).to.equal('-0.0');
  });

  it('writes NaN and the infinities as words', () => {
    expect(canonicalOf('NaN')).to.equal('NaN');
    expect(canonicalOf('-Infinity')).to.equal('-Infinity');
  });

  it('escapes what a string must, controls and DEL in lowercase hex', () => {
    expect(canonicalOf('"a\\"b\\\\c"')).to.equal('"a\\"b\\\\c"');
    expect(canonicalOf('"a\\tb\\x{1B}"')).to.equal('"a\\tb\\x{1b}"');
    expect(canonicalOf('"\\x{7f}"')).to.equal('"\\x{7f}"');
    expect(canonicalOf('"\\x{e9}"')).to.equal('"é"');
  });

  it('writes a char, and a space char as ?s', () => {
    expect(canonicalOf('?a')).to.equal('?a');
    expect(canonicalOf('?s')).to.equal('?s');
  });

  it('writes a keyword bare when its name is an identifier', () => {
    expect(canonical(Symbol.for('kw'))).to.equal(':kw');
    expect(canonical(new DXNKeyword('two words'))).to.equal(':"two words"');
  });

  it('puts one space between items', () => {
    expect(canonicalOf('[1, 2,  3]')).to.equal('[1 2 3]');
    expect(canonicalOf('{1 2}')).to.equal('{1 2}');
    expect(canonicalOf('@array[1 2]')).to.equal('@array[1 2]');
  });

  it('writes a map in canonical key order, with shorthand for names', () => {
    expect(canonicalOf('%{b: 2, a: 1, "z" => 3}')).to.equal('%{"z" => 3 a: 1 b: 2}');
    expect(canonicalOf('%{1 => :a, "1" => :b}')).to.equal('%{"1" => :b 1 => :a}');
  });

  it('keeps an ordered map in order and sorts a set', () => {
    expect(canonicalOf('@ordered %{b: 2, a: 1}')).to.equal('@ordered %{b: 2 a: 1}');
    expect(canonicalOf('@{3 1 2}')).to.equal('@{1 2 3}');
  });

  it('keeps a keyed struct in order', () => {
    expect(canonicalOf('%P{y: 1, x: 2}')).to.equal('%P{y: 1 x: 2}');
    expect(canonicalOf('%P[1 2]')).to.equal('%P[1 2]');
  });

  it('writes dates and times, dropping trailing zeros from a fraction', () => {
    expect(canonicalOf('@date "2026-10-17"')).to.equal('@date "2026-10-17"');
    expect(canonicalOf('@time "10:00:00.500000"')).to.equal('@time "10:00:00.5"');
    expect(canonicalOf('@time "10:00:00.000"')).to.equal('@time "10:00:00"');
    expect(canonicalOf('@datetime "2026-10-17T10:00:00Z"')).to.equal('@datetime "2026-10-17T10:00:00Z"');
    expect(canonicalOf('@datetime "2026-10-17T10:00:00.250000Z"')).to.equal('@datetime "2026-10-17T10:00:00.25Z"');
    expect(canonicalOf('@datetime "2026-10-17T10:00:00+02:00"')).to.equal('@datetime "2026-10-17T10:00:00+02:00"');
  });

  it('writes a uuid in lowercase and bytes as padded base64', () => {
    expect(canonicalOf('@uuid "6F9619FF-8B86-D011-B42D-00C04FC964FF"')).to.equal(
      '@uuid "6f9619ff-8b86-d011-b42d-00c04fc964ff"'
    );
    expect(canonicalOf('@bytes "AAE="')).to.equal('@bytes "AAE="');
  });

  it('refuses a value with no DXN meaning with an encode/unsupported error', () => {
    expect(() => canonical(() => 1))
      .to.throw(DXNError)
      .with.property('category', 'encode/unsupported');
  });
});
