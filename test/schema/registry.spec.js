import { expect } from 'chai';
import Registry from '../../src/registry.js';

describe('Registry', () => {
  it('defaults to trusted: true', () => {
    expect(new Registry().trusted).to.equal(true);
  });

  it('every put* method returns a new Registry, never mutates the receiver', () => {
    const original = new Registry();
    const updated = original.putTrusted(false);
    expect(original.trusted).to.equal(true);
    expect(updated.trusted).to.equal(false);
    expect(updated).to.not.equal(original);
  });

  it('putTag/fetchTag round-trip a decoder by name', () => {
    const decoder = (v) => ({ wrapped: v });
    const registry = new Registry().putTag('my-tag', decoder);
    expect(registry.fetchTag('my-tag')).to.equal(decoder);
    expect(registry.fetchTag('unknown')).to.equal(undefined);
  });

  it('putTagEncoder/fetchTagEncoder round-trip an encoder by class', () => {
    class Foo {}
    const encoder = (v) => v;
    const registry = new Registry().putTagEncoder(Foo, 'foo', encoder);
    expect(registry.fetchTagEncoder(Foo)).to.deep.equal(['foo', encoder]);
  });

  it('putStructSchema/fetchStructSchema round-trip a compiled schema by name', () => {
    const compiled = { name: 'Point' };
    const registry = new Registry().putStructSchema('Point', /** @type {any} */ (compiled));
    const found = registry.fetchStructSchema('Point');
    expect(found?.compiled).to.equal(compiled);
    expect(found?.registry).to.equal(registry);
  });

  it('fetchStructSchema falls back to the resolver on a miss, caching the result', () => {
    const compiled = { name: 'Lazy' };
    let calls = 0;
    const registry = new Registry().putResolver((name) => {
      calls += 1;
      return name === 'Lazy' ? /** @type {any} */ (compiled) : undefined;
    });

    const found = registry.fetchStructSchema('Lazy');
    expect(found?.compiled).to.equal(compiled);
    expect(calls).to.equal(1);

    // second lookup against the *returned* (cached) registry shouldn't re-invoke the resolver
    const found2 = found?.registry.fetchStructSchema('Lazy');
    expect(found2?.compiled).to.equal(compiled);
    expect(calls).to.equal(1);
  });

  it('fetchStructSchema returns undefined for an unknown name with no resolver', () => {
    expect(new Registry().fetchStructSchema('Nope')).to.equal(undefined);
  });

  it('putStructModule/fetchStructModule and the reverse lookup round-trip', () => {
    class Point {}
    const registry = new Registry().putStructModule('Point', Point);
    expect(registry.fetchStructModule('Point')).to.equal(Point);
    expect(registry.fetchSchemaNameForModule(Point)).to.equal('Point');
    expect(registry.fetchSchemaNameForModule(class Other {})).to.equal(undefined);
  });

  it('putTypeAlias/fetchTypeAlias round-trip a named type', () => {
    const typeExpr = { form: 'primitive', name: 'integer' };
    const registry = new Registry().putTypeAlias('Age', typeExpr);
    expect(registry.fetchTypeAlias('Age')).to.equal(typeExpr);
  });

  it('putStructMaterializer/fetchMaterializer round-trip a materializer', () => {
    const materializer = (fields) => fields;
    const registry = new Registry().putStructMaterializer('Point', materializer);
    expect(registry.fetchMaterializer('Point')).to.equal(materializer);
  });
});
