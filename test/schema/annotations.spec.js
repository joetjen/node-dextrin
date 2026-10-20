import { expect } from 'chai';
import { decode, Registry, Schema, DXNKeyword, DXNList } from '../../src/dextrin.js';

// `{:doc T %{...}}`, the superset's group 8, as dextrin 0b4225d
// (design/schema-superset.md, Jan, 2026-10-20): a title, a description,
// examples, read-only, write-only, deprecated and free `meta` on any type,
// a whole schema included, and docs for single enum values. Annotations
// say things about a type; they never change what it takes.
describe('schema annotations, {:doc T %{...}}', () => {
  const schemas = `
%{
  Order: {:doc %schema(2){
    id: :integer
    email: {:doc :string %{description: "Where receipts go", meta: %{"acme.pii" => true}}}
    legacy?: {:doc :string %{deprecated: "use email"}}
  } %{title: "An order", description: "One checkout", deprecated: false}}

  Color: {:doc {:enum :red :green :old-blue} %{
    description: "A color"
    values: %{:old-blue => %{deprecated: true, description: "Use :blue"}}
  }}

  Port: {:doc {:refine :integer %{min: 1, max: 65535}} %{examples: [80 443], read-only: true}}

  Page: {:doc {:generic [t] %shape{items: {:list-of t}}} %{description: "A page of anything"}}
}
`;

  /** @param {string} [text] */
  const registry = (text = schemas) => Schema.compile(decode(text), new Registry());

  /** The message a compile refuses `text` with. @param {string} text @returns {string} */
  const compileError = (text) => {
    try {
      registry(text);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {any} */ (err).message;
    }
    throw new Error(`${text} compiled`);
  };

  /** Whether `value` is a `name`; only a schema refusal answers false. @param {unknown} value @param {string} name */
  const takes = (value, name) => {
    try {
      return Schema.check(value, registry(), name);
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  it('an annotated type takes what the type takes, nothing more and nothing less', () => {
    const r = registry();
    expect(takes(80n, 'Port')).to.equal(true);
    expect(takes(0n, 'Port')).to.equal(false);
    expect(() => decode('%Order(2){id: 1, email: "a@b"}', { registry: r })).not.to.throw();
    expect(() => decode('%Order(2){id: 1, email: 5}', { registry: r })).to.throw();
    expect(() => decode('%Order(2){id: 1, email: "a@b", legacy: "x"}', { registry: r })).not.to.throw();
  });

  it("a schema's, a named type's and a generic's annotations are readable by name", () => {
    const r = registry();
    expect(Schema.annotations(r, 'Order')).to.deep.equal({ title: 'An order', description: 'One checkout', deprecated: false });
    const port = /** @type {any} */ (Schema.annotations(r, 'Port'));
    expect(port['read-only']).to.equal(true);
    expect(port.examples).to.be.instanceOf(DXNList);
    expect(port.examples.items).to.deep.equal([80n, 443n]);
    expect(Schema.annotations(r, 'Page')).to.deep.equal({ description: 'A page of anything' });
    expect(Schema.annotations(registry('%{Plain: :integer}'), 'Plain')).to.deep.equal({});
    expect(Schema.annotations(r, 'Nothing')).to.equal(undefined);
  });

  it("an enum value's own annotations sit under values", () => {
    const { values } = /** @type {any} */ (Schema.annotations(registry(), 'Color'));
    const entries = [...values.entries()];
    expect(entries).to.have.length(1);
    expect(entries[0][0]).to.be.instanceOf(DXNKeyword);
    expect(entries[0][0].name).to.equal('old-blue');
    expect(entries[0][1].deprecated).to.equal(true);
  });

  it("a field's annotations stay on its type, and its meta is kept as written", () => {
    const found = /** @type {any} */ (registry().fetchStructSchema('Order', 2));
    const email = found.compiled.fields.find((/** @type {any} */ f) => f.name === 'email');
    expect(email.type.form).to.equal('doc');
    expect(email.type.elem).to.deep.equal({ form: 'primitive', name: 'string' });
    expect(email.type.notes.meta.get('acme.pii')).to.equal(true);
  });

  it('the keys are a closed set, each of its kind', () => {
    for (const [text, key] of [
      ['%{T: {:doc :integer %{summary: "x"}}}', 'summary'],
      ['%{T: {:doc :integer %{description: 5}}}', 'description'],
      ['%{T: {:doc :integer %{examples: 5}}}', 'examples'],
      ['%{T: {:doc :integer %{read-only: "yes"}}}', 'read-only'],
      ['%{T: {:doc :integer %{deprecated: 5}}}', 'deprecated'],
      ['%{T: {:doc :integer %{meta: [1]}}}', 'meta'],
      ['%{T: {:doc :integer %{values: %{1 => %{}}}}}', 'values'],
      ['%{T: {:doc {:enum :a} %{values: %{:b => %{}}}}}', ':b'],
      ['%{T: {:doc {:enum :a} %{values: %{:a => %{values: %{}}}}}}', 'values'],
      ['%{T: {:doc :integer}}', 'doc']
    ]) {
      expect(compileError(text), text).to.include(key);
    }
  });

  it('a doc is no guard: it checks the same value', () => {
    expect(compileError('%{A: {:doc A %{description: "loops"}}}')).to.include('A');
  });
});
