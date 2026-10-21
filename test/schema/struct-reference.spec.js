import { expect } from 'chai';
import { decode, encode, decodeBinary, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';
import DXNDateTime from '../../src/values/date-time.js';

// A value matches only its declared type, and nothing is converted to
// make it match (DXNS.md §7). A field typed `User` accepts only a
// `User` struct; a map is not a struct. A host value always means the
// same DXN type, with or without a schema.
class UserRecord {
  constructor(name) {
    this.name = name;
  }
}

class Other {
  constructor(name) {
    this.name = name;
  }
}

const SCHEMAS = '%{User: %schema{name: :string}, Order: %schema{id: :integer, user: User}}';
const loaded = () => Schema.compile(decode(SCHEMAS), new Registry());

describe('a struct is matched only by a struct', () => {
  describe('decoding', () => {
    it('a struct of the referenced name is accepted', () => {
      expect(() => decode('%Order{id: 1, user: %User{name: "a"}}', { registry: loaded() })).not.to.throw();
    });

    it('a map is refused, however much it looks like the struct', () => {
      expect(() => decode('%Order{id: 1, user: %{name: "a"}}', { registry: loaded() })).to.throw(DXNError);
    });

    it('and so is any other value', () => {
      expect(() => decode('%Order{id: 1, user: "a"}', { registry: loaded() })).to.throw(DXNError);
      expect(() => decode('%Order{id: 1, user: %Other{name: "a"}}', { registry: loaded() })).to.throw(DXNError);
    });
  });

  describe('encoding', () => {
    it('the registered application class is accepted', () => {
      const registry = loaded().putStructModule('User', UserRecord);
      const order = DXNStruct.keyed('Order', [['id', 1n], ['user', new UserRecord('a')]]);
      expect(() => encode(order, { registry })).not.to.throw();
    });

    it('a map is refused', () => {
      const order = DXNStruct.keyed('Order', [['id', 1n], ['user', new Map([['name', 'a']])]]);
      expect(() => encode(order, { registry: loaded() })).to.throw(DXNError);
    });

    it('and so is a class registered for no schema, or for another', () => {
      const registry = loaded().putStructModule('User', UserRecord);
      const order = DXNStruct.keyed('Order', [['id', 1n], ['user', new Other('a')]]);
      expect(() => encode(order, { registry })).to.throw(DXNError);
    });
  });
});

describe('representation is not conversion', () => {
  const rational = () => Schema.compile(decode('%{P: %schema{amount: :rational}}'), new Registry());

  it('a number is a float, never turned into a rational because a field says so', () => {
    const struct = DXNStruct.keyed('P', [['amount', 0.5]]);
    expect(() => encode(struct, { registry: rational() })).to.throw(DXNError);
  });

  it('a native Date always means a datetime in UTC, with or without a schema', () => {
    const at = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
    expect(encode(at)).to.equal('@datetime "2024-01-02T03:04:05Z"');
    expect(decodeBinary(encodeBinary(at))).to.deep.equal(DXNDateTime.fromDate(at));
    const registry = Schema.compile(decode('%{E: %schema{at: :timestamp}}'), new Registry());
    expect(() => encode(DXNStruct.keyed('E', [['at', at]]), { registry })).not.to.throw();
  });
});
