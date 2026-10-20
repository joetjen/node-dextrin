'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

// A prefix length, as text: no sign, no leading zero.
const LENGTH = /^(0|[1-9][0-9]{0,2})$/;
// One dotted-decimal part: no sign, no leading zero.
const V4_PART = /^(0|[1-9][0-9]{0,2})$/;
const V6_GROUP = /^[0-9a-f]{1,4}$/i;

/**
 * DXN `ip` (`@ip "..."`, Jan, 2026-10-20): an IPv4 or IPv6 address, or a
 * prefix -- an address and a length. `address` holds the raw bytes, 4 or
 * 16; `prefix` is the length, or `null` for an address. A prefix's host
 * bits are zero (RFC 9164). In `.dxnb` it is CBOR's tag 52 or 54, raw
 * bytes. Mirrors `Dextrin.Ip`.
 *
 * The text is strict, as the reference's `:inet.parse_strict_address`:
 * IPv4 is four dotted decimal parts, IPv6 is RFC 4291's groups, an IPv4
 * address allowed as its last two; no shorthand (`10.1`), no zone
 * (`%eth0`), no sign and no leading zero in a decimal part.
 */
class DXNIp {
  /**
   * @param {Uint8Array} address 4 or 16 bytes.
   * @param {number | null} [prefix] the prefix length, or `null` for an address.
   */
  constructor(address, prefix = null) {
    if (!(address instanceof Uint8Array) || (address.length !== 4 && address.length !== 16)) {
      throw new TypeError('DXNIp address must be a 4- or 16-byte Uint8Array');
    }
    if (prefix !== null && (!Number.isInteger(prefix) || prefix < 0 || prefix > address.length * 8)) {
      throw new TypeError(`DXNIp prefix length ${String(prefix)} is not 0 to ${address.length * 8}`);
    }
    if (prefix !== null && !hostBitsZero(address, prefix)) {
      throw new TypeError('DXNIp prefix has host bits that are not zero');
    }
    this.address = address;
    this.prefix = prefix;
  }

  /** @returns {4 | 6} the family. */
  get version() {
    return this.address.length === 4 ? 4 : 6;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /**
   * IPv4 in dotted decimal, IPv6 as RFC 5952 writes it, then `/length`
   * for a prefix.
   * @returns {string}
   */
  toString() {
    const text = this.address.length === 4 ? dotted(this.address) : formatV6(this.address);
    return this.prefix === null ? text : `${text}/${this.prefix}`;
  }

  /**
   * Parses an address, or `address/length`.
   * @param {string} str
   * @returns {DXNIp}
   */
  static fromString(str) {
    const invalid = () => new TypeError(`DXNIp.fromString: invalid ip ${JSON.stringify(str)}`);
    if (typeof str !== 'string') throw invalid();
    const parts = str.split('/');
    if (parts.length > 2) throw invalid();
    const address = addressBytes(parts[0]);
    if (!address) throw invalid();
    if (parts.length === 1) return new DXNIp(address);
    if (!LENGTH.test(parts[1])) throw invalid();
    const length = Number(parts[1]);
    if (length > address.length * 8 || !hostBitsZero(address, length)) throw invalid();
    return new DXNIp(address, length);
  }
}

DXNIp.prototype.dxnType = 'ip';

/**
 * Whether every bit of `bytes` past the first `length` is zero.
 * @param {Uint8Array} bytes
 * @param {number} length
 * @returns {boolean}
 */
function hostBitsZero(bytes, length) {
  for (let i = 0; i < bytes.length; i += 1) {
    const kept = Math.min(8, Math.max(0, length - i * 8));
    if ((bytes[i] & (0xff >> kept)) !== 0) return false;
  }
  return true;
}

/**
 * An address's raw bytes, or `null` when the text is not one.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
function addressBytes(text) {
  return text.includes(':') ? v6Bytes(text) : v4Bytes(text);
}

/** @param {string} text @returns {Uint8Array | null} */
function v4Bytes(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((p) => V4_PART.test(p) && Number(p) <= 255)) return null;
  return new Uint8Array(parts.map(Number));
}

/**
 * RFC 4291's text: eight groups, one run of them written `::`, the last
 * two as an IPv4 address if wanted.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
function v6Bytes(text) {
  // An IPv4 last part is two groups, written as them.
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  let body = text;
  if (last.includes('.')) {
    const v4 = v4Bytes(last);
    if (!v4) return null;
    const hex = Buffer.from(v4).toString('hex');
    body = `${text.slice(0, lastColon + 1)}${hex.slice(0, 4)}:${hex.slice(4)}`;
  }

  const halves = body.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (/** @type {string} */ half) => (half === '' ? [] : half.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (![...head, ...tail].every((g) => V6_GROUP.test(g))) return null;
  // Without `::`, all eight groups; with it, `::` stands for one or more.
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;

  const groups = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail];
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const n = parseInt(g, 16);
    bytes[2 * i] = n >> 8;
    bytes[2 * i + 1] = n & 0xff;
  });
  return bytes;
}

/** @param {Uint8Array} bytes @returns {string} */
function dotted(bytes) {
  return Array.from(bytes).join('.');
}

/**
 * RFC 5952's text, as Erlang's `:inet.ntoa` writes it (the reference's
 * formatter): lowercase hex without leading zeros, the longest run of two
 * or more zero groups as `::` (the first of equal runs), and the IPv4
 * part in dotted decimal for `::a.b.c.d` and `::ffff:a.b.c.d`.
 *
 * One deliberate difference: `:inet.ntoa` writes a link-local `fe80:` or
 * `ff02:` address with a non-zero second group as a scope (`fe80:1::1`
 * as `fe80::1%01`), which is not RFC 5952 and which no reader -- this
 * one included -- reads back. It is written out in groups here.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function formatV6(bytes) {
  /** @type {number[]} */
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  const zeroUpTo = (/** @type {number} */ n) => groups.slice(0, n).every((g) => g === 0);

  if (zeroUpTo(8)) return '::';
  if (zeroUpTo(7) && groups[7] === 1) return '::1';
  if (zeroUpTo(6)) return '::' + dotted(bytes.subarray(12));
  if (zeroUpTo(5) && groups[5] === 0xffff) return '::ffff:' + dotted(bytes.subarray(12));

  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = (/** @type {number[]} */ gs) => gs.map((g) => g.toString(16)).join(':');
  if (bestStart < 0) return hex(groups);
  return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLength))}`;
}

module.exports = DXNIp;
