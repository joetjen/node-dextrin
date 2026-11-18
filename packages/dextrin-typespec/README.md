# @joetjen/dextrin-typespec

A [TypeSpec](https://typespec.io) emitter that writes DXNS, the schema
language of [Dextrin](https://github.com/joetjen/node-dextrin). TypeSpec's
own compiler resolves the program -- templates, decorators, imports,
versioning -- and the emitter writes what it declares as `.dxns` files in
Dextrin's tree layout, ready for `dextrin check`.

## Use

```sh
npm install --save-dev @typespec/compiler @joetjen/dextrin-typespec
npx tsp compile main.tsp --emit @joetjen/dextrin-typespec \
  --option "@joetjen/dextrin-typespec.emitter-output-dir=schemas"
```

or, from a Dextrin project in any language:

```sh
mix dextrin.from_typespec main.tsp --out schemas/   # Elixir
npx dextrin from-typespec main.tsp --out schemas/   # Node
bin/dextrin from-typespec main.tsp --out schemas/   # PHP
```

TypeSpec needs Node 22 or later, so this package does too.

## What it writes

- **One file per namespace**: `Acme.Shop.dxns` holds every model, scalar,
  enum and union of `namespace Acme.Shop`.
- **A versioned namespace** (`@versioned`) is one file per declaration and
  version: `Acme/Shop/Pet.dxns`, `Acme/Shop/Pet-v2.dxns`. Each version a
  declaration changes in is a `%schema(N)` or a `%type(N)[T]`, and a
  reference to something with several versions is pinned (`Acme.Shop/Color(2)`).
- **A model is a `%schema`**, an inline model an inline `%shape`, and
  each use of a template a `%schema` of its own, named by its
  `@friendlyName` or by the template and its arguments (`Page<Dog>` is
  `PageDog`); decorators become refine constraints and annotations. The full mapping, row by row, is
  Dextrin's design/typespec.md.

Every file starts with a comment naming the TypeSpec files it comes from
and saying it is generated. **Never edit it**: change the TypeSpec and run
the emitter again. The same program always gives the same bytes, so a
diff of the output is a diff of meaning.

## License

Apache-2.0.
