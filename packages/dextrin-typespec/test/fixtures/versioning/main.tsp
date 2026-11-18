import "@typespec/versioning";
using Versioning;

@versioned(Versions)
namespace Test;

enum Versions { v1: "2024-01-01", v2: "2024-06-01" }

enum Color { red, green, @added(Versions.v2) blue }

model Pet {
  name: string;
  @renamedFrom(Versions.v2, "colour") color: Color;
  @added(Versions.v2) @madeOptional(Versions.v2) age?: int32;
}

@added(Versions.v2)
model Owner { pet: Pet; }
