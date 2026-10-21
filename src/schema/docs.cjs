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
 * **Names** come from where a file lies under the root, by DXN.md §4.6:
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
 * @typedef {{[name: string]: unknown}} Notes a doc's annotations by name (DXN.md §4.1b), each value decoded
 * @typedef {{name: string, optional: boolean, type: At | null, default: At | null, description: string | null, doc: string, annotations: Notes, position?: number}} Field
 * @typedef {{version: number | null, file: string, note: string | null, fields: Field[], value: At | null, annotations: Notes}} Version
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
  return { file, stem, fileVersion: version, leading: leadingOf(doc, value), entries: entriesOf(src, map) };
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
 * `Comments.attached` reads.
 * @param {Src} src
 * @param {SyntaxNode} node
 */
function partsOf(src, node) {
  /** @type {Array<{gap: string} | {entry: true}>} */
  const parts = [];
  let from = src.tokens[/** @type {number} */ (node.open)].end;
  for (const child of node.children.filter((c) => c.kind === 'entry')) {
    parts.push({ gap: src.source.slice(from, src.tokens[child.first].start) }, { entry: true });
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
  // The names every reader of a tree gives them (`layout.cjs`, DXN.md §4.6).
  const layout = Layout.of(file.file, file.entries.map((e) => e.key));
  const names = layout.names;
  const own = layout.holder;
  const holder = own !== null;
  const owner = own !== null ? /** @type {string} */ (names.get(own)) : null;

  return file.entries.map((entry) => {
    const name = /** @type {string} */ (names.get(entry.key));
    const internalTo = holder && entry.key !== own ? owner : null;
    const { node: value, notes } = undoc(entry.src, entry.value);
    const { kind, version, fields } = classify(entry.src, value, file.fileVersion);
    return {
      name,
      short: entry.key,
      namespace: internalTo ? namespaceOf(internalTo) : namespaceOf(name),
      kind,
      internalTo,
      doc: entry.doc,
      scope: names,
      namespaceNote: holder ? null : file.leading,
      versions: [
        {
          version,
          file: file.file,
          note: holder && entry.key === own ? file.leading : null,
          fields,
          value: value ? { src: entry.src, node: value } : null,
          annotations: notes,
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
 * What an entry is: a schema with its version and fields, a shape with its
 * fields, or a named type.
 * @param {Src} src
 * @param {SyntaxNode | null} value
 * @param {number | null} fileVersion
 * @returns {{kind: 'schema' | 'shape' | 'type', version: number | null, fields: Field[]}}
 */
function classify(src, value, fileVersion) {
  const node = value ? bodyOf(value) : null;
  const name = structName(src, node);
  if (node && name === 'schema') return { kind: 'schema', version: headerVersion(src, node) ?? fileVersion ?? 1, fields: fieldsOf(src, node) };
  if (node && name === 'shape') return { kind: 'shape', version: null, fields: fieldsOf(src, node) };
  return { kind: 'type', version: null, fields: [] };
}

/** A struct's `(N)`, when written. @param {Src} src @param {SyntaxNode} struct */
function headerVersion(src, struct) {
  const body = struct.children.find((c) => c.kind === 'keyed' || c.kind === 'positional');
  const end = body ? body.first : struct.last + 1;
  for (let i = struct.first; i < end; i += 1) {
    if (src.tokens[i].type === 'INTEGER') return Number(tokenText(src, i));
  }
  return null;
}

/** @param {Src} src @param {SyntaxNode} struct @returns {Field[]} */
function fieldsOf(src, struct) {
  const keyed = struct.children.find((c) => c.kind === 'keyed');
  if (!keyed) return [];
  const entries = keyed.children.filter((c) => c.kind === 'entry');
  const comments = Comments.attached(partsOf(src, keyed));
  return entries.map((entry, i) => {
    const raw = keyOf(src, entry);
    const optional = raw.endsWith('?');
    return { ...field(src, optional ? raw.slice(0, -1) : raw, optional, valueOf(entry), docText(comments[i])), position: i + 1 };
  });
}

/**
 * @param {Src} src
 * @param {string} name
 * @param {boolean} optional
 * @param {SyntaxNode | null} raw the field's value as written, a `{:doc ...}` around it or not
 * @param {string} doc
 * @returns {Field}
 */
function field(src, name, optional, raw, doc) {
  const { node: value, notes } = undoc(src, raw);
  /** @type {Field} */
  const base = { name, optional, type: value ? { src, node: value } : null, default: null, description: null, doc, annotations: notes };
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
    description: description ? stringValue(src, description) : null,
    annotations: { ...notes, ...type.notes },
  };
}

// ---- annotations, {:doc T %{...}} (DXN.md §4.1b) ------------------------------

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
  const versions = parts.flatMap((p) => p.versions).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  let latest = parts[0];
  for (const part of parts) if ((part.versions[0].version ?? 0) > (latest.versions[0].version ?? 0)) latest = part;
  return { ...latest, versions, namespaceNote: parts[0].namespaceNote };
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
    if (isSymbol(at.src, node)) found.push(resolve(text(at.src, node), scope));
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

module.exports = { site, write, references, resolve, text, bodyOf, valueOf, isSymbol, tokenText, undoc, written };
