import { expect } from 'chai';
import fc from 'fast-check';
import { parse } from '../../src/text/parser.cjs';
import { print } from '../../src/text/printer.cjs';
import { pretty } from '../../src/text/formatter.cjs';
import { dxnEquals } from '../../src/values/equality.js';
import DXNChar from '../../src/values/char.js';
import DXNSymbol from '../../src/values/symbol.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';

/**
 * A `.dxn`-text-representable subset of `DXNValue` — narrower than
 * `test/support/dxn-value.arbitrary.js`'s general one, which
 * deliberately allows e.g. a `DXNSymbol` with a non-identifier name
 * (fine for structural-equality testing, not representable as `.dxn`
 * text at all: `symbol` has no quoted form in the grammar). Every
 * value generated here is expected to actually survive
 * `parse(print(v))`.
 */
const identifierName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/)
  .filter((s) => !['nil', 'true', 'false', 'NaN', 'Infinity'].includes(s));

const dxnScalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.bigInt(),
  fc.oneof(fc.double({ noNaN: true }), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
  fc.string(),
  fc
    .integer({ min: 0, max: 0x10ffff })
    .filter((cp) => cp < 0xd800 || cp > 0xdfff)
    .map((cp) => new DXNChar(cp)),
  identifierName.map((s) => new DXNSymbol(s)),
  fc.string().map((s) => new DXNKeyword(s))
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

describe('.dxn text round-trip properties', () => {
  it('parse(print(v)) is structurally equal to v, for any representable DXNValue', () => {
    fc.assert(
      fc.property(dxnValue(3), (v) => {
        const decoded = parse(print(v), { trusted: false });
        expect(dxnEquals(decoded, v), `${print(v)} did not round-trip`).to.equal(true);
      })
    );
  });

  it('print is idempotent: print(parse(print(v))) === print(v)', () => {
    fc.assert(
      fc.property(dxnValue(3), (v) => {
        const once = print(v);
        const twice = print(parse(once, { trusted: false }));
        expect(twice).to.equal(once);
      })
    );
  });

  it('pretty-printing round-trips to the same value as single-line printing', () => {
    fc.assert(
      fc.property(dxnValue(3), (v) => {
        const single = print(v);
        const multi = pretty(v);
        expect(dxnEquals(parse(single, { trusted: false }), parse(multi, { trusted: false }))).to.equal(true);
      })
    );
  });
});
