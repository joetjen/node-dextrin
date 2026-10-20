import { expect } from 'chai';
import { canonical, decode, decodeBinary, encodeBinary, DXNError, DXNIp, DXNObjectId, Registry, Schema } from '../src/dextrin.js';

// `@objectid` and `@ip`, built in like `@uuid` (Jan, 2026-10-20; DXN.md
// §1.2): readable in text, their raw bytes in `.dxnb`, the smallest form
// that keeps them. Ported from dextrin's test/objectid_ip_test.exs.

/** The category `text` is refused with, or `null` when it decodes. @param {string} text */
const category = (text) => {
  try {
    decode(text);
    return null;
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return /** @type {DXNError} */ (err).category;
  }
};

/** `text` decoded and printed in canonical form. @param {string} text */
const canonicalOf = (text) => canonical(decode(text));

/** `text` decoded and written as `.dxnb`, without its envelope. @param {string} text */
const binary = (text) => {
  const bytes = encodeBinary(decode(text));
  expect(Array.from(bytes.subarray(0, 3))).to.deep.equal([0x44, 0x58, 1]);
  return bytes.subarray(3);
};

describe('@objectid', () => {
  it('parses 24 hex digits in either case and formats them lowercase', () => {
    expect(DXNObjectId.fromString('507F1F77BCF86CD799439011').toString()).to.equal('507f1f77bcf86cd799439011');
  });

  it('is 24 hex digits, either case read, lowercase written', () => {
    expect(canonicalOf('@objectid "507F1F77BCF86CD799439011"')).to.equal('@objectid "507f1f77bcf86cd799439011"');
  });

  it('is 12 raw bytes in .dxnb, under tag 221', () => {
    const item = binary('@objectid "507f1f77bcf86cd799439011"');
    // 0xD8 0xDD: tag 221; 0x4C: a 12-byte byte string.
    expect(Array.from(item.subarray(0, 3))).to.deep.equal([0xd8, 221, 0x4c]);
    expect(Buffer.from(item.subarray(3)).toString('hex')).to.equal('507f1f77bcf86cd799439011');
    const back = decodeBinary(Buffer.concat([Buffer.from([0x44, 0x58, 1]), item]));
    expect(back).to.be.instanceOf(DXNObjectId);
  });

  it('refuses anything but 24 hex digits', () => {
    for (const bad of ['507f1f77bcf86cd79943901', '507f1f77bcf86cd79943901g', '']) {
      expect(category(`@objectid "${bad}"`), bad).to.equal('syntax');
    }
  });

  it('may be a map key', () => {
    expect(() => decode('%{@objectid "507f1f77bcf86cd799439011" => 1}')).to.not.throw();
  });
});

describe('@ip', () => {
  it('parses an address or a prefix and formats it canonically', () => {
    expect(DXNIp.fromString('2001:DB8:0:0::/32').toString()).to.equal('2001:db8::/32');
    expect(DXNIp.fromString('192.0.2.1').version).to.equal(4);
    expect(DXNIp.fromString('2001:db8::1').version).to.equal(6);
  });

  it('is an address or a prefix, IPv4 or IPv6, in their canonical text', () => {
    expect(canonicalOf('@ip "192.0.2.1"')).to.equal('@ip "192.0.2.1"');
    expect(canonicalOf('@ip "10.0.0.0/8"')).to.equal('@ip "10.0.0.0/8"');
    expect(canonicalOf('@ip "2001:DB8:0:0:0:0:0:1"')).to.equal('@ip "2001:db8::1"');
    expect(canonicalOf('@ip "2001:db8::/32"')).to.equal('@ip "2001:db8::/32"');
  });

  it('writes IPv6 as RFC 5952 and Erlang\'s :inet.ntoa do', () => {
    const cases = {
      '::': '::',
      '::1': '::1',
      '1::': '1::',
      '1:0:0:1:0:0:0:1': '1:0:0:1::1',
      // A tie: the first run of zeros is the one compressed.
      '1:0:0:1:0:0:1:1': '1::1:0:0:1:1',
      // A single zero group is never compressed.
      '::2:3:4:5:6:7:8': '0:2:3:4:5:6:7:8',
      '1:2:3:4:5:6:7::': '1:2:3:4:5:6:7:0',
      '::0001': '::1',
      'abcd:EF01:2345:6789:abcd:ef01:2345:6789': 'abcd:ef01:2345:6789:abcd:ef01:2345:6789',
      // The IPv4 forms embedded as :inet.ntoa writes them.
      '::ffff:1.2.3.4': '::ffff:1.2.3.4',
      '::ffff:abcd:1': '::ffff:171.205.0.1',
      '::1.2.3.4': '::1.2.3.4',
      '::0.1.0.0': '::0.1.0.0',
      '::0.0.0.1': '::1',
      '64:ff9b::1.2.3.4': '64:ff9b::102:304',
      '1:2:3:4:5:6:1.2.3.4': '1:2:3:4:5:6:102:304',
      // A link-local address with a second group is written out, not
      // with the scope :inet.ntoa appends (`fe80::1%01`), which no reader
      // reads back.
      'fe80:1::1': 'fe80:1::1'
    };
    for (const [text, written] of Object.entries(cases)) {
      expect(DXNIp.fromString(text).toString(), text).to.equal(written);
    }
  });

  it('is raw bytes in .dxnb, RFC 9164: an address whole, a prefix trimmed', () => {
    // 0xD8 0x34: tag 52; 0x44: a 4-byte byte string.
    expect(Array.from(binary('@ip "192.0.2.1"'))).to.deep.equal([0xd8, 52, 0x44, 192, 0, 2, 1]);
    // [8, h'0a']: the length, then the bytes without trailing zeros.
    expect(Array.from(binary('@ip "10.0.0.0/8"'))).to.deep.equal([0xd8, 52, 0x82, 8, 0x41, 10]);
    // 0xD8 0x36: tag 54.
    const v6 = binary('@ip "2001:db8::1"');
    expect(Array.from(v6.subarray(0, 3))).to.deep.equal([0xd8, 54, 0x50]);
    expect(v6.length).to.equal(19);

    for (const text of ['@ip "192.0.2.1"', '@ip "10.0.0.0/8"', '@ip "2001:db8::/32"', '@ip "::/0"']) {
      const value = decode(text);
      const back = decodeBinary(encodeBinary(value));
      expect(back, text).to.be.instanceOf(DXNIp);
      expect(/** @type {DXNIp} */ (back).equals(value), text).to.equal(true);
    }
  });

  it('refuses a prefix with host bits set, a zone, or a shorthand address', () => {
    for (const bad of ['10.0.0.1/8', '10.0.0.0/33', 'fe80::1%eth0', '10.1', 'nope']) {
      expect(category(`@ip "${bad}"`), bad).to.equal('syntax');
    }
  });

  it('refuses what a strict reader refuses', () => {
    const bad = [
      '010.0.0.1', '1.2.3.04', '+1.2.3.4', '1.+2.3.4', '256.0.0.1', '1.2.3.4.', '1.2.3.4/08', '1.2.3.4/',
      '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8::', '::00001', '1::2::3', ':1::2', '[::1]', ' ::1', '::/129',
      '::ffff:01.2.3.4', '1:2:3:4:5:6:7:1.2.3.4', '1.2.3.4/8/8'
    ];
    for (const text of bad) {
      expect(() => DXNIp.fromString(text), text).to.throw(TypeError);
    }
  });

  it('refuses a binary prefix whose host bits are set', () => {
    // tag 52, [8, h'0a01']: 10.1.0.0/8.
    const bytes = Buffer.from([0x44, 0x58, 1, 0xd8, 52, 0x82, 8, 0x42, 10, 1]);
    expect(() => decodeBinary(bytes)).to.throw(DXNError, /host bits/);
  });

  it('may not be a map key', () => {
    expect(category('%{@ip "192.0.2.1" => 1}')).to.equal('key/not-allowed');
  });
});

describe('@objectid and @ip in schemas', () => {
  /** A registry where `T` has one field `v` of type `type`. @param {string} type */
  const registryFor = (type) => Schema.compile(decode(`%{T: %schema{v: ${type}}}`), new Registry());
  /** Whether `%T{v: value}` decodes. @param {Registry} registry @param {string} value */
  const takes = (registry, value) => {
    try {
      decode(`%T{v: ${value}}`, { registry });
      return true;
    } catch {
      return false;
    }
  };

  it('has :objectid and :ip, and an ip\'s version and prefix', () => {
    expect(takes(registryFor(':objectid'), '@objectid "507f1f77bcf86cd799439011"')).to.equal(true);
    expect(takes(registryFor(':objectid'), '"507f1f77bcf86cd799439011"')).to.equal(false);

    const v6 = registryFor('{:refine :ip %{version: 6, prefix: false}}');
    expect(takes(v6, '@ip "2001:db8::1"')).to.equal(true);
    expect(takes(v6, '@ip "192.0.2.1"')).to.equal(false);
    expect(takes(v6, '@ip "2001:db8::/32"')).to.equal(false);

    const prefix4 = registryFor('{:refine :ip %{version: 4, prefix: true}}');
    expect(takes(prefix4, '@ip "10.0.0.0/8"')).to.equal(true);
    expect(takes(prefix4, '@ip "10.0.0.1"')).to.equal(false);
  });
});
