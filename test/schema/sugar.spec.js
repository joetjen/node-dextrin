import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// Sugar, the superset's group 9, as dextrin d1b050a
// (design/schema-superset.md, Jan, 2026-10-20): protobuf's and MongoDB's
// sized numbers, `:number`, `{:const v}` and `{:if I T E}`. Each says
// nothing a longer form does not; DXN.md §4.1 gives the form each stands
// for.
describe('schema sugar', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /**
   * Whether the value written `text` is a `type`; only a schema refusal
   * answers false.
   * @param {string} type @param {string} text
   */
  const takes = (type, text) => {
    const registry = compiled(type);
    try {
      return Schema.check(decode(text), registry, 'T');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  it('the sized integers are their ranges', () => {
    expect(takes(':int32', '-2147483648')).to.equal(true);
    expect(takes(':int32', '2147483648')).to.equal(false);
    expect(takes(':int64', '9223372036854775807')).to.equal(true);
    expect(takes(':int64', '-9223372036854775809')).to.equal(false);
    expect(takes(':uint32', '4294967295')).to.equal(true);
    expect(takes(':uint32', '-1')).to.equal(false);
    expect(takes(':uint64', '18446744073709551615')).to.equal(true);
    expect(takes(':uint64', '18446744073709551616')).to.equal(false);
    expect(takes(':int32', '1.0')).to.equal(false);
  });

  it(':float32 is a float single precision holds', () => {
    expect(takes(':float32', '1.5')).to.equal(true);
    expect(takes(':float32', '0.1')).to.equal(false);
    expect(takes(':float32', '1')).to.equal(false);
  });

  it(':number is any number', () => {
    for (const text of ['1', '1.5', '1.5M', '1/3', 'NaN']) expect(takes(':number', text), text).to.equal(true);
    expect(takes(':number', '"1"')).to.equal(false);
  });

  it('{:const v} is the one value v', () => {
    expect(takes('{:const "v1"}', '"v1"')).to.equal(true);
    expect(takes('{:const "v1"}', '"v2"')).to.equal(false);
    expect(takes('{:const %{a: 1}}', '%{a: 1}')).to.equal(true);
  });

  it('{:if I T E}: a value that is an I is checked as a T, any other as an E', () => {
    const type = '{:if :integer {:refine :integer %{min: 0}} :string}';
    expect(takes(type, '5')).to.equal(true);
    expect(takes(type, '-5')).to.equal(false);
    expect(takes(type, '"x"')).to.equal(true);
    expect(takes(type, '1.5')).to.equal(false);
  });

  it('{:if I T} leaves a value that is no I alone', () => {
    const type = '{:if :integer {:refine :integer %{min: 0}}}';
    expect(takes(type, '1.5')).to.equal(true);
    expect(takes(type, '-5')).to.equal(false);
  });

  it('{:if} is no guard: it checks the same value', () => {
    expect(() => Schema.compile(decode('%{A: {:if :integer A :string}}'), new Registry()))
      .to.throw()
      .with.property('category', 'schema/compile');
  });
});
