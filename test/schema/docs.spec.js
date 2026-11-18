import { expect } from 'chai';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { SchemaDocs } from '../../src/dextrin.js';

// `SchemaDocs` and `dextrin docs`, as dextrin's `Dextrin.Schema.Docs`
// (Jan, 2026-10-20). The example is the reference's, and so is its
// generated `doc/`: every implementation must write it byte for byte.

/** Every file under `dir`, by its path relative to `dir`. @param {string} dir */
function filesUnder(dir) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(relative(dir, path), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

/** The site for `files`, by page path. @param {{[path: string]: string}} files */
function site(files) {
  const root = mkdtempSync(join(tmpdir(), 'dextrin-docs-'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return new Map(SchemaDocs.site(root, { title: 'T' }));
}

describe('SchemaDocs', () => {
  it('a page names no tool in its markup', () => {
    const pages = site({ 'a.dxns': '%{T: :string}' });
    for (const html of pages.values()) expect(html).not.to.match(/claude/i);
  });

  it('writes the example exactly as the reference does', () => {
    const expected = filesUnder('example/doc');
    const made = new Map(SchemaDocs.site('example/schemas', { title: 'Acme schemas' }));
    expect([...made.keys()].sort()).to.deep.equal([...expected.keys()].sort());
    for (const [path, content] of expected) expect(made.get(path), path).to.equal(content);
  });

  it('gives every directory of the site its own index.html', () => {
    const pages = site({ 'a.b.c.dxns': '%{T: :string}', 'x/y/Z-v1.dxns': '%{Z: %schema{v: :integer}}' });
    for (const path of pages.keys()) {
      const dir = dirname(path);
      expect(pages.has(dir === '.' ? 'index.html' : `${dir}/index.html`), dir).to.equal(true);
    }
  });

  it('refuses a document that is not a map, naming its file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dextrin-docs-bad-'));
    writeFileSync(join(root, 'bad.dxns'), '[1 2]');
    expect(() => SchemaDocs.site(root)).to.throw(/bad\.dxns/);
  });

  // As dextrin 053432a.
  describe('annotations, {:doc T %{...}} (DXNS.md §1b)', () => {
    const annotated = `%{
  Order: {:doc %schema(2){
    id: :integer
    email: {:doc :string %{description: "Where *receipts* go", read-only: true}}
    legacy?: {:doc :string %{deprecated: "use email"}}
  } %{title: "An order", description: "One checkout.", examples: [%Order(2){id: 1, email: "a@b"}]}}

  Port: {:doc {:refine :integer %{min: 1}} %{deprecated: true, meta: %{"acme.owner" => "net"}}}
}
`;

    /** The page holding the definition whose anchor is `id`. @param {Map<string, string>} pages @param {string} id */
    const pageWith = (pages, id) => [...pages.values()].find((page) => page.includes(`id="${id}"`)) ?? '';

    it('an annotated schema is still a schema, its fields still fields', () => {
      const html = pageWith(site({ 'shop.dxns': annotated }), 'Order');
      expect(html).to.include('struct schema');
      expect(html).to.include('<code>email</code>');
      expect(html).not.to.include('{:doc');
    });

    it('a title, a description, examples and meta are shown with the definition', () => {
      const html = pageWith(site({ 'shop.dxns': annotated }), 'Order');
      expect(html).to.include('An order');
      expect(html).to.include('One checkout.');
      expect(html).to.include('Examples');
      expect(html).to.include('a@b');
      expect(html).to.include('acme.owner');
    });

    it("deprecated, read-only and write-only are chips; a field's description is its note", () => {
      const html = pageWith(site({ 'shop.dxns': annotated }), 'Order');
      expect(html).to.include('class="chip chip-deprecated"');
      expect(html).to.include('use email');
      expect(html).to.include('class="chip chip-read-only"');
      expect(html).to.include('<em>receipts</em>');
    });

    it("an enum's values are listed with their own notes", () => {
      const pages = site({
        'c.dxns': '%{Color: {:doc {:enum :red :old} %{values: %{:old => %{deprecated: true, description: "Use red"}}}}}'
      });
      const html = pageWith(pages, 'Color');
      expect(html).to.include('<dl class="values">');
      expect(html).to.include('Use red');
      expect(html).to.include('<code>:old</code><span class="chip chip-deprecated">');
    });
  });

  // As dextrin T696 (2026-11-18): everything DXNS gained since the
  // generator was written is shown.
  describe('what DXNS gained since 2026-10-20', () => {
    /** The page holding the element whose id is `id`. @param {Map<string, string>} pages @param {string} id */
    const pageWith = (pages, id) => [...pages.values()].find((page) => page.includes(`id="${id}"`)) ?? '';

    it("a named type's versions are shown as a schema's are, latest first", () => {
      const pages = site({
        'a/Tier.dxns': '%{Tier: {:enum :bronze :silver}}',
        'a/Tier-v2.dxns': '%{Tier: %type(2)[{:enum :bronze :silver :gold}]}'
      });
      const html = pageWith(pages, 'Tier');
      expect(html).to.include('<span class="chip chip-version" id="Tier-v2">v2</span>');
      expect(html).to.include('<details class="older" id="Tier-v1">');
      expect(html).to.include(':gold');
      expect(html).not.to.include('%type');
    });

    it('a pinned reference links to the version it pins, in either spelling', () => {
      const pages = site({
        'a/Tier.dxns': '%{Tier: {:enum :bronze}}',
        'a/Tier-v2.dxns': '%{Tier: %type(2)[{:enum :bronze :gold}]}',
        'a.dxns': '%{C: %shape{t: a/Tier(1) u: {:at a/Tier 2}}}'
      });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<a class="ref" href="../a/index.html#Tier-v1">a/Tier(1)</a>');
      expect(html).to.include('<a class="ref" href="../a/index.html#Tier-v2">');
      expect(pageWith(pages, 'Tier')).to.include('Used by');
    });

    it("a head's bases are links, and a dropped field and the extras are rows", () => {
      const pages = site({
        'a.dxns': `%{
  P: %shape{name: :string nick: :string}
  C: %schema(1) includes P {
    - nick
    id: :uuid
    * :string => :integer
    - *
  }
}
`
      });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<p class="bases">includes <a class="ref" href="../a/index.html#P">P</a></p>');
      expect(html).to.include('<tr class="dropped">');
      expect(html).to.include('<s>nick</s>');
      expect(html).to.include('<code>* <span class="kw">:string</span></code>');
      expect(html).to.include('<tr class="closed">');
    });

    it('a comment on a left-out field, the extras or the closing is its note', () => {
      const pages = site({
        'a.dxns': `%{
  P: %shape{a: :string nick: :string}
  C: %shape includes P {
    # why nick goes
    - nick
    # about id
    id: :uuid
    * :string => :integer # about the rest
    - * # nothing else
  }
}
`
      });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<td class="notes">left out of the bases<p>why nick goes</p></td>');
      expect(html).to.include('<td class="notes"><p>about id</p></td>');
      expect(html).to.include('<td class="notes">any other entry with such a key<p>about the rest</p></td>');
      expect(html).to.include('<td class="notes">no entries beyond these<p>nothing else</p></td>');
    });

    it('a deprecated version is struck through, with its reason', () => {
      const pages = site({
        'a/C-v1.dxns': '%{C: {:doc %schema{a: :string} %{deprecated: "use 2"}}}',
        'a/C-v2.dxns': '%{C: %schema(2){a: :string b?: {:doc :string %{deprecated: true}}}}'
      });
      const html = pageWith(pages, 'C');
      expect(html).to.include('<summary><s>Version 1</s> <span class="chip chip-deprecated" title="use 2">deprecated: use 2</span>');
      expect(html).to.include('<code><s>b</s></code>');
    });

    it("a generic's parameters are listed with their bounds and defaults", () => {
      const pages = site({ 'a.dxns': '%{Page: {:generic [T {S :integer :int32}] %shape{items: {:list-of T}}}}' });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<span class="chip chip-type">generic type</span>');
      expect(html).to.include('<dl class="params">');
      expect(html).to.include(
        '<dt><code>S</code></dt><dd>within <code><span class="kw">:integer</span></code>, default <code><span class="kw">:int32</span></code></dd>'
      );
      expect(html).not.to.include(':generic');
    });

    it("a generic in a versioned file takes the file's version", () => {
      const pages = site({
        'a/Page.dxns': '%{Page: {:generic [T] {:list-of T}}}',
        'a/Page-v2.dxns': '%{Page: {:generic [T] %shape{items: {:list-of T}}}}'
      });
      const html = pageWith(pages, 'Page');
      expect(html).to.include('<span class="chip chip-version" id="Page-v2">v2</span>');
      expect(html).to.include('<details class="older" id="Page-v1">');
    });

    it('discriminator, secret, key, visibility and messages are shown', () => {
      const pages = site({
        'a.dxns': `%{
  P: {:doc {:one-of A B} %{discriminator: :kind}}
  A: %shape{kind: {:const "a"}}
  B: %shape{kind: {:const "b"}}
  S: %shape{
    id: {:doc :string %{key: true}}
    token: {:doc :string %{secret: true visibility: [:create :read]}}
    code: {:doc {:refine :string %{min-length: 2}} %{messages: %{min-length: "too short"}}}
  }
}
`
      });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<span class="chip chip-discriminator">discriminator: kind</span>');
      expect(html).to.include('<span class="chip chip-key">key</span>');
      expect(html).to.include('<span class="chip chip-secret">secret</span>');
      expect(html).to.include('<span class="chip chip-visibility">visible on create, read</span>');
      expect(html).to.include('<dl class="messages">');
      expect(html).to.include('too short');
    });

    it('a computed default is shown as one', () => {
      const pages = site({ 'a.dxns': '%{S: %schema{at: %field{type: :timestamp computed: :now}}}' });
      expect(pages.get('a/index.html')).to.include('<span class="label">computed</span> <code><span class="kw">:now</span></code>');
    });

    it('a generated file says what generated it, and that is not its prose', () => {
      const pages = site({ 'a.dxns': '# Generated by some-tool from a.tsp; do not edit.\n\n# About a.\n\n%{T: :string}' });
      const html = pages.get('a/index.html') ?? '';
      expect(html).to.include('<span class="provenance">generated by <code>some-tool</code> from <code>a.tsp</code></span>');
      expect(html).to.include('About a.');
      expect(html).not.to.include('do not edit');
    });
  });
});
