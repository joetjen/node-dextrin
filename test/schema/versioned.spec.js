import { expect } from 'chai';
import { canonical, decode, encode, DXNError, Registry, Schema } from '../../src/dextrin.js';

// Each `.dxns` document describes one version of a schema, written
// `%schema(N){field: type, ...}` -- the body lists the fields in order,
// and that order is the positional order. Schemas are kept by name and
// version (DXNS.md §8).
const compiled = (text, registry = new Registry()) => Schema.compile(decode(text), registry);

const fieldNames = (registry, name, version) =>
  registry.fetchStructSchema(name, version)?.compiled.fieldNames();

const categoryOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.category;
  }
  throw new Error('expected a refusal');
};

describe('versioned schemas', () => {
  describe('the schema body', () => {
    it('lists the fields directly, in order', () => {
      const registry = compiled('%{User: %schema(3){name: :string, email: :string, id?: :uuid}}');
      expect(fieldNames(registry, 'User', 3)).to.deep.equal(['name', 'email', 'id']);
    });

    it('with no header is version 1', () => {
      const registry = compiled('%{Point: %schema{x: :integer, y: :integer}}');
      expect(registry.fetchStructSchema('Point', 1)?.compiled.version).to.equal(1);
    });

    it("keeps a field's metadata in %field{}", () => {
      const registry = compiled('%{P: %schema{x: %field{type: :integer, default: 0, description: "x"}}}');
      const field = registry.fetchStructSchema('P', 1)?.compiled.fields[0];
      expect(field?.name).to.equal('x');
      expect(field?.default).to.equal(0n);
      expect(field?.description).to.equal('x');
    });

    it('refuses a field named twice', () => {
      expect(categoryOf(() => compiled('%{P: %schema{x: :integer, x: :string}}'))).to.equal('schema/compile');
    });

    it('refuses the old fields: form, which is now a field of no known type', () => {
      expect(categoryOf(() => compiled('%{P: %schema{fields: @ordered %{x: :integer}}}'))).to.equal('schema/compile');
    });

    // A schema in Dextrin 0.1's syntax says what changed, rather than that
    // a field has no known type -- as the reference.
    it('says a 0.1 schema is one, and what a schema is written as now', () => {
      for (const old of [
        '%{P: %schema{fields: @ordered %{x: :integer}}}',
        '%{P: %schema{closed: true, x: :integer}}',
        '%{P: %schema{forbidden: [y], x: :integer}}',
      ]) {
        try {
          compiled(old);
        } catch (err) {
          expect(err.category).to.equal('schema/compile');
          expect(err.message).to.include('Dextrin 0.1').and.to.include('%schema(N){field: type, ...}');
          continue;
        }
        throw new Error(`expected ${old} to be refused`);
      }
    });

    it('and a schema may still have fields so named', () => {
      expect(() => compiled('%{P: %schema{fields: {:list-of :string}, closed: :boolean, forbidden?: :string}}')).not.to.throw();
    });
  });

  describe('versions', () => {
    it('load from separate documents and are kept apart', () => {
      const registry = compiled(
        '%{User: %schema(2){name: :string, email: :string}}',
        compiled('%{User: %schema(1){name: :string}}')
      );
      expect(fieldNames(registry, 'User', 1)).to.deep.equal(['name']);
      expect(fieldNames(registry, 'User', 2)).to.deep.equal(['name', 'email']);
    });

    it('without a version, the latest is answered', () => {
      const registry = compiled(
        '%{User: %schema(1){name: :string}}',
        compiled('%{User: %schema(2){name: :string, email: :string}}')
      );
      expect(registry.fetchStructSchema('User')?.compiled.version).to.equal(2);
    });

    it('loading the same name and version twice is an error', () => {
      const registry = compiled('%{User: %schema(1){name: :string}}');
      expect(categoryOf(() => compiled('%{User: %schema(1){name: :string}}', registry))).to.equal(
        'schema/duplicate-version'
      );
    });

    it('replace swaps a loaded version', () => {
      const registry = compiled('%{User: %schema(1){name: :string}}');
      const replacement = compiled('%{User: %schema(1){name: :string, nick?: :string}}').fetchStructSchema('User', 1)
        ?.compiled;
      const swapped = registry.replaceStructSchema('User', replacement);
      expect(fieldNames(swapped, 'User', 1)).to.deep.equal(['name', 'nick']);
    });

    it('and refuses a version that is not loaded, so a typo never adds one', () => {
      const replacement = compiled('%{User: %schema(4){name: :string}}').fetchStructSchema('User', 4)?.compiled;
      expect(categoryOf(() => new Registry().replaceStructSchema('User', replacement))).to.equal('schema/not-loaded');
    });
  });

  describe('a struct literal', () => {
    it('carries the version it was written with', () => {
      expect(decode('%P(3){x: 1}').version).to.equal(3);
      expect(decode('%P(3)[1]').version).to.equal(3);
    });

    it('has none when it was written without one', () => {
      expect(decode('%P{x: 1}').version).to.equal(null);
    });

    it('is written back with its version', () => {
      const value = decode('%P(3){x: 1}');
      expect(encode(value)).to.equal('%P(3){x:1}');
      expect(canonical(value)).to.equal('%P(3){x: 1}');
    });

    it('refuses a version that is not a positive integer', () => {
      expect(() => decode('%P(0){x: 1}')).to.throw(DXNError);
      expect(() => decode('%P(-1){x: 1}')).to.throw(DXNError);
    });
  });
});
