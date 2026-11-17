import { expect } from 'chai';
import { decode, Registry, Schema, DXNKeyword, DXNDate, DXNDateTime, DXNStruct } from '../../src/dextrin.js';

// What DXNS lacked to say every TypeSpec type exactly, as dextrin's
// test/schema/typespec_gaps_test.exs (design/typespec.md there):
//
// - G2: generic parameters with a bound and a default;
// - G3: the `discriminator` annotation;
// - G5: the annotation keys `secret`, `key`, `visibility` and `messages`;
// - G6: a base that is a named type standing for a schema or a shape;
// - G7: the format `http-date`;
// - G8: a field computed when it is filled (`computed: :now`);
// - G9: the sized sugar `:int8`, `:int16`, `:uint8` and `:uint16`.
//
// G1 (`:rest`, `:closed`) is still open, and G4 is a sentence in DXNS.md.
describe('TypeSpec gaps', () => {
  /** @param {string} text @param {any} [registry] */
  const compiled = (text, registry = new Registry()) => Schema.compile(decode(text), registry);

  /** The category of what `fn` throws, or what it answers. @param {() => unknown} fn */
  const category = (fn) => {
    try {
      return fn();
    } catch (err) {
      return /** @type {any} */ (err).category ?? err;
    }
  };

  /** A compile refusal's message. @param {string} text @returns {string} */
  const compileError = (text) => {
    try {
      compiled(text);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {Error} */ (err).message;
    }
    throw new Error(`compiled: ${text}`);
  };

  /** Why `check` refuses `value`. @param {unknown} value @param {any} registry @param {string} name @returns {string} */
  const refusal = (value, registry, name) => {
    try {
      Schema.check(value, registry, name);
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
    throw new Error(`took ${String(value)}`);
  };

  /** @param {any} registry @param {string} name @param {string} text */
  const takes = (registry, name, text) => {
    try {
      return Schema.check(decode(text), registry, name);
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  describe('G2: generic parameters', () => {
    const generics = `
      %{
        Page: {:generic [t {size :integer :integer}] %shape{items: {:list-of t}, size?: size}}
        Named: {:generic [{t :string}] %shape{name: t}}
        Short: {:refine :string %{max-length: 3}}
        Person: %schema{name: :string}
        Admin: %schema extends Person {role: :string}
        Holder: {:generic [{p Person}] %shape{who: p}}
      }`;

    it('a parameter with a default may be left out of a use', () => {
      const r = compiled('%{Orders: {:of Page :string}}', compiled(generics));
      expect(takes(r, 'Orders', '%{items: ["a"], size: 1}')).to.equal(true);
      expect(takes(r, 'Orders', '%{items: ["a"], size: "1"}')).to.equal(false);
    });

    it('every parameter without a default must be given', () => {
      const r = compiled(generics);
      expect(category(() => compiled('%{X: {:of Page}}', r))).to.equal('schema/compile');
    });

    it('a parameter without a default after one with a default is a compile error', () => {
      expect(compileError('%{G: {:generic [{a :any :integer} b] {:tuple-of a b}}}')).to.include('default');
    });

    it('an argument passes its parameter\'s bound when it is or narrows the bound', () => {
      const r = compiled(generics);
      for (const arg of [':string', 'Short', '{:refine :string %{min-length: 1}}', '{:const "a"}', '{:enum "a" "b"}']) {
        expect(category(() => compiled(`%{X: {:of Named ${arg}}}`, r)), arg).to.be.instanceOf(Registry);
      }
      expect(category(() => compiled('%{X: {:of Holder Admin}}', r))).to.be.instanceOf(Registry);
    });

    it('an argument outside the bound is a compile error', () => {
      const r = compiled(generics);
      for (const arg of [':integer', '{:enum "a" 1}', '{:any-of :string :integer}']) {
        expect(category(() => compiled(`%{X: {:of Named ${arg}}}`, r)), arg).to.equal('schema/compile');
      }
      expect(category(() => compiled('%{X: {:of Holder Person2}, Person2: %schema{name: :string}}', r))).to.equal('schema/compile');
    });

    it('a refusal names the parameter and the argument outside its bound', () => {
      const r = compiled(generics);
      let message = '';
      try {
        compiled('%{X: {:of Named :integer}}', r);
      } catch (err) {
        message = /** @type {Error} */ (err).message;
      }
      expect(message).to.include("{:of Named ...}'s t takes what its bound takes; :integer is outside it");
    });

    it('a parameter passes on to a bounded generic when its own bound is within', () => {
      const r = compiled(generics);
      expect(category(() => compiled('%{Outer: {:generic [{u :string}] {:of Named u}}}', r))).to.be.instanceOf(Registry);
      expect(category(() => compiled('%{Outer: {:generic [u] {:of Named u}}}', r))).to.equal('schema/compile');
      expect(category(() => compiled('%{Outer: {:generic [{u :integer}] {:of Named u}}}', r))).to.equal('schema/compile');
    });

    it('an argument or a bound may be a type of the same document', () => {
      const r = compiled(generics);
      expect(category(() => compiled('%{Tiny: {:refine :string %{max-length: 1}}, X: {:of Named Tiny}}', r))).to.be.instanceOf(Registry);
      expect(category(() => compiled('%{Str: :string, G: {:generic [{t Str}] t}, X: {:of G :string}}'))).to.be.instanceOf(Registry);
      expect(category(() => compiled('%{Str: :string, G: {:generic [{t Str}] t}, X: {:of G :integer}}'))).to.equal('schema/compile');
    });

    it('a use as a base has its defaults filled', () => {
      const r = compiled(`
        %{
          Page: {:generic [t {size :integer :integer}] %shape{items: {:list-of t}, size?: size}}
          P: {:of Page :string}
          S: %schema includes P {}
        }`);
      expect(decode('%S{items: ["a"], size: 1}', { registry: r })).to.be.instanceOf(DXNStruct);
      expect(category(() => decode('%S{items: ["a"], size: "1"}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('a refusal through a use of a generic says why', () => {
      const r = compiled('%{Orders: {:of Page :string}}', compiled(generics));
      expect(refusal(decode('%{items: [1]}'), r, 'Orders')).to.include('items');
    });

    it('a default must pass its own bound', () => {
      expect(compileError('%{G: {:generic [{t :string :integer}] t}}')).to.include('bound');
    });

    it('a parameter is a symbol, {name bound} or {name bound default}', () => {
      expect(category(() => compiled('%{G: {:generic [{t}] t}}'))).to.equal('schema/compile');
      expect(category(() => compiled('%{G: {:generic [{t :any :any :any}] t}}'))).to.equal('schema/compile');
      expect(category(() => compiled('%{G: {:generic [1] :any}}'))).to.equal('schema/compile');
    });
  });

  describe('G3: discriminator', () => {
    const pets = `
      %{
        Cat: %shape{kind: {:const "cat"}, meows: :boolean}
        Dog: %shape{kind: {:const "dog"}, barks: :boolean}
        Pet: {:doc {:one-of Cat Dog} %{discriminator: :kind}}
      }`;

    it('changes nothing a value is checked against', () => {
      const r = compiled(pets);
      expect(takes(r, 'Pet', '%{kind: "cat", meows: true}')).to.equal(true);
      expect(takes(r, 'Pet', '%{kind: "cat", barks: true}')).to.equal(false);
      expect(takes(r, 'Pet', '%{kind: "cow"}')).to.equal(false);
    });

    it('is read back as an annotation', () => {
      expect(Schema.annotations(compiled(pets), 'Pet')).to.deep.include({ discriminator: 'kind' });
    });

    it('a refusal names the field and the variant it chose', () => {
      const r = compiled(pets);
      expect(refusal(decode('%{kind: "cow"}'), r, 'Pet')).to.equal('value does not match "Pet": kind "cow" names no variant');
      const wrong = refusal(decode('%{kind: "cat", meows: 1}'), r, 'Pet');
      expect(wrong).to.equal('value does not match "Pet": kind "cat" chooses Cat: field "meows" does not match its type');
      expect(wrong).not.to.include('barks');
      expect(refusal(decode('%{meows: true}'), r, 'Pet')).to.equal(
        'value does not match "Pet": field "kind" is missing; it chooses the variant'
      );
    });

    it("every variant has the field, written in a field's type too", () => {
      expect(
        compileError(`
          %{
            Cat: %shape{kind: {:const "cat"}}
            Bird: %shape{wings: :integer}
            Home: %shape{pet: {:doc {:one-of Cat Bird} %{discriminator: :kind}}}
          }`)
      ).to.include('"Home": its discriminator kind is no field of Bird');
      expect(
        compileError(`
          %{
            Cat: %shape{kind: {:const "cat"}}
            Bird: %shape{wings: :integer}
            Home: %schema{pet: {:doc {:one-of Cat Bird} %{discriminator: :kind}}}
          }`)
      ).to.include('kind');
    });

    it('stands only on an any-of or a one-of whose every variant has the field', () => {
      expect(compileError('%{T: {:doc :string %{discriminator: :kind}}}')).to.include('discriminator');
      expect(
        compileError(`
          %{
            Cat: %shape{kind: {:const "cat"}}
            Bird: %shape{wings: :integer}
            Pet: {:doc {:any-of Cat Bird} %{discriminator: :kind}}
          }`)
      ).to.include('kind');
      expect(compileError('%{Cat: %shape{kind: :string}, P: {:doc {:one-of Cat} %{discriminator: 1}}}')).to.include('discriminator');
    });

    it('every variant is a schema or a shape', () => {
      expect(compileError('%{P: {:doc {:one-of :string :integer} %{discriminator: :kind}}}')).to.include(
        'needs every variant to be a schema or a shape'
      );
    });

    it('a schema variant has the field too', () => {
      const r = compiled(`
        %{
          Cat: %schema{kind: {:const "cat"}, meows: :boolean}
          Dog: %shape{kind: {:const "dog"}}
          Pet: {:doc {:any-of Cat Dog} %{discriminator: :kind}}
        }`);
      expect(Schema.annotations(r, 'Pet')).to.deep.include({ discriminator: 'kind' });
      expect(() =>
        compiled(`
          %{
            Cat: %schema{meows: :boolean}
            Pet: {:doc {:any-of Cat} %{discriminator: :kind}}
          }`)
      ).to.throw(/discriminator kind is no field of Cat/);
    });
  });

  describe('G5: annotation keys', () => {
    it('secret, key, visibility and messages are read back', () => {
      const r = compiled(`
        %{
          User: %schema{
            id: {:doc :uuid %{key: true, visibility: [:read]}}
            password: {:doc :string %{secret: true, visibility: [:create :update]}}
            handle: {:doc :string %{key: "login"}}
          }
          Code: {:doc {:refine :string %{pattern: @regex "^[a-z]+$"}} %{messages: %{pattern: "lower case only"}}}
          Id: {:doc :uuid %{key: true, secret: false, visibility: [:read :query]}}
        }`);
      expect(Schema.annotations(r, 'Code')).to.deep.equal({ messages: { pattern: 'lower case only' } });
      expect(Schema.annotations(r, 'Id')).to.deep.equal({ key: true, secret: false, visibility: ['read', 'query'] });
    });

    it('a message replaces the refusal\'s own words', () => {
      const r = compiled('%{Code: {:doc {:refine :string %{pattern: @regex "^[a-z]+$"}} %{messages: %{pattern: "lower case only"}}}}');
      expect(refusal('ABC', r, 'Code')).to.equal('value does not match "Code": lower case only');
    });

    it('a constraint with no message keeps the plain refusal', () => {
      const r = compiled('%{Code: {:doc {:refine :string %{min-length: 2, max-length: 3}} %{messages: %{max-length: "three at most"}}}}');
      expect(refusal('abcd', r, 'Code')).to.equal('value does not match "Code": three at most');
      expect(refusal('a', r, 'Code')).to.equal('value does not match "Code"');
    });

    it('each key takes its kind of value', () => {
      expect(compileError('%{T: {:doc :string %{secret: 1}}}')).to.include('secret');
      expect(compileError('%{T: {:doc :string %{key: 1}}}')).to.include('key');
      expect(compileError('%{T: {:doc :string %{visibility: [:sometimes]}}}')).to.include('visibility');
      expect(compileError('%{T: {:doc :string %{visibility: :read}}}')).to.include('visibility');
      expect(compileError('%{T: {:doc :string %{messages: %{min-lenght: "x"}}}}')).to.include('min-lenght');
      expect(compileError('%{T: {:doc :string %{messages: %{pattern: 1}}}}')).to.include('messages');
    });

    it('visibility and read-only together are a compile error', () => {
      expect(compileError('%{T: {:doc :string %{read-only: true, visibility: [:read]}}}')).to.include('read-only');
    });

    it('an empty visibility is a field no stage sees', () => {
      expect(Schema.annotations(compiled('%{T: {:doc :string %{visibility: []}}}'), 'T')).to.deep.equal({ visibility: [] });
    });
  });

  describe('explain on failure', () => {
    it('a field of a struct says why its value is refused', () => {
      const r = compiled(`
        %{
          Pair: %shape{a: :integer, b: :string}
          Box: %schema{p: Pair}
        }`);
      let message = '';
      try {
        decode('%Box{p: %{a: 1, b: 2}}', { registry: r });
      } catch (err) {
        message = /** @type {Error} */ (err).message;
      }
      expect(message).to.include('field "p" does not match its declared type: field "b" does not match its type');
    });

    it('a missing field of a shape is named', () => {
      const r = compiled('%{Pair: %shape{a: :integer, b: :string}}');
      expect(refusal(decode('%{a: 1}'), r, 'Pair')).to.equal('value does not match "Pair": field "b" is missing');
    });

    it('nothing more to say leaves the plain refusal', () => {
      const r = compiled('%{N: :integer}');
      expect(refusal('a', r, 'N')).to.equal('value does not match "N"');
    });
  });

  describe('G6: a named type as a base', () => {
    const named = `
      %{
        Page: {:generic [t] %shape{items: {:list-of t}, next?: :string}}
        PageOfInt: {:of Page :integer}
        Ints: %schema includes PageOfInt {total: :integer}

        Person: %schema{name: :string}
        Human: Person
        User: %schema extends Human {email: :string}
        Box: %schema{who: Person}
      }`;

    it('a use of a generic standing for a shape is a base', () => {
      const r = compiled(named);
      expect(decode('%Ints{items: [1], total: 1}', { registry: r })).to.be.instanceOf(DXNStruct);
      expect(category(() => decode('%Ints{items: ["a"], total: 1}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('a name standing for a schema is that schema, extending included', () => {
      const r = compiled(named);
      expect(decode('%Box{who: %User{name: "a", email: "b"}}', { registry: r })).to.be.instanceOf(DXNStruct);
    });

    it('a named type standing for anything else is still no base', () => {
      expect(compileError('%{N: :integer, S: %schema includes N {}}')).to.include('N');
      expect(compileError('%{N: {:list-of :integer}, S: %schema includes N {}}')).to.include('N');
    });
  });

  describe('G7: format http-date', () => {
    /** @param {string} text */
    const httpDate = (text) => takes(compiled('%{T: {:refine :string %{format: :http-date}}}'), 'T', JSON.stringify(text));

    it("takes RFC 7231's IMF-fixdate", () => {
      expect(httpDate('Sun, 06 Nov 1994 08:49:37 GMT')).to.equal(true);
      expect(httpDate('Thu, 29 Feb 2024 23:59:60 GMT')).to.equal(true);
    });

    it('refuses the obsolete forms, a wrong weekday and a date that is none', () => {
      for (const text of [
        'Sunday, 06-Nov-94 08:49:37 GMT',
        'Sun Nov  6 08:49:37 1994',
        'Mon, 06 Nov 1994 08:49:37 GMT',
        'Sun, 6 Nov 1994 08:49:37 GMT',
        'Wed, 31 Nov 1994 08:49:37 GMT',
        'Thu, 29 Feb 2023 08:49:37 GMT',
        'Sun, 06 Nov 1994 24:00:00 GMT',
        'Sun, 06 Nov 1994 08:49:37 +0000',
        'Sun, 06 nov 1994 08:49:37 GMT',
        'Sun, 06 Nov 1994 08:49:37 GMT\n'
      ]) {
        expect(httpDate(text), text).to.equal(false);
      }
    });
  });

  describe('G8: computed: :now', () => {
    const stamped = `
      %{
        Note: %shape{text: :string, at: %field{type: :timestamp, computed: :now}}
        Day: %shape{on: %field{type: :date, computed: :now}}
        Log: %schema{text: :string, at: %field{type: :datetime, computed: :now}}
      }`;

    /** The value under the field `name` of a map. @param {any} map @param {string} name */
    const fieldOf = (map, name) => {
      for (const [k, v] of map.entries()) if (k instanceof DXNKeyword && k.name === name) return v;
      return undefined;
    };

    it('a missing field is filled with the time of the decode', () => {
      const r = compiled(stamped);
      const before = BigInt(Date.now()) * 1_000_000n;
      const at = fieldOf(Schema.conform(decode('%{text: "a"}'), r, 'Note'), 'at');
      expect(at).to.be.instanceOf(DXNDateTime);
      expect(at.epochNanoseconds >= before).to.equal(true);
      expect(BigInt(Date.now()) * 1_000_000n - at.epochNanoseconds < 5_000_000_000n).to.equal(true);
      expect(at.offsetMinutes).to.equal(0);
    });

    it('a field that is there is kept', () => {
      const r = compiled(stamped);
      const at = decode('@datetime "2020-01-01T00:00:00Z"');
      expect(fieldOf(Schema.conform(decode('%{text: "a", at: @datetime "2020-01-01T00:00:00Z"}'), r, 'Note'), 'at')).to.deep.equal(at);
    });

    it("a date is today's, in UTC", () => {
      const on = fieldOf(Schema.conform(decode('%{}'), compiled(stamped), 'Day'), 'on');
      expect(on).to.deep.equal(DXNDate.fromDate(new Date()));
    });

    it("a struct's missing field is filled when it is decoded", () => {
      const r = compiled(stamped);
      const log = /** @type {any} */ (decode('%Log{text: "a"}', { registry: r }));
      const at = log.fields.pairs.find((/** @type {[string, unknown]} */ [k]) => k === 'at')?.[1];
      expect(at).to.be.instanceOf(DXNDateTime);
    });

    it('only a temporal type is computed, never beside a default, and :now is all there is', () => {
      expect(compileError('%{N: %shape{a: %field{type: :string, computed: :now}}}')).to.include('computed');
      expect(compileError('%{N: %shape{a: %field{type: :date, computed: :now, default: @date "2020-01-01"}}}')).to.include('default');
      expect(compileError('%{N: %shape{a: %field{type: :date, computed: :later}}}')).to.include('later');
    });
  });

  describe('G9: small sized integers', () => {
    it('are their ranges', () => {
      const cases = [
        [':int8', '-128', '127', '-129', '128'],
        [':int16', '-32768', '32767', '-32769', '32768'],
        [':uint8', '0', '255', '-1', '256'],
        [':uint16', '0', '65535', '-1', '65536']
      ];
      for (const [type, low, high, under, over] of cases) {
        const r = compiled(`%{T: ${type}}`);
        expect(takes(r, 'T', low), `${type} ${low}`).to.equal(true);
        expect(takes(r, 'T', high), `${type} ${high}`).to.equal(true);
        expect(takes(r, 'T', under), `${type} ${under}`).to.equal(false);
        expect(takes(r, 'T', over), `${type} ${over}`).to.equal(false);
      }
    });
  });
});
