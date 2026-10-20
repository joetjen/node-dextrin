import { expect } from 'chai';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { decode, FileResolver, Registry, SchemaTree } from '../../src/dextrin.js';

// A tree of `.dxns` files read as one, as dextrin 96d3fc0 (Jan,
// 2026-10-20): every entry named from its file's path (DXN.md §4.6), the
// files compiled in the order their references need, and every problem
// reported with its file and line.
describe('schema tree', () => {
  /** @param {{[path: string]: string}} files */
  const tree = (files) => {
    const root = mkdtempSync(join(tmpdir(), 'dextrin-tree-'));
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    return root;
  };

  const GOOD = {
    'acme.common.dxns': `%{
      Money: %shape{amount: :decimal, currency: Currency}
      Currency: {:enum "EUR" "USD"}
      Percentage: {:refine :decimal %{min: 0, max: 100}}
    }`,
    'acme/shop/Order-v2.dxns': `%{
      Order: %schema(2){
        total: acme.common/Money
        discount?: acme.common/Percentage
        lines: {:list-of Line}
      }
      Line: %shape{sku: :string}
    }`,
    'HealthCheck.dxns': '%{HealthCheck: %schema{ok: :boolean}}'
  };

  /** @param {any} result */
  const messages = (result) => result.problems.map((/** @type {any} */ p) => p.message);

  it('loads a tree that is in order, every entry under its full name', () => {
    const result = /** @type {any} */ (SchemaTree.load([tree(GOOD)]));
    expect(result.ok).to.equal(true);
    expect(result.summary).to.deep.equal({ files: 3, definitions: 6 });
    expect(result.registry.structs.has('acme.shop/Order')).to.equal(true);
    expect(result.registry.typeAliases.has('acme.common/Money')).to.equal(true);
  });

  it("resolves another file's named types, whatever order the files sort in", () => {
    const { registry } = /** @type {any} */ (SchemaTree.load([tree(GOOD)]));
    expect(() =>
      decode('%acme.shop/Order(2){total: %{amount: 1.50M, currency: "EUR"}, discount: 10.0M, lines: [%{sku: "a"}]}', { registry })
    ).not.to.throw();
    expect(() => decode('%acme.shop/Order(2){total: %{amount: 1.50M, currency: "GBP"}, lines: []}', { registry }))
      .to.throw()
      .with.property('category', 'schema/type-mismatch');
  });

  it("the file resolver resolves another file's named types", () => {
    const registry = new Registry().putResolver(FileResolver.forPaths([tree(GOOD)]));
    expect(() => decode('%acme.shop/Order(2){total: %{amount: 1.50M, currency: "EUR"}, discount: 10.0M, lines: []}', { registry })).not.to.throw();
    expect(() => decode('%acme.shop/Order(2){total: %{amount: 1.50M, currency: "GBP"}, lines: []}', { registry })).to.throw();
  });

  it('reports a syntax error with its line', () => {
    const result = /** @type {any} */ (SchemaTree.load([tree({ 'a.dxns': '%{\n  A: :integer\n  B: [\n}\n' })]));
    expect(result.ok).to.equal(false);
    expect(result.problems).to.have.length(1);
    expect(result.problems[0].file).to.equal('a.dxns');
    expect(result.problems[0].line).to.be.a('number');
  });

  it('reports a definition that does not compile, with its line', () => {
    const result = /** @type {any} */ (SchemaTree.load([tree({ 'a.dxns': '%{\n  A: :integer\n  B: {:wibble :integer}\n}\n' })]));
    expect(result.problems.map((/** @type {any} */ p) => [p.file, p.line])).to.deep.equal([['a.dxns', 3]]);
  });

  it('reports a name that resolves to nothing, unless its namespace is extern', () => {
    const result = SchemaTree.load([tree({ 'a.dxns': '%{A: %schema{m: acme.comon/Money, n: Nowhere}}' })]);
    expect(messages(result).some((/** @type {string} */ m) => m.includes('acme.comon/Money'))).to.equal(true);
    expect(messages(result).some((/** @type {string} */ m) => m.includes('Nowhere'))).to.equal(true);
    const root = tree({ 'a.dxns': '%{A: %schema{m: other/Thing}}' });
    expect(SchemaTree.load([root]).ok).to.equal(false);
    expect(SchemaTree.load([root], { extern: ['other'] }).ok).to.equal(true);
  });

  it('reports a versioned file holding another version, and one version in two files', () => {
    expect(messages(SchemaTree.load([tree({ 'Customer-v2.dxns': '%{Customer: %schema(3){name: :string}}' })]))[0]).to.include('version');
    const twice = SchemaTree.load([
      tree({ 'Customer-v2.dxns': '%{Customer: %schema(2){name: :string}}', 'Customer/v2.dxns': '%{Customer: %schema(2){name: :string}}' })
    ]);
    expect(messages(twice)).to.have.length(1);
    expect(messages(twice)[0]).to.include('two files');
  });

  it("reports every file's problems, and files that need each other", () => {
    const all = /** @type {any} */ (SchemaTree.load([tree({ 'a.dxns': '%{A: {:wibble :integer}}', 'b.dxns': '%{B: [}' })]));
    expect(all.problems.map((/** @type {any} */ p) => p.file).sort()).to.deep.equal(['a.dxns', 'b.dxns']);
    const cycle = SchemaTree.load([tree({ 'a.dxns': '%{A: {:list-of b/B}}', 'b.dxns': '%{B: {:list-of a/A}}' })]);
    expect(messages(cycle)).to.have.length(1);
    expect(messages(cycle)[0]).to.include('a.dxns').and.include('b.dxns');
  });
});
