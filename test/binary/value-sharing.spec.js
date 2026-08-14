import { expect } from 'chai';
import { decode } from '../../src/binary/decoder.cjs';
import { tag, arrayOf, textItem, integerItem } from '../../src/binary/writer.cjs';
import { T_SYMBOL } from '../../src/binary/tags.cjs';

/**
 * `node-dextrin`'s own encoder doesn't produce tags 28/29 (shareable/
 * shared-ref) or 256/25 (stringref) yet — see `binary/encoder.cjs`'s
 * own note on why that's a deliberate, documented scope cut. Decoding
 * them is spec-mandatory regardless ("a conforming decoder MUST
 * accept it"), so these tests hand-build the wire bytes directly
 * rather than round-tripping through this project's own encoder.
 */

const MAGIC_VERSION = Buffer.from([0x44, 0x58, 0x01]); // "DX" + version 1

/** @param {Buffer} item @returns {Buffer} */
function doc(item) {
  return Buffer.concat([MAGIC_VERSION, item]);
}

describe('.dxnb value sharing (DXN.md §2.5, tags 28/29)', () => {
  it('resolves a shared-ref to the shareable item it points at', () => {
    const item = arrayOf([tag(28, integerItem(42n)), tag(29, integerItem(0n))]);
    const result = decode(doc(item));
    expect(result.items).to.deep.equal([42n, 42n]);
  });

  it('resolves a shared-ref to an independent copy, not the same object reference', () => {
    const inner = arrayOf([integerItem(1n), integerItem(2n)]);
    const item = arrayOf([tag(28, inner), tag(29, integerItem(0n))]);
    const result = decode(doc(item));
    expect(result.items[0]).to.not.equal(result.items[1]); // distinct objects
    result.items[0].items.push(99n);
    expect(result.items[1].items).to.have.lengthOf(2); // the "copy" is unaffected
  });

  it('assigns indices in decode-completion (post-order) order for multiple shareable items', () => {
    const item = arrayOf([tag(28, integerItem(10n)), tag(28, integerItem(20n)), tag(29, integerItem(1n))]);
    const result = decode(doc(item));
    expect(result.items).to.deep.equal([10n, 20n, 20n]);
  });

  it('rejects a shared-ref pointing at a not-yet-seen index', () => {
    const item = tag(29, integerItem(0n));
    expect(() => decode(doc(item))).to.throw(/not-yet-seen/);
  });

  it('rejects a shared-ref with a non-integer payload', () => {
    const item = tag(29, textItem('nope'));
    expect(() => decode(doc(item))).to.throw();
  });
});

describe('.dxnb string-reference sharing (DXN.md §2.4, tags 256/25)', () => {
  it('resolves a stringref to the text registered earlier in the same namespace', () => {
    const inner = arrayOf([textItem('hello'), tag(25, integerItem(0n))]);
    const item = tag(256, inner);
    const result = decode(doc(item));
    expect(result.items).to.deep.equal(['hello', 'hello']);
  });

  it('registers text regardless of what wraps it (e.g. a symbol payload)', () => {
    const inner = arrayOf([tag(T_SYMBOL, textItem('Foo')), tag(25, integerItem(0n))]);
    const item = tag(256, inner);
    const result = decode(doc(item));
    expect(result.items[0].name).to.equal('Foo');
    expect(result.items[1]).to.equal('Foo');
  });

  it('an inner namespace does not leak its table into the outer one', () => {
    // A stringref only resolves within an active tag-256 namespace, so
    // this nests two: outer registers "a" at index 0; a bare-text
    // inner namespace registers "b" at its own, independent index 0
    // and is popped once decoded; the outer stringref(0) that follows
    // must then resolve against the outer table ("a"), unaffected by
    // whatever index 0 meant inside the (now-closed) inner one.
    const innerNs = tag(256, textItem('b'));
    const outerNs = tag(256, arrayOf([textItem('a'), innerNs, tag(25, integerItem(0n))]));
    const result = decode(doc(outerNs));
    expect(result.items).to.deep.equal(['a', 'b', 'a']);
  });

  it('rejects a stringref with no active namespace', () => {
    const item = tag(25, integerItem(0n));
    expect(() => decode(doc(item))).to.throw(/no active stringref namespace/);
  });
});
