namespace Test;

scalar Code extends string;
@minLength(2) @maxLength(8) scalar Tag extends string;
scalar Opaque;

model Scalars {
  n: numeric;
  i: integer;
  f: float;
  d: decimal;
  i8: int8;
  i16: int16;
  i32: int32;
  i64: int64;
  u8: uint8;
  u16: uint16;
  u32: uint32;
  u64: uint64;
  s: safeint;
  f32: float32;
  f64: float64;
  d128: decimal128;
  str: string;
  b: boolean;
  by: bytes;
  u: url;
  date: plainDate;
  time: plainTime;
  utc: utcDateTime;
  off: offsetDateTime;
  dur: duration;
  nothing: null;
  any: unknown;
  code: Code;
  tag: Tag;
  opaque: Opaque;
}
