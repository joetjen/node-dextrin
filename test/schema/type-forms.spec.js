import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// The type forms Jan added on 2026-10-20, as dextrin 47d6d1d: one-of
// means exactly one variant matches (JSON Schema's oneOf), any-of one or
// more (anyOf); not, never, and element types for arrays, ordered maps
// and sorted sets.
describe('schema type forms', () => {
  /** A registry where `T` has one field `v` of type `type`. @param {string} type */
  const registryFor = (type) => Schema.compile(decode(`%{T: %schema{v: ${type}}}`), new Registry());
  /** Whether `%T{v: value}` decodes. @param {Registry} registry @param {string} value */
  const takes = (registry, value) => {
    try {
      decode(`%T{v: ${value}}`, { registry });
      return true;
    } catch {
      return false;
    }
  };

  it('one-of refuses a value two variants match', () => {
    const r = registryFor('{:one-of :integer {:refine :integer %{min: 0}}}');
    expect(takes(r, '-1')).to.equal(true);
    expect(takes(r, '5')).to.equal(false);
  });

  it('any-of takes a value one or more variants match', () => {
    const r = registryFor('{:any-of :integer {:refine :integer %{min: 0}}}');
    expect(takes(r, '-1')).to.equal(true);
    expect(takes(r, '5')).to.equal(true);
    expect(takes(r, '"x"')).to.equal(false);
  });

  it('not takes what the type refuses', () => {
    const r = registryFor('{:not :string}');
    expect(takes(r, '1')).to.equal(true);
    expect(takes(r, '"x"')).to.equal(false);
  });

  it('never takes nothing at all', () => {
    const r = registryFor(':never');
    expect(takes(r, '1')).to.equal(false);
    expect(takes(r, 'nil')).to.equal(false);
  });

  it('nests them in each other and as element types', () => {
    const r = registryFor('{:list-of {:one-of :string {:any-of :integer :decimal}}}');
    expect(takes(r, '["a" 1]')).to.equal(true);
    expect(takes(r, '[true]')).to.equal(false);
  });

  it('array-of', () => {
    const r = registryFor('{:array-of :integer}');
    expect(takes(r, '@array[1 2]')).to.equal(true);
    expect(takes(r, '@array[1 "x"]')).to.equal(false);
    expect(takes(r, '[1 2]')).to.equal(false);
  });

  it('ordered-map-of', () => {
    const r = registryFor('{:ordered-map-of :keyword :integer}');
    expect(takes(r, '@ordered %{a: 1 b: 2}')).to.equal(true);
    expect(takes(r, '@ordered %{a: "x"}')).to.equal(false);
    expect(takes(r, '%{a: 1}')).to.equal(false);
  });

  it('sorted-set-of', () => {
    const r = registryFor('{:sorted-set-of :integer}');
    expect(takes(r, '@sorted-set @{2 1}')).to.equal(true);
    expect(takes(r, '@sorted-set @{1 "x"}')).to.equal(false);
    expect(takes(r, '@{1 2}')).to.equal(false);
  });
});
