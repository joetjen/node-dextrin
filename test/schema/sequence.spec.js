import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';

// Lists and sequences, the superset's group 4, as dextrin f2639a9
// (design/schema-superset.md, Jan, 2026-10-20): a list's items in order
// (`{:list-items ...}` with `{:repeat ...}` and `{:group ...}`), a tuple
// of any length (`{:tuple-of-all T}`), and the refine keys `contains`,
// `min-contains`, `max-contains`, `unique` and `unique-by`.
describe('schema lists and sequences', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /** Whether the value written `text` is a `type`. @param {string} type @param {string} text */
  const takes = (type, text) => {
    const registry = compiled(type);
    try {
      return Schema.check(decode(text), registry, 'T');
    } catch {
      return false;
    }
  };

  /** The message a compile refuses `type` with. @param {string} type @returns {string} */
  const compileError = (type) => {
    try {
      compiled(type);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {any} */ (err).message;
    }
    throw new Error(`${type} compiled`);
  };

  describe('{:list-items ...}', () => {
    it('a type stands for exactly one item, in order', () => {
      const type = '{:list-items :string :integer}';
      expect(takes(type, '["a" 1]')).to.equal(true);
      expect(takes(type, '[1 "a"]')).to.equal(false);
      expect(takes(type, '["a"]')).to.equal(false);
      expect(takes(type, '["a" 1 2]')).to.equal(false);
      expect(takes(type, '{"a" 1}')).to.equal(false);
    });

    it('a repeat takes between min and max items, nil for no upper bound', () => {
      const headAndTail = '{:list-items :string {:repeat :integer 0 nil}}';
      expect(takes(headAndTail, '["a"]')).to.equal(true);
      expect(takes(headAndTail, '["a" 1 2 3]')).to.equal(true);
      expect(takes(headAndTail, '["a" 1 "b"]')).to.equal(false);

      const twoOrThree = '{:list-items {:repeat :integer 2 3}}';
      expect(takes(twoOrThree, '[1]')).to.equal(false);
      expect(takes(twoOrThree, '[1 2]')).to.equal(true);
      expect(takes(twoOrThree, '[1 2 3]')).to.equal(true);
      expect(takes(twoOrThree, '[1 2 3 4]')).to.equal(false);
    });

    it('a group repeats several items together', () => {
      const pairs = '{:list-items {:repeat {:group :string :integer} 1 nil}}';
      expect(takes(pairs, '["a" 1 "b" 2]')).to.equal(true);
      expect(takes(pairs, '["a" 1 "b"]')).to.equal(false);
      expect(takes(pairs, '[]')).to.equal(false);
    });

    it('a repeat gives back items the rest needs', () => {
      const type = '{:list-items {:repeat :any 0 nil} :string}';
      expect(takes(type, '[1 2 "end"]')).to.equal(true);
      expect(takes(type, '[1 2 3]')).to.equal(false);
    });

    it('a group that can match nothing still ends', () => {
      const type = '{:list-items {:repeat {:group {:repeat :integer 0 nil}} 2 nil}}';
      expect(takes(type, '[]')).to.equal(true);
      expect(takes(type, '[1 2]')).to.equal(true);
    });

    it("a shape's defaults are filled in the items it matched", () => {
      const registry = Schema.compile(
        decode(`%{
          T: {:list-items Line {:repeat Line 0 nil}}
          Line: %shape{sku: :string, qty: %field{type: :integer, default: 1}}
        }`),
        new Registry()
      );
      const conformed = /** @type {DXNList} */ (Schema.conform(decode('[%{sku: "a"} %{sku: "b", qty: 2}]'), registry, 'T'));
      expect(conformed).to.be.instanceOf(DXNList);
      const byName = conformed.items.map((item) =>
        Object.fromEntries(Array.from(/** @type {Map<unknown, unknown>} */ (item), ([k, v]) => [/** @type {DXNKeyword} */ (k).name, v]))
      );
      expect(byName).to.deep.equal([
        { sku: 'a', qty: 1n },
        { sku: 'b', qty: 2n }
      ]);
    });

    it('a repeat or a group stands only where items are counted', () => {
      expect(compileError('{:repeat :integer 0 nil}')).to.include('repeat');
      expect(compileError('{:list-items {:group :integer :string}}')).to.include('group');
      expect(compileError('{:list-items {:repeat :integer 3 2}}')).to.include('repeat');
      expect(compileError('{:list-items {:repeat :integer -1 nil}}')).to.include('repeat');
    });

    it("it guards a named type's recursion, as list-of does", () => {
      expect(() => compiled('{:list-items :string {:repeat T 0 nil}}')).not.to.throw();
    });
  });

  describe('{:tuple-of-all T}', () => {
    it('a tuple of any length, every item a T', () => {
      expect(takes('{:tuple-of-all :integer}', '{}')).to.equal(true);
      expect(takes('{:tuple-of-all :integer}', '{1 2 3}')).to.equal(true);
      expect(takes('{:tuple-of-all :integer}', '{1 "a"}')).to.equal(false);
      expect(takes('{:tuple-of-all :integer}', '[1 2]')).to.equal(false);
    });
  });

  describe('contains', () => {
    it('at least one item is a T', () => {
      const type = '{:refine {:list-of :any} %{contains: :string}}';
      expect(takes(type, '[1 "a"]')).to.equal(true);
      expect(takes(type, '[1 2]')).to.equal(false);
      expect(takes(type, '[]')).to.equal(false);
    });

    it('min-contains and max-contains count the items that are', () => {
      const type = '{:refine {:list-of :any} %{contains: :string, min-contains: 2, max-contains: 3}}';
      expect(takes(type, '[1 "a"]')).to.equal(false);
      expect(takes(type, '["a" 1 "b"]')).to.equal(true);
      expect(takes(type, '["a" "b" "c"]')).to.equal(true);
      expect(takes(type, '["a" "b" "c" "d"]')).to.equal(false);
      expect(takes('{:refine {:list-of :any} %{contains: :string, min-contains: 0}}', '[1]')).to.equal(true);
    });

    it('is checked on sets, tuples, sorted sets and arrays too', () => {
      expect(takes('{:refine {:set-of :any} %{contains: :string}}', '@{1 "a"}')).to.equal(true);
      expect(takes('{:refine {:tuple-of-all :any} %{contains: :string}}', '{1 "a"}')).to.equal(true);
      expect(takes('{:refine {:array-of :any} %{contains: :string}}', '@array[1 "a"]')).to.equal(true);
    });

    it('min-contains or max-contains without contains is refused', () => {
      expect(compileError('{:refine {:list-of :any} %{min-contains: 1}}')).to.include('contains');
      expect(compileError('{:refine {:list-of :any} %{max-contains: 1}}')).to.include('contains');
    });
  });

  describe('unique', () => {
    it('no two items are the same value', () => {
      expect(takes('{:refine {:list-of :any} %{unique: true}}', '[1 2 3]')).to.equal(true);
      expect(takes('{:refine {:list-of :any} %{unique: true}}', '[1 2 1]')).to.equal(false);
      expect(takes('{:refine {:list-of :any} %{unique: false}}', '[1 1]')).to.equal(true);
      expect(takes('{:refine {:array-of :any} %{unique: true}}', '@array[1 1]')).to.equal(false);
    });

    it('values are the same when their canonical forms are: 1 and 1.0 differ', () => {
      expect(takes('{:refine {:list-of :any} %{unique: true}}', '[1 1.0]')).to.equal(true);
      expect(takes('{:refine {:list-of :any} %{unique: true}}', '[%{a: 1} %{"a" => 1}]')).to.equal(true);
    });

    it("unique-by: no two items share that field's value", () => {
      const type = '{:refine {:list-of :any} %{unique-by: :id}}';
      expect(takes(type, '[%{id: 1} %{id: 2}]')).to.equal(true);
      expect(takes(type, '[%{id: 1} %{"id" => 1}]')).to.equal(false);
      expect(takes(type, '[%{id: 1} %{name: "no id"} %{name: "none either"}]')).to.equal(true);
    });
  });

  describe('in a generic', () => {
    it('a parameter stands in list items and in contains alike', () => {
      const registry = Schema.compile(
        decode(`%{
          NonEmpty: {:generic [t] {:list-items t {:repeat t 0 nil}}}
          Tagged: {:generic [t] {:refine {:list-of :any} %{contains: t}}}
          T: %schema{names: {:of NonEmpty :string}, tags: {:of Tagged :integer}}
        }`),
        new Registry()
      );
      expect(() => decode('%T{names: ["a"], tags: ["x" 1]}', { registry })).not.to.throw();
      expect(() => decode('%T{names: [], tags: ["x" 1]}', { registry })).to.throw();
      expect(() => decode('%T{names: ["a"], tags: ["x"]}', { registry })).to.throw();
    });
  });

  describe('refine keys', () => {
    it("min-count and max-count count an array's items too", () => {
      expect(takes('{:refine {:array-of :any} %{min-count: 2}}', '@array[1 2]')).to.equal(true);
      expect(takes('{:refine {:array-of :any} %{max-count: 1}}', '@array[1 2]')).to.equal(false);
    });

    it('an unknown key is refused when the schema compiles', () => {
      expect(compileError('{:refine :string %{min-lenght: 1}}')).to.include('min-lenght');
    });
  });
});
