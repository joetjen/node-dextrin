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
    const refs = [...new Set(typesOf(d).flatMap((t) => Docs.references(t, d.scope)))].filter((r) => r !== d.name);
    for (const r of refs) {
      const key = `${r}\u0000${d.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.set(r, [...(out.get(r) ?? []), d.name]);
    }
  }
  return out;
}

/** @param {Definition} d @returns {Array<At | null>} */
function typesOf(d) {
  if (d.kind === 'type') return d.versions.map((v) => v.value);
  return d.versions.flatMap((v) => v.fields.map((f) => f.type));
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
    <h2><a class="self" href="#${escape(anchor(d))}"><code>${escape(d.short)}</code></a></h2>
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
  return [prose(described(notes), d, ctx), prose(d.doc, d, ctx), values(notes, d, ctx), examples(notes), meta(notes)]
    .filter((part) => part !== '')
    .join('\n  ');
}

/** A doc's description, `null` without one. @param {import('../docs.cjs').Notes} notes @returns {string | null} */
function described(notes) {
  return typeof notes.description === 'string' ? notes.description : null;
}

/** Deprecated (with its reason), read-only and write-only, as chips. @param {import('../docs.cjs').Notes} notes */
function annotationChips(notes) {
  const reason = notes.deprecated;
  let deprecated = '';
  if (reason === true) deprecated = '<span class="chip chip-deprecated">deprecated</span>';
  else if (typeof reason === 'string') deprecated = `<span class="chip chip-deprecated" title="${escape(reason)}">deprecated: ${escape(reason)}</span>`;
  const flags = ['read-only', 'write-only']
    .filter((key) => notes[key] === true)
    .map((key) => `<span class="chip chip-${key}">${key}</span>`)
    .join('');
  return deprecated + flags;
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
  if (d.kind !== 'schema') return '';
  const [latest, ...older] = d.versions;
  return `<span class="chip chip-version">v${latest.version}</span>` + (older.length === 0 ? '' : `<span class="chip chip-quiet">${older.length + 1} versions</span>`);
}

/** @param {Definition} d @param {import('../docs.cjs').Version} version @param {Ctx} ctx */
function olderVersion(d, version, ctx) {
  return `<details class="older">
  <summary>Version ${version.version} <span class="file">${escape(version.file)}</span></summary>
  ${versionBody(d, version, ctx)}
</details>
`;
}

/** @param {Definition} d @param {import('../docs.cjs').Version} version @param {Ctx} ctx */
function versionBody(d, version, ctx) {
  if (d.kind === 'type') {
    return `<div class="type-def">
  <p class="label">Definition</p>
  <pre class="expr"><code>${typeHtml(version.value, d, ctx)}</code></pre>
  <p class="file">${escape(version.file)}</p>
</div>
`;
  }
  const note = version.note && version.note !== '' ? `<div class="prose version-note">${toHtml(version.note, linker(d.scope, ctx))}</div>` : '';
  const positionHead = d.kind === 'schema' ? '<th scope="col" class="pos" title="Position in the binary form">#</th>' : '';
  const rows = version.fields
    .map((f) => {
      const notesHtml =
        annotationChips(f.annotations) +
        [described(f.annotations), f.description, f.doc]
          .filter((t) => t !== null && t !== '')
          .map((t) => toHtml(/** @type {string} */ (t), linker(d.scope, ctx)))
          .join('') +
        values(f.annotations, d, ctx) +
        examples(f.annotations) +
        meta(f.annotations);
      const def = f.default ? `<div class="default"><span class="label">default</span> <code>${typeHtml(f.default, d, ctx)}</code></div>` : '';
      return `<tr>
  ${d.kind === 'schema' ? `<td class="pos">${f.position}</td>` : ''}
  <th scope="row" class="field"><code>${escape(f.name)}</code>${f.optional ? '<span class="opt">optional</span>' : ''}</th>
  <td class="type"><code>${typeHtml(f.type, d, ctx)}</code>${def}</td>
  <td class="notes">${notesHtml}</td>
</tr>
`;
    })
    .join('');
  return `${note}
<div class="table-wrap">
  <table class="fields">
    <thead><tr>${positionHead}<th scope="col">Field</th><th scope="col">Type</th><th scope="col">Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<p class="file">${escape(version.file)}</p>
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
  if (Docs.isSymbol(src, node)) {
    const written = Docs.text(src, node);
    const target = ctx.known.get(Docs.resolve(written, d.scope));
    return target ? `<a class="ref" href="${href(target)}">${escape(written)}</a>` : `<span class="sym">${escape(written)}</span>`;
  }
  if (node.kind === 'body' && node.children.length === 0 && node.first === node.last) {
    const type = src.tokens[node.first].type;
    if (type === 'KEYWORD') return `<span class="kw">${escape(Docs.text(src, node))}</span>`;
    if (type === 'STRING') return `<span class="str">${escape(Docs.text(src, node))}</span>`;
  }
  if (node.kind === 'tuple') {
    const values = node.children.filter((c) => c.kind === 'value');
    if (values.length === 3 && Docs.text(src, values[0]) === ':case') return caseHtml(src, values[1], values[2], d, ctx);
  }
  // Its tokens and its children in order, each piece the tokens it
  // covers, joined by a space wherever the source has a gap.
  /** @type {Array<{last: number, html: string}>} */
  const pieces = [];
  let i = node.first;
  for (const child of node.children) {
    for (; i < child.first; i += 1) pieces.push({ last: i, html: escape(Docs.tokenText(src, i)) });
    pieces.push({ last: child.last, html: render(src, child, d, ctx) });
    i = child.last + 1;
  }
  for (; i <= node.last; i += 1) pieces.push({ last: i, html: escape(Docs.tokenText(src, i)) });
  return pieces.map((p, k) => (k > 0 && gap(src, pieces[k - 1].last) ? ' ' : '') + p.html).join('');
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
