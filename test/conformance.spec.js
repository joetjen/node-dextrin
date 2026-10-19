import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answer, decode, decodeBinary, encode, DXNError } from '../src/dextrin.js';

// This implementation's adapter for the Dextrin Conformance Suite, and
// the error categories (DXN.md §5) it answers errors with.
const answered = (cases) => answer({ cases }).results;

describe('error categories', () => {
  it('a text decode that does not parse is a syntax error', () => {
    expect(() => decode('[1 2')).to.throw(DXNError).with.property('category', 'syntax');
  });

  it('bytes without the magic are a binary error', () => {
    expect(() => decodeBinary(new Uint8Array([0x18, 0x2a])))
      .to.throw(DXNError)
      .with.property('category', 'binary');
  });

  it('a value with no DXN meaning is an encode error', () => {
    expect(() => encode(() => 1)).to.throw(DXNError).with.property('category', 'encode/unsupported');
  });
});

describe('conformance adapter', () => {
  const USER = '%{User: %schema(2){name: :string}}';

  it("loads a case's schemas before it runs", () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '%User{name: "x"}', schemas: [USER] }])).to.deep.equal([
      { id: 'a', canonical: '%User(2){name: "x"}' },
    ]);
  });

  it('and answers a schema violation with its category', () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '%User{name: 1}', schemas: [USER] }])).to.deep.equal([
      { id: 'a', error: 'schema/type-mismatch' },
    ]);
  });

  it('decodes a strict case strictly', () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '%User{name: "x", nick: "y"}', schemas: [USER], strict: true }])).to.deep.equal([
      { id: 'a', error: 'schema/undeclared-field' },
    ]);
  });

  it('encodes a struct decoded against a schema under its versioned type name', () => {
    expect(answered([{ id: 'a', operation: 'encode', text: '%User{name: "x"}', schemas: [USER] }])).to.deep.equal([
      { id: 'a', binary: Buffer.from('445801d8d082675573657228322961' + '78', 'hex').toString('base64') },
    ]);
  });

  it('answers a format with the document laid out, its comments kept', () => {
    expect(answered([{ id: 'a', operation: 'format', text: '[1 # one\n 2]' }])).to.deep.equal([{ id: 'a', text: '[\n  1  # one\n  2\n]' }]);
  });

  it('answers an edit with the document rendered after its edits, in order', () => {
    const edits = [
      { op: 'replace', path: '[:name]', value: '"other"' },
      { op: 'delete', path: '[:deps 0]' },
      { op: 'insert', path: '[:deps]', where: '-1', value: '"c"' },
    ];
    const text = '%{\n  name: "acme" # the name\n  deps: ["a" "b"]\n}\n';
    expect(answered([{ id: 'a', operation: 'edit', text, edits }])).to.deep.equal([
      { id: 'a', text: '%{\n  name: "other" # the name\n  deps: ["b" "c"]\n}\n' },
    ]);
  });

  it('answers a refused edit as document/<reason>', () => {
    const edits = [{ op: 'delete', path: '[:nope]' }];
    expect(answered([{ id: 'a', operation: 'edit', text: '%{a: 1}', edits }])).to.deep.equal([{ id: 'a', error: 'document/not-found' }]);
  });

  it('answers a schema that does not compile with its category', () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '1', schemas: ['%{User: 1}'] }])).to.deep.equal([
      { id: 'a', error: 'schema/compile' },
    ]);
  });

  it('answers a decode with the canonical form', () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '%{b: 2, a: 1}' }])).to.deep.equal([
      { id: 'a', canonical: '%{a: 1 b: 2}' }
    ]);
  });

  it('answers text that does not parse with its category', () => {
    expect(answered([{ id: 'a', operation: 'decode', text: '[1 2' }])).to.deep.equal([{ id: 'a', error: 'syntax' }]);
  });

  it('reads binary input as base64', () => {
    expect(answered([{ id: 'a', operation: 'decode-binary', binary: 'RFgBGCo=' }])).to.deep.equal([
      { id: 'a', canonical: '42' }
    ]);
  });

  it('answers malformed bytes with their category', () => {
    expect(answered([{ id: 'a', operation: 'decode-binary', binary: 'GCo=' }])).to.deep.equal([
      { id: 'a', error: 'binary' }
    ]);
  });

  it('answers an encode with the exact bytes as base64, a decimal keeping its scale', () => {
    expect(answered([{ id: 'a', operation: 'encode', text: '42' }])).to.deep.equal([{ id: 'a', binary: 'RFgBGCo=' }]);
    expect(answered([{ id: 'b', operation: 'encode', text: '1.50M' }])).to.deep.equal([
      { id: 'b', binary: 'RFgBxIIhGJY=' }
    ]);
  });

  it('dextrin conformance REQUEST ANSWER reads and writes the files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dextrin-conformance-'));
    const request = join(dir, 'request.json');
    const response = join(dir, 'answer.json');
    writeFileSync(request, JSON.stringify({ cases: [{ id: 'a', operation: 'decode', text: '42' }] }));
    execFileSync(process.execPath, ['bin/dextrin.js', 'conformance', request, response]);
    expect(JSON.parse(readFileSync(response, 'utf8'))).to.deep.equal({ results: [{ id: 'a', canonical: '42' }] });
  });
});
