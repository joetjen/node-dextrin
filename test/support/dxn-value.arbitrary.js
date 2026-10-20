import fc from 'fast-check';
import DXNChar from '../../src/values/char.js';
import DXNSymbol from '../../src/values/symbol.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';
import DXNUUID from '../../src/values/uuid.js';
import DXNObjectId from '../../src/values/object-id.js';
import DXNIp from '../../src/values/ip.js';

/**
 * A bounded-depth `fast-check` arbitrary generating DXNValue-shaped
 * trees — the JS analog of `dextrin`'s own `test/support/generators.ex`.
 * Deliberately partial for now (scalars, list/tuple nesting, a few
 * wrapper types): grows to cover every `DXN*` class as later phases
 * (text codec, binary codec, schema system) add round-trip tests that
 * need it, the same way this file is meant to be reused rather than
 * redefined per spec.
 */

const dxnScalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.bigInt(),
  fc.oneof(fc.double(), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
  fc.string(),
  fc
    .integer({ min: 0, max: 0x10ffff })
    .filter((cp) => cp < 0xd800 || cp > 0xdfff) // exclude lone-surrogate range
    .map((cp) => new DXNChar(cp)),
  fc.string().map((s) => new DXNSymbol(s)),
  fc.string().map((s) => new DXNKeyword(s)),
  fc
    .uint8Array({ minLength: 16, maxLength: 16 })
    .map((bytes) => new DXNUUID(bytes)),
  fc
    .uint8Array({ minLength: 12, maxLength: 12 })
    .map((bytes) => new DXNObjectId(bytes)),
  // An address, or a prefix: its host bits cleared.
  fc
    .tuple(fc.oneof(fc.constant(4), fc.constant(16)), fc.uint8Array({ minLength: 16, maxLength: 16 }), fc.option(fc.nat(128)))
    .map(([size, raw, length]) => {
      const address = raw.slice(0, size);
      if (length === null) return new DXNIp(address);
      const prefix = length % (size * 8 + 1);
      address.forEach((b, i) => {
        address[i] = b & ~(0xff >> Math.min(8, Math.max(0, prefix - i * 8)));
      });
      return new DXNIp(address, prefix);
    })
);

/**
 * @param {number} maxDepth
 * @returns {fc.Arbitrary<unknown>}
 */
function dxnValue(maxDepth = 2) {
  if (maxDepth <= 0) return dxnScalar;
  const smaller = fc.array(dxnValue(maxDepth - 1), { maxLength: 4 });
  return fc.oneof(
    { weight: 3, arbitrary: dxnScalar },
    { weight: 1, arbitrary: smaller.map((items) => new DXNList(items)) },
    { weight: 1, arbitrary: smaller.map((items) => new DXNTuple(items)) }
  );
}

export { dxnScalar, dxnValue };
