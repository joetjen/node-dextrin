namespace Test;

model A { a: string; }
model B { b: int32; }
model AB {
  ...A;
  ...B;
}

model Collections {
  list: string[];
  @minItems(1) @maxItems(3) some: int32[];
  tuple: [string, int32];
  both: A & B;
  map: Record<boolean>;
  defaulted?: Record<int32> = #{ x: 1 };
}
