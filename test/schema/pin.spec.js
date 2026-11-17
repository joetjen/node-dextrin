import { expect } from 'chai';
import { decode, encode, decodeBinary, encodeBinary, canonical, Document, Registry, Schema, DXNKeyword, DXNSymbol, DXNTuple, DXNStruct, dxnEquals } from '../../src/dextrin.js';

// G11 and Q4 of dextrin's design/typespec.md, as its
// test/schema/pin_test.exs: a field pinned to one version of a schema or
// a named type, written `Pet(1)` -- text sugar for `{:at Pet 1}` -- and
// named types with versions of their own, `%type(N)[T]` (Way B). Unpinned,
// a reference means the latest.
describe('pinned references and versions of named types', () => {
  /** @param {string[]} sources @param {any} [registry] @returns {any} */
  const loaded = (sources, registry = new Registry()) => sources.reduce((r, source) => Schema.compile(decode(source), r), registry);

  /** The category and message of compiling the last of `sources` over the others. @param {string[]} sources */
  const compileError = (sources) => {
    const first = loaded(sources.slice(0, -1));
    try {
      Schema.compile(decode(sources[sources.length - 1]), first);
    } catch (err) {
      return { category: /** @type {any} */ (err).category, message: /** @type {Error} */ (err).message };
    }
    throw new Error('compiled');
  };

  /** The category of what `fn` throws, or what it answers. @param {() => unknown} fn */
  const category = (fn) => {
    try {
      return fn();
    } catch (err) {
      return /** @type {any} */ (err).category ?? err;
    }
  };

  /** @param {() => unknown} fn @returns {string} */
  const message = (fn) => {
    try {
      fn();
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
    throw new Error('did not throw');
  };

  describe('Name(N) in DXN text', () => {
    it('reads as {:at Name N}, wherever it stands', () => {
      const at = new DXNTuple([new DXNKeyword('at'), new DXNSymbol('Pet'), 1n]);
      expect(dxnEquals(decode('Pet(1)'), at)).to.equal(true);
      expect(dxnEquals(decode('Pet(1)'), decode('{:at Pet 1}'))).to.equal(true);
      expect(dxnEquals(decode('[Pet(1) 2]'), decode('[{:at Pet 1} 2]'))).to.equal(true);
      const trusted = /** @type {DXNTuple} */ (decode('acme/Pet(3)', { trusted: true }));
      expect(trusted.items[0]).to.equal(Symbol.for('at'));
      expect(trusted.items[2]).to.equal(3n);
      expect(DXNTuple.pinned(trusted)).to.deep.equal({ name: 'acme/Pet', version: 3 });
      expect(DXNTuple.pinned(new DXNTuple([1n, 2n]))).to.equal(null);
    });

    it('is written back as Name(N), plain, pretty and canonical', () => {
      const value = decode('%{pet: {:at acme.zoo/Pet 2}, n: 1}');
      expect(encode(value)).to.include('acme.zoo/Pet(2)');
      expect(encode(value, { pretty: true })).to.include('acme.zoo/Pet(2)');
      expect(canonical(value)).to.include('acme.zoo/Pet(2)');
    });

    it('any other {:at ...} is an ordinary tuple, written as one', () => {
      for (const text of ['{:at Pet 0}', '{:at "Pet" 1}', '{:at Pet 1 2}', '{:at Pet}']) {
        expect(encode(decode(text)).startsWith('{'), text).to.equal(true);
      }
    });

    it('the version is a positive integer', () => {
      expect(message(() => decode('Pet(0)'))).to.include('positive');
      expect(() => decode('Pet(x)')).to.throw();
    });

    it('the lossless formatter keeps it as written', () => {
      expect(Document.format(Document.parse('%{pet:   Pet(1)}'))).to.include('pet: Pet(1)');
    });
  });

  describe('a field pinned to a schema version', () => {
    const petSources = ['%{Pet: %schema(1){name: :string, colour: :string}}', '%{Pet: %schema(2){name: :string, color: :string}}'];

    /** @param {string} owner */
    const pets = (owner) =>
      loaded(
        [owner],
        loaded(petSources).putStructMaterializer('Pet', (/** @type {string} */ _name, /** @type {number} */ version, /** @type {any} */ fields) =>
          version === 1 ? { name: fields.name, color: fields.colour } : fields
        )
      );

    it('takes that version only, and keeps it as written, not upgraded', () => {
      const r = pets('%{Owner: %schema{pet: Pet(1)}}');
      const owner = /** @type {DXNStruct} */ (decode('%Owner{pet: %Pet(1){name: "a", colour: "red"}}', { registry: r }));
      const fields = /** @type {any} */ (owner.fields).pairs;
      expect(fields.map((/** @type {any} */ [k]) => k)).to.deep.equal(['pet']);
      const pet = fields[0][1];
      expect(pet).to.be.instanceOf(DXNStruct);
      expect(pet.name).to.equal('Pet');
      expect(pet.version).to.equal(1);
      expect(pet.fields.pairs).to.deep.include(['colour', 'red']);

      for (const text of ['%Owner{pet: %Pet(2){name: "a", color: "red"}}', '%Owner{pet: %Pet{name: "a", color: "red"}}']) {
        expect(category(() => decode(text, { registry: r })), text).to.equal('schema/type-mismatch');
      }
    });

    it('needs no materializer: the struct is taken as read', () => {
      const r = loaded([...petSources, '%{Owner: %schema{pet: Pet(1)}, Keeper: %schema{pet: Pet}}']);
      expect(() => decode('%Owner{pet: %Pet(1){name: "a", colour: "red"}}', { registry: r })).not.to.throw();
      expect(category(() => decode('%Keeper{pet: %Pet(1){name: "a", colour: "red"}}', { registry: r }))).to.equal('schema/no-materializer');
      expect(category(() => decode('[%Pet(1){name: "a", colour: "red"}]', { registry: r }))).to.equal('schema/no-materializer');
    });

    it('checked on its own, an older version with no materializer is still refused', () => {
      const r = loaded(petSources);
      const pet = decode('%Pet(1){name: "a", colour: "red"}');
      expect(category(() => Schema.validate(pet, r, 'Pet'))).to.equal('schema/no-materializer');
      expect(category(() => Schema.check(pet, r, 'Pet'))).to.equal('schema/no-materializer');
    });

    it('unpinned, any loaded version is taken and upgraded to the latest', () => {
      const r = pets('%{Owner: %schema{pet: Pet}}');
      const owner = /** @type {any} */ (decode('%Owner{pet: %Pet(1){name: "a", colour: "red"}}', { registry: r }));
      expect(owner.fields.pairs[0][1]).to.deep.include({ color: 'red' });
    });

    it('is written at that version', () => {
      const r = pets('%{Owner: %schema{pet: Pet(1)}}');
      const pet = DXNStruct.keyed('Pet', [['name', 'a'], ['colour', 'red']], 1);
      expect(encode(DXNStruct.keyed('Owner', [['pet', pet]]), { registry: r })).to.include('%Pet(1){');
      const wrong = DXNStruct.keyed('Owner', [['pet', DXNStruct.keyed('Pet', [['name', 'a'], ['colour', 'red']], 2)]]);
      expect(() => encode(wrong, { registry: r })).to.throw();
    });

    it('is written at that version in .dxnb too, in that version\'s field order', () => {
      const r = pets('%{Owner: %schema{pet: Pet(1)}}');
      const pet = DXNStruct.keyed('Pet', [['colour', 'red'], ['name', 'a']], 1);
      const bytes = encodeBinary(DXNStruct.keyed('Owner', [['pet', pet]]), { registry: r });
      const back = /** @type {any} */ (decodeBinary(bytes));
      expect(back.fields.values[0]).to.deep.equal(DXNStruct.positional('Pet', ['a', 'red'], 1));
      const read = /** @type {any} */ (decodeBinary(bytes, { registry: r }));
      expect(read.fields.pairs[0][1]).to.deep.equal(DXNStruct.keyed('Pet', [['name', 'a'], ['colour', 'red']], 1));
    });

    it('{:at Pet 1} and Pet(1) are the same field', () => {
      const a = pets('%{Owner: %schema{pet: Pet(1)}}');
      const b = pets('%{Owner: %schema{pet: {:at Pet 1}}}');
      expect(a.fetchStructSchema('Owner').compiled.fields).to.deep.equal(b.fetchStructSchema('Owner').compiled.fields);
    });

    it('a refusal names the version it expected and the one it got', () => {
      const r = pets('%{Owner: %schema{pet: Pet(1)}}');
      expect(message(() => decode('%Owner{pet: %Pet(2){name: "a", color: "red"}}', { registry: r }))).to.include('expected Pet(1), got Pet(2)');
    });
  });

  describe('a named type with versions (%type(N))', () => {
    const colors = ['%{Color: %type(1)[{:enum :red :green}]}', '%{Color: %type(2)[{:enum :red :green :blue}]}'];

    it('a reference means the latest; a pin means that version', () => {
      const r = loaded([...colors, '%{Car: %schema{paint: Color}, OldCar: %schema{paint: Color(1)}}']);
      expect(() => decode('%Car{paint: :blue}', { registry: r })).not.to.throw();
      expect(() => decode('%OldCar{paint: :red}', { registry: r })).not.to.throw();
      expect(category(() => decode('%OldCar{paint: :blue}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('a plain definition is version 1', () => {
      let r = loaded(['%{Color: {:enum :red}}', '%{Color: %type(2)[{:enum :red :blue}]}']);
      expect(Schema.check(new DXNKeyword('blue'), r, 'Color')).to.equal(true);
      r = loaded(['%{Car: %schema{paint: Color(1)}}'], r);
      expect(category(() => decode('%Car{paint: :blue}', { registry: r }))).to.equal('schema/type-mismatch');
    });

    it('each version once; the same definition again is no change', () => {
      const { category: got, message: why } = compileError([...colors, '%{Color: %type(2)[{:enum :red}]}']);
      expect(got).to.equal('schema/duplicate-version');
      expect(why).to.include('Color');
      expect(loaded([...colors, '%{Color: %type(2)[{:enum :red :green :blue}]}'])).to.be.instanceOf(Registry);
    });

    it('a pin to a version not loaded is a compile error', () => {
      const { category: got, message: why } = compileError([...colors, '%{Car: %schema{paint: Color(3)}}']);
      expect(got).to.equal('schema/compile');
      expect(why).to.include('Color(3)');
    });

    it('%type takes one item, the type, and a version', () => {
      for (const text of ['%{C: %type(1)[:string :integer]}', '%{C: %type[:string]}', '%{C: %type(1){a: 1}}']) {
        expect(category(() => Schema.compile(decode(text), new Registry())), text).to.equal('schema/compile');
      }
    });

    it('one version can be deprecated', () => {
      const r = loaded([
        '%{Color: {:doc %type(1)[{:enum :red :green}] %{deprecated: "use Color(2)"}}}',
        '%{Color: %type(2)[{:enum :red :green :blue}]}',
        '%{Car: %schema{paint: Color}, OldCar: %schema{paint: Color(1)}}'
      ]);
      expect(r.warnings).to.have.length(1);
      expect(r.warnings[0]).to.include({ name: 'Color', version: 1, at: 'OldCar' });
    });

    it('every version is kept, the latest the named type', () => {
      const r = loaded(colors);
      expect(r.fetchTypeVersion('Color', 1)).to.deep.equal(r.typeVersions.get('Color').get(1));
      expect(r.fetchTypeVersion('Color', 3)).to.equal(undefined);
      expect(r.fetchTypeAlias('Color')).to.equal(r.fetchTypeVersion('Color', 2));
    });
  });
});
