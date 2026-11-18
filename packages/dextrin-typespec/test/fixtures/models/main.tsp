namespace Test;

model Base {
  id: string;
  note?: string;
}

model Pet extends Base {
  name: string;
  age?: int32 = 0;
  tags?: string[] = #["new"];
}

model Copy is Base {
  extra: boolean;
}

model Spread {
  ...Base;
  own: string;
}

model Labels {
  ...Record<string>;
  name: string;
}

model Bag is Record<int32>;

model Holder {
  inline: { a: string; b?: int32 };
  maybe?: never;
}
