namespace Test;

@discriminator("kind")
model Animal {
  name: string;
}

model Cat extends Animal {
  kind: "cat";
  meows: boolean;
}

model Dog extends Animal {
  kind: "dog";
  barks: boolean;
}

@discriminated(#{ envelope: "object", discriminatorPropertyName: "type", envelopePropertyName: "data" })
union Shape { circle: Circle, square: Square }

model Circle { r: float64; }
model Square { side: float64; }
