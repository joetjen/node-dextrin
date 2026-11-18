'use strict';

/**
 * @fileoverview The pages of `SchemaDocs` -- the port of
 * `Dextrin.Schema.Docs.Html`, writing what it writes byte for byte:
 * `index.html` (the top: a section per root namespace, then the names with
 * no namespace), an `index.html` in a directory per namespace, and the
 * stylesheet they share, `style.css`. Every template here is the
 * reference's, character for character.
 */

const Docs = require('../docs.cjs');
const { escape, toHtml } = require('./markdown.cjs');
const { STYLESHEET, THEME_EARLY, THEME_SWITCH } = require('./assets.cjs');
const DXNList = require('../../values/list.cjs');
const DXNKeyword = require('../../values/keyword.cjs');

/**
 * @typedef {import('../docs.cjs').Definition} Definition
 * @typedef {import('../docs.cjs').At} At
 * @typedef {import('../../text/parser.cjs').SyntaxNode} SyntaxNode
 * @typedef {{known: Map<string, Definition>, usedBy: Map<string, string[]>, title: string, byNamespace: Map<string, Definition[]>, all: string[], notes: Map<string, string>}} Ctx
 */

/**
 * The site's pages for `definitions`, under the name `title`.
 * @param {string} title
 * @param {Definition[]} definitions
 * @returns {Array<[string, string]>}
 */
function pages(title, definitions) {
  /** @type {Map<string, Definition[]>} */
  const byNamespace = new Map();
  for (const d of definitions) byNamespace.set(d.namespace, [...(byNamespace.get(d.namespace) ?? []), d]);
  const named = [...byNamespace.keys()].filter((ns) => ns !== '');
  const all = [...new Set(named.flatMap(prefixes))].sort(compare);
  /** @type {Ctx} */
  const ctx = {
    known: new Map(definitions.map((d) => [d.name, d])),
    usedBy: usedBy(definitions),
    title,
    byNamespace,
    all,
    notes: notes(definitions),
  };
  return [['style.css', STYLESHEET], ['index.html', namespacePage(null, ctx)], ...all.map((ns) => /** @type {[string, string]} */ ([pageOf(ns), namespacePage(ns, ctx)]))];
}

/** @param {string} a @param {string} b */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted by a lower-cased key, stably. @param {Definition[]} defs */
function byShort(defs) {
  return [...defs].sort((a, b) => compare(a.short.toLowerCase(), b.short.toLowerCase()));
}

// ---- the namespace tree -------------------------------------------------------

/** `acme.shop` and every namespace above it. @param {string} namespace */
function prefixes(namespace) {
  const segments = namespace.split('.');
  return segments.map((_, i) => segments.slice(0, i + 1).join('.'));
}

/** The namespaces directly below `parent` (null: the roots). @param {string | null} parent @param {Ctx} ctx */
function children(parent, ctx) {
  if (parent === null) return ctx.all.filter((ns) => !ns.includes('.'));
  const depth = parent.split('.').length;
  return ctx.all.filter((ns) => ns.startsWith(`${parent}.`) && ns.split('.').length === depth + 1);
}

/**
 * The public definitions of `namespace`, in order, and the internal ones
 * by owner.
 * @param {string | null} namespace
 * @param {Ctx} ctx
 * @returns {{publicDefs: Definition[], internal: Map<string, Definition[]>}}
 */
function own(namespace, ctx) {
  const defs = ctx.byNamespace.get(namespace ?? '') ?? [];
  /** @type {Map<string, Definition[]>} */
  const internal = new Map();
  for (const d of defs) {
    if (d.internalTo !== null) internal.set(d.internalTo, [...(internal.get(d.internalTo) ?? []), d]);
  }
  return { publicDefs: byShort(defs.filter((d) => d.internalTo === null)), internal };
}

/** @param {Definition} d @param {Map<string, Definition[]>} internal */
function internalsOf(d, internal) {
  return byShort(internal.get(d.name) ?? []);
}

/** What a namespace file says about each namespace. @param {Definition[]} definitions */
function notes(definitions) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const d of definitions) if (d.namespaceNote !== null && d.namespaceNote !== '') out.set(d.namespace, d.namespaceNote);
  return out;
}

/** Every public definition in `namespace` and below it. @param {string} namespace @param {Ctx} ctx */
function total(namespace, ctx) {
  let n = 0;
  for (const [ns, defs] of ctx.byNamespace) {
    if (ns === namespace || ns.startsWith(`${namespace}.`)) n += defs.filter((d) => d.internalTo === null).length;
  }
  return n;
}

// ---- addresses ----------------------------------------------------------------

/**
 * A namespace is a directory, its page the directory's `index.html`; the
 * top is `index.html`. Every link is written from the site's root, and made
 * relative to its page when the page is put together (`relative`).
 * @param {string | null} namespace
 */
function pageOf(namespace) {
  if (namespace === null || namespace === '') return 'index.html';
  return `${namespace.split('.').join('/')}/index.html`;
}

/** Every link in `html` to the site, made relative to the page at `path`. @param {string} html @param {string} path */
function relative(html, path) {
  const base = '../'.repeat(path.split('/').length - 1);
  return html.replace(/(href)="(?!https?:|#|mailto:)([^"]*)"/g, (_, attr, target) => `${attr}="${base}${target}"`);
}

/** @param {Definition} d */
function anchor(d) {
  return d.internalTo === null ? d.short : `${shortOf(d.internalTo)}.${d.short}`;
}

/** Where version `n` of a definition is: its own anchor and the version. @param {Definition} d @param {number} n */
function versionAnchor(d, n) {
  return `${anchor(d)}-v${n}`;
}

/** @param {string} name */
function shortOf(name) {
  const parts = name.split('/');
  return parts[parts.length - 1];
}

/** @param {Definition} d */
function href(d) {
  return `${pageOf(d.namespace)}#${anchor(d)}`;
}

/** @param {string} namespace */
function lastSegment(namespace) {
  const parts = namespace.split('.');
  return parts[parts.length - 1];
}

/** Who refers to whom. @param {Definition[]} definitions */
function usedBy(definitions) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const seen = new Set();
  for (const d of definitions) {
    const bases = d.versions.flatMap((v) => v.bases.flatMap((group) => group.names.map(([name]) => Docs.resolve(name, d.scope))));
    const refs = [...new Set([...typesOf(d).flatMap((t) => Docs.references(t, d.scope)), ...bases])].filter((r) => r !== d.name);
    for (const r of refs) {
      const key = `${r}\u0000${d.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.set(r, [...(out.get(r) ?? []), d.name]);
    }
  }
  return out;
}

/**
 * Every type a definition's versions write: a named type's definition and
 * its parameters' bounds and defaults, a body's field types and its
 * extras' keys and values.
 * @param {Definition} d
 * @returns {Array<At | null>}
 */
function typesOf(d) {
  if (d.kind === 'type') return d.versions.flatMap((v) => [v.value, ...v.params.flatMap((p) => [p.bound, p.default])]);
  return d.versions.flatMap((v) =>
    v.fields.flatMap((row) => {
      if (row.kind === 'field') return [row.type];
      if (row.kind === 'extra') return [row.key, row.type];
      return [];
    })
  );
}

// ---- the frame: the sidebar, then the page ------------------------------------

/** @param {string} title @param {string | null} current @param {Ctx} ctx @param {string} body */
function frame(title, current, ctx, body) {
  return relative(page(title, current, ctx, body), pageOf(current));
}

/** @param {string} title @param {string | null} current @param {Ctx} ctx @param {string} body */
function page(title, current, ctx, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>${escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="style.css">
<script>${THEME_EARLY}</script>
</head>
<body>
<div class="layout">
  <nav class="sidebar" aria-label="All namespaces and definitions">
    <div class="sidebar-head">
      <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">%{}</span>${escape(ctx.title)}</a>
      <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Switch between light and dark">Dark</button>
    </div>
    <details class="sidebar-toggle" open>
      <summary>Browse</summary>
      ${sidebar(current, ctx)}
    </details>
  </nav>
  <main class="main">
    ${body}
    <footer class="site-foot"><p>Generated from the <code>.dxns</code> sources by Dextrin. A field's # is its position in the binary form.</p></footer>
  </main>
</div>
<script>${THEME_SWITCH}</script>
</body>
</html>
`;
}

/** The tree of every namespace and definition, `current`'s branch open. @param {string | null} current @param {Ctx} ctx */
function sidebar(current, ctx) {
  const roots = children(null, ctx)
    .map((ns) => treeNode(ns, current, ctx))
    .join('');
  const { publicDefs, internal } = own('', ctx);
  const global =
    publicDefs.length === 0
      ? ''
      : `<li><details${current === null ? ' open' : ''}><summary><a href="${pageOf(null)}">No namespace</a></summary><ul>` +
        publicDefs.map((d) => treeDefinition(d, internal)).join('') +
        '</ul></details></li>';
  return `<ul class="tree">${roots}${global}</ul>`;
}

/** @param {string} namespace @param {string | null} current @param {Ctx} ctx @returns {string} */
function treeNode(namespace, current, ctx) {
  const onPath = current !== null && current !== '' && (current === namespace || current.startsWith(`${namespace}.`));
  const { publicDefs, internal } = own(namespace, ctx);
  const inner =
    children(namespace, ctx)
      .map((ns) => treeNode(ns, current, ctx))
      .join('') + publicDefs.map((d) => treeDefinition(d, internal)).join('');
  return (
    `<li><details${onPath ? ' open' : ''}><summary><a href="${pageOf(namespace)}"${aria(current === namespace)}>` +
    `${escape(lastSegment(namespace))}</a></summary><ul>${inner}</ul></details></li>`
  );
}

/** @param {Definition} d @param {Map<string, Definition[]>} internal @returns {string} */
function treeDefinition(d, internal) {
  const list = internalsOf(d, internal);
  const inner = list.length === 0 ? '' : `<ul>${list.map((i) => treeDefinition(i, new Map())).join('')}</ul>`;
  return `<li class="def-leaf"><a href="${href(d)}"><span class="dot dot-${d.kind}" aria-hidden="true"></span>${escape(d.short)}</a>${inner}</li>`;
}

/** @param {boolean} current */
function aria(current) {
  return current ? ' aria-current="page"' : '';
}

// ---- a namespace's page, and the index -----------------------------------------

/**
 * One design for both: a section for each namespace directly below,
 * listing its own namespaces and definitions; then this namespace's own
 * definitions in full. The top's own definitions are the names with no
 * namespace.
 * @param {string | null} namespace
 * @param {Ctx} ctx
 */
function namespacePage(namespace, ctx) {
  const { publicDefs, internal } = own(namespace, ctx);
  const below = children(namespace, ctx);
  const sections = below.map((ns) => childSection(ns, ctx)).join('');
  const note = namespace !== null ? (ctx.notes.get(namespace) ?? null) : null;
  const cards = publicDefs.map((d) => definition(d, ctx) + internalsOf(d, internal).map((i) => definition(i, ctx)).join('')).join('');
  let ownHeading = '';
  if (cards !== '' && below.length > 0) {
    ownHeading =
      namespace === null
        ? '<h2 class="own-heading">Names with no namespace</h2>'
        : `<h2 class="own-heading">Definitions in <code>${escape(namespace)}</code></h2>`;
  }
  const [eyebrow, heading, title] =
    namespace === null
      ? ['Schema reference', escape(ctx.title), ctx.title]
      : ['Namespace', `<code>${escape(namespace)}</code>`, `${namespace} · ${ctx.title}`];
  const lede =
    namespace === null
      ? '<p class="lede">Every struct schema, shape and named type, by namespace. A name links to its definition wherever it appears.</p>'
      : '';
  const noteHtml = note ? `<div class="prose">${toHtml(note, linker(new Map(), ctx))}</div>` : '';
  return frame(
    title,
    namespace,
    ctx,
    `<div class="page">
  <header class="intro">
    ${crumbs(namespace)}
    <p class="eyebrow">${eyebrow}</p>
    <h1>${heading}</h1>
    ${lede}
    ${noteHtml}
  </header>
  ${sections === '' ? '' : `<div class="sections">${sections}</div>`}
  ${ownHeading}
  ${cards}
</div>
`
  );
}

/** @param {string | null} namespace */
function crumbs(namespace) {
  if (namespace === null) return '';
  const parents = prefixes(namespace).slice(0, -1);
  const links = ['<a href="index.html">All namespaces</a>', ...parents.map((p) => `<a href="${pageOf(p)}">${escape(lastSegment(p))}</a>`)];
  return `<p class="crumbs">${links.join(' › ')} › <b>${escape(lastSegment(namespace))}</b></p>`;
}

/** A namespace directly below the page's. @param {string} namespace @param {Ctx} ctx */
function childSection(namespace, ctx) {
  const { publicDefs } = own(namespace, ctx);
  const note = firstParagraph(ctx.notes.get(namespace) ?? null);
  const subs = children(namespace, ctx)
    .map(
      (sub) =>
        `<li><a class="ns-link" href="${pageOf(sub)}"><code>${escape(lastSegment(sub))}</code></a><span class="count">${total(sub, ctx)}</span></li>`
    )
    .join('');
  const defs = publicDefs.map(defLink).join('');
  return `<section class="ns-section">
  <h2><a href="${pageOf(namespace)}"><code>${escape(namespace)}</code></a></h2>
  ${note ? `<div class="prose summary">${toHtml(note, () => null)}</div>` : ''}
  ${subs === '' ? '' : `<div class="group"><p class="label">Namespaces</p><ul class="links">${subs}</ul></div>`}
  ${defs === '' ? '' : `<div class="group"><p class="label">Definitions</p><ul class="links">${defs}</ul></div>`}
</section>
`;
}

/** @param {Definition} d */
function defLink(d) {
  return `<li><a href="${href(d)}"><code>${escape(d.short)}</code></a>${kindChip(d)}</li>`;
}

/** @param {string | null} text */
function firstParagraph(text) {
  if (text === null || text === '') return null;
  return text.split(/\n\s*\n/)[0];
}

// ---- one definition -------------------------------------------------------------

/** @param {Definition} d @param {Ctx} ctx */
function definition(d, ctx) {
  const [latest, ...older] = d.versions;
  const used = [...(ctx.usedBy.get(d.name) ?? [])]
    .sort(compare)
    .map((name) => {
      const user = ctx.known.get(name);
      return user ? `<a href="${href(user)}"><code>${escape(display(user))}</code></a>` : `<code>${escape(name)}</code>`;
    })
    .join(', ');
  return `<article class="def kind-${d.kind}" id="${escape(anchor(d))}">
  <header class="def-head">
    <h2><a class="self" href="#${escape(anchor(d))}"><code>${struck(escape(d.short), latest.annotations)}</code></a></h2>
    <div class="chips">${kindChip(d)}${internalChip(d, ctx)}${versionChips(d)}${annotationChips(latest.annotations)}</div>
    ${title(latest.annotations)}<p class="full-name"><code>${escape(d.name)}</code></p>
  </header>
  ${about(d, latest.annotations, ctx)}
  ${versionBody(d, latest, ctx)}
  ${older.map((v) => olderVersion(d, v, ctx)).join('')}
  ${used === '' ? '' : `<p class="used-by"><span class="label">Used by</span> ${used}</p>`}
</article>
`;
}

// ---- annotations, {:doc T %{...}} (DXNS.md §1b) ---------------------------

/**
 * What a definition's page says about it before its body: the doc's
 * description, the comments, examples and meta -- each only when there is
 * one, so a definition without annotations reads as it always did.
 * @param {Definition} d @param {import('../docs.cjs').Notes} notes @param {Ctx} ctx
 */
function about(d, notes, ctx) {
  return [prose(described(notes), d, ctx), prose(d.doc, d, ctx), values(notes, d, ctx), examples(notes), messages(notes), meta(notes)]
    .filter((part) => part !== '')
    .join('\n  ');
}

/** A doc's description, `null` without one. @param {import('../docs.cjs').Notes} notes @returns {string | null} */
function described(notes) {
  return typeof notes.description === 'string' ? notes.description : null;
}

/**
 * Deprecated (with its reason), read-only, write-only, key, secret,
 * visibility and discriminator, as chips.
 * @param {import('../docs.cjs').Notes} notes
 */
function annotationChips(notes) {
  const flags = ['read-only', 'write-only']
    .filter((key) => notes[key] === true)
    .map((key) => `<span class="chip chip-${key}">${key}</span>`)
    .join('');
  return (
    deprecatedChip(notes) +
    flags +
    keyChip(notes.key) +
    (notes.secret === true ? '<span class="chip chip-secret">secret</span>' : '') +
    visibilityChip(notes.visibility) +
    discriminatorChip(notes.discriminator)
  );
}

/** @param {unknown} key */
function keyChip(key) {
  if (key === true) return '<span class="chip chip-key">key</span>';
  if (typeof key === 'string') return `<span class="chip chip-key">key: ${escape(key)}</span>`;
  return '';
}

/** The stages that see a field (DXNS.md §1b); `[]` is none. @param {unknown} visibility */
function visibilityChip(visibility) {
  const stages = visibility instanceof DXNList ? visibility.items : Array.isArray(visibility) ? visibility : null;
  if (stages === null) return '';
  if (stages.length === 0) return '<span class="chip chip-visibility">visible on no stage</span>';
  return `<span class="chip chip-visibility">visible on ${escape(stages.map(stageName).join(', '))}</span>`;
}

/** A stage's name: a keyword's, or anything else as written. @param {unknown} stage */
function stageName(stage) {
  return stage instanceof DXNKeyword ? stage.name : Docs.written(stage);
}

/** @param {unknown} field */
function discriminatorChip(field) {
  if (field === undefined || field === null) return '';
  return `<span class="chip chip-discriminator">discriminator: ${escape(stageName(field))}</span>`;
}

/** Deprecated, with its reason when it gives one. @param {import('../docs.cjs').Notes} notes */
function deprecatedChip(notes) {
  const reason = notes.deprecated;
  if (reason === true) return '<span class="chip chip-deprecated">deprecated</span>';
  if (typeof reason === 'string') return `<span class="chip chip-deprecated" title="${escape(reason)}">deprecated: ${escape(reason)}</span>`;
  return '';
}

/** `html` struck through when `notes` deprecate what it names. @param {string} html @param {import('../docs.cjs').Notes} notes */
function struck(html, notes) {
  return notes.deprecated === true || typeof notes.deprecated === 'string' ? `<s>${html}</s>` : html;
}

/** An enum's values, each with what its own annotations say. @param {import('../docs.cjs').Notes} notes @param {Definition} d @param {Ctx} ctx */
function values(notes, d, ctx) {
  const all = notes.values;
  if (!(all instanceof Map) || all.size === 0) return '';
  const rows = Array.from(all, ([literal, own]) => /** @type {[string, import('../docs.cjs').Notes]} */ ([Docs.written(literal), own]))
    .sort(([a], [b]) => byCodepoint(a, b))
    .map(([literal, own]) => {
      const description = typeof own.description === 'string' ? toHtml(own.description, linker(d.scope, ctx)) : '';
      return `<dt><code>${escape(literal)}</code>${annotationChips(own)}</dt><dd>${description}</dd>`;
    })
    .join('');
  return `<dl class="values"><p class="label">Values</p>${rows}</dl>`;
}

/** @param {import('../docs.cjs').Notes} notes */
function title(notes) {
  return typeof notes.title === 'string' ? `<p class="title">${escape(notes.title)}</p>` : '';
}

/** @param {import('../docs.cjs').Notes} notes */
function examples(notes) {
  const list = notes.examples;
  if (!(list instanceof DXNList) || list.items.length === 0) return '';
  const items = list.items.map((e) => `<li><code>${escape(Docs.written(e))}</code></li>`).join('');
  return `<div class="examples"><p class="label">Examples</p><ul>${items}</ul></div>`;
}

/** @param {import('../docs.cjs').Notes} notes */
function meta(notes) {
  const all = notes.meta;
  if (!(all instanceof Map) || all.size === 0) return '';
  const rows = Array.from(all, ([key, value]) => [Docs.written(key), Docs.written(value)])
    .sort(([k1, v1], [k2, v2]) => byCodepoint(k1, k2) || byCodepoint(v1, v2))
    .map(([key, value]) => `<dt><code>${escape(key)}</code></dt><dd><code>${escape(value)}</code></dd>`)
    .join('');
  return `<dl class="meta"><p class="label">Meta</p>${rows}</dl>`;
}

/** A refusal's own words, by the refine key that refuses. @param {import('../docs.cjs').Notes} notes */
function messages(notes) {
  const all = notes.messages;
  if (!(all instanceof Map) || all.size === 0) return '';
  const rows = Array.from(all, ([key, message]) => [Docs.written(key), typeof message === 'string' ? message : String(message)])
    .sort(([k1, m1], [k2, m2]) => byCodepoint(k1, k2) || byCodepoint(m1, m2))
    .map(([key, message]) => `<dt><code>${escape(key)}</code></dt><dd>${escape(message)}</dd>`)
    .join('');
  return `<dl class="messages"><p class="label">Messages</p>${rows}</dl>`;
}

/** Strings in code point order, as Elixir sorts them. @param {string} a @param {string} b */
function byCodepoint(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** @param {Definition} d */
function display(d) {
  return d.internalTo === null ? d.name : `${shortOf(d.internalTo)} › ${d.short}`;
}

/** @param {string | null} text @param {Definition} d @param {Ctx} ctx */
function prose(text, d, ctx) {
  if (text === '' || text === null) return '';
  return `<div class="prose">${toHtml(text, linker(d.scope, ctx))}</div>`;
}

/** @param {Definition} d */
function kindChip(d) {
  if (d.kind === 'schema') return '<span class="chip chip-schema">struct schema</span>';
  if (d.kind === 'shape') return '<span class="chip chip-shape">shape</span>';
  if (d.versions[0].params.length > 0) return '<span class="chip chip-type">generic type</span>';
  return '<span class="chip chip-type">type</span>';
}

/** @param {Definition} d @param {Ctx} ctx */
function internalChip(d, ctx) {
  if (d.internalTo === null) return '';
  const o = ctx.known.get(d.internalTo);
  return o
    ? `<span class="chip chip-internal">internal to <a href="${href(o)}">${escape(o.short)}</a></span>`
    : '<span class="chip chip-internal">internal</span>';
}

/** @param {Definition} d */
function versionChips(d) {
  const [latest, ...older] = d.versions;
  if (latest.version === null) return '';
  return (
    `<span class="chip chip-version" id="${escape(versionAnchor(d, latest.version))}">v${latest.version}</span>` +
    (older.length === 0 ? '' : `<span class="chip chip-quiet">${older.length + 1} versions</span>`)
  );
}

/** @param {Definition} d @param {import('../docs.cjs').Version} version @param {Ctx} ctx */
function olderVersion(d, version, ctx) {
  return `<details class="older" id="${escape(versionAnchor(d, /** @type {number} */ (version.version)))}">
  <summary>${struck(`Version ${version.version}`, version.annotations)} ${deprecatedChip(version.annotations)}<span class="file">${escape(version.file)}</span></summary>
  ${versionBody(d, version, ctx)}
</details>
`;
}

/** @param {Definition} d @param {import('../docs.cjs').Version} version @param {Ctx} ctx */
function versionBody(d, version, ctx) {
  if (d.kind === 'type') {
    return `<div class="type-def">
  ${paramsHtml(version.params, d, ctx)}<p class="label">Definition</p>
  <pre class="expr"><code>${typeHtml(version.value, d, ctx)}</code></pre>
  ${fileLine(version)}
</div>
`;
  }
  const note = version.note && version.note !== '' ? `<div class="prose version-note">${toHtml(version.note, linker(d.scope, ctx))}</div>` : '';
  const positionHead = d.kind === 'schema' ? '<th scope="col" class="pos" title="Position in the binary form">#</th>' : '';
  const rows = version.fields.map((row) => fieldRow(row, d, ctx)).join('');
  return `${note}
${basesHtml(version.bases, d, ctx)}<div class="table-wrap">
  <table class="fields">
    <thead><tr>${positionHead}<th scope="col">Field</th><th scope="col">Type</th><th scope="col">Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
${fileLine(version)}
`;
}

/** The file a version is in, and what generated it when a tool did. @param {import('../docs.cjs').Version} version */
function fileLine(version) {
  const from = version.provenance;
  if (!from) return `<p class="file">${escape(version.file)}</p>`;
  return `<p class="file">${escape(version.file)} <span class="provenance">generated by <code>${escape(from.tool)}</code> from <code>${escape(from.source)}</code></span></p>`;
}

/** The bases a head names, each a link (DXNS.md §4b). @param {import('../docs.cjs').Bases[]} groups @param {Definition} d @param {Ctx} ctx */
function basesHtml(groups, d, ctx) {
  if (groups.length === 0) return '';
  const words = groups.map((group) => `${group.relation} ${group.names.map(([name, pin]) => nameLink(name, pin, d, ctx)).join(', ')}`).join(' ');
  return `<p class="bases">${words}</p>\n`;
}

/** A generic's parameters, each with its bound and default (DXNS.md §5). @param {import('../docs.cjs').Param[]} params @param {Definition} d @param {Ctx} ctx */
function paramsHtml(params, d, ctx) {
  if (params.length === 0) return '';
  const rows = params
    .map((p) => {
      let about = 'any type';
      if (p.bound !== null && p.default === null) about = `within <code>${typeHtml(p.bound, d, ctx)}</code>`;
      else if (p.bound !== null) about = `within <code>${typeHtml(p.bound, d, ctx)}</code>, default <code>${typeHtml(p.default, d, ctx)}</code>`;
      return `<dt><code>${escape(p.name)}</code></dt><dd>${about}</dd>`;
    })
    .join('');
  return `<dl class="params"><p class="label">Parameters</p>${rows}</dl>\n`;
}

/**
 * The comments on a row that is not a field.
 * @param {{doc: string}} row
 * @param {Definition} d
 * @param {Ctx} ctx
 */
function rowDoc(row, d, ctx) {
  return row.doc ? toHtml(row.doc, linker(d.scope, ctx)) : '';
}

/**
 * One row of a body: a field, a field left out of the bases, the extras,
 * or the closing.
 * @param {import('../docs.cjs').Row} row
 * @param {Definition} d
 * @param {Ctx} ctx
 */
function fieldRow(row, d, ctx) {
  const pos = (/** @type {string | number} */ n) => (d.kind === 'schema' ? `<td class="pos">${n}</td>` : '');
  if (row.kind === 'drop') {
    return `<tr class="dropped">
  ${pos('')}
  <th scope="row" class="field"><code><s>${escape(row.name)}</s></code></th>
  <td class="type"></td>
  <td class="notes">left out of the bases${rowDoc(row, d, ctx)}</td>
</tr>
`;
  }
  if (row.kind === 'closed') {
    return `<tr class="closed">
  ${pos('')}
  <th scope="row" class="field"><code>- *</code></th>
  <td class="type"></td>
  <td class="notes">no entries beyond these${rowDoc(row, d, ctx)}</td>
</tr>
`;
  }
  if (row.kind === 'extra') {
    return `<tr class="extras">
  ${pos('')}
  <th scope="row" class="field"><code>* ${typeHtml(row.key, d, ctx)}</code></th>
  <td class="type"><code>${typeHtml(row.type, d, ctx)}</code></td>
  <td class="notes">any other entry with such a key${rowDoc(row, d, ctx)}</td>
</tr>
`;
  }
  const f = row;
  const notesHtml =
    annotationChips(f.annotations) +
    [described(f.annotations), f.description, f.doc]
      .filter((t) => t !== null && t !== '')
      .map((t) => toHtml(/** @type {string} */ (t), linker(d.scope, ctx)))
      .join('') +
    values(f.annotations, d, ctx) +
    examples(f.annotations) +
    messages(f.annotations) +
    meta(f.annotations);
  const def = f.default ? `<div class="default"><span class="label">default</span> <code>${typeHtml(f.default, d, ctx)}</code></div>` : '';
  const computed = f.computed ? `<div class="default"><span class="label">computed</span> <code>${typeHtml(f.computed, d, ctx)}</code></div>` : '';
  return `<tr>
  ${pos(f.position)}
  <th scope="row" class="field"><code>${struck(escape(f.name), f.annotations)}</code>${f.optional ? '<span class="opt">optional</span>' : ''}</th>
  <td class="type"><code>${typeHtml(f.type, d, ctx)}</code>${def}${computed}</td>
  <td class="notes">${notesHtml}</td>
</tr>
`;
}

// ---- type expressions -------------------------------------------------------------

/**
 * A code span names a definition when the file's own names, or the full
 * names, know it.
 * @param {Map<string, string>} scope
 * @param {Ctx} ctx
 */
function linker(scope, ctx) {
  return (/** @type {string} */ code) => {
    const target = ctx.known.get(Docs.resolve(code, scope));
    return target ? href(target) : null;
  };
}

/** @param {At | null} at @param {Definition} d @param {Ctx} ctx */
function typeHtml(at, d, ctx) {
  if (!at) return '';
  return render(at.src, at.node, d, ctx).replace(/ {2,}/g, ' ').trim();
}

/**
 * A node as HTML: its tokens as written, a gap between two as one space, a
 * symbol a link where it names a definition, a keyword and a string
 * marked, and a `{:case ...}` a table.
 * @param {import('../docs.cjs').Src} src
 * @param {SyntaxNode} node
 * @param {Definition} d
 * @param {Ctx} ctx
 * @returns {string}
 */
function render(src, node, d, ctx) {
  if (Docs.isSymbol(src, node) || node.kind === 'pinned') {
    const [name, pin] = Docs.pinned(src, node);
    return link(Docs.text(src, node), name, pin, d, ctx);
  }
  if (node.kind === 'body' && node.children.length === 0 && node.first === node.last) {
    const type = src.tokens[node.first].type;
    if (type === 'KEYWORD') return `<span class="kw">${escape(Docs.text(src, node))}</span>`;
    if (type === 'STRING') return `<span class="str">${escape(Docs.text(src, node))}</span>`;
  }
  if (node.kind === 'tuple') {
    const values = node.children.filter((c) => c.kind === 'value');
    if (values.length === 3 && Docs.text(src, values[0]) === ':case') return caseHtml(src, values[1], values[2], d, ctx);
    if (values.length === 3 && Docs.text(src, values[0]) === ':at') return plain(src, node, d, ctx, atLink(src, values[1], values[2], d, ctx));
  }
  return plain(src, node, d, ctx, null);
}

/**
 * A node's tokens and its children in order, each piece the tokens it
 * covers, joined by a space wherever the source has a gap; `instead`, when
 * given, writes one of its children in place of `render`.
 * @param {import('../docs.cjs').Src} src
 * @param {SyntaxNode} node
 * @param {Definition} d
 * @param {Ctx} ctx
 * @param {{child: SyntaxNode, html: string} | null} instead
 * @returns {string}
 */
function plain(src, node, d, ctx, instead) {
  /** @type {Array<{last: number, html: string}>} */
  const pieces = [];
  let i = node.first;
  for (const child of node.children) {
    for (; i < child.first; i += 1) pieces.push({ last: i, html: escape(Docs.tokenText(src, i)) });
    pieces.push({ last: child.last, html: instead && instead.child === child ? instead.html : render(src, child, d, ctx) });
    i = child.last + 1;
  }
  for (; i <= node.last; i += 1) pieces.push({ last: i, html: escape(Docs.tokenText(src, i)) });
  return pieces.map((p, k) => (k > 0 && gap(src, pieces[k - 1].last) ? ' ' : '') + p.html).join('');
}

/**
 * `{:at Name N}`, what `Name(N)` writes (DXNS.md §5c): the name, linking to
 * version N.
 * @param {import('../docs.cjs').Src} src
 * @param {SyntaxNode} nameValue
 * @param {SyntaxNode} versionValue
 * @param {Definition} d
 * @param {Ctx} ctx
 */
function atLink(src, nameValue, versionValue, d, ctx) {
  const body = Docs.bodyOf(nameValue);
  const [name] = body ? Docs.pinned(src, body) : [null];
  const written = Docs.text(src, versionValue);
  const pin = /^[+-]?[0-9]+$/.test(written) ? Number(written) : null;
  return { child: nameValue, html: link(Docs.text(src, nameValue), name, pin, d, ctx) };
}

/**
 * `written`, naming `name` pinned to `pin` (or null), as a link to that
 * definition -- to that version of it when it has one -- or as a name.
 * @param {string} written
 * @param {string | null} name
 * @param {number | null} pin
 * @param {Definition} d
 * @param {Ctx} ctx
 */
function link(written, name, pin, d, ctx) {
  const target = name === null ? undefined : ctx.known.get(Docs.resolve(name, d.scope));
  if (!target) return `<span class="sym">${escape(written)}</span>`;
  const at = pin !== null && target.versions.some((v) => v.version === pin) ? `${pageOf(target.namespace)}#${versionAnchor(target, pin)}` : href(target);
  return `<a class="ref" href="${at}">${escape(written)}</a>`;
}

/** A head's base, written with the version it pins. @param {string} name @param {number | null} pin @param {Definition} d @param {Ctx} ctx */
function nameLink(name, pin, d, ctx) {
  return link(pin === null ? name : `${name}(${pin})`, name, pin, d, ctx);
}

/** Whether there is trivia between the token at `i` and the next. @param {import('../docs.cjs').Src} src @param {number} i */
function gap(src, i) {
  const next = src.tokens[i + 1];
  return next !== undefined && src.source.slice(src.tokens[i].end, next.start) !== '';
}

/**
 * `{:case field %{value => type, ...}}`: the type chosen by a field's
 * value, as a table from value to type.
 * @param {import('../docs.cjs').Src} src
 * @param {SyntaxNode} field
 * @param {SyntaxNode} table
 * @param {Definition} d
 * @param {Ctx} ctx
 */
function caseHtml(src, field, table, d, ctx) {
  const map = Docs.bodyOf(table);
  let rows = '';
  if (map && map.kind === 'map') {
    for (const entry of map.children.filter((c) => c.kind === 'entry')) {
      const keyNode = entry.children.find((c) => c.kind === 'value');
      const key = entry.key !== undefined ? escape(Docs.tokenText(src, entry.key)) : keyNode ? render(src, keyNode, d, ctx) : '';
      const value = Docs.valueOf(entry);
      rows += `<tr><td>${key.trim()}</td><td>${typeHtml(value ? { src, node: value } : null, d, ctx)}</td></tr>`;
    }
  }
  return (
    `<span class="case">by <span class="case-field">${escape(Docs.text(src, field))}` +
    `</span><span class="case-table"><span class="case-rows"><table><tbody>${rows}</tbody></table></span></span></span>`
  );
}

module.exports = { pages };
