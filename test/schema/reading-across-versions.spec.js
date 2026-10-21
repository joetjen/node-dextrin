import { expect } from 'chai';
import { decode, decodeBinary, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// A struct is read according to the version it was written with, set
// against the versions loaded (DXNS.md §8).
const V1 = '%{User: %schema{name: :string}}';
const V2 = '%{User: %schema(2){name: :string, email?: :string}}';
const V3 = '%{User: %schema(3){name: :string, email?: :string, nick?: :string}}';

const loaded = (...sources) =>
  sources.reduce((registry, source) => Schema.compile(decode(source), registry), new Registry());

const upgrading = (registry) =>
  registry.putStructMaterializer('User', (_name, version, fields) => ({ ...fields, upgradedFrom: version }));

const categoryOf = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return err.category;
  }
  throw new Error('expected a refusal');
};

const binary = (struct) => encodeBinary(struct);

describe('reading across versions', () => {
  describe("the writer's version is the latest loaded", () => {
    it('is read with exactly that schema', () => {
      expect(decode('%User(3){name: "a"}', { registry: loaded(V2, V3) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a']], 3)
      );
    });

    it('and its item count is exact', () => {
      expect(() => decode('%User(3)["a"]', { registry: loaded(V2, V3) })).to.throw(DXNError);
    });
  });

  describe("the writer's version is older than the latest loaded", () => {
    it('goes to the materializer, with the fields its own schema names', () => {
      expect(decode('%User(2){name: "a"}', { registry: upgrading(loaded(V2, V3)) })).to.deep.equal({
        name: 'a',
        upgradedFrom: 2
      });
    });

    it('and without one is refused, rather than read as if it were the latest', () => {
      expect(categoryOf(() => decode('%User(2){name: "a"}', { registry: loaded(V2, V3) }))).to.equal(
        'schema/no-materializer'
      );
    });

    it('and the same goes for binary', () => {
      const bytes = binary(DXNStruct.positional('User', ['a', null], 2));
      expect(categoryOf(() => decodeBinary(bytes, { registry: loaded(V2, V3) }))).to.equal('schema/no-materializer');
    });
  });

  it("an older version that is not loaded is refused, even with a materializer, which would have no field names", () => {
    const registry = upgrading(loaded(V2, V3));
    expect(categoryOf(() => decode('%User(1){name: "a"}', { registry }))).to.equal('schema/unknown-version');
    const bytes = binary(DXNStruct.positional('User', ['a'], 1));
    expect(categoryOf(() => decodeBinary(bytes, { registry }))).to.equal('schema/unknown-version');
  });

  describe("the writer's version is newer than anything loaded", () => {
    it('is read against the latest loaded, matching text by name and keeping the rest as extras', () => {
      expect(decode('%User(3){nick: "n", name: "a"}', { registry: loaded(V1, V2) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a']], 2, [['nick', 'n']])
      );
    });

    it('and a field the latest requires must still be there', () => {
      expect(() => decode('%User(3){email: "e"}', { registry: loaded(V1, V2) })).to.throw(DXNError);
    });

    it('and binary assumes positions are unchanged, dropping the items beyond its own', () => {
      const bytes = binary(DXNStruct.positional('User', ['a', 'e', 'n'], 3));
      expect(decodeBinary(bytes, { registry: loaded(V1, V2) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a'], ['email', 'e']], 2)
      );
    });

    it('and fewer items leave the optional fields absent', () => {
      const bytes = binary(DXNStruct.positional('User', ['a'], 3));
      expect(decodeBinary(bytes, { registry: loaded(V1, V2) })).to.deep.equal(DXNStruct.keyed('User', [['name', 'a']], 2));
    });

    // The documented risk: a newer version that reordered its fields is
    // read into the wrong ones, without an error, whenever the types agree.
    it('and a reordering is misread without an error when the types agree', () => {
      const bytes = binary(DXNStruct.positional('User', ['e', 'a'], 3));
      expect(decodeBinary(bytes, { registry: loaded(V1, V2) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'e'], ['email', 'a']], 2)
      );
    });
  });
});
