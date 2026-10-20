import { expect } from 'chai';
import { decode, Registry, Schema, DXNDecimal, DXNTuple } from '../../src/dextrin.js';

// `{:tagged name T}`, the superset's group 7, as dextrin bdb20b3
// (design/schema-superset.md, Jan, 2026-10-20): a custom tag of that name
// whose value is a `T` -- YAML's local tags, MessagePack's ext types,
// CBOR's tags.
describe('schema {:tagged name T}', () => {
  class Money {
    /** @param {unknown} amount @param {string} currency */
    constructor(amount, currency) {
      this.amount = amount;
      this.currency = currency;
    }
  }

  const schemas = '%{Price: {:tagged acme.money {:tuple-of :decimal :string}}}';

  const registry = () => Schema.compile(decode(schemas), new Registry());

  /**
   * Whether `value` is a `Price` in `r`; only a schema refusal answers false.
   * @param {unknown} value @param {import('../../src/registry.cjs')} [r]
   */
  const takes = (value, r = registry()) => {
    try {
      return Schema.check(value, r, 'Price');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  /** @param {string} text @param {import('../../src/registry.cjs')} [r] */
  const check = (text, r) => takes(decode(text), r);

  it('a custom tag of that name whose value is a T', () => {
    expect(check('@acme.money {9.99M "EUR"}')).to.equal(true);
    expect(check('@acme.money {"9.99" "EUR"}')).to.equal(false);
    expect(check('@acme.cost {9.99M "EUR"}')).to.equal(false);
    expect(check('{9.99M "EUR"}')).to.equal(false);
  });

  it('the name may be written as a symbol, a keyword or a string', () => {
    for (const name of ['acme.money', ':acme.money', '"acme.money"']) {
      const r = Schema.compile(decode(`%{Price: {:tagged ${name} :any}}`), new Registry());
      expect(check('@acme.money 1', r), name).to.equal(true);
    }
  });

  it("an application's value is checked as its registered tag encoder writes it", () => {
    const r = registry().putTagEncoder(Money, 'acme.money', (/** @type {any} */ m) => new DXNTuple([m.amount, m.currency]));

    expect(takes(new Money(DXNDecimal.fromString('9.99'), 'EUR'), r)).to.equal(true);
    expect(takes(new Money(9.99, 'EUR'), r)).to.equal(false);
    expect(takes(new Money(DXNDecimal.fromString('1'), 'EUR'), registry())).to.equal(false);
  });

  it("a built-in tag's name is no custom tag's", () => {
    expect(() => Schema.compile(decode('%{T: {:tagged uuid :string}}'), new Registry()))
      .to.throw(/uuid/)
      .with.property('category', 'schema/compile');
  });

  it("it guards a named type's recursion", () => {
    expect(() => Schema.compile(decode('%{Node: {:tagged acme.node {:list-of Node}}}'), new Registry())).not.to.throw();
  });
});
