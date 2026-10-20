import { expect } from 'chai';
import { decode, decodeBinary, encodeBinary, Registry, Schema } from '../../src/dextrin.js';

// What the ports' cross-check found in the reference, as dextrin a56339b
// (2026-10-20): NaN and the infinities as bounds, `$` before a final
// newline, a crash in `host-port`, hostname lengths in graphemes, an
// unknown type in `inspect`'s words -- and a trusted decode reading six
// keywords as the values whose atoms they share. Each is held here too,
// whether or not this port ever had the defect.
describe('schema: the reference cross-check fixes', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /** Whether `value` is a `type`; only a schema refusal answers false. @param {string} type @param {unknown} value */
  const takes = (type, value) => {
    const registry = compiled(type);
    try {
      return Schema.check(value, registry, 'T');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  /** The message a compile refuses `type` with. @param {string} type @returns {string} */
  const compileError = (type) => {
    try {
      compiled(type);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {any} */ (err).message;
    }
    throw new Error(`${type} compiled`);
  };

  it('NaN and the infinities are numbers in a schema, bounds like any other', () => {
    expect(() => compiled('{:refine :float %{max: Infinity}}')).not.to.throw();
    expect(takes('{:refine :float %{min: -Infinity}}', 1.0)).to.equal(true);
    expect(takes('{:refine :float %{min: NaN}}', 1.0)).to.equal(false);
    expect(takes('{:enum NaN}', NaN)).to.equal(true);
  });

  it("a grammar's end is the string's end: a final newline is refused", () => {
    // A json-pointer's tokens may hold a newline, so it is no example.
    /** @type {{[format: string]: string}} */
    const good = {
      hostname: 'example.com',
      semver: '1.2.3',
      mac: '00:1a:2b:3c:4d:5e',
      uri: 'https://example.com',
      email: 'a@example.com',
      'uri-template': '/{id}',
      'host-port': 'a:80'
    };
    for (const [format, text] of Object.entries(good)) {
      expect(takes(`{:refine :string %{format: :${format}}}`, text), format).to.equal(true);
      expect(takes(`{:refine :string %{format: :${format}}}`, `${text}\n`), format).to.equal(false);
    }
  });

  it('dates and times read no final newline either', () => {
    for (const [format, text] of [
      ['date', '2026-10-20'],
      ['time', '12:00:00'],
      ['datetime', '2026-10-20T12:00:00Z'],
      ['local-datetime', '2026-10-20T12:00:00'],
      ['duration', 'P1D']
    ]) {
      expect(takes(`{:refine :string %{format: :${format}}}`, `${text}\n`), format).to.equal(false);
      expect(() => decode(`@${format} "${text}\\n"`), format).to.throw();
    }
  });

  it('an offset and a media type in a schema end where the string does', () => {
    expect(() => compiled('{:refine :datetime %{offsets: ["Z\\n"]}}')).to.throw();
    expect(() => compiled('{:refine :datetime %{offsets: ["+01:00\\n"]}}')).to.throw();
    expect(() => compiled('{:refine :string %{media-type: "a/b\\n"}}')).to.throw();
  });

  it("a hostname's 253 are codepoints", () => {
    const label = 'é'.repeat(31);
    const name = `${Array(4).fill(label).join('.')}.ab`;
    const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(name)].length;
    expect(graphemes <= 253 && [...name].length > 253).to.equal(true);
    expect(takes('{:refine :string %{format: :idn-hostname}}', name)).to.equal(false);
  });

  it('an unknown type is written in DXN in its message', () => {
    const message = compileError('{:list-of :nope}');
    expect(message).to.include(':nope');
    expect(message).not.to.include('DXNKeyword');
    expect(message).not.to.include('[object');
  });

  // The reference's defect -- an atom that is already NaN, an infinity, nil
  // or a boolean -- has no counterpart here: a trusted decode reads a
  // keyword as a global JS symbol, which is never one of those values. The
  // reference's tests are held all the same.
  describe('a trusted decode', () => {
    /** @param {string} text */
    const trusted = (text) => decode(text, { trusted: true });

    it('keeps a keyword named like NaN, an infinity, nil, true or false a keyword', () => {
      for (const name of ['nan', 'positive_infinity', 'negative_infinity', 'nil', 'true', 'false']) {
        const value = trusted(`:${name}`);
        expect(value, name).to.equal(Symbol.for(name));
        expect(decodeBinary(encodeBinary(value), { trusted: true }), name).to.equal(Symbol.for(name));
      }
    });

    it('still reads every other keyword as its own, and NaN, nil and true as themselves', () => {
      expect(trusted(':ok')).to.equal(Symbol.for('ok'));
      expect(Number.isNaN(trusted('NaN'))).to.equal(true);
      expect(trusted('nil')).to.equal(null);
      expect(trusted('true')).to.equal(true);
    });
  });
});
