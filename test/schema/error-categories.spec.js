import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// B9 of `design/implementation-plan.md`: every schema violation carries
// its `DXN.md` §5 category -- decoding text, decoding binary and encoding
// alike -- instead of the `syntax` or `binary` of whatever channel it
// travelled on, or none at all.
const USER = '%{User: %schema(2){name: :string, email?: :string}}';
const loaded = () => Schema.compile(decode(USER), new Registry());

/** @param {() => unknown} fn */
function category(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return /** @type {DXNError} */ (err).category;
  }
  throw new Error('expected an error');
}

describe('schema error categories', () => {
  describe('decoding text', () => {
    it('a missing required field is schema/missing-field', () => {
      expect(category(() => decode('%User{email: "a"}', { registry: loaded() }))).to.equal('schema/missing-field');
    });

    it('and so it is when a newer version is read against the latest', () => {
      expect(category(() => decode('%User(3){email: "a"}', { registry: loaded() }))).to.equal('schema/missing-field');
    });

    it('a value of the wrong type is schema/type-mismatch', () => {
      expect(category(() => decode('%User{name: 1}', { registry: loaded() }))).to.equal('schema/type-mismatch');
    });

    it('and so it is inside another value', () => {
      expect(category(() => decode('[%User{name: 1}]', { registry: loaded() }))).to.equal('schema/type-mismatch');
    });

    it('a positional struct with the wrong item count is schema/field-count', () => {
      expect(category(() => decode('%User(2)["a"]', { registry: loaded() }))).to.equal('schema/field-count');
    });
  });

  describe('decoding binary', () => {
    it('a value of the wrong type is schema/type-mismatch', () => {
      const bytes = encodeBinary(DXNStruct.positional('User', [1n, 'a'], 2));
      expect(category(() => decodeBinary(bytes, { registry: loaded() }))).to.equal('schema/type-mismatch');
    });

    it('a struct with the wrong item count is schema/field-count', () => {
      const bytes = encodeBinary(DXNStruct.positional('User', ['a'], 2));
      expect(category(() => decodeBinary(bytes, { registry: loaded() }))).to.equal('schema/field-count');
    });
  });

  describe('encoding', () => {
    it('a value of the wrong type is schema/type-mismatch', () => {
      const user = DXNStruct.keyed('User', [['name', 1n]]);
      expect(category(() => encode(user, { registry: loaded() }))).to.equal('schema/type-mismatch');
      expect(category(() => encodeBinary(user, { registry: loaded() }))).to.equal('schema/type-mismatch');
    });

    it('a missing required field is schema/missing-field', () => {
      const user = DXNStruct.keyed('User', [['email', 'a']]);
      expect(category(() => encode(user, { registry: loaded() }))).to.equal('schema/missing-field');
    });

    it('a positional struct with the wrong item count is schema/field-count', () => {
      const user = DXNStruct.positional('User', ['a']);
      expect(category(() => encode(user, { registry: loaded() }))).to.equal('schema/field-count');
    });

    it('an extra field shadowing a declared one is schema/shadowed-field', () => {
      const user = DXNStruct.positional('User', ['a', 'b'], null, [['name', 'c']]);
      expect(category(() => encode(user, { registry: loaded() }))).to.equal('schema/shadowed-field');
    });

    it('against a named schema, too', () => {
      expect(category(() => encode(new Map([['name', 1n]]), { registry: loaded(), schema: 'User' }))).to.equal('schema/type-mismatch');
    });
  });

  // nil in an optional field stays strict (Jan, 2026-10-19): a reader
  // refuses it unless the type is nilable, so a writer never puts one
  // where a field is merely absent.
  describe('encoding binary, which fills every position', () => {
    const compiled = (source) => Schema.compile(decode(source), new Registry());

    it('an absent optional field with no default is schema/missing-field', () => {
      const user = decode('%User{name: "a"}', { registry: loaded() });
      expect(category(() => encodeBinary(user, { registry: loaded() }))).to.equal('schema/missing-field');
    });

    it('text leaves it out, so text has nothing to refuse', () => {
      const user = decode('%User{name: "a"}', { registry: loaded() });
      expect(encode(user, { registry: loaded() })).to.equal('%User(2){name:"a"}');
    });

    it('an absent field with a default is written as its default', () => {
      const registry = compiled('%{User: %schema{name: :string, role?: %field{type: :string, default: "guest"}}}');
      const bytes = encodeBinary(DXNStruct.keyed('User', [['name', 'a']], 1), { registry });
      expect(decodeBinary(bytes, { registry }).fields.pairs).to.deep.equal([['name', 'a'], ['role', 'guest']]);
    });

    it('a nilable field written as nil reads back', () => {
      const registry = compiled('%{User: %schema{name: :string, email?: {:nilable :string}}}');
      const bytes = encodeBinary(DXNStruct.keyed('User', [['name', 'a'], ['email', null]], 1), { registry });
      expect(decodeBinary(bytes, { registry }).fields.pairs).to.deep.equal([['name', 'a'], ['email', null]]);
    });
  });

  it("a materializer's rejected value is schema/materializer, whatever was wrong with it", () => {
    const registry = loaded().putStructMaterializer('User', () => DXNStruct.keyed('User', [['name', 1n]]));
    expect(category(() => decode('%User{name: "a"}', { registry }))).to.equal('schema/materializer');
  });
});
