import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';
import DXNKeyword from '../../src/values/keyword.js';
import DXNList from '../../src/values/list.js';

// `%shape{...}`, `{:case field %{...}}`, guarded recursion and generics,
// as dextrin c8c5a75, 66c05e5 and 1434e79 (design/shapes-and-case.md,
// Jan, 2026-10-20): a shape is a named, unversioned map type that fills
// its defaults; a case chooses a field's type by a sibling field's value;
// named types see their siblings and may recurse through a guard;
// `check` and `conform` check a value without decoding it.
describe('schema shapes, case, recursion and generics', () => {
  const EVENTS = `%{
    Envelope: %schema{
      type: :string
      payload: {:case type %{"placed" => OrderPlaced, "cancelled" => OrderCancelled, :else => :any}}
    }
    Strict: %schema{type: :string, payload: {:case type %{"placed" => OrderPlaced}}}
    Nested: %schema{type: :string, payloads: {:list-of {:nilable {:case type %{"placed" => OrderPlaced}}}}}
    Holder: %schema{v: OrderPlaced}
    OrderPlaced: %shape{
      order_id: :integer
      currency: %field{type: :string, default: "EUR"}
      gift?: :boolean
    }
    OrderCancelled: %shape{reason: CancelReason, email?: :never}
    CancelReason: {:enum :customer_request :out_of_stock}
  }`;

  /** @param {string} [text] */
  const registry = (text = EVENTS) => Schema.compile(decode(text), new Registry());

  /** The category a compile refuses with, or null. @param {string} text */
  const compileCategory = (text) => {
    try {
      registry(text);
      return null;
    } catch (err) {
      return /** @type {any} */ (err).category;
    }
  };

  /** Every map key by its name, so a test reads the same whatever keys came back. @param {unknown} value @returns {any} */
  const named = (value) => {
    if (value instanceof Map) {
      return Object.fromEntries(Array.from(value, ([k, v]) => [k instanceof DXNKeyword ? k.name : typeof k === 'symbol' ? Symbol.keyFor(k) : k, named(v)]));
    }
    if (value instanceof DXNList) return value.items.map(named);
    return value;
  };

  /** A decode's struct fields by name, or the category it refuses with. @param {string} text @param {object} [opts] */
  const decoded = (text, opts = {}) => {
    try {
      const struct = /** @type {any} */ (decode(text, { registry: registry(), ...opts }));
      return Object.fromEntries(struct.fields.pairs.map(([k, v]) => [k, named(v)]));
    } catch (err) {
      return /** @type {any} */ (err).category;
    }
  };

  describe('a shape-typed field', () => {
    it('takes a plain map whose fields match', () => {
      expect(decoded('%Holder{v: %{order_id: 1, currency: "USD"}}').v).to.deep.equal({ order_id: 1n, currency: 'USD' });
    });

    it("fills a missing field's default", () => {
      expect(decoded('%Holder{v: %{order_id: 1}}').v).to.deep.equal({ order_id: 1n, currency: 'EUR' });
    });

    it('refuses a map missing a required field, or a field of the wrong type', () => {
      expect(decoded('%Holder{v: %{currency: "USD"}}')).to.equal('schema/type-mismatch');
      expect(decoded('%Holder{v: %{order_id: "1"}}')).to.equal('schema/type-mismatch');
    });

    it('matches a field by any spelling of its name, and refuses it given twice', () => {
      expect(decoded('%Holder{v: %{"order_id" => 1}}').v.order_id).to.equal(1n);
      expect(decoded('%Holder{v: %{order_id: 1, "order_id" => 2}}')).to.equal('schema/type-mismatch');
    });

    it('keeps an extra key, and a strict decode refuses it', () => {
      expect(decoded('%Holder{v: %{order_id: 1, note: "x"}}').v.note).to.equal('x');
      expect(decoded('%Holder{v: %{order_id: 1, note: "x"}}', { strict: true })).to.equal('schema/type-mismatch');
    });

    it('refuses a struct, however much it looks like the map', () => {
      expect(decoded('%Holder{v: %OrderPlaced{order_id: 1}}')).to.equal('schema/type-mismatch');
    });

    it('an optional field typed :never must stay absent', () => {
      expect(decoded('%Envelope{type: "cancelled", payload: %{reason: :out_of_stock}}')).to.be.an('object');
      expect(decoded('%Envelope{type: "cancelled", payload: %{reason: :out_of_stock, email: "a"}}')).to.equal('schema/type-mismatch');
    });
  });

  describe('{:case field %{...}}', () => {
    it("chooses the type by the sibling field's value", () => {
      expect(decoded('%Envelope{type: "placed", payload: %{order_id: 1}}').payload.currency).to.equal('EUR');
      expect(decoded('%Envelope{type: "placed", payload: %{reason: :out_of_stock}}')).to.equal('schema/type-mismatch');
    });

    it('takes :else for any other value', () => {
      expect(decoded('%Envelope{type: "other", payload: 42}').payload).to.equal(42n);
    });

    it('refuses a value no key and no :else takes', () => {
      expect(decoded('%Strict{type: "other", payload: %{order_id: 1}}')).to.equal('schema/type-mismatch');
    });

    it("works anywhere in a field's type", () => {
      expect(decoded('%Nested{type: "placed", payloads: [%{order_id: 1} nil]}').payloads).to.deep.equal([{ order_id: 1n, currency: 'EUR' }, null]);
    });

    it('naming no field of its schema is a compile error', () => {
      expect(compileCategory('%{S: %schema{a: :string, b: {:case c %{1 => :any}}}}')).to.equal('schema/compile');
    });
  });

  describe('compiling', () => {
    it('a shape has no version and lists its fields by name', () => {
      expect(compileCategory('%{S: %shape(2){a: :string}}')).to.equal('schema/compile');
      expect(compileCategory('%{S: %shape[:string]}')).to.equal('schema/compile');
    });

    it('a named type may refer to a sibling, whatever the order', () => {
      expect(compileCategory('%{A: {:list-of B}, B: {:list-of C}, C: :integer}')).to.equal(null);
    });

    it('a named type may refer to itself through a field or a collection', () => {
      expect(compileCategory('%{A: {:list-of B}, B: {:nilable A}}')).to.equal(null);
      expect(compileCategory('%{Comment: %shape{text: :string, replies: {:list-of Comment}}}')).to.equal(null);
    });

    it('a named type that reaches itself unguarded is refused', () => {
      expect(compileCategory('%{A: {:nilable A}}')).to.equal('schema/compile');
      expect(compileCategory('%{A: {:any-of B :integer}, B: {:not A}}')).to.equal('schema/compile');
    });
  });

  describe('recursive types', () => {
    const RECURSIVE = `%{
      Thread: %schema{root: Comment, value: JsonValue}
      Comment: %shape{text: :string, likes: %field{type: :integer, default: 0}, replies?: {:list-of Comment}}
      JsonValue: {:any-of :nil :boolean :integer :float :string {:list-of JsonValue} {:map-of :string JsonValue}}
    }`;

    it('checks every level, and fills defaults at every level', () => {
      const r = registry(RECURSIVE);
      const thread = /** @type {any} */ (decode('%Thread{root: %{text: "a", replies: [%{text: "b", replies: [%{text: "c"}]}]}, value: 1}', { registry: r }));
      const root = named(thread.fields.pairs.find(([/** @type {string} */ k]) => k === 'root')[1]);
      expect(root.likes).to.equal(0n);
      expect(root.replies[0].likes).to.equal(0n);
      expect(root.replies[0].replies[0].likes).to.equal(0n);
      expect(() => decode('%Thread{root: %{text: "a", replies: [%{text: 1}]}, value: 1}', { registry: r })).to.throw();
    });

    it('a JSON-like value type, nested', () => {
      const r = registry(RECURSIVE);
      expect(Schema.check(decode('%{"a" => [1 %{"b" => nil}]}'), r, 'JsonValue')).to.equal(true);
      expect(() => Schema.check(decode('%{"a" => [1 %{"b" => :x}]}'), r, 'JsonValue')).to.throw();
    });
  });

  describe('generics', () => {
    const GENERICS = `%{
      Page: {:generic [t] %shape{items: {:list-of t}, next?: :string}}
      Pair: {:generic [a b] {:tuple-of a b}}
      Orders: {:of Page Order}
      Order: %schema{id: :integer}
      Feed: %schema{page: {:of Page :string}, pair: {:of Pair :integer :string}}
    }`;

    it("a generic's arguments stand where its parameters stand", () => {
      const r = registry(GENERICS);
      expect(() => decode('%Feed{page: %{items: ["a"]}, pair: {1 "x"}}', { registry: r })).not.to.throw();
      expect(() => decode('%Feed{page: %{items: [1]}, pair: {1 "x"}}', { registry: r })).to.throw();
      expect(() => decode('%Feed{page: %{items: ["a"]}, pair: {1 2}}', { registry: r })).to.throw();
    });

    it('a named type may be one use of a generic', () => {
      const r = registry(GENERICS);
      const order = decode('%Order{id: 1}', { registry: r });
      expect(Schema.check(new Map([[new DXNKeyword('items'), new DXNList([order])]]), r, 'Orders')).to.equal(true);
      expect(() => Schema.check(new Map([[new DXNKeyword('items'), new DXNList([1n])]]), r, 'Orders')).to.throw();
    });

    it('the wrong number of arguments, or :of on a type that is not generic, is refused', () => {
      expect(compileCategory('%{P: {:generic [t] {:list-of t}}, Q: {:of P :integer :string}}')).to.equal('schema/compile');
      expect(compileCategory('%{P: :integer, Q: {:of P :integer}}')).to.equal('schema/compile');
      expect(compileCategory('%{P: {:generic [t] {:list-of t}}, Q: %schema{v: P}}')).to.equal('schema/compile');
    });

    it('a struct schema cannot be generic, though it may use one', () => {
      expect(compileCategory('%{E: {:generic [p] %schema{payload: p}}}')).to.equal('schema/compile');
    });

    it('a generic that uses itself unguarded is refused', () => {
      expect(compileCategory('%{L: {:generic [t] {:nilable {:of L t}}}}')).to.equal('schema/compile');
    });
  });

  describe('check and conform', () => {
    it('check answers whether a value matches, and never changes it', () => {
      expect(Schema.check(decode('%{order_id: 1}'), registry(), 'OrderPlaced')).to.equal(true);
      expect(() => Schema.check(decode('%{currency: "EUR"}'), registry(), 'OrderPlaced')).to.throw().with.property('category', 'schema/type-mismatch');
    });

    it('conform answers the value with its defaults filled', () => {
      expect(named(Schema.conform(decode('%{order_id: 1}'), registry(), 'OrderPlaced'))).to.deep.equal({ order_id: 1n, currency: 'EUR' });
    });

    it('an unknown name is an error', () => {
      expect(() => Schema.check(1n, registry(), 'Nothing')).to.throw();
    });
  });
});
