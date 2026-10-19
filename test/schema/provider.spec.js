import { expect } from 'chai';
import Schema from '../../src/schema.cjs';
import Registry from '../../src/registry.js';
import { decode, encode } from '../../src/dextrin.js';
import DXNDecimal from '../../src/values/decimal.js';
import { fieldsOf } from '../support/decoded-fields.js';

class Money {
  /** @param {unknown} amount @param {unknown} currency */
  constructor(amount, currency) {
    this.amount = amount;
    this.currency = currency;
  }
}

/** @type {import('../../src/schema/provider.cjs').DXNSchemaProvider} */
const moneyProvider = {
  dxnSchema: () =>
    '%{ Money: %schema{ amount: :decimal, currency: {:enum :usd :eur :gbp} } }',
  dxnSchemaName: () => 'Money',
  dxnClass: () => Money,
  dxnMaterialize: (_name, _version, fields) => new Money(fields.amount, fields.currency)
};

describe('schema/provider', () => {
  it('registerProvider compiles the schema, associates the class, and registers the materializer', () => {
    const registry = Schema.registerProvider(new Registry(), moneyProvider);
    expect(registry.fetchStructModule('Money')).to.equal(Money);
    expect(registry.fetchStructSchema('Money')).to.not.equal(undefined);
    expect(registry.fetchMaterializer('Money')).to.equal(moneyProvider.dxnMaterialize);
  });

  it('decode materializes into the real class via the registered materializer', () => {
    const registry = Schema.registerProvider(new Registry(), moneyProvider);
    const value = decode('%Money{amount: 19.99M, currency: :usd}', { registry });
    expect(value).to.be.instanceOf(Money);
    expect(value.amount.toString()).to.equal('19.99');
  });

  it('encode serializes a real class instance directly, no manual DXNStruct wrapping needed', () => {
    const registry = Schema.registerProvider(new Registry(), moneyProvider);
    const money = new Money(DXNDecimal.fromString('19.99'), Symbol.for('usd'));
    expect(encode(money, { registry })).to.equal('%Money(1){amount:19.99M,currency::usd}');
  });

  it('folds every named type/schema the provider document defines, not only dxnSchemaName()\'s own', () => {
    /** @type {import('../../src/schema/provider.cjs').DXNSchemaProvider} */
    const provider = {
      dxnSchema: () => '%{ Currency: {:enum :usd :eur}, Money: %schema{ amount: :decimal, currency: Currency } }',
      dxnSchemaName: () => 'Money',
      dxnClass: () => Money
    };
    const registry = Schema.registerProvider(new Registry(), provider);
    expect(registry.fetchTypeAlias('Currency')).to.not.equal(undefined);
  });

  it('works with no materializer at all, falling back to the generic struct', () => {
    /** @type {import('../../src/schema/provider.cjs').DXNSchemaProvider} */
    const provider = {
      dxnSchema: () => '%{ Point: %schema{ x: :integer } }',
      dxnSchemaName: () => 'Point',
      dxnClass: () => class Point {}
    };
    const registry = Schema.registerProvider(new Registry(), provider);
    const value = decode('%Point{x: 1}', { registry });
    expect(fieldsOf(value)).to.deep.equal({ x: 1n });
  });

  it('throws a specific error when dxnSchemaName() names an entry the document does not define', () => {
    /** @type {import('../../src/schema/provider.cjs').DXNSchemaProvider} */
    const mismatched = {
      dxnSchema: () => '%{ Foo: %schema{ x: :integer } }',
      dxnSchemaName: () => 'Bar', // typo — document defines "Foo", not "Bar"
      dxnClass: () => class Bar {}
    };
    expect(() => Schema.registerProvider(new Registry(), mismatched)).to.throw(/Bar/);
  });

  it('composes across repeated registerProvider calls the same way compile does', () => {
    /** @type {import('../../src/schema/provider.cjs').DXNSchemaProvider} */
    const other = {
      dxnSchema: () => '%{ Widget: %schema{ n: :integer } }',
      dxnSchemaName: () => 'Widget',
      dxnClass: () => class Widget {}
    };
    let registry = Schema.registerProvider(new Registry(), moneyProvider);
    registry = Schema.registerProvider(registry, other);
    expect(registry.fetchStructSchema('Money')).to.not.equal(undefined);
    expect(registry.fetchStructSchema('Widget')).to.not.equal(undefined);
  });
});
