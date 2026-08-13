import { expect } from 'chai';
import { parse } from '../../src/text/parser.cjs';
import { compile, SchemaCompileError } from '../../src/schema/compiler.cjs';
import Registry from '../../src/registry.js';

describe('schema/compiler', () => {
  it('compiles a %schema{} entry into a registered Compiled schema', () => {
    const doc = parse('%{ Point: %schema{ fields: @ordered %{ x: :float, y: :float } } }');
    const registry = compile(doc, new Registry());
    const found = registry.fetchStructSchema('Point');
    expect(found?.compiled.name).to.equal('Point');
    expect(found?.compiled.fieldNames()).to.deep.equal(['x', 'y']);
  });

  it('preserves field order from the @ordered fields map', () => {
    const doc = parse('%{ P: %schema{ fields: @ordered %{ c: :integer, a: :integer, b: :integer } } }');
    const registry = compile(doc, new Registry());
    expect(registry.fetchStructSchema('P')?.compiled.fieldNames()).to.deep.equal(['c', 'a', 'b']);
  });

  it('rejects fields: that is not an @ordered map', () => {
    const doc = parse('%{ P: %schema{ fields: %{ x: :integer } } }');
    expect(() => compile(doc, new Registry())).to.throw(SchemaCompileError, /@ordered/);
  });

  it('a "?"-suffixed field key is optional; every other key is required', () => {
    const doc = parse('%{ P: %schema{ fields: @ordered %{ x: :integer, y?: :integer } } }');
    const registry = compile(doc, new Registry());
    const fields = registry.fetchStructSchema('P')?.compiled.fields ?? [];
    expect(fields.find((f) => f.name === 'x')?.required).to.equal(true);
    expect(fields.find((f) => f.name === 'y')?.required).to.equal(false);
  });

  it('%field{} escape hatch supplies default/description alongside type', () => {
    const doc = parse('%{ P: %schema{ fields: @ordered %{ x: %field{type: :integer, default: 0, description: "the x coordinate"} } } }');
    const registry = compile(doc, new Registry());
    const field = registry.fetchStructSchema('P')?.compiled.fields[0];
    expect(field?.default).to.equal(0n);
    expect(field?.description).to.equal('the x coordinate');
  });

  it('closed/forbidden/refine-fn compile onto Compiled', () => {
    const doc = parse('%{ P: %schema{ closed: true, forbidden: [:legacy], fields: @ordered %{ x: :integer } } }');
    const registry = compile(doc, new Registry());
    const compiled = registry.fetchStructSchema('P')?.compiled;
    expect(compiled?.closed).to.equal(true);
    expect(compiled?.forbidden).to.deep.equal(['legacy']);
  });

  it('refine-fn: resolves against the predicates map', () => {
    const doc = parse('%{ P: %schema{ refine-fn: my-check, fields: @ordered %{ x: :integer } } }');
    const predicate = (resolved) => (resolved.x > 0 ? true : 'x must be positive');
    const registry = compile(doc, new Registry(), { 'my-check': predicate });
    expect(registry.fetchStructSchema('P')?.compiled.refineFn).to.equal(predicate);
  });

  it('refine-fn: with no matching predicate throws', () => {
    const doc = parse('%{ P: %schema{ refine-fn: missing, fields: @ordered %{ x: :integer } } }');
    expect(() => compile(doc, new Registry())).to.throw(SchemaCompileError, /missing/);
  });

  it('a non-%schema{} entry becomes a named type_expr alias', () => {
    const doc = parse('%{ Age: {:refine :integer %{min: 0, max: 150}} }');
    const registry = compile(doc, new Registry());
    const alias = registry.fetchTypeAlias('Age');
    expect(alias).to.deep.equal({ form: 'refine', base: { form: 'primitive', name: 'integer' }, constraints: { min: 0n, max: 150n } });
  });

  it('a named type referencing another already known to baseRegistry resolves to that alias\'s own definition', () => {
    // Matches Dextrin.Schema.Compiler's own compile_type_expr/2: a
    // *known* alias name resolves directly to its definition (here,
    // Age's own `{form: 'primitive', name: 'integer'}`) rather than
    // staying an unresolved `{form: 'reference', name: 'Age'}` — only
    // a genuinely *unknown* name (a forward/struct reference) becomes
    // a reference form.
    const first = compile(parse('%{ Age: :integer }'), new Registry());
    const second = compile(parse('%{ Years: Age }'), first);
    expect(second.fetchTypeAlias('Years')).to.deep.equal({ form: 'primitive', name: 'integer' });
  });

  it('a named type referencing an unknown name becomes an unresolved reference (e.g. to a struct)', () => {
    const registry = compile(parse('%{ HasAddress: Address }'), new Registry());
    expect(registry.fetchTypeAlias('HasAddress')).to.deep.equal({ form: 'reference', name: 'Address' });
  });

  it('every DXN.md §4.1 type_expr form compiles', () => {
    const doc = parse(`
      %{
        AnyT: :any
        RefT: SomeStruct
        ListT: {:list-of :integer}
        SetT: {:set-of :integer}
        TupleT: {:tuple-of :integer :string}
        MapT: {:map-of :string :integer}
        EnumT: {:enum :usd :eur}
        OneOfT: {:one-of :integer :string}
        AllOfT: {:all-of :integer :integer}
        NilableT: {:nilable :integer}
        RefineT: {:refine :integer %{min: 0}}
      }
    `);
    const registry = compile(doc, new Registry());
    expect(registry.fetchTypeAlias('AnyT')).to.deep.equal({ form: 'any' });
    expect(registry.fetchTypeAlias('RefT')).to.deep.equal({ form: 'reference', name: 'SomeStruct' });
    expect(registry.fetchTypeAlias('ListT').form).to.equal('list-of');
    expect(registry.fetchTypeAlias('SetT').form).to.equal('set-of');
    expect(registry.fetchTypeAlias('TupleT').elems).to.have.lengthOf(2);
    expect(registry.fetchTypeAlias('MapT').form).to.equal('map-of');
    expect(registry.fetchTypeAlias('EnumT').literals).to.have.lengthOf(2);
    expect(registry.fetchTypeAlias('OneOfT').variants).to.have.lengthOf(2);
    expect(registry.fetchTypeAlias('AllOfT').variants).to.have.lengthOf(2);
    expect(registry.fetchTypeAlias('NilableT').form).to.equal('nilable');
    expect(registry.fetchTypeAlias('RefineT').form).to.equal('refine');
  });

  it('rejects an unrecognized primitive type name', () => {
    const doc = parse('%{ P: %schema{ fields: @ordered %{ x: :not-a-real-type } } }');
    expect(() => compile(doc, new Registry())).to.throw(SchemaCompileError);
  });

  it('normalizes keywords regardless of whether the .dxns source itself was decoded trusted or not', () => {
    const trustedDoc = parse('%{ P: %schema{ fields: @ordered %{ x: :integer } } }', { trusted: true });
    const untrustedDoc = parse('%{ P: %schema{ fields: @ordered %{ x: :integer } } }', { trusted: false });
    const r1 = compile(trustedDoc, new Registry());
    const r2 = compile(untrustedDoc, new Registry());
    expect(r1.fetchStructSchema('P')?.compiled.fieldNames()).to.deep.equal(r2.fetchStructSchema('P')?.compiled.fieldNames());
  });

  it('rejects a non-map document', () => {
    expect(() => compile(parse('42'), new Registry())).to.throw(SchemaCompileError);
  });
});
