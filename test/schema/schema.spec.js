import { expect } from 'chai';
import Schema from '../../src/schema.cjs';
import Registry from '../../src/registry.js';
import { parse } from '../../src/text/parser.cjs';
import DXNStruct from '../../src/values/struct.js';

describe('schema.cjs (top-level API)', () => {
  const doc = parse('%{ P: %schema{ x: :integer } }');

  describe('compile', () => {
    it('is the same as schema/compiler.cjs\'s compile', () => {
      const registry = Schema.compile(doc, new Registry());
      expect(registry.fetchStructSchema('P')).to.not.equal(undefined);
    });
  });

  describe('validate', () => {
    it('accepts an opaque DXNStruct that matches its named schema', () => {
      const registry = Schema.compile(doc, new Registry());
      expect(Schema.validate(DXNStruct.keyed('P', [['x', 1n]]), registry, 'P')).to.equal(true);
    });

    it('throws for a struct whose name does not match schemaName', () => {
      const registry = Schema.compile(doc, new Registry());
      expect(() => Schema.validate(DXNStruct.keyed('Other', [['x', 1n]]), registry, 'P')).to.throw(/expected a DXNStruct named/);
    });

    it('throws for a value that is not a DXNStruct at all', () => {
      const registry = Schema.compile(doc, new Registry());
      expect(() => Schema.validate(42n, registry, 'P')).to.throw(/expected a DXNStruct named/);
    });

    it('throws when no schema is registered for schemaName', () => {
      expect(() => Schema.validate(DXNStruct.keyed('P', [['x', 1n]]), new Registry(), 'P')).to.throw(/no compiled schema/);
    });

    it('throws when the struct violates its schema', () => {
      const registry = Schema.compile(doc, new Registry());
      expect(() => Schema.validate(DXNStruct.keyed('P', [['x', 'not an integer']]), registry, 'P')).to.throw();
    });
  });

  describe('validateEncode', () => {
    it('validates and returns the (stripped) checked value for a named schema', () => {
      const registry = Schema.compile(doc, new Registry());
      const struct = DXNStruct.keyed('P', [['x', 1n]]);
      expect(Schema.validateEncode(struct, registry, 'P')).to.deep.equal(struct);
    });

    it('coerces by default', () => {
      const rationalDoc = parse('%{ P: %schema{ amount: :rational } }');
      const registry = Schema.compile(rationalDoc, new Registry());
      const struct = DXNStruct.keyed('P', [['amount', 0.5]]);
      const result = Schema.validateEncode(struct, registry, 'P');
      expect(result.fields.pairs[0][1].toNumber()).to.equal(0.5);
    });

    it('throws when no schema is registered for schemaName', () => {
      expect(() => Schema.validateEncode({}, new Registry(), 'Nope')).to.throw(/no compiled schema/);
    });
  });

  describe('validateEncodeTree', () => {
    it('walks the whole tree and returns it (stripped, possibly coerced)', () => {
      const registry = Schema.compile(doc, new Registry());
      const struct = DXNStruct.keyed('P', [['x', 1n]]);
      expect(Schema.validateEncodeTree(struct, registry)).to.deep.equal(struct);
    });

    it('is a no-op pass-through for a value with nothing registered', () => {
      const value = DXNStruct.positional('Unknown', [1n]);
      expect(Schema.validateEncodeTree(value, new Registry())).to.deep.equal(value);
    });
  });

  describe('registerProvider', () => {
    it('is the same as schema/provider.cjs\'s registerProvider', () => {
      class Point {}
      const registry = Schema.registerProvider(new Registry(), {
        dxnSchema: () => '%{ Point: %schema{ x: :integer } }',
        dxnSchemaName: () => 'Point',
        dxnClass: () => Point
      });
      expect(registry.fetchStructModule('Point')).to.equal(Point);
    });
  });
});
