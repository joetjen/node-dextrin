'use strict';

/**
 * @fileoverview Hand-written recursive-descent `.dxn` parser — the
 * reverse of `src/text/printer.cjs`, built directly on
 * `src/text/lexer.cjs`'s token stream. Combines what `dextrin`'s
 * Elixir side splits into a generated grammar plus a separate
 * `Ichor.Actions` implementation into one pass, appropriate for a
 * hand-rolled port with no grammar-compiler step.
 *
 * A `struct` decodes against a compiled schema when `opts.registry`
 * has one for that name (`Validator.materialize`, same as the binary
 * decoder); with no registry, or no schema registered for that name,
 * it falls back to an opaque `DXNStruct` — never a hard failure,
 * mirroring `Dextrin.Text.Actions`'s own "no registry" fallback
 * exactly. Same story for a non-built-in tag against `registry.tags`,
 * falling back to `DXNCustomTag`.
 */

const { tokenize, LexError } = require('./lexer.cjs');
const { decodeString, decodeEscape } = require('./escapes.cjs');
const temporal = require('./temporal.cjs');

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
const DXNUUID = require('../values/uuid.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNBytes = require('../values/bytes.cjs');
const DXNRegex = require('../values/regex.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');
const Validator = require('../schema/validator.cjs');
const Validated = require('../schema/validated.cjs');

const BUILT_IN_TAGS = new Set(['ordered', 'sorted-set', 'array', 'uuid', 'uri', 'bytes', 'datetime', 'duration']);

class ParseError extends Error {
  /**
   * @param {string} message
   * @param {number} offset
   */
  constructor(message, offset) {
    super(message);
    this.name = 'ParseError';
    this.offset = offset;
  }
}

class Parser {
  /**
   * @param {import('./lexer.cjs').Token[]} tokens
   * @param {{trusted?: boolean, registry?: import('../registry.cjs')}} opts
   */
  constructor(tokens, opts) {
    this.tokens = tokens;
    this.pos = 0;
    this.trusted = opts.trusted ?? true;
    this.registry = opts.registry ?? null;
  }

  peek() {
    return this.tokens[this.pos];
  }

  /** @param {string} type */
  at(type) {
    return this.peek().type === type;
  }

  /** @param {string} type */
  next(type) {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new ParseError(`expected ${type}, got ${tok.type}`, tok.start);
    }
    this.pos += 1;
    return tok;
  }

  /** Top-level entry: optional header, then exactly one value. */
  parseDocument() {
    this.tryConsumeHeader();
    const value = this.parseValue();
    this.next('EOF');
    return value;
  }

  tryConsumeHeader() {
    const save = this.pos;
    if (this.at('AT') && this.tokens[this.pos + 1]?.type === 'IDENTIFIER' && this.tokens[this.pos + 1].value === 'dxn' && this.tokens[this.pos + 2]?.type === 'STRING') {
      this.pos += 3;
    } else {
      this.pos = save;
    }
  }

  /**
   * `value = {skip}, value_body` — `skip` here is only ever a
   * discard; comments never reach the token stream.
   * @returns {unknown}
   */
  parseValue() {
    while (this.at('AT') && this.isDiscard()) {
      this.pos += 1; // AT
      this.pos += 1; // IDENTIFIER "_"
      this.parseValue(); // parse and throw away
    }
    return this.parseValueBody();
  }

  isDiscard() {
    const next = this.tokens[this.pos + 1];
    return next?.type === 'IDENTIFIER' && next.value === '_';
  }

  /** @returns {unknown} */
  parseValueBody() {
    const tok = this.peek();
    switch (tok.type) {
      case 'NIL':
        this.pos += 1;
        return null;
      case 'TRUE':
        this.pos += 1;
        return true;
      case 'FALSE':
        this.pos += 1;
        return false;
      case 'INTEGER':
        this.pos += 1;
        return BigInt(tok.value);
      case 'FLOAT':
        this.pos += 1;
        return this.parseFloatToken(tok.value);
      case 'DECIMAL':
        this.pos += 1;
        return DXNDecimal.fromString(tok.value.slice(0, -1));
      case 'RATIONAL':
        this.pos += 1;
        return this.parseRationalToken(tok.value);
      case 'STRING':
        this.pos += 1;
        return decodeString(tok.value);
      case 'CHAR':
        this.pos += 1;
        return this.parseCharToken(tok.value, tok.start);
      case 'KEYWORD':
        this.pos += 1;
        return this.parseKeywordToken(tok);
      case 'IDENTIFIER':
        this.pos += 1;
        return new DXNSymbol(tok.value);
      case 'LBRACKET':
        return this.parseList();
      case 'LBRACE':
        return this.parseTuple();
      case 'PERCENT':
        return this.parsePercent();
      case 'AT':
        return this.parseAt();
      case 'DATE_SIGIL':
        this.pos += 1;
        return temporal.parseDate(tok.value);
      case 'TIME_SIGIL':
        this.pos += 1;
        return temporal.parseTime(tok.value);
      case 'INSTANT_SIGIL':
        this.pos += 1;
        return temporal.parseInstant(tok.value);
      case 'REGEX_SIGIL':
        this.pos += 1;
        return new DXNRegex(tok.value.pattern, flagsStringToObject(tok.value.flags));
      default:
        throw new ParseError(`unexpected token ${tok.type}`, tok.start);
    }
  }

  /** @param {string} text */
  parseFloatToken(text) {
    if (text === 'NaN') return NaN;
    if (text === 'Infinity') return Infinity;
    if (text === '-Infinity') return -Infinity;
    return Number(text);
  }

  /** @param {string} text */
  parseRationalToken(text) {
    const slash = text.indexOf('/');
    const numerator = BigInt(text.slice(0, slash));
    const denominator = BigInt(text.slice(slash + 1));
    if (denominator === 0n) throw new ParseError(`rational denominator must not be zero: ${text}`, 0);
    return new DXNRational(numerator, denominator);
  }

  /**
   * @param {string} body
   * @param {number} offset
   */
  parseCharToken(body, offset) {
    if (body === 's') return new DXNChar(0x20);
    if (body.startsWith('\\')) {
      const { text, next } = decodeEscape(body, 1);
      if (next !== body.length) throw new ParseError('trailing characters after char escape', offset);
      const codepoints = Array.from(text);
      if (codepoints.length !== 1) throw new ParseError('char escape must decode to exactly one codepoint', offset);
      return new DXNChar(/** @type {number} */ (codepoints[0].codePointAt(0)));
    }
    const codepoints = Array.from(body);
    if (codepoints.length !== 1) throw new ParseError(`invalid char literal '?${body}'`, offset);
    if (codepoints[0] === ' ') throw new ParseError("a literal space is not a valid char body; use '?s'", offset);
    return new DXNChar(/** @type {number} */ (codepoints[0].codePointAt(0)));
  }

  /** @param {import('./lexer.cjs').Token} tok */
  parseKeywordToken(tok) {
    const name = tok.isQuoted ? decodeString(tok.value) : tok.value;
    return this.keywordValue(name);
  }

  /** @param {string} name */
  keywordValue(name) {
    return this.trusted ? Symbol.for(name) : new DXNKeyword(name);
  }

  /** @returns {DXNList} */
  parseList() {
    this.next('LBRACKET');
    /** @type {unknown[]} */
    const items = [];
    while (!this.at('RBRACKET')) items.push(this.parseValue());
    this.next('RBRACKET');
    return new DXNList(items);
  }

  /** @returns {DXNTuple} */
  parseTuple() {
    this.next('LBRACE');
    /** @type {unknown[]} */
    const items = [];
    while (!this.at('RBRACE')) items.push(this.parseValue());
    this.next('RBRACE');
    return new DXNTuple(items);
  }

  /** @returns {Set<unknown>} */
  parseSet() {
    this.next('LBRACE');
    /** @type {unknown[]} */
    const items = [];
    while (!this.at('RBRACE')) items.push(this.parseValue());
    this.next('RBRACE');
    return new Set(items);
  }

  /**
   * `%{...}` (map) or `%Name{...}`/`%Name[...]` (struct).
   * @returns {Map<unknown, unknown> | DXNStruct | Validated}
   */
  parsePercent() {
    this.next('PERCENT');
    if (this.at('LBRACE')) {
      return new Map(this.parseEntries());
    }
    const name = this.next('IDENTIFIER').value;
    if (this.at('LBRACE')) {
      /** @type {Array<[string, unknown]>} */
      const pairs = this.parseEntries().map(([key, value]) => [structFieldName(key), value]);
      return this.materializeStruct(name, { type: 'keyed', pairs });
    }
    this.next('LBRACKET');
    /** @type {unknown[]} */
    const values = [];
    while (!this.at('RBRACKET')) values.push(this.parseValue());
    this.next('RBRACKET');
    return this.materializeStruct(name, { type: 'positional', values });
  }

  /**
   * @param {string} name
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   * @returns {DXNStruct | Validated}
   */
  materializeStruct(name, fields) {
    const found = this.registry?.fetchStructSchema(name);
    if (!found) {
      return fields.type === 'keyed' ? DXNStruct.keyed(name, fields.pairs) : DXNStruct.positional(name, fields.values);
    }
    this.registry = found.registry;
    const materializer = this.registry.fetchMaterializer(name) ?? null;
    try {
      // Fail-fast, decode-time enforcement — a schema violation is an
      // ordinary parse error, same channel as bad syntax.
      return Validator.materialize(found.compiled, fields, materializer, this.registry);
    } catch (err) {
      throw new ParseError(`struct ${JSON.stringify(name)} violates its schema: ${errorMessage(err)}`, this.pos);
    }
  }

  /** `{ map_entry* }`, ordered pairs — used by both `map_lit` and `struct_keyed`. */
  parseEntries() {
    this.next('LBRACE');
    /** @type {Array<[unknown, unknown]>} */
    const pairs = [];
    while (!this.at('RBRACE')) {
      if (this.at('MAP_KEY')) {
        const key = this.keywordValue(this.next('MAP_KEY').value);
        pairs.push([key, this.parseValue()]);
      } else {
        const key = this.parseValue();
        this.next('ARROW');
        pairs.push([key, this.parseValue()]);
      }
    }
    this.next('RBRACE');
    return pairs;
  }

  /**
   * `@{...}` (set), or `@identifier value` (tag_form). Discard is
   * already stripped in `parseValue`.
   * @returns {unknown}
   */
  parseAt() {
    this.next('AT');
    if (this.at('LBRACE')) return this.parseSet();
    const nameTok = this.next('IDENTIFIER');
    return this.dispatchTag(nameTok.value, nameTok.start);
  }

  /**
   * @param {string} name
   * @param {number} offset
   * @returns {unknown}
   */
  dispatchTag(name, offset) {
    if (!BUILT_IN_TAGS.has(name)) {
      const decoder = this.registry?.fetchTag(name);
      if (decoder) {
        try {
          return decoder(this.parseValue());
        } catch (err) {
          throw new ParseError(`tag ${JSON.stringify(name)} decoder failed: ${errorMessage(err)}`, offset);
        }
      }
      return new DXNCustomTag(name, this.parseValue());
    }

    switch (name) {
      case 'ordered': {
        const inner = this.parseValue();
        if (!(inner instanceof Map)) throw new ParseError('@ordered requires a map literal argument', offset);
        return new DXNOrderedMap(Array.from(inner.entries()));
      }
      case 'sorted-set': {
        const inner = this.parseValue();
        if (!(inner instanceof Set)) throw new ParseError('@sorted-set requires a set literal argument', offset);
        return DXNSortedSet.fromSet(inner);
      }
      case 'array': {
        const inner = this.parseValue();
        if (!(inner instanceof DXNList)) throw new ParseError('@array requires a list literal argument', offset);
        return inner.toArray();
      }
      case 'uuid':
        return DXNUUID.fromString(this.parseStringValue(name, offset));
      case 'uri':
        return DXNURI.fromString(this.parseStringValue(name, offset));
      case 'bytes':
        return new DXNBytes(new Uint8Array(Buffer.from(this.parseStringValue(name, offset), 'base64')));
      case 'datetime':
        return temporal.parseOffsetDateTime(this.parseStringValue(name, offset));
      case 'duration':
        return temporal.parseDuration(this.parseStringValue(name, offset));
      default:
        throw new ParseError(`unhandled built-in tag ${name}`, offset);
    }
  }

  /**
   * @param {string} tagName
   * @param {number} offset
   * @returns {string}
   */
  parseStringValue(tagName, offset) {
    const value = this.parseValue();
    if (typeof value !== 'string') throw new ParseError(`@${tagName} requires a string argument`, offset);
    return value;
  }
}

/** @param {unknown} key @returns {string} */
function structFieldName(key) {
  if (key instanceof DXNKeyword) return key.name;
  if (key instanceof DXNSymbol) return key.name;
  if (typeof key === 'string') return key;
  if (typeof key === 'symbol') {
    const registered = Symbol.keyFor(key);
    if (registered !== undefined) return registered;
    if (key.description !== undefined) return key.description;
  }
  throw new ParseError('struct field name must be an identifier or string', 0);
}

/** @param {string} flags @returns {{i: boolean, m: boolean, s: boolean, u: boolean, x: boolean, f: boolean, r: boolean}} */
function flagsStringToObject(flags) {
  return {
    i: flags.includes('i'),
    m: flags.includes('m'),
    s: flags.includes('s'),
    u: flags.includes('u'),
    x: flags.includes('x'),
    f: flags.includes('f'),
    r: flags.includes('r')
  };
}

/**
 * @param {string} text
 * @param {{trusted?: boolean, registry?: import('../registry.cjs')}} [opts]
 * @returns {unknown}
 */
function parse(text, opts = {}) {
  const tokens = tokenize(text);
  const parser = new Parser(tokens, opts);
  return Validated.strip(parser.parseDocument());
}

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

module.exports = { parse, ParseError, LexError };
