import { expect } from 'chai';
import { decode, DXNError, Registry, Schema } from '../../src/dextrin.js';

// Schema.compileAll: several .dxns documents into one registry, in order,
// as the reference's Dextrin.Schema.compile_all/2 (dextrin 8fb723a).
describe('Schema.compileAll', () => {
  it('compiles every document into one registry, in order', () => {
    const registry = Schema.compileAll([
      decode('%{Address: %schema{city: :string}}'),
      decode('%{Person: %schema{home: Address}}'),
    ]);
    expect(registry.fetchStructSchema('Address')).to.not.equal(undefined);
    expect(registry.fetchStructSchema('Person')).to.not.equal(undefined);
  });

  it('over a base registry', () => {
    const base = Schema.compile(decode('%{A: %schema{a: :integer}}'), new Registry());
    const registry = Schema.compileAll([decode('%{B: %schema{b: :integer}}')], base);
    expect(registry.fetchStructSchema('A')).to.not.equal(undefined);
  });

  it('and refuses the first one that does not compile, saying which', () => {
    try {
      Schema.compileAll([decode('%{A: %schema{a: :integer}}'), decode('[1]')]);
    } catch (err) {
      expect(err.category).to.equal('schema/compile');
      expect(err.message).to.include('document 2');
      return;
    }
    throw new Error('expected a refusal');
  });
});
void DXNError;
