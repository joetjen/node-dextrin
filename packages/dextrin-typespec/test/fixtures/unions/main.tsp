namespace Test;

model Cat { meows: boolean; }
model Dog { barks: boolean; }

union Pet { cat: Cat, dog: Dog }

enum Color {
  Red: "red",
  Green: "green",
  #deprecated "use Green"
  Lime: "lime",
}
enum Size { Small, Large }

model Unions {
  either: Cat | Dog;
  maybe: string | null;
  pet: Pet;
  color: Color;
  size: Size;
  mode: "fast" | "slow";
  exactly: "yes";
  one: 1;
  t: true;
}
