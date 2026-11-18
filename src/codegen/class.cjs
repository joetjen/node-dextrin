'use strict';

/**
 * @fileoverview One schema's generated class, `Abstract<Class>`
 * (`codegen/javascript.cjs`, design/codegen-node.md): the source of the
 * `.js` file the generator rewrites, its regions empty, and of the `.d.ts`
 * beside it. The port of php-dextrin's `Codegen\PhpClass`.
 *
 * Each distinct type a field uses becomes one module function (`t1()`,
 * `t2()`, ...) answering the value checked -- a shape with its defaults
 * filled, a reference read into its class -- or throwing `InvalidData`; a
 * recursive named type's is named after it. Every constant a check needs
 * (a default, an enum's literals, a refine's constraints) is written as
 * DXN text and decoded the first time it is needed.
 *
 * What only the class's own code uses -- reading a struct, a version's
 * checks, the upgrade chain, making a value -- are module functions, not
 * private static methods: a private static method can't be reached
 * through `this` when `this` is the user's subclass.
 */

const { encode } = require('../dextrin.cjs');
const Deprecations = require('../schema/deprecations.cjs');
const Field = require('../schema/field.cjs');
const { TYPE_KEYS } = require('../schema/type-expr.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNList = require('../values/list.cjs');
const DXNMap = require('../values/map.cjs');

/** @typedef {import('../schema/compiled.cjs')} Compiled */
/** @typedef {import('../schema/type-expr.cjs').TypeExpr} TypeExpr */
/** @typedef {import('../registry.cjs')} Registry */

/**
 * A schema's class and files: the user's class name, the user's file, the
 * generated `.js` and `.d.ts`, all absolute.
 * @typedef {{name: string, cls: string, user: string, gen: string, dts: string}} ClassInfo
 */

/**
 * Between one version and the next: what moves, what is added with a
 * default, what is dropped, and what needs a hand-written step.
 * @typedef {{from: Compiled, to: Compiled, moves: Array<[string, string]>, added: Field[], dropped: string[], hand: string[]}} Upgrade
 */

/** A form the generator does not write yet, raised where it is met. */
class Unsupported extends Error {
  /** @param {string} message what is not generated, as DXNS writes it @param {number | null} [version] */
  constructor(message, version = null) {
    super(message);
    this.version = version;
  }
}

/** A primitive's TypeScript type. @type {{[name: string]: string}} */
const PRIMITIVE_TYPES = {
  nil: 'null',
  boolean: 'boolean',
  integer: 'bigint',
  float: 'number',
  decimal: 'DXNDecimal',
  rational: 'DXNRational',
  string: 'string',
  char: 'DXNChar',
  symbol: 'DXNSymbol',
  keyword: 'DXNKeyword | symbol',
  list: 'DXNList',
  tuple: 'DXNTuple',
  map: 'Map<unknown, unknown>',
  'ordered-map': 'DXNOrderedMap',
  set: 'Set<unknown>',
  'sorted-set': 'DXNSortedSet',
  array: 'unknown[]',
  date: 'DXNDate',
  time: 'DXNTime',
  datetime: 'DXNDateTime | Date',
  'local-datetime': 'DXNLocalDateTime',
  duration: 'DXNDuration',
  uuid: 'DXNUUID',
  objectid: 'DXNObjectId',
  ip: 'DXNIp',
  uri: 'DXNURI',
  bytes: 'DXNBytes',
  bits: 'DXNBits | DXNBytes',
  regex: 'DXNRegex'
};

/** Primitives checked inline, without `Runtime.primitive`: what a value that is none is. @type {{[name: string]: string}} */
const INLINE = {
  string: "typeof v !== 'string'",
  boolean: "typeof v !== 'boolean'",
  integer: "typeof v !== 'bigint'",
  float: "typeof v !== 'number'",
  nil: 'v !== null',
  list: '!(v instanceof DXNList)'
};

/** What a property may not be called: it would hide a method of the class. */
const RESERVED = new Set(['constructor', 'validate', 'toDxn', '__proto__']);

class JsClass {
  /**
   * @param {string} name the schema
   * @param {Compiled[]} versions its versions, in order
   * @param {ClassInfo} info its class and files
   * @param {Map<string, ClassInfo>} classes every schema's, for references
   * @param {Registry} registry the tree's registry, for named types
   * @param {(from: string, to: string) => string} importPath the specifier `from` (a file) imports `to` (a file) by
   */
  constructor(name, versions, info, classes, registry, importPath) {
    this.name = name;
    this.versions = versions;
    this.info = info;
    this.classes = classes;
    this.registry = registry;
    this.importPath = importPath;
    this.parent = `Abstract${info.cls}`;
    /** @type {string[]} the check functions, in the order they were made */
    this.fns = [];
    /** @type {Map<string, string>} each type's check function, by the type's key */
    this.seen = new Map();
    this.next = 1;
    /** @type {Map<string, number>} each DXN constant's number, by its text */
    this.constants = new Map();
    /** the deprecated things numbered so far, for "once" */
    this.slots = 0;
    /** @type {Map<string, string>} the user's classes this file imports: schema -> local name */
    this.refs = new Map();
    /** @type {Set<string>} the DXN value types the declarations name */
    this.dxnTypes = new Set();
    /** @type {Set<string>} named types being typed, to stop at recursion */
    this.typing = new Set();
  }

  /**
   * The generated `.js` and `.d.ts`.
   * @returns {{js: string, dts: string}}
   * @throws {Unsupported} a form not generated yet, naming its version and field
   */
  source() {
    for (const compiled of this.versions) {
      if (compiled.extras.entries.length > 0) throw new Unsupported('typed extras (`* K => V`) are not generated yet', compiled.version);
    }
    const latest = this.versions[this.versions.length - 1];
    const deprecated = this.deprecatedVersions();
    const versionFns = this.versions.map((c) => this.versionFn(c));
    const upgrades = this.upgrades();
    const hand = upgrades.filter((u) => u.hand.length > 0);
    return { js: this.js(latest, deprecated, versionFns, upgrades, hand), dts: this.dts(latest, upgrades, hand) };
  }

  // ---- the .js ----------------------------------------------------------------------

  /**
   * @param {Compiled} latest @param {Map<number, [number, string | null]>} deprecated @param {string[]} versionFns
   * @param {Upgrade[]} upgrades @param {Upgrade[]} hand @returns {string}
   */
  js(latest, deprecated, versionFns, upgrades, hand) {
    const text = comment(this.name);
    const user = this.info.cls;
    const members = [
      `  /** The DXNS schema this class is. */\n  static DXN_SCHEMA = ${str(this.name)};\n`,
      `  /** The schema's latest version, which the properties are. */\n  static DXN_LATEST = ${latest.version};\n`,
      this.constructorCode(latest),
      ...this.withers(latest),
      this.verifyCode(hand),
      this.readCode(),
      this.validateCode(latest),
      this.toDxnCode(latest),
      ...this.versions.flatMap((c) => this.versionMethods(c)),
      ...upgrades.map((u) => this.upgradeCode(u)),
      '  // dextrin:keep bottom\n  // dextrin:end bottom\n'
    ];
    const fns = [this.readStructFn(latest, deprecated), ...versionFns, ...(upgrades.length > 0 ? [this.upgradeFromFn(upgrades)] : []), this.buildFn(latest), ...this.fns];

    const needs = hand.map((u) => `  [${str(`upgradeV${u.from.version}`)}, ${str(`${this.name} version ${u.from.version} to ${u.to.version} changes ${u.hand.join(', ')}, which code cannot upgrade`)}]`);
    const constants = [
      `/** The hand-written upgrades the user's class must have, each with what it upgrades. @type {Array<[string, string]>} */\nconst NEEDS = [${needs.length === 0 ? '' : `\n${needs.join(',\n')}\n`}];\n`
    ];
    if (deprecated.size > 0) {
      const entries = Array.from(deprecated, ([v, [slot, why]]) => `[${v}, [${slot}, ${strOrNull(why)}]]`).join(', ');
      constants.push(`/** Each deprecated version's slot and reason. @type {Map<number, [number, string | null]>} */\nconst DEPRECATED = new Map([${entries}]);\n`);
    }
    if (this.constants.size > 0) constants.push('/** The DXN constants, decoded, by number. @type {unknown[]} */\nconst DXN = [];\n');
    if (this.constants.size > 0) fns.push(DXN_FN);

    // The field types first: they name the DXN value types the typedefs import.
    const fieldTypedefs = [
      `/** The fields a ${user} is made of, by property: those with a default, or optional, may be left out. @typedef {${this.ctorFieldsType(latest)}} Fields */`,
      ...this.versions.map((c) => `/** The fields of version ${c.version}, as its checks answer them, by name. @typedef {${this.fieldsType(c.fields)}} FieldsV${c.version} */`)
    ];
    const typedefs = [
      "/** @typedef {import('@joetjen/dextrin/codegen-runtime').ReadOptions} ReadOptions */",
      ...Array.from(this.dxnTypes)
        .filter((t) => t !== 'DXNList' && t !== 'DXNStruct')
        .sort()
        .map((t) => `/** @typedef {import('@joetjen/dextrin').${t}} ${t} */`),
      ...fieldTypedefs
    ];
    const imports = [
      "import { DXNList, DXNStruct } from '@joetjen/dextrin';",
      "import { InvalidData, Runtime } from '@joetjen/dextrin/codegen-runtime';",
      ...this.refImports(false)
    ];

    const body = members.join('\n');
    const out = `${GENERATED} from the DXNS schema ${text}.
// Regenerating rewrites it: do not edit it outside the dextrin:keep regions.
// dextrin:schema ${this.name}

${imports.join('\n')}

// dextrin:keep top
// dextrin:end top

${typedefs.join('\n')}

${constants.join('\n')}
/**
 * The generated half of ${user}, the schema ${text}: its properties are
 * the latest version's fields, and it reads, checks and upgrades every
 * version with code of its own. \`${user}.read()\` is where data comes in.
 * Its values are frozen; \`with...()\` makes a changed copy.
 */
export class ${this.parent} {
${body}}

${fns.join('\n')}`;
    return out.replace(/\n{3,}/g, '\n\n');
  }

  /** @param {boolean} types @returns {string[]} */
  refImports(types) {
    return Array.from(this.refs, ([schema, local]) => {
      const target = /** @type {ClassInfo} */ (this.classes.get(schema));
      const from = this.importPath(this.info.gen, target.user);
      return `import ${types ? 'type ' : ''}{ ${target.cls} as ${local} } from ${str(from)};`;
    }).sort();
  }

  /** @param {Compiled} latest @returns {string} */
  constructorCode(latest) {
    const lines = latest.fields.map((field) => {
      const prop = property(field.name);
      const type = this.propertyType(field);
      const given = `fields.${prop}`;
      const value = field.default === Field.NO_DEFAULT ? given : `${given} === undefined ? ${this.defaultCode(field)} : ${given}`;
      // JSDoc reads a lone `undefined` as `any`: a field that must be absent is
      // `unknown` here, `undefined` in the declarations.
      return `    /** The field ${comment(field.name)}. @readonly @type {${type === 'undefined' ? 'unknown' : type}} */\n    this.${prop} = ${value};`;
    });
    return `  /**
   * A ${comment(this.name)} with these fields, as its latest version has them;
   * a field left out that has a default takes it. Nothing is checked:
   * \`validate()\` checks. The value is frozen.
   * @param {Fields} fields the fields, by property
   */
  constructor(fields) {
    /** @type {any} */ (this.constructor).verify();
${lines.join('\n')}${lines.length > 0 ? '\n' : ''}    Object.freeze(this);
  }
`;
  }

  /** @param {Compiled} latest @returns {string[]} */
  withers(latest) {
    return latest.fields.map((field) => {
      const prop = property(field.name);
      return `  /**
   * A copy with the field ${comment(field.name)} changed; nothing is checked.
   * @param {${this.propertyType(field)}} value the new value
   * @returns {this} the copy
   */
  ${wither(prop)}(value) {
    return new (/** @type {any} */ (this.constructor))({ ...this, ${prop}: value });
  }
`;
    });
  }

  /** @param {Upgrade[]} hand @returns {string} */
  verifyCode(hand) {
    const what =
      hand.length === 0
        ? 'it needs none'
        : hand.map((u) => `\`static upgradeV${u.from.version}(fields)\``).join(', ');
    return `  /**
   * Whether this class has every hand-written upgrade its schema needs --
   * ${what} -- throwing a \`TypeError\` naming the class and the method
   * when it has not. The user's class calls it in its static block, so a
   * missing upgrade fails where the class is defined; making or reading a
   * value checks it too, once per class.
   */
  static verify() {
    Runtime.verify(this, NEEDS);
  }
`;
  }

  /** @returns {string} */
  readCode() {
    const text = comment(this.name);
    return `  /**
   * A decoded ${text} of any known version, read and upgraded to the
   * latest, or a value of this class, checked. What is deprecated warns as
   * \`options.deprecations\` says -- \`'once'\` per deprecated thing (the
   * default), \`'every'\`, \`'off'\`, or \`'error'\`, which refuses the value --
   * and \`options.onDeprecated\` receives each warning in place of
   * \`process.emitWarning(text, {type: 'DeprecationWarning', code:
   * 'DXN_DEPRECATED'})\`.
   * @param {unknown} value the struct, or a value of this class
   * @param {ReadOptions} [options] how what is deprecated warns
   * @returns {any} the value, of the class \`read()\` is called on
   * @throws {InvalidData} when it is refused, naming the field
   * @throws {RangeError} for an unknown \`deprecations\`
   */
  static read(value, options) {
    const cls = /** @type {any} */ (this);
    cls.verify();
    return Runtime.reading(options, () => {
      if (value instanceof cls) {
        /** @type {any} */ (value).validate();
        return value;
      }
      if (!(value instanceof DXNStruct)) throw InvalidData.expected(${str(`a ${this.name}`)}, value);
      return readStruct(cls, value);
    });
  }
`;
  }

  /** @param {Compiled} latest @returns {string} */
  validateCode(latest) {
    return `  /**
   * Whether this value is a valid ${comment(this.name)} at the latest version:
   * it throws when it is not. A property holding \`undefined\` is an absent
   * field. The options are \`read()\`'s.
   * @param {ReadOptions} [options] how what is deprecated warns
   * @throws {InvalidData} when it is not valid, naming the field
   */
  validate(options) {
    Runtime.reading(options, () => fieldsV${latest.version}(Runtime.present(${this.fieldPairs(latest)})));
  }
`;
  }

  /** @param {Compiled} latest @returns {string} */
  toDxnCode(latest) {
    return `  /**
   * This value as a struct at the latest version; a property holding
   * \`undefined\` is left out.
   * @returns {DXNStruct} the struct
   */
  toDxn() {
    return DXNStruct.keyed(${this.parent}.DXN_SCHEMA, Runtime.pairs(${this.fieldPairs(latest)}), ${this.parent}.DXN_LATEST);
  }
`;
  }

  /** `[['name', this.name], ...]`: the properties by field name. @param {Compiled} latest @returns {string} */
  fieldPairs(latest) {
    return `[${latest.fields.map((f) => `[${str(f.name)}, this.${property(f.name)}]`).join(', ')}]`;
  }

  /** @param {Compiled} latest @returns {string} */
  buildFn(latest) {
    const args = latest.fields.map((f) => `    ${property(f.name)}: fields[${str(f.name)}]`).join(',\n');
    return `/**
 * A value of \`cls\` from the latest version's fields, checked.
 * @param {any} cls the user's class @param {{[name: string]: any}} fields the fields, by name @returns {any}
 */
function build(cls, fields) {
  return new cls({${args === '' ? '' : `\n${args}\n  `}});
}
`;
  }

  /** @param {Compiled} latest @param {Map<number, [number, string | null]>} deprecated @returns {string} */
  readStructFn(latest, deprecated) {
    const notes =
      deprecated.size === 0
        ? ''
        : `  for (const at of new Set([version, ${latest.version}])) {
    const found = DEPRECATED.get(at);
    if (found) Runtime.deprecated(${this.parent}, found[0], ${this.parent}.DXN_SCHEMA, at, found[1]);
  }
`;
    const arms = this.versions.map((c) => `    case ${c.version}:\n      return ${this.readAt(c)};`).join('\n');
    return `/**
 * A struct of ${comment(this.name)}, read with the version it was written with --
 * one newer than any known as the latest -- and upgraded.
 * @param {any} cls the user's class @param {DXNStruct} value @returns {any}
 */
function readStruct(cls, value) {
  if (value.name !== ${this.parent}.DXN_SCHEMA) throw InvalidData.expected(${str(`a ${this.name}`)}, value);
  const version = value.version ?? ${latest.version};
${notes}  switch (version) {
${arms}
    default:
      if (version > ${latest.version}) return ${this.readAt(latest)};
      throw new InvalidData(\`\${${this.parent}.DXN_SCHEMA} version \${version} is not known\`, [], 'schema/unknown-version');
  }
}
`;
  }

  /** The expression reading a struct `value` written with `compiled`'s version. @param {Compiled} compiled @returns {string} */
  readAt(compiled) {
    const names = `[${compiled.fieldNames().map(str).join(', ')}]`;
    return this.readFields(compiled, `Runtime.named(value, ${names})`);
  }

  /** @param {Compiled} compiled @param {string} given @returns {string} */
  readFields(compiled, given) {
    const fields = `fieldsV${compiled.version}(${given})`;
    return this.versions.length > 1 ? `build(cls, upgradeFrom(cls, ${compiled.version}, ${fields}))` : `build(cls, ${fields})`;
  }

  // ---- versions ----------------------------------------------------------------------

  /**
   * Each deprecated version: its slot and reason, by version.
   * @returns {Map<number, [number, string | null]>}
   */
  deprecatedVersions() {
    /** @type {Map<number, [number, string | null]>} */
    const out = new Map();
    for (const compiled of this.versions) {
      const found = Deprecations.reason(compiled.annotations);
      if (found) out.set(compiled.version, [++this.slots, found.why]);
    }
    return out;
  }

  /** A version's deprecation, for `@deprecated`: its reason, or `null`. @param {Compiled} compiled @returns {string | null} */
  why(compiled) {
    const found = Deprecations.reason(compiled.annotations);
    return found ? (found.why ?? `version ${compiled.version} is deprecated`) : null;
  }

  /** `fieldsVN()`, a version's checks. @param {Compiled} compiled @returns {string} */
  versionFn(compiled) {
    const v = compiled.version;
    const specs = compiled.fields.map((field) => {
      try {
        return `    ${this.spec(field)}`;
      } catch (err) {
        if (err instanceof Unsupported) throw new Unsupported(`field ${field.name}: ${err.message}`, v);
        throw err;
      }
    });
    // A closed schema (`- *`) refuses an undeclared field before any is checked.
    const closed = compiled.extras.closed ? `  Runtime.closed(fields, [${compiled.fieldNames().map(str).join(', ')}]);\n` : '';
    return `/**
 * Version ${v}'s checks: the fields as it says them, checked, defaults filled.
 * @param {{[name: string]: unknown}} fields @returns {any}
 */
function fieldsV${v}(fields) {
${closed}  return Runtime.fields(fields, [${specs.length === 0 ? '' : `\n${specs.join(',\n')}\n  `}]);
}
`;
  }

  /** `readVN()` and `conformVN()`. @param {Compiled} compiled @returns {string[]} */
  versionMethods(compiled) {
    const v = compiled.version;
    const why = this.why(compiled);
    const tag = why === null ? '' : `\n   * @deprecated ${comment(why)}`;
    return [
      `  /**
   * Fields written with version ${v}: checked, defaults filled, upgraded to
   * the latest, and made a value of the class it is called on.
   * @param {{[name: string]: unknown}} fields the fields, by name
   * @returns {any} the value
   * @throws {InvalidData} when a field is refused${tag}
   */
  static readV${v}(fields) {
    const cls = /** @type {any} */ (this);
    cls.verify();
    return ${this.readFields(compiled, 'fields')};
  }
`,
      `  /**
   * Fields as version ${v} says them: checked, defaults filled.
   * @param {{[name: string]: unknown}} fields the fields, by name
   * @returns {FieldsV${v}} the fields, checked
   * @throws {InvalidData} when a field is refused${tag}
   */
  static conformV${v}(fields) {
    return fieldsV${v}(fields);
  }
`
    ];
  }

  /** A field's `[name, required, check, default]` for `Runtime.fields`. @param {Field} field @returns {string} */
  spec(field) {
    // A field that must be absent (`:never`) needs no check: present, it is refused.
    const check = field.type.form === 'never' ? 'null' : this.typeFn(field.type);
    const fill = this.defaultCode(field);
    return `[${str(field.name)}, ${field.required}, ${check}, ${fill === null ? 'null' : `() => ${fill}`}]`;
  }

  /** The code a field's default is, or `null` for none. @param {Field} field @returns {string | null} */
  defaultCode(field) {
    if (field.default === Field.NO_DEFAULT) return null;
    // Computed when a value is read or made, never when the code is written.
    if (Field.isComputed(field.default)) return `Runtime.computed(${str(field.default.kind)})`;
    return this.constant(dxnText(field.default));
  }

  // ---- upgrades ----------------------------------------------------------------------

  /**
   * Between each version and the next: what moves, what is added with a
   * default, what is dropped, and what needs a hand-written step (a
   * changed type, a field made required, a required field with no default
   * added).
   * @returns {Upgrade[]}
   */
  upgrades() {
    /** @type {Upgrade[]} */
    const out = [];
    for (let i = 0; i + 1 < this.versions.length; i += 1) {
      const [from, to] = [this.versions[i], this.versions[i + 1]];
      const before = new Map(from.fields.map((f) => [f.name, f]));
      /** @type {Upgrade} */
      const up = { from, to, moves: [], added: [], dropped: [], hand: [] };
      const kept = new Set();
      for (const field of to.fields) {
        const old = before.get(renamedFrom(field) ?? field.name);
        if (!old) {
          if (field.default !== Field.NO_DEFAULT) up.added.push(field);
          else if (field.required) up.hand.push(field.name);
          continue;
        }
        kept.add(old.name);
        if (old.name !== field.name) up.moves.push([old.name, field.name]);
        // A field whose type changed, or that became required, is carried
        // into the hand-written step, under its new name.
        if (meaning(old.type) !== meaning(field.type) || (field.required && !old.required)) up.hand.push(field.name);
      }
      up.dropped = from.fieldNames().filter((n) => !kept.has(n));
      out.push(up);
    }
    return out;
  }

  /** @param {Upgrade} up @returns {string} */
  upgradeCode(up) {
    const from = up.from.version;
    const lines = [
      ...up.moves.map(([a, b]) => `    Runtime.move(fields, ${str(a)}, ${str(b)});`),
      ...up.dropped.map((n) => `    delete fields[${str(n)}];`),
      ...up.added.map((f) => `    if (!Object.hasOwn(fields, ${str(f.name)})) fields[${str(f.name)}] = ${this.defaultCode(f)};`)
    ];
    const user = this.info.cls;
    const note =
      up.hand.length === 0
        ? ''
        : `\n   * ${up.hand.map(comment).join(', ')}: by hand, in \`upgradeV${from}()\` of ${user}; the\n   * region below may prepare the fields first.`;
    const tail = up.hand.length === 0 ? 'fields' : `/** @type {any} */ (this).upgradeV${from}(fields)`;
    return `  /**
   * Fields of version ${from} as version ${up.to.version} has them.${note}
   * @param {{[name: string]: any}} fields the fields, by name
   * @returns {{[name: string]: any}} the fields, upgraded
   */
  static upgradeFromV${from}(fields) {
    fields = Runtime.copy(fields);
${lines.join('\n')}${lines.length > 0 ? '\n' : ''}    // dextrin:keep upgrade_v${from}
    // dextrin:end upgrade_v${from}
    return ${tail};
  }
`;
  }

  /** @param {Upgrade[]} upgrades @returns {string} */
  upgradeFromFn(upgrades) {
    const steps = upgrades.map((u) => `  if (version <= ${u.from.version}) fields = cls.upgradeFromV${u.from.version}(fields);`).join('\n');
    return `/**
 * Fields of \`version\`, step by step, as the latest has them.
 * @param {any} cls the user's class @param {number} version @param {{[name: string]: any}} fields @returns {{[name: string]: any}}
 */
function upgradeFrom(cls, version, fields) {
${steps}
  return fields;
}
`;
  }

  // ---- constants ---------------------------------------------------------------------

  /** The code for a DXN constant written as `text`, decoded once. @param {string} text @returns {string} */
  constant(text) {
    if (!this.constants.has(text)) this.constants.set(text, this.constants.size);
    return `dxn(${this.constants.get(text)}, ${str(text)})`;
  }

  // ---- types -------------------------------------------------------------------------

  /**
   * The name of the check function for `type`, written once per distinct
   * type. A `{:doc}` that deprecates nothing is its type's.
   * @param {TypeExpr} type @returns {string}
   */
  typeFn(type) {
    if (type.form === 'doc' && !this.deprecates(type)) return this.typeFn(type.elem);
    if (type.form === 'named') return this.namedFn(type.name);
    const key = typeKey(type);
    const known = this.seen.get(key);
    if (known) return known;
    const name = `t${this.next++}`;
    this.seen.set(key, name);
    this.fns.push(fn(name, describe(type), this.typeBody(type)));
    return name;
  }

  /** @param {string} named @returns {string} */
  namedFn(named) {
    const fnName = `named${studly(named)}`;
    const key = `named:${named}`;
    if (!this.seen.has(key)) {
      this.seen.set(key, fnName);
      const type = /** @type {TypeExpr | undefined} */ (this.registry.typeAliases.get(named));
      if (!type) throw new Unsupported(`the named type ${named} is not known`);
      this.fns.push(fn(fnName, named, `return ${this.typeFn(type)}(v);`));
    }
    return fnName;
  }

  /** The statements checking `v` as `type`. @param {TypeExpr} type @returns {string} */
  typeBody(type) {
    /** @param {TypeExpr} t */
    const call = (t) => `${this.typeFn(t)}(v)`;
    /** @param {TypeExpr[]} ts */
    const many = (ts) => `[${ts.map((t) => this.typeFn(t)).join(', ')}]`;
    switch (type.form) {
      case 'any':
        return 'return v;';
      case 'never':
        return "throw new InvalidData('no value is allowed here');";
      case 'primitive': {
        const test = INLINE[type.name];
        return test === undefined ? `return Runtime.primitive(${str(type.name)}, v);` : `if (${test}) throw InvalidData.expected(${str(type.name)}, v);\nreturn v;`;
      }
      case 'doc':
        return this.docBody(type);
      case 'nilable':
        return `return v === null ? null : ${call(type.elem)};`;
      case 'refine':
        return this.refineBody(type);
      case 'enum':
        return `return Runtime.enumOf(v, ${this.constant(dxnText(new DXNList(type.literals)))});`;
      case 'list-of':
        return `return Runtime.listOf(v, ${this.typeFn(type.elem)});`;
      case 'map-of':
        return `return Runtime.mapOf(v, ${this.typeFn(type.key)}, ${this.typeFn(type.value)});`;
      case 'any-of':
        return `return Runtime.anyOf(v, ${many(type.variants)});`;
      case 'one-of':
        return `return Runtime.oneOf(v, ${many(type.variants)});`;
      case 'all-of':
        return `return Runtime.allOf(v, ${many(type.variants)});`;
      case 'not':
        return `return Runtime.not(v, ${this.typeFn(type.elem)});`;
      case 'if':
        return `return Runtime.ifThen(v, ${this.typeFn(type.test)}, ${this.typeFn(type.consequent)}, ${this.typeFn(type.alternative)});`;
      case 'reference':
        return this.referenceBody(type);
      case 'shape':
        return this.shapeBody(type);
      default:
        throw new Unsupported(`${formName(type)} is not generated yet`);
    }
  }

  /** @param {TypeExpr} doc @returns {boolean} */
  deprecates(doc) {
    const notes = /** @type {any} */ (doc).notes ?? {};
    return Deprecations.reason(notes) !== null || this.deprecatedValues(notes, false).length > 0;
  }

  /**
   * A `{:doc}` that deprecates what it stands on, or some of its enum
   * values: noted when a value goes through it.
   * @param {{form: 'doc', elem: TypeExpr, notes: {[k: string]: unknown}}} doc @returns {string}
   */
  docBody(doc) {
    const lines = [`v = ${this.typeFn(doc.elem)}(v);`];
    const found = Deprecations.reason(doc.notes);
    if (found) {
      const title = typeof doc.notes.title === 'string' ? doc.notes.title : null;
      lines.push(`Runtime.deprecated(${this.parent}, ${++this.slots}, ${strOrNull(title)}, null, ${strOrNull(found.why)});`);
    }
    const values = this.deprecatedValues(doc.notes, true);
    if (values.length > 0) lines.push(`Runtime.deprecatedValue(${this.parent}, v, [${values.join(', ')}]);`);
    lines.push('return v;');
    return lines.join('\n');
  }

  /**
   * An enum's deprecated values (`values:`), each `[literal, slot, why]`
   * as code, in the order of their DXN text.
   * @param {{[k: string]: unknown}} notes @param {boolean} number @returns {string[]}
   */
  deprecatedValues(notes, number) {
    const values = notes.values;
    if (!(values instanceof Map)) return [];
    /** @type {Array<[string, string | null]>} */
    const found = [];
    for (const [literal, valueNotes] of values) {
      const why = Deprecations.reason(valueNotes);
      if (why) found.push([dxnText(literal), why.why]);
    }
    found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return found.map(([text, why]) => (number ? `[${this.constant(text)}, ${++this.slots}, ${strOrNull(why)}]` : text));
  }

  /** @param {{form: 'refine', base: TypeExpr, constraints: {[k: string]: unknown}}} refine @returns {string} */
  refineBody(refine) {
    const unsupported = Object.keys(refine.constraints).filter((k) => TYPE_KEYS.includes(k));
    if (unsupported.length > 0) throw new Unsupported(`refine keys not generated yet: ${unsupported.join(', ')}`);
    const constraints = new DXNMap(Object.entries(refine.constraints).map(([k, v]) => [new DXNKeyword(k), v]));
    return `return Runtime.refine(${this.typeFn(refine.base)}(v), ${this.constant(dxnText(constraints))}, ${strOrNull(primitiveOf(refine.base))});`;
  }

  /** @param {{form: 'reference', name: string, version?: number}} reference @returns {string} */
  referenceBody(reference) {
    if (reference.version !== undefined) {
      throw new Unsupported(`a reference pinned to a version (${reference.name}(${reference.version})) is not generated yet`);
    }
    const local = this.ref(reference.name);
    return `if (v instanceof DXNStruct || v instanceof ${local}) return ${local}.read(v);\nthrow InvalidData.expected(${str(`a ${reference.name}`)}, v);`;
  }

  /** The local name of the user's class of `schema`, imported. @param {string} schema @returns {string} */
  ref(schema) {
    const target = this.classes.get(schema);
    if (!target) throw new Unsupported(`the schema ${schema} is not known`);
    const known = this.refs.get(schema);
    if (known) return known;
    const taken = new Set(this.refs.values());
    let local = `$${target.cls}`;
    for (let n = 2; taken.has(local); n += 1) local = `$${target.cls}${n}`;
    this.refs.set(schema, local);
    return local;
  }

  /** @param {{form: 'shape', fields: Field[], extras?: import('../schema/compiled.cjs').Extras}} shape @returns {string} */
  shapeBody(shape) {
    const extras = shape.extras ?? { entries: [], closed: false };
    if (extras.entries.length > 0) throw new Unsupported('typed extras (`* K => V`) are not generated yet');
    const specs = shape.fields.map((f) => `  ${this.spec(f)}`);
    return `return Runtime.shape(v, [${specs.length === 0 ? '' : `\n${specs.join(',\n')}\n`}], ${extras.closed});`;
  }

  // ---- TypeScript types ----------------------------------------------------------

  /**
   * The TypeScript type of a value of `type` once checked; `unknown` where
   * none is exact. Names the DXN value types it uses.
   * @param {TypeExpr} type @returns {string}
   */
  tsType(type) {
    /** @param {TypeExpr[]} ts */
    const union = (ts) => {
      const parts = ts.map((t) => this.tsType(t));
      if (parts.includes('unknown')) return 'unknown';
      return Array.from(new Set(parts.flatMap((p) => p.split(' | ')))).join(' | ');
    };
    switch (type.form) {
      case 'primitive': {
        const ts = PRIMITIVE_TYPES[type.name];
        if (!ts) return 'unknown';
        for (const part of ts.split(' | ')) if (part.startsWith('DXN')) this.dxnTypes.add(part);
        return ts;
      }
      case 'doc':
        return this.tsType(type.elem);
      case 'refine':
        return this.tsType(type.base);
      case 'nilable':
        return union([type.elem, { form: 'primitive', name: 'nil' }]);
      case 'enum':
        return this.literalTypes(type.literals);
      case 'any-of':
      case 'one-of':
        return union(type.variants);
      case 'if':
        return union([type.consequent, type.alternative]);
      case 'reference':
        return this.classes.has(type.name) && type.version === undefined ? this.ref(type.name) : 'unknown';
      case 'list-of':
        this.dxnTypes.add('DXNList');
        return 'DXNList';
      case 'map-of':
      case 'shape':
        return 'Map<unknown, unknown>';
      case 'named': {
        const named = /** @type {TypeExpr | undefined} */ (this.registry.typeAliases.get(type.name));
        if (!named || this.typing.has(type.name)) return 'unknown';
        this.typing.add(type.name);
        const out = this.tsType(named);
        this.typing.delete(type.name);
        return out;
      }
      case 'never':
        return 'never';
      default:
        return 'unknown';
    }
  }

  /** @param {unknown[]} literals @returns {string} */
  literalTypes(literals) {
    /** @type {string[]} */
    const out = [];
    for (const literal of literals) {
      let ts;
      if (literal instanceof DXNKeyword) {
        this.dxnTypes.add('DXNKeyword');
        ts = 'DXNKeyword | symbol';
      } else if (typeof literal === 'string') ts = 'string';
      else if (typeof literal === 'bigint') ts = 'bigint';
      else if (typeof literal === 'boolean') ts = 'boolean';
      else if (typeof literal === 'number') ts = 'number';
      else if (literal === null) ts = 'null';
      else return 'unknown';
      out.push(...ts.split(' | '));
    }
    return out.length === 0 ? 'unknown' : Array.from(new Set(out)).join(' | ');
  }

  /** A property's type: absent (`undefined`) where the field is optional with no default. @param {Field} field @returns {string} */
  propertyType(field) {
    if (field.type.form === 'never') return 'undefined';
    const ts = this.tsType(field.type);
    return !field.required && field.default === Field.NO_DEFAULT && ts !== 'unknown' ? `${ts} | undefined` : ts;
  }

  /**
   * The constructor's argument: each property, those with a default or
   * optional may be left out; `sep` between them, `,` in JSDoc and `;` in
   * a declaration.
   * @param {Compiled} latest @param {string} [sep] @returns {string}
   */
  ctorFieldsType(latest, sep = ',') {
    const entries = latest.fields.map((f) => {
      const prop = property(f.name);
      const ts = this.propertyType(f);
      if (f.required && f.default === Field.NO_DEFAULT && f.type.form !== 'never') return `${prop}: ${ts}`;
      return `${prop}?: ${ts.endsWith('| undefined') || ts === 'undefined' || ts === 'unknown' ? ts : `${ts} | undefined`}`;
    });
    return sep === ',' ? `{${entries.join(', ')}}` : `{ ${entries.join('; ')}${entries.length > 0 ? ' ' : ''}}`;
  }

  /**
   * The fields as a version's checks answer them, by field name: a field
   * with a default is always there, an optional one may not be.
   * @param {Field[]} fields @returns {string}
   */
  fieldsType(fields) {
    return `{ ${fields
      .map((f) => {
        if (f.type.form === 'never') return `${key(f.name)}?: never`;
        const optional = !f.required && f.default === Field.NO_DEFAULT;
        return `${key(f.name)}${optional ? '?' : ''}: ${this.tsType(f.type)}`;
      })
      .join('; ')}${fields.length > 0 ? ' ' : ''}}`;
  }

  /**
   * What a hand-written step is given: the fields of its version after the
   * generated step -- moved, dropped, added with their defaults -- a field
   * whose type changed still of its old type.
   * @param {Upgrade} up @returns {Field[]}
   */
  upgradeInput(up) {
    const moved = new Map(up.moves);
    const dropped = new Set(up.dropped);
    const fields = up.from.fields
      .filter((f) => !dropped.has(f.name))
      .map((f) => (moved.has(f.name) ? new Field({ name: /** @type {string} */ (moved.get(f.name)), required: f.required, type: f.type, default: f.default }) : f));
    return [...fields, ...up.added];
  }

  // ---- the .d.ts ---------------------------------------------------------------------

  /** @param {Compiled} latest @param {Upgrade[]} upgrades @param {Upgrade[]} hand @returns {string} */
  dts(latest, upgrades, hand) {
    const text = comment(this.name);
    const user = this.info.cls;
    const types = [
      ...this.versions.map((c) => `/** The fields of ${text} version ${c.version}, as its checks answer them, by name. */\nexport type FieldsV${c.version} = ${this.fieldsType(c.fields)};\n`),
      ...hand.map(
        (u) =>
          `/** What \`upgradeV${u.from.version}()\` of ${user} is given: version ${u.from.version}'s fields after the generated step. */\nexport type UpgradeV${u.from.version}Fields = ${this.fieldsType(this.upgradeInput(u))};\n`
      ),
      `/** The fields a ${user} is made of, by property: those with a default, or optional, may be left out. */\nexport type Fields = ${this.ctorFieldsType(latest, ';')};\n`
    ];
    const constraint = hand.map((u) => `upgradeV${u.from.version}(fields: UpgradeV${u.from.version}Fields): FieldsV${u.to.version}`).join('; ');
    const verify = hand.length === 0 ? 'static verify(): void;' : `static verify<T extends { ${constraint} }>(this: T): void;`;
    const members = [
      `  /** The DXNS schema this class is. */\n  static readonly DXN_SCHEMA: ${str(this.name)};`,
      `  /** The schema's latest version, which the properties are. */\n  static readonly DXN_LATEST: ${latest.version};`,
      ...latest.fields.map((f) => `  /** The field ${comment(f.name)}. */\n  readonly ${property(f.name)}: ${this.propertyType(f)};`),
      `  /**\n   * A ${text} with these fields, as its latest version has them; a field\n   * left out that has a default takes it. Nothing is checked. The value is frozen.\n   */\n  constructor(fields: Fields);`,
      ...latest.fields.map((f) => `  /** A copy with the field ${comment(f.name)} changed; nothing is checked. */\n  ${wither(property(f.name))}(value: ${this.propertyType(f)}): this;`),
      `  /**\n   * Whether this class has every hand-written upgrade its schema needs: called\n   * in the user's class's static block, it is a compile error when one is\n   * missing, and throws a \`TypeError\` naming it when run.\n   */\n  ${verify}`,
      `  /**\n   * A decoded ${text} of any known version, read and upgraded to the\n   * latest, or a value of this class, checked.\n   * @throws {InvalidData} when it is refused, naming the field\n   */\n  static read<T>(this: new (fields: Fields) => T, value: unknown, options?: ReadOptions): T;`,
      `  /** Whether this value is valid at the latest version: it throws when it is not. */\n  validate(options?: ReadOptions): void;`,
      `  /** This value as a struct at the latest version. */\n  toDxn(): DXNStruct;`,
      ...this.versions.flatMap((c) => {
        const why = this.why(c);
        const tag = why === null ? '' : `\n   * @deprecated ${comment(why)}`;
        return [
          `  /**\n   * Fields written with version ${c.version}: checked, defaults filled, upgraded, and made a value.${tag}\n   */\n  static readV${c.version}<T>(this: new (fields: Fields) => T, fields: { readonly [name: string]: unknown }): T;`,
          `  /**\n   * Fields as version ${c.version} says them: checked, defaults filled.${tag}\n   */\n  static conformV${c.version}(fields: { readonly [name: string]: unknown }): FieldsV${c.version};`
        ];
      }),
      ...upgrades.map((u) => `  /** Fields of version ${u.from.version} as version ${u.to.version} has them. */\n  static upgradeFromV${u.from.version}(fields: FieldsV${u.from.version}): FieldsV${u.to.version};`)
    ];
    const dxnTypes = Array.from(new Set(['DXNStruct', ...this.dxnTypes])).sort();
    const imports = [
      `import type { ${dxnTypes.join(', ')} } from '@joetjen/dextrin';`,
      "import type { ReadOptions } from '@joetjen/dextrin/codegen-runtime';",
      ...this.refImports(true)
    ];
    return `${GENERATED} from the DXNS schema ${text}.
// Regenerating rewrites it: do not edit it.
// dextrin:schema ${this.name}

${imports.join('\n')}

${types.join('\n')}
/**
 * The generated half of ${user}, the schema ${text}: its properties are
 * the latest version's fields, and it reads, checks and upgrades every
 * version with code of its own.
 */
export declare abstract class ${this.parent} {
${members.join('\n')}
}
`;
  }
}

// ---- helpers ---------------------------------------------------------------------

/** The first line of every generated file. */
const GENERATED = '// Generated by dextrin gen-js';

const DXN_FN = `/**
 * A DXN constant written as \`text\`, decoded the first time it is needed.
 * @param {number} at @param {string} text @returns {any}
 */
function dxn(at, text) {
  return (DXN[at] ??= Runtime.value(text));
}
`;

/** A check function. @param {string} name @param {string} what @param {string} body @returns {string} */
function fn(name, what, body) {
  const indented = body
    .split('\n')
    .map((l) => (l === '' ? '' : `  ${l}`))
    .join('\n');
  // `:any` takes everything: it throws nothing.
  const throws = body === 'return v;' ? '' : '\n * @throws {InvalidData} when the value is not one';
  return `/**
 * A value of ${comment(what)}, checked.
 * @param {unknown} v @returns {any}${throws}
 */
function ${name}(v) {
${indented}
}
`;
}

/**
 * A key two structurally equal types share.
 * @param {unknown} value @returns {string}
 */
function typeKey(value) {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return `@${value.description ?? ''}`;
    case 'object':
      break;
    default:
      return String(value);
  }
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(typeKey).join(',')}]`;
  if (value instanceof Map) return `Map{${Array.from(value, ([k, v]) => `${typeKey(k)}=>${typeKey(v)}`).join(',')}}`;
  const own = /** @type {{[k: string]: unknown}} */ (value);
  const name = value.constructor ? value.constructor.name : 'Object';
  return `${name}{${Object.keys(own)
    .sort()
    .map((k) => `${k}:${typeKey(own[k])}`)
    .join(',')}}`;
}

/** A type as what it takes: its annotations and descriptions left out. @param {TypeExpr} type @returns {string} */
function meaning(type) {
  return typeKey(undocumented(type));
}

/** @param {unknown} value @returns {unknown} */
function undocumented(value) {
  if (Array.isArray(value)) return value.map(undocumented);
  if (value instanceof Field) return { name: value.name, required: value.required, type: undocumented(value.type), default: value.default };
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const t = /** @type {{[k: string]: unknown}} */ (value);
  if (t.form === 'doc') return undocumented(t.elem);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, undocumented(v)]));
}

/** A field's former name, from its type's `meta`: `typespec.renamed-from`. @param {Field} field @returns {string | null} */
function renamedFrom(field) {
  if (field.type.form !== 'doc') return null;
  const meta = field.type.notes.meta;
  /** @type {Array<[unknown, unknown]>} */
  const pairs = meta instanceof Map ? Array.from(meta) : meta !== null && typeof meta === 'object' ? Object.entries(meta) : [];
  for (const [k, v] of pairs) {
    const name = k instanceof DXNKeyword ? k.name : k;
    if (name === 'typespec.renamed-from' && typeof v === 'string') return v;
  }
  return null;
}

/** The primitive a refine stands on, through docs and refines; `null` for none. @param {TypeExpr} type @returns {string | null} */
function primitiveOf(type) {
  if (type.form === 'primitive') return type.name;
  if (type.form === 'refine') return primitiveOf(type.base);
  if (type.form === 'doc') return primitiveOf(type.elem);
  return null;
}

/** A form as DXNS writes it: `{:tuple-of ...}`. @param {TypeExpr} type @returns {string} */
function formName(type) {
  if (type.form === 'apply') return `{:of ${type.name} ...}`;
  if (type.form === 'generic') return '{:generic ...}';
  if (type.form === 'param') return `the generic parameter ${type.name}`;
  return `{:${type.form} ...}`;
}

/** A type as DXNS writes it, short: what a check function's comment says it checks. @param {TypeExpr} type @returns {string} */
function describe(type) {
  /** @param {unknown} value */
  const text = (value) => {
    try {
      return encode(value);
    } catch {
      return '...';
    }
  };
  /** @param {TypeExpr[]} ts */
  const many = (ts) => ts.map(describe).join(' ');
  switch (type.form) {
    case 'any':
    case 'never':
      return `:${type.form}`;
    case 'primitive':
      return `:${type.name}`;
    case 'reference':
    case 'named':
      return type.name;
    case 'doc':
      return `{:doc ${describe(type.elem)} ...}`;
    case 'nilable':
    case 'list-of':
    case 'not':
      return `{:${type.form} ${describe(type.elem)}}`;
    case 'map-of':
      return `{:map-of ${describe(type.key)} ${describe(type.value)}}`;
    case 'refine':
      return `{:refine ${describe(type.base)} ${text(new DXNMap(Object.entries(type.constraints).map(([k, v]) => [new DXNKeyword(k), v])))}}`;
    case 'enum':
      return `{:enum ${type.literals.map(text).join(' ')}}`;
    case 'any-of':
    case 'one-of':
    case 'all-of':
      return `{:${type.form} ${many(type.variants)}}`;
    case 'if':
      return `{:if ${describe(type.test)} ${describe(type.consequent)} ${describe(type.alternative)}}`;
    case 'shape':
      return type.name ?? `%shape{${type.fields.map((f) => `${f.name}${f.required ? '' : '?'}: ${describe(f.type)}`).join(' ')}}`;
    default:
      return `{:${type.form} ...}`;
  }
}

/** @param {unknown} value @returns {string} */
function dxnText(value) {
  try {
    return encode(value);
  } catch (err) {
    throw new Unsupported(`a value with no DXN text: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A JavaScript string literal, in single quotes. @param {string} text @returns {string} */
function str(text) {
  return `'${JSON.stringify(text).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

/** @param {string | null} text @returns {string} */
function strOrNull(text) {
  return text === null ? 'null' : str(text);
}

/** A property key in a TypeScript type: as it is where it is an identifier, quoted otherwise. @param {string} name @returns {string} */
function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : str(name);
}

/** Text safe inside a doc comment. @param {string} text @returns {string} */
function comment(text) {
  return text.replaceAll('*/', '*\\/').replaceAll('\n', ' ');
}

/** The words of a name: `first-name` is `first`, `name`. @param {string} name @returns {string[]} */
function words(name) {
  return name.split(/[^A-Za-z0-9]+/).filter((w) => w !== '');
}

/** @param {string} word @returns {string} */
function capital(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A name in StudlyCase: `acme.shop/Order-line` is `AcmeShopOrderLine`. @param {string} name @returns {string} */
function studly(name) {
  return words(name).map(capital).join('');
}

/**
 * A field name as a property: as it is where JavaScript takes it as an
 * identifier, `first-name` as `firstName`, and with a `_` after it where
 * it would hide a method of the class.
 * @param {string} field @returns {string}
 */
function property(field) {
  let name = field;
  if (!/^[A-Za-z_$][\w$]*$/.test(field)) {
    const parts = field.split(/[^A-Za-z0-9_$]+/).filter((w) => w !== '');
    name = parts.length === 0 ? 'field' : parts[0] + parts.slice(1).map(capital).join('');
    if (/^[0-9]/.test(name)) name = `_${name}`;
  }
  return RESERVED.has(name) ? `${name}_` : name;
}

/** A property's copy method: `signed_up_at` has `withSignedUpAt`. @param {string} prop @returns {string} */
function wither(prop) {
  const parts = prop.split('_').filter((w) => w !== '');
  return `with${parts.map(capital).join('') || capital(prop)}`;
}

module.exports = { JsClass, Unsupported, GENERATED, str, studly, words, capital };
