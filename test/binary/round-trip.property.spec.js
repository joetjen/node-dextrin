import { inspect } from 'node:util';
import { expect } from 'chai';
import fc from 'fast-check';
import { encode } from '../../src/binary/encoder.cjs';
import { decode } from '../../src/binary/decoder.cjs';
import { dxnEquals } from '../../src/values/equality.js';
import DXNChar from '../../src/values/char.js';
import DXNSymbol from '../../src/values/symbol.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';
import DXNUUID from '../../src/values/uuid.js';
import DXNRational from '../../src/values/rational.js';

const dxnScalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.bigInt(),
  fc.oneof(fc.double(), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
  fc.string(),
  fc
    .integer({ min: 0, max: 0x10ffff })
    .filter((cp) => cp < 0xd800 || cp > 0xdfff)
    .map((cp) => new DXNChar(cp)),
  fc.string().map((s) => new DXNSymbol(s)),
  fc.string().map((s) => new DXNKeyword(s)),
  fc.uint8Array({ minLength: 16, maxLength: 16 }).map((bytes) => new DXNUUID(bytes)),
  fc.tuple(fc.bigInt(), fc.bigInt({ min: 1n })).map(([n, d]) => new DXNRational(n, d))
);

/** @param {number} maxDepth @returns {fc.Arbitrary<unknown>} */
function dxnValue(maxDepth) {
  if (maxDepth <= 0) return dxnScalar;
  const smaller = fc.array(dxnValue(maxDepth - 1), { maxLength: 3 });
  return fc.oneof(
    { weight: 3, arbitrary: dxnScalar },
    { weight: 1, arbitrary: smaller.map((items) => new DXNList(items)) },
    { weight: 1, arbitrary: smaller.map((items) => new DXNTuple(items)) }
  );
}

describe('.dxnb binary round-trip properties', () => {
  it('decode(encode(v)) is structurally equal to v, for any DXNValue', () => {
    fc.assert(
      fc.property(dxnValue(3), (v) => {
        const decoded = decode(encode(v, { trusted: false }), { trusted: false });
        expect(dxnEquals(decoded, v), `binary round-trip mismatch for ${inspect(v)}`).to.equal(true);
      })
    );
  });

  it('encoding is deterministic enough that encode(decode(encode(v))) === encode(v)', () => {
    fc.assert(
      fc.property(dxnValue(3), (v) => {
        const once = encode(v, { trusted: false });
        const twice = encode(decode(once, { trusted: false }), { trusted: false });
        expect(twice.equals(once)).to.equal(true);
      })
    );
  });
});
