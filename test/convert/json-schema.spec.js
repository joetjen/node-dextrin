import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { encode, Registry, Schema, JsonSchema, DXNList, DXNMap } from '../../src/dextrin.js';

const CLI = fileURLToPath(new URL('../../bin/dextrin.js', import.meta.url));

// The JSON Schema converter's own choices (T674, as dextrin's
// test/convert/json_schema_test.exs): what the official suite does not
// decide -- names, shapes or structs, logical types, MongoDB's bsonType,
// what is kept in meta, and what is reported.
describe('JSON Schema to DXNS', () => {
  /** @param {string} json @param {{[k: string]: unknown}} [opts] */
  const dxns = (json, opts = {}) => {
    const { document, inexact } = JsonSchema.toDxns(['schema.json', json], opts);
    return { text: encode(document, { pretty: true }), doc: document, inexact };
  };

  /** @param {unknown} doc @returns {any} */
  const registry = (doc) => Schema.compile(doc, new Registry());

  /** @param {any} r @param {string} name @param {string} json */
  const takes = (r, name, json) => {
    try {
      return Schema.check(JsonSchema.jsonValue(JsonSchema.decodeJson(json)), r, name);
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  /** @param {() => unknown} fn @returns {string} */
  const refusal = (fn) => {
    try {
      fn();
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
    throw new Error('did not throw');
  };

  it('an object is a shape, its fields in order, those not required optional', () => {
    const { text, inexact } = dxns(
      '{"title": "Order", "type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}, "note": {"type": "string"}}}'
    );
    expect(inexact).to.deep.equal([]);
    expect(text).to.include('Order: {:doc %shape{id: :integer note?: :string} %{title: "Order"}}');
  });

  it('$defs are named entries, and a $ref is the name', () => {
    const { text, doc, inexact } = dxns(
      '{"$defs": {"Money": {"type": "number", "minimum": 0}}, "type": "object", "properties": {"price": {"$ref": "#/$defs/Money"}}}'
    );
    expect(inexact).to.deep.equal([]);
    expect(text).to.include('Money: {:refine :number %{min: 0}}');
    expect(text).to.include('price?: Money');
    expect(takes(registry(doc), 'Root', '{"price": 2}')).to.equal(true);
    expect(takes(registry(doc), 'Root', '{"price": -1}')).to.equal(false);
  });

  it('--structs writes a named object as a %schema', () => {
    const { text, inexact } = dxns(
      '{"$defs": {"Pet": {"type": "object", "properties": {"name": {"type": "string"}}}}, "$ref": "#/$defs/Pet"}',
      { structs: true }
    );
    expect(inexact).to.deep.equal([]);
    expect(text).to.include('Pet: %schema{name?: :string}');
  });

  it('a date-time string is a datetime where formats are checked, a string with meta where not', () => {
    const schema = '{"type": "string", "format": "date-time"}';
    expect(dxns('{"$schema": "http://json-schema.org/draft-07/schema#", "type": "string", "format": "date-time"}').text).to.include(
      'Root: :datetime'
    );
    const { text } = dxns(schema);
    expect(text).to.include(':string');
    expect(text).to.include('"json-schema.format" => "date-time"');
    expect(dxns(schema, { assertFormats: true }).text).to.include('Root: :datetime');
  });

  it('an unknown format is kept in meta and checks nothing', () => {
    const { text, doc, inexact } = dxns('{"type": "string", "format": "postal-code"}', { assertFormats: true });
    expect(inexact).to.deep.equal([]);
    expect(text).to.include('"json-schema.format" => "postal-code"');
    expect(takes(registry(doc), 'Root', '"anything"')).to.equal(true);
  });

  it('patternProperties and additionalProperties: false are * K => V entries and - *', () => {
    const { text, doc, inexact } = dxns(
      '{"type": "object", "properties": {"id": {"type": "integer"}}, "patternProperties": {"^x-": {"type": "string"}}, "additionalProperties": false}'
    );
    expect(inexact).to.deep.equal([]);
    expect(text).to.include('- *');
    expect(text).to.include('* {:refine :string %{pattern:');
    const r = registry(doc);
    expect(takes(r, 'Root', '{"id": 1, "x-a": "s"}')).to.equal(true);
    expect(takes(r, 'Root', '{"id": 1, "x-a": 2}')).to.equal(false);
    expect(takes(r, 'Root', '{"id": 1, "y": 2}')).to.equal(false);
  });

  it('a required property that is no identifier is still required', () => {
    const { doc, inexact } = dxns('{"type": "object", "required": ["a b"]}');
    expect(inexact).to.deep.equal([]);
    const r = registry(doc);
    expect(takes(r, 'Root', '{"a b": 1}')).to.equal(true);
    expect(takes(r, 'Root', '{"a": 1}')).to.equal(false);
  });

  describe('MongoDB', () => {
    it("bsonType maps to DXN's own types", () => {
      const { text, inexact } = dxns(
        '{"bsonType": "object", "required": ["_id"], "properties": {"_id": {"bsonType": "objectId"}, "at": {"bsonType": "date"}, "n": {"bsonType": "long"}, "price": {"bsonType": "decimal"}}}'
      );
      expect(inexact).to.deep.equal([]);
      expect(text).to.include('_id: :objectid');
      expect(text).to.include('at?: {:refine :timestamp %{resolution: :millisecond}}');
      expect(text).to.include('n?: :int64');
      expect(text).to.include('price?: {:refine :decimal %{max-precision: 34}}');
    });

    it('a BSON type with no DXN value is :any, and reported', () => {
      const { inexact } = dxns('{"bsonType": "javascript"}');
      expect(inexact).to.have.length(1);
      expect(inexact[0].why).to.include('javascript');
    });
  });

  it('a $ref to a document not given is an error; nothing is fetched', () => {
    expect(refusal(() => JsonSchema.toDxns(['a.json', '{"$ref": "https://example.com/b.json"}']))).to.include(
      'names no schema among those given'
    );
  });

  it('a $ref to another file given resolves', () => {
    const { document } = JsonSchema.toDxns([
      ['a.json', '{"type": "object", "properties": {"b": {"$ref": "b.json"}}}'],
      ['b.json', '{"title": "B", "type": "integer"}']
    ]);
    expect(takes(registry(document), 'Root', '{"b": 1}')).to.equal(true);
    expect(takes(registry(document), 'Root', '{"b": "x"}')).to.equal(false);
  });

  it('something not a schema is refused', () => {
    expect(refusal(() => JsonSchema.toDxns(['a.json', '12']))).to.include('object or a boolean');
  });

  it('an ECMA-262 pattern reads as JSON Schema means it', () => {
    const { doc, inexact } = dxns('{"type": "string", "pattern": "^\\\\d+$"}');
    expect(inexact).to.deep.equal([]);
    const r = registry(doc);
    expect(takes(r, 'Root', '"123"')).to.equal(true);
    expect(takes(r, 'Root', '"123\\n"')).to.equal(false);
    expect(takes(r, 'Root', '"١٢٣"')).to.equal(false);
  });

  it("a pattern reads code points, as ECMA-262's u flag does", () => {
    let { doc, inexact } = dxns('{"type": "string", "pattern": "^.$"}');
    expect(inexact).to.deep.equal([]);
    expect(takes(registry(doc), 'Root', '"é"')).to.equal(true);
    expect(takes(registry(doc), 'Root', '"😀"')).to.equal(true);
    ({ doc, inexact } = dxns('{"type": "string", "pattern": "^\\u0100$"}'));
    expect(inexact).to.deep.equal([]);
    expect(takes(registry(doc), 'Root', '"Ā"')).to.equal(true);
  });

  it('a keyword set to null reads as one left out', () => {
    const { doc, inexact } = dxns('{"type": "number", "minimum": null}');
    expect(inexact).to.deep.equal([]);
    expect(takes(registry(doc), 'Root', '-5')).to.equal(true);
  });

  // Node's own: where a report from inside a schema says it is.
  it('reports name where they are: draft-04 dependencies, and a contains reached through unevaluatedItems', () => {
    const deps = dxns('{"$schema": "http://json-schema.org/draft-07/schema#", "dependencies": {"a": {"type": "string", "pattern": "[\\\\D]"}}}');
    expect(deps.inexact.map((i) => i.path)).to.deep.equal(['#/dependencies/a/pattern']);
    const items = dxns('{"allOf": [{"contains": {"type": "string", "pattern": "[\\\\D]"}}], "unevaluatedItems": false}');
    expect(items.inexact.map((i) => i.path)).to.deep.equal(['#/allOf/0/contains/pattern', '#/allOf/0/contains/pattern']);
  });

  // Node's own: JSON.parse moves integer-like keys first; the converter's
  // reader keeps every key where it was written.
  describe('reading JSON', () => {
    it('keeps every key in the order written, integer-like keys too', () => {
      const parsed = /** @type {Map<string, unknown>} */ (JsonSchema.decodeJson('{"b": 1, "10": 2, "a": 3, "2": 4}'));
      expect([...parsed.keys()]).to.deep.equal(['b', '10', 'a', '2']);
      const { text } = dxns('{"type": "object", "properties": {"b": {}, "10": {}, "a": {}, "2": {}}}');
      expect(text).to.include('* {:const "10"} => :any * {:const "2"} => :any b?: :any a?: :any');
    });

    it('tells an integer from a float, as the text says', () => {
      const value = /** @type {DXNList} */ (JsonSchema.jsonValue(JsonSchema.decodeJson('[1, 1.0, 1e2, -0, {"a": null}]')));
      expect(value).to.be.instanceOf(DXNList);
      expect(value.items.slice(0, 4)).to.deep.equal([1n, 1, 100, -0n]);
      expect(value.items[4]).to.be.instanceOf(DXNMap);
    });

    it('refuses text that is no JSON', () => {
      expect(refusal(() => JsonSchema.decodeJson('{"a": 1,}'))).to.include('not JSON');
      expect(refusal(() => JsonSchema.decodeJson('1 2'))).to.include('after the JSON value');
    });
  });

  describe('dextrin from-json-schema', () => {
    /** @type {string} */
    let dir;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'dextrin-json-schema-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    /** @param {string[]} args */
    const run = (args) => {
      const result = spawnSync(process.execPath, [CLI, 'from-json-schema', ...args], { encoding: 'utf8' });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };

    it('writes the DXNS, and reports what is not exact', () => {
      const schema = join(dir, 's.json');
      const out = join(dir, 's.dxns');
      writeFileSync(schema, '{"title": "Thing", "bsonType": "javascript"}');
      const result = run([schema, '--out', out]);
      expect(result.status).to.equal(0);
      expect(result.stderr).to.include('inexact: #: bsonType javascript');
      expect(readFileSync(out, 'utf8')).to.include('Thing: {:doc :any %{title: "Thing"}}');
    });

    it('--strict fails on anything not exact', () => {
      const schema = join(dir, 's.json');
      writeFileSync(schema, '{"bsonType": "javascript"}');
      const result = run([schema, '--strict']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('not exact');
    });

    it('writes to standard output, and reads the files under --schemas', () => {
      const schema = join(dir, 'a.json');
      writeFileSync(schema, '{"type": "object", "properties": {"b": {"$ref": "b.json"}}}');
      writeFileSync(join(dir, 'b.json'), '{"title": "B", "type": "integer"}');
      const result = run([schema, '--schemas', dir, '--name', 'Top']);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('Top: %shape{b?: B}');
      expect(result.stdout).to.include('B: {:doc :integer %{title: "B"}}');
    });

  });
});

