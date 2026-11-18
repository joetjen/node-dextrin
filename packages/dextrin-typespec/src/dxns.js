// DXN text for the TypeSpec types the emitter meets (dextrin/design/typespec.md,
// the construct table). Each function answers DXN text; the emitter puts the
// entries of a namespace together and lets node-dextrin lay them out, so the
// output never depends on how these strings are spaced.

import {
  getDoc,
  getSummary,
  getMinLength,
  getMaxLength,
  getMinValue,
  getMaxValue,
  getMinValueExclusive,
  getMaxValueExclusive,
  getMinValueAsNumeric,
  getMinValueForScalar,
  getMaxValueForScalar,
  getMinValueExclusiveForScalar,
  getMaxValueExclusiveForScalar,
  getMinItems,
  getMaxItems,
  getPattern,
  getPatternData,
  getFormat,
  isSecret,
  isKey,
  getDeprecationDetails,
  getExamples,
  getLifecycleVisibilityEnum,
  getVisibilityForClass,
  isTemplateDeclaration,
  getFriendlyName,
  getTypeName,
} from "@typespec/compiler";

/** DXN text for a string. */
export function str(text) {
  return JSON.stringify(text).replace(/\\u([0-9a-f]{4})/gi, (_, h) => `\\x{${h}}`);
}

/** A keyword, `:name`. */
export const kw = (name) => `:${name}`;

/** A tuple form, `{:head a b}`. */
export const form = (head, ...items) => `{${kw(head)}${items.map((i) => " " + i).join("")}}`;

/** A refine of `base`, or `base` itself when there is nothing to say. */
export function refine(base, constraints) {
  const keys = Object.entries(constraints).filter(([, v]) => v !== undefined);
  if (keys.length === 0) return base;
  return form("refine", base, `%{${keys.map(([k, v]) => `${k}: ${v}`).join(" ")}}`);
}

/** `{:doc type %{...}}`, or `type` itself with no annotation. */
export function doc(type, notes) {
  const keys = Object.entries(notes).filter(([, v]) => v !== undefined);
  if (keys.length === 0) return type;
  return form("doc", type, `%{${keys.map(([k, v]) => `${k}: ${v}`).join(" ")}}`);
}

/** TypeSpec's standard scalars, by name (§1 of the construct table). */
export const STD_SCALARS = {
  numeric: kw("number"),
  integer: kw("integer"),
  float: kw("float"),
  decimal: kw("decimal"),
  int8: kw("int8"),
  int16: kw("int16"),
  int32: kw("int32"),
  int64: kw("int64"),
  uint8: kw("uint8"),
  uint16: kw("uint16"),
  uint32: kw("uint32"),
  uint64: kw("uint64"),
  safeint: refine(kw("integer"), { min: "-9007199254740991", max: "9007199254740991" }),
  float32: kw("float32"),
  float64: kw("float"),
  decimal128: refine(kw("decimal"), {
    "max-precision": "34",
    "min-exponent": "-6176",
    "max-exponent": "6111",
  }),
  string: kw("string"),
  boolean: kw("boolean"),
  bytes: kw("bytes"),
  url: kw("uri"),
  plainDate: kw("date"),
  plainTime: kw("time"),
  utcDateTime: kw("timestamp"),
  offsetDateTime: kw("datetime"),
  duration: kw("duration"),
};

/** The formats DXNS checks itself (DXNS.md §2a). */
export const DXNS_FORMATS = new Set([
  "date", "time", "datetime", "local-datetime", "duration", "uuid", "ipv4", "ipv6",
  "hostname", "idn-hostname", "email", "idn-email", "uri", "uri-reference", "iri",
  "iri-reference", "uri-template", "json-pointer", "relative-json-pointer", "semver",
  "mac", "host-port", "http-date",
]);

/** A TypeSpec value (a default, an example, a bound) as DXN text. */
export function value(v) {
  if (v === undefined || v === null) return "nil";
  switch (v.valueKind) {
    case "StringValue":
      return str(v.value);
    case "NumericValue":
      return v.value.toString();
    case "BooleanValue":
      return String(v.value);
    case "NullValue":
      return "nil";
    case "ArrayValue":
      return `[${v.values.map(value).join(" ")}]`;
    case "ObjectValue":
      return `%{${[...v.properties.values()].map((p) => `${str(p.name)} => ${value(p.value)}`).join(" ")}}`;
    case "EnumValue":
      return str(v.value.value ?? v.value.name);
    case "ScalarValue":
      return scalarValue(v);
    default:
      return "nil";
  }
}

// A scalar built with a constructor, `utcDateTime.fromISO("...")`: the DXN
// literal it stands for; the constructor's name is lost (construct table §1).
function scalarValue(v) {
  const arg = v.value?.args?.[0];
  const text = arg?.valueKind === "StringValue" ? arg.value : String(arg?.value ?? "");
  switch (v.scalar?.name) {
    case "utcDateTime":
    case "offsetDateTime":
      return `@datetime ${str(text)}`;
    case "plainDate":
      return `@date ${str(text)}`;
    case "plainTime":
      return `@time ${str(text)}`;
    case "duration":
      return `@duration ${str(text)}`;
    default:
      return str(text);
  }
}

/** The annotations a declaration's decorators say (construct table §6). */
export function notes(program, type) {
  const deprecated = getDeprecationDetails(program, type);
  const examples = safe(() => getExamples(program, type)) ?? [];
  return {
    title: safe(() => getSummary(program, type)) && str(getSummary(program, type)),
    description: getDoc(program, type) && str(getDoc(program, type)),
    deprecated: deprecated ? str(deprecated.message) : undefined,
    examples: examples.length ? `[${examples.map((e) => value(e.value)).join(" ")}]` : undefined,
  };
}

/** The annotations a property's decorators say besides its type's constraints. */
export function propertyNotes(program, prop) {
  const lifecycle = safe(() => getLifecycleVisibilityEnum(program));
  let visibility;
  if (lifecycle) {
    const seen = safe(() => getVisibilityForClass(program, prop, lifecycle));
    if (seen && seen.size > 0 && seen.size < lifecycle.members.size) {
      visibility = `[${[...seen].map((m) => kw(m.name.toLowerCase())).join(" ")}]`;
    }
  }
  const pattern = safe(() => getPatternData(program, prop));
  return {
    ...notes(program, prop),
    key: safe(() => isKey(program, prop)) ? "true" : undefined,
    secret: isSecret(program, prop) || isSecret(program, prop.type) ? "true" : undefined,
    visibility,
    messages: pattern?.validationMessage ? `%{pattern: ${str(pattern.validationMessage)}}` : undefined,
  };
}

/** The refine constraints on a type or property (construct table §6). */
export function constraints(program, type) {
  const format = getFormat(program, type);
  const pattern = getPattern(program, type);
  return {
    "min-length": num(getMinLength(program, type)),
    "max-length": num(getMaxLength(program, type)),
    min: bound(getMinValue(program, type), getMinValueForScalar(program, type)),
    max: bound(getMaxValue(program, type), getMaxValueForScalar(program, type)),
    "exclusive-min": bound(getMinValueExclusive(program, type), getMinValueExclusiveForScalar(program, type)),
    "exclusive-max": bound(getMaxValueExclusive(program, type), getMaxValueExclusiveForScalar(program, type)),
    "min-count": num(getMinItems(program, type)),
    "max-count": num(getMaxItems(program, type)),
    pattern: pattern ? `@regex ${str(pattern)}` : undefined,
    format: format && DXNS_FORMATS.has(format) ? kw(format) : undefined,
  };
}

/** A format DXNS does not know, kept in `meta` (T673 Q5). */
export function unknownFormat(program, type) {
  const format = getFormat(program, type);
  return format && !DXNS_FORMATS.has(format) ? format : undefined;
}

function num(n) {
  return n === undefined ? undefined : String(n);
}

// A bound is a number, or on a date, time or duration a scalar value
// (`utcDateTime.fromISO("...")`), written as its DXN literal.
function bound(n, scalarValue) {
  if (n !== undefined) return String(n);
  return scalarValue ? value(scalarValue) : undefined;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export { isTemplateDeclaration, getFriendlyName, getTypeName, getMinValueAsNumeric };
