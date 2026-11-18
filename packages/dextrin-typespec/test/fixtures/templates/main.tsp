namespace Test;

model Dog {
  name: string;
}

model Page<T, Size extends integer = int32> {
  items: T[];
  size?: Size;
}

// An alias is not kept by TypeSpec: its uses arrive inlined.
alias Pair<T> = [T, T];

@friendlyName("{name}List", T)
model List<T> {
  entries: T[];
}

model Dogs is Page<Dog>;

model Stamped {
  at?: utcDateTime = utcDateTime.now();
}

model Uses {
  dogs: Page<Dog>;
  pair: Pair<string>;
  list: List<Dog>;
}
