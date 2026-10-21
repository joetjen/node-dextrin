import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// One materializer per schema, `(schemaName, version, fields)` with
// string-keyed fields, called for every decoded struct of its schema
// whatever the version, its result validated against the latest schema
// (DXNS.md §8). Without one, the latest version comes back as a generic
// `DXNStruct`.
class UserRecord {
  constructor(name, email) {
    this.name = name;
    this.email = email;
  }
}

const V1 = '%{User: %schema{name: :string}}';
const V2 = '%{User: %schema(2){name: :string, email?: :string}}';
const EVENT = '%{Event: %schema{kind: :keyword, user: User}}';

const loaded = (...sources) =>
  sources.reduce((registry, source) => Schema.compile(decode(source), registry), new Registry());

const categoryOf = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return err.category;
  }
  throw new Error('expected a refusal');
};

describe('the materializer', () => {
  describe('without one', () => {
    it('the latest version comes back as a generic struct, at the latest version', () => {
      expect(decode('%User{name: "a"}', { registry: loaded(V1, V2) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a']], 2)
      );
    });

    it("its fields are in the schema's order, and an absent optional field stays absent", () => {
      expect(decode('%User(2){email: "e", name: "a"}', { registry: loaded(V2) })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a'], ['email', 'e']], 2)
      );
    });

    it('and it is written back exactly as it was read', () => {
      const registry = loaded(V2);
      const user = decode('%User(2){name: "a", email: "e"}', { registry });
      expect(encode(user, { registry })).to.equal('%User(2){name:"a",email:"e"}');
    });
  });

  describe('a materializer', () => {
    it("is called with the schema's name, the version and string-keyed fields", () => {
      const calls = [];
      const registry = loaded(V2).putStructMaterializer('User', (name, version, fields) => {
        calls.push([name, version, fields]);
        return { name: fields.name };
      });
      expect(decode('%User(2){name: "a"}', { registry })).to.deep.equal({ name: 'a' });
      expect(calls).to.deep.equal([['User', 2, { name: 'a' }]]);
    });

    it('upgrades an older version, and is called for every version alike', () => {
      const registry = loaded(V1, V2).putStructMaterializer('User', (_name, version, fields) => ({
        email: `v${version}@example.com`,
        ...fields
      }));
      expect(decode('%User(1){name: "a"}', { registry })).to.deep.equal({ email: 'v1@example.com', name: 'a' });
      expect(decode('%User(2){name: "a"}', { registry })).to.deep.equal({ email: 'v2@example.com', name: 'a' });
    });

    it('has its result validated against the latest schema', () => {
      const registry = loaded(V1, V2).putStructMaterializer('User', () => ({ email: 'e' }));
      expect(categoryOf(() => decode('%User(1){name: "a"}', { registry }))).to.equal('schema/materializer');
    });

    it('that throws makes the decode refuse', () => {
      const registry = loaded(V2).putStructMaterializer('User', () => {
        throw new Error('not today');
      });
      expect(categoryOf(() => decode('%User(2){name: "a"}', { registry }))).to.equal('schema/materializer');
    });

    it("runs bottom-up: an outer struct's materializer sees the inner one already built", () => {
      const seen = [];
      const registry = loaded(V2, EVENT)
        .putStructModule('User', UserRecord)
        .putStructMaterializer('User', (_name, _version, fields) => new UserRecord(fields.name, fields.email))
        .putStructMaterializer('Event', (_name, _version, fields) => {
          seen.push(fields.user);
          return fields;
        });
      decode('%Event{kind: :login, user: %User(2){name: "a", email: "e"}}', { registry });
      expect(seen).to.deep.equal([new UserRecord('a', 'e')]);
    });

    it('works the same from binary', () => {
      const registry = loaded(V2).putStructMaterializer('User', (_name, version, fields) => ({ version, ...fields }));
      const bytes = encodeBinary(DXNStruct.positional('User', ['a', 'e'], 2));
      expect(decodeBinary(bytes, { registry })).to.deep.equal({ version: 2, name: 'a', email: 'e' });
    });
  });
});
