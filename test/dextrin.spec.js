import { createRequire } from 'node:module';
import { expect } from 'chai';
import * as esm from '../src/dextrin.js';

const require = createRequire(import.meta.url);
const cjs = require('../src/dextrin.cjs');

describe('dextrin (top-level API)', () => {
  describe('decode/encode', () => {
    it('decode parses .dxn text', () => {
      expect(esm.decode('%{x: 1, y: 2}')).to.be.instanceOf(Map);
    });

    it('encode prints a value back to single-line .dxn text', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value)).to.equal('%{x:1,y:2}');
    });

    it('encode with pretty: true produces multi-line indented output', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value, { pretty: true })).to.equal('%{\n  x: 1\n  y: 2\n}');
    });

    it('both directions round-trip the README example exactly', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value)).to.equal('%{x:1,y:2}');
    });

    it('decode throws DXNError, not a bare parser error, on malformed input', () => {
      expect(() => esm.decode('%{x: }')).to.throw(esm.DXNError);
    });

    it('encode throws DXNError for a value with no DXN representation', () => {
      expect(() => esm.encode(() => {})).to.throw(esm.DXNError);
    });

    it('trusted: false decodes keyword as DXNKeyword instead of a global Symbol', () => {
      const value = esm.decode(':ok', { trusted: false });
      expect(value).to.be.instanceOf(esm.DXNKeyword);
    });
  });

  describe('decodeBinary/encodeBinary', () => {
    it('encodeBinary/decodeBinary round-trip a value', () => {
      const value = esm.decode('%{x: 1, y: [1 2 3]}');
      const bin = esm.encodeBinary(value);
      expect(esm.encode(esm.decodeBinary(bin))).to.equal(esm.encode(value));
    });

    it('encodeBinary returns a Buffer with the DX envelope', () => {
      const bin = esm.encodeBinary(42n);
      expect(Buffer.isBuffer(bin)).to.equal(true);
      expect(bin.subarray(0, 3)).to.deep.equal(Buffer.from([0x44, 0x58, 0x01]));
    });

    it('decodeBinary throws DXNError on a malformed envelope', () => {
      expect(() => esm.decodeBinary(Buffer.from([0, 0, 0]))).to.throw(esm.DXNError);
    });

    it('encodeBinary throws DXNError for a value with no DXN representation', () => {
      expect(() => esm.encodeBinary(() => {})).to.throw(esm.DXNError);
    });

    it('text and binary decode agree on the same source', () => {
      const value = esm.decode('%{a: 1, b: [1 2 3], c: :ok, d: @uuid "550e8400-e29b-41d4-a716-446655440000"}');
      const viaBinary = esm.decodeBinary(esm.encodeBinary(value));
      expect(esm.encode(viaBinary)).to.equal(esm.encode(value));
    });
  });

  describe('schema-backed decode/encode (registry:, validate:, coerce:, schema:)', () => {
    const schemaDoc = esm.decode('%{ Point: %schema{ x: :float, y: :float } }');
    const registry = esm.Schema.compile(schemaDoc, new esm.Registry());

    it('decode materializes a registered struct via the registry', () => {
      const value = esm.decode('%Point{x: 1.0, y: 2.0}', { registry });
      expect(value).to.deep.equal({ x: 1, y: 2 });
    });

    it('decode throws DXNError with the schema violation reason for a bad struct', () => {
      expect(() => esm.decode('%Point{x: 1.0}', { registry })).to.throw(esm.DXNError, /missing required field/);
    });

    it('encode validates every registered struct in the tree by default (validate: true)', () => {
      const DXNStruct = esm.DXNStruct;
      const bad = DXNStruct.keyed('Point', [['x', 'not a float']]);
      expect(() => esm.encode(bad, { registry })).to.throw(esm.DXNError, /violates its schema/);
    });

    it('encode skips validation entirely with validate: false', () => {
      const DXNStruct = esm.DXNStruct;
      const bad = DXNStruct.keyed('Point', [['x', 'not a float']]);
      expect(esm.encode(bad, { registry, validate: false })).to.equal('%Point{x:"not a float"}');
    });

    it('encode coerces mismatched fields by default (coerce: true)', () => {
      const rationalRegistry = esm.Schema.compile(esm.decode('%{ P: %schema{ amount: :rational } }'), new esm.Registry());
      const struct = esm.DXNStruct.keyed('P', [['amount', 0.5]]);
      expect(esm.encode(struct, { registry: rationalRegistry })).to.equal('%P{amount:1/2}');
    });

    it('encode with coerce: false rejects the same mismatched field', () => {
      const rationalRegistry = esm.Schema.compile(esm.decode('%{ P: %schema{ amount: :rational } }'), new esm.Registry());
      const struct = esm.DXNStruct.keyed('P', [['amount', 0.5]]);
      expect(() => esm.encode(struct, { registry: rationalRegistry, coerce: false })).to.throw(esm.DXNError, /does not match/);
    });

    it('encode with schema: validates a nameless value the automatic tree walk cannot reach on its own, promoting it to the named struct', () => {
      const plain = new Map([[Symbol.for('x'), 1.0], [Symbol.for('y'), 2.0]]);
      expect(esm.encode(plain, { registry, schema: 'Point' })).to.equal('%Point{x:1.0,y:2.0}');
    });

    it('encode with schema: throws when the named value does not conform', () => {
      const plain = new Map([[Symbol.for('x'), 1.0]]);
      expect(() => esm.encode(plain, { registry, schema: 'Point' })).to.throw(esm.DXNError, /missing required field/);
    });

    it('decodeBinary/encodeBinary accept the same registry/validate/coerce options', () => {
      const value = esm.decodeBinary(esm.encodeBinary(esm.DXNStruct.positional('Point', [1.0, 2.0]), { registry }), { registry });
      expect(value).to.deep.equal({ x: 1, y: 2 });
    });

    it('a full decode -> encode round trip through a schema-backed struct is stable', () => {
      const text = '%Point{x:1.0,y:2.0}';
      const decoded = esm.decode(text, { registry });
      expect(esm.encode(decoded, { registry, schema: 'Point' })).to.equal(text);
    });
  });

  describe('dual entry-point parity', () => {
    it('exports the same set of names from both the CJS and ESM entry points', () => {
      const esmKeys = Object.keys(esm).filter((k) => k !== 'default').sort();
      const cjsKeys = Object.keys(cjs).sort();
      expect(esmKeys).to.deep.equal(cjsKeys);
    });

    it('decode/encode behave identically through both entry points', () => {
      const text = '%{a: 1, b: [1 2 3], c: :ok}';
      expect(esm.encode(esm.decode(text))).to.equal(cjs.encode(cjs.decode(text)));
    });

    it('decodeBinary/encodeBinary behave identically through both entry points', () => {
      const text = '%{a: 1, b: [1 2 3], c: :ok}';
      const value = esm.decode(text);
      expect(esm.encode(esm.decodeBinary(esm.encodeBinary(value)))).to.equal(cjs.encode(cjs.decodeBinary(cjs.encodeBinary(value))));
    });
  });
});
