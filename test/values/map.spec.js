import { expect } from 'chai';
import { inspect } from 'node:util';
import { decode } from '../../src/dextrin.js';

// **Shown as the map it is**: printing one lists its entries and nothing
// of how it tells keys apart, as the README shows it.
describe('a DXNMap, printed', () => {
  it('shows its entries and none of its bookkeeping', () => {
    const shown = inspect(decode('%{x: 1, y: 2}'));
    expect(shown).to.include('Symbol(x) => 1n');
    expect(shown).not.to.include('byIdentity');
  });
});
