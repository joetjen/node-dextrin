import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, DXNError, DXNTuple, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// Every struct written against a schema carries the version it was
// written with -- `%Point(2){...}` in text and the type name "Point(2)"
// in binary -- and that version is the latest one loaded, unless the
// struct says a loaded version of its own (DXNS.md §8).
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const V1 = '%{Point: %schema{x: :integer}}';
const V2 = '%{Point: %schema(2){x: :integer, y?: :integer}}';

const loaded = (...sources) =>
  sources
    .reduce((registry, source) => Schema.compile(decode(source), registry), new Registry())
    .putStructModule('Point', Point);

describe('versions in documents', () => {
  describe('a struct written against a schema', () => {
    it('carries the latest version in text', () => {
      expect(encode(new Point(1n, 2n), { registry: loaded(V1, V2) })).to.equal('%Point(2){x:1,y:2}');
    });

    it('carries version 1 when that is the only one, so a reader never has to guess', () => {
      expect(encode(new Point(1n, undefined), { registry: loaded(V1) })).to.equal('%Point(1){x:1}');
    });

    it('carries it when laid out over several lines', () => {
      expect(encode(new Point(1n, 2n), { registry: loaded(V1, V2), pretty: true })).to.match(/^%Point\(2\)\{/);
    });

    it('carries it in binary, as the type name', () => {
      const back = decodeBinary(encodeBinary(new Point(1n, 2n), { registry: loaded(V1, V2) }));
      expect(back.name).to.equal('Point');
      expect(back.version).to.equal(2);
    });

    // Until G11 (2026-11-17) every struct was written as the latest,
    // whatever version it said: there was no way to write an older one. A
    // field pinned to a version (`Pet(1)`) needs that way, so a struct
    // saying a loaded version keeps it; one saying none, or one not
    // loaded, is written as the latest as before.
    it('is written with the version it says when that one is loaded, else the latest', () => {
      expect(encode(DXNStruct.keyed('Point', [['x', 1n]], 1), { registry: loaded(V1, V2) })).to.equal('%Point(1){x:1}');
      expect(encode(DXNStruct.keyed('Point', [['x', 1n]], 7), { registry: loaded(V1, V2) })).to.equal('%Point(2){x:1}');
    });

    it("is written in binary in the schema's field order, whatever order its keys came in", () => {
      const struct = DXNStruct.keyed('Point', [['y', 2n], ['x', 1n]]);
      const back = decodeBinary(encodeBinary(struct, { registry: loaded(V1, V2) }));
      expect(back.fields).to.deep.equal({ type: 'positional', values: [1n, 2n] });
    });
  });

  describe('a struct with no schema', () => {
    it('keeps its own version in binary', () => {
      expect(decodeBinary(encodeBinary(DXNStruct.positional('P', [1n], 3)))).to.deep.equal(
        DXNStruct.positional('P', [1n], 3)
      );
    });

    it('and has none when it was given none', () => {
      expect(decodeBinary(encodeBinary(DXNStruct.positional('P', [1n])))).to.deep.equal(DXNStruct.positional('P', [1n]));
    });
  });

  it('a binary type name whose version is not a positive integer is refused', () => {
    const bytes = encodeBinary(DXNStruct.positional('P(0)', [1n]));
    expect(() => decodeBinary(bytes)).to.throw(DXNError).with.property('category', 'binary');
  });

  it('an untagged struct is read as the latest version', () => {
    const registry = loaded(V1, '%{Point: %schema(2){x: :integer, y: :integer}}');
    expect(() => decode('%Point{x: 1}', { registry })).to.throw(DXNError);
    expect(decode('%Point{x: 1, y: 2}', { registry })).to.deep.equal(
      DXNStruct.keyed('Point', [['x', 1n], ['y', 2n]], 2)
    );
  });

  // Until G11 (2026-11-17) a struct reference named no version and
  // `User(2)` was a syntax error. Now `User(2)` reads as `{:at User 2}`, a
  // reference pinned to version 2 (DXNS.md §5c, pin.spec.js).
  it('a struct reference may name a version: User(2) pins version 2', () => {
    const doc = /** @type {Map<unknown, any>} */ (decode('%{P: %schema{u: User(2)}}'));
    const [schema] = doc.values();
    const [[field, at]] = schema.fields.pairs;
    expect(field).to.equal('u');
    expect(DXNTuple.pinned(at)).to.deep.equal({ name: 'User', version: 2 });
  });
});
