import { expect } from 'chai';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonical, decode, decodeBinary, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// `.dxnb` written by node-dextrin 0.1.0 still reads (the migration notes
// of 0.2.0). The fixtures were written by 0.1.0 itself:
// `test/fixtures/v0.1.0/generate.cjs`.
const fixture = (name) => fs.readFileSync(fileURLToPath(new URL(`../fixtures/v0.1.0/${name}`, import.meta.url)));

// The 0.1.0 `user.dxns`, as 0.2.0 writes it: the body lists the fields
// in the order `fields: @ordered %{...}` gave them.
const V1 = '%{User: %schema{name: :string, email?: :string, role: %field{type: :keyword, default: :member}}}';
const V2 = '%{User: %schema(2){name: :string, email?: :string, role: :keyword, nick?: :string}}';

const loaded = (...sources) =>
  sources.reduce((registry, source) => Schema.compile(decode(source), registry), new Registry());

describe('.dxnb written by 0.1.0', () => {
  // Its text is `values.dxn` as DXN writes it now, `values.respelled.dxn`:
  // dates, times and the regex under their tags (DXN.md §1.2).
  // Compared as canonical forms (DXN.md §1.5): a set of keywords is a set
  // of JS symbols, which chai's deep equality cannot sort.
  it('reads back every value as its text decodes', () => {
    expect(canonical(decodeBinary(fixture('values.dxnb')))).to.equal(
      canonical(decode(fixture('values.respelled.dxn').toString('utf8'))),
    );
  });

  it('holds a struct without a version, read as version 1 of the same schema', () => {
    const user = decodeBinary(fixture('user_full.dxnb'), { registry: loaded(V1) });
    expect(user).to.deep.equal(
      DXNStruct.keyed('User', [['name', 'Ann'], ['email', 'ann@example.com'], ['role', decode(':admin')]], 1),
    );
  });

  it('carries its version once written again', () => {
    const registry = loaded(V1);
    const bytes = encodeBinary(decodeBinary(fixture('user_full.dxnb'), { registry }), { registry });
    expect(Buffer.from(bytes).toString('latin1')).to.include('User(1)');
  });

  it('is read as version 2 once a version 2 is loaded', () => {
    try {
      decodeBinary(fixture('user_full.dxnb'), { registry: loaded(V1, V2) });
    } catch (err) {
      expect(err).to.be.instanceOf(DXNError);
      expect(err.category).to.equal('schema/field-count');
      return;
    }
    throw new Error('expected a refusal');
  });
});
