import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNStruct from '../../src/values/struct.js';

// Every struct written against a schema carries the version it was
// written with -- `%Point(2){...}` in text and the type name "Point(2)"
// in binary -- and that version is always the latest one loaded
// (DXN.md §4.8).
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

    it('is written with the latest version even when it says an older one', () => {
      expect(encode(DXNStruct.keyed('Point', [['x', 1n]], 1), { registry: loaded(V1, V2) })).to.equal(
        '%Point(2){x:1}'
      );
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

  it('a struct reference names no version: User(2) in a type expression is a syntax error', () => {
    expect(() => decode('%{P: %schema{u: User(2)}}')).to.throw(DXNError).with.property('category', 'syntax');
  });
});
