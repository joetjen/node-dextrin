import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { expect } from 'chai';
import { decode, encode, DXNError, DXNKeyword, DXNList, DXNStruct, DXNUUID, DXNDateTime } from '../../src/dextrin.js';
import { InvalidData } from '../../src/codegen-runtime.js';
import Codegen from '../../src/codegen/javascript.cjs';

/*
 * JavaScript code from DXNS (T686, design/codegen-node.md), as the
 * reference's test/codegen/elixir_test.exs and php-dextrin's
 * tests/Codegen/PhpTest.php: generated classes read, check and write data
 * with code of their own -- no schema is loaded when they run -- for every
 * version a schema has; regenerating keeps what was written by hand, in
 * the user's file and in the generated file's regions, and the class names
 * and paths as the user spells them.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin/dextrin.js');
const FIXTURE = join(ROOT, 'test/fixtures/codegen');

/** @type {{[path: string]: string}} */
const SCHEMAS = {
  'acme/shop.dxns': `%{
  Money: %shape{amount: {:refine :decimal %{min: 0M}} currency: %field{type: :string default: "EUR"}}
  Code: {:refine :string %{pattern: @regex "^[A-Z]{3}$"}}
  Status: {:enum :open :closed}
}`,
  'acme/shop/Customer.dxns': '%{Customer: %schema{name: :string, code?: acme.shop/Code}}',
  'acme/shop/Order.dxns': `%{Order: %schema{
  id: :uuid
  customer: acme.shop/Customer
  total: acme.shop/Money
  status: %field{type: acme.shop/Status default: :open}
  lines: {:list-of {:refine :string %{min-length: 1}}}
  note?: {:nilable :string}
}}`,
  'acme/shop/Pet.dxns': '%{Pet: {:doc %schema(1){name: :string colour: :string born: :integer} %{deprecated: "use Pet(2)"}}}',
  'acme/shop/Pet-v2.dxns': `%{Pet: %schema(2){
  name: :string
  color: {:doc :string %{meta: %{"typespec.renamed-from" => "colour"}}}
  born: :string
  tag?: :string
}}`
};

/** @type {{[path: string]: string}} */
const DEPRECATED_SCHEMAS = {
  'dep/Box.dxns': '%{Box: {:doc %schema(1){a: :string} %{deprecated: "use Box(2)"}}}',
  'dep/Box-v2.dxns': '%{Box: %schema(2){a: :string b?: :string}}',
  'dep/Old.dxns': '%{Old: {:doc %schema{a: :string} %{deprecated: true}}}',
  'dep.dxns': `%{
  Color: {:doc {:enum :red :old} %{values: %{:old => %{deprecated: "use red"}}}}
  Legacy: {:doc :string %{deprecated: "use text"}}
  Cat: %shape{meows: :boolean}
  Dog: {:doc %shape{barks: :boolean} %{deprecated: "no dogs"}}
}`,
  'dep/Item.dxns': `%{Item: %schema{
  color?: dep/Color
  note?: dep/Legacy
  pet?: {:any-of dep/Dog dep/Cat}
}}`
};

/** The hand-written upgrade Pet(1) needs: `born` changed type. */
const PET_UPGRADE = `
  static upgradeV1(fields) {
    return { ...fields, born: String(fields.born) };
  }
}
`;

/** @type {string[]} */
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A fresh directory holding `files` under `schemas/`, where generated code
 * finds this package as `@joetjen/dextrin`, as it would in a user's project.
 * @param {{[path: string]: string}} [files]
 */
function schemasDir(files = SCHEMAS) {
  const root = mkdtempSync(join(tmpdir(), 'dextrin-codegen-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, 'schemas', path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  mkdirSync(join(root, 'node_modules/@joetjen'), { recursive: true });
  symlinkSync(ROOT, join(root, 'node_modules/@joetjen/dextrin'), 'dir');
  writeFileSync(join(root, 'package.json'), '{"type": "module"}\n');
  return root;
}

/** @param {string} root */
function generate(root) {
  return Codegen.write([join(root, 'schemas')], join(root, 'src'));
}

/** @param {string} root */
function check(root) {
  return Codegen.check([join(root, 'schemas')], join(root, 'src'));
}

/** A generated module, imported. @param {string} root @param {string} path @returns {Promise<any>} */
function load(root, path) {
  return import(pathToFileURL(join(root, 'src', path)).href);
}

/** @param {string} file */
function read(file) {
  return readFileSync(file, 'utf8');
}

/** @param {string} file @param {(text: string) => string} change */
function edit(file, change) {
  const before = read(file);
  const after = change(before);
  expect(after, `an edit of ${file}`).to.not.equal(before);
  writeFileSync(file, after);
}

/** @param {string} text */
function dxn(text) {
  return decode(text);
}

/** @param {() => unknown} fn @returns {any} */
function refusal(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  expect.fail('refused');
  return null;
}

/** @param {() => Promise<unknown>} fn @returns {Promise<any>} */
async function rejection(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  expect.fail('refused');
  return null;
}

describe('JavaScript code from DXNS (dextrin gen-js)', function () {
  this.timeout(20000);

  describe('the files', () => {
    it("writes a user's file, a generated one and its declarations per schema, each naming the schema", () => {
      const root = schemasDir();
      const written = generate(root);
      const src = join(root, 'src');

      expect(written).to.include.members([
        join(src, 'Acme/Shop/Order.js'),
        join(src, 'Acme/Shop/AbstractOrder.js'),
        join(src, 'Acme/Shop/AbstractOrder.d.ts'),
        join(src, 'Decoder.js'),
        join(src, 'Decoder.d.ts')
      ]);
      const gen = read(join(src, 'Acme/Shop/AbstractOrder.js'));
      const types = read(join(src, 'Acme/Shop/AbstractOrder.d.ts'));
      const own = read(join(src, 'Acme/Shop/Order.js'));

      expect(gen.startsWith('// Generated by dextrin gen-js')).to.equal(true);
      expect(gen).to.include('// dextrin:schema acme.shop/Order');
      expect(gen).to.include('do not edit');
      expect(gen).to.include('export class AbstractOrder {');
      expect(types.startsWith('// Generated by dextrin gen-js')).to.equal(true);
      expect(types).to.include('export declare abstract class AbstractOrder {');
      expect(own.startsWith('// dextrin:schema acme.shop/Order\n')).to.equal(true);
      expect(own).to.include("import { AbstractOrder } from './AbstractOrder.js';");
      expect(own).to.match(/export class Order extends AbstractOrder \{\n\s+static \{\n\s+this\.verify\(\);\n\s+\}\n\}\n$/);
    });

    it('the same schemas give the same bytes', () => {
      const root = schemasDir();
      generate(root);
      const first = read(join(root, 'src/Acme/Shop/AbstractOrder.js'));
      const firstTypes = read(join(root, 'src/Acme/Shop/AbstractOrder.d.ts'));
      generate(root);
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.js'))).to.equal(first);
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.d.ts'))).to.equal(firstTypes);
    });

    it('a namespace written with capitals or not is one StudlyCase directory per part, as the class path', () => {
      const root = schemasDir({ 'acme/shop/Order/v1.dxns': '%{Order: %schema{line: OrderLine} OrderLine: %schema{sku: :string}}' });
      const written = generate(root);
      expect(written).to.include(join(root, 'src/Acme/Shop/Order/OrderLine.js'));
      expect(written).to.include(join(root, 'src/Acme/Shop/Order.js'));
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.js'))).to.include("from './Order/OrderLine.js';");
    });
  });

  describe('reading and checking', () => {
    it('reads a struct into the class, its defaults filled, frozen', async () => {
      const root = schemasDir();
      generate(root);
      const { Order } = await load(root, 'Acme/Shop/Order.js');
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');

      const order = Order.read(
        dxn(`%acme.shop/Order{
          id: @uuid "550e8400-e29b-41d4-a716-446655440000"
          customer: %acme.shop/Customer{name: "Ada"}
          total: %{amount: 9.5M}
          lines: ["a" "b"]
        }`)
      );

      expect(order).to.be.instanceOf(Order);
      expect(order.id).to.be.instanceOf(DXNUUID);
      expect(order.customer).to.be.instanceOf(Customer);
      expect(order.customer.name).to.equal('Ada');
      expect(order.status).to.deep.equal(new DXNKeyword('open'));
      expect(order.total.get(new DXNKeyword('currency'))).to.equal('EUR');
      expect(order.note).to.equal(undefined);
      expect(order.lines).to.be.instanceOf(DXNList);
      expect(Object.isFrozen(order)).to.equal(true);
      expect(() => {
        order.status = 1;
      }).to.throw(TypeError);
      order.validate();
    });

    it('a value that does not match says which field', async () => {
      const root = schemasDir();
      generate(root);
      const { Order } = await load(root, 'Acme/Shop/Order.js');

      const err = refusal(() =>
        Order.read(
          dxn(`%acme.shop/Order{
            id: @uuid "550e8400-e29b-41d4-a716-446655440000"
            customer: %acme.shop/Customer{name: "Ada" code: "nope"}
            total: %{amount: -1M}
            lines: [""]
          }`)
        )
      );
      expect(err).to.be.instanceOf(InvalidData);
      expect(err).to.be.instanceOf(DXNError);
      expect(err.path).to.deep.equal(['customer', 'code']);
      expect(err.message.startsWith('customer.code: "nope" does not meet')).to.equal(true, err.message);
      expect(err.stage).to.equal('schema');
      expect(err.category).to.equal('schema/type-mismatch');
    });

    it("an item's place in a list is part of the path", async () => {
      const root = schemasDir();
      generate(root);
      const { Order } = await load(root, 'Acme/Shop/Order.js');
      const err = refusal(() =>
        Order.read(dxn('%acme.shop/Order{id: @uuid "550e8400-e29b-41d4-a716-446655440000" customer: %acme.shop/Customer{name: "A"} total: %{amount: 1M} lines: ["a" ""]}'))
      );
      expect(err.path).to.deep.equal(['lines', '[1]']);
      expect(err.message.startsWith('lines[1]: ')).to.equal(true, err.message);
    });

    it('a missing required field is refused', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');
      const err = refusal(() => Customer.read(dxn('%acme.shop/Customer{}')));
      expect(err).to.be.instanceOf(InvalidData);
      expect(err.message).to.equal('missing required field name');
      expect(err.category).to.equal('schema/missing-field');
    });

    it('a struct of another schema, or no struct, is refused', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');
      expect(refusal(() => Customer.read(dxn('%acme.shop/Order{}'))).message).to.equal('expected a acme.shop/Customer, got %acme.shop/Order{}');
      expect(refusal(() => Customer.read(3n)).message).to.equal('expected a acme.shop/Customer, got 3');
    });

    it('validate checks a value built by hand', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');

      new Customer({ name: 'Ada', code: 'ABC' }).validate();
      const err = refusal(() => new Customer({ name: 'Ada', code: 'abc' }).validate());
      expect(err.message.startsWith('code: ')).to.equal(true, err.message);
    });

    it('a constructor fills a default the caller leaves out', async () => {
      const root = schemasDir();
      generate(root);
      const { Order } = await load(root, 'Acme/Shop/Order.js');
      const order = new Order({ id: DXNUUID.fromString('550e8400-e29b-41d4-a716-446655440000'), customer: null, total: new Map(), lines: new DXNList([]) });
      expect(order.status).to.deep.equal(new DXNKeyword('open'));
    });

    it('with-copies change one field and leave the original', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');

      const ada = new Customer({ name: 'Ada' });
      const bo = ada.withName('Bo');
      expect(bo).to.be.instanceOf(Customer);
      expect(bo.name).to.equal('Bo');
      expect(ada.name).to.equal('Ada');
      expect(Object.isFrozen(bo)).to.equal(true);
    });

    it('a with-copy of a snake_case field is named in camelCase; a kebab-case field is a camelCase property', async () => {
      const root = schemasDir({ 'a/Stamp.dxns': '%{Stamp: %schema{signed_up_at: :string first-name?: :string}}' });
      generate(root);
      const { Stamp } = await load(root, 'A/Stamp.js');

      const copy = new Stamp({ signed_up_at: 'x' }).withSignedUpAt('y').withFirstName('Ada');
      expect(copy.signed_up_at).to.equal('y');
      expect(copy.firstName).to.equal('Ada');
      expect(encode(copy.toDxn())).to.equal('%a/Stamp(1){signed_up_at:"y",first-name:"Ada"}');
    });

    it('toDxn writes the struct back at the latest version', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');

      const struct = Customer.read(dxn('%acme.shop/Customer{name: "Ada"}')).toDxn();
      expect(struct).to.be.instanceOf(DXNStruct);
      expect(encode(struct)).to.equal('%acme.shop/Customer(1){name:"Ada"}');
    });

    it('a field holding nil is present, apart from one left out: validate() takes it and toDxn() writes it', async () => {
      const root = schemasDir({ 'a/Note.dxns': '%{Note: %schema{text: {:nilable :string} more?: {:nilable :string}}}' });
      generate(root);
      const { Note } = await load(root, 'A/Note.js');

      const note = Note.read(dxn('%a/Note{text: nil}'));
      expect(note.text).to.equal(null);
      expect(note.more).to.equal(undefined);
      note.validate();
      expect(encode(note.toDxn())).to.equal('%a/Note(1){text:nil}');
      expect(refusal(() => new Note({ text: undefined }).validate()).message).to.equal('missing required field text');
    });

    it('read() given a value of the class checks it and answers it', async () => {
      const root = schemasDir();
      generate(root);
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');
      const ada = new Customer({ name: 'Ada' });
      expect(Customer.read(ada)).to.equal(ada);
      expect(refusal(() => Customer.read(new Customer({ name: 'Ada', code: 'x' }))).message.startsWith('code: ')).to.equal(true);
    });
  });

  describe('versions', () => {
    it('an older version is read and upgraded: renamed, dropped and added fields by themselves, a changed type by hand', async () => {
      const root = schemasDir();
      generate(root);
      edit(join(root, 'src/Acme/Shop/Pet.js'), (t) => t.replace(/\n\}\n$/, PET_UPGRADE));
      const { Pet } = await load(root, 'Acme/Shop/Pet.js');

      const old = Pet.read(dxn('%acme.shop/Pet(1){name: "Rex" colour: "red" born: 2019}'), { deprecations: 'off' });
      expect([old.name, old.color, old.born, old.tag]).to.deep.equal(['Rex', 'red', '2019', undefined]);
      expect(Pet.read(dxn('%acme.shop/Pet(2){name: "Rex" color: "blue" born: "2019"}')).color).to.equal('blue');
    });

    it("a hand-written upgrade is required by verify(), and typed for TypeScript in the declarations", () => {
      const root = schemasDir();
      generate(root);
      const gen = read(join(root, 'src/Acme/Shop/AbstractPet.js'));
      const types = read(join(root, 'src/Acme/Shop/AbstractPet.d.ts'));
      expect(gen).to.include("['upgradeV1', 'acme.shop/Pet version 1 to 2 changes born, which code cannot upgrade']");
      expect(types).to.include('static verify<T extends { upgradeV1(fields: UpgradeV1Fields): FieldsV2 }>(this: T): void;');
      expect(read(join(root, 'src/Acme/Shop/Pet.js'))).to.not.include('upgradeV1');
    });

    it('a missing hand-written upgrade fails when the class is defined, naming the class and the method', async () => {
      const root = schemasDir();
      generate(root);
      const err = await rejection(() => load(root, 'Acme/Shop/Pet.js'));
      expect(err).to.be.instanceOf(TypeError);
      expect(err.message).to.include('Pet');
      expect(err.message).to.include('static upgradeV1(fields)');
    });

    it('without the static block, the first use checks it; the Decoder checks every class it loads', async () => {
      const root = schemasDir();
      generate(root);
      edit(join(root, 'src/Acme/Shop/Pet.js'), (t) => t.replace(/ {2}static \{\n {4}this\.verify\(\);\n {2}\}\n/, ''));
      const { Pet } = await load(root, 'Acme/Shop/Pet.js');
      expect(refusal(() => Pet.read(dxn('%acme.shop/Pet(2){name: "Rex" color: "blue" born: "2019"}'))).message).to.include('static upgradeV1(fields)');
      expect(() => new Pet({ name: 'Rex', color: 'blue', born: '2019' })).to.throw(TypeError, 'upgradeV1');

      const decoder = await rejection(() => load(root, 'Decoder.js'));
      expect(decoder.message).to.include('static upgradeV1(fields)');
    });

    it('a field added with a default is filled when an older version is upgraded', async () => {
      const root = schemasDir({
        'a/Box.dxns': '%{Box: %schema(1){a: :string}}',
        'a/Box-v2.dxns': '%{Box: %schema(2){a: :string b: %field{type: :string default: "x"}}}'
      });
      generate(root);
      const { Box } = await load(root, 'A/Box.js');
      const box = Box.read(dxn('%a/Box(1){a: "A"}'));
      expect([box.a, box.b]).to.deep.equal(['A', 'x']);
    });

    it('versions with gaps between them are upgraded through every step', async () => {
      const root = schemasDir({
        'a/Box.dxns': '%{Box: %schema(1){a: :string x: :string}}',
        'a/Box-v3.dxns': '%{Box: %schema(3){a: :string x: :string z?: :string}}',
        'a/Box-v5.dxns': '%{Box: %schema(5){a: :string y: {:doc :string %{meta: %{"typespec.renamed-from" => "x"}}} z?: :string}}'
      });
      generate(root);
      const { Box } = await load(root, 'A/Box.js');
      expect(Box.read(dxn('%a/Box(1){a: "A" x: "X"}')).y).to.equal('X');
      expect(Box.read(dxn('%a/Box(3){a: "A" x: "X"}')).y).to.equal('X');
      expect(refusal(() => Box.read(dxn('%a/Box(2){a: "A" x: "X"}'))).message).to.equal('a/Box version 2 is not known');
    });

    it("a deprecated version's methods are marked, and read() does not call them", () => {
      const root = schemasDir();
      generate(root);
      const gen = read(join(root, 'src/Acme/Shop/AbstractPet.js'));
      const types = read(join(root, 'src/Acme/Shop/AbstractPet.d.ts'));
      for (const text of [gen, types]) {
        expect(text).to.match(/@deprecated use Pet\(2\)\n(?:\s+\*[^\n]*\n)*\s+\*\/\n\s+static readV1[<(]/);
        expect(text).to.match(/@deprecated use Pet\(2\)\n(?:\s+\*[^\n]*\n)*\s+\*\/\n\s+static conformV1\(/);
        expect(text).to.not.match(/@deprecated[^\n]*\n(?:\s+\*[^\n]*\n)*\s+\*\/\n\s+static (read|conform)V2[<(]/);
      }
      expect(gen).to.not.match(/\.(readV1|conformV1)\(/);
    });
  });

  describe('what is written by hand is kept', () => {
    it('a region of the generated file survives regenerating, inside the class and at the top of the module', () => {
      const root = schemasDir();
      generate(root);
      const gen = join(root, 'src/Acme/Shop/AbstractOrder.js');
      edit(gen, (t) =>
        t
          .replace('  // dextrin:keep bottom\n', "  // dextrin:keep bottom\n  hello() {\n    return 'world';\n  }\n")
          .replace('// dextrin:keep top\n', "// dextrin:keep top\nimport { strict } from 'node:assert';\n")
      );

      generate(root);
      const text = read(gen);
      expect(text).to.include("  // dextrin:keep bottom\n  hello() {\n    return 'world';\n  }\n  // dextrin:end bottom");
      expect(text).to.include("// dextrin:keep top\nimport { strict } from 'node:assert';\n// dextrin:end top");
    });

    it("an upgrade step's region runs before the hand-written step", async () => {
      const root = schemasDir();
      generate(root);
      edit(join(root, 'src/Acme/Shop/AbstractPet.js'), (t) => t.replace('    // dextrin:keep upgrade_v1\n', "    // dextrin:keep upgrade_v1\n    fields.born = 'was ' + fields.born;\n"));
      edit(join(root, 'src/Acme/Shop/Pet.js'), (t) => t.replace(/\n\}\n$/, PET_UPGRADE));
      const { Pet } = await load(root, 'Acme/Shop/Pet.js');
      expect(Pet.read(dxn('%acme.shop/Pet(1){name: "Rex" colour: "red" born: 2019}'), { deprecations: 'off' }).born).to.equal('was 2019');
    });

    it('a region whose slot is gone is kept as an orphan where it cannot run, and --check fails', async () => {
      const root = schemasDir();
      generate(root);
      const gen = join(root, 'src/Acme/Shop/AbstractPet.js');
      edit(gen, (t) => t.replace('    // dextrin:keep upgrade_v1\n', '    // dextrin:keep upgrade_v1\n    fields.x = 1; /* a comment */\n'));

      unlinkSync(join(root, 'schemas/acme/shop/Pet.dxns'));
      generate(root);
      const text = read(gen);
      expect(text).to.include('// dextrin:keep orphaned_upgrade_v1');
      expect(text).to.include('fields.x = 1; /* a comment *\\/');
      const twice = read(gen);
      generate(root);
      expect(read(gen)).to.equal(twice);
      // Kept in a comment, so the file still loads.
      const { Pet } = await load(root, 'Acme/Shop/Pet.js');
      expect(Pet.read(dxn('%acme.shop/Pet(2){name: "Rex" color: "blue" born: "2019"}')).name).to.equal('Rex');

      expect(check(root).some((p) => p.includes('orphaned_upgrade_v1'))).to.equal(true);
    });

    it("the user's file is never rewritten, and its class name is kept as spelled", () => {
      const root = schemasDir();
      generate(root);
      const own = join(root, 'src/Acme/Shop/Customer.js');
      edit(own, (t) =>
        t
          .replaceAll('AbstractCustomer', 'AbstractClient')
          .replace('class Customer ', 'class Client ')
          .replace(/\n\}\n$/, "\n\n  mine() {\n    return 'kept';\n  }\n}\n")
      );

      generate(root);
      expect(read(own)).to.include("return 'kept';");
      expect(existsSync(join(root, 'src/Acme/Shop/AbstractClient.js'))).to.equal(true);
      expect(existsSync(join(root, 'src/Acme/Shop/AbstractClient.d.ts'))).to.equal(true);
      expect(existsSync(join(root, 'src/Acme/Shop/AbstractCustomer.js'))).to.equal(false);
      expect(existsSync(join(root, 'src/Acme/Shop/AbstractCustomer.d.ts'))).to.equal(false);
      expect(read(join(root, 'src/Acme/Shop/AbstractClient.js'))).to.include('export class AbstractClient {');
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.js'))).to.include("import { Client as $Client } from './Customer.js';");
      expect(check(root)).to.deep.equal([]);
    });

    it("the user's file renamed to .ts is still found, and imported as .js", () => {
      const root = schemasDir();
      generate(root);
      renameSync(join(root, 'src/Acme/Shop/Customer.js'), join(root, 'src/Acme/Shop/Customer.ts'));

      const written = generate(root);
      expect(written).to.not.include(join(root, 'src/Acme/Shop/Customer.js'));
      expect(existsSync(join(root, 'src/Acme/Shop/Customer.js'))).to.equal(false);
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.js'))).to.include("from './Customer.js';");
      expect(check(root)).to.deep.equal([]);
    });

    it("a user's file moved to another directory takes its generated parent along", () => {
      const root = schemasDir();
      generate(root);
      mkdirSync(join(root, 'src/People'));
      renameSync(join(root, 'src/Acme/Shop/Customer.js'), join(root, 'src/People/Customer.js'));
      expect(check(root).some((p) => p.includes('AbstractCustomer.js'))).to.equal(true);

      generate(root);
      expect(existsSync(join(root, 'src/People/AbstractCustomer.js'))).to.equal(true);
      expect(existsSync(join(root, 'src/Acme/Shop/AbstractCustomer.js'))).to.equal(false);
      expect(read(join(root, 'src/Acme/Shop/AbstractOrder.js'))).to.include("from '../../People/Customer.js';");
    });

    it('two files claiming one schema are refused, naming both', () => {
      const root = schemasDir();
      generate(root);
      writeFileSync(join(root, 'src/Acme/Shop/Copy.js'), read(join(root, 'src/Acme/Shop/Customer.js')));
      const err = refusal(() => generate(root));
      expect(err).to.be.instanceOf(Codegen.CodegenError);
      expect(err.message).to.include('Customer.js');
      expect(err.message).to.include('Copy.js');
      expect(err.message).to.include('acme.shop/Customer');
    });

    it("a schema named like another's generated parent is refused, naming both, and nothing is written", () => {
      const root = schemasDir({ 'acme/Order.dxns': '%{Order: %schema{a: :string}}', 'acme/AbstractOrder.dxns': '%{AbstractOrder: %schema{a: :string}}' });
      const err = refusal(() => generate(root));
      expect(err).to.be.instanceOf(Codegen.CodegenError);
      expect(err.message).to.include('acme/AbstractOrder');
      expect(err.message).to.include('acme/Order');
      expect(existsSync(join(root, 'src'))).to.equal(false);
    });

    it('a schema named like the decoder is refused', () => {
      const root = schemasDir({ 'Decoder.dxns': '%{Decoder: %schema{a: :string}}' });
      expect(refusal(() => generate(root)).message).to.include('the generated decoder and the schema Decoder');
    });
  });

  describe('--check', () => {
    it('passes when the files are up to date, and names the stale ones otherwise', () => {
      const root = schemasDir();
      generate(root);
      expect(check(root)).to.deep.equal([]);

      writeFileSync(join(root, 'schemas/acme/shop/Customer.dxns'), '%{Customer: %schema{name: :string, code?: acme.shop/Code, vip?: :boolean}}');
      const problems = check(root);
      expect(problems.some((p) => p.includes('AbstractCustomer.js is out of date'))).to.equal(true, problems.join('\n'));
      expect(problems.some((p) => p.includes('AbstractCustomer.d.ts is out of date'))).to.equal(true, problems.join('\n'));
    });
  });

  describe('decoding into the generated classes', () => {
    it('Decoder.decode reads every known struct with the generated methods, wherever it stands', async () => {
      const root = schemasDir();
      generate(root);
      edit(join(root, 'src/Acme/Shop/Pet.js'), (t) => t.replace(/\n\}\n$/, PET_UPGRADE));
      const Decoder = await load(root, 'Decoder.js');
      const { Customer } = await load(root, 'Acme/Shop/Customer.js');

      const value = Decoder.decode('[%acme.shop/Customer{name: "Ada"} %{k: %acme.shop/Customer{name: "Bo"}} 3 %x/Y{}]');
      expect(value).to.be.instanceOf(DXNList);
      const [ada, map, three, other] = value.items;
      expect(ada).to.be.instanceOf(Customer);
      expect(ada.name).to.equal('Ada');
      expect(map.get(new DXNKeyword('k'))).to.be.instanceOf(Customer);
      expect(three).to.equal(3n);
      expect(other).to.be.instanceOf(DXNStruct);
      expect(Decoder.CLASSES['acme.shop/Customer']).to.equal(Customer);

      const err = refusal(() => Decoder.decode('[%acme.shop/Customer{}]'));
      expect(err).to.be.instanceOf(InvalidData);
      expect(err.message).to.include('name');
    });
  });

  describe('deprecation warnings when data goes through generated code', () => {
    /** @type {any[]} */
    let heard;
    const hear = (/** @type {any} */ w) => heard.push(w);
    beforeEach(() => {
      heard = [];
    });

    async function deprecated() {
      const root = schemasDir(DEPRECATED_SCHEMAS);
      generate(root);
      return root;
    }

    it('a struct read at a deprecated version warns, once by default', async () => {
      const root = await deprecated();
      const { Box } = await load(root, 'Dep/Box.js');
      const v1 = dxn('%dep/Box(1){a: "x"}');

      expect(Box.read(v1, { onDeprecated: hear }).a).to.equal('x');
      Box.read(v1, { onDeprecated: hear });
      expect(heard).to.deep.equal([{ name: 'dep/Box', version: 1, message: 'use Box(2)', category: 'schema/deprecated', at: null }]);

      Box.read(dxn('%dep/Box(2){a: "x"}'), { onDeprecated: hear });
      expect(heard).to.have.length(1);
    });

    it('a schema whose latest version is deprecated warns whatever version is read', async () => {
      const root = await deprecated();
      const { Old } = await load(root, 'Dep/Old.js');
      Old.read(dxn('%dep/Old{a: "x"}'), { onDeprecated: hear });
      expect(heard.map((w) => [w.name, w.version, w.message])).to.deep.equal([['dep/Old', 1, null]]);
    });

    it("'every' warns at each use, 'off' never, 'error' refuses", async () => {
      const root = await deprecated();
      const { Box } = await load(root, 'Dep/Box.js');
      const v1 = dxn('%dep/Box(1){a: "x"}');

      Box.read(v1, { deprecations: 'every', onDeprecated: hear });
      Box.read(v1, { deprecations: 'every', onDeprecated: hear });
      expect(heard).to.have.length(2);
      Box.read(v1, { deprecations: 'off', onDeprecated: hear });
      expect(heard).to.have.length(2);

      const err = refusal(() => Box.read(v1, { deprecations: 'error', onDeprecated: hear }));
      expect(err).to.be.instanceOf(InvalidData);
      expect(err.message).to.equal('dep/Box(1) is deprecated: use Box(2)');
      expect(err.category).to.equal('schema/deprecated');
      expect(heard).to.have.length(2);
    });

    it('an unknown mode is refused', async () => {
      const root = await deprecated();
      const { Box } = await load(root, 'Dep/Box.js');
      expect(() => Box.read(dxn('%dep/Box(2){a: "x"}'), { deprecations: 'sometimes' })).to.throw(RangeError, 'sometimes');
    });

    it('a deprecated type, enum value or variant warns when a value goes through it', async () => {
      const root = await deprecated();
      const { Item } = await load(root, 'Dep/Item.js');

      Item.read(dxn('%dep/Item{color: :old}'), { deprecations: 'every', onDeprecated: hear });
      expect(heard.map((w) => w.message)).to.deep.equal(['use red']);
      Item.read(dxn('%dep/Item{color: :red note: "n"}'), { deprecations: 'every', onDeprecated: hear });
      expect(heard.map((w) => w.message)).to.deep.equal(['use red', 'use text']);
      Item.read(dxn('%dep/Item{pet: %{barks: true}}'), { deprecations: 'every', onDeprecated: hear });
      expect(heard.map((w) => w.message)).to.deep.equal(['use red', 'use text', 'no dogs']);
    });

    it('a deprecated variant tried and refused stays silent', async () => {
      const root = await deprecated();
      const { Item } = await load(root, 'Dep/Item.js');
      Item.read(dxn('%dep/Item{pet: %{meows: true}}'), { deprecations: 'every', onDeprecated: hear });
      expect(heard).to.deep.equal([]);
    });

    it("with 'error', a deprecated value refuses the struct holding it", async () => {
      const root = await deprecated();
      const { Item } = await load(root, 'Dep/Item.js');
      const err = refusal(() => Item.read(dxn('%dep/Item{color: :old}'), { deprecations: 'error' }));
      expect(err).to.be.instanceOf(InvalidData);
      expect(err.message).to.include('deprecated: use red');
    });

    it("'once' is per generated class", async () => {
      const root = await deprecated();
      const first = schemasDir(DEPRECATED_SCHEMAS);
      generate(first);
      const { Box } = await load(root, 'Dep/Box.js');
      const { Box: Other } = await load(first, 'Dep/Box.js');
      Box.read(dxn('%dep/Box(1){a: "x"}'), { onDeprecated: hear });
      Other.read(dxn('%dep/Box(1){a: "x"}'), { onDeprecated: hear });
      expect(heard).to.have.length(2);
    });

    it("without onDeprecated, the warning is the process's DeprecationWarning", async () => {
      const root = await deprecated();
      const { Box } = await load(root, 'Dep/Box.js');
      const emitted = [];
      const original = process.emitWarning;
      process.emitWarning = /** @type {any} */ ((/** @type {unknown[]} */ ...args) => emitted.push(args));
      try {
        Box.read(dxn('%dep/Box(1){a: "x"}'));
      } finally {
        process.emitWarning = original;
      }
      expect(emitted).to.deep.equal([['dep/Box(1) is deprecated: use Box(2)', { type: 'DeprecationWarning', code: 'DXN_DEPRECATED' }]]);
    });

    it('Decoder.decode takes the same options', async () => {
      const root = await deprecated();
      const Decoder = await load(root, 'Decoder.js');
      Decoder.decode('[%dep/Box(1){a: "x"} %dep/Box(1){a: "y"}]', { deprecations: 'every', onDeprecated: hear });
      expect(heard.map((w) => w.name)).to.deep.equal(['dep/Box', 'dep/Box']);
      expect(() => Decoder.decode('[%dep/Box(1){a: "x"}]', { deprecations: 'error' })).to.throw(InvalidData);
    });
  });

  describe('what the generator does not write yet', () => {
    it('is refused, naming every schema, version and field that uses it, and nothing is written', () => {
      const root = schemasDir({
        'a/Pair.dxns': '%{Pair: %schema{pair: {:tuple-of :string :integer} name: :string}}',
        'a/Tags.dxns': '%{Tags: %schema{tags: {:set-of :string}}}',
        'a/Fine.dxns': '%{Fine: %schema{name: :string}}'
      });
      const err = refusal(() => generate(root));
      expect(err).to.be.instanceOf(Codegen.CodegenError);
      expect(err.problems).to.have.length(2);
      expect(err.problems[0]).to.equal('a/Pair(1): field pair: {:tuple-of ...} is not generated yet');
      expect(err.problems[1]).to.include('a/Tags(1): field tags:');
      expect(existsSync(join(root, 'src'))).to.equal(false);
    });

    it('typed extras are refused, named as DXNS writes them', () => {
      const root = schemasDir({ 'a/Bag.dxns': '%{Bag: %schema{inner: %shape{a: :string * :string => :integer}}}' });
      expect(refusal(() => generate(root)).problems).to.deep.equal(['a/Bag(1): field inner: typed extras (`* K => V`) are not generated yet']);
    });

    it('typed extras on a schema itself are refused too', () => {
      const root = schemasDir({ 'a/Ext.dxns': '%{Ext: %schema{a: :string * :string => :integer}}' });
      expect(refusal(() => generate(root)).problems).to.deep.equal(['a/Ext(1): typed extras (`* K => V`) are not generated yet']);
    });

    it('schemas that do not load are refused with their file and line', () => {
      const root = schemasDir({ 'a/Bad.dxns': '%{Bad: %schema{a: :nope}}' });
      const err = refusal(() => generate(root));
      expect(err).to.be.instanceOf(Codegen.CodegenError);
      expect(err.problems[0]).to.match(/^a\/Bad\.dxns:1: /);
    });
  });

  describe('a closed schema (- *)', () => {
    it('refuses a field its version does not declare, before any field is checked', async () => {
      const root = schemasDir({ 'a/Shut.dxns': '%{Shut: %schema{a: :string - *}}', 'a/Open.dxns': '%{Open: %schema{a: :string}}' });
      generate(root);
      const { Shut } = await load(root, 'A/Shut.js');
      const { Open } = await load(root, 'A/Open.js');

      expect(Open.read(dxn('%a/Open{a: "x" b: 1}')).a).to.equal('x');
      expect(Shut.read(dxn('%a/Shut{a: "x"}')).a).to.equal('x');
      const err = refusal(() => Shut.read(dxn('%a/Shut{a: 1 b: 1}')));
      expect(err.message).to.equal('field "b" is not declared, and the schema takes no other');
      expect(err.category).to.equal('schema/undeclared-field');
    });
  });

  describe('defaults and absent fields', () => {
    it('a computed default is computed when a value is read, not when the code is written', async function () {
      const root = schemasDir({ 'a/Stamp.dxns': '%{Stamp: %schema{at: %field{type: :timestamp computed: :now}}}' });
      generate(root);
      const first = read(join(root, 'src/A/AbstractStamp.js'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      generate(root);
      expect(read(join(root, 'src/A/AbstractStamp.js'))).to.equal(first);

      const { Stamp } = await load(root, 'A/Stamp.js');
      const before = BigInt(Date.now()) * 1_000_000n;
      const at = Stamp.read(dxn('%a/Stamp{}')).at;
      expect(at).to.be.instanceOf(DXNDateTime);
      expect(at.epochNanoseconds >= before).to.equal(true);
    });

    it('a field that must be absent has no check, and refuses a value', async () => {
      const root = schemasDir({ 'a/Gone.dxns': '%{Gone: %schema{old?: :never inner: %shape{x?: :never y: :string}}}' });
      generate(root);
      const { Gone } = await load(root, 'A/Gone.js');

      expect(Gone.read(dxn('%a/Gone{inner: %{y: "a"}}')).old).to.equal(undefined);
      expect(refusal(() => Gone.read(dxn('%a/Gone{old: 1 inner: %{y: "a"}}'))).message).to.equal('old: no value is allowed here');
      expect(refusal(() => Gone.read(dxn('%a/Gone{inner: %{x: 1 y: "a"}}'))).message).to.equal('inner.x: no value is allowed here');
    });
  });

  describe('dextrin gen-js', () => {
    /** @param {string[]} args */
    function command(args) {
      const run = spawnSync(process.execPath, [CLI, 'gen-js', ...args], { encoding: 'utf8' });
      return { status: run.status, out: `${run.stdout}${run.stderr}` };
    }

    it('writes the files, and --check reports what is out of date', () => {
      const root = schemasDir();
      const args = [join(root, 'schemas'), '--out', join(root, 'src')];

      let run = command(args);
      expect(run.status).to.equal(0, run.out);
      expect(run.out).to.include(`wrote ${join(root, 'src/Acme/Shop/AbstractOrder.js')}`);

      run = command([...args, '--check']);
      expect(run.status).to.equal(0, run.out);
      expect(run.out).to.include('up to date');

      unlinkSync(join(root, 'src/Acme/Shop/AbstractOrder.js'));
      run = command([...args, '--check']);
      expect(run.status).to.equal(1, run.out);
      expect(run.out).to.include('AbstractOrder.js is missing');
    });

    it('without --out it says how it is used', () => {
      const run = command(['schemas']);
      expect(run.status).to.equal(1);
      expect(run.out).to.include('usage: dextrin gen-js SCHEMAS... --out DIR [--check]');
    });
  });

  describe('the generated fixture (test/fixtures/codegen)', () => {
    before(() => {
      // The declarations the fixture's TypeScript is checked against.
      execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.types.json')], { cwd: ROOT, stdio: 'pipe' });
    });

    it('is up to date with its schemas', () => {
      expect(Codegen.check([join(FIXTURE, 'schemas')], join(FIXTURE, 'generated'))).to.deep.equal([]);
    });

    it('passes tsc --strict: the declarations and a TypeScript consumer', () => {
      const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(FIXTURE, 'tsconfig.json')], { cwd: ROOT, encoding: 'utf8' });
      expect(run.status).to.equal(0, `${run.stdout}${run.stderr}`);
    });

    it('passes tsc --strict --checkJs: the .js as JSDoc, on its own (beside its .d.ts, tsc would read only that)', () => {
      const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(FIXTURE, 'tsconfig.js.json')], { cwd: ROOT, encoding: 'utf8' });
      expect(run.status).to.equal(0, `${run.stdout}${run.stderr}`);
    });

    it('a TypeScript class missing its hand-written upgrade does not compile', () => {
      const dir = mkdtempSync(join(FIXTURE, 'tmp-'));
      roots.push(dir);
      writeFileSync(
        join(dir, 'Bad.ts'),
        "import { AbstractPet } from '../generated/Acme/Shop/AbstractPet.js';\n\nexport class Bad extends AbstractPet {\n  static {\n    this.verify();\n  }\n}\n"
      );
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({ extends: '../tsconfig.json', include: ['Bad.ts'] })
      );
      const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')], { cwd: ROOT, encoding: 'utf8' });
      expect(run.status).to.not.equal(0);
      expect(run.stdout).to.include('upgradeV1');
    });

    it('reads an upgraded Pet', async () => {
      const { Pet } = await import('../fixtures/codegen/generated/Acme/Shop/Pet.js');
      const pet = Pet.read(dxn('%acme.shop/Pet(1){name: "Rex" colour: "red" born: 2019}'), { deprecations: 'off' });
      expect([pet.name, pet.color, pet.born]).to.deep.equal(['Rex', 'red', '2019']);
    });

    it('reads every form it generates', async () => {
      const { Sink } = await import('../fixtures/codegen/generated/Acme/Shop/Sink.js');
      const fields = 'first-name: "Ada" count: "3" scores: %{"a" => 1.5} both: 2 odd: 1 pick: 7 tree: %{label: "root" children: [%{label: "leaf"}]} closed: %{a: "x"}';
      const sink = Sink.read(dxn(`%acme.shop/Sink{${fields}}`));
      expect([sink.firstName, sink.count, sink.both, sink.odd, sink.pick, sink.seen]).to.deep.equal(['Ada', '3', 2n, 1n, 7n, false]);
      expect(sink.at).to.be.instanceOf(DXNDateTime);
      expect(sink.gone).to.equal(undefined);
      sink.validate();

      /** @type {Array<[string, string]>} */
      const cases = [
        ['both: 0', 'both: '],
        ['odd: "s"', 'odd: "s" is what is excluded'],
        ['pick: 10', 'pick: 10 does not meet'],
        ['scores: %{"a" => 1}', 'scores.'],
        ['closed: %{a: "x" b: 1}', 'closed: :b is no field, and the shape is closed'],
        ['tree: %{label: "r" children: [%{label: 1}]}', 'tree.children[0].label: expected string']
      ];
      const base = 'first-name: "Ada" count: 3 scores: %{"a" => 1.5} both: 2 odd: 1 pick: 7 tree: %{label: "root"} closed: %{a: "x"}';
      for (const [change, why] of cases) {
        const field = change.split(':')[0];
        const text = base.replace(new RegExp(`\\b${field}: (%\\{[^}]*\\}\\]?\\}?|\\S+)`), change);
        const err = refusal(() => Sink.read(dxn(`%acme.shop/Sink{${text}}`)));
        expect(err.message.startsWith(why)).to.equal(true, `${change}: ${err.message}`);
      }
    });
  });
});
