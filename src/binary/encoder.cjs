'use strict';

/**
 * @fileoverview `.dxnb` encoder — a recursive walk over CBOR's major
 * types plus a fixed tag dispatch table, matching `DXN.md` §2.2's
 * table row order. Mirrors `Dextrin.Binary.Encoder` structurally; see
 * that module's own moduledoc for why this is hand-rolled rather than
 * built on a generic CBOR library (bignum precision, timestamp
 * integer-only encoding, the private tag block — the same reasoning
 * applies here, arguably more so, since generic JS CBOR packages are
 * no more likely to get these right by default).
 *
 * **Scope note**: value sharing (`DXN.md` §2.5, tags 28/29) is
 * decode-only for now — the spec requires a conforming *decoder* to
 * accept it but never requires an *encoder* to produce it
 * ("not required for a conforming encoder to produce"), and the
 * encode-side cost/benefit calculation it needs (`Dextrin.Binary.
 * Encoder`'s own `worth_sharing?/3`) is a real, separate chunk of
 * work — deferred, not forgotten. Every document round-trips
 * correctly either way; opting into producing shared references would
 * only ever change output size, never semantics.
 *
 * Envelope (`magic` `version` `cbor_item`, `DXN.md` §2.1) is written
 * once, at `encode/2` itself; everything below that is `encodeItem`,
 * one recursive function keyed on the JS value's own shape.
 */

const { checkPairs } = require('../map-key.cjs');
const { unsupported } = require('./errors.cjs');
const { head, floatItem, tag, arrayOf, mapOf, textItem, bytesItem, integerItem } = require('./writer.cjs');
const Tags = require('./tags.cjs');

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

const MAGIC = Buffer.from('DX', 'ascii');
const VERSION = Buffer.from([1]);
const EPOCH_MS = Date.UTC(1970, 0, 1);

/**
 * @param {unknown} value
 * @param {{[k: string]: unknown}} [opts] reserved for future options
 * (`registry:`, once the schema system lands).
 * @returns {Buffer}
 */
function encode(value, opts = {}) {
  return Buffer.concat([MAGIC, VERSION, encodeItem(value, opts)]);
}

/**
 * @param {unknown} value
 * @param {{[k: string]: unknown}} opts
 * @returns {Buffer}
 */
function encodeItem(value, opts) {
  if (value === null || value === undefined) return head(7, 22n);
  if (value === false) return head(7, 20n);
  if (value === true) return head(7, 21n);

  if (typeof value === 'bigint') return integerItem(value);
  if (typeof value === 'number') return floatItem(value);
  if (typeof value === 'string') return textItem(value);
  if (typeof value === 'symbol') return tag(Tags.T_KEYWORD, textItem(value.description ?? ''));

  if (value instanceof DXNDecimal) {
    const mantissa = value.sign < 0 ? -value.unscaledValue : value.unscaledValue;
    return tag(Tags.T_DECIMAL, arrayOf([integerItem(BigInt(value.exponent)), integerItem(mantissa)]));
  }
  if (value instanceof DXNRational) {
    return tag(Tags.T_RATIONAL, arrayOf([integerItem(value.numerator), integerItem(value.denominator)]));
  }
  if (value instanceof DXNChar) return tag(Tags.T_CHAR, integerItem(BigInt(value.codepoint)));
  if (value instanceof DXNSymbol) return tag(Tags.T_SYMBOL, textItem(value.name));
  if (value instanceof DXNKeyword) return tag(Tags.T_KEYWORD, textItem(value.name));
  if (value instanceof DXNBytes) return bytesItem(value.data);

  if (value instanceof DXNList) return arrayOf(value.items.map((v) => encodeItem(v, opts)));
  if (value instanceof DXNTuple) return tag(Tags.T_TUPLE, arrayOf(value.items.map((v) => encodeItem(v, opts))));
  if (Array.isArray(value)) return tag(Tags.T_ARRAY, arrayOf(value.map((v) => encodeItem(v, opts))));

  if (value instanceof DXNOrderedMap) {
    checkPairs(value.pairs);
    return tag(Tags.T_ORDERED, mapOf(encodePairs(value.pairs, opts)));
  }
  if (value instanceof Map) {
    checkPairs(value.entries());
    return mapOf(encodePairs(Array.from(value.entries()), opts));
  }

  if (value instanceof Set) return tag(Tags.T_SET, arrayOf(Array.from(value).map((v) => encodeItem(v, opts))));
  if (value instanceof DXNSortedSet) return tag(Tags.T_SORTED_SET, arrayOf(value.items.map((v) => encodeItem(v, opts))));

  if (value instanceof DXNStruct) return encodeStruct(value, opts);

  if (value instanceof DXNDate) return tag(Tags.T_DATE, integerItem(epochDays(value)));
  if (value instanceof DXNTime) return tag(Tags.T_TIME, integerItem(totalMicroseconds(value)));
  if (value instanceof DXNTimestamp) return tag(Tags.T_TIMESTAMP, integerItem(value.epochMicroseconds));
  // A native `Date` is an instant: it always means a timestamp, with or
  // without a schema (DXN.md §4.7).
  if (value instanceof Date) return encodeItem(DXNTimestamp.fromDate(value), opts);
  if (value instanceof DXNDateTime) {
    return tag(Tags.T_DATETIME_OFFSET, arrayOf([integerItem(value.epochMicroseconds), integerItem(BigInt(value.offsetMinutes))]));
  }
  if (value instanceof DXNDuration) return encodeDuration(value);

  if (value instanceof DXNUUID) return tag(Tags.T_UUID, bytesItem(value.bytes));
  if (value instanceof DXNURI) return tag(Tags.T_URI, textItem(value.value));
  if (value instanceof DXNRegex) {
    return tag(Tags.T_REGEX, arrayOf([textItem(value.pattern), integerItem(BigInt(Tags.regexFlagsToByte(value.flags)))]));
  }

  if (value instanceof DXNCustomTag) {
    return tag(Tags.T_CUSTOM, arrayOf([textItem(value.name), encodeItem(value.value, opts)]));
  }

  return encodeViaRegistry(value, opts);
}

/**
 * Reached only for a value none of the clauses above recognized —
 * i.e. a genuine application class instance. Two independent
 * extension points, checked in order: a schema-registered class is
 * rebuilt as the equivalent positional `DXNStruct` (`.dxnb` structs
 * are always positional, `DXN.md` §2.1) and re-encoded through
 * `encodeStruct`, reusing its recursive field encoding; only if no
 * schema class matches does this fall through to a registered tag
 * encoder.
 * @param {unknown} value
 * @param {{registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 * @returns {Buffer}
 */
function encodeViaRegistry(value, opts) {
  const registry = opts.registry;
  if (registry && value !== null && typeof value === 'object') {
    const name = registry.fetchSchemaNameForModule(value.constructor);
    if (name) {
      const found = registry.fetchStructSchema(name);
      if (found) {
        const values = found.compiled.fieldValues(/** @type {object} */ (value)).map(([, v]) => v);
        return encodeStruct(DXNStruct.positional(name, values), opts);
      }
    }

    const tagEncoder = registry.fetchTagEncoder(value.constructor);
    if (tagEncoder) {
      const [tagName, encoder] = tagEncoder;
      return tag(Tags.T_CUSTOM, arrayOf([textItem(tagName), encodeItem(encoder(value), opts)]));
    }
  }

  throw unsupported(describeForError(value));
}

/**
 * @param {Array<[unknown, unknown]>} pairs
 * @param {{[k: string]: unknown}} opts
 * @returns {Array<[Buffer, Buffer]>}
 */
function encodePairs(pairs, opts) {
  return pairs.map(([k, v]) => /** @type {[Buffer, Buffer]} */ ([encodeItem(k, opts), encodeItem(v, opts)]));
}

/**
 * `.dxnb` structs are always positional (`DXN.md` §2.1), written with
 * the type name `Name(3)` that `Registry#asWritten` says — the latest
 * loaded version of its schema, or its own (§2.4, §4.8).
 * @param {DXNStruct} value
 * @param {{registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 * @returns {Buffer}
 */
function encodeStruct(value, opts) {
  const written = opts.registry ? opts.registry.asWritten(value) : value;
  const values = positionalValues(value, opts.registry);
  const items = [textItem(DXNStruct.typeName(written.name, written.version)), ...values.map((v) => encodeItem(v, opts))];
  // Extra fields, when there are any, as one trailing tag-215 map in the
  // order they were written (DXN.md §2.3).
  if (value.extra.length > 0) {
    checkPairs(value.extra);
    items.push(tag(Tags.T_EXTRA, mapOf(encodePairs(value.extra, opts))));
  }
  return tag(Tags.T_STRUCT, arrayOf(items));
}

/**
 * A struct's field values in the order the wire wants them. A keyed
 * struct is put in its schema's field order, because a position is what
 * the wire has; with no schema there is no order to consult, and the
 * pairs' own order is all there is.
 * @param {DXNStruct} value
 * @param {import('../registry.cjs') | undefined} registry
 * @returns {unknown[]}
 */
function positionalValues(value, registry) {
  if (value.fields.type === 'positional') return value.fields.values;
  const found = registry?.fetchStructSchema(value.name);
  if (!found) return value.fields.pairs.map(([, v]) => v);
  const named = new Map(value.fields.pairs);
  return found.compiled.fieldNames().map((name) => named.get(name));
}

/** @param {DXNDate} date @returns {bigint} */
function epochDays(date) {
  const ms = Date.UTC(date.year, date.month - 1, date.day) - EPOCH_MS;
  return BigInt(ms / 86_400_000);
}

/** @param {DXNTime} time @returns {bigint} */
function totalMicroseconds(time) {
  return (
    BigInt(time.hour) * 3_600_000_000n +
    BigInt(time.minute) * 60_000_000n +
    BigInt(time.second) * 1_000_000n +
    BigInt(time.microsecond)
  );
}

/** @param {DXNDuration} d @returns {Buffer} */
function encodeDuration(d) {
  const bitmask = Tags.durationBitmask(d);
  const fields = Tags.durationFieldsPresent(bitmask);
  const items = [integerItem(BigInt(bitmask)), ...fields.map((f) => integerItem(BigInt(/** @type {number} */ (d[f]))))];
  return tag(Tags.T_DURATION, arrayOf(items));
}

/** @param {unknown} value */
function describeForError(value) {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

module.exports = { encode };
