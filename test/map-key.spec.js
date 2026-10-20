import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, DXNError } from '../src/dextrin.js';
import DXNChar from '../src/values/char.js';
import DXNMap from '../src/values/map.js';
import DXNOrderedMap from '../src/values/ordered-map.js';

// DXN.md §1.6: a map key is a string, keyword, integer, uuid, objectid, date,
// bytes, symbol or char, and anything else is refused as key/not-allowed
// -- in text, in binary, and when encoding. Two keys are the same key
// exactly when their canonical forms are.
const refused = (fn) => expect(fn).to.throw(DXNError).with.property('category', 'key/not-allowed');
const hex = (s) => new Uint8Array(Buffer.from(s, 'hex'));

describe('map keys', () => {
  it('decodes the eight allowed types', () => {
    const m = decode('%{"a" => 1, :b => 2, 3 => 3, sym => 4, ?c => 5, @date "2026-10-17" => 6, @bytes "AAE=" => 7}');
    expect(m.size).to.equal(7);
  });

  it('refuses a float, nil, boolean, NaN and a list key in text', () => {
    refused(() => decode('%{1.5 => 1}'));
    refused(() => decode('%{nil => 1}'));
    refused(() => decode('%{true => 1}'));
    refused(() => decode('%{NaN => 1}'));
    refused(() => decode('%{[1 2] => 1}'));
  });

  it('refuses the same keys in an ordered map', () => {
    refused(() => decode('@ordered %{1.5 => 1}'));
  });

  it('refuses a float and a nil key in binary', () => {
    refused(() => decodeBinary(hex('445801a1fb3ff800000000000001')));
    refused(() => decodeBinary(hex('445801a1f601')));
  });

  it('refuses a float key when encoding, text and binary', () => {
    refused(() => encode(new Map([[1.5, 1n]])));
    refused(() => encodeBinary(new Map([[1.5, 1n]])));
    refused(() => encode(new DXNOrderedMap([[null, 1n]])));
  });

  it('merges a repeated key by its value, keeping the last', () => {
    const m = decode('%{?c => 1, ?c => 2}');
    expect(m.size).to.equal(1);
    expect(m.get(new DXNChar(0x63))).to.equal(2n);
  });

  it('finds a key by an equal value, not only the same object', () => {
    const m = new DXNMap([[new DXNChar(0x63), 1n]]);
    expect(m.has(new DXNChar(0x63))).to.equal(true);
    expect(m.get(new DXNChar(0x63))).to.equal(1n);
    m.set(new DXNChar(0x63), 2n);
    expect(m.size).to.equal(1);
    expect(m.delete(new DXNChar(0x63))).to.equal(true);
    expect(m.size).to.equal(0);
  });

  it('is still a Map', () => {
    expect(decode('%{a: 1}')).to.be.instanceOf(Map);
  });
});
