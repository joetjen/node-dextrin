'use strict';

/**
 * @fileoverview JSON Schema to DXNS (T674, dextrin's
 * design/json-schema.md): drafts 04, 06, 07, 2019-09 and 2020-12, and
 * MongoDB's `$jsonSchema` with `bsonType`. Mirrors
 * `Dextrin.Convert.JsonSchema`.
 *
 * `toDxns` takes one or more schema documents and answers the DXNS
 * document as a DXN value -- a map from each name to its type -- and the
 * list of what it could not say exactly. Each such place is also kept in
 * the type's `meta`, so nothing is lost silently.
 *
 * The mapping follows the decisions of design/json-schema.md:
 *
 *   - an object schema becomes a `%shape` (plain maps, as JSON data is),
 *     or a `%schema` for a named definition under `structs: true`;
 *   - a string with a date or time, uuid or uri format becomes that DXN
 *     type (logical types); any other known format is `format:`, an
 *     unknown one is kept in `meta`;
 *   - every keyword applies only to values of its own kind, as JSON
 *     Schema says: a schema with no `type` checks a string's keywords on
 *     strings only, with `{:if :string ...}`;
 *   - `patternProperties`, `additionalProperties` and `propertyNames`
 *     become `* K => V` entries and `- *`; `unevaluatedProperties` and
 *     `unevaluatedItems` are worked out where it can be told from the
 *     schema alone;
 *   - references stay within the documents given: nothing is fetched.
 *
 * **JSON as it is read here** (`decodeJson`): an object is a `Map`, its
 * keys in the order written -- `JSON.parse` would move integer-like keys
 * ("10", "2") first, and properties become fields in the order written;
 * an array is an `Array`; a number written without a fraction or an
 * exponent is a `bigint`, any other a `number`, so `1` and `1.0` stay
 * apart, as the reference's `:json` keeps them; `null` is DXN's nil, so
 * a keyword set to null reads as one left out. A schema handed over
 * already parsed -- plain objects from `JSON.parse` -- is read the same
 * way, an integral number then an integer.
 *
 * The reference walks a map's keys in Erlang's term order, sorted; so
 * does this, wherever the order decides something (which of two names a
 * schema gets, the order of `meta`).
 */

const DXNKeyword = require('../values/keyword.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNList = require('../values/list.cjs');
const DXNMap = require('../values/map.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNRegex = require('../values/regex.cjs');
const { dxnEquals } = require('../values/equality.cjs');
const Format = require('../schema/format.cjs');

/** A refusal of the conversion: a schema that cannot be read. */
class JsonSchemaError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'JsonSchemaError';
  }
}

/**
 * One place the conversion is not exact: where, and why.
 * @typedef {{path: string, why: string}} Inexact
 */

/**
 * JSON as the converter reads it (see the file's own doc).
 * @typedef {Map<string, any> | any[] | string | number | bigint | boolean | null} Json
 */

// ---- reading JSON ------------------------------------------------------------

/**
 * JSON text decoded with each object's key order kept, which the
 * converter needs: properties become fields in the order written. An
 * object is a `Map`, an integer a `bigint`, any other number a `number`.
 * Throws a `JsonSchemaError` for text that is no JSON.
 * @param {string} text
 * @returns {Json}
 */
function decodeJson(text) {
  let i = 0;
  const fail = (/** @type {string} */ why) => {
    throw new JsonSchemaError(`not JSON: ${why} at offset ${i}`);
  };
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1;
  };
  /** @returns {Json} */
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1;
      /** @type {Map<string, any>} */
      const map = new Map();
      ws();
      if (text[i] === '}') {
        i += 1;
        return map;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a string key');
        const key = string();
        ws();
        if (text[i] !== ':') fail("expected ':'");
        i += 1;
        map.set(key, value());
        ws();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return map;
        }
        fail("expected ',' or '}'");
      }
    }
    if (c === '[') {
      i += 1;
      /** @type {any[]} */
      const list = [];
      ws();
      if (text[i] === ']') {
        i += 1;
        return list;
      }
      for (;;) {
        list.push(value());
        ws();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return list;
        }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"') return string();
    for (const [word, v] of /** @type {Array<[string, Json]>} */ ([['true', true], ['false', false], ['null', null]])) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    const m = /^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (!m) return fail('unexpected character');
    i += m[0].length;
    return m[1] === undefined && m[2] === undefined ? BigInt(m[0]) : Number(m[0]);
  };
  const string = () => {
    const m = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(i));
    if (!m) return fail('a malformed string');
    i += m[0].length;
    return /** @type {string} */ (JSON.parse(m[0]));
  };
  const result = value();
  ws();
  if (i !== text.length) throw new JsonSchemaError('text after the JSON value');
  return result;
}

/**
 * A value parsed elsewhere -- `JSON.parse`'s plain objects -- as
 * `decodeJson` gives it.
 * @param {unknown} value @returns {Json}
 */
function fromParsed(value) {
  if (value instanceof Map) return new Map(Array.from(value, ([k, v]) => [k, fromParsed(v)]));
  if (Array.isArray(value)) return value.map(fromParsed);
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (value !== null && typeof value === 'object') return new Map(Object.entries(value).map(([k, v]) => [k, fromParsed(v)]));
  return /** @type {Json} */ (value);
}

/**
 * A JSON value as a DXN value: an object a map, keyed by strings; an
 * array a list; `null` nil.
 * @param {unknown} value @returns {unknown}
 */
function jsonValue(value) {
  if (value instanceof Map) return new DXNMap(Array.from(value, ([k, v]) => [k, jsonValue(v)]));
  if (Array.isArray(value)) return new DXNList(value.map(jsonValue));
  return value;
}

// ---- the conversion ------------------------------------------------------------

const DRAFTS = new Map([
  ['http://json-schema.org/draft-04/schema', '04'],
  ['http://json-schema.org/draft-06/schema', '06'],
  ['http://json-schema.org/draft-07/schema', '07'],
  ['https://json-schema.org/draft/2019-09/schema', '2019-09'],
  ['https://json-schema.org/draft/2020-12/schema', '2020-12']
]);

const KINDS = ['string', 'number', 'array', 'object', 'boolean', 'null'];
const STRING_KEYS = ['minLength', 'maxLength', 'pattern', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema'];
const NUMBER_KEYS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
const ARRAY_KEYS = ['items', 'prefixItems', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains'];
const OBJECT_KEYS = ['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties'];

/** A date or time, uuid or uri format on a string is that DXN type (logical types). */
const LOGICAL = new Map([
  ['date-time', 'datetime'],
  ['date', 'date'],
  ['time', 'time'],
  ['duration', 'duration'],
  ['uuid', 'uuid'],
  ['uri', 'uri']
]);

const FORMATS = new Map([['date-time', 'datetime']]);

/** The annotations kept, by their DXNS names, in the reference's (sorted) order. */
const NOTES = [
  ['deprecated', 'deprecated'],
  ['description', 'description'],
  ['examples', 'examples'],
  ['readOnly', 'read-only'],
  ['title', 'title'],
  ['writeOnly', 'write-only']
];

const KNOWN = new Set([
  ...['type', 'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', '$ref', '$recursiveRef', '$dynamicRef'],
  ...['$schema', '$id', 'id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$defs', 'definitions', '$comment', '$vocabulary'],
  ...['dependentRequired', 'dependentSchemas', 'dependencies', 'unevaluatedProperties', 'unevaluatedItems'],
  ...['default', 'bsonType', 'discriminator', 'title', 'description', 'examples', 'readOnly', 'writeOnly', 'deprecated'],
  ...STRING_KEYS,
  ...NUMBER_KEYS,
  ...ARRAY_KEYS,
  ...OBJECT_KEYS
]);

/** The keys whose values are data, not schemas. */
const DATA_KEYS = new Set(['enum', 'const', 'examples', 'default']);

/** What `seen` holds for a branch of `allOf`. */
const BRANCH = '\u0000branch';

/**
 * Converts `sources`, the first being the root, to a DXNS document.
 * `sources` is `[[where, schema], ...]` -- or one `[where, schema]` --
 * `schema` its JSON text or a value already parsed, `where` the path or
 * URI it came from, which relative references resolve against when it
 * has no `$id`.
 *
 * Options: `name`, the root's name (otherwise its `title`, otherwise
 * `Root`); `draft`, `'04'`, `'06'`, `'07'`, `'2019-09'` or `'2020-12'`
 * for documents with no `$schema` (default 2020-12); `mongo`, read the
 * schema as MongoDB's (also when `bsonType` appears anywhere); `structs`,
 * write named object schemas as `%schema`; `assertFormats`, check
 * `format` and the content keywords in 2019-09 and 2020-12 too.
 *
 * Answers `{document, inexact}`. Throws a `JsonSchemaError` for a schema
 * that cannot be read: a reference to a document not given, an unknown
 * draft, a value that is no schema.
 *
 * @param {Array<[string, unknown]> | [string, unknown]} sources
 * @param {{name?: string, draft?: string, mongo?: boolean, structs?: boolean, assertFormats?: boolean}} [opts]
 * @returns {{document: DXNMap<unknown>, inexact: Inexact[]}}
 */
function toDxns(sources, opts = {}) {
  /** @type {Array<[string, unknown]>} */
  const list = sources.length === 2 && typeof sources[0] === 'string' ? [/** @type {[string, unknown]} */ (sources)] : /** @type {any} */ (sources);
  if (list.length === 0) throw new JsonSchemaError('no schema given');
  /** @type {Array<[string, Json]>} */
  const docs = list.map(([where, schema]) => {
    if (typeof schema === 'string') {
      try {
        return [where, decodeJson(schema)];
      } catch (err) {
        throw new JsonSchemaError(`${where}: ${/** @type {Error} */ (err).message}`);
      }
    }
    // A map is JSON as `decodeJson` reads it; anything else was parsed
    // elsewhere, `JSON.parse`'s plain objects.
    return [where, schema instanceof Map ? /** @type {Json} */ (schema) : fromParsed(schema)];
  });
  return new Converter(docs, opts).run(opts);
}

class Converter {
  /**
   * @param {Array<[string, Json]>} docs
   * @param {{name?: string, draft?: string, mongo?: boolean, structs?: boolean, assertFormats?: boolean}} opts
   */
  constructor(docs, opts) {
    this.docs = docs;
    this.draft = draftOf(docs, opts);
    this.mongo = Boolean(opts.mongo) || docs.some(([, root]) => bson(root));
    this.structs = Boolean(opts.structs);
    // Formats and content keywords check values before 2019-09; from
    // then on they are annotations, unless asked otherwise.
    this.assertFormats = Boolean(opts.assertFormats) || ['04', '06', '07'].includes(this.draft);
    /** @type {Map<string, string>} key -> name */
    this.names = new Map();
    /** @type {Set<string>} */
    this.taken = new Set();
    /** @type {Inexact[]} */
    this.inexact = [];
    /** @type {{nodes: Map<string, Entry>, ids: Map<string, string>, roots: Array<[string, string]>}} */
    this.index = { nodes: new Map(), ids: new Map(), roots: [] };
  }

  /** @param {{name?: string}} opts */
  run(opts) {
    const [, root] = this.docs[0];
    const uri = root instanceof Map ? root.get('$schema') : undefined;
    if (typeof uri === 'string' && draftOfUri(uri) === undefined) {
      this.inexact.push({ path: '#/$schema', why: `unknown metaschema ${uri}, read as draft ${this.draft}` });
    }
    this.buildIndex();
    this.nameTargets(opts);
    return this.convertAll();
  }

  // ---- the index: every schema by URI and pointer --------------------------

  // Every subschema reachable by a reference: by its document's base and
  // JSON pointer, by its own `$id`, and by its `$anchor`. Keys are
  // `base + "#/pointer"`; `ids` maps any URI a reference may name to one.
  buildIndex() {
    for (const [where, root] of this.docs) {
      if (!(root instanceof Map) && typeof root !== 'boolean') throw new JsonSchemaError(`${where}: a schema is an object or a boolean`);
      const base = this.resourceId(root, baseOf(where));
      this.index.roots.push([where, base]);
      // The URI a document was read from names it too, whatever its $id.
      if (base !== baseOf(where)) this.index.ids.set(baseOf(where), key(base, '#'));
      if (typeof root === 'boolean') {
        this.index.nodes.set(key(base, '#'), { node: root, own: base, base, pointer: '' });
        this.index.ids.set(base, key(base, '#'));
      } else {
        this.walkIndex(root, base, '', []);
      }
    }
  }

  /**
   * The base a schema's own `$id` sets, or `base`. Before 2019-09 a `$ref`
   * hides its siblings, `$id` included; and an `$id` that is only a
   * fragment, `#foo`, is an anchor, not a new base.
   * @param {unknown} node @param {string} base @returns {string}
   */
  resourceId(node, base) {
    if (!(node instanceof Map)) return base;
    if (node.has('$ref') && ['04', '06', '07'].includes(this.draft)) return base;
    const $id = node.get('$id');
    if (typeof $id === 'string') return $id.startsWith('#') ? base : stripFragment(resolveUri(base, $id));
    const id = node.get('id');
    if (typeof id === 'string') {
      return node.has('$schema') || id.includes('/') || !id.startsWith('#') ? stripFragment(resolveUri(base, id)) : base;
    }
    return base;
  }

  /**
   * `outer` holds the enclosing resources' bases with this schema's
   * pointer from each: a JSON pointer may cross into an embedded
   * resource, so the schema is found from every one of them.
   * @param {unknown} node @param {string} base @param {string} pointer @param {Array<[string, string]>} outer
   */
  walkIndex(node, base, pointer, outer) {
    const nodes = this.index.nodes;
    if (node instanceof Map) {
      const own = this.resourceId(node, base);
      const k = key(own, own === base ? '#' + pointer : '#');
      const entry = { node, own, base, pointer };
      nodes.set(key(base, '#' + pointer), entry);
      for (const [b, p] of outer) if (!nodes.has(key(b, '#' + p))) nodes.set(key(b, '#' + p), entry);
      nodes.set(k, { node, own, base, pointer });
      // A document's root, or a schema with an `$id` of its own, is what
      // its URI names; a schema inside it is not.
      if (own !== base || pointer === '') this.index.ids.set(own, k);
      for (const anchor of ['$anchor', '$dynamicAnchor']) {
        const name = node.get(anchor);
        if (typeof name === 'string') this.index.ids.set(own + '#' + name, k);
      }
      for (const kw of ['id', '$id']) {
        const id = node.get(kw);
        if (typeof id !== 'string') continue;
        if (id.startsWith('#') && id !== '#') {
          this.index.ids.set(own + id, k);
        } else if (!id.startsWith('#')) {
          const [, anchor] = splitFragment(resolveUri(base, id));
          if (anchor !== null && anchor !== '') this.index.ids.set(own + '#' + anchor, k);
        }
      }
      // Below a schema with an `$id` of its own, pointers start again from it.
      const childBase = own !== base ? own : base;
      const childPointer = own !== base ? '' : pointer;
      /** @type {Array<[string, string]>} */
      const childOuter = own !== base ? [[base, pointer], ...outer] : outer;
      for (const [k2, v] of sortedEntries(node)) {
        if (DATA_KEYS.has(k2)) continue;
        this.walkIndex(v, childBase, childPointer + '/' + escape(k2), deeper(childOuter, k2));
      }
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => this.walkIndex(v, base, `${pointer}/${i}`, deeper(outer, String(i))));
    } else if (typeof node === 'boolean') {
      // A boolean schema has no keywords, but a reference may name it.
      const entry = { node, own: base, base, pointer };
      for (const [b, p] of [[base, pointer], ...outer]) if (!nodes.has(key(b, '#' + p))) nodes.set(key(b, '#' + p), entry);
    }
  }

  /**
   * The node a reference names, as `[key, node]`.
   * @param {string} base @param {unknown} ref @returns {[string, Json]}
   */
  target(base, ref) {
    if (typeof ref !== 'string') throw new JsonSchemaError(`$ref ${JSON.stringify(stringable(ref))} is no URI`);
    const uri = resolveUri(base, ref);
    const [doc, fragment] = splitFragment(uri);
    let found;
    if (fragment === null || fragment === '') found = this.index.ids.get(doc);
    else if (fragment.startsWith('/')) found = this.pointerTarget(doc, fragment);
    else found = this.index.ids.get(doc + '#' + fragment);
    if (found === undefined) throw new JsonSchemaError(`$ref ${ref} names no schema among those given (resolved: ${uri})`);
    return [found, /** @type {Entry} */ (this.index.nodes.get(found)).node];
  }

  /** @param {string} doc @param {string} fragment @returns {string | undefined} */
  pointerTarget(doc, fragment) {
    const pointer = fragment
      .split('/')
      .slice(1)
      .map((s) => escape(unescape(s)))
      .join('/');
    const k = key(doc, '#/' + pointer);
    const id = this.index.ids.get(doc);
    if (id !== undefined) {
      const [base, frag] = splitKey(id);
      if (frag !== '#') {
        const joined = key(base, frag + '/' + pointer);
        return this.index.nodes.has(joined) ? joined : k;
      }
    }
    return this.index.nodes.has(k) ? k : undefined;
  }

  // ---- naming ------------------------------------------------------------------

  // Every schema that gets a name of its own: each document's root, its
  // `$defs` (`definitions`) entries, and whatever a reference names.
  /** @param {{name?: string}} opts */
  nameTargets(opts) {
    this.index.roots.forEach(([where, base], i) => {
      const k = /** @type {string} */ (this.index.ids.get(base));
      const node = /** @type {Entry} */ (this.index.nodes.get(k)).node;
      const name = i === 0 ? opts.name || titleName(node) || 'Root' : titleName(node) || fileName(where);
      this.name(k, name);
    });
    for (const [where, root] of this.docs) {
      const base = this.resourceId(root, baseOf(where));
      for (const defs of ['$defs', 'definitions']) {
        const entries = root instanceof Map ? root.get(defs) : undefined;
        if (!(entries instanceof Map)) continue;
        for (const [k] of entries) this.name(key(base, '#/' + defs + '/' + escape(k)), k);
      }
    }
    // A reference to a schema with no name yet names it from its path.
    for (const [where, root] of this.docs) this.collectRefs(root, this.resourceId(root, baseOf(where)));
  }

  /** A name for `k`, made an identifier and unique. @param {string} k @param {string} wanted */
  name(k, wanted) {
    if (this.names.has(k)) return;
    const base = identifier(wanted);
    let i = 1;
    let name = base;
    while (this.taken.has(name)) {
      i += 1;
      name = base + String(i);
    }
    this.names.set(k, name);
    this.taken.add(name);
  }

  /** @param {unknown} node @param {string} base */
  collectRefs(node, base) {
    if (node instanceof Map) {
      const own = this.resourceId(node, base);
      for (const kw of ['$ref', '$recursiveRef', '$dynamicRef']) {
        const ref = node.get(kw);
        if (typeof ref !== 'string') continue;
        const [k] = this.target(own, ref);
        this.name(k, this.pathName(k));
      }
      for (const [k, v] of sortedEntries(node)) if (!DATA_KEYS.has(k)) this.collectRefs(v, own);
    } else if (Array.isArray(node)) {
      for (const v of node) this.collectRefs(v, base);
    }
  }

  /** @param {string} k @returns {string} */
  pathName(k) {
    const [base, frag] = splitKey(k);
    const id = this.index.ids.get(base);
    const root = (id !== undefined && this.names.get(id)) || 'T';
    const parts = frag
      .slice(1)
      .split('/')
      .filter((s) => s !== '')
      .map(unescape)
      .filter((s) => !['properties', 'items', '$defs', 'definitions'].includes(s))
      .map(capitalize);
    return [root, ...parts].join('');
  }

  // ---- converting --------------------------------------------------------------

  convertAll() {
    const document = new DXNMap();
    const named = Array.from(this.names).sort(([, a], [, b]) => byCodepoint(a, b));
    for (const [k, name] of named) {
      const entry = this.index.nodes.get(k);
      if (!entry) throw new JsonSchemaError(`${k.slice(k.indexOf('#'))}: names no schema`);
      /** @type {Ctx} */
      const ctx = { base: entry.base, pointer: entry.pointer, top: k, path: '#' + entry.pointer };
      let type = this.convert(entry.node, ctx);
      if (this.structs) type = asStruct(type);
      document.set(new DXNKeyword(name), type);
    }
    return { document, inexact: this.inexact };
  }

  /** @param {Ctx} ctx @param {string} why */
  report(ctx, why) {
    this.inexact.push({ path: ctx.path, why });
  }

  /** A subschema: by name when it has one of its own, otherwise in place. @param {unknown} node @param {Ctx} ctx @returns {unknown} */
  sub(node, ctx) {
    const k = key(ctx.base, '#' + ctx.pointer);
    const name = this.names.get(k);
    if (name !== undefined && k !== ctx.top) return new DXNSymbol(name);
    return this.convert(node, ctx);
  }

  /** @param {unknown} node @param {Ctx} ctx @returns {unknown} */
  convert(node, ctx) {
    if (node === true) return kw('any');
    if (node === false) return kw('never');
    if (!(node instanceof Map)) throw new JsonSchemaError(`${ctx.path}: a schema is an object or a boolean`);
    // Below a schema with an `$id` of its own, pointers start again from
    // it, as the index has them.
    const own = this.resourceId(node, ctx.base);
    if (own !== ctx.base) ctx = { ...ctx, base: own, pointer: '' };
    // Before 2019-09 a $ref stands alone: its siblings are ignored.
    if (node.has('$ref') && ['04', '06', '07'].includes(this.draft)) return this.ref(node.get('$ref'), ctx);
    const type = allOf(this.parts(node, ctx));
    return this.annotated(type, node, ctx);
  }

  /** @param {unknown} ref @param {Ctx} ctx @returns {unknown} */
  ref(ref, ctx) {
    const [k, node] = this.target(ctx.base, ref);
    const name = this.names.get(k);
    if (name !== undefined) return new DXNSymbol(name);
    const entry = /** @type {Entry} */ (this.index.nodes.get(k));
    return this.convert(node, { ...ctx, base: entry.base, pointer: entry.pointer });
  }

  /**
   * The conjuncts a schema object says: its kinds, its values, its
   * combinators and its references.
   * @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]}
   */
  parts(node, ctx) {
    return [
      ...this.refPart(node, ctx),
      ...this.kindPart(node, ctx),
      ...enumPart(node),
      ...this.combinatorParts(node, ctx),
      ...this.conditionalPart(node, ctx),
      ...this.dependentParts(node, ctx),
      ...this.unevaluatedPropsPart(node, ctx),
      ...this.unevaluatedItemsPart(node, ctx),
      ...this.dynamicPart(node, ctx)
    ];
  }

  /** @param {Map<string, any>} node @param {Ctx} ctx */
  refPart(node, ctx) {
    const ref = node.get('$ref');
    return typeof ref === 'string' ? [this.ref(ref, at(ctx, '$ref'))] : [];
  }

  /** @param {Map<string, any>} node @param {Ctx} ctx */
  dynamicPart(node, ctx) {
    const k = ['$recursiveRef', '$dynamicRef'].find((x) => node.has(x));
    if (k === undefined) return [];
    if (this.dynamicAmbiguous()) {
      this.report(ctx, `${k} is read as a plain $ref: which schema it names depends on the evaluation path`);
    }
    return [this.ref(node.get(k), at(ctx, k))];
  }

  dynamicAmbiguous() {
    const seen = new Set();
    let count = 0;
    const entries = Array.from(this.index.nodes).sort(([a], [b]) => compareKeys(a, b));
    for (const [, e] of entries) {
      if (seen.has(e.own)) continue;
      seen.add(e.own);
      if (e.node instanceof Map && (e.node.has('$dynamicAnchor') || e.node.get('$recursiveAnchor') === true)) count += 1;
    }
    return count > 1;
  }

  // ---- kinds -------------------------------------------------------------------

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]} */
  kindPart(node, ctx) {
    const types = typesOf(node);
    if (types !== null) return [anyOf(types.map((kind) => this.kindType(kind, node, ctx, true)))];
    // No type: each kind's keywords apply to values of that kind only.
    /** @type {unknown[]} */
    const parts = [];
    for (const kind of ['string', 'number', 'array', 'object']) {
      if (constrains(node, kind)) parts.push(tup([kw('if'), plain(kind), this.kindType(kind, node, ctx, false)]));
    }
    return parts;
  }

  /** @param {unknown} kind @param {Map<string, any>} node @param {Ctx} ctx @param {boolean} typed @returns {unknown} */
  kindType(kind, node, ctx, typed) {
    if (kind !== null && typeof kind === 'object' && 'bson' in /** @type {any} */ (kind)) return this.bsonType(/** @type {any} */ (kind).bson, node, ctx, typed);
    switch (kind) {
      case 'string':
        return this.stringType(node, ctx, typed);
      case 'number':
      case 'integer':
        return refine(plain(kind), numberConstraints(node, this.draft === '04' || this.mongo));
      case 'array':
        return this.arrayType(node, ctx);
      case 'object':
        return this.objectType(node, ctx);
      case 'boolean':
      case 'null':
        return plain(kind);
      default:
        throw new JsonSchemaError(`${ctx.path}: unknown type ${inspect(kind)}; ${[...KINDS, 'integer'].join(', ')}`);
    }
  }

  // ---- MongoDB bsonType --------------------------------------------------------

  /** @param {unknown} bsonType @param {Map<string, any>} node @param {Ctx} ctx @param {boolean} typed @returns {unknown} */
  bsonType(bsonType, node, ctx, typed) {
    const numbers = (/** @type {unknown} */ base) => refine(base, numberConstraints(node, this.draft === '04' || this.mongo));
    switch (bsonType) {
      case 'double':
        return numbers(kw('float'));
      case 'int':
        return numbers(kw('int32'));
      case 'long':
        return numbers(kw('int64'));
      case 'decimal':
        return numbers(refine(kw('decimal'), [['max-precision', 34n]]));
      case 'number':
        return numbers(anyOf([kw('int32'), kw('int64'), kw('float'), kw('decimal')]));
      case 'string':
        return this.stringType(node, ctx, typed);
      case 'bool':
        return kw('boolean');
      case 'null':
        return kw('nil');
      case 'array':
        return this.arrayType(node, ctx);
      case 'object':
        return this.objectType(node, ctx);
      case 'objectId':
        return kw('objectid');
      case 'date':
        return refine(kw('timestamp'), [['resolution', kw('millisecond')]]);
      case 'binData':
        return kw('bytes');
      case 'regex':
        return kw('regex');
      case 'timestamp':
      case 'javascript':
      case 'minKey':
      case 'maxKey':
      case 'dbPointer':
      case 'symbol':
      case 'undefined':
      case 'javascriptWithScope':
        this.report(ctx, `bsonType ${bsonType} has no DXN value; read as :any`);
        return kw('any');
      default:
        throw new JsonSchemaError(`${ctx.path}: unknown bsonType ${inspect(bsonType)}`);
    }
  }

  // ---- strings -----------------------------------------------------------------

  /**
   * A date or time, uuid or uri format on a string is that DXN type
   * (logical types); it applies only where the schema says the value is
   * a string.
   * @param {Map<string, any>} node @param {Ctx} ctx @param {boolean} typed @returns {unknown}
   */
  stringType(node, ctx, typed) {
    const format = node.get('format');
    const onlyFormat = !['minLength', 'maxLength', 'pattern'].some((k) => node.has(k));
    if (this.assertFormats && typed && typeof format === 'string' && LOGICAL.has(format) && onlyFormat) {
      return kw(/** @type {string} */ (LOGICAL.get(format)));
    }
    if (this.assertFormats && typed && node.get('contentEncoding') === 'base64' && !node.has('contentMediaType') && onlyFormat) {
      return kw('bytes');
    }
    return refine(kw('string'), this.stringConstraints(node, ctx));
  }

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {Array<[string, unknown]>} */
  stringConstraints(node, ctx) {
    /** @type {Array<[string, unknown]>} */
    const out = [];
    for (const k of STRING_KEYS) {
      const v = node.get(k);
      if (v == null) continue;
      switch (k) {
        case 'minLength':
          out.push(['min-length', count(v)]);
          break;
        case 'maxLength':
          out.push(['max-length', count(v)]);
          break;
        case 'pattern': {
          const r = regex(v);
          if (r.ok) out.push(['pattern', r.regex]);
          else this.report(at(ctx, 'pattern'), `pattern ${inspect(v)}: ${r.why}; left out`);
          break;
        }
        case 'format': {
          if (!this.assertFormats) break;
          const name = FORMATS.get(v) ?? v;
          // An unknown format is no check in JSON Schema either; it is
          // kept in meta, not reported (T673 Q5).
          if (Format.names().includes(name)) out.push(['format', kw(name)]);
          break;
        }
        case 'contentEncoding':
          if (this.assertFormats && ['base64', 'base64url', 'base32', 'base16'].includes(v)) out.push(['encoding', kw(v)]);
          break;
        case 'contentMediaType':
          if (this.assertFormats) out.push(['media-type', v]);
          break;
        default:
          break;
      }
    }
    return out;
  }

  // ---- arrays ------------------------------------------------------------------

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown} */
  arrayType(node, ctx) {
    const { prefix, rest } = this.itemsOf(node, ctx);
    const list = listForm(prefix, rest);
    /** @type {Array<[string, unknown]>} */
    const constraints = /** @type {Array<[string, unknown]>} */ (
      [
        ['min-count', count(node.get('minItems'))],
        ['max-count', count(node.get('maxItems'))],
        ['unique', node.get('uniqueItems') === true ? true : undefined]
      ].filter(([, v]) => v != null)
    );
    if (node.has('contains')) {
      const type = this.sub(node.get('contains'), at(ctx, 'contains'));
      constraints.push(['contains', type], ['min-contains', count(node.has('minContains') ? node.get('minContains') : 1n)]);
      if (node.has('maxContains')) constraints.push(['max-contains', count(node.get('maxContains'))]);
    }
    return refine(list, constraints);
  }

  /**
   * The items a list must start with, and what every further one must be:
   * prefixItems and items in 2020-12, items as an array and
   * additionalItems before.
   * @param {Map<string, any>} node @param {Ctx} ctx
   * @returns {{prefix: unknown[] | null, rest: {all: boolean, type: unknown}}}
   */
  itemsOf(node, ctx) {
    const [prefixKey, restKey] = this.draft === '2020-12' ? ['prefixItems', 'items'] : ['items', 'additionalItems'];
    const written = node.get(prefixKey);
    const prefix = Array.isArray(written) ? written.map((schema, i) => this.sub(schema, at(at(ctx, prefixKey), String(i)))) : null;
    const items = node.get('items');
    let rest;
    if (this.draft !== '2020-12' && (items instanceof Map || typeof items === 'boolean')) {
      rest = { all: true, type: this.sub(items, at(ctx, 'items')) };
    } else if (prefix === null && this.draft === '2020-12' && node.has(restKey)) {
      // 2020-12's items with no prefixItems is every item; an
      // additionalItems with no items array means nothing.
      rest = { all: true, type: this.sub(node.get(restKey), at(ctx, restKey)) };
    } else if (prefix === null) {
      rest = { all: true, type: kw('any') };
    } else if (node.has(restKey)) {
      rest = { all: false, type: this.sub(node.get(restKey), at(ctx, restKey)) };
    } else {
      rest = { all: false, type: kw('any') };
    }
    return { prefix, rest };
  }

  // ---- objects -----------------------------------------------------------------

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown} */
  objectType(node, ctx) {
    const properties = pairsOf(node.get('properties'));
    const writtenRequired = node.has('required') ? node.get('required') : [];
    /** @type {unknown[]} */
    const required = Array.isArray(writtenRequired) ? writtenRequired : [];
    const patterns = pairsOf(node.get('patternProperties'));

    const patternEntries = patterns.map(([pattern, schema]) => {
      const pctx = at(at(ctx, 'patternProperties'), pattern);
      const value = this.sub(schema, pctx);
      const r = regex(pattern);
      if (!r.ok) throw new JsonSchemaError(`${pctx.path}: pattern ${inspect(pattern)}: ${r.why}`);
      return { regex: /** @type {DXNRegex} */ (r.regex), value };
    });

    const propertyNames = properties.map(([k]) => k);
    const names = [...propertyNames, ...required.filter((r) => !propertyNames.includes(/** @type {string} */ (r)))];

    /** @type {Array<[string, unknown]>} */
    const fields = [];
    /** @type {Array<{key: unknown, value: unknown}>} */
    let entries = [];
    for (const name of names) {
      // A `false` schema is a schema: found by its key, not its truth.
      const found = properties.find(([k]) => k === name);
      const schema = found ? found[1] : null;
      let type = schema == null ? kw('any') : this.sub(schema, at(at(ctx, 'properties'), /** @type {string} */ (name)));
      // A pattern that matches a declared name applies to it as well.
      const matching = patternEntries.filter((p) => matches(p.regex, /** @type {string} */ (name))).map((p) => p.value);
      type = allOf([type, ...matching]);
      const hasDefault = schema instanceof Map && schema.has('default');
      if (fieldName(name)) {
        const k = required.includes(name) ? /** @type {string} */ (name) : `${name}?`;
        fields.push([k, hasDefault ? field(type, jsonValue(/** @type {Map<string, any>} */ (schema).get('default'))) : type]);
      } else {
        entries.push({ key: tup([kw('const'), name]), value: type });
      }
    }

    const literalNames = entries.map((e) => /** @type {DXNTuple} */ (e.key).items[1]);
    const patternRegexes = patternEntries.map((p) => p.regex);
    entries = [...entries, ...patternEntries.map((p) => ({ key: refine(kw('string'), [['pattern', p.regex]]), value: p.value }))];

    // additionalProperties: nothing beyond the declared names and
    // patterns (`- *`), or a type for every other key.
    let closed = false;
    if (node.has('additionalProperties')) {
      const additional = node.get('additionalProperties');
      if (additional === false) closed = true;
      else if (additional !== true) {
        const value = this.sub(additional, at(ctx, 'additionalProperties'));
        entries = [...entries, { key: otherKeys(literalNames, patternRegexes), value }];
      }
    }

    // propertyNames: every key matches it. Extras that don't are refused
    // by an entry of :never; a declared name is checked here, now.
    if (node.has('propertyNames')) {
      const pctx = at(ctx, 'propertyNames');
      const type = this.sub(node.get('propertyNames'), pctx);
      if (fields.length > 0 || literalNames.length > 0) {
        this.report(pctx, 'propertyNames is checked on extra keys only; declared names are not checked against it');
      }
      entries = [{ key: tup([kw('not'), type]), value: kw('never') }, ...entries];
    }

    const struct = new DXNStruct('shape', { type: 'keyed', pairs: fields }, null, [], [], closed ? ['*'] : [], entries);
    const counts = /** @type {Array<[string, unknown]>} */ (
      [
        ['min-count', count(node.get('minProperties'))],
        ['max-count', count(node.get('maxProperties'))]
      ].filter(([, v]) => v != null)
    );
    const shape = fields.length === 0 && entries.length === 0 && !closed ? kw('map') : struct;
    // A required name that can't be a field is required by refusing the
    // map without it.
    const present = required.filter((name) => !fieldName(name)).map(presentKey);
    return allOf([refine(shape, counts), ...present]);
  }

  // ---- allOf, anyOf, oneOf, not, if ---------------------------------------------

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]} */
  combinatorParts(node, ctx) {
    /** @type {unknown[]} */
    const parts = [];
    for (const [k, head] of [
      ['allOf', 'all-of'],
      ['anyOf', 'any-of'],
      ['oneOf', 'one-of']
    ]) {
      const list = node.get(k);
      if (Array.isArray(list)) parts.push(tup([kw(head), ...list.map((s, i) => this.sub(s, at(at(ctx, k), String(i))))]));
    }
    if (node.has('not')) parts.push(tup([kw('not'), this.sub(node.get('not'), at(ctx, 'not'))]));
    return parts;
  }

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]} */
  conditionalPart(node, ctx) {
    if (!node.has('if') || !(node.has('then') || node.has('else'))) return [];
    const test = this.sub(node.get('if'), at(ctx, 'if'));
    const then = node.has('then') ? this.sub(node.get('then'), at(ctx, 'then')) : kw('any');
    const otherwise = node.has('else') ? this.sub(node.get('else'), at(ctx, 'else')) : kw('any');
    return [tup([kw('if'), test, then, otherwise])];
  }

  /**
   * dependentRequired, dependentSchemas, and draft-04's to 07's
   * dependencies: when a property is present, others are, or the value
   * matches a schema.
   * @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]}
   */
  dependentParts(node, ctx) {
    const required = pairsOf(node.get('dependentRequired'));
    const schemas = pairsOf(node.get('dependentSchemas'));
    const dependencies = pairsOf(node.get('dependencies'));
    const oldRequired = dependencies.filter(([, v]) => Array.isArray(v));
    const oldSchemas = dependencies.filter(([, v]) => !Array.isArray(v));
    return [
      ...[...required, ...oldRequired].map(([name, needed]) => tup([kw('if'), presentShape([name]), presentShape(needed)])),
      ...[
        ...schemas.map(([name, schema]) => ({ k: 'dependentSchemas', name, schema })),
        ...oldSchemas.map(([name, schema]) => ({ k: 'dependencies', name, schema }))
      ].map(({ k, name, schema }) => tup([kw('if'), presentShape([name]), this.sub(schema, at(at(ctx, k), name))]))
    ];
  }

  // ---- unevaluated -------------------------------------------------------------

  /**
   * unevaluatedProperties where it can be told from the schema alone: the
   * properties and patterns of this schema, its allOf branches and what it
   * references. Each part that evaluates properties only when something
   * passes -- if/then/else, an anyOf or oneOf branch, a dependentSchemas
   * entry -- is one condition: the rule is written for each way they can
   * go, chosen by the same conditions with {:if}.
   * @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]}
   */
  unevaluatedPropsPart(node, ctx) {
    if (!node.has('unevaluatedProperties')) return [];
    const uctx = at(ctx, 'unevaluatedProperties');
    const base = without(node, ['unevaluatedProperties', 'if', 'then', 'else', 'anyOf', 'oneOf', 'dependentSchemas']);
    const conditions = this.conditions(node, ctx);
    if (conditions.length > 6) {
      this.report(uctx, 'unevaluatedProperties over more than six conditional branches; left out');
      return [];
    }
    const rule = this.byConditions(conditions, [base], node.get('unevaluatedProperties'), ctx, uctx, false);
    return rule === null ? [] : [rule];
  }

  /** @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown[]} */
  unevaluatedItemsPart(node, ctx) {
    if (!node.has('unevaluatedItems')) return [];
    const uctx = at(ctx, 'unevaluatedItems');
    const base = without(node, ['unevaluatedItems', 'if', 'then', 'else', 'anyOf', 'oneOf', 'dependentSchemas']);
    const conditions = this.conditions(node, ctx);
    if (conditions.length > 6) {
      this.report(uctx, 'unevaluatedItems over more than six conditional branches; left out');
      return [];
    }
    const rule = this.byConditions(conditions, [base], node.get('unevaluatedItems'), ctx, uctx, true);
    return rule === null ? [] : [rule];
  }

  /**
   * `{test, passed, failed}`: the type to test, and the schemas whose
   * properties count as evaluated either way.
   * @param {Map<string, any>} node @param {Ctx} ctx
   * @returns {Array<{test: unknown, passed: unknown[], failed: unknown[]}>}
   */
  conditions(node, ctx) {
    const found = [];
    if (node.has('if')) {
      const test = this.sub(node.get('if'), at(ctx, 'if'));
      found.push({
        test,
        passed: [node.get('if'), node.has('then') ? node.get('then') : true],
        failed: [node.has('else') ? node.get('else') : true]
      });
    }
    for (const k of ['anyOf', 'oneOf']) {
      wrap(node.get(k)).forEach((branch, i) => {
        found.push({ test: this.sub(branch, at(at(ctx, k), String(i))), passed: [branch], failed: [] });
      });
    }
    for (const [name, schema] of pairsOf(node.get('dependentSchemas'))) {
      found.push({ test: presentShape([name]), passed: [schema], failed: [] });
    }
    return found;
  }

  /**
   * The rule for each way `conditions` can go.
   * @param {Array<{test: unknown, passed: unknown[], failed: unknown[]}>} conditions @param {unknown[]} evaluated
   * @param {unknown} schema @param {Ctx} ctx @param {Ctx} uctx @param {boolean} items
   * @returns {unknown}
   */
  byConditions(conditions, evaluated, schema, ctx, uctx, items) {
    if (conditions.length === 0) {
      const all = new Map([['allOf', evaluated]]);
      return items
        ? this.itemsRule(schema, this.evaluatedItems(all, ctx.base, new Set(), { path: ctx.path, how: 'merged' }), uctx)
        : this.unevaluatedRule(schema, this.evaluatedProps(all, ctx.base, new Set()), uctx);
    }
    const [{ test, passed, failed }, ...more] = conditions;
    const yes = this.byConditions(more, [...evaluated, ...passed], schema, ctx, uctx, items);
    const no = this.byConditions(more, [...evaluated, ...failed], schema, ctx, uctx, items);
    if (same(yes, no)) return yes;
    return tup([kw('if'), test, yes ?? kw('any'), no ?? kw('any')]);
  }

  /**
   * The type that says unevaluatedProperties for what `evaluated` names,
   * `null` for none.
   * @param {unknown} schema @param {Evaluated} evaluated @param {Ctx} uctx @returns {unknown}
   */
  unevaluatedRule(schema, evaluated, uctx) {
    if (evaluated.kind === 'all') return null;
    if (evaluated.kind === 'dynamic') {
      this.report(uctx, `unevaluatedProperties depends on ${evaluated.why}; left out`);
      return null;
    }
    const regexes = evaluated.patterns.map((p) => {
      const r = regex(p);
      if (!r.ok) throw new JsonSchemaError(`${uctx.path}: pattern ${inspect(p)}: ${r.why}`);
      return /** @type {DXNRegex} */ (r.regex);
    });
    const names = [...evaluated.names].sort(byCodepoint);
    const entries = [
      ...names.map((n) => ({ key: tup([kw('const'), n]), value: kw('any') })),
      ...regexes.map((r) => ({ key: refine(kw('string'), [['pattern', r]]), value: kw('any') }))
    ];
    /** @type {Array<{key: unknown, value: unknown}>} */
    let rest = [];
    let closed = false;
    if (schema === false) closed = true;
    else if (schema !== true) rest = [{ key: otherKeys(names, regexes), value: this.sub(schema, uctx) }];
    if (rest.length === 0 && !closed) return null;
    const shape = new DXNStruct('shape', { type: 'keyed', pairs: [] }, null, [], [], closed ? ['*'] : [], [...entries, ...rest]);
    return tup([kw('if'), kw('map'), shape]);
  }

  /** @param {unknown} node @param {string} base @param {Set<string>} seen @returns {Evaluated} */
  evaluatedProps(node, base, seen) {
    if (!(node instanceof Map)) return { kind: 'static', names: new Set(), patterns: [] };
    base = this.resourceId(node, base);
    if (node.has('additionalProperties') || (node.has('unevaluatedProperties') && seen.size > 0)) return { kind: 'all' };
    if (['anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas'].some((k) => namesProps(node.get(k)))) {
      return { kind: 'dynamic', why: 'which anyOf, oneOf, if or dependentSchemas branch passed' };
    }
    /** @type {Evaluated} */
    let acc = {
      kind: 'static',
      names: new Set(pairsOf(node.get('properties')).map(([k]) => k)),
      patterns: pairsOf(node.get('patternProperties')).map(([k]) => k)
    };
    for (const [child, b, s] of this.children(node, base, seen)) acc = mergeEval(acc, this.evaluatedProps(child, b, s));
    return acc;
  }

  /**
   * What a schema's evaluation reaches: what its `$ref` names, unless
   * seen on the way, and its allOf branches.
   * @param {Map<string, any>} node @param {string} base @param {Set<string>} seen
   * @returns {Array<[unknown, string, Set<string>]>}
   */
  children(node, base, seen) {
    /** @type {Array<[unknown, string, Set<string>]>} */
    const found = [];
    if (node.has('$ref')) {
      const [k, target] = this.target(base, node.get('$ref'));
      if (!seen.has(k)) found.push([target, splitKey(k)[0], new Set([...seen, k])]);
    }
    for (const b of wrap(node.get('allOf'))) found.push([b, base, new Set([...seen, BRANCH])]);
    return found;
  }

  /**
   * unevaluatedItems, as unevaluatedProperties: the items beyond the
   * longest prefix this schema, its allOf branches and what it references
   * give, unless an `items` takes them all; an item `contains` matches is
   * evaluated too.
   * @param {unknown} schema @param {EvaluatedItems} evaluated @param {Ctx} uctx @returns {unknown}
   */
  itemsRule(schema, evaluated, uctx) {
    if (evaluated.kind === 'all') return null;
    if (evaluated.kind === 'dynamic') {
      this.report(uctx, `unevaluatedItems depends on ${evaluated.why}; left out`);
      return null;
    }
    const value = this.sub(schema, uctx);
    const contained = evaluated.contains.map(([c, cctx]) => this.sub(c, cctx));
    const rest = contained.length === 0 ? value : anyOf([...contained, value]);
    if (isKw(rest, 'any')) return null;
    const list = listForm(evaluated.prefix === 0 ? null : Array.from({ length: evaluated.prefix }, () => kw('any')), { all: false, type: rest });
    return tup([kw('if'), kw('list'), list]);
  }

  /**
   * What a schema evaluates of a list. `where` is where the schema is,
   * for a report from inside a contains: `merged` for the parts of one
   * schema gathered under the path they stand at.
   * @param {unknown} node @param {string} base @param {Set<string>} seen @param {{path: string, how: 'merged' | 'own'}} where
   * @returns {EvaluatedItems}
   */
  evaluatedItems(node, base, seen, where) {
    if (!(node instanceof Map)) return { kind: 'static', prefix: 0, contains: [] };
    base = this.resourceId(node, base);
    const [prefixKey, restKey] = this.draft === '2020-12' ? ['prefixItems', 'items'] : ['items', 'additionalItems'];
    const items = node.get('items');
    if (
      (this.draft !== '2020-12' && (items instanceof Map || typeof items === 'boolean')) ||
      (node.has(restKey) && (this.draft === '2020-12' || Array.isArray(items)))
    ) {
      return { kind: 'all' };
    }
    if (node.has('unevaluatedItems') && seen.size > 0) return { kind: 'all' };
    if (['anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas'].some((k) => itemsNamed(node.get(k)))) {
      return { kind: 'dynamic', why: 'which anyOf, oneOf or if branch passed, below the top' };
    }
    const prefix = node.get(prefixKey);
    /** @type {Array<[unknown, Ctx]>} */
    const contains =
      node.has('contains') && (this.draft === '2020-12' || this.draft === '2019-09')
        ? [[node.get('contains'), { base, pointer: '/\u0000' + where.path + '/contains', top: null, path: where.path + '/contains' }]]
        : [];
    /** @type {EvaluatedItems} */
    let acc = { kind: 'static', prefix: Array.isArray(prefix) ? prefix.length : 0, contains };
    // What a $ref names is where its pointer says; an allOf branch below
    // its own schema, or, under the merged allOf, where that schema is.
    /** @type {Array<[unknown, string, Set<string>, {path: string, how: 'merged' | 'own'}]>} */
    const children = [];
    if (node.has('$ref')) {
      const [k, target] = this.target(base, node.get('$ref'));
      if (!seen.has(k)) children.push([target, splitKey(k)[0], new Set([...seen, k]), { path: splitKey(k)[1], how: 'own' }]);
    }
    wrap(node.get('allOf')).forEach((b, i) => {
      const at = where.how === 'merged' ? { path: where.path, how: /** @type {const} */ ('own') } : { path: `${where.path}/allOf/${i}`, how: /** @type {const} */ ('own') };
      children.push([b, base, new Set([...seen, BRANCH]), at]);
    });
    for (const [child, b, s, w] of children) acc = mergeItems(acc, this.evaluatedItems(child, b, s, w));
    return acc;
  }

  // ---- annotations ---------------------------------------------------------------

  /** @param {unknown} type @param {Map<string, any>} node @param {Ctx} ctx @returns {unknown} */
  annotated(type, node, ctx) {
    void ctx;
    const notes = new DXNMap();
    for (const [k, name] of NOTES) {
      if (!node.has(k)) continue;
      const value = node.get(k);
      notes.set(new DXNKeyword(name), k === 'examples' ? new DXNList(wrap(value).map(jsonValue)) : jsonValue(value));
    }
    if (node.get('deprecated') === false) notes.delete(new DXNKeyword('deprecated'));

    const meta = new DXNMap();
    for (const [k, v] of sortedEntries(node)) if (!KNOWN.has(k)) meta.set('json-schema.' + k, jsonValue(v));
    const format = node.get('format');
    if (typeof format === 'string' && (!this.assertFormats || !Format.names().includes(FORMATS.get(format) ?? format))) {
      meta.set('json-schema.format', format);
    }
    if (!this.assertFormats) {
      for (const k of ['contentEncoding', 'contentMediaType']) if (node.has(k)) meta.set('json-schema.' + k, node.get(k));
    }
    if (node.has('$comment')) meta.set('json-schema.$comment', node.get('$comment'));
    if (node.has('contentSchema')) meta.set('json-schema.contentSchema', jsonValue(node.get('contentSchema')));
    if (meta.size > 0) notes.set(new DXNKeyword('meta'), meta);

    const discriminator = node.get('discriminator');
    if (discriminator instanceof Map && typeof discriminator.get('propertyName') === 'string') {
      notes.set(new DXNKeyword('discriminator'), new DXNKeyword(discriminator.get('propertyName')));
    }
    return notes.size === 0 ? type : tup([kw('doc'), type, notes]);
  }
}

/**
 * Where a check stands: the base a reference resolves against, the JSON
 * pointer from it, the key of the named schema being converted (a schema
 * is in place there, not by its name), and the path reports name.
 * @typedef {{base: string, pointer: string, top: string | null, path: string}} Ctx
 */

/** @typedef {{node: Json, own: string, base: string, pointer: string}} Entry */

/** `ctx` one step deeper, at `segment`. @param {Ctx} ctx @param {string} segment @returns {Ctx} */
function at(ctx, segment) {
  return { ...ctx, pointer: ctx.pointer + '/' + escape(segment), path: ctx.path + '/' + escape(segment), top: null };
}

/**
 * What a schema evaluates of a map's keys.
 * @typedef {{kind: 'all'} | {kind: 'dynamic', why: string} | {kind: 'static', names: Set<string>, patterns: string[]}} Evaluated
 */

/**
 * What a schema evaluates of a list: all of it, or the prefix length and
 * the contains schemas.
 * @typedef {{kind: 'all'} | {kind: 'dynamic', why: string} | {kind: 'static', prefix: number, contains: Array<[unknown, Ctx]>}} EvaluatedItems
 */

// ---- drafts --------------------------------------------------------------------

/** @param {Array<[string, Json]>} docs @param {{draft?: string}} opts @returns {string} */
function draftOf(docs, opts) {
  const [, root] = docs[0];
  const uri = root instanceof Map ? root.get('$schema') : undefined;
  // A metaschema of its own: read as the draft asked for, and said so.
  if (typeof uri === 'string' && draftOfUri(uri) !== undefined) return /** @type {string} */ (draftOfUri(uri));
  const draft = opts.draft ?? '2020-12';
  if (![...DRAFTS.values()].includes(draft)) throw new JsonSchemaError(`unknown draft ${draft}: 04, 06, 07, 2019-09 or 2020-12`);
  return draft;
}

/** @param {string} uri @returns {string | undefined} */
function draftOfUri(uri) {
  let plainUri = uri.endsWith('#') ? uri.replace(/#+$/, '') : uri;
  if (plainUri.startsWith('https://json-schema.org/draft-0')) plainUri = 'http://json-schema.org/draft-0' + plainUri.slice('https://json-schema.org/draft-0'.length);
  return DRAFTS.get(plainUri);
}

/** Whether `bsonType` appears anywhere in `value`. @param {unknown} value @returns {boolean} */
function bson(value) {
  if (value instanceof Map) return value.has('bsonType') || Array.from(value.values()).some(bson);
  if (Array.isArray(value)) return value.some(bson);
  return false;
}

// ---- kinds and values -------------------------------------------------------------

/** @param {Map<string, any>} node @returns {unknown[] | null} */
function typesOf(node) {
  if (node.has('bsonType')) return [...wrap(node.get('bsonType')).map((b) => ({ bson: b })), ...wrap(node.get('type'))];
  const type = node.get('type');
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type;
  return null;
}

/** @param {Map<string, any>} node @param {string} kind */
function constrains(node, kind) {
  const keys = { string: STRING_KEYS, number: NUMBER_KEYS, array: ARRAY_KEYS, object: OBJECT_KEYS }[/** @type {'string'} */ (kind)];
  return keys.some((k) => node.has(k));
}

/** The DXN type of a kind, with no constraint. @param {string} kind */
function plain(kind) {
  return kw({ string: 'string', number: 'number', integer: 'integer', array: 'list', object: 'map', boolean: 'boolean', null: 'nil' }[kind] ?? kind);
}

/**
 * @param {Map<string, any>} node @param {boolean} draft04 whether draft-04's (and MongoDB's) boolean exclusives apply
 * @returns {Array<[string, unknown]>}
 */
function numberConstraints(node, draft04) {
  /** @type {Array<[string, unknown]>} */
  const out = [];
  for (const k of NUMBER_KEYS) {
    const n = node.get(k);
    if (n == null) continue;
    if (k === 'minimum') out.push([draft04 && node.get('exclusiveMinimum') === true ? 'exclusive-min' : 'min', n]);
    else if (k === 'maximum') out.push([draft04 && node.get('exclusiveMaximum') === true ? 'exclusive-max' : 'max', n]);
    else if (k === 'exclusiveMinimum' && isNumber(n)) out.push(['exclusive-min', n]);
    else if (k === 'exclusiveMaximum' && isNumber(n)) out.push(['exclusive-max', n]);
    else if (k === 'multipleOf') out.push(['multiple-of', n]);
  }
  return out;
}

/** @param {unknown} n */
function isNumber(n) {
  return typeof n === 'number' || typeof n === 'bigint';
}

/** A count written `2.0` is the integer 2, as JSON Schema reads it. @param {unknown} n @returns {unknown} */
function count(n) {
  return typeof n === 'number' && Number.isInteger(n) ? BigInt(n) : n;
}

/**
 * A list of the items `prefix` gives, each optional but only after the
 * ones before it, then `rest`; or every item `rest.type`.
 * @param {unknown[] | null} prefix @param {{all: boolean, type: unknown}} rest @returns {unknown}
 */
function listForm(prefix, rest) {
  if (prefix === null) return listOf(rest.type);
  const tail = isKw(rest.type, 'never') ? null : tup([kw('repeat'), rest.type, 0n, null]);
  let nested = tail;
  for (const item of [...prefix].reverse()) {
    const group = nested ? tup([kw('group'), item, nested]) : item;
    nested = tup([kw('repeat'), group, 0n, 1n]);
  }
  return tup([kw('list-items'), nested]);
}

/** @param {unknown} type */
function listOf(type) {
  return isKw(type, 'any') ? kw('list') : tup([kw('list-of'), type]);
}

/** @param {Map<string, any>} node @returns {unknown[]} */
function enumPart(node) {
  const parts = [];
  const values = node.get('enum');
  if (Array.isArray(values)) parts.push(tup([kw('enum'), ...values.map(jsonValue)]));
  if (node.has('const')) parts.push(tup([kw('const'), jsonValue(node.get('const'))]));
  return parts;
}

/** The keys no literal name and no pattern takes. @param {unknown[]} names @param {DXNRegex[]} patterns */
function otherKeys(names, patterns) {
  if (names.length === 0 && patterns.length === 0) return kw('string');
  const nots = [
    ...(names.length === 0 ? [] : [tup([kw('not'), tup([kw('enum'), ...names])])]),
    ...patterns.map((p) => tup([kw('not'), refine(kw('string'), [['pattern', p]])]))
  ];
  return tup([kw('all-of'), kw('string'), ...nots]);
}

/** @param {unknown} name */
function fieldName(name) {
  return typeof name === 'string' && /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(name) && !name.endsWith('-') && !['nil', 'true', 'false'].includes(name);
}

/** @param {unknown} type @param {unknown} defaultValue */
function field(type, defaultValue) {
  return new DXNStruct('field', {
    type: 'keyed',
    pairs: [
      ['type', type],
      ['default', defaultValue]
    ]
  });
}

/**
 * A map with these keys present: a shape whose fields are those names,
 * each of any value.
 * @param {unknown} names @returns {unknown}
 */
function presentShape(names) {
  const list = wrap(names);
  const fields = list.filter(fieldName);
  const others = list.filter((n) => !fieldName(n));
  const parts = [
    ...(fields.length === 0 ? [] : [new DXNStruct('shape', { type: 'keyed', pairs: fields.map((n) => [/** @type {string} */ (n), kw('any')]) })]),
    ...others.map(presentKey)
  ];
  return parts.length === 0 ? kw('any') : allOf(parts);
}

/**
 * A map with `name` present, whatever `name` is: one that a shape
 * refusing that key does not take.
 * @param {unknown} name
 */
function presentKey(name) {
  const absent = new DXNStruct('shape', { type: 'keyed', pairs: [] }, null, [], [], [], [{ key: tup([kw('const'), name]), value: kw('never') }]);
  return allOf([kw('map'), tup([kw('not'), absent])]);
}

/** @param {unknown} node */
function namesProps(node) {
  if (Array.isArray(node)) return node.some(namesProps);
  if (node instanceof Map) {
    return ['properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties'].some((k) => node.has(k)) || Array.from(node.values()).some(namesProps);
  }
  return false;
}

/** @param {unknown} node */
function itemsNamed(node) {
  if (Array.isArray(node)) return node.some(itemsNamed);
  if (node instanceof Map) {
    return ['items', 'prefixItems', 'additionalItems', 'contains', 'unevaluatedItems'].some((k) => node.has(k)) || Array.from(node.values()).some(itemsNamed);
  }
  return false;
}

/** @param {Evaluated} a @param {Evaluated} b @returns {Evaluated} */
function mergeEval(a, b) {
  if (a.kind === 'all' || b.kind === 'all') return { kind: 'all' };
  if (a.kind === 'dynamic') return a;
  if (b.kind === 'dynamic') return b;
  return { kind: 'static', names: new Set([...a.names, ...b.names]), patterns: [...a.patterns, ...b.patterns] };
}

/** @param {EvaluatedItems} a @param {EvaluatedItems} b @returns {EvaluatedItems} */
function mergeItems(a, b) {
  if (a.kind === 'all' || b.kind === 'all') return { kind: 'all' };
  if (a.kind === 'dynamic') return a;
  if (b.kind === 'dynamic') return b;
  return { kind: 'static', prefix: Math.max(a.prefix, b.prefix), contains: [...a.contains, ...b.contains] };
}

/**
 * A named object schema written as a `%schema` (`structs: true`): only
 * where the shape is the whole definition, so nothing but its fields is
 * said.
 * @param {unknown} type @returns {unknown}
 */
function asStruct(type) {
  if (type instanceof DXNStruct && type.name === 'shape') return rename(type, 'schema');
  if (type instanceof DXNTuple && isKw(type.items[0], 'doc') && type.items[1] instanceof DXNStruct && type.items[1].name === 'shape') {
    return tup([kw('doc'), rename(type.items[1], 'schema'), type.items[2]]);
  }
  return type;
}

/** @param {DXNStruct} struct @param {string} name */
function rename(struct, name) {
  return new DXNStruct(name, struct.fields, struct.version, struct.extra, struct.bases, struct.drops, struct.rest);
}

// ---- names ---------------------------------------------------------------------

/**
 * `text` as an identifier: characters an identifier can't hold become
 * `_`; one that would not begin as an identifier does is prefixed `T`.
 * @param {string} text @returns {string}
 */
function identifier(text) {
  const cleaned = text.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  if (cleaned === '') return 'T';
  return /^[\p{L}_]/u.test(cleaned) ? cleaned : 'T' + cleaned;
}

/** @param {unknown} node */
function titleName(node) {
  const title = node instanceof Map ? node.get('title') : undefined;
  return typeof title === 'string' && title !== '' ? identifier(title) : null;
}

/** @param {string} where */
function fileName(where) {
  const base = where.split(/[\\/]/).pop() ?? where;
  return identifier(base.split('.')[0]);
}

/** As Elixir's `String.capitalize/1`: the first letter upper case, the rest lower. @param {string} s */
function capitalize(s) {
  const [first = '', ...rest] = Array.from(s);
  return first.toUpperCase() + rest.join('').toLowerCase();
}

// ---- URIs and pointers -------------------------------------------------------------

/** A key of the index: a base and a fragment, `#/pointer`. @param {string} base @param {string} fragment */
function key(base, fragment) {
  return base + fragment;
}

/** @param {string} k @returns {[string, string]} */
function splitKey(k) {
  const i = k.indexOf('#');
  return [k.slice(0, i), k.slice(i)];
}

/** Keys as the reference's tuples order: by base, then by fragment. @param {string} a @param {string} b */
function compareKeys(a, b) {
  const [ab, af] = splitKey(a);
  const [bb, bf] = splitKey(b);
  return byCodepoint(ab, bb) || byCodepoint(af, bf);
}

/** @param {string} where */
function baseOf(where) {
  return where.includes('://') ? stripFragment(where) : 'file:///' + where;
}

/** @param {string} uri */
function stripFragment(uri) {
  const i = uri.indexOf('#');
  return i < 0 ? uri : uri.slice(0, i);
}

/** @param {string} uri @returns {[string, string | null]} */
function splitFragment(uri) {
  const i = uri.indexOf('#');
  return i < 0 ? [uri, null] : [uri.slice(0, i), uri.slice(i + 1)];
}

/** @param {Array<[string, string]>} outer @param {string} segment @returns {Array<[string, string]>} */
function deeper(outer, segment) {
  return outer.map(([b, p]) => [b, p + '/' + escape(segment)]);
}

/** @param {string} k */
function escape(k) {
  return k.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** @param {string} segment */
function unescape(segment) {
  return percentDecoded(segment).replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * `text` percent-decoded as Elixir's `URI.decode/1` decodes it: a `%` not
 * followed by two hex digits is left as it is.
 * @param {string} text
 */
function percentDecoded(text) {
  if (!text.includes('%')) return text;
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < text.length; ) {
    const hex = text[i] === '%' ? /^[0-9A-Fa-f]{2}$/.exec(text.slice(i + 1, i + 3)) : null;
    if (hex) {
      bytes.push(parseInt(hex[0], 16));
      i += 3;
    } else {
      const point = /** @type {number} */ (text.codePointAt(i));
      const char = String.fromCodePoint(point);
      bytes.push(...Buffer.from(char, 'utf8'));
      i += char.length;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * `ref` resolved against `base` as Elixir's `URI.merge/2` resolves it
 * (RFC 3986 §5.2); a base that is no absolute URI leaves `ref` as it is.
 * @param {string} base @param {string} ref @returns {string}
 */
function resolveUri(base, ref) {
  if (ref === '') return base;
  if (ref.startsWith('#')) return base + ref;
  const b = parseUri(base);
  const r = parseUri(ref);
  if (b.scheme === null) return ref;
  /** @type {Uri} */
  let t;
  if (r.scheme !== null) {
    t = { ...r, path: removeDots(r.path) };
  } else if (r.authority !== null) {
    t = { ...r, scheme: b.scheme, path: removeDots(r.path) };
  } else if (r.path === '') {
    t = { ...b, query: r.query ?? b.query, fragment: r.fragment };
  } else if (r.path.startsWith('/')) {
    t = { ...b, path: removeDots(r.path), query: r.query, fragment: r.fragment };
  } else {
    const basePath = b.authority !== null && b.path === '' ? '/' : b.path;
    const merged = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) + r.path : r.path;
    t = { ...b, path: removeDots(merged), query: r.query, fragment: r.fragment };
  }
  return formatUri(t);
}

/** @typedef {{scheme: string | null, authority: string | null, path: string, query: string | null, fragment: string | null}} Uri */

/** @param {string} text @returns {Uri} */
function parseUri(text) {
  const m = /** @type {RegExpExecArray} */ (/^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s.exec(text));
  return { scheme: m[1] ?? null, authority: m[2] ?? null, path: m[3], query: m[4] ?? null, fragment: m[5] ?? null };
}

/** @param {Uri} uri */
function formatUri(uri) {
  return (
    (uri.scheme !== null ? uri.scheme + ':' : '') +
    (uri.authority !== null ? '//' + uri.authority : '') +
    uri.path +
    (uri.query !== null ? '?' + uri.query : '') +
    (uri.fragment !== null ? '#' + uri.fragment : '')
  );
}

/** RFC 3986 §5.2.4. @param {string} path */
function removeDots(path) {
  let input = path;
  let output = '';
  while (input.length > 0) {
    if (input.startsWith('../')) input = input.slice(3);
    else if (input.startsWith('./')) input = input.slice(2);
    else if (input.startsWith('/./')) input = input.slice(2);
    else if (input === '/.') input = '/';
    else if (input.startsWith('/../')) {
      input = input.slice(3);
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
    } else if (input === '/..') {
      input = '/';
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
    } else if (input === '.' || input === '..') input = '';
    else {
      const next = input.indexOf('/', input.startsWith('/') ? 1 : 0);
      const segment = next < 0 ? input : input.slice(0, next);
      output += segment;
      input = input.slice(segment.length);
    }
  }
  return output;
}

// ---- regexes ---------------------------------------------------------------------

/**
 * A JSON Schema (ECMA-262) pattern as a DXN regex, read by code points
 * (the `u` flag) as ECMA-262 reads it: `\d` and `\w` are ASCII there,
 * `$` matches only at the very end, `\uXXXX` is a code point.
 * @param {unknown} pattern @returns {{ok: true, regex: DXNRegex} | {ok: false, why: string}}
 */
function regex(pattern) {
  if (typeof pattern !== 'string') return { ok: false, why: 'not a regex DXN reads' };
  const translated = ecmaToPcre(pattern);
  if (!translated.ok) return translated;
  const value = new DXNRegex(translated.source, { u: true });
  try {
    value.toRegExp();
  } catch (err) {
    return { ok: false, why: /** @type {Error} */ (err).message };
  }
  return { ok: true, regex: value };
}

/** @param {string} pattern @returns {{ok: true, source: string} | {ok: false, why: string}} */
function ecmaToPcre(pattern) {
  const cs = Array.from(pattern);
  let out = '';
  let cls = false;
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (c === '\\' && i + 1 < cs.length) {
      const d = cs[i + 1];
      if (d === 'd') out += cls ? '0-9' : '[0-9]';
      else if (d === 'D' && !cls) out += '[^0-9]';
      else if (d === 'w') out += cls ? 'A-Za-z0-9_' : '[A-Za-z0-9_]';
      else if (d === 'W' && !cls) out += '[^A-Za-z0-9_]';
      else if ((d === 'D' || d === 'W') && cls) return { ok: false, why: `\\${d} inside a character class can't be written in PCRE here` };
      else if (d === 'u') {
        const hex = cs.slice(i + 2, i + 6);
        if (hex.length === 4 && hex.every((h) => /^[0-9A-Fa-f]$/.test(h))) {
          out += '\\x{' + hex.join('') + '}';
          i += 6;
          continue;
        }
        out += '\\u';
        i += 2;
        continue;
      } else out += '\\' + d;
      i += 2;
      continue;
    }
    if (c === '[' && !cls) cls = true;
    else if (c === ']' && cls) cls = false;
    else if (c === '$' && !cls) {
      out += '\\z';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return { ok: true, source: out };
}

/** Whether `regex` matches `text`. @param {DXNRegex} regex @param {string} text */
function matches(regex, text) {
  return typeof text === 'string' && regex.toRegExp().test(text);
}

// ---- building DXN values -----------------------------------------------------------

/** @param {string} name */
function kw(name) {
  return new DXNKeyword(name);
}

/** @param {unknown[]} items */
function tup(items) {
  return new DXNTuple(items);
}

/** @param {unknown} value @param {string} name */
function isKw(value, name) {
  return value instanceof DXNKeyword && value.name === name;
}

/** @param {unknown} base @param {Array<[string, unknown]>} constraints */
function refine(base, constraints) {
  if (constraints.length === 0) return base;
  return tup([kw('refine'), base, new DXNMap(constraints.map(([k, v]) => [kw(k), v]))]);
}

/** @param {unknown[]} parts */
function allOf(parts) {
  if (parts.length === 0) return kw('any');
  if (parts.length === 1) return parts[0];
  return tup([kw('all-of'), ...parts]);
}

/** @param {unknown[]} types */
function anyOf(types) {
  return types.length === 1 ? types[0] : tup([kw('any-of'), ...types]);
}

/** Whether two rules are the same, `null` for none. @param {unknown} a @param {unknown} b */
function same(a, b) {
  return a === null || b === null ? a === b : dxnEquals(a, b);
}

// ---- helpers ---------------------------------------------------------------------

/** A map's entries in the order written; `[]` for any other value. @param {unknown} value @returns {Array<[string, any]>} */
function pairsOf(value) {
  return value instanceof Map ? Array.from(value) : [];
}

/** A map's entries sorted by key, as the reference walks its maps. @param {Map<string, any>} node */
function sortedEntries(node) {
  return Array.from(node).sort(([a], [b]) => byCodepoint(a, b));
}

/** @param {Map<string, any>} node @param {string[]} keys */
function without(node, keys) {
  return new Map(Array.from(node).filter(([k]) => !keys.includes(k)));
}

/**
 * As Elixir's `List.wrap/1`: `[]` for none (left out, or JSON's `null`),
 * a list as it is, anything else in one.
 * @param {unknown} value @returns {unknown[]}
 */
function wrap(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Strings in code point order, as Elixir's term order compares them. @param {string} a @param {string} b */
function byCodepoint(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** A value as a refusal names it, as Elixir's `inspect/1` would. @param {unknown} value @returns {string} */
function inspect(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(stringable(value));
}

/** @param {unknown} value @returns {unknown} */
function stringable(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return JSON.stringify(Object.fromEntries(Array.from(value, ([k, v]) => [k, stringable(v)])));
  if (Array.isArray(value)) return JSON.stringify(value.map(stringable));
  return value;
}

module.exports = { toDxns, decodeJson, jsonValue, identifier, regex, JsonSchemaError };
