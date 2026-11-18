# Node code from DXNS (T686)

Status: first round built 2026-11-18 (`src/codegen/`, `dextrin gen-js`,
`@joetjen/dextrin/codegen-runtime`); see "What the first round does" at
the end.

The Node counterpart of `mix dextrin.gen.elixir` (T684, dextrin's
design/codegen-elixir.md) and `bin/dextrin gen-php` (T685, php-dextrin's
design/codegen-php.md). What Jan settled there holds here:

- generated code reads and checks data **with code of its own**: no
  `.dxns` file and no compiled schema at run time;
- **every known version**: a reader and a checker per version, a reader
  dispatching on the version written, generated upgrades to the latest
  (added with its default, dropped, made optional, renamed via
  `typespec.renamed-from`), across version gaps, and hand-written upgrades
  where code can't decide;
- **what is written by hand is kept**: two files per schema, the user's
  class extending a generated `Abstract<Class>` (Jan on T685: "more
  PHP-like" -- and it is how a JavaScript class is extended too); marked
  regions `// dextrin:keep NAME` ... `// dextrin:end NAME` with slots
  `top`, `bottom`, `upgrade_vN`; orphans kept and failing `--check`;
  class names and paths kept as the user spells them, by a
  `// dextrin:schema NAME` id;
- **deprecation**: `@deprecated` (JSDoc/TSDoc) on a deprecated version's
  methods, and at run time the reader's warnings (T698), node-dextrin's
  own way: `deprecations: 'once' | 'every' | 'off' | 'error'`,
  `onDeprecated`, else `process.emitWarning(text, {type:
  'DeprecationWarning', code: 'DXN_DEPRECATED'})`;
- a generated `Decoder` module rather than a registry;
- refused data **throws** `InvalidData` (a `DXNError` naming the field
  path), as node-dextrin's `decode` throws;
- immutable values (`readonly`, frozen), `with...()` copies;
- a closed schema (`- *`) refuses undeclared fields; the forms the first
  round leaves out are refused, naming schema, version and field.

## What it writes

For `dextrin gen-js schemas/ --out src/schemas/`:

| DXNS | Node |
|---|---|
| `acme.shop/Order` | `src/schemas/acme/shop/Order.js` (the user's, written once; may be renamed to `.ts`): `export class Order extends AbstractOrder { static { this.verify(); } }`; `AbstractOrder.js` and `AbstractOrder.d.ts` (the generator's) |
| its latest version's fields | `readonly` typed properties, a constructor taking one object of them |
| each version N | `static readV1(fields)`, `static conformV1(fields)` |
| the versions together | `static read(value, options?)`, `validate(options?)`, `toDxn()` |
| a hand-written upgrade | `static upgradeV1(fields)` in the user's class, required by `verify()` (see Decisions) |
| a `%shape` | no class; a type alias of its map, checked by generated functions |
| everything | `src/schemas/decoder.js` + `.d.ts`: `decode(text, options?)` |

## Questions for Jan

1. **TypeScript or JavaScript?** Generate TypeScript (`.ts`): `abstract`
   makes a missing hand-written upgrade a compile error, as in PHP, and
   the fields get exact types. Or JavaScript with JSDoc types (`.js`, the
   way node-dextrin itself is written): runs without a compile step, but
   a missing upgrade is found only when an old version is read.
   Recommended: TypeScript, with `--js` (JavaScript + JSDoc) as a later
   option if a user needs it.
2. **Modules**: ES modules only (`import`/`export`)? Recommended: yes --
   generated code is the user's own source, and new Node code is ESM.
3. **The command**: `dextrin gen-ts SCHEMAS --out DIR [--check]` (beside
   `docs`, `from-typespec`)? Recommended: yes; `gen-js` would be the
   JavaScript one.
4. **Options**: one options object, `read(value, {deprecations,
   onDeprecated})`, as node-dextrin's `decode` takes them? Recommended:
   yes.
5. **Type checking in the suite**: generated code compiles under
   `tsc --strict` (`noImplicitAny`, `exactOptionalPropertyTypes`), checked
   by a test on a generated fixture? Recommended: yes -- the counterpart
   of PHP's phpstan level 8.

## Decisions (Jan, 2026-11-18)

- Q1, Jan: "I want the generated code to be usable by node and
  typescript. typescript should be supported, but if plain node is used
  it should work equally as well." So: **plain ES-module JavaScript
  (`.js`, Node 18+, no compile step) with a `.d.ts` beside each generated
  file**. The user's file may be `.js` or `.ts`.
- **A missing hand-written upgrade** fails before any data is read, in
  both: TypeScript has no `abstract static`, so the user's file is
  written once as `export class Order extends AbstractOrder { static {
  this.verify(); } }`. The class static block runs when the class is
  defined: `verify()` throws in plain Node, naming the class and method;
  in TypeScript the `.d.ts` declares `static verify<T extends {
  upgradeV1(f: FieldsV1): FieldsV2 }>(this: T): void`, so the same line
  is a compile error. Fallbacks: the first use of the class runs the same
  check once, and the generated Decoder checks every class it loads.
  (Probed with tsc --strict and Node before Jan answered.)
- Q2-Q5 as recommended: ES modules only; `dextrin gen-js SCHEMAS --out
  DIR [--check]`; one options object `{deprecations, onDeprecated}`;
  the `.d.ts` and a TypeScript fixture compile under `tsc --strict`, the
  `.js` passes node-dextrin's JSDoc typecheck, and a plain-JS test shows a
  missing upgrade failing at import.

## What the first round does (2026-11-18)

Built as decided, with the behaviour of the Elixir and PHP rounds as fixed
on 2026-11-18: two files per schema (here three, with the `.d.ts`);
regions `top`, `bottom`, `upgrade_vN`, orphans kept and failing
`--check`, an orphan's note written once; `// dextrin:schema` ids keeping
class names and paths as the user spells them, a renamed class moving its
generated parent; `Abstract<Class>` clashes refused naming both; a reader
and a checker per version, `upgradeFromVN()` generated and `upgradeVN()`
by hand, its region running first; added fields with their default,
dropped, made optional and renamed (`typespec.renamed-from`) fields
upgraded by themselves, across gaps in version numbers; `@deprecated` on
a deprecated version's `readVN()`/`conformVN()`, which `read()` never
calls; T698's warnings (`once`/`every`/`off`/`error`, `onDeprecated`, a
variant tried and refused silent, `error` refusing the whole value, "once"
per generated class) through `schema/deprecations.cjs`' own `warning`,
`text` and `tell`, so the default is `process.emitWarning(text, {type:
'DeprecationWarning', code: 'DXN_DEPRECATED'})`; `computed: :now` computed
when a value is read or made; no check for a `:never` field; a closed
schema refusing `field "b" is not declared, and the schema takes no
other`; the first round's refusals, worded as DXNS writes the form and
nothing written while one stands; `InvalidData` (a `DXNError`, stage
`schema`) with the field path; StudlyCase directories per namespace part,
as PHP's PSR-4 ones.

These differences remain, found while building:

- **The decoder is `Decoder.js`** (and `Decoder.d.ts`) at the root of
  `--out`, not `decoder.js`: named as PHP's class is, so a schema named
  `Decoder` clashes with it whatever the file system's case rules, and is
  refused. It exports `decode(text, options)`, `read(value, options)` and
  `CLASSES`; `registry`, `strict` and `trusted` go on to `decode`,
  `deprecations` and `onDeprecated` govern the generated code.
- **A `%shape` has no type alias**: its value stays the `Map` it decoded
  to (a `DXNMap`), typed `Map<unknown, unknown>`, checked by a generated
  function -- as PHP keeps a `DXNMap`. A named type is a check function
  (`t1()`, ...; a recursive one `named<Name>()`), no module of its own.
- **`top` is at the top of the module**, after the imports, not inside
  the class: an `import` stands only there, and a helper an upgrade
  region calls needs a place outside the class. Class members go in
  `bottom`.
- **Orphans are kept in a block comment** at the end of the file, where
  they do not run (JavaScript has no `__halt_compiler();`); the end of a
  block comment in their code is written `*\/` there, so the comment
  holds and the file still loads.
- **`undefined` is an absent field, `null` a nil one.** PHP's and Elixir's
  `validate`/`to_dxn` drop a field holding `null`/`nil`, treating it as
  absent; JavaScript has both, so a required `{:nilable :string}` holding
  `null` validates and is written back as `nil`.
- **The constructor takes one object of fields by property**, and fills
  any default of a field left out -- a computed one computed then --
  where PHP makes a parameter whose default is no constant expression
  required. It checks the class (`verify()`, the "first use" fallback)
  and freezes the value, so a user's class adds methods, getters and
  statics, not instance fields.
- **A missing hand-written upgrade** fails as decided: `verify()`, called
  in the user's static block, throws a `TypeError` naming the class and
  `static upgradeVN(fields)`; the `.d.ts` constrains `this`, so tsc
  reports it. `read()`, `readVN()`, the constructor and the `Decoder`
  check it too, once per class. The step is a public static: a
  structural TypeScript constraint does not see a protected member.
  The `.d.ts` types it exactly: `upgradeV1(fields: UpgradeV1Fields):
  FieldsV2`, `UpgradeV1Fields` being version 1's fields after the
  generated step.
- **Module functions, not private static methods**, for what only the
  class's own code calls (`readStruct`, `fieldsVN`, `upgradeFrom`,
  `build`, the checks): a `#private` static can't be reached through
  `this` when `this` is the user's subclass.
- **References import the user's class as `$<Class>`**, so it clashes
  neither with the generated file's own names nor with another schema's
  class of the same name. Import the user's files, as the decoder does:
  importing an `Abstract*.js` first, of a schema that references itself,
  meets its subclass before it is defined.
- **The user's file may be `.js`, `.ts`, `.mjs`, `.mts`, `.jsx` or
  `.tsx`**; every import of it is written with `.js`, as TypeScript
  writes one of a `.ts` file. Moving it to another directory moves its
  generated parent, as renaming does: the directory is the namespace.
  Paths clash without regard to case.
- **Property names**: as PHP, a field name that is no identifier is
  camel-cased (`first-name` is `firstName`), and a copy method is
  camel-cased whatever the property is (`withSignedUpAt`); a name that
  would hide a method of the class (`constructor`, `validate`, `toDxn`,
  `__proto__`) gets a `_` after it. The fields a step takes and gives
  are objects with no prototype, so a field named `__proto__` is one like
  any other.
- **Value types are node-dextrin's**: an integer is a `bigint`, a keyword
  a `DXNKeyword` or, decoded trusted, a `symbol`.
- **An unknown `deprecations`** throws a `RangeError` (PHP: an
  `InvalidArgumentException`).
- **The upgrade step is not marked `@deprecated`** (Elixir marks it):
  `read()` calls it, and JSDoc's mark is the only one JavaScript has.
- **No `--namespace`**: a JavaScript module has none; `--out` and the
  directories under it are where the classes are.
- **The `.js` is type-checked on its own**: beside a `.d.ts` of the same
  name, tsc reads only the declarations, so the fixture has two programs
  (`test/fixtures/codegen/tsconfig.json`, the declarations and a
  TypeScript consumer; `tsconfig.js.json`, the `.js` as JSDoc), both
  `--strict` with `exactOptionalPropertyTypes`, run by the suite and by
  `npm run typecheck:consumer`. Making the consumer compile found that
  `types/dextrin.d.ts` typed `Document` with names out of scope; fixed.
- **Not generated yet** (refused, naming schema, version and field): the
  Elixir and PHP rounds' list -- typed extras, `{:case}`, `{:list-items}`,
  tuples, sets, ordered maps, arrays, tagged values, generics written by
  hand, references pinned to a version, and the refine keys `contains`,
  `content`, `encodes`, `encodes-seq`.

The generated fixture, test/fixtures/codegen (schemas and output, with
the one hand-written `upgradeV1()` in `Pet.js`), is regenerated by
`node bin/dextrin.js gen-js test/fixtures/codegen/schemas --out
test/fixtures/codegen/generated`; the suite fails when it is stale.
