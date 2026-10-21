import { expect } from 'chai';
import { decode, encode, decodeBinary, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';

// An application object is encoded the way a struct is (DXNS.md §3,
// §4.7): a field it does not have is absent -- never nil -- and a
// property its schema does not declare is an extra field, as an Elixir
// struct's undeclared keys are (Jan, 2026-10-19).
class UserRecord {
  constructor(name, email) {
    this.name = name;
    if (email !== undefined) this.email = email;
  }
}

const loaded = () =>
  Schema.compile(decode('%{User: %schema(2){name: :string, email?: :string}}'), new Registry()).putStructModule('User', UserRecord);

describe('an application object', () => {
  describe('with an optional field it does not have', () => {
    it('is written without it in text', () => {
      expect(encode(new UserRecord('a'), { registry: loaded() })).to.equal('%User(2){name:"a"}');
    });

    it('and so is one whose property is undefined', () => {
      const user = new UserRecord('a');
      user.email = undefined;
      expect(encode(user, { registry: loaded() })).to.equal('%User(2){name:"a"}');
    });

    it('is refused in binary, which fills every position', () => {
      expect(() => encodeBinary(new UserRecord('a'), { registry: loaded() }))
        .to.throw(DXNError)
        .with.property('category', 'schema/missing-field');
    });

    it('and is written in full when it has it', () => {
      const bytes = encodeBinary(new UserRecord('a', 'a@x'), { registry: loaded() });
      expect(decodeBinary(bytes, { registry: loaded() }).fields.pairs).to.deep.equal([
        ['name', 'a'],
        ['email', 'a@x'],
      ]);
    });
  });

  describe('with a property its schema does not declare', () => {
    it('writes it as an extra field in text', () => {
      const user = new UserRecord('a', 'a@x');
      user.nick = 'b';
      expect(encode(user, { registry: loaded() })).to.equal('%User(2){name:"a",email:"a@x",nick:"b"}');
    });

    it('and in binary, as the trailing tag-215 map', () => {
      const user = new UserRecord('a', 'a@x');
      user.nick = 'b';
      const read = decodeBinary(encodeBinary(user, { registry: loaded() }), { registry: loaded() });
      expect(read.extra).to.deep.equal([['nick', 'b']]);
    });
  });
});
