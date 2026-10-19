import { expect } from 'chai';
import { canonical, decode, decodeBinary, encode, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// A struct guarantees its declared fields and may carry more (DXN.md
// §1.2, §2.3, §4.7). Extra fields are entries in text -- after the items
// of a positional struct -- and one trailing tag-215 map in binary. An
// extra never shadows a declared field, its key follows the map-key
// rule, and `strict: true` refuses extras on a schema-backed struct.
const USER = '%{User: %schema(2){name: :string, email?: :string}}';
const loaded = () => Schema.compile(decode(USER), new Registry());

const categoryOf = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return err.category;
  }
  throw new Error('expected a refusal');
};

describe('extra fields', () => {
  describe('a struct with no schema', () => {
    it("keeps the entries after a positional struct's items as extra fields", () => {
      const value = decode('%P[1 2 nick: "b" 3 => :x]', { trusted: false });
      expect(value.fields).to.deep.equal({ type: 'positional', values: [1n, 2n] });
      expect(value.extra.map(([k]) => k)).to.deep.equal(['nick', 3n]);
    });

    it('keeps a keyed entry whose key is not a name as an extra field', () => {
      const value = decode('%P{x: 1, 3 => "y"}');
      expect(value.fields).to.deep.equal({ type: 'keyed', pairs: [['x', 1n]] });
      expect(value.extra).to.deep.equal([[3n, 'y']]);
    });

    it('is written back with its extra fields, in text', () => {
      const value = decode('%P[1 2 nick: "b" 3 => :x]');
      expect(encode(value)).to.equal('%P[1,2,nick:"b",3=>:x]');
      expect(canonical(value)).to.equal('%P[1 2 nick: "b" 3 => :x]');
    });

    it('and in binary, as one trailing tag-215 map', () => {
      const value = DXNStruct.positional('P', [1n], null, [['nick', 'b']]);
      expect(decodeBinary(encodeBinary(value))).to.deep.equal(value);
    });

    it('refuses an item after an entry', () => {
      expect(categoryOf(() => decode('%P[1 nick: "b" 2]'))).to.equal('syntax');
    });

    it('refuses an extra field whose key is not a map key', () => {
      expect(categoryOf(() => decode('%P[1 1.5 => 2]'))).to.equal('key/not-allowed');
    });
  });

  describe('a struct with a schema', () => {
    it('keeps a named field its schema does not declare as an extra field', () => {
      expect(decode('%User(2){name: "a", nick: "b"}', { registry: loaded() })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a']], 2, [['nick', 'b']])
      );
    });

    it("and the entries after a positional struct's items", () => {
      expect(decode('%User(2)["a" "e" nick: "b"]', { registry: loaded() })).to.deep.equal(
        DXNStruct.keyed('User', [['name', 'a'], ['email', 'e']], 2, [['nick', 'b']])
      );
    });

    it('hands its extra fields to the materializer with the declared ones', () => {
      const registry = loaded().putStructMaterializer('User', (_name, _version, fields) => fields);
      expect(decode('%User(2){name: "a", nick: "b"}', { registry })).to.deep.equal({ name: 'a', nick: 'b' });
    });

    it('carries them through binary in the tag-215 item', () => {
      const registry = loaded();
      const value = DXNStruct.keyed('User', [['name', 'a'], ['email', 'e']], 2, [['nick', 'b']]);
      expect(decodeBinary(encodeBinary(value, { registry }), { registry })).to.deep.equal(value);
    });

    it('refuses an extra field that shadows a declared one, in text', () => {
      expect(categoryOf(() => decode('%User(2){name: "a", "name" => "b"}', { registry: loaded() }))).to.equal(
        'schema/shadowed-field'
      );
    });

    it('and in binary', () => {
      const bytes = encodeBinary(DXNStruct.positional('User', ['a', 'e'], 2, [['name', 'b']]));
      expect(categoryOf(() => decodeBinary(bytes, { registry: loaded() }))).to.equal('schema/shadowed-field');
    });

    it('and on the way out', () => {
      const shadowing = DXNStruct.keyed('User', [['name', 'a']], 2, [['name', 'b']]);
      expect(() => encode(shadowing, { registry: loaded() })).to.throw(DXNError);
    });

    it('refuses every extra field when the decode is strict', () => {
      expect(
        categoryOf(() => decode('%User(2){name: "a", nick: "b"}', { registry: loaded(), strict: true }))
      ).to.equal('schema/undeclared-field');
      expect(decode('%User(2){name: "a"}', { registry: loaded(), strict: true })).to.be.instanceOf(DXNStruct);
    });
  });
});
