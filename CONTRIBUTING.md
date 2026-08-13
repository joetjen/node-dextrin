# Contributing to dextrin_js

Thanks for considering a contribution. This document covers what you
need to know before opening an issue or a pull request.

## Getting started

```sh
git clone <this repository>
cd dextrin_js
npm install
npm test
```

That should complete with no failures on a clean checkout. If it
doesn't, please open an issue before doing anything else — that's a
bug in its own right.

## Project layout

- `src/dextrin.{cjs,js}` — the public API (`decode`/`encode`/
  `decodeBinary`/`encodeBinary`) and the top-level barrel export.
- `src/values/` — the DXN value model: native JS values where one
  fits losslessly, and a small `DXN*` wrapper class (`DXNSymbol`,
  `DXNTuple`, `DXNOrderedMap`, ...) everywhere else, plus the shared
  structural equality/ordering kernel (`equality.cjs`).
- `src/text/` — the `.dxn` pipeline: a hand-written recursive-descent
  `lexer.cjs`/`parser.cjs` (no parser-generator dependency — the
  grammar in `DXN.md` §1 is small and normative enough that one isn't
  needed), `printer.cjs`/`formatter.cjs` (the reverse direction),
  `escapes.cjs` (shared string/char escape decoding), `temporal.cjs`
  (date/time/duration parsing shared by both directions).
- `src/binary/` — the `.dxnb` pipeline: `encoder.cjs`/`decoder.cjs` (a
  direct, hand-rolled CBOR codec over `Buffer`), `writer.cjs` (the
  low-level byte-header writer), `tags.cjs` (private tag/bit-layout
  constants), `errors.cjs`.
- `src/schema.cjs` + `src/schema/` — `.dxns` schema compilation and
  validation, including the schema-driven encode-time coercion
  (`coercion.cjs`) that has no Elixir `dextrin` equivalent.
- `src/registry.cjs` — the shared struct/custom-tag/type-alias
  extension point, immutable-update-style (every `put*` method returns
  a new `Registry`).
- `bin/dextrin.js` — the `dextrin` CLI (`decode`/`encode`/`format`/
  `validate` subcommands).
- `priv/schema/std.dxns` — `Std`'s source (the standard named-type
  library).
- `test/` — one directory per concern (`values/`, `text/`, `binary/`,
  `schema/`, `bin/`), plus `test/conformance/` for shared,
  cross-pipeline fixtures and `test/support/` for test-only fixtures
  (e.g. the `fast-check` `DXNValue` arbitrary generator).
- `guides/` — this project's own `TUTORIAL.md`/`EXAMPLES.md`/
  `CHEATSHEET.md`, plus `guides/dxn/` (the implementation-independent
  DXN format spec, ported from `dextrin`'s own `guides/dxn/`).

Every module under `src/` ships as a `.cjs` file (the real
implementation, `require()`-able directly) with a thin `.js` ESM
re-export wrapper alongside it — any export change touches both, and
`test/values/module-parity.spec.js`/`test/version.spec.js` check that
the two stay in sync.

## Making a change

1. **Tests first, or at least alongside.** A lexer/parser- or
   codec-level change should come with a test exercising actual
   input/output behavior, not just "does this parse." Several real
   bugs in this codebase's own history (a CBOR header byte getting
   clobbered by a missing `Buffer#writeBigUInt64BE` offset argument, a
   lexer ordering bug mis-tokenizing `19.99M`) only showed up once a
   value was hand-verified at the byte/token level, not merely
   round-tripped through this library's own (sometimes equally wrong)
   code on both ends.
2. **Round-trip both directions, where it applies.** A change to the
   shared value representation (`src/values/`) or a wrapper class
   should be checked against both `.dxn` and `.dxnb` —
   `decodeBinary(encodeBinary(v))` equal to `v` (via `dxnEquals`) in
   each pipeline independently, plus cross-format equivalence where a
   schema makes that meaningful (see `test/conformance/`).
3. **Where inputs form a space bigger than a handful of examples
   usefully covers** (parsers, encoders/decoders, merge/normalization
   logic, anything with an invariant that should hold for *all*
   inputs), prefer a `fast-check` property-based test over enumerating
   more example cases by hand — see `test/support/dxn-value.arbitrary.js`
   and the `*.property.spec.js` files for the existing pattern.
4. **Run the full verification pass before opening a PR:**

   ```sh
   npm run precommit
   ```

   Expands to `tsc --checkJs --noEmit` (type-checking the JSDoc
   annotations) followed by the full Mocha test suite.

5. **Match the existing documentation style.** Default to no comments;
   when one is warranted, explain a non-obvious *why* (a hidden
   constraint, a subtle invariant, the specific bug class it
   prevents), not what the code already makes obvious by being
   well-named. Every exported function/class gets a JSDoc block;
   update it in the same commit as any behavior change, and update
   `CHANGELOG.md` (`[Unreleased]`) and any guide under `guides/` the
   change touches — stale docs are worse than none.

## Reporting bugs

Please include: the input (`.dxn`/`.dxnb`/`.dxns` source, or a minimal
excerpt reproducing the issue), what you expected, and what actually
happened (including the full `DXNError` — `message`, `stage`,
`offset` — if one was thrown). "Doesn't parse" and "doesn't work" are
much harder to act on than a specific input/expected/actual triple.

## License

By contributing, you agree that your contributions will be licensed
under the project's [MIT license](LICENSE).
