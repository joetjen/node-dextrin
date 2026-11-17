import { expect } from 'chai';
import { decode, encode, encodeBinary, Document, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';
import DXNDate from '../../src/values/date.js';

// A schema or a shape built from others (DXNS.md §4b), as dextrin's
// test/schema/extends_test.exs: `extends` and `includes` in its head,
// `- field` in its body. The result is an ordinary schema or shape; an
// `extends` result is accepted where its base is expected, when it is a
// valid base as well; an `includes` result is not.
describe('a schema or a shape built from others', () => {
  /** @param {string} text @param {Registry} [base] @returns {Registry} */
  const registry = (text, base = new Registry()) => Schema.compile(decode(text), base);

  /** The category `run` throws with, or what it answers. @param {() => unknown} run */
  const category = (run) => {
    try {
      return run();
    } catch (err) {
      return /** @type {any} */ (err).category;
    }
  };

  /** @param {string} text @param {Registry} [base] */
  const compiled = (text, base) => category(() => (registry(text, base), 'ok'));

  /** @param {Registry} r @param {string} name */
  const schema = (r, name) => /** @type {NonNullable<ReturnType<Registry['fetchStructSchema']>>} */ (r.fetchStructSchema(name)).compiled;

  /** A primitive by its name, a refine by its base, as the schema writes them. @param {any} type @returns {unknown} */
  const short = (type) => {
    if (type.form === 'primitive') return type.name;
    if (type.form === 'refine') return ['refine', short(type.base)];
    return type;
  };

  /** Each field as `[name, type]`, an optional one's name ending in `?`. @param {Registry} r @param {string} name */
  const fields = (r, name) => schema(r, name).fields.map((f) => [f.required ? f.name : `${f.name}?`, short(f.type)]);

  /** @param {Registry} r @param {string} name */
  const names = (r, name) => schema(r, name).fields.map((f) => f.name);

  const USERS = `%{
    Person: %shape{name: :string, born?: :date}

    User: %schema(3) extends Person {
      email: :string
      password: :string
      nick?: :string
    }

    Audit: %shape{changed_by: :string}

    Admin: %schema(1) extends User includes Audit {
      - nick
      email: {:refine :string %{format: "email"}}
      role: :string
    }
  }`;

  describe('the head and the body, read as text', () => {
    it("a schema's head carries its bases, the body its dropped fields", () => {
      const value = /** @type {DXNStruct} */ (decode('%schema(2) extends User(3) Staff includes Audit {- password, role: :string}'));
      expect(value).to.be.instanceOf(DXNStruct);
      expect(value.name).to.equal('schema');
      expect(value.version).to.equal(2);
      expect(value.bases).to.deep.equal([
        ['extends', 'User', 3],
        ['extends', 'Staff', null],
        ['includes', 'Audit', null]
      ]);
      expect(value.drops).to.deep.equal(['password']);
    });

    it('a shape takes them as well', () => {
      const value = /** @type {DXNStruct} */ (decode('%shape includes Audit {-x}'));
      expect(value.name).to.equal('shape');
      expect(value.bases).to.deep.equal([['includes', 'Audit', null]]);
      expect(value.drops).to.deep.equal(['x']);
    });

    it('any other struct taking a clause or a dropped field is a syntax error', () => {
      expect(category(() => decode('%User extends Person {name: "a"}'))).to.equal('syntax');
      expect(category(() => decode('%User{- name}'))).to.equal('syntax');
    });

    it('a clause given twice, or with no base, is a syntax error', () => {
      expect(category(() => decode('%schema extends A extends B {}'))).to.equal('syntax');
      expect(category(() => decode('%schema extends {}'))).to.equal('syntax');
      expect(category(() => decode('%schema A {}'))).to.equal('syntax');
      expect(category(() => decode('%schema extends(2) A {}'))).to.equal('syntax');
    });

    it("a '-' before a digit stays a number's sign", () => {
      expect(/** @type {any} */ (decode('[1 -1]')).items).to.deep.equal([1n, -1n]);
      expect(category(() => decode('%schema{-1}'))).to.equal('syntax');
      expect(category(() => decode('[- 1]'))).to.equal('syntax');
    });

    it('writes back as it was read', () => {
      const value = decode('%schema(2) extends User(3) Staff includes Audit {- password role: :string}');
      const written = encode(value);
      expect(decode(written)).to.deep.equal(value);
      expect(written).to.include('extends User(3) Staff includes Audit');
      expect(written).to.include('- password');
    });

    it('is written back over lines, and by the formatter that keeps comments', () => {
      const value = decode('%schema(2) extends User(3) includes Audit {- password, role: :string}');
      const pretty = encode(value, { pretty: true });
      expect(decode(pretty)).to.deep.equal(value);

      const source = '%{\n  Admin: %schema extends User {\n    - password  # gone\n    role: :string\n  }\n}\n';
      expect(Document.format(Document.parse(source))).to.equal(source);
    });

    it('has no .dxnb form', () => {
      const value = decode('%schema extends User {role: :string}');
      expect(category(() => encodeBinary(value))).to.equal('encode/unsupported');
    });
  });

  describe('the result', () => {
    it("is the bases' fields in order, overrides in place, drops gone, its own last", () => {
      const r = registry(USERS);
      expect(fields(r, 'Admin')).to.deep.equal([
        ['name', 'string'],
        ['born?', 'date'],
        ['email', ['refine', 'string']],
        ['password', 'string'],
        ['changed_by', 'string'],
        ['role', 'string']
      ]);
      expect(schema(r, 'Admin').version).to.equal(1);
    });

    it('records its bases, each schema at the version it was built with', () => {
      expect(schema(registry(USERS), 'Admin').bases).to.deep.equal([
        ['extends', 'User', 3],
        ['includes', 'Audit', null]
      ]);
    });

    it('a shape may be built from a schema, and a schema from a shape', () => {
      const r = registry('%{Card: %shape includes User {- password}, Holder: %schema{card: Card}}', registry(USERS));
      expect(category(() => decode('%Holder{card: %{name: "a", email: "a@x"}}', { registry: r }))).to.be.instanceOf(DXNStruct);
      expect(category(() => decode('%Holder{card: %{name: "a"}}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('a field reached twice through a common base is one field', () => {
      const r = registry(`%{
        Person: %shape{name: :string}
        User: %schema extends Person {email: :string}
        Staff: %schema extends Person {desk: :integer}
        Both: %schema extends User Staff {}
      }`);
      expect(fields(r, 'Both')).to.deep.equal([
        ['name', 'string'],
        ['email', 'string'],
        ['desk', 'integer']
      ]);
    });

    it('a field is the same however its base was found', () => {
      const loaded = registry(`%{Id: {:refine :integer %{min: 1}}
        Person: %shape{id: Id}
        Staff: %schema extends Person {desk: :integer}}`);
      const text = `%{Id: {:refine :integer %{min: 1}}
        Person: %shape{id: Id}
        User: %schema extends Person {email: :string}
        Both: %schema extends User Staff {}}`;
      expect(names(registry(text, loaded), 'Both')).to.deep.equal(['id', 'email', 'desk']);
    });

    it('two different fields of one name are refused, unless the body settles it', () => {
      const clash = `%{
        A: %shape{x: :string}
        B: %shape{x: :integer}
        C: %schema includes A B {}
      }`;
      expect(compiled(clash)).to.equal('schema/compile');
      expect(compiled(clash.replace('{}\n', '{x: :boolean}\n'))).to.equal('ok');
      expect(compiled(clash.replace('{}\n', '{- x}\n'))).to.equal('ok');
    });

    for (const text of [
      '%{A: %schema extends Nobody {}}',
      '%{P: %shape{x: :string}, A: %schema extends P(2) {}}',
      '%{U: %schema(1){x: :string}, A: %schema extends U(2) {}}',
      '%{P: %shape{x: :string}, A: %schema includes P P {}}',
      '%{P: %shape{x: :string}, A: %schema extends P includes P {}}',
      '%{P: %shape{x: :string}, A: %schema includes P {- y}}',
      '%{P: %shape{x?: :string}, A: %schema includes P {- x, - x}}',
      '%{P: %shape{x?: :string}, A: %schema includes P {- x, x: :string}}',
      '%{P: %shape{x: :string}, A: %schema extends P {- x}}',
      '%{A: %schema extends B {}, B: %schema extends A {}}',
      '%{N: :integer, A: %schema extends N {}}',
      '%{G: {:generic [t] %shape{x: t}}, A: %schema extends G {}}',
      '%{A: %schema{- x, y: :string}}',
      '%{P: %shape{x: :string}, A: %shape(2) extends P {}}',
      '%{P: %shape{x: :string}, A: %schema{y: %shape extends P {}}}',
      '%{P: %shape{x?: :string, k: :string}, A: %schema includes P {- k, y: {:case k %{"a" => :string}}}}'
    ]) {
      it(`refuses ${text} as schema/compile`, () => {
        expect(compiled(text)).to.equal('schema/compile');
      });
    }

    it('an optional field of an extends base may be dropped, and any field of an includes base', () => {
      expect(compiled('%{P: %shape{x?: :string}, A: %schema extends P {- x}}')).to.equal('ok');
      expect(compiled('%{P: %shape{x: :string}, A: %schema includes P {- x}}')).to.equal('ok');
    });

    it('a shape built from others is a named type of its own', () => {
      const r = registry('%{P: %shape{x: :string, y?: :integer}, Q: %shape includes P {- y, z: :boolean}, H: %schema{q: Q}}');
      expect(category(() => decode('%H{q: %{x: "a", z: true}}', { registry: r }))).to.be.instanceOf(DXNStruct);
      expect(category(() => decode('%H{q: %{x: "a"}}', { registry: r }))).to.equal('schema/type-mismatch');
    });
  });

  describe('a base in another document', () => {
    const V1 = '%{User: %schema(1){name: :string}}';
    const V2 = '%{User: %schema(2){name: :string, email: :string}}';

    it('is its latest loaded version, unless one is named', () => {
      const base = registry(V2, registry(V1));
      expect(names(registry('%{A: %schema extends User {role: :string}}', base), 'A')).to.deep.equal(['name', 'email', 'role']);
      expect(names(registry('%{A: %schema extends User(1) {role: :string}}', base), 'A')).to.deep.equal(['name', 'role']);
    });

    it('the latest version may be one only the resolver knows', () => {
      const v2 = schema(registry(V2), 'User');
      const base = new Registry().putResolver((name) => (name === 'User' ? [v2] : undefined));
      const text = '%{User: %schema(1){name: :string}, A: %schema extends User {role: :string}}';
      expect(names(registry(text, base), 'A')).to.deep.equal(['name', 'email', 'role']);
    });

    it('a newer version loaded later changes no result already loaded', () => {
      let r = registry('%{A: %schema extends User {role: :string}}', registry(V1));
      r = registry(V2, r);
      expect(names(r, 'A')).to.deep.equal(['name', 'role']);
      expect(schema(r, 'A').bases).to.deep.equal([['extends', 'User', 1]]);
    });

    it('a base version not loaded is schema/compile', () => {
      expect(compiled('%{A: %schema extends User(3) {}}', registry(V1))).to.equal('schema/compile');
    });
  });

  describe('where a base is expected', () => {
    /** @param {Registry} base */
    const holder = (base) =>
      registry(
        `%{
          UserBox: %schema{u: User}
          Wide: %schema extends User {email: :integer}
          Mixed: %schema includes User {}
        }`,
        base
      );

    it('an extending struct is accepted, and keeps what it is', () => {
      const r = holder(registry(USERS));
      const value = /** @type {DXNStruct} */ (
        decode('%UserBox{u: %Admin{name: "a", email: "a@x", password: "p", changed_by: "b", role: "r"}}', { registry: r })
      );
      const fieldsOf = /** @type {{type: 'keyed', pairs: Array<[string, any]>}} */ (value.fields);
      expect(fieldsOf.pairs[0][0]).to.equal('u');
      expect(fieldsOf.pairs[0][1]).to.be.instanceOf(DXNStruct);
      expect(fieldsOf.pairs[0][1].name).to.equal('Admin');
    });

    it('only when it is a valid base as well', () => {
      const r = holder(registry(USERS));
      expect(category(() => decode('%UserBox{u: %Wide{name: "a", email: 1, password: "p"}}', { registry: r }))).to.equal(
        'schema/type-mismatch'
      );
    });

    it('a positional struct, on its way out, as well', () => {
      const r = holder(registry(USERS));
      const admin = DXNStruct.positional('Admin', ['a', new DXNDate(2000, 1, 1), 'a@x', 'p', 'b', 'r']);
      expect(encode(DXNStruct.keyed('UserBox', [['u', admin]]), { registry: r })).to.include('%Admin');
    });

    it('through a chain of extends, and not past an includes', () => {
      const r = registry(`%{
        Root: %schema{id: :integer}
        Mid: %schema extends Root {}
        Leaf: %schema extends Mid {}
        Cut: %schema includes Mid {}
        RootBox: %schema{r: Root}
      }`);
      expect(category(() => decode('%RootBox{r: %Leaf{id: 1}}', { registry: r }))).to.be.instanceOf(DXNStruct);
      expect(category(() => decode('%RootBox{r: %Cut{id: 1}}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('including is not extending', () => {
      const r = holder(registry(USERS));
      expect(category(() => decode('%UserBox{u: %Mixed{name: "a", email: "a@x", password: "p"}}', { registry: r }))).to.equal(
        'schema/type-mismatch'
      );
    });

    it('holds on encode as on decode', () => {
      const r = holder(registry(USERS));
      const admin = DXNStruct.keyed('Admin', [
        ['name', 'a'],
        ['email', 'a@x'],
        ['password', 'p'],
        ['changed_by', 'b'],
        ['role', 'r']
      ]);
      const mixed = DXNStruct.keyed('Mixed', [
        ['name', 'a'],
        ['email', 'a@x'],
        ['password', 'p']
      ]);
      expect(encode(DXNStruct.keyed('UserBox', [['u', admin]]), { registry: r })).to.include('%Admin');
      expect(category(() => encode(DXNStruct.keyed('UserBox', [['u', mixed]]), { registry: r }))).to.equal('schema/type-mismatch');
    });
  });
});
