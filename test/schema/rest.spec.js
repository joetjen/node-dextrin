import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { decode, encode, encodeBinary, canonical, Document, Registry, Schema, SchemaTree, dxnEquals } from '../../src/dextrin.js';

// G1 of dextrin's design/typespec.md, as its test/schema/rest_test.exs:
// typed extras and closed bodies, written `* K => V` and `- *` in a
// `%schema` or `%shape` body (DXNS.md §4c).
describe('G1: typed and closed extras', () => {
  /** @param {string} text @param {any} [registry] */
  const compiled = (text, registry = new Registry()) => Schema.compile(decode(text), registry);

  /** @param {string} text */
  const registry = (text) => compiled(text);

  /** A compile refusal's message. @param {string} text @returns {string} */
  const compileError = (text) => {
    try {
      compiled(text);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {Error} */ (err).message;
    }
    throw new Error(`compiled: ${text}`);
  };

  /** The category of what `fn` throws, or what it answers. @param {() => unknown} fn */
  const category = (fn) => {
    try {
      return fn();
    } catch (err) {
      return /** @type {any} */ (err).category ?? err;
    }
  };

  /** The message of what `fn` throws. @param {() => unknown} fn @returns {string} */
  const message = (fn) => {
    try {
      fn();
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
    throw new Error('did not throw');
  };

  /** @param {any} r @param {string} name @param {string} text */
  const takes = (r, name, text) => {
    try {
      return Schema.check(decode(text), r, name);
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  describe('* K => V types the extras', () => {
    const rest = `
      %{
        Tags: %shape{name: :string, * :string => :integer}
        Box: %schema{tags: Tags}
        Counts: %schema{total: :integer, * :string => :integer}
      }`;

    it('an extra of a shape must match the rest', () => {
      const r = registry(rest);
      expect(takes(r, 'Tags', '%{name: "a", "x" => 1, "y" => 2}')).to.equal(true);
      expect(takes(r, 'Tags', '%{name: "a", "x" => "one"}')).to.equal(false);
      expect(takes(r, 'Tags', '%{name: "a"}')).to.equal(true);
    });

    // A key K does not take is no business of the entry (T674); `- *`
    // beside it refuses such a key, as a lone `* K => V` did until then.
    it('a key K does not take is kept, unless - * stands beside it', () => {
      expect(takes(registry(rest), 'Tags', '%{name: "a", :x => 1}')).to.equal(true);
      const r = registry('%{T: %shape{name: :string * :string => :integer - *}}');
      expect(takes(r, 'T', '%{name: "a", :x => 1}')).to.equal(false);
    });

    it('a declared field is no extra, whatever the rest says', () => {
      expect(takes(registry(rest), 'Tags', '%{name: "a"}')).to.equal(true);
    });

    it("a struct's extras match the rest, and a strict decode keeps them", () => {
      const r = registry(rest);
      expect(() => decode('%Counts{total: 1, "a" => 2}', { registry: r })).not.to.throw();
      expect(category(() => decode('%Counts{total: 1, "a" => "x"}', { registry: r }))).to.equal('schema/type-mismatch');
      expect(() => decode('%Counts{total: 1, "a" => 2}', { registry: r, strict: true })).not.to.throw();
    });

    it("K and V may name the document's other types", () => {
      const r = registry('%{Count: {:refine :integer %{min: 0}}, T: %shape{a: :integer, * :string => Count}}');
      expect(takes(r, 'T', '%{a: 1, "x" => 2}')).to.equal(true);
      expect(takes(r, 'T', '%{a: 1, "x" => -2}')).to.equal(false);
    });

    it('a refused extra says why', () => {
      const r = registry(rest);
      expect(message(() => decode('%Counts{total: 1, "a" => "x"}', { registry: r }))).to.include('"a"');
    });
  });

  describe('- * refuses every extra', () => {
    const closed = `
      %{
        Point: %shape{x: :integer, y: :integer - *}
        Pin: %schema{at: Point - *}
      }`;

    it('a closed shape takes no extra', () => {
      const r = registry(closed);
      expect(takes(r, 'Point', '%{x: 1, y: 2}')).to.equal(true);
      expect(takes(r, 'Point', '%{x: 1, y: 2, z: 3}')).to.equal(false);
    });

    it('a closed schema refuses an extra even without a strict decode', () => {
      const r = registry(closed);
      expect(() => decode('%Pin{at: %{x: 1, y: 2}}', { registry: r })).not.to.throw();
      expect(category(() => decode('%Pin{at: %{x: 1, y: 2}, note: 1}', { registry: r }))).to.equal('schema/undeclared-field');
    });

    // Until T674 (2026-11-17) a body had one `* K => V` at most, and not
    // beside `- *`. JSON Schema's patternProperties needs several, and
    // additionalProperties: false beside them.
    it('beside entries, - * refuses only what no entry takes', () => {
      const r = registry('%{P: %shape{x: :integer * {:refine :string %{pattern: @regex "^x-"}} => :integer - *}}');
      expect(takes(r, 'P', '%{x: 1, "x-a" => 2}')).to.equal(true);
      expect(takes(r, 'P', '%{x: 1, "x-a" => "two"}')).to.equal(false);
      expect(takes(r, 'P', '%{x: 1, "y" => 2}')).to.equal(false);
    });
  });

  describe('several * K => V', () => {
    const several = `
      %{
        P: %shape{
          * {:refine :string %{pattern: @regex "^a"}} => :integer
          * {:refine :string %{pattern: @regex "b$"}} => {:refine :integer %{min: 10}}
        }
      }`;

    it('a key matches the V of every entry whose K takes it', () => {
      const r = registry(several);
      expect(takes(r, 'P', '%{"a" => 1, "b" => 10, "ab" => 12}')).to.equal(true);
      expect(takes(r, 'P', '%{"ab" => 3}')).to.equal(false);
      expect(takes(r, 'P', '%{"b" => 3}')).to.equal(false);
    });

    it('a key no entry takes is kept, unless the body is closed or the decode strict', () => {
      const r = registry(several);
      expect(takes(r, 'P', '%{"zzz" => "anything"}')).to.equal(true);
      const strict = r.putStrict(true);
      expect(takes(strict, 'P', '%{"zzz" => 1}')).to.equal(false);
      expect(takes(strict, 'P', '%{"a" => 1}')).to.equal(true);
    });

    it("a struct's extras follow the same rule", () => {
      const r = registry('%{C: %schema{n: :integer * {:refine :string %{pattern: @regex "^x"}} => :integer - *}}');
      expect(() => decode('%C{n: 1, "xa" => 2}', { registry: r })).not.to.throw();
      expect(category(() => decode('%C{n: 1, "xa" => "s"}', { registry: r }))).to.equal('schema/type-mismatch');
      expect(category(() => decode('%C{n: 1, "ya" => 2}', { registry: r }))).to.equal('schema/undeclared-field');
    });
  });

  describe('written and read back', () => {
    it('both entries print as written, and read back the same', () => {
      const text = '%{P: %shape{- * x: :integer}, Q: %schema{* :string => :integer, y: :string}}';
      const doc = decode(text);
      const printed = encode(doc);
      expect(printed).to.include('- *');
      expect(printed).to.include('* :string => :integer');
      expect(dxnEquals(decode(printed), doc)).to.equal(true);
    });

    it('every text writer writes them, and .dxnb refuses them', () => {
      const doc = decode('%{P: %shape{- * x: :integer}, Q: %schema{* :string => :integer, y: :string}}');
      expect(encode(doc, { pretty: true })).to.equal('%{\n  P: %shape{- * x: :integer}\n  Q: %schema{* :string => :integer y: :string}\n}');
      expect(canonical(doc)).to.equal('%{P: %shape{- * x: :integer} Q: %schema{* :string => :integer y: :string}}');
      expect(Document.format(Document.parse('%{P: %shape{-   *, x: :integer}, Q: %schema{*   :string=>:integer}}'))).to.equal(
        '%{\n  P: %shape{- * x: :integer}\n  Q: %schema{* :string => :integer}\n}'
      );
      expect(category(() => encodeBinary(doc))).to.equal('encode/unsupported');
    });

    it('only a %schema or a %shape takes them', () => {
      expect(message(() => decode('%Foo{- *}'))).to.include('%Foo');
      expect(message(() => decode('%Foo{* :a => 1}'))).to.include('%Foo');
    });

    it('- * stands once in a body', () => {
      expect(message(() => decode('%{P: %shape{x: :integer - * - *}}'))).to.include('once');
    });

    it('several entries are written back in their order', () => {
      const doc = decode('%{P: %shape{* :string => :any * :keyword => :integer - *}}');
      const printed = encode(doc);
      expect(printed).to.match(/\* :string => :any.*\* :keyword => :integer/);
      expect(dxnEquals(decode(printed), doc)).to.equal(true);
    });
  });

  describe('in a tree', () => {
    it('a file is loaded after the one whose type its * K => V names', () => {
      // `aa` sorts first, and names `zz` only in its `* K => V`.
      const root = mkdtempSync(join(tmpdir(), 'dextrin-rest-'));
      try {
        mkdirSync(join(root, 's'));
        writeFileSync(join(root, 's', 'zz.dxns'), '%{Count: {:refine :integer %{min: 0}}}');
        writeFileSync(join(root, 's', 'aa.dxns'), '%{T: %shape{a: :integer, * :string => zz/Count}}');
        const loaded = /** @type {any} */ (SchemaTree.load([join(root, 's')]));
        expect(loaded.ok).to.equal(true);
        expect(takes(loaded.registry, 'aa/T', '%{a: 1, "x" => 2}')).to.equal(true);
        expect(takes(loaded.registry, 'aa/T', '%{a: 1, "x" => -2}')).to.equal(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('built from others', () => {
    it("the rest and closed are inherited, and the body's own replace them", () => {
      const r = registry(`
        %{
          Base: %shape{a: :integer, * :string => :integer}
          Kept: %shape includes Base {b: :integer}
          Mine: %shape includes Base {b: :integer, * :string => :string}
        }`);
      expect(takes(r, 'Kept', '%{a: 1, b: 2, "x" => "s"}')).to.equal(false);
      expect(takes(r, 'Mine', '%{a: 1, b: 2, "x" => "s"}')).to.equal(true);
    });

    it('two bases whose rest differs are a compile error, unless the body settles it', () => {
      expect(
        compileError(`
          %{
            A: %shape{a: :integer, * :string => :integer}
            B: %shape{b: :integer - *}
            C: %shape includes A B {}
          }`)
      ).to.include('extras');

      expect(() =>
        compiled(`
          %{
            A: %shape{a: :integer, * :string => :integer}
            B: %shape{b: :integer - *}
            C: %shape includes A B {- *}
          }`)
      ).not.to.throw();
    });

    it('extending a closed base with a field of its own is a compile error', () => {
      expect(
        compileError(`
          %{
            A: %schema{a: :integer - *}
            B: %schema extends A {b: :integer}
          }`)
      ).to.include('closed');
    });
  });
});
