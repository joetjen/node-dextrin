import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// `min-count` and `max-count` on maps, shapes and structs (T674, as
// dextrin's test/schema/count_test.exs): JSON Schema's minProperties and
// maxProperties, counting the entries present.
describe('min-count and max-count on maps, shapes and structs', () => {
  /** @param {string} text @returns {any} */
  const registry = (text) => Schema.compile(decode(text), new Registry());

  /** @param {any} r @param {string} name @param {string} text */
  const takes = (r, name, text) => {
    try {
      return Schema.check(decode(text), r, name);
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  it('a map counts its entries', () => {
    const r = registry('%{M: {:refine {:map-of :string :integer} %{min-count: 1 max-count: 2}}}');
    expect(takes(r, 'M', '%{}')).to.equal(false);
    expect(takes(r, 'M', '%{"a" => 1}')).to.equal(true);
    expect(takes(r, 'M', '%{"a" => 1 "b" => 2}')).to.equal(true);
    expect(takes(r, 'M', '%{"a" => 1 "b" => 2 "c" => 3}')).to.equal(false);
  });

  it('a shape counts the fields present and its extras', () => {
    const r = registry('%{S: {:refine %shape{a?: :integer b?: :integer} %{min-count: 1 max-count: 2}}}');
    expect(takes(r, 'S', '%{}')).to.equal(false);
    expect(takes(r, 'S', '%{a: 1}')).to.equal(true);
    expect(takes(r, 'S', '%{a: 1 b: 2 "c" => 3}')).to.equal(false);
  });

  it('an ordered map counts as a map does', () => {
    const r = registry('%{M: {:refine :ordered-map %{max-count: 1}}}');
    expect(takes(r, 'M', '@ordered %{a: 1}')).to.equal(true);
    expect(takes(r, 'M', '@ordered %{a: 1 b: 2}')).to.equal(false);
  });

  it('a struct counts its fields present and its extras', () => {
    const r = registry(`
      %{
        P: %schema{a?: :integer b?: :integer}
        Holder: %schema{p: {:refine P %{min-count: 1}}}
      }`);
    expect(() => decode('%Holder{p: %P{a: 1}}', { registry: r })).not.to.throw();
    expect(() => decode('%Holder{p: %P{}}', { registry: r })).to.throw();
  });

  it('contains and unique still apply to collections only', () => {
    const r = registry('%{M: {:refine :map %{unique: true}}}');
    expect(takes(r, 'M', '%{"a" => 1}')).to.equal(false);
  });
});
