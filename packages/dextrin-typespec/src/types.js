// TypeSpec types as DXNS text (dextrin/design/typespec.md, §1 to §6).
//
// `declarationText` writes a named declaration -- a model is a `%schema`
// (T673 Q3), a scalar, enum or union a named type -- and `typeText` any
// type where it is used: a declaration by its name, everything else in
// place, an inline model as an inline `%shape`.

import {
  getAvailabilityMap,
  getRenamedFrom,
  getTypeChangedFrom,
  getMadeOptionalOn,
} from "@typespec/versioning";
import {
  isTemplateDeclaration,
  getDiscriminator,
  getDiscriminatedUnion,
  getFriendlyName,
} from "@typespec/compiler";
import {
  STD_SCALARS,
  str,
  kw,
  form,
  refine,
  doc,
  value,
  notes,
  propertyNotes,
  constraints,
  unknownFormat,
} from "./dxns.js";

// ---- versions (Way B, dextrin/design/typespec.md) ---------------------------------

// While a versioned namespace is written, the TypeSpec version being
// projected: which members are there, under what name and type, and the
// DXNS version each versioned declaration has at it (`pins`).
let at = null;

/** Runs `fn` with types read as they are at `version` (`index` in the timeline). */
export function atVersion(context, fn) {
  const before = at;
  at = context;
  try {
    return fn();
  } finally {
    at = before;
  }
}

function present(type) {
  if (!at) return true;
  const availability = getAvailabilityMap(at.program, type);
  if (!availability) return true;
  const here = availability.get(at.version.name);
  return here === "Added" || here === "Available";
}

const versionIndex = (v) => at.versions.findIndex((x) => x.name === v.name);

function nameAt(prop) {
  if (!at) return prop.name;
  const renamed = (getRenamedFrom(at.program, prop) ?? []).find((r) => versionIndex(r.version) > at.index);
  return renamed ? renamed.oldName : prop.name;
}

function typeAt(prop) {
  if (!at) return prop.type;
  const changes = [...(getTypeChangedFrom(at.program, prop) ?? new Map()).entries()]
    .filter(([v]) => versionIndex(v) > at.index)
    .sort(([a], [b]) => versionIndex(a) - versionIndex(b));
  return changes.length ? changes[0][1] : prop.type;
}

// The name a property had before the version being written, when that
// version renames it (`@renamedFrom`): what an upgrade from the version
// before moves (T684 Q4).
function renamedHere(prop) {
  if (!at) return undefined;
  return (getRenamedFrom(at.program, prop) ?? []).find((r) => versionIndex(r.version) === at.index)?.oldName;
}

function optionalAt(prop) {
  if (!at) return prop.optional;
  const madeOptional = getMadeOptionalOn(at.program, prop);
  if (madeOptional && at.index < versionIndex(madeOptional)) return false;
  // @madeRequired is not read yet: @typespec/versioning 0.88 does not export
  // its getter, so a property made required counts as required throughout.
  return prop.optional;
}

// A declaration by name, pinned to its DXNS version when it has several.
// In a versioned namespace every declaration has a file of its own, where
// only a full name resolves (DXNS.md §6), so the name is written in full.
function ref(decl) {
  const name = at ? `${namespacePath(decl.namespace)}/${decl.name}` : decl.name;
  const pin = at?.pins.get(decl);
  return pin ? `${name}(${pin})` : name;
}

// Instances named with @friendlyName become entries of their own, written
// where their template is declared: by program, `namespace path -> name ->
// text`.
const named = new WeakMap();

/** The named instances met so far in `program`, by namespace path. */
export function namedInstances(program) {
  if (!named.has(program)) named.set(program, new Map());
  return named.get(program);
}

// An entry written beside the declarations of `ns`: a named instance, or a
// discriminated model's base.
function addEntry(program, ns, name, text) {
  const byNs = namedInstances(program);
  const path = namespacePath(ns);
  if (!byNs.has(path)) byNs.set(path, new Map());
  byNs.get(path).set(name, text);
}

// The name a model is extended or included by: a template instance's
// own (`PageDog`), and a discriminated model's fields live in
// `<Name>Base`, its own name being the union of what extends it.
function baseRef(program, model) {
  if (model.templateMapper) return instance(program, model);
  return getDiscriminator(program, model) ? `${model.name}Base` : model.name;
}

/** A namespace's dotted path, `Acme.Shop`. */
export function namespacePath(ns) {
  const parts = [];
  for (let n = ns; n && n.name; n = n.namespace) parts.unshift(n.name);
  return parts.join(".");
}

/** A named declaration's DXNS, or `undefined` for one with none (an operation). */
export function declarationText(program, decl) {
  switch (decl.kind) {
    case "Scalar":
      return scalarDeclaration(program, decl);
    case "Model":
      return modelDeclaration(program, decl);
    case "Enum":
      return enumDeclaration(program, decl);
    case "Union":
      return unionDeclaration(program, decl);
    default:
      return undefined;
  }
}

/** A type where it is used. */
export function typeText(program, type) {
  switch (type.kind) {
    case "Intrinsic":
      return { null: kw("nil"), unknown: kw("any"), never: kw("never") }[type.name] ?? kw("any");
    case "Scalar":
      return scalarUse(program, type);
    case "Model":
      return modelUse(program, type);
    case "Enum":
    case "Union":
      return type.name && !type.expression ? ref(type) : unionInline(program, type);
    case "String":
    case "Number":
    case "Boolean":
      return form("const", literal(type));
    case "StringTemplate":
      return form("const", str(type.stringValue ?? ""));
    case "Tuple":
      return form("list-items", ...type.values.map((t) => typeText(program, t)));
    case "EnumMember":
      return form("const", str(type.value ?? type.name));
    case "TemplateParameter":
      return type.node.id.sv;
    default:
      return kw("any");
  }
}

function literal(type) {
  return type.kind === "String" ? str(type.value) : String(type.value);
}

// ---- scalars ------------------------------------------------------------------

function isStd(type) {
  return type.namespace?.name === "TypeSpec" && !type.namespace.namespace?.name;
}

function scalarUse(program, scalar) {
  if (isStd(scalar)) return STD_SCALARS[scalar.name] ?? kw("any");
  return ref(scalar);
}

function scalarDeclaration(program, scalar) {
  const base = scalar.baseScalar ? scalarUse(program, scalar.baseScalar) : undefined;
  if (base === undefined) return doc(kw("any"), { title: str(scalar.name) });
  const format = unknownFormat(program, scalar);
  const type = refine(base, constraints(program, scalar));
  return doc(type, {
    ...notes(program, scalar),
    meta: format ? `%{"typespec.format" => ${str(format)}}` : undefined,
  });
}

// ---- models -------------------------------------------------------------------

function isArray(model) {
  return model.name === "Array" && isStd(model);
}

function isRecord(model) {
  return model.name === "Record" && isStd(model);
}

// An array's or a record's element: its indexer's value, or inside a
// template declaration, where `T[]` has none yet, its argument.
function element(model) {
  return model.indexer?.value ?? model.templateMapper?.args?.[0];
}

function modelUse(program, model) {
  if (isArray(model)) return form("list-of", typeText(program, element(model)));
  if (isRecord(model)) return form("map-of", kw("string"), typeText(program, element(model)));
  if (model.templateMapper && model.name) return instance(program, model);
  if (model.name) return ref(model);

  // An inline shape can't be built from others (DXNS.md §4b), so an inline
  // intersection or spread is every part at once.
  const parts = (model.sourceModels ?? []).map((s) => s.model).filter((m) => m.name);
  if (parts.length > 0) {
    const inherited = new Set(parts.flatMap((m) => [...m.properties.keys()]));
    const own = [...model.properties.values()].filter((p) => !inherited.has(p.name));
    const rest = own.length ? [`%shape{${own.map((p) => field(program, p)).join(" ")}}`] : [];
    return form("all-of", ...parts.map((m) => modelUse(program, m)), ...rest);
  }

  return shape(program, model, "shape");
}

// A use of a template, `Page<Dog>` (T673 Q3): a named `%schema` of its own,
// named by its @friendlyName, otherwise by the template's name followed by
// its arguments' (`PageDog`), written where the template is declared.
function instance(program, model) {
  const name = getFriendlyName(program, model) ?? instanceName(program, model);
  addEntry(program, model.namespace, name, doc(shape(program, model, "schema"), notes(program, model)));
  return ref({ name, namespace: model.namespace });
}

// Trailing arguments that are their parameters' defaults are left out of
// the name: `Page<Dog>` and `Page<Dog, int32>` are both `PageDog`.
function instanceName(program, model) {
  const args = [...model.templateMapper.args];
  const defaults = defaultsOf(program, model.namespace?.models.get(model.name));
  while (args.length > 0 && defaults[args.length - 1] !== undefined && defaults[args.length - 1] === args[args.length - 1]) {
    args.pop();
  }
  return model.name + args.map((a) => argName(program, a)).join("");
}

// A template declaration's parameter defaults, by position.
function defaultsOf(program, decl) {
  return (decl?.node?.templateParameters ?? []).map((node) =>
    node.default ? program.checker.getTypeForNode(node.default) : undefined,
  );
}

// A template argument's part of an instance's name.
function argName(program, arg) {
  if (arg.kind === "Model" && arg.templateMapper) return getFriendlyName(program, arg) ?? instanceName(program, arg);
  if (arg.kind === "Model" && isArray(arg)) return argName(program, element(arg)) + "List";
  if (arg.name) return arg.name.charAt(0).toUpperCase() + arg.name.slice(1);
  if (arg.kind === "String" || arg.kind === "Number" || arg.kind === "Boolean") {
    return String(arg.value).replace(/[^\p{L}\p{N}]+/gu, "_");
  }
  return "Of";
}

function modelDeclaration(program, model) {
  // A template is written as each of its instances (T673 Q3), not itself.
  if (isTemplateDeclaration(model)) return undefined;

  // `@discriminator("kind")`: the model's fields go to `<Name>Base`, which
  // its derived models extend, and the model itself is one of them (G3).
  const discriminator = getDiscriminator(program, model);
  if (discriminator) {
    addEntry(program, model.namespace, `${model.name}Base`, shape(program, model, "schema"));
    const variants = model.derivedModels.map((m) => m.name);
    return doc(form("one-of", ...variants), {
      ...notes(program, model),
      discriminator: kw(discriminator.propertyName),
    });
  }

  if (model.properties.size === 0 && model.indexer && !model.baseModel) {
    return form("map-of", kw("string"), typeText(program, model.indexer.value));
  }
  return doc(shape(program, model, "schema"), notes(program, model));
}

// A model's body: its own properties as fields, the bases it extends or
// spreads in the head, a Record's indexer as `* :string => V - *`.
function shape(program, model, kind) {
  const bases = [];
  if (model.baseModel) bases.push(`extends ${baseRef(program, model.baseModel)}`);

  const spreads = (model.sourceModels ?? [])
    .filter((s) => s.usage === "spread" || s.usage === "is" || s.usage === "intersection")
    .map((s) => s.model)
    .filter((m) => m.name && !isRecord(m));

  const inherited = new Set(spreads.flatMap((m) => [...m.properties.keys()]));
  if (spreads.length > 0) bases.push(`includes ${spreads.map((m) => baseRef(program, m)).join(" ")}`);

  const fields = [];
  for (const [name, prop] of model.properties) {
    if (inherited.has(name) && spreads.some((m) => m.properties.get(name) === prop.sourceProperty)) continue;
    if (!present(prop)) continue;
    fields.push(field(program, prop));
  }

  const record = (model.sourceModels ?? []).find((s) => isRecord(s.model));
  const indexer = record?.model.indexer ?? (model.indexer && !isArray(model) ? model.indexer : undefined);
  if (indexer) fields.push(`* :string => ${typeText(program, indexer.value)} - *`);

  const head = bases.length ? ` ${bases.join(" ")} ` : "";
  return `%${kind}${head}{${fields.join(" ")}}`;
}

function field(program, prop) {
  const name = nameAt(prop);
  const key = optionalAt(prop) ? `${name}?` : name;
  let type = refine(typeText(program, typeAt(prop)), constraints(program, prop));
  const format = unknownFormat(program, prop);
  const renamed = renamedHere(prop);
  const meta = [
    format && `"typespec.format" => ${str(format)}`,
    renamed && `"typespec.renamed-from" => ${str(renamed)}`,
  ].filter(Boolean);
  type = doc(type, {
    ...propertyNotes(program, prop),
    meta: meta.length ? `%{${meta.join(" ")}}` : undefined,
  });

  // `= utcDateTime.now()`: a default computed when the field is filled (G8).
  const dv = prop.defaultValue;
  if (dv?.valueKind === "ScalarValue" && dv.value?.name === "now") {
    return `${key}: %field{type: ${type} computed: :now}`;
  }

  if (dv !== undefined) return `${key}: %field{type: ${type} default: ${value(dv)}}`;

  return `${key}: ${type}`;
}

// ---- enums and unions -----------------------------------------------------------

function enumDeclaration(program, en) {
  const members = [...en.members.values()].filter(present);
  const values = members.map((m) => (m.value !== undefined ? literalValue(m.value) : str(m.name)));
  // A member's name is its title only where it is not already its value.
  const memberNotes = members
    .map((m, i) => {
      const deprecated = notes(program, m).deprecated;
      const title = values[i] === str(m.name) ? undefined : `title: ${str(m.name)}`;
      const parts = [title, deprecated && `deprecated: ${deprecated}`].filter(Boolean);
      return parts.length ? `${values[i]} => %{${parts.join(" ")}}` : undefined;
    })
    .filter(Boolean)
    .join(" ");

  return doc(form("enum", ...values), {
    ...notes(program, en),
    values: memberNotes ? `%{${memberNotes}}` : undefined,
  });
}

function literalValue(v) {
  return typeof v === "string" ? str(v) : String(v);
}

function unionDeclaration(program, union) {
  if (isTemplateDeclaration(union)) return undefined;
  const [discriminated] = getDiscriminatedUnion(program, union);
  if (discriminated) return doc(discriminatedUnion(program, discriminated), notes(program, union));
  return doc(unionInline(program, union), notes(program, union));
}

// `@discriminated`: with envelope "object", a shape whose discriminator
// field chooses the type of its envelope field by `{:case}`; with "none",
// one of the variants, the discriminator annotated (G3).
function discriminatedUnion(program, du) {
  const { envelope, discriminatorPropertyName: tag, envelopePropertyName: data } = du.options;
  const keys = [...du.variants.keys()];
  const types = keys.map((k) => typeText(program, du.variants.get(k)));

  if (envelope === "object") {
    const branches = keys.map((k, i) => `${str(k)} => ${types[i]}`).join(" ");
    return `%shape{${tag}: ${form("enum", ...keys.map(str))} ${data}: ${form("case", tag, `%{${branches}}`)}}`;
  }

  return doc(form("one-of", ...types), { discriminator: kw(tag) });
}

// `"a" | "b"` and a union of literals is an enum; `T | null` a nilable;
// named variants are titled; anything else an any-of.
function unionInline(program, union) {
  if (union.kind === "Enum") return union.name;
  const variants = [...union.variants.values()];
  const types = variants.map((v) => v.type);

  if (types.every((t) => t.kind === "String" || t.kind === "Number")) {
    return form("enum", ...types.map(literal));
  }

  const nonNull = types.filter((t) => !(t.kind === "Intrinsic" && t.name === "null"));
  if (nonNull.length === types.length - 1 && nonNull.length === 1) {
    return form("nilable", typeText(program, nonNull[0]));
  }

  const named = variants.every((v) => typeof v.name === "string");
  return form(
    "any-of",
    ...variants.map((v) =>
      named && !union.expression ? doc(typeText(program, v.type), { title: str(v.name) }) : typeText(program, v.type),
    ),
  );
}

export { getDiscriminator };
