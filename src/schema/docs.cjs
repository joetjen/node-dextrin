'use strict';

/**
 * @fileoverview HTML documentation for a directory of `.dxns` schema
 * documents -- the port of `Dextrin.Schema.Docs`, writing the same site
 * byte for byte (Jan, 2026-10-20): a sidebar tree of every namespace and
 * definition, the index and every namespace's page in one design, the
 * pages a directory tree with an `index.html` per namespace, every
 * reference a link, every version shown.
 *
 * It reads the documents' **source**, not their compiled schemas, so it
 * documents what a person wrote and needs no schema to compile.
 *
 * **Names** come from where a file lies under the root, by DXNS.md §6:
 * `acme/shop/Customer-v2.dxns`, `acme/shop/Order/v1.dxns` and
 * `acme.shop.Product.dxns` each hold one definition, the entry named
 * like the file; every other entry in such a file is internal to it.
 * `acme.common.dxns`, whose entries are not named like it, is a namespace
 * file: each entry is `acme.common/<entry>`. `HealthCheck.dxns` holding
 * `HealthCheck` is a name with no namespace.
 */

const fs = require('node:fs');
const path = require('node:path');
const Document = require('../document.cjs');
const parser = require('../text/parser.cjs');
const Comments = require('./docs/comments.cjs');
const Layout = require('./layout.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const { canonical } = require('../canonical.cjs');

/**
 * @typedef {import('../text/parser.cjs').SyntaxNode} SyntaxNode
 * @typedef {{source: string, tokens: Array<{type: string, start: number, end: number}>}} Src
 * @typedef {{src: Src, node: SyntaxNode}} At a node, with the source it is in
 * @typedef {{[name: string]: unknown}} Notes a doc's annotations by name (DXNS.md §1b), each value decoded
 * @typedef {{kind: 'field', name: string, optional: boolean, type: At | null, default: At | null, computed: At | null, description: string | null, doc: string, annotations: Notes, position: number}} Field
 * @typedef {{kind: 'drop', name: string, doc: string} | {kind: 'closed', doc: string} | {kind: 'extra', key: At, type: At, doc: string}} Other a body's row that is not a field: one left out of the bases (`- name`), the closing (`- *`), or the extras (`* K => V`)
 * @typedef {Field | Other} Row
 * @typedef {{relation: string, names: Array<[string, number | null]>}} Bases a head's `extends` or `includes`, and the names after it, each with the version it pins
 * @typedef {{name: string, bound: At | null, default: At | null}} Param a generic's parameter
 * @typedef {{tool: string, source: string}} Provenance
 * @typedef {{version: number | null, file: string, provenance: Provenance | null, note: string | null, fields: Row[], bases: Bases[], params: Param[], value: At | null, annotations: Notes}} Version
 * @typedef {{name: string, short: string, namespace: string, kind: 'schema' | 'shape' | 'type', internalTo: string | null, doc: string, scope: Map<string, string>, namespaceNote: string | null, versions: Version[]}} Definition
 */

/**
 * The documentation of every `.dxns` file under `root`, as pages: each
 * its path under the output directory, and its content. `opts.title` names
 * the site (the root directory's name when not given). Throws, naming the
 * file, when one cannot be read.
 * @param {string} root
 * @param {{title?: string}} [opts]
 * @returns {Array<[string, string]>}
 */
function site(root, opts = {}) {
  const files = walk(root)
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
  const read = files.map((file) => {
    try {
      return readFile(root, file);
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const title = opts.title ?? path.basename(path.resolve(root));
  // Required here, not at the top: the pages require this module back.
  const Html = require('./docs/html.cjs');
  return Html.pages(title, model(read));
}

/**
 * Writes the documentation of every `.dxns` file under `root` to `out`;
 * answers the paths it wrote.
 * @param {string} root
 * @param {string} out
 * @param {{title?: string}} [opts]
 * @returns {string[]}
 */
function write(root, out, opts = {}) {
  return site(root, opts).map(([page, content]) => {
    const target = path.join(out, page);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  });
}

/** Every `.dxns` file under `dir`. @param {string} dir @returns {string[]} */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(at);
    return entry.name.endsWith('.dxns') ? [at] : [];
  });
}

// ---- reading ----------------------------------------------------------------

/**
 * One file: where its names come from, what it says about itself, and its
 * entries.
 * @param {string} root
 * @param {string} file
 */
function readFile(root, file) {
  const doc = Document.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  /** @type {Src} */
  const src = { source: doc.source, tokens: doc.tokens };
  const value = doc.tree.children.find((c) => c.kind === 'value');
  const map = value ? bodyOf(value) : null;
  if (!value || !map || map.kind !== 'map') throw new Error('a .dxns document is a map of names to schemas and types');
  const { stem, version } = stemOf(file);
  const { provenance: from, leading } = provenance(leadingOf(doc, value));
  return { file, stem, fileVersion: version, leading, provenance: from, entries: entriesOf(src, map) };
}

/**
 * A converter's or emitter's header -- `# Generated by TOOL from SOURCE;
 * do not edit.` as the file's first paragraph -- says where the file came
 * from, and is no part of what the file says about itself: the tool and
 * the source, and the comments without it.
 * @param {string} leading
 * @returns {{provenance: Provenance | null, leading: string}}
 */
function provenance(leading) {
  const [first, ...rest] = leading.split('\n\n');
  const found = /^Generated by (\S+) from (\S+?);? do not edit\.?$/.exec(first);
  if (!found) return { provenance: null, leading };
  return { provenance: { tool: found[1], source: found[2] }, leading: rest.join('\n\n').trim() };
}

/**
 * The comments before a document's value: the source before it, its
 * header's tokens standing for a line break.
 * @param {{source: string, tokens: Array<{start: number, end: number}>, tree: SyntaxNode}} doc
 * @param {SyntaxNode} value
 */
function leadingOf(doc, value) {
  const header = doc.tree.children.find((c) => c.kind === 'header');
  const end = doc.tokens[value.first].start;
  if (!header) return Comments.leading(doc.source.slice(0, end));
  const before = doc.source.slice(0, doc.tokens[header.first].start);
  const after = doc.source.slice(doc.tokens[header.last].end, end);
  return Comments.leading(`${before}\n\n\n${after}`);
}

/**
 * The node a `value` holds: a collection, a struct, a tag, or a scalar
 * (a `body` with no children).
 * @param {SyntaxNode} value
 * @returns {SyntaxNode | null}
 */
function bodyOf(value) {
  if (value.kind !== 'value') return null;
  const body = value.children.find((c) => c.kind === 'body');
  if (!body) return null;
  return body.children[0] ?? body;
}

/**
 * A container's inside as gaps and entries, in order: what
 * `Comments.attached` reads. A child of a kind in `kinds` is an entry;
 * a body's `- name` and `* K => V` are entries only where `kinds` says
 * so. The inside of every child is no gap: it is passed over, as the
 * reference passes over everything in them.
 * @param {Src} src
 * @param {SyntaxNode} node
 * @param {string[]} [kinds]
 */
function partsOf(src, node, kinds = ['entry']) {
  /** @type {Array<{gap: string} | {entry: true}>} */
  const parts = [];
  let from = src.tokens[/** @type {number} */ (node.open)].end;
  for (const child of node.children.filter((c) => c.kind === 'entry' || c.kind === 'drop' || c.kind === 'rest')) {
    parts.push({ gap: src.source.slice(from, src.tokens[child.first].start) });
    if (kinds.includes(child.kind)) parts.push({ entry: true });
    from = src.tokens[child.last].end;
  }
  parts.push({ gap: src.source.slice(from, src.tokens[node.last].start) });
  return parts;
}

/** @param {Src} src @param {SyntaxNode} map */
function entriesOf(src, map) {
  const entries = map.children.filter((c) => c.kind === 'entry');
  const comments = Comments.attached(partsOf(src, map));
  return entries.map((entry, i) => ({ key: keyOf(src, entry), value: valueOf(entry), doc: docText(comments[i]), src }));
}

/** @param {Comments.Attached | undefined} c */
function docText(c) {
  return c ? [...c.above, ...c.after].join('\n').trim() : '';
}

/** The text of the token at `index`. @param {Src} src @param {number} index */
function tokenText(src, index) {
  const t = src.tokens[index];
  return src.source.slice(t.start, t.end);
}

/** The tokens of `node`, written together without the trivia between them. @param {Src} src @param {SyntaxNode} node */
function text(src, node) {
  let out = '';
  for (let i = node.first; i <= node.last; i += 1) out += tokenText(src, i);
  return out;
}

/** An entry's key: its name, or the text of its key value. @param {Src} src @param {SyntaxNode} entry */
function keyOf(src, entry) {
  if (entry.key !== undefined) return tokenText(src, entry.key).replace(/:+$/, '');
  const key = entry.children.find((c) => c.kind === 'value');
  return key ? text(src, key).replace(/^"+|"+$/g, '') : '';
}

/** An entry's value: its last value child. @param {SyntaxNode} entry */
function valueOf(entry) {
  const values = entry.children.filter((c) => c.kind === 'value');
  return values[values.length - 1] ?? null;
}

/**
 * A file's dotted stem and the version its name says.
 * @param {string} file
 * @returns {{stem: string[], version: number | null}}
 */
function stemOf(file) {
  const parts = file.replace(/\.dxns$/, '').split('/');
  const last = /** @type {string} */ (parts.pop());
  /** @type {string[]} */
  let nameParts;
  /** @type {number | null} */
  let version = null;
  const dashed = /^(.+)-v([1-9][0-9]*)$/.exec(last);
  if (parts.length > 0 && /^v[1-9][0-9]*$/.test(last)) {
    nameParts = parts;
    version = Number(last.slice(1));
  } else if (dashed) {
    nameParts = [...parts, dashed[1]];
    version = Number(dashed[2]);
  } else {
    nameParts = [...parts, last];
  }
  return { stem: nameParts.flatMap((p) => p.split('.')), version };
}

// ---- the model ----------------------------------------------------------------

/** @param {ReturnType<typeof readFile>[]} files @returns {Definition[]} */
function model(files) {
  /** @type {Map<string, Definition[]>} */
  const byName = new Map();
  for (const definition of files.flatMap(definitionsOf)) {
    byName.set(definition.name, [...(byName.get(definition.name) ?? []), definition]);
  }
  return [...byName.values()].map(merge).sort((a, b) => compare(a.name, b.name));
}

/** @param {string} a @param {string} b */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}


/** @param {string} name */
function namespaceOf(name) {
  const slash = name.indexOf('/');
  return slash === -1 ? '' : name.slice(0, slash);
}

/** @param {ReturnType<typeof readFile>} file @returns {Definition[]} */
function definitionsOf(file) {
  // The names every reader of a tree gives them (`layout.cjs`, DXNS.md §6).
  const layout = Layout.of(file.file, file.entries.map((e) => e.key));
  const names = layout.names;
  const own = layout.holder;
  const holder = own !== null;
  const owner = own !== null ? /** @type {string} */ (names.get(own)) : null;

  return file.entries.map((entry) => {
    const name = /** @type {string} */ (names.get(entry.key));
    const internalTo = holder && entry.key !== own ? owner : null;
    const { node: value, notes } = undoc(entry.src, entry.value);
    const what = classify(entry.src, value, file.fileVersion, holder && entry.key === own);
    return {
      name,
      short: entry.key,
      namespace: internalTo ? namespaceOf(internalTo) : namespaceOf(name),
      kind: what.kind,
      internalTo,
      doc: entry.doc,
      scope: names,
      namespaceNote: holder ? null : file.leading,
      versions: [
        {
          version: what.version,
          file: file.file,
          provenance: file.provenance,
          note: holder && entry.key === own ? file.leading : null,
          fields: what.fields,
          bases: what.bases,
          params: what.params,
          value: what.value ? { src: entry.src, node: what.value } : null,
          annotations: { ...notes, ...what.notes },
        },
      ],
    };
  });
}

/**
 * The name of a struct node: the identifier after its `%`.
 * @param {Src} src
 * @param {SyntaxNode | null} node
 */
function structName(src, node) {
  if (!node || node.kind !== 'struct') return null;
  for (let i = node.first; i <= node.last; i += 1) {
    if (src.tokens[i].type === 'IDENTIFIER') return tokenText(src, i);
  }
  return null;
}

/**
 * @typedef {{kind: 'schema' | 'shape' | 'type', version: number | null, fields: Row[], bases: Bases[], params: Param[], value: SyntaxNode | null, notes: Notes}} What
 */

/**
 * What an entry is: its kind -- a schema, a shape, or a named type -- its
 * version, its fields and the bases its head names (a schema's or
 * shape's), its parameters (a generic's), the value to show as its
 * definition, and the annotations found inside it (`%type(N)[{:doc
 * ...}]`).
 *
 * A schema's version is its header's, else its file's, else 1. A named
 * type's is its `%type(N)` header's, else its file's when the file holds
 * it (DXNS.md §6), else none -- version 1 once another version of it is
 * known (`merge`).
 * @param {Src} src
 * @param {SyntaxNode | null} value
 * @param {number | null} fileVersion
 * @param {boolean} own whether the file holds this entry, named like it
 * @returns {What}
 */
function classify(src, value, fileVersion, own) {
  const ownVersion = own ? fileVersion : null;
  /** @type {What} */
  const plain = { kind: 'type', version: ownVersion, fields: [], bases: [], params: [], value, notes: {} };
  const node = value ? bodyOf(value) : null;
  if (node && node.kind === 'struct') {
    const name = structName(src, node);
    if (name === 'schema') {
      return { ...plain, kind: 'schema', version: headerVersion(src, node) ?? fileVersion ?? 1, fields: fieldsOf(src, node), bases: basesOf(src, node) };
    }
    if (name === 'shape') return { ...plain, kind: 'shape', version: null, fields: fieldsOf(src, node), bases: basesOf(src, node) };
    if (name === 'type') {
      const { node: inner, notes } = undoc(src, positional(node));
      const what = classify(src, inner, null, false);
      return { ...what, version: headerVersion(src, node) ?? ownVersion ?? 1, notes: { ...what.notes, ...notes } };
    }
    return plain;
  }
  if (node && node.kind === 'tuple') {
    const values = node.children.filter((c) => c.kind === 'value');
    if (values.length === 3 && text(src, values[0]) === ':generic') {
      return { ...plain, params: paramsOf(src, values[1]), value: values[2] };
    }
  }
  return plain;
}

/** The one item of a positional struct: `%type(2)[T]`'s `T`. @param {SyntaxNode} struct */
function positional(struct) {
  const body = struct.children.find((c) => c.kind === 'positional');
  return body ? (body.children.find((c) => c.kind === 'value') ?? null) : null;
}

/**
 * A generic's parameters, each `t`, `{t bound}` or `{t bound default}`
 * (DXNS.md §5): its name, and its bound and default as written, or null.
 * @param {Src} src
 * @param {SyntaxNode} value
 * @returns {Param[]}
 */
function paramsOf(src, value) {
  const list = bodyOf(value);
  if (!list || list.kind !== 'list') return [];
  return list.children
    .filter((c) => c.kind === 'value')
    .map((param) => {
      const tuple = bodyOf(param);
      if (tuple && tuple.kind === 'tuple') {
        const [name, bound, def] = tuple.children.filter((c) => c.kind === 'value');
        return { name: text(src, name), bound: bound ? { src, node: bound } : null, default: def ? { src, node: def } : null };
      }
      return { name: text(src, param), bound: null, default: null };
    });
}

/**
 * The bases a head names (DXNS.md §4b), by the word before them: `extends
 * A includes B C` is `[{relation: 'extends', names: [A]}, {relation:
 * 'includes', names: [B, C]}]`, each base its name as written and the
 * version it pins, or null.
 * @param {Src} src
 * @param {SyntaxNode} struct
 * @returns {Bases[]}
 */
function basesOf(src, struct) {
  /** @type {Bases[]} */
  const groups = [];
  for (const word of struct.children.filter((c) => c.kind === 'head-word')) {
    const written = text(src, word);
    if (written === 'extends' || written === 'includes') groups.push({ relation: written, names: [] });
    else if (groups.length > 0) groups[groups.length - 1].names.push(pinned(src, word));
  }
  return groups;
}

/**
 * A name as written and the version it pins: `x/Tier(1)` -- a symbol, or
 * a head's base -- is `["x/Tier", 1]`, a name without one `[name, null]`.
 * @param {Src} src
 * @param {SyntaxNode} node
 * @returns {[string, number | null]}
 */
function pinned(src, node) {
  /** @type {string | null} */
  let name = null;
  /** @type {number | null} */
  let version = null;
  for (let i = node.first; i <= node.last; i += 1) {
    const type = src.tokens[i].type;
    if (type === 'IDENTIFIER' && name === null) name = tokenText(src, i);
    else if (type === 'INTEGER' && version === null) version = Number(tokenText(src, i));
  }
  return [/** @type {string} */ (name), version];
}

/**
 * A struct's `(N)`, when written: the number between its name and its
 * head's words or its body, never a base's `(N)`.
 * @param {Src} src
 * @param {SyntaxNode} struct
 */
function headerVersion(src, struct) {
  const end = struct.children.length > 0 ? struct.children[0].first : struct.last + 1;
  for (let i = struct.first; i < end; i += 1) {
    if (src.tokens[i].type === 'INTEGER') return Number(tokenText(src, i));
  }
  return null;
}

/**
 * A schema's or shape's body, in order: its fields -- name, whether it is
 * optional, its type, default, computed default and description, its
 * comments, and its position in the binary form -- and, where they are
 * written, the fields it leaves out of its bases (`- name`), its extras
 * (`* K => V`) and its closing (`- *`, DXNS.md §4b, §4c).
 * @param {Src} src
 * @param {SyntaxNode} struct
 * @returns {Row[]}
 */
function fieldsOf(src, struct) {
  const keyed = struct.children.find((c) => c.kind === 'keyed');
  if (!keyed) return [];
  const comments = Comments.attached(partsOf(src, keyed, ['entry', 'drop', 'rest']));
  let position = 0;
  let at = 0;
  /** @type {Row[]} */
  const rows = [];
  for (const child of keyed.children) {
    if (child.kind === 'entry') {
      const raw = keyOf(src, child);
      const optional = raw.endsWith('?');
      rows.push(field(src, optional ? raw.slice(0, -1) : raw, optional, valueOf(child), docText(comments[at]), position + 1));
      position += 1;
      at += 1;
    } else if (child.kind === 'drop') {
      const named = src.tokens[child.last].type === 'IDENTIFIER';
      const doc = docText(comments[at]);
      rows.push(named ? { kind: 'drop', name: tokenText(src, child.last), doc } : { kind: 'closed', doc });
      at += 1;
    } else if (child.kind === 'rest') {
      const [key, type] = child.children.filter((c) => c.kind === 'value');
      rows.push({ kind: 'extra', key: { src, node: key }, type: { src, node: type }, doc: docText(comments[at]) });
      at += 1;
    }
  }
  return rows;
}

/**
 * @param {Src} src
 * @param {string} name
 * @param {boolean} optional
 * @param {SyntaxNode | null} raw the field's value as written, a `{:doc ...}` around it or not
 * @param {string} doc
 * @param {number} position
 * @returns {Field}
 */
function field(src, name, optional, raw, doc, position) {
  const { node: value, notes } = undoc(src, raw);
  /** @type {Field} */
  const base = {
    kind: 'field',
    name,
    optional,
    type: value ? { src, node: value } : null,
    default: null,
    computed: null,
    description: null,
    doc,
    annotations: notes,
    position,
  };
  const struct = value ? bodyOf(value) : null;
  const keyed = struct && structName(src, struct) === 'field' ? struct.children.find((c) => c.kind === 'keyed') : null;
  if (!keyed) return base;
  /** @type {Map<string, SyntaxNode | null>} */
  const parts = new Map(keyed.children.filter((c) => c.kind === 'entry').map((e) => [keyOf(src, e), valueOf(e)]));
  const at = (/** @type {string} */ k) => {
    const node = parts.get(k);
    return node ? { src, node } : null;
  };
  const description = parts.get('description');
  const type = undoc(src, parts.get('type') ?? null);
  return {
    ...base,
    type: type.node ? { src, node: type.node } : null,
    default: at('default'),
    computed: at('computed'),
    description: description ? stringValue(src, description) : null,
    annotations: { ...notes, ...type.notes },
  };
}

// ---- annotations, {:doc T %{...}} (DXNS.md §1b) ------------------------------

/**
 * A value node without the `{:doc T %{...}}` around it, and what the doc
 * says: its annotations by name, each value decoded -- `{}` for a value
 * without one.
 * @param {Src} src
 * @param {SyntaxNode | null} value
 * @returns {{node: SyntaxNode | null, notes: Notes}}
 */
function undoc(src, value) {
  const tuple = value ? bodyOf(value) : null;
  if (!tuple || tuple.kind !== 'tuple') return { node: value, notes: {} };
  const values = tuple.children.filter((c) => c.kind === 'value');
  if (values.length !== 3 || text(src, values[0]) !== ':doc') return { node: value, notes: {} };
  let map;
  try {
    map = parser.parse(source(src, values[2]));
  } catch {
    return { node: value, notes: {} };
  }
  return map instanceof Map ? { node: values[1], notes: namedNotes(map) } : { node: value, notes: {} };
}

/**
 * Annotations keyed by name, and so are each enum value's under `values`.
 * @param {Map<unknown, unknown>} map @returns {Notes}
 */
function namedNotes(map) {
  /** @type {Notes} */
  const out = {};
  for (const [key, value] of map) {
    const name = annotationName(key);
    out[name] =
      name === 'values' && value instanceof Map
        ? new Map(Array.from(value, ([literal, notes]) => [literal, notes instanceof Map ? namedNotes(notes) : {}]))
        : value;
  }
  return out;
}

/** An annotation's name: a keyword's, a string, or any other key as written. @param {unknown} key @returns {string} */
function annotationName(key) {
  if (key instanceof DXNKeyword) return key.name;
  if (typeof key === 'string') return key;
  return written(key);
}

/** A decoded value as DXN writes it, canonically. @param {unknown} value @returns {string} */
function written(value) {
  try {
    return canonical(value);
  } catch {
    return String(value);
  }
}

/** A node's source as written, trivia included, so it decodes as it reads. @param {Src} src @param {SyntaxNode} node */
function source(src, node) {
  return src.source.slice(src.tokens[node.first].start, src.tokens[node.last].end);
}

/** The string `node` writes. @param {Src} src @param {SyntaxNode} node */
function stringValue(src, node) {
  try {
    const value = parser.parse(text(src, node));
    return typeof value === 'string' ? value : text(src, node);
  } catch {
    return text(src, node);
  }
}

/**
 * One definition from its parts across files: its versions, latest first,
 * and the documentation of the latest.
 * @param {Definition[]} parts
 * @returns {Definition}
 */
function merge(parts) {
  const versions = numbered(parts.flatMap((p) => p.versions));
  let latest = parts[0];
  for (const part of parts) if ((part.versions[0].version ?? 1) > (latest.versions[0].version ?? 1)) latest = part;
  return { ...latest, versions, namespaceNote: parts[0].namespaceNote };
}

/**
 * Versions, latest first; once one is numbered, one that is not is version
 * 1 (DXNS.md §5c: a plain definition is version 1).
 * @param {Version[]} versions
 * @returns {Version[]}
 */
function numbered(versions) {
  if (!versions.some((v) => v.version !== null)) return versions;
  return versions.map((v) => ({ ...v, version: v.version ?? 1 })).sort((a, b) => /** @type {number} */ (b.version) - /** @type {number} */ (a.version));
}

// ---- references ---------------------------------------------------------------

/**
 * The names the type `at` refers to, as `scope` resolves them.
 * @param {At | null} at
 * @param {Map<string, string>} scope
 * @returns {string[]}
 */
function references(at, scope) {
  if (!at) return [];
  /** @type {string[]} */
  const found = [];
  const visit = (/** @type {SyntaxNode} */ node) => {
    if (isSymbol(at.src, node) || node.kind === 'pinned') found.push(resolve(pinned(at.src, node)[0], scope));
    else node.children.forEach(visit);
  };
  visit(at.node);
  return found;
}

/** Whether `node` is a symbol: a body of one identifier. @param {Src} src @param {SyntaxNode} node */
function isSymbol(src, node) {
  return node.kind === 'body' && node.children.length === 0 && node.first === node.last && src.tokens[node.first].type === 'IDENTIFIER';
}

/** The name a bare or namespaced `name` stands for, in a file whose entries are `scope`. @param {string} name @param {Map<string, string>} scope */
function resolve(name, scope) {
  return scope.get(name) ?? name;
}

module.exports = { site, write, references, resolve, pinned, text, bodyOf, valueOf, isSymbol, tokenText, undoc, written };
