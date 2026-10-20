# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Encoded content** (as dextrin 6918cf8, Jan, 2026-10-20; DXN.md
  §4.2): `encoding:` (RFC 4648's base64, base64url, base32, base16),
  `media-type:` and `content: T` on strings -- the string, decoded, is a
  DXN document of type T, `.dxnb` under `application/dxnb` -- and
  `encodes: T` and `encodes-seq: T` on bytes, CDDL's `.cbor` and
  `.cborseq`. The binary decoder's `decodeSequence` reads documents back
  to back. An encoding is checked by its alphabet and padding, as the
  reference checks it, not by `Buffer.from`, which takes what it refuses.
- **`format:`** (as dextrin 71fbec0, Jan, 2026-10-20; DXN.md §4.2a): a
  string in one of a closed set of 22 formats -- `date`, `time`,
  `datetime`, `local-datetime`, `duration`, `uuid`, `ipv4`, `ipv6`,
  `hostname`, `idn-hostname`, `email`, `idn-email`, `uri`,
  `uri-reference`, `iri`, `iri-reference`, `uri-template`,
  `json-pointer`, `relative-json-pointer`, `semver`, `mac`, `host-port`
  -- `src/schema/format.cjs`. A format DXN has a tag for is read by that
  tag's reader; every other one by a grammar the spec gives, compiled
  with the `u` flag. `@uuid` already read only 8-4-4-4-12 hex digits.
- **Refine keys on scalars** (as dextrin 2f20707, Jan, 2026-10-20;
  DXN.md §4.2; the superset's group 5): `min-length`/`max-length` on
  keywords, symbols, bytes (in bytes) and bits (in bits, under `:bits`);
  `min-bytes`/`max-bytes` (UTF-8); `pattern` on keywords, symbols and
  bytes; `min-precision`/`max-precision` and `min-exponent`/
  `max-exponent` on decimals; `float32: true`; `bits: [0 1 4]` (RFC
  8610's `.bits`); `min`/`max`/`exclusive-*` on dates, times, datetimes,
  local date-times and durations; `before-now`, `after-now`, `within:
  @duration "PT1H"`; `resolution: :millisecond`.
- **A list's items in order, and lists' refine keys** (as dextrin
  f2639a9, Jan, 2026-10-20; DXN.md §4.1a, §4.2; the superset's group 4).
  `{:list-items :string {:repeat :integer 0 nil}}` is a list item by
  item: a type for one item, `{:repeat p min max}` for several (`max`
  `nil` for no bound), and `{:repeat {:group a b} min max}` for several
  together; a repeat takes as many items as it can and gives them back
  one at a time. `{:tuple-of-all T}` is a tuple of any length. The refine
  keys `contains:`, `min-contains:`, `max-contains:`, `unique:` and
  `unique-by:` count and compare a collection's elements, two values the
  same when their canonical forms are; `min-count:`/`max-count:` count an
  array's too.
- **`@objectid` and `@ip` are built in** (as dextrin a25c34b, Jan,
  2026-10-20; DXN.md §1.3), like `@uuid`: readable in text, their raw
  bytes in `.dxnb`. `@objectid "507f1f77bcf86cd799439011"` is BSON's
  12-byte ObjectId (`DXNObjectId`, tag 221), and may be a map key.
  `@ip "192.0.2.1"`, `"10.0.0.0/8"`, `"2001:db8::1"` and
  `"2001:db8::/32"` are an address or a prefix (`DXNIp`), written as RFC
  9164 says, CBOR tags 52 and 54; DXNS adds `:objectid`, `:ip` and the
  refine keys `version:` and `prefix:`. **`.dxnb` uses the smallest
  representation that keeps a value**, now said in DXN.md §2.2.
- **`%shape{...}`, `{:case field %{...}}`, recursive and generic named
  types** (DXN.md §4.4a, §4.5, Jan, 2026-10-20), as the reference has
  them: a shape is a named, unversioned plain-map type that fills its
  missing fields' defaults; a case chooses a field's type by its sibling's
  value; a named type may refer to itself through a field or a
  collection; `{:generic [t] body}` and `{:of Name T}`. **`Schema.check`**
  answers whether a value matches a schema, shape or named type without
  changing it, and **`Schema.conform`** returns it with defaults filled.
- **`dextrin check` and `SchemaTree`** (Jan, 2026-10-20): a tree of
  `.dxns` files read as one -- every entry named from its path
  (`SchemaLayout`), the files compiled in the order their references
  need -- with every problem printed as `file:line`; a name resolving to
  nothing is a problem unless its namespace is `--extern`.
- **The conformance adapter answers `media-type`, `identify` and
  `identify-binary`** (DXN.md §6): the form a media type names, and
  whether a body is worth decoding as text, a schema or binary, so the
  suite checks the format test across implementations.
- **`dextrin docs` and `SchemaDocs`** (as dextrin 808d580, Jan
  2026-10-20): HTML documentation for a directory of `.dxns` schemas,
  written byte for byte as the reference writes it -- a sidebar tree of
  every namespace and definition, a section per namespace, the pages a
  directory tree with an `index.html` per namespace, every reference a
  link, every version shown, light or dark kept in localStorage.
  `example/` holds the shared Acme schemas and their generated `doc/`; a
  test checks the generated site against it.
- **New type forms** (DXN.md §4.1, as dextrin 47d6d1d): `{:not t}`,
  `:never` (JSON Schema's `false`), and element types for the
  collections that had none: `{:array-of t}`, `{:ordered-map-of k v}`,
  `{:sorted-set-of t}`.
- **`Format`** (DXN.md §6, as dextrin's `Dextrin.Format`): `mediaType`,
  `extension`, `form` -- the three media types, and any `+dxn` suffix as
  text -- and `identifies(body, form)`, a cheap prefix test of whether a
  body is worth decoding as a form: binary by the envelope's magic, text
  and schemas by a first significant `%` after whitespace, comments and
  a header. Lists and scalars stay unrecognised on purpose: they overlap
  with JSON (Jan, 2026-10-20).
- `Schema.compileAll(docs, baseRegistry)`: several `.dxns` documents
  compiled into one registry, in order; the first that does not compile
  throws, naming which -- as the reference's `compile_all/2`.
- **Dotted names** (DXN.md §1.1, as dextrin 0d1c7f5): segments joined by
  `.`, with at most one `/` -- `%Foo.Bar/Baz{...}`, `acme.billing/invoice`,
  `:a.b`, `a.b: 1`. Two slashes or an empty segment are refused.
- **`FileResolver.forPaths` follows DXN.md §4.6** (as dextrin fd34537):
  the four layouts (`Foo/Bar/Baz-vN.dxns`, `Foo/Bar/Baz/vN.dxns`,
  `Foo.Bar.Baz-vN.dxns`, the namespace file `Foo.Bar.dxns`), the first
  search path deciding, a file's version its schema's, one version found
  once, every version loaded. A resolver answers a list of every version
  found and throws `schema/compile` for files it cannot use.
- **`bits`**, as DXN.md defines it (dextrin afbb00d): `DXNBits`
  holds a run of bits that is not whole bytes -- the bytes, the unused
  bits zero, and the count -- written `@bits {"oA==" 3}` and `T_BITS`
  (216). `DXNBits.from` answers `DXNBytes` for a whole number of bytes,
  as bits and bytes are one value space. `:bits` in a schema takes bits
  and bytes, `:bytes` only whole bytes; bits are no map key.
- The format guides are the reference's DXN.md: `bits`, the private
  range 200-216, and §5's `document/*` errors, at format version 1.0,
  which it stays until 1.0.0 (Jan, 2026-10-20).
- **TypeScript declarations**, written from the JSDoc by `npm run types`
  (and on `prepack`) into `types/` and named by `package.json`'s `types`
  and `exports`, for `import` and `require` alike. A TypeScript program
  using the package is typechecked against them in `npm run precommit`.
  Every class is a type as well as a value there (`err: DXNError`,
  `registry: Registry`, `x: DXNStruct`): the entry and `values/` export
  name by name, which `tsc` declares so.

### Changed

- **Every refine argument is checked when the schema compiles** (as
  dextrin 6918cf8): a count that is no non-negative integer, a flag that
  is no boolean, `multiple-of: 0`, `bits: 5`, a `pattern` that is no
  regex and the like are compile errors (`schema/compile`); some were
  refused only at check time before. A compile error writes the value it
  refuses in DXN.
- **A refine constraint refuses a value it does not apply to** (as
  dextrin 2f20707): a length on an integer, a range on a string, `bits`
  on a negative integer. Before, several such checks threw; `finite:
  false` and `unique: false` took any value at all. A constraint key that
  is no name is a compile error, no longer a crash.
- **An unknown refine key is a compile error** (as dextrin f2639a9;
  `schema/compile`), as are `min-contains:` and `max-contains:` without
  `contains:`. A misspelt key (`min-lenght:`) refused every value before,
  silently.
- **`.dxnb` writes the smallest form of a float, a UTC datetime and a
  regex without flags** (as dextrin 8927a29, Jan, 2026-10-20; DXN.md
  §2.2): a float in the shortest of CBOR's half, single and double
  precision that holds it exactly (NaN and the infinities in half), a
  datetime in UTC as its bare nanoseconds, a regex without flags as its
  bare pattern. A reader reads every form, half-precision floats
  included, which it refused before.
- **One way to write a value: every sigil is gone** (as dextrin 45d78bc,
  Jan, 2026-10-20; DXN.md §1.2). Breaking. Dates and times are ISO 8601
  strings under a tag -- `@date "2026-10-20"`, `@time "14:30:00.5"`,
  `@datetime "2026-10-20T14:30:00Z"`, and the new `@local-datetime
  "2026-10-20T14:30:00"` -- and a regex is `@regex "pattern"`, its flags
  in a header, `@regex(im) "..."`, or inline, `@regex "(?im)..."` (a
  different value). `~D[...]`, `~T[...]`, `~U[...]` and `~r/.../` are
  refused, `syntax`; so are `-00:00`, a header on any other tag, and a
  flag given twice or unknown.
- **`timestamp` and `datetime` are one type**, `datetime`: an instant
  with its offset, `Z` for UTC. Breaking. `DXNTimestamp` is gone: a UTC
  instant is a `DXNDateTime` at offset 0, which `new DXNDateTime(ns)` and
  `DXNDateTime.fromDate(date)` give by default, and a native `Date`
  encodes as one. `:timestamp` in a schema is sugar for `{:refine
  :datetime %{offsets: ["Z"]}}`, so a schema naming it keeps its meaning.
  **`DXNLocalDateTime`** holds the new `local-datetime`, a wall-clock
  date and time with no offset.
- **Times, datetimes, local date-times and durations carry nanoseconds**
  (DXN.md §2.2). Breaking: `DXNTime`'s fourth field is `nanosecond`
  (was `microsecond`), `DXNDateTime` holds `epochNanoseconds` (was
  `epochMicroseconds`), and `DXNDuration`'s seventh field is
  `nanoseconds`, a `BigInt` (was `microseconds`). Written text drops a
  fraction's trailing zeros, and a duration's fields may each carry a
  sign. In `.dxnb` the nanosecond forms have new tags (218 time, 219
  datetime, 220 duration, 217 local date-time); 0.2's microsecond tags
  (1, 210, 211, 212) are still read, as what they meant, and never
  written, so a tag never changes its meaning.
- **Refine keys `finite:` and `offsets:`** (DXN.md §4.2), and **NaN lies
  outside every range**: `min`, `max` and both exclusive bounds refuse it.
- **The README's size table is the reference's measured again**: the
  pretty layout and the datetime spelling both changed it.
- **A named type sees the named types beside it** (DXN.md §4.5): a
  reference to a sibling in the same document resolves, in any order; a
  named type that reaches itself unguarded is refused.
- **The package description opens with the development warning**
  (Jan, 2026-10-20), "Under heavy development: not for production use
  before 1.0.0.", so the registry's search results show it too.
- **An array is written `@array[1 2]`**, its bracket against the tag
  (Jan, 2026-10-20): the preferred spelling, which the compact text
  form now writes as the pretty layout and the canonical form already
  did. `@array [1 2]` still reads, as the same array.
- **The README opens with a warning** (Jan, 2026-10-20): the library
  is under heavy development and not for production use before `1.0.0`;
  things can and will break, and the specification can and will change,
  between any two releases until then.
- **`{:one-of ...}` means exactly one variant matches** (Jan,
  2026-10-20; JSON Schema's `oneOf`, as dextrin 47d6d1d), and
  **`{:any-of ...}`** is the new "one or more" (`anyOf`) -- what `one-of`
  meant before. Breaking: a schema whose `one-of` variants overlap now
  refuses a value two of them match; write `any-of` to keep the old
  meaning. `{:nilable t}` is sugar for `{:any-of :nil t}`.
- **The pretty layout keeps short collections on one line** (Jan,
  2026-10-20), as `dextrin` does: the top-level collection still breaks,
  one entry per line, however short; a nested one is written on one
  line, its entries single-space separated, when that line -- indent and
  key included -- fits the width (`width`, 80). `encode` with `pretty:
  true`, `Document.format` and `dextrin format` all lay out this way. A
  nested collection holding a comment, or a blank line between its
  entries, stays over lines.
- **Decoding is untrusted by default**, as the reference's (dextrin
  1ee60d7): `decode`, `decodeBinary` and `Document` decode a keyword as
  `DXNKeyword`, so no input can fill the never-collected global symbol
  registry; `trusted: true` (or `registry.putTrusted(true)`) is the opt-in
  for a source you control. Breaking for callers that relied on
  `Symbol.for` keys from the default. A `Document` path's keyword names a
  keyword key either way.
- **A field typed with a namespaced reference takes a struct of that
  name** (DXN.md §4.7): a field typed `geo/Address` accepts
  `%geo/Address{...}` and refuses `%Address{...}` -- the other way round
  from before, when a resolved schema kept its file's name. Breaking for
  documents that wrote the bare name. `forPaths`' resolver answers a list
  now, each schema under the name asked for.
- **A 0.1 schema says it is one**, as the reference's (dextrin afbb00d,
  a776312): `fields: @ordered %{...}`, `closed: true` and
  `forbidden: [...]` are refused (`schema/compile`) naming Dextrin 0.1's
  syntax and what a schema is written as now, rather than as a field of
  no known type.

### Fixed

- **Negative zero prints as `-0.0`**: `encode(-0)` wrote `0.0`, which
  reads back as another value (DXN.md §1.5); `canonical` already kept
  the sign.
- A date in a year below 100, `@date "0050-03-01"`, was refused, and
  `.dxnb` wrote it as the wrong day: `DXNDate` and the encoder counted
  through `Date.UTC`, which reads a year from 0 to 99 as 19xx. Days are
  counted in plain arithmetic now.
- **A field naming another file's named type resolves** (DXN.md §4.6):
  `FileResolver` compiled each file on its own, so a field naming another
  file's shape or named type named a struct that never came.
- A registry's own `putTrusted` was never consulted: the text and binary
  decoders defaulted `trusted` from their options alone. They take the
  option, else the registry's, else untrusted.
- A `DXNMap` prints as the map it is: its entries, without the
  `byIdentity` bookkeeping it keeps to compare keys by value. The README
  and the tutorial show `decode`'s result as it is, a `DXNMap` (they said
  `Map`; found by the joetjen.net site session).
- **The package survives a bundler.** The standard library's schemas
  were read off disk next to the source at load, and the ES module entry
  reached the implementation through `import.meta.url`; bundled into one
  CommonJS file (as the DXN VS Code extension does), both failed at load.
  The standard library's text is now a module written from
  `priv/schema/std.dxns` (`npm run std`; a test fails when it is out of
  date), and the ES module entry re-exports the CommonJS one instead of
  keeping a second copy of `decode`, `encode`, `decodeBinary` and
  `encodeBinary`; so does `values/equality.js`, the last ES module that
  reached its CommonJS one through `import.meta.url`.
- **A map key that is not allowed, and a schema violation, say where
  they are** when decoding text: `key/not-allowed` at the key, a schema
  error at its struct's `%` (the innermost one), as the reference places
  them. They had no offset. A refused key is named as written --
  `[1] cannot be a map key` -- not as `[object Object]`.
- **A value written well that is not one is a `syntax` error** at the
  token it began with (`DXN.md` §5), as the reference answers: an
  impossible date or time, a uuid or datetime that is not one, an unknown
  string escape. They came back with no category and no offset.
- A rational with a zero denominator is refused at the rational, not at
  offset 0; a struct's refusal is placed at its `%`, not at a token
  index.
- `Document.format` wrote the header without its space (`@dxn"1.0"`);
  it writes the tag, one space and the version, however they were
  spaced.
- `Document.format` dropped a document's final newline; it now ends with
  one exactly when the source did. `dextrin format` still writes a file
  with one final newline.

## [0.2.0] - 2026-10-19

Versioned schemas, extra fields, the conformance suite's adapter and a
document that keeps its comments. Breaking: the package is now
`@joetjen/dextrin`, a 0.1.x `.dxns` file has to be rewritten, and
decoding a checked struct answers a `DXNStruct`.

### Migrating from 0.1.x

- **The package is `@joetjen/dextrin`.** `npm uninstall dextrin && npm
  install @joetjen/dextrin`, and `require('dextrin')` becomes
  `require('@joetjen/dextrin')` (or `import ... from
  '@joetjen/dextrin'`).
- **`.dxns` files.** The body lists the fields directly, in the order
  `fields: @ordered %{...}` gave them, and a schema without a version
  is version 1:

  ```text
  # 0.1.x
  User: %schema{closed: true, fields: @ordered %{name: :string, email?: :string}}
  # 0.2.0
  User: %schema{name: :string, email?: :string}
  ```

  An unconverted file is refused by `Schema.compile` (`schema/compile`:
  `field "fields": unrecognized type expression`), never read as
  something else.
- **`closed:`, `forbidden:` and `refine-fn:` are gone.** A struct may
  carry fields its schema does not declare. Where `closed: true` refused
  them, decode with `{ strict: true }` (or `registry.putStrict(true)`),
  which refuses every undeclared field as `schema/undeclared-field`. A
  `forbidden:` list or a refine predicate becomes a check in the
  schema's materializer (`registry.putStructMaterializer`), which may
  throw.
- **A checked struct decodes to a `DXNStruct`**, not a plain object. A
  materializer that answers its fields keeps the old shape:
  `registry = registry.putStructMaterializer('User', (_name, _version,
  fields) => fields)` -- the registry's methods answer a new registry.
- **`.dxnb` written by 0.1.x still reads**, and so does text: its structs
  carry no version, and a struct without a version is read as the latest
  version loaded. Proven against bytes 0.1.0 wrote, in
  `test/binary/v0_1_0.spec.js`.
- **Rewrite stored 0.1.x data before you load a version 2.** Once a
  version 2 is loaded, an unversioned struct is read as version 2, and a
  `.dxnb` struct with version 1's fields no longer matches it
  (`schema/field-count`). Decoded and encoded again with 0.2.0, the same
  value is written as `User(1)`, and from then on it is read as version 1
  and handed to the materializer to upgrade.

### Added

- `Document` -- a `.dxn` document with everything it holds, its comments,
  blank lines and commas as well as its value, mirroring
  `Dextrin.Document`: `parse` (`decode`'s options and errors), `toValue`,
  `render` (the source, byte for byte, when nothing was edited), `format`
  (laid out, every comment kept), the edits `replace`, `delete` and
  `insert` by path, and `update`, which makes a new value by the fewest
  edits and refuses where guessing would lose a comment. The parser
  records the tree as it parses, so it is the same parser as `decode`'s.
- **`dextrin format` keeps comments** (`--mode pretty`, the default);
  `--mode condense` still drops them, a comment ending its line.
- `dextrin conformance` answers `format` and `edit` cases.
- The tutorial's §8, "Evolving a schema": a worked example of versions,
  reading across them, the materializer, the positional risk and
  `dextrin compat`. The cheatsheet gains versions and extra fields.
- `Schema.compat(oldRegistry, newRegistry)` and `dextrin compat OLD NEW`
  -- the version discipline check (`DXN.md` §4.8), for CI against the
  previous release's schema files: a version whose content changed
  without a new version, or a version that went down, fails; what the
  latest version's materializer has to upgrade is listed either way.
- `canonical(value)` -- the canonical form of a value (`DXN.md` §1.5):
  one rendering fixed down to the byte, with maps and sets in canonical
  order (by code point, not UTF-16 order), floats by one exact algorithm
  and one fixed set of string escapes, so values from different
  implementations compare as text.
- `DXNError#category` -- the error's kind as `DXN.md` §5 names it
  (`'syntax'`, `'binary'`, `'encode/unsupported'`, ...), so errors
  compare across implementations without comparing messages.
- `answer(request)` and `dextrin conformance REQUEST ANSWER` -- this
  implementation's adapter for the Dextrin Conformance Suite.
- `DXNMap` -- a `Map` whose keys are compared by value: two keys are the
  same key exactly when their canonical forms are (`DXN.md` §1.6). Every
  decoded map is one.

- **Versioned schemas** (`DXN.md` §4.8). `%schema(3){...}` is version 3
  of its name, and one with no header is version 1. A registry keeps every
  loaded version side by side: `addStructSchema` refuses a version that is
  already loaded (`schema/duplicate-version`), `replaceStructSchema`
  hot-swaps one that is loaded and refuses one that is not
  (`schema/not-loaded`), and `fetchStructSchema(name)` answers the latest,
  `fetchStructSchema(name, version)` exactly that one.
- **A struct literal carries its version**: `%User(3){...}` and
  `%User(3)[...]` decode to a `DXNStruct` whose `version` is 3, and are
  written back with it. A version of zero or less is refused.
- `DXNStruct.head` and `DXNStruct#withFields`.
- **Every struct written against a schema carries the latest loaded
  version of it**, in text (`%User(3){...}`, and `%User(1){...}` when
  version 1 is the only one) and in `.dxnb`, where the type name becomes
  `"User(3)"`. A struct with no schema keeps its own version, or none.
  `Registry#asWritten` decides; `DXNStruct.typeName` and
  `DXNStruct.parseTypeName` spell it. A `.dxnb` type name whose version
  is not a positive integer is a `binary` error.
- **A struct is read according to the version it was written with**
  (`DXN.md` §4.8, `src/schema/reader.cjs`), in text and binary alike. The
  latest version, or none, is read exactly. A newer version is read
  against the latest: text by name, binary by position, dropping items
  beyond the reader's fields and leaving missing optional fields absent.
  An older version that is loaded is read with its own schema and handed
  to the materializer, and refused as `schema/no-materializer` without
  one; an older version that is not loaded is refused as
  `schema/unknown-version`.
- **One materializer per schema, for every version** (`DXN.md` §4.8).
  `Registry#putStructMaterializer` takes a function of
  `(schemaName, version, fields)`; it is called for every decoded struct
  of its schema, upgrades older versions, and its result is checked
  against the latest schema — a throw or a rejected result is
  `schema/materializer`. A provider's `dxnMaterialize` takes the same
  arguments.
- **Without a materializer, a checked struct decodes to a `DXNStruct`**
  at its schema's latest version, fields in the schema's order, instead
  of a plain object — so it encodes back to the text it came from. An
  optional field that was absent stays absent instead of becoming `null`.
- `schema/validator.cjs`'s `materialize` is replaced by `resolve`;
  building the value is `schema/reader.cjs`'s job.
- **A struct may carry extra fields** (`DXN.md` §4.7), kept in
  `DXNStruct`'s new `extra` list and written back with it: in text as
  entries — after a positional struct's items,
  `%User(3)["a" "a@x" nick: "b"]` — and in `.dxnb` as one trailing map
  under the new private tag 215. A keyed struct's undeclared names, and
  any entry keyed by something other than a name, are extras. An extra
  never shadows a declared field (`schema/shadowed-field`); the
  materializer receives extras with the declared fields (a non-name key
  by its canonical text); `strict: true` refuses them
  (`schema/undeclared-field`, `Registry#putStrict`).
- A keyed struct entry whose key is not a name — `%Point{1 => 2}` — is an
  extra field instead of an error.
- **A struct is matched only by a struct** (`DXN.md` §4.7). A field
  typed `User` accepts a `DXNStruct` named `User`, or the class
  registered for `User`; a `Map`, a plain object, any other value, and a
  class registered for no schema or another are type errors. Until now
  every non-struct value was accepted.
- **Nothing is converted to make a value match its type.** The
  schema-driven coercion and the `coerce:` option are removed
  (`src/schema/coercion.cjs` is gone): a `number` for a `:rational` or
  `:decimal` field, a string for `:uuid`, `:uri` or `:char`, a `Date` for
  `:date` or `:datetime` and an array for `:list` or `:tuple` are now
  refused. A host value always means the same DXN type, schema or not.
- A native `Date` always means a `timestamp`: `encode`, `encodeBinary`
  and `canonical` write it as one, and a `:timestamp` field accepts it.

### Changed

- **Published as `@joetjen/dextrin`** (the unscoped npm `dextrin` is
  deprecated in its favour): `npm install @joetjen/dextrin`,
  `require('@joetjen/dextrin')`. The `dextrin` command keeps its name.
- Licensed under the Apache License 2.0 (`Apache-2.0`); it was MIT.
- **A registered class instance carries extra fields**: an own property
  its schema does not declare is written as an extra field (text entries,
  the trailing tag-215 map in `.dxnb`), as an Elixir struct's undeclared
  keys are. It was dropped.
- **An absent field is never written as `nil`** (`DXN.md` §4.3): a field
  an instance does not have, or holds as `undefined`, is left out of
  text, and in `.dxnb`, which fills every position, written as its
  default or refused (`schema/missing-field`). Both writers wrote `nil`,
  which the same schema then refused to read back.
- **Every schema violation carries its `DXN.md` §5 category**:
  `schema/field-count`, `schema/missing-field`, `schema/type-mismatch`
  and `schema/shadowed-field`, decoding text or binary and encoding
  alike. They came back as `syntax` from text, `binary` from binary,
  and with no category from an encode. `SchemaValidationError` gains a
  `category`.
- `dextrin conformance` loads a case's `schemas` and honours `strict`.

- **A map key must be one of the eight types of `DXN.md` §1.6**
  (`string`, keyword, integer, uuid, date, bytes, symbol, char). Any other
  key -- a float, `null`, a boolean, a time, a collection, ... -- is
  refused as `key/not-allowed` when decoding text or binary and when
  encoding, in maps and ordered maps alike.
- A repeated key such as `?c` merges into one entry, the last one, and a
  lookup with an equal key finds it: a plain `Map` compared object keys
  by identity, so `%{?c => 1, ?c => 2}` had two entries.
- **A schema's body is its fields, in order**:
  `User: %schema(3){name: :string, email: :string, id?: :uuid}`. The
  `fields: @ordered %{...}` wrapper is gone, and so are `closed:`,
  `forbidden:` and `refine-fn:`; `Schema.compile` and
  `FileResolver.forPaths` lose their `predicates` argument. A failed
  compile throws an error of category `schema/compile`.

### Fixed

- A symbol whose name is not an identifier is refused by the text
  writers (`encode/unsupported`): `encode`, the pretty printer and
  `canonical` wrote its name verbatim, which read back as something else,
  or as nothing (`''`). `.dxnb` keeps any name.

- A keyed struct written to `.dxnb` went on the wire in the order of its
  keys rather than its schema's field order, so it came back with its
  fields swapped.
- A negative-zero decimal keeps its sign: `-0.0M` decoded as `0.0M`.
  Nothing is normalised (`DXN.md` §1.5); a value is written as it was
  given.
- A walk over a struct's fields — stripping the schema marker, the
  check on the way out, and the schema compiler's own normalising —
  rebuilt the struct from its name and fields; it now changes only the
  fields, so nothing else the struct carries is lost.

## [0.1.0] - 2026-08-14

### Added

- Generated API documentation ([TypeDoc](https://typedoc.org/), driven
  by the existing `tsconfig.json`'s `allowJs`/`checkJs` JSDoc setup —
  no source changes needed), published to GitHub Pages via
  `.github/workflows/docs.yml` on every push to `main`, mirroring
  `dextrin`'s own ExDoc/Hex Docs setup. `npm run docs` builds it
  locally into `doc/` (gitignored).
- `src/dextrin.cjs`'s own `@fileoverview` now names its reference
  implementation and sibling port (`dextrin` on Hex.pm, `php-dextrin`
  on Packagist), alongside the existing README "Other language
  implementations" section.
- Project scaffold: `package.json`, dual CJS/ESM entry-point
  convention, Mocha/Chai test setup, `tsc --checkJs` type-checking.
- Core DXN value model (`src/values/`): wrapper classes for every DXN
  type without a lossless native JS equivalent (`DXNSymbol`,
  `DXNKeyword`, `DXNList`, `DXNTuple`, `DXNOrderedMap`,
  `DXNSortedSet`, `DXNStruct`, `DXNDecimal`, `DXNRational`, `DXNChar`,
  `DXNDate`, `DXNTime`, `DXNTimestamp`, `DXNDateTime`, `DXNDuration`,
  `DXNUUID`, `DXNURI`, `DXNBytes`, `DXNRegex`, `DXNCustomTag`), each
  with documented two-way conversion helpers to/from its closest
  native JS counterpart where one genuinely exists.
- Shared structural equality/ordering kernel (`src/values/equality.js`,
  `dxnEquals`/`dxnCompare`/`canonicalKey`/`kindOf`) backing every
  value shape, native and wrapped alike.
- `.dxn` text codec: `decode`/`encode` (`src/text/`), a hand-written
  recursive-descent lexer/parser directly off `DXN.md` §1's EBNF (no
  parser-generator dependency), a single-line printer, and a
  multi-line pretty formatter (`encode(value, { pretty: true })`).
  Full round-trip fidelity verified against `DXN.md` §3's own worked
  example and `fast-check` property tests.
- `DXNError` (`src/error.cjs`) — one error type for every `dextrin`
  failure mode. `decode`/`encode` throw it on failure, a deliberate
  divergence from `Dextrin`'s `{:ok, _} | {:error, _}` tuples (an
  API-shape choice, not a value-representation one — see that
  module's own doc).
- `require('dextrin')`/`import 'dextrin'` entry point
  (`src/dextrin.{cjs,js}`) now exports the value model, package
  version, `decode`/`encode`, and `DXNError`; `decodeBinary`/
  `encodeBinary` (`.dxnb`) land in a later phase.

- `.dxnb` binary codec: `decodeBinary`/`encodeBinary` (`src/binary/`),
  a hand-rolled CBOR encoder/decoder over `Buffer` — major types 0–7,
  the registered tags (1 timestamp, 2/3 bignum, 4 decimal, 30
  rational, 32 uri, 37 uuid), and the private tag block (200–214,
  `src/binary/tags.cjs`). Verified against `DXN.md` §3's own worked
  example, a by-type round-trip suite, and `fast-check` property
  tests. A 500-iteration fuzz test (random bytes after a valid
  envelope) confirms malformed input always fails as a clean
  `BinaryError`, never an uncaught crash.
- Value sharing (`DXN.md` §2.5, tags 28/29) and string-reference
  sharing (§2.4, tags 256/25) are decode-side only for now — spec-
  mandatory to *accept*, optional to *produce* ("not required for a
  conforming encoder to produce"). A tag-29 reference resolves to a
  deep-cloned independent copy, not a shared object reference, per
  §2.5's "no decoder-visible aliasing" requirement — genuinely needed
  in JS, where (unlike Erlang terms) compound values are mutable.
  Producing shared references on encode is deferred, not forgotten.

- `.dxns` schema system: `Registry` (`src/registry.cjs`, plain
  immutable-update-style data, mirroring `Dextrin.Registry`), the
  `schema/` compiler/validator/type-expr matcher (all 12 `type_expr`
  forms, all 26 primitives), `Schema.compile`/`validate`/
  `validateEncode`/`validateEncodeTree`/`registerProvider`
  (`schema.cjs`, mirroring `Dextrin.Schema`), `Std.registry()` (ported
  `priv/schema/std.dxns` standard named-type library), and
  `FileResolver.forPaths()` (`Namespace/Name` → `.dxns`-file
  resolution for `Registry#putResolver`). Wired into `decode`/
  `encode`/`decodeBinary`/`encodeBinary` as `registry:`/`validate:`/
  `schema:` options — a `struct`/tag with no matching registry entry
  still falls back to an opaque `DXNStruct`/`DXNCustomTag`, never a
  hard failure.
- **Schema-driven type coercion on encode** (`coerce:`, default
  `true`) — no Elixir `dextrin` equivalent: when a field's value
  doesn't already match its declared type, `schema/coercion.cjs`
  tries every `DXN*` class's own `fromX()` conversion helper before
  treating it as a genuine mismatch (a plain `number` becomes a
  `DXNRational` for a `:rational` field, a native `Date` becomes a
  `DXNDate` for a `:date` field, recursively through `list-of`/
  `set-of`/`tuple-of`/`nilable`/`one-of` too). `coerce: false` for
  strict validation with no silent conversion.
- `schema/provider.cjs`'s `DXNSchemaProvider`: lets a class's own
  library ship its DXN schema without depending on `dextrin` at all —
  a plain, duck-typed object shape (no Elixir-style `@behaviour`/
  `Code.ensure_loaded?` ceremony needed; see that module's own doc for
  why those don't translate to Node the same way).
- `dextrin` CLI (`bin/dextrin.js`, wired via `package.json`'s `bin`
  field): `decode`/`encode`/`format`/`validate` subcommands, the
  Node-idiomatic analog of `dextrin`'s per-`mix dextrin.*`-task
  layout. No analog of `mix dextrin.gen.schema`/`mix dextrin.gen.
  unicode` (see the CLI's own file-level doc for why), and `encode`
  has no `--share` flag yet (`.dxnb` encoding doesn't produce
  value-sharing output, see the binary codec notes above).
- Guides: `guides/dxn/{DXN.md,TUTORIAL.md,DXN_EXAMPLES.md,
  DXN_CHEATSHEET.md}` (the implementation-independent format spec,
  ported with light JS-facing link/reference edits) and this
  project's own `guides/{TUTORIAL.md,EXAMPLES.md,CHEATSHEET.md}`
  (JS-API-level, every code sample verified to actually run).

### Fixed

- `src/text/formatter.cjs`'s `renderEntry()` used to treat *any*
  plain string map key as keyword-shaped (`typeof key === 'string' ?
  key : Printer.keywordEntryName(key)`) — correct only for a
  `DXNStruct`'s own field-name pairs (always keyword-shaped by
  construction), but wrong for a `Map`/`DXNOrderedMap` entry whose key
  is a genuine `string`: it silently rendered `id: 1` instead of the
  correct `"id" => 1`, disagreeing with `src/text/printer.cjs`'s own
  (correct) single-line rendering of the identical value, and with
  `src/binary/encoder.cjs`'s own map-key encoding — the same class of
  keyword/string map-key inconsistency independently found and fixed
  in this project's `dextrin`/`php-dextrin` sibling ports, here
  surfacing specifically in the pretty-printer. Fixed by giving struct
  field names their own dedicated `renderKeywordEntry()`/
  `bracketedKeywordEntries()` path (mirroring `printer.cjs`'s existing
  `printKeywordEntry()`/`printStruct()` split), so the shared `Map`/
  `DXNOrderedMap` entry path only ever treats an actual `symbol`/
  `DXNKeyword` key as keyword-shaped. Found via a cross-language
  round-trip check against `dextrin`/`php-dextrin`.

### Notes

- Encode-time schema checking can *return a transformed value*, not
  just validate — a deliberate divergence from `Dextrin.Schema.
  Validator`'s own check-only contract, required for coercion's
  result to actually reach the printer/binary encoder (see
  `schema/validator.cjs`'s own doc).
