'use strict';

/**
 * @fileoverview `.dxnb` decoder — the mirror image of `encoder.cjs`.
 * Envelope (`magic` `version` `cbor_item`) checked once at the top;
 * everything below that is a single recursive `Decoder#decodeItem`,
 * keyed on CBOR major type first, then on tag — matching `DXN.md`
 * §2.2's table row order, mirroring `Dextrin.Binary.Decoder`
 * structurally.
 *
 * Every tag whose payload is itself a nested CBOR item (`arrayOf`/
 * `mapOf` shaped) is decoded uniformly: `decodeItem()` once to get
 * the *already-decoded* payload (a `DXNList`/`Map`/etc., since a bare
 * untagged major-4/5 item decodes to exactly that regardless of what
 * tag wraps it), then a tag-specific builder validates its shape and
 * wraps it — mirroring `Dextrin.Binary.Decoder`'s own
 * `decode_item_raw` + `build_tagged` split. One case is *simpler* here
 * than on the Elixir side: `@ordered`'s map needs no raw-node
 * re-entry hack, because JS `Map` already preserves insertion order
 * (unlike a plain Elixir map) — decoding its payload through the
 * ordinary `Map` path and reading `.entries()` back out already keeps
 * the order `DXNOrderedMap` needs.
 */

const { BinaryError } = require('./errors.cjs');
const Tags = require('./tags.cjs');
const { bigIntToBytes } = require('./writer.cjs');

const DXNChar = require('../values/char.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNDecimal = require('../values/decimal.cjs');
const DXNRational = require('../values/rational.cjs');
const DXNDate = require('../values/date.cjs');
const DXNTime = require('../values/time.cjs');
const DXNTimestamp = require('../values/timestamp.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNDuration = require('../values/duration.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNBytes = require('../values/bytes.cjs');
const DXNRegex = require('../values/regex.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');
const Validator = require('../schema/validator.cjs');
const Validated = require('../schema/validated.cjs');

const MAGIC = 'DX';
const VERSION = 1;
const EPOCH_MS = Date.UTC(1970, 0, 1);
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

/**
 * @param {Uint8Array} bytes
 * @param {{trusted?: boolean, registry?: import('../registry.cjs')}} [opts]
 * @returns {unknown}
 */
function decode(bytes, opts = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 3 || buf[0] !== MAGIC.charCodeAt(0) || buf[1] !== MAGIC.charCodeAt(1) || buf[2] !== VERSION) {
    throw new BinaryError(`missing or invalid .dxnb envelope (expected magic "DX" + version ${VERSION})`);
  }
  const decoder = new Decoder(buf, 3, opts);
  const value = decoder.decodeItem();
  if (decoder.pos !== buf.length) {
    throw new BinaryError(`trailing bytes after top-level value (${buf.length - decoder.pos} left over)`, decoder.pos);
  }
  return Validated.strip(value);
}

class Decoder {
  /**
   * @param {Buffer} buf
   * @param {number} pos
   * @param {{trusted?: boolean, registry?: import('../registry.cjs')}} opts
   */
  constructor(buf, pos, opts) {
    this.buf = buf;
    this.pos = pos;
    this.trusted = opts.trusted ?? true;
    this.registry = opts.registry ?? null;
    /** @type {unknown[]} indexed by tag-28 registration order. */
    this.sharedItems = [];
    /** @type {Array<Map<number, string>>} innermost scope last. */
    this.stringrefStack = [];
  }

  /** @returns {number} */
  readByte() {
    if (this.pos >= this.buf.length) throw new BinaryError('unexpected end of input', this.pos);
    return this.buf[this.pos++];
  }

  /** @param {number} len @returns {Buffer} */
  take(len) {
    if (this.buf.length - this.pos < len) {
      throw new BinaryError('unexpected end of input (truncated item)', this.pos);
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /** @returns {{major: number, arg: bigint}} */
  readHead() {
    const first = this.readByte();
    const major = first >> 5;
    const info = first & 0x1f;
    if (info < 24) return { major, arg: BigInt(info) };
    if (info === 24) return { major, arg: BigInt(this.take(1)[0]) };
    if (info === 25) return { major, arg: BigInt(this.take(2).readUInt16BE(0)) };
    if (info === 26) return { major, arg: BigInt(this.take(4).readUInt32BE(0)) };
    if (info === 27) return { major, arg: this.take(8).readBigUInt64BE(0) };
    throw new BinaryError(`malformed CBOR item header (reserved additional info ${info})`, this.pos);
  }

  /** @returns {unknown} */
  decodeItem() {
    if (this.pos >= this.buf.length) throw new BinaryError('unexpected end of input', this.pos);
    const first = this.buf[this.pos];
    if (first >> 5 === 7) return this.decodeMajor7(first & 0x1f);
    const { major, arg } = this.readHead();
    return this.decodeByMajor(major, arg);
  }

  /**
   * Major 7's additional-info value is a selector (which simple
   * value/float width), not a magnitude to shorten — handled directly
   * from the raw header byte rather than through `readHead`'s
   * generic "arg" abstraction, mirroring `Dextrin.Binary.Decoder`'s
   * own dedicated major-7 clauses (see its own comment for why: the
   * same distinction the encoder's `floatHead` exists for).
   * @param {number} info
   * @returns {unknown}
   */
  decodeMajor7(info) {
    this.pos += 1; // consume the header byte `decodeItem` only peeked
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22) return null;
    if (info === 25) throw new BinaryError('half-precision (16-bit) CBOR floats are not supported', this.pos);
    if (info === 26) return this.take(4).readFloatBE(0);
    // A native JS `number` already holds every IEEE-754 double bit
    // pattern, NaN/Infinity included — no manual sign/exponent/mantissa
    // decomposition needed the way `Dextrin.Binary.Decoder.decode_float/1`
    // requires (a BEAM-only workaround, see `src/values/index.cjs`'s
    // own note on this same float/NaN divergence).
    if (info === 27) return this.take(8).readDoubleBE(0);
    throw new BinaryError(`unsupported CBOR item (major 7, arg ${info})`, this.pos);
  }

  /**
   * @param {number} major
   * @param {bigint} arg
   * @returns {unknown}
   */
  decodeByMajor(major, arg) {
    switch (major) {
      case 0:
        return arg;
      case 1:
        return -1n - arg;
      case 2:
        return new DXNBytes(new Uint8Array(this.take(Number(arg))));
      case 3:
        return this.decodeText(Number(arg));
      case 4:
        return new DXNList(this.decodeNItems(Number(arg)));
      case 5:
        return new Map(this.decodeMapPairs(Number(arg)));
      case 6:
        return this.decodeTag(Number(arg));
      default:
        throw new BinaryError(`unsupported CBOR item (major ${major}, arg ${arg})`, this.pos);
    }
  }

  /** @param {number} len @returns {string} */
  decodeText(len) {
    const raw = this.take(len);
    let text;
    try {
      text = UTF8_STRICT.decode(raw);
    } catch {
      throw new BinaryError('invalid UTF-8 in text item', this.pos);
    }
    this.registerStringref(text);
    return text;
  }

  /** @param {number} count @returns {unknown[]} */
  decodeNItems(count) {
    const items = [];
    for (let i = 0; i < count; i += 1) items.push(this.decodeItem());
    return items;
  }

  /** @param {number} pairCount @returns {Array<[unknown, unknown]>} */
  decodeMapPairs(pairCount) {
    /** @type {Array<[unknown, unknown]>} */
    const pairs = [];
    for (let i = 0; i < pairCount; i += 1) {
      const key = this.decodeItem();
      const value = this.decodeItem();
      pairs.push([key, value]);
    }
    return pairs;
  }

  /**
   * @param {number} tagNumber
   * @returns {unknown}
   */
  decodeTag(tagNumber) {
    if (tagNumber === Tags.T_SHAREABLE) return this.decodeShareable();
    if (tagNumber === Tags.T_SHARED_REF) return this.decodeSharedRef();
    if (tagNumber === Tags.T_STRINGREF_NAMESPACE) return this.decodeStringrefNamespace();
    if (tagNumber === Tags.T_STRINGREF) return this.decodeStringref();
    const payload = this.decodeItem();
    return buildTagged(tagNumber, payload, this.trusted, this.registry);
  }

  // ---- value sharing (DXN.md §2.5) ---------------------------------------
  //
  // Decode-side support is spec-mandatory ("a conforming decoder MUST
  // accept it") regardless of whether this library's own encoder
  // produces it (which it doesn't yet, see encoder.cjs's own note).
  // Indices are assigned in decode-*completion* order (post-order — a
  // tag-28 item registers only after its own children finish
  // decoding), matching a conforming encoder's own order, which also
  // means a tag-29 reference can only point at an already-decoded
  // item: cycles are structurally impossible here, not separately
  // detected.

  decodeShareable() {
    const value = this.decodeItem();
    this.sharedItems.push(value);
    return value;
  }

  decodeSharedRef() {
    const index = this.decodeItem();
    if (typeof index !== 'bigint') {
      throw new BinaryError(`shared value reference (tag ${Tags.T_SHARED_REF}) payload must be an integer index`, this.pos);
    }
    const i = Number(index);
    if (i < 0 || i >= this.sharedItems.length) {
      throw new BinaryError(`shared value reference (tag ${Tags.T_SHARED_REF}) index ${i} refers to a not-yet-seen item`, this.pos);
    }
    // A conforming decoder "MUST resolve every tag-29 reference to an
    // independent copy... no decoder-visible aliasing, no shared
    // mutable identity" (DXN.md §2.5) — deep-cloned, not returned by
    // reference, so mutating one decoded occurrence (JS objects are
    // mutable, unlike Erlang terms) can never leak into another.
    return deepClone(this.sharedItems[i]);
  }

  // ---- string-reference sharing (DXN.md §2.4) ----------------------------

  decodeStringrefNamespace() {
    this.stringrefStack.push(new Map());
    try {
      return this.decodeItem();
    } finally {
      this.stringrefStack.pop();
    }
  }

  decodeStringref() {
    const index = this.decodeItem();
    if (typeof index !== 'bigint') {
      throw new BinaryError(`string reference (tag ${Tags.T_STRINGREF}) payload must be an integer index`, this.pos);
    }
    const scope = this.stringrefStack[this.stringrefStack.length - 1];
    const value = scope?.get(Number(index));
    if (value === undefined) {
      throw new BinaryError(
        `string reference (tag ${Tags.T_STRINGREF}) index ${index} refers to a not-yet-seen string, or there is no active stringref namespace (tag ${Tags.T_STRINGREF_NAMESPACE})`,
        this.pos
      );
    }
    return value;
  }

  /** @param {string} text */
  registerStringref(text) {
    const scope = this.stringrefStack[this.stringrefStack.length - 1];
    if (scope) scope.set(scope.size, text);
  }
}

// ---- tag dispatch (DXN.md §2.2/§2.3) -----------------------------------

/**
 * @param {number} tag
 * @param {unknown} value the already-decoded payload.
 * @param {boolean} trusted
 * @param {import('../registry.cjs') | null} registry
 * @returns {unknown}
 */
function buildTagged(tag, value, trusted, registry) {
  switch (tag) {
    case Tags.T_BIGNUM_POS:
      return buildBignum(value, tag, (n) => n);
    case Tags.T_BIGNUM_NEG:
      return buildBignum(value, tag, (n) => -1n - n);
    case Tags.T_DECIMAL:
      return buildDecimal(value);
    case Tags.T_TIMESTAMP:
      return buildTimestamp(value);
    case Tags.T_RATIONAL:
      return buildRational(value);
    case Tags.T_URI:
      return expect(value, 'string', tag, 'uri', (v) => new DXNURI(v));
    case Tags.T_UUID:
      return buildUuid(value);
    case Tags.T_CHAR:
      return buildChar(value);
    case Tags.T_SYMBOL:
      return expect(value, 'string', tag, 'symbol', (v) => new DXNSymbol(v));
    case Tags.T_KEYWORD:
      return buildKeyword(value, trusted);
    case Tags.T_TUPLE:
      return buildFromList(value, tag, 'tuple', (items) => new DXNTuple(items));
    case Tags.T_ARRAY:
      return buildFromList(value, tag, 'array', (items) => items);
    case Tags.T_ORDERED:
      return buildOrdered(value);
    case Tags.T_SET:
      return buildFromList(value, tag, 'set', (items) => new Set(items));
    case Tags.T_SORTED_SET:
      return buildFromList(value, tag, 'sorted-set', (items) => DXNSortedSet.fromArray(items));
    case Tags.T_STRUCT:
      return buildStruct(value, registry);
    case Tags.T_DATE:
      return buildDate(value);
    case Tags.T_TIME:
      return buildTime(value);
    case Tags.T_DATETIME_OFFSET:
      return buildDatetimeOffset(value);
    case Tags.T_DURATION:
      return buildDuration(value);
    case Tags.T_REGEX:
      return buildRegex(value);
    case Tags.T_CUSTOM:
      return buildCustom(value, registry);
    default:
      throw new BinaryError(`unrecognized CBOR tag ${tag}`);
  }
}

/**
 * @param {unknown} value
 * @param {'string'} type
 * @param {number} tag
 * @param {string} name
 * @param {(v: any) => unknown} build
 */
function expect(value, type, tag, name, build) {
  if (typeof value !== type) throw new BinaryError(`malformed ${name} (tag ${tag}) payload`);
  return build(value);
}

/**
 * @param {unknown} value
 * @param {number} tag
 * @param {string} name
 * @param {(items: unknown[]) => unknown} build
 */
function buildFromList(value, tag, name, build) {
  if (!(value instanceof DXNList)) throw new BinaryError(`malformed ${name} (tag ${tag}) payload`);
  return build(value.items);
}

/** @param {unknown} value @param {number} tag @param {(n: bigint) => bigint} transform */
function buildBignum(value, tag, transform) {
  if (!(value instanceof DXNBytes)) throw new BinaryError(`malformed bignum (tag ${tag}) payload`);
  let n = 0n;
  for (const b of value.data) n = (n << 8n) | BigInt(b);
  return transform(n);
}

/** @param {unknown} value */
function buildDecimal(value) {
  if (!(value instanceof DXNList) || value.items.length !== 2) throw new BinaryError(`malformed decimal (tag ${Tags.T_DECIMAL}) payload`);
  const [exponent, mantissa] = value.items;
  if (typeof exponent !== 'bigint' || typeof mantissa !== 'bigint') {
    throw new BinaryError(`malformed decimal (tag ${Tags.T_DECIMAL}) payload`);
  }
  const sign = mantissa < 0n ? -1 : 1;
  return new DXNDecimal(sign, mantissa < 0n ? -mantissa : mantissa, Number(exponent));
}

/** @param {unknown} value */
function buildRational(value) {
  if (!(value instanceof DXNList) || value.items.length !== 2) throw new BinaryError(`malformed rational (tag ${Tags.T_RATIONAL}) payload`);
  const [num, den] = value.items;
  if (typeof num !== 'bigint' || typeof den !== 'bigint' || den <= 0n) {
    throw new BinaryError(`malformed rational (tag ${Tags.T_RATIONAL}) payload`);
  }
  return new DXNRational(num, den);
}

/** @param {unknown} value */
function buildTimestamp(value) {
  if (typeof value !== 'bigint') throw new BinaryError(`malformed timestamp (tag ${Tags.T_TIMESTAMP}) payload`);
  return new DXNTimestamp(value);
}

/** @param {unknown} value */
function buildUuid(value) {
  if (!(value instanceof DXNBytes) || value.data.length !== 16) throw new BinaryError(`malformed uuid (tag ${Tags.T_UUID}) payload`);
  return new DXNUUID(value.data);
}

/** @param {unknown} value */
function buildChar(value) {
  if (typeof value !== 'bigint' || value < 0n || value > 0x10ffffn || (value >= 0xd800n && value <= 0xdfffn)) {
    throw new BinaryError(`malformed char (tag ${Tags.T_CHAR}) payload`);
  }
  return new DXNChar(Number(value));
}

/** @param {unknown} value @param {boolean} trusted */
function buildKeyword(value, trusted) {
  if (typeof value !== 'string') throw new BinaryError(`malformed keyword (tag ${Tags.T_KEYWORD}) payload`);
  return trusted ? Symbol.for(value) : new DXNKeyword(value);
}

/** @param {unknown} value */
function buildOrdered(value) {
  if (!(value instanceof Map)) throw new BinaryError(`malformed ordered-map (tag ${Tags.T_ORDERED}) payload`);
  return new DXNOrderedMap(Array.from(value.entries()));
}

/**
 * `.dxnb` structs are always positional (`DXN.md` §2.1). Decoded
 * against a compiled schema when `registry` has one for `name` — same
 * as the text parser's `Parser#materializeStruct` — falling back to
 * an opaque `DXNStruct` when it doesn't.
 * @param {unknown} value
 * @param {import('../registry.cjs') | null} registry
 */
function buildStruct(value, registry) {
  if (!(value instanceof DXNList) || value.items.length === 0) throw new BinaryError(`malformed struct (tag ${Tags.T_STRUCT}) payload`);
  const [name, ...fields] = value.items;
  if (typeof name !== 'string') throw new BinaryError(`malformed struct (tag ${Tags.T_STRUCT}) payload`);

  const found = registry?.fetchStructSchema(name);
  if (!found) return DXNStruct.positional(name, fields);

  const materializer = found.registry.fetchMaterializer(name) ?? null;
  try {
    return Validator.materialize(found.compiled, { type: 'positional', values: fields }, materializer, found.registry);
  } catch (err) {
    throw new BinaryError(`struct ${JSON.stringify(name)} violates its schema: ${errorMessage(err)}`);
  }
}

/** @param {unknown} value */
function buildDate(value) {
  if (typeof value !== 'bigint') throw new BinaryError(`malformed date (tag ${Tags.T_DATE}) payload`);
  const ms = EPOCH_MS + Number(value) * 86_400_000;
  const d = new Date(ms);
  return new DXNDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** @param {unknown} value */
function buildTime(value) {
  if (typeof value !== 'bigint' || value < 0n) throw new BinaryError(`malformed time (tag ${Tags.T_TIME}) payload`);
  const totalMicro = value;
  const microsecond = Number(totalMicro % 1_000_000n);
  const totalSeconds = totalMicro / 1_000_000n;
  const second = Number(totalSeconds % 60n);
  const totalMinutes = totalSeconds / 60n;
  const minute = Number(totalMinutes % 60n);
  const hour = Number(totalMinutes / 60n);
  return new DXNTime(hour, minute, second, microsecond);
}

/** @param {unknown} value */
function buildDatetimeOffset(value) {
  if (!(value instanceof DXNList) || value.items.length !== 2) {
    throw new BinaryError(`malformed datetime (tag ${Tags.T_DATETIME_OFFSET}) payload`);
  }
  const [epochMicros, offsetMinutes] = value.items;
  if (typeof epochMicros !== 'bigint' || typeof offsetMinutes !== 'bigint') {
    throw new BinaryError(`malformed datetime (tag ${Tags.T_DATETIME_OFFSET}) payload`);
  }
  return new DXNDateTime(epochMicros, Number(offsetMinutes));
}

/** @param {unknown} value */
function buildDuration(value) {
  if (!(value instanceof DXNList) || value.items.length === 0) throw new BinaryError(`malformed duration (tag ${Tags.T_DURATION}) payload`);
  const [bitmaskItem, ...fieldItems] = value.items;
  if (typeof bitmaskItem !== 'bigint') throw new BinaryError(`malformed duration (tag ${Tags.T_DURATION}) payload`);
  const bitmask = Number(bitmaskItem);
  const fields = Tags.durationFieldsPresent(bitmask);
  if (fields.length !== fieldItems.length) {
    throw new BinaryError('duration bitmask does not match field count');
  }
  /** @type {any} */
  const values = {};
  fields.forEach((field, i) => {
    const item = fieldItems[i];
    if (typeof item !== 'bigint') throw new BinaryError(`malformed duration (tag ${Tags.T_DURATION}) payload`);
    values[field] = Number(item);
  });
  return new DXNDuration(values);
}

/** @param {unknown} value */
function buildRegex(value) {
  if (!(value instanceof DXNList) || value.items.length !== 2) throw new BinaryError(`malformed regex (tag ${Tags.T_REGEX}) payload`);
  const [pattern, flagsByte] = value.items;
  if (typeof pattern !== 'string' || typeof flagsByte !== 'bigint') {
    throw new BinaryError(`malformed regex (tag ${Tags.T_REGEX}) payload`);
  }
  return new DXNRegex(pattern, Tags.regexByteToFlags(Number(flagsByte)));
}

/**
 * @param {unknown} value
 * @param {import('../registry.cjs') | null} registry
 */
function buildCustom(value, registry) {
  if (!(value instanceof DXNList) || value.items.length !== 2) throw new BinaryError(`malformed custom tag (tag ${Tags.T_CUSTOM}) payload`);
  const [name, inner] = value.items;
  if (typeof name !== 'string') throw new BinaryError(`malformed custom tag (tag ${Tags.T_CUSTOM}) payload`);

  const decoder = registry?.fetchTag(name);
  if (!decoder) return new DXNCustomTag(name, inner);
  try {
    return decoder(inner);
  } catch (err) {
    throw new BinaryError(`tag ${JSON.stringify(name)} decoder failed: ${errorMessage(err)}`);
  }
}

/**
 * Structural deep clone of a decoded `DXNValue`, used only to resolve
 * a tag-29 shared-value reference into an independent copy (see
 * `Decoder#decodeSharedRef`'s own doc for why). Primitives (including
 * `BigInt`/`Symbol`, both immutable) are returned as-is; every
 * compound shape — native `Array`/`Map`/`Set`/`Uint8Array` and every
 * `DXN*` wrapper instance alike — is rebuilt with cloned contents.
 * @param {unknown} value
 * @returns {unknown}
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Map) return new Map(Array.from(value.entries(), ([k, v]) => [deepClone(k), deepClone(v)]));
  if (value instanceof Set) return new Set(Array.from(value, deepClone));
  const clone = Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) {
    clone[key] = deepClone(/** @type {any} */ (value)[key]);
  }
  return clone;
}

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

module.exports = { decode, BinaryError };
