import { expect } from 'chai';
import DXNRegex from '../../src/values/regex.js';

describe('DXNRegex', () => {
  it('defaults every flag to false', () => {
    const r = new DXNRegex('a+');
    expect(r.flags).to.deep.equal({ i: false, m: false, s: false, u: false, x: false, f: false, r: false });
  });

  it('toRegExp() maps i/m/s/u flags directly to native RegExp flags', () => {
    const r = new DXNRegex('a+', { i: true, m: true });
    const re = r.toRegExp();
    expect(re.source).to.equal('a+');
    expect(re.flags).to.equal('im');
  });

  it('toRegExp() throws when x/f/r are set (no native equivalent) instead of silently dropping them', () => {
    expect(() => new DXNRegex('a+', { x: true }).toRegExp()).to.throw(/x/);
    expect(() => new DXNRegex('a+', { f: true }).toRegExp()).to.throw(/f/);
    expect(() => new DXNRegex('a+', { r: true }).toRegExp()).to.throw(/r/);
  });

  it('fromRegExp() round-trips the supported flags', () => {
    const dr = DXNRegex.fromRegExp(/^[a-z]+$/im);
    expect(dr.pattern).to.equal('^[a-z]+$');
    expect(dr.flags.i).to.equal(true);
    expect(dr.flags.m).to.equal(true);
    expect(dr.flags.x).to.equal(false);
  });

  it('equals structurally by pattern and flags', () => {
    expect(new DXNRegex('a+', { i: true }).equals(new DXNRegex('a+', { i: true }))).to.equal(true);
    expect(new DXNRegex('a+', { i: true }).equals(new DXNRegex('a+', { i: false }))).to.equal(false);
  });

  // PCRE's own words for what JavaScript says otherwise (T674: the JSON
  // Schema converter writes `$` as `\z`, `\uXXXX` as `\x{XXXX}`).
  it('toRegExp() reads PCRE\'s \\A, \\z, \\Z and \\x{H} as PCRE means them', () => {
    expect(new DXNRegex('\\Aab\\z').toRegExp().test('ab')).to.equal(true);
    expect(new DXNRegex('^ab\\z').toRegExp().test('ab\n')).to.equal(false);
    expect(new DXNRegex('^ab\\Z').toRegExp().test('ab\n')).to.equal(true);
    expect(new DXNRegex('x\\Ay').toRegExp().test('xy')).to.equal(false);
    expect(new DXNRegex('^\\x{41}[\\x{42}]$').toRegExp().test('AB')).to.equal(true);
    expect(new DXNRegex('^\\x{1F600}$').toRegExp().test('\u{1F600}')).to.equal(true);
    expect(new DXNRegex('^\\p{L}+$').toRegExp().test('é')).to.equal(true);
    expect(new DXNRegex('[z\\z]').toRegExp().test('z')).to.equal(true);
  });
});
