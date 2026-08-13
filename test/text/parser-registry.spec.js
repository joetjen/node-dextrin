import { expect } from 'chai';
import { parse, ParseError } from '../../src/text/parser.cjs';
import { compile } from '../../src/schema/compiler.cjs';
import Registry from '../../src/registry.js';
import DXNStruct from '../../src/values/struct.js';
import DXNCustomTag from '../../src/values/custom-tag.js';

describe('text/parser with a registry', () => {
  const schemaDoc = parse('%{ Point: %schema{ fields: @ordered %{ x: :float, y: :float } } }');

  it('materializes a registered struct instead of an opaque DXNStruct', () => {
    const registry = compile(schemaDoc, new Registry());
    const value = parse('%Point{x: 1.0, y: 2.0}', { registry });
    expect(value).to.deep.equal({ x: 1, y: 2 });
  });

  it('materializes a positional struct the same way', () => {
    const registry = compile(schemaDoc, new Registry());
    const value = parse('%Point[1.0, 2.0]', { registry });
    expect(value).to.deep.equal({ x: 1, y: 2 });
  });

  it('falls back to an opaque DXNStruct for an unregistered name, registry or not', () => {
    const registry = compile(schemaDoc, new Registry());
    const value = parse('%Other{x: 1}', { registry });
    expect(value).to.be.instanceOf(DXNStruct);
    expect(value.name).to.equal('Other');
  });

  it('throws ParseError with the schema violation reason for a bad struct', () => {
    const registry = compile(schemaDoc, new Registry());
    expect(() => parse('%Point{x: 1.0}', { registry })).to.throw(ParseError, /missing required field "y"/);
  });

  it('uses a registered custom-tag decoder instead of DXNCustomTag', () => {
    const registry = new Registry().putTag('my-tag', (v) => ({ decoded: v }));
    expect(parse('@my-tag 42', { registry })).to.deep.equal({ decoded: 42n });
  });

  it('falls back to DXNCustomTag for an unregistered tag name', () => {
    const registry = new Registry().putTag('other-tag', (v) => v);
    const value = parse('@my-tag 42', { registry });
    expect(value).to.be.instanceOf(DXNCustomTag);
  });

  it('propagates a custom-tag decoder error as a ParseError', () => {
    const registry = new Registry().putTag('my-tag', () => {
      throw new Error('boom');
    });
    expect(() => parse('@my-tag 42', { registry })).to.throw(ParseError, /boom/);
  });

  it('behaves exactly as before (opaque fallback) with no registry at all', () => {
    const value = parse('%Point{x: 1.0, y: 2.0}');
    expect(value).to.be.instanceOf(DXNStruct);
  });

  it('a nested struct field resolves against the same registry, enabling {reference} checks', () => {
    const doc = parse(`
      %{
        Address: %schema{ fields: @ordered %{ city: :string } }
        Person: %schema{ fields: @ordered %{ name: :string, address: Address } }
      }
    `);
    const registry = compile(doc, new Registry());
    const value = parse('%Person{name: "Ada", address: %Address{city: "London"}}', { registry });
    expect(value).to.deep.equal({ name: 'Ada', address: { city: 'London' } });
  });
});
