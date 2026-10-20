import { expect } from 'chai';
import { decode, encode, decodeBinary, encodeBinary } from '../../src/dextrin.js';
import DXNUUID from '../../src/values/uuid.js';
import DXNDecimal from '../../src/values/decimal.js';
import DXNDateTime from '../../src/values/date-time.js';
import DXNTuple from '../../src/values/tuple.js';
import DXNRegex from '../../src/values/regex.js';

/**
 * `DXN.md` §3's own worked example, byte-for-byte — every construct
 * it uses is meant to be "fully specified by §1.2 + §1.3", so this is
 * this project's own version of `dextrin`'s
 * `test/conformance/worked_example_test.exs`.
 */
const SOURCE = `
@dxn "1.0"
%{
  id:      @uuid "550e8400-e29b-41d4-a716-446655440000"
  name:    "Ada Lovelace"
  active:  true
  score:   19.99M
  tags:    @{:admin :staff}
  meta:    @ordered %{created: @datetime "1990-01-01T00:00:00Z"}
  address: %Point[51.05, 13.74]
  result:  {:ok, 200}
  handle:  @regex(i) "^[a-z0-9_]{3,20}$"
}
`;

describe('DXN.md §3 worked example', () => {
  // Trusted, so its keywords are the Symbol.for keys the assertions use.
  const value = decode(SOURCE, { trusted: true });

  it('decodes the header without surfacing it in the result', () => {
    expect(value).to.be.instanceOf(Map);
  });

  it('decodes every field to its expected DXN shape', () => {
    expect(value.get(Symbol.for('id'))).to.be.instanceOf(DXNUUID);
    expect(value.get(Symbol.for('id')).toString()).to.equal('550e8400-e29b-41d4-a716-446655440000');

    expect(value.get(Symbol.for('name'))).to.equal('Ada Lovelace');
    expect(value.get(Symbol.for('active'))).to.equal(true);

    expect(value.get(Symbol.for('score'))).to.be.instanceOf(DXNDecimal);
    expect(value.get(Symbol.for('score')).toString()).to.equal('19.99');

    expect(value.get(Symbol.for('tags'))).to.be.instanceOf(Set);
    expect(Array.from(value.get(Symbol.for('tags')))).to.have.members([Symbol.for('admin'), Symbol.for('staff')]);

    const meta = value.get(Symbol.for('meta'));
    expect(meta.pairs).to.have.lengthOf(1);
    expect(meta.pairs[0][1]).to.be.instanceOf(DXNDateTime);

    // %Point[...] has no registered schema yet (Phase 4) — opaque DXNStruct.
    const address = value.get(Symbol.for('address'));
    expect(address.name).to.equal('Point');
    expect(address.fields.type).to.equal('positional');
    expect(address.fields.values).to.deep.equal([51.05, 13.74]);

    const result = value.get(Symbol.for('result'));
    expect(result).to.be.instanceOf(DXNTuple);
    expect(result.items).to.deep.equal([Symbol.for('ok'), 200n]);

    const handle = value.get(Symbol.for('handle'));
    expect(handle).to.be.instanceOf(DXNRegex);
    expect(handle.pattern).to.equal('^[a-z0-9_]{3,20}$');
    expect(handle.flags.i).to.equal(true);
  });

  it('round-trips: decode then encode then decode again yields the same value', () => {
    const reEncoded = encode(value);
    const reDecoded = decode(reEncoded);
    expect(encode(reDecoded)).to.equal(reEncoded);
  });

  it('round-trips through pretty encoding too', () => {
    const pretty = encode(value, { pretty: true });
    expect(encode(decode(pretty))).to.equal(encode(value));
  });

  it('round-trips through the .dxnb binary codec too', () => {
    const viaBinary = decodeBinary(encodeBinary(value));
    expect(encode(viaBinary)).to.equal(encode(value));
  });
});
