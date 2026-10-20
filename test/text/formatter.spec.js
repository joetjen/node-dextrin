import { expect } from 'chai';
import { pretty } from '../../src/text/formatter.cjs';
import { print } from '../../src/text/printer.cjs';
import { parse } from '../../src/text/parser.cjs';

describe('text/formatter', () => {
  it('renders an empty collection on one line, unchanged from the printer', () => {
    expect(pretty(parse('[]'))).to.equal('[]');
    expect(pretty(parse('{}'))).to.equal('{}');
    expect(pretty(parse('@{}'))).to.equal('@{}');
    expect(pretty(parse('%{}'))).to.equal('%{}');
    expect(pretty(parse('@array[]'))).to.equal('@array[]');
    expect(pretty(parse('@ordered %{}'))).to.equal('@ordered %{}');
  });

  it('renders a scalar unchanged from the printer', () => {
    expect(pretty(42n)).to.equal(print(42n));
    expect(pretty('hi')).to.equal(print('hi'));
  });

  it('renders one entry per line, indented one level deeper', () => {
    const out = pretty(parse('%{x: 1, y: 2}'), {});
    expect(out).to.equal('%{\n  x: 1\n  y: 2\n}');
  });

  // `width: 1` breaks every nested collection, so the indentation shows.
  it('nests indentation correctly for nested collections', () => {
    const out = pretty(parse('[1 [2 3]]'), { width: 1 });
    expect(out).to.equal('[\n  1\n  [\n    2\n    3\n  ]\n]');
  });

  it('honors a custom indent width', () => {
    const out = pretty(parse('[1 2]'), { indent: 4 });
    expect(out).to.equal('[\n    1\n    2\n]');
  });

  it('renders @ordered/@sorted-set/@array with their tag prefix on the opening line', () => {
    expect(pretty(parse('@ordered %{a: 1}'))).to.equal('@ordered %{\n  a: 1\n}');
    expect(pretty(parse('@sorted-set @{2 1}'))).to.equal('@sorted-set @{\n  1\n  2\n}');
    expect(pretty(parse('@array[1 2]'))).to.equal('@array[\n  1\n  2\n]');
  });

  it('renders a keyed struct with its name attached to the opening brace', () => {
    expect(pretty(parse('%Point{x: 1, y: 2}'))).to.equal('%Point{\n  x: 1\n  y: 2\n}');
  });

  it('produces a value that decodes back to the same thing as the single-line form', () => {
    const src =
      '%{id: @uuid "550e8400-e29b-41d4-a716-446655440000", tags: @{:admin :staff}, meta: @ordered %{created: ~U[1990-01-01 00:00:00Z]}, result: {:ok, 200}}';
    const val = parse(src);
    expect(print(parse(pretty(val)))).to.equal(print(val));
  });

  it('falls back to a quoted arrow entry for a non-identifier key, matching the printer', () => {
    const val = parse('%{:"has space" => 1}', { trusted: false });
    expect(pretty(val)).to.equal('%{\n  :"has space" => 1\n}');
  });

  it('renders a genuine string map key as a quoted arrow entry, not keyword shorthand', () => {
    // Regression: renderEntry() used to treat *any* plain string key as
    // keyword-shaped (`typeof key === 'string' ? key : ...`), which
    // only holds for a DXNStruct's own field-name pairs -- a Map entry
    // whose key happens to be a plain string (e.g. a schema-typed
    // struct materialized with no custom materializer) is a genuine
    // `string` key and must stay distinguishable from a same-text
    // `keyword` key, matching printer.cjs's own keywordEntryName rule.
    const val = new Map([['id', 1n]]);
    expect(pretty(val)).to.equal('%{\n  "id" => 1\n}');
    expect(print(parse(pretty(val)))).to.equal(print(val));
  });

  it('still renders a DXNStruct field name with colon shorthand, unaffected by the string-key fix', () => {
    expect(pretty(parse('%Point{id: 1}'))).to.equal('%Point{\n  id: 1\n}');
  });

  // Jan, 2026-10-20: the top-level collection always breaks, one entry
  // per line; a nested one stays on one line when that line fits the
  // width (80, `width`), its entries single-space separated.
  describe('layout: a nested collection that fits stays on one line', () => {
    it('breaks the top level however short it is', () => {
      expect(pretty(parse('[1 2]'))).to.equal('[\n  1\n  2\n]');
      expect(pretty(parse('%{a: 1}'))).to.equal('%{\n  a: 1\n}');
    });

    it('writes a nested collection that fits on one line', () => {
      expect(pretty(parse('[[1 2] {3 "a"}]'))).to.equal('[\n  [1 2]\n  {3 "a"}\n]');
      expect(pretty(parse('%{a: %{b: @array[1]}}'))).to.equal('%{\n  a: %{b: @array[1]}\n}');
      expect(pretty(parse('[@ordered %{y: 2 x: 1}]'))).to.equal('[\n  @ordered %{y: 2 x: 1}\n]');
      expect(pretty(parse('[%P{q: 1 r: "s"}]'))).to.equal('[\n  %P{q: 1 r: "s"}\n]');
      expect(pretty(parse('[%P[1 2]]'))).to.equal('[\n  %P[1 2]\n]');
    });

    it('counts the indent and the key on the line it fits on', () => {
      // "  key: [1 2 3]" is 14 columns.
      expect(pretty(parse('%{key: [1 2 3]}'), { width: 14 })).to.equal('%{\n  key: [1 2 3]\n}');
      expect(pretty(parse('%{key: [1 2 3]}'), { width: 13 })).to.equal('%{\n  key: [\n    1\n    2\n    3\n  ]\n}');
    });

    it('breaks one that does not fit, and lays out what it holds again', () => {
      const long = 'x'.repeat(40);
      expect(pretty(parse(`[[[1 2] "${long}" "${long}"]]`))).to.equal(
        `[\n  [\n    [1 2]\n    "${long}"\n    "${long}"\n  ]\n]`
      );
    });

    it('fits in 80 columns unless given a width', () => {
      // '  ["' and '"]' leave 74 columns of 80 for the string.
      const fits = 'x'.repeat(74);
      expect(pretty(parse(`[["${fits}"]]`))).to.equal(`[\n  ["${fits}"]\n]`);
      const over = 'x'.repeat(75);
      expect(pretty(parse(`[["${over}"]]`))).to.equal(`[\n  [\n    "${over}"\n  ]\n]`);
    });
  });
});
