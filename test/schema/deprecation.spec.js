import { expect } from 'chai';
import { decode, encode, Registry, Schema, DXNStruct } from '../../src/dextrin.js';

// G10 of dextrin's design/typespec.md, as its
// test/schema/deprecation_test.exs: "mark Schemas in Dextrin as
// deprecated, and generate a warning when they are used", and "we need to
// be able to deprecate a specific version of a schema, not only the whole
// schema".
//
// `deprecated:` (DXNS.md §1b) on a version's own entry deprecates that
// version only. A warning fires when a schema compiles against what is
// deprecated, and when data goes through it; `deprecations:` says how
// often, or makes it an error (`schema/deprecated`), and `onDeprecated:`
// receives each warning in place of the platform's warning.
describe('G10: deprecation warnings', () => {
  const petV1 = '%{Pet: {:doc %schema(1){name: :string, colour: :string} %{deprecated: "use Pet(2)"}}}';
  const petV2 = '%{Pet: %schema(2){name: :string, color: :string}}';

  /** @param {string[]} sources @param {any} [registry] @returns {any} */
  const loaded = (sources, registry = new Registry()) => sources.reduce((r, source) => Schema.compile(decode(source), r), registry);

  /** @param {any} registry */
  const upgraded = (registry) =>
    registry.putStructMaterializer('Pet', (/** @type {string} */ _name, /** @type {number} */ version, /** @type {any} */ fields) =>
      version === 1 ? { name: fields.name, color: fields.colour } : fields
    );

  /** @type {any[]} */
  let heard = [];
  beforeEach(() => {
    heard = [];
  });

  /** Decodes `text`, every warning kept in `heard`. @param {string} text @param {any} registry @param {{[k: string]: unknown}} [opts] */
  const decoded = (text, registry, opts = {}) => decode(text, { registry, onDeprecated: (/** @type {any} */ w) => heard.push(w), ...opts });

  /** The warnings heard so far, and none after. */
  const warnings = () => heard.splice(0, heard.length);

  describe('one version of a schema', () => {
    it('data written with it warns, naming the version and the reason', () => {
      const r = upgraded(loaded([petV1, petV2]));
      decoded('%Pet(1){name: "a", colour: "red"}', r);
      const got = warnings();
      expect(got).to.have.length(1);
      expect(got[0]).to.include({ name: 'Pet', version: 1, message: 'use Pet(2)', category: 'schema/deprecated' });
    });

    it('the other versions, and data with no version, do not', () => {
      const r = upgraded(loaded([petV1, petV2]));
      decoded('%Pet(2){name: "a", color: "red"}', r);
      decoded('%Pet{name: "a", color: "red"}', r);
      expect(warnings()).to.deep.equal([]);
    });

    it('a reader upgrading it to the latest still warns, once', () => {
      const r = upgraded(loaded([petV1, petV2]));
      const read = /** @type {any} */ (decoded('[%Pet(1){name: "a", colour: "red"} %Pet(1){name: "b", colour: "g"}]', r));
      expect(read.items).to.have.length(2);
      const got = warnings();
      expect(got).to.have.length(1);
      expect(got[0].version).to.equal(1);
      decoded('%Pet(1){name: "c", colour: "red"}', r);
      expect(warnings()).to.deep.equal([]);
    });

    it("every use warns under deprecations: 'every', none under 'off'", () => {
      const r = upgraded(loaded([petV1, petV2]));
      const text = '[%Pet(1){name: "a", colour: "red"} %Pet(1){name: "b", colour: "g"}]';
      decoded(text, r, { deprecations: 'every' });
      expect(warnings()).to.have.length(2);
      decoded(text, r, { deprecations: 'off' });
      expect(warnings()).to.deep.equal([]);
    });

    it("is an error under deprecations: 'error'", () => {
      const r = upgraded(loaded([petV1, petV2]));
      expect(() => decoded('%Pet(1){name: "a", colour: "red"}', r, { deprecations: 'error' }))
        .to.throw()
        .with.property('category', 'schema/deprecated');
    });

    it('a base naming that version warns when the schema compiles; any other does not', () => {
      const r = loaded([petV1, petV2]);
      const pinned = loaded(['%{Show: %schema includes Pet(1) {judge: :string}}'], r);
      expect(pinned.warnings).to.have.length(1);
      expect(pinned.warnings[0]).to.include({ name: 'Pet', version: 1, at: 'Show' });

      for (const text of [
        '%{Show: %schema includes Pet(2) {judge: :string}}',
        '%{Show: %schema includes Pet {judge: :string}}',
        '%{Owner: %schema{pet: Pet}}'
      ]) {
        expect(loaded([text], r).warnings, text).to.deep.equal([]);
      }
    });

    it('its annotations are read by its version', () => {
      const r = loaded([petV1, petV2]);
      expect(Schema.annotations(r, 'Pet', 1)).to.deep.equal({ deprecated: 'use Pet(2)' });
      const annotations = Schema.annotations(r, 'Pet', 2);
      expect(annotations).to.be.an('object');
      expect(annotations).not.to.have.property('deprecated');
      expect(Schema.annotations(r, 'Pet', 3)).to.equal(undefined);
    });
  });

  describe('a whole schema', () => {
    const old = `
      %{
        Old: {:doc %schema{x: :integer} %{deprecated: true}}
        Holder: %schema{old: Old}
      }`;

    it('warns where another schema names it, and stays silent in what is deprecated itself', () => {
      const r = loaded([old]);
      expect(r.warnings).to.have.length(1);
      expect(r.warnings[0]).to.include({ name: 'Old', at: 'Holder' });

      const quiet = loaded([
        '%{Old: {:doc %schema{x: :integer} %{deprecated: true}}, Older: {:doc %schema{o: Old} %{deprecated: true}}}'
      ]);
      expect(quiet.warnings).to.deep.equal([]);
    });

    it('data of it warns, whatever its version', () => {
      decoded('%Holder{old: %Old{x: 1}}', loaded([old]));
      const got = warnings();
      expect(got).to.have.length(1);
      expect(got[0]).to.include({ name: 'Old', message: null });
    });

    it('an encode warns as a decode does', () => {
      const r = loaded([old]);
      const value = decode('%Holder{old: %Old{x: 1}}', { registry: loaded([old]), deprecations: 'off' });
      encode(value, { registry: r, onDeprecated: (/** @type {any} */ w) => heard.push(w) });
      const got = warnings();
      expect(got).to.have.length(1);
      expect(got[0].name).to.equal('Old');
    });

    it("without onDeprecated, a warning goes to the platform's warnings", () => {
      const r = loaded([old]);
      const original = process.emitWarning;
      /** @type {any[]} */
      const emitted = [];
      process.emitWarning = /** @type {any} */ ((/** @type {unknown[]} */ ...args) => emitted.push(args));
      try {
        decode('%Holder{old: %Old{x: 1}}', { registry: r });
      } finally {
        process.emitWarning = original;
      }
      expect(emitted).to.have.length(1);
      const [text, options] = emitted[0];
      expect(text).to.include('Old');
      expect(text).to.include('deprecated');
      expect(options).to.deep.equal({ type: 'DeprecationWarning', code: 'DXN_DEPRECATED' });
    });
  });

  describe('a named type', () => {
    it('warns where a schema names it, and when data goes through it', () => {
      const r = loaded(['%{Colour: {:doc {:enum :red :green} %{deprecated: "use Color"}}, Car: %schema{paint: Colour}}']);
      expect(r.warnings).to.have.length(1);
      expect(r.warnings[0]).to.include({ name: 'Colour', version: null, message: 'use Color', at: 'Car' });

      decoded('%Car{paint: :red}', r);
      const got = warnings();
      expect(got).to.have.length(1);
      expect(got[0].message).to.equal('use Color');
    });
  });

  describe("a body's * K => V", () => {
    it('warns where it names something deprecated', () => {
      const r = loaded(['%{Old: {:doc :integer %{deprecated: true}}, Counts: %shape{* :string => Old}}']);
      expect(r.warnings).to.have.length(1);
      expect(r.warnings[0]).to.include({ name: 'Old', at: 'Counts' });
    });
  });

  describe('a field, an enum value and a variant', () => {
    const parts = `
      %{
        User: %schema{
          email: :string
          legacy?: {:doc :string %{deprecated: "use email"}}
          color?: {:doc {:enum :red :old-blue} %{values: %{:old-blue => %{deprecated: "use :blue"}}}}
          id?: {:any-of :integer {:doc :string %{deprecated: "ids are integers now"}}}
        }
      }`;

    it('warn only when the value goes through them', () => {
      const r = loaded([parts]);
      decoded('%User{email: "a", color: :red, id: 1}', r);
      expect(warnings()).to.deep.equal([]);

      decoded('%User{email: "a", legacy: "x", color: :old-blue, id: "7"}', r);
      expect(warnings().map((w) => w.message).sort()).to.deep.equal(['ids are integers now', 'use :blue', 'use email']);
    });
  });

  describe('the words of a warning', () => {
    it('name what is deprecated, where it is used, and why', () => {
      const r = loaded(['%{Old: {:doc %schema{x: :integer} %{deprecated: "use New"}}, Holder: %schema{old: Old}}']);
      expect(Schema.deprecationText(r.warnings[0])).to.equal('Holder uses Old(1), which is deprecated: use New');
      expect(Schema.deprecationText({ name: null, version: null, message: null, category: 'schema/deprecated', at: null })).to.equal(
        'a deprecated type or value is deprecated'
      );
    });
  });

  it('encoding warns of the struct\'s own version only, not the base it passes as', () => {
    const r = loaded([petV1, petV2, '%{Show: %schema extends Pet(1) {judge: :string}}']);
    const show = DXNStruct.keyed('Show', [['name', 'a'], ['colour', 'red'], ['judge', 'j']]);
    encode(show, { registry: r, onDeprecated: (/** @type {any} */ w) => heard.push(w) });
    expect(warnings()).to.deep.equal([]);
  });

  it("an encode under deprecations: 'error' refuses a deprecated struct", () => {
    const old = '%{Old: {:doc %schema{x: :integer} %{deprecated: true}}, Holder: %schema{old: Old}}';
    const r = loaded([old]);
    const value = decode('%Holder{old: %Old{x: 1}}', { registry: r, deprecations: 'off' });
    expect(() => encode(value, { registry: r, deprecations: 'error' }))
      .to.throw()
      .with.property('category', 'schema/deprecated');
  });

  it("compile warnings come in the order of the entries' names", () => {
    const r = loaded(['%{Old: {:doc :string %{deprecated: true}}, Zed: %schema{o: Old}, Abe: %schema{o: Old}}']);
    expect(r.warnings.map((/** @type {any} */ w) => w.at)).to.deep.equal(['Abe', 'Zed']);
  });
});
