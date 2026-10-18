import { expect } from 'chai';
import { parse } from '../../src/text/parser.cjs';
import { compile } from '../../src/schema/compiler.cjs';
import * as Validator from '../../src/schema/validator.cjs';
import Validated from '../../src/schema/validated.cjs';
import Registry from '../../src/registry.js';
import DXNStruct from '../../src/values/struct.js';
import DXNDecimal from '../../src/values/decimal.js';
import DXNRational from '../../src/values/rational.js';
import DXNUUID from '../../src/values/uuid.js';
import DXNDate from '../../src/values/date.js';
import DXNList from '../../src/values/list.js';

/** @param {string} dxnsSource @param {string} name */
function schemaFor(dxnsSource, name) {
  const registry = compile(parse(dxnsSource), new Registry());
  const found = registry.fetchStructSchema(name);
  return { compiled: found.compiled, registry: found.registry };
}

/**
 * Reads a keyed DXNStruct's field value by name — checkCompiled
 * returns the checked (and possibly-coerced) value in its *original*
 * DXNStruct shape, not a flattened field map, so tests read fields
 * back out through this rather than a bare `.x`.
 * @param {DXNStruct} struct
 * @param {string} name
 */
function fieldValue(struct, name) {
  return struct.fields.pairs.find(([k]) => k === name)?.[1];
}

describe('schema/validator', () => {
  describe('resolve (decode-side)', () => {
    it('answers the checked fields as name/value pairs, in the schema\'s order', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x: :integer, y: :integer } }', 'P');
      expect(Validator.resolve(compiled, { type: 'keyed', pairs: [['y', 2n], ['x', 1n]] }, registry)).to.deep.equal([
        ['x', 1n],
        ['y', 2n]
      ]);
    });

    it('reads positional fields by schema field order', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x: :integer, y: :integer } }', 'P');
      expect(Validator.resolve(compiled, { type: 'positional', values: [1n, 2n] }, registry)).to.deep.equal([
        ['x', 1n],
        ['y', 2n]
      ]);
    });

    it('rejects a positional field count mismatch', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x: :integer, y: :integer } }', 'P');
      expect(() => Validator.resolve(compiled, { type: 'positional', values: [1n] }, registry)).to.throw(/positional/);
    });

    it('fills an absent field with its default', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x?: %field{type: :integer, default: 99} } }', 'P');
      expect(Validator.resolve(compiled, { type: 'keyed', pairs: [] }, registry)).to.deep.equal([['x', 99n]]);
    });

    it('leaves an absent optional field with no default absent', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x?: :integer } }', 'P');
      expect(Validator.resolve(compiled, { type: 'keyed', pairs: [] }, registry)).to.deep.equal([]);
    });

    it('never coerces on decode, even for a value that would coerce cleanly on encode', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ amount: :rational } }', 'P');
      expect(() => Validator.resolve(compiled, { type: 'keyed', pairs: [['amount', 0.5]] }, registry)).to.throw(/does not match/);
    });
  });

  describe('validateForEncode / validateTreeForEncode (encode-side)', () => {
    it('checks a DXNStruct and returns it in the same shape, unchanged, when already conforming', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x: :integer } }', 'P');
      const struct = DXNStruct.keyed('P', [['x', 1n]]);
      const result = Validator.validateForEncode(compiled, struct, registry);
      expect(Validated.strip(result)).to.deep.equal(struct);
    });

    it('rejects a value with no DXN representation as a name map', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ x: :integer } }', 'P');
      expect(() => Validator.validateForEncode(compiled, 42n, registry)).to.throw(/expected a map/);
    });

    it('never converts a value to make it match (DXN.md §4.7)', () => {
      const { compiled, registry } = schemaFor('%{ P: %schema{ amount: :rational } }', 'P');
      const struct = DXNStruct.keyed('P', [['amount', 0.5]]);
      expect(() => Validator.validateForEncode(compiled, struct, registry)).to.throw(/does not match/);
    });

    describe('validateTreeForEncode (automatic whole-tree walk)', () => {
      it('finds and checks a struct nested inside a plain field value', () => {
        const doc = parse(`
          %{
            Address: %schema{ city: :string }
            Person: %schema{ name: :string, address: Address }
          }
        `);
        const registry = compile(doc, new Registry());
        const good = DXNStruct.keyed('Person', [
          ['name', 'Ada'],
          ['address', DXNStruct.keyed('Address', [['city', 'London']])]
        ]);
        expect(Validated.strip(Validator.validateTreeForEncode(good, registry))).to.deep.equal(good);
      });

      it('rejects a nested reference field pointing at the wrong struct name', () => {
        const doc = parse(`
          %{
            Address: %schema{ city: :string }
            Person: %schema{ address: Address }
          }
        `);
        const registry = compile(doc, new Registry());
        const bad = DXNStruct.keyed('Person', [['address', DXNStruct.keyed('NotAddress', [['city', 'X']])]]);
        expect(() => Validator.validateTreeForEncode(bad, registry)).to.throw(/violates its schema/);
      });

      it('finds a registered struct nested inside a DXNList', () => {
        const doc = parse('%{ P: %schema{ x: :integer } }');
        const registry = compile(doc, new Registry());
        const tree = new DXNList([DXNStruct.keyed('P', [['x', 1n]])]);
        const result = Validator.validateTreeForEncode(tree, registry);
        expect(Validated.strip(result).items).to.deep.equal([DXNStruct.keyed('P', [['x', 1n]])]);
      });

      it('leaves DXN wrapper values (DXNUUID, DXNBytes, ...) untouched, never reaching into their internals', () => {
        const registry = new Registry();
        const uuid = DXNUUID.fromString('550e8400-e29b-41d4-a716-446655440000');
        const result = Validator.validateTreeForEncode(uuid, registry);
        expect(result).to.equal(uuid); // same object, not reconstructed
        expect(result.bytes).to.be.instanceOf(Uint8Array);
      });

      it('passes through a value with no registered structs at all, unchanged in shape', () => {
        const registry = new Registry();
        const struct = DXNStruct.positional('Unregistered', [1n, 2n]);
        const result = Validated.strip(Validator.validateTreeForEncode(struct, registry));
        expect(result).to.deep.equal(struct);
      });
    });
  });
});
