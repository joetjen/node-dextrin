import { expect } from 'chai';
import * as Std from '../../src/schema/std.cjs';
import { matches } from '../../src/schema/type-expr.cjs';
import * as Compiler from '../../src/schema/compiler.cjs';
import { parse } from '../../src/text/parser.cjs';
import Registry from '../../src/registry.js';

describe('schema/std', () => {
  it('source() returns the .dxns text', () => {
    expect(Std.source()).to.be.a('string');
    expect(Std.source()).to.include('PositiveInteger');
  });

  it('registry() compiles every documented named type', () => {
    const registry = Std.registry();
    const names = ['PositiveInteger', 'NonNegativeInteger', 'NegativeInteger', 'NonPositiveInteger', 'PositiveFloat', 'NonNegativeFloat', 'Percentage', 'NonEmptyString', 'NonEmptyList', 'NonEmptySet'];
    for (const name of names) {
      expect(registry.fetchTypeAlias(name), `missing ${name}`).to.not.equal(undefined);
    }
  });

  it('PositiveInteger accepts > 0, rejects <= 0', () => {
    const type = Std.registry().fetchTypeAlias('PositiveInteger');
    expect(matches(type, 1n)).to.equal(true);
    expect(matches(type, 0n)).to.equal(false);
    expect(matches(type, -1n)).to.equal(false);
  });

  it('Percentage accepts [0, 100]', () => {
    const type = Std.registry().fetchTypeAlias('Percentage');
    expect(matches(type, 50)).to.equal(true);
    expect(matches(type, -1)).to.equal(false);
    expect(matches(type, 101)).to.equal(false);
  });

  it('merges alongside an existing baseRegistry rather than replacing it', () => {
    const base = Compiler.compile(parse('%{ MyType: :integer }'), new Registry());
    const merged = Std.registry(base);
    expect(merged.fetchTypeAlias('MyType')).to.not.equal(undefined);
    expect(merged.fetchTypeAlias('PositiveInteger')).to.not.equal(undefined);
  });
});
