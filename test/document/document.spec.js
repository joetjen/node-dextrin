import { expect } from 'chai';
import fc from 'fast-check';
import { decode, encode, Document, Registry, Schema } from '../../src/dextrin.js';
import { dxnEquals } from '../../src/values/equality.js';
import DXNList from '../../src/values/list.js';
import { dxnValue as valueOf } from '../support/dxn-value.arbitrary.js';

const dxnValue = valueOf(2);

// Phase C of `dextrin`'s design/implementation-plan.md, mirroring
// `Dextrin.Document`: a document keeps every comment, blank line and
// comma, renders back byte for byte when untouched, and its value is
// decode's. Edits change exactly what they name; update makes a new
// value by them; format lays a document out and keeps its comments.

const COMMENTED = `# A leading comment, above everything.
# Two lines of it.

%{
  # Above an entry.
  name: "acme"        # Trailing, same line.
  version:  # between a key and its value
    "1.0.0"
  deps: [
    # Pinned until upstream fixes #431.
    "left-pad", # temporary
    "right-pad"
    # nothing follows this
  ]
  price: @uuid  # and between a tag and its value
    "00000000-0000-0000-0000-000000000000"
}
# A trailing comment, below everything.
`;

const DEPS = '%{\n  deps: [\n    # Pinned until upstream fixes #431.\n    "left-pad"  # temporary\n    "right-pad"\n  ]\n}\n';

/** Every line of `text` with a numbered comment after it. @param {string} text */
const commented = (text) =>
  text
    .split('\n')
    .map((line, i) => `${line}  # c${i}`)
    .join('\n');

/**
 * `value` pretty-printed, or null when it has no text form -- the
 * generator makes symbols with any name, and text writes only
 * identifiers.
 * @param {unknown} value
 */
const prettyOrNull = (value) => {
  try {
    return encode(value, { pretty: true });
  } catch {
    return null;
  }
};

/** @param {string} text */
const commentsOf = (text) => (text.match(/# c\d+/g) ?? []).sort();

describe('Document', () => {
  describe('an untouched document', () => {
    it('renders back byte for byte', () => {
      expect(Document.render(Document.parse(COMMENTED))).to.equal(COMMENTED);
    });

    it("and its value is decode's", () => {
      expect(dxnEquals(Document.toValue(Document.parse(COMMENTED)), decode(COMMENTED))).to.equal(true);
    });

    it("so do decode's options and schemas", () => {
      const registry = Schema.compile(decode('%{User: %schema(2){name: :string}}'), new Registry());
      const doc = Document.parse('%User{name: "a"} # the user', { registry });
      expect(encode(Document.toValue(doc), { registry })).to.equal('%User(2){name:"a"}');
    });

    it('is refused the way decode refuses it', () => {
      expect(() => Document.parse('[1 2')).to.throw().with.property('category', 'syntax');
    });

    it("any document renders back byte for byte, and its value is decode's", () => {
      fc.assert(
        fc.property(dxnValue, (value) => {
          const pretty = prettyOrNull(value);
          if (pretty === null) return;
          const text = commented(pretty);
          let decoded;
          try {
            decoded = decode(text, { trusted: false });
          } catch {
            return;
          }
          const doc = Document.parse(text, { trusted: false });
          expect(Document.render(doc)).to.equal(text);
          expect(dxnEquals(Document.toValue(doc), decoded)).to.equal(true);
        })
      );
    });
  });

  describe('edits', () => {
    it('a replaced value keeps the comment beside it', () => {
      const doc = Document.parse('%{\n  version: "1.0.0" # bumped for the fix\n}\n');
      expect(Document.render(Document.replace(doc, [Symbol.for('version')], '2.0.0'))).to.equal(
        '%{\n  version: "2.0.0" # bumped for the fix\n}\n'
      );
    });

    it('a deleted entry takes its above block and its trailing block', () => {
      expect(Document.render(Document.delete(Document.parse(DEPS), [Symbol.for('deps'), 0]))).to.equal(
        '%{\n  deps: [\n    "right-pad"\n  ]\n}\n'
      );
    });

    it('an inserted item goes before the comment above the end', () => {
      const doc = Document.parse('[\n  "a"\n  # nothing follows this\n]\n');
      expect(Document.render(Document.insert(doc, [], -1, 'b'))).to.equal('[\n  "a"\n  "b"\n  # nothing follows this\n]\n');
    });

    it('a path that leads nowhere is refused', () => {
      expect(() => Document.delete(Document.parse('%{a: 1}'), [Symbol.for('nope')])).to.throw().with.property('category', 'document/not-found');
    });

    it('a struct field is named by its string', () => {
      expect(Document.render(Document.replace(Document.parse('%P{x: 1, y: 2}'), ['y'], 3n))).to.equal('%P{x: 1, y: 3}');
    });

    it('replace, delete and insert each make the value they say', () => {
      fc.assert(
        fc.property(fc.array(dxnValue, { minLength: 1, maxLength: 5 }), fc.nat(), dxnValue, (items, pick, value) => {
          const pretty = prettyOrNull(new DXNList(items));
          if (pretty === null || prettyOrNull(value) === null) return;
          const text = commented(pretty);
          let doc;
          try {
            doc = Document.parse(text, { trusted: false });
          } catch {
            return;
          }
          const original = /** @type {DXNList} */ (Document.toValue(doc)).items;
          const at = pick % original.length;
          const expected = (/** @type {unknown[]} */ list) => new DXNList(list);

          const replaced = original.slice();
          replaced[at] = value;
          expect(dxnEquals(Document.toValue(Document.replace(doc, [at], value)), expected(replaced))).to.equal(true);

          const removed = original.filter((_, i) => i !== at);
          expect(dxnEquals(Document.toValue(Document.delete(doc, [at])), expected(removed))).to.equal(true);

          const added = [...original.slice(0, at), value, ...original.slice(at)];
          expect(dxnEquals(Document.toValue(Document.insert(doc, [], at, value)), expected(added))).to.equal(true);
        })
      );
    });
  });

  describe('update', () => {
    it('an equal value changes nothing, however it is written', () => {
      const text = '%{a: 1.50M, b: [1   2]} # c\n';
      const { doc, changes } = Document.update(Document.parse(text), decode('%{a: 1.50M, b: [1 2]}'));
      expect(changes).to.deep.equal([]);
      expect(Document.render(doc)).to.equal(text);
    });

    it('is refused by default where a deleted item owns a comment', () => {
      expect(() => Document.update(Document.parse(DEPS), decode('%{deps: ["other-pad" "right-pad"]}')))
        .to.throw()
        .with.property('category', 'document/ambiguous');
    });

    it('and reads a replace when told to guess, keeping the comment', () => {
      const { doc } = Document.update(Document.parse(DEPS), decode('%{deps: ["other-pad" "right-pad"]}'), { onAmbiguity: 'guess' });
      expect(Document.render(doc)).to.include('"other-pad"  # temporary');
    });

    it('the updated document holds the new value', () => {
      fc.assert(
        fc.property(dxnValue, dxnValue, (old, now) => {
          const pretty = prettyOrNull(old);
          if (pretty === null || prettyOrNull(now) === null) return;
          let doc;
          try {
            doc = Document.parse(commented(pretty), { trusted: false });
          } catch {
            return;
          }
          expect(Document.update(doc, Document.toValue(doc)).changes).to.deep.equal([]);
          const read = decode(encode(now), { trusted: false });
          expect(dxnEquals(Document.toValue(Document.update(doc, read, { onAmbiguity: 'guess' }).doc), read)).to.equal(true);
        })
      );
    });
  });

  describe('format', () => {
    // Jan, 2026-10-20: a nested collection that fits goes on one line, as
    // the pretty printer writes it -- unless it holds a comment or a blank
    // line, which keep it over lines.
    describe('layout', () => {
      const formatted = (/** @type {string} */ text, opts = {}) => Document.format(Document.parse(text), opts);

      it('writes a nested collection that fits on one line', () => {
        expect(formatted('%{deps: ["a" "b"], at: %{x: 1, y: 2}}')).to.equal('%{\n  deps: ["a" "b"]\n  at: %{x: 1 y: 2}\n}');
      });

      // A regex's flags are its tag's header (DXN.md §1.2): written
      // against the tag, as `%Name(3)` is.
      it("writes a regex's header against its tag", () => {
        expect(formatted('%{a: @regex(im) "x", b: @regex (i) "y"}')).to.equal('%{\n  a: @regex(im) "x"\n  b: @regex(i) "y"\n}');
      });

      it('breaks the top level however short it is', () => {
        expect(formatted('[1]')).to.equal('[\n  1\n]');
      });

      it('keeps one holding a comment over lines', () => {
        expect(formatted('%{deps: ["a" # why\n]}')).to.equal('%{\n  deps: [\n    "a"  # why\n  ]\n}');
      });

      it('and one with a blank line between its entries', () => {
        expect(formatted('%{deps: ["a"\n\n"b"]}')).to.equal('%{\n  deps: [\n    "a"\n\n    "b"\n  ]\n}');
      });

      it('counts the indent and the key in the width', () => {
        expect(formatted('%{key: [1 2 3]}', { width: 14 })).to.equal('%{\n  key: [1 2 3]\n}');
        expect(formatted('%{key: [1 2 3]}', { width: 13 })).to.equal('%{\n  key: [\n    1\n    2\n    3\n  ]\n}');
      });
    });

    it('lays a document out and keeps its comments', () => {
      const text = '# top\n\n%{name: "acme", # the name\n deps: ["a" # temporary\n# still about a\n "b"\n\n# pinned\n "c"\n# nothing follows\n], empty: [], v: 1.50M}\n# the end\n';
      expect(Document.format(Document.parse(text))).to.equal(
        '# top\n\n%{\n  name: "acme"  # the name\n  deps: [\n    "a"  # temporary\n         # still about a\n    "b"\n\n    # pinned\n    "c"\n    # nothing follows\n  ]\n  empty: []\n  v: 1.50M\n}\n# the end\n'
      );
    });

    // The header is `@dxn` and its version, one space between them,
    // however they were spaced.
    it('keeps one space between the header tag and its version', () => {
      expect(Document.format(Document.parse('@dxn   "1.0"\n[1]'))).to.equal('@dxn "1.0"\n[\n  1\n]');
    });

    // A formatter run on save must not take a file's last newline away;
    // one the source did not end with, it does not add.
    it('ends with a newline exactly when the source did', () => {
      expect(Document.format(Document.parse('%{a: 1}\n'))).to.equal('%{\n  a: 1\n}\n');
      expect(Document.format(Document.parse('%{a: 1}'))).to.equal('%{\n  a: 1\n}');
    });

    it('a document with no comments comes out as the pretty printer writes its value', () => {
      fc.assert(
        fc.property(dxnValue, (value) => {
          const pretty = prettyOrNull(value);
          if (pretty === null) return;
          expect(Document.format(Document.parse(pretty, { trusted: false }))).to.equal(pretty);
        })
      );
    });

    it('a commented one keeps its value and every comment, and formats the same again', () => {
      fc.assert(
        fc.property(dxnValue, (value) => {
          const pretty = prettyOrNull(value);
          if (pretty === null) return;
          const text = commented(pretty);
          let doc;
          try {
            doc = Document.parse(text, { trusted: false });
          } catch {
            return;
          }
          const once = Document.format(doc);
          const again = Document.parse(once, { trusted: false });
          expect(dxnEquals(Document.toValue(again), Document.toValue(doc))).to.equal(true);
          expect(commentsOf(once)).to.deep.equal(commentsOf(text));
          expect(Document.format(again)).to.equal(once);
        })
      );
    });
  });
});
