import { expect } from 'chai';
import { parse } from '../../src/text/parser.cjs';
import { compile } from '../../src/schema/compiler.cjs';
import Registry from '../../src/registry.js';
import { encode } from '../../src/binary/encoder.cjs';
import { decode } from '../../src/binary/decoder.cjs';
import { BinaryError } from '../../src/binary/errors.cjs';
import DXNStruct from '../../src/values/struct.js';
import DXNCustomTag from '../../src/values/custom-tag.js';

describe('.dxnb binary codec with a registry', () => {
  const schemaDoc = parse('%{ Point: %schema{ x: :float, y: :float } }');

  it('decoder materializes a registered struct instead of an opaque DXNStruct', () => {
    const registry = compile(schemaDoc, new Registry());
    const bin = encode(DXNStruct.positional('Point', [1.0, 2.0]));
    expect(decode(bin, { registry })).to.deep.equal({ x: 1, y: 2 });
  });

  it('decoder falls back to opaque DXNStruct for an unregistered name', () => {
    const registry = compile(schemaDoc, new Registry());
    const bin = encode(DXNStruct.positional('Other', [1n]));
    const value = decode(bin, { registry });
    expect(value).to.be.instanceOf(DXNStruct);
  });

  it('decoder throws BinaryError with the schema violation reason', () => {
    const registry = compile(schemaDoc, new Registry());
    const bin = encode(DXNStruct.positional('Point', [1.0])); // missing y
    expect(() => decode(bin, { registry })).to.throw(BinaryError, /violates its schema/);
  });

  it('decoder uses a registered custom-tag decoder instead of DXNCustomTag', () => {
    const registry = new Registry().putTag('my-tag', (v) => ({ decoded: v }));
    const bin = encode(new DXNCustomTag('my-tag', 42n));
    expect(decode(bin, { registry })).to.deep.equal({ decoded: 42n });
  });

  it('decoder propagates a custom-tag decoder error as a BinaryError', () => {
    const registry = new Registry().putTag('my-tag', () => {
      throw new Error('boom');
    });
    const bin = encode(new DXNCustomTag('my-tag', 42n));
    expect(() => decode(bin, { registry })).to.throw(BinaryError, /boom/);
  });

  it('encoder serializes a registered application class instance directly', () => {
    class Point {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    }
    const registry = compile(schemaDoc, new Registry()).putStructModule('Point', Point);
    const bin = encode(new Point(1.0, 2.0), { registry });
    expect(decode(bin, { registry })).to.deep.equal({ x: 1, y: 2 });
  });

  it('encoder falls back to a registered tag encoder for an unschemaed class', () => {
    class Meters {
      constructor(n) {
        this.n = n;
      }
    }
    const registry = new Registry().putTagEncoder(Meters, 'meters', (v) => v.n).putTag('meters', (v) => new Meters(v));
    const bin = encode(new Meters(5n), { registry });
    const back = decode(bin, { registry });
    expect(back).to.be.instanceOf(Meters);
    expect(back.n).to.equal(5n);
  });

  it('a struct materialized via a decoder-side materializer round-trips back through the encoder', () => {
    class Point {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    }
    let registry = compile(schemaDoc, new Registry());
    registry = registry.putStructModule('Point', Point).putStructMaterializer('Point', (f) => new Point(f.x, f.y));
    const original = DXNStruct.positional('Point', [1.0, 2.0]);
    const decoded = decode(encode(original), { registry });
    expect(decoded).to.be.instanceOf(Point);
    const reEncoded = encode(decoded, { registry });
    expect(decode(reEncoded, { registry })).to.deep.equal(decoded);
  });
});
