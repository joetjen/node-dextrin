import { expect } from 'chai';
import DXNStruct from '../../src/values/struct.js';

describe('DXNStruct', () => {
  it('keyed() builds a name-carrying, keyed-fields struct', () => {
    const s = DXNStruct.keyed('Point', [
      ['x', 1],
      ['y', 2]
    ]);
    expect(s.name).to.equal('Point');
    expect(s.fields).to.deep.equal({
      type: 'keyed',
      pairs: [
        ['x', 1],
        ['y', 2]
      ]
    });
  });

  it('positional() builds a name-carrying, positional-fields struct', () => {
    const s = DXNStruct.positional('Point', [1, 2]);
    expect(s.fields).to.deep.equal({ type: 'positional', values: [1, 2] });
  });

  it('keeps keyed and positional shapes distinct, never normalized to one', () => {
    const keyed = DXNStruct.keyed('Point', [
      ['x', 1],
      ['y', 2]
    ]);
    const positional = DXNStruct.positional('Point', [1, 2]);
    expect(keyed.equals(positional)).to.equal(false);
  });

  it('equals structurally by name and fields', () => {
    const a = DXNStruct.positional('Point', [1, 2]);
    const b = DXNStruct.positional('Point', [1, 2]);
    const c = DXNStruct.positional('Point', [1, 3]);
    expect(a.equals(b)).to.equal(true);
    expect(a.equals(c)).to.equal(false);
  });
});
