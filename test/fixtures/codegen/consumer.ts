// A TypeScript program using the classes `dextrin gen-js` wrote into
// generated/ from schemas/ -- generated, never edited by hand, but for the
// one hand-written upgrade in generated/Acme/Shop/Pet.js. It is never run;
// that it compiles under tsc --strict with exactOptionalPropertyTypes,
// beside the generated .js checked as JSDoc, is the test
// (test/codegen/javascript.spec.js, `npm run typecheck:consumer`).
import { decode, DXNKeyword, DXNList, DXNStruct, DXNUUID } from '@joetjen/dextrin';
import { InvalidData, type ReadOptions } from '@joetjen/dextrin/codegen-runtime';
import { AbstractPet, type FieldsV1, type FieldsV2, type UpgradeV1Fields } from './generated/Acme/Shop/AbstractPet.js';
import { Customer } from './generated/Acme/Shop/Customer.js';
import { Order } from './generated/Acme/Shop/Order.js';
import { Pet } from './generated/Acme/Shop/Pet.js';
import * as Decoder from './generated/Decoder.js';

const options: ReadOptions = {
  deprecations: 'every',
  onDeprecated: (warning) => {
    const why: string | null = warning.message;
    void why;
  }
};

// A struct of any version, read and upgraded: a Pet, its fields typed.
const pet: Pet = Pet.read(decode('%acme.shop/Pet(1){name: "Rex" colour: "red" born: 2019}'), options);
const name: string = pet.name;
const tag: string | undefined = pet.tag;
const renamed: Pet = pet.withName('Max').withTag(undefined);
// @ts-expect-error: the properties are readonly
pet.name = 'Max';
void name;
void tag;
void renamed;

// Made by hand: a field with a default may be left out; validate() checks.
const ada = new Customer({ name: 'Ada' });
const order = new Order({
  id: DXNUUID.fromString('550e8400-e29b-41d4-a716-446655440000'),
  customer: ada,
  total: new Map(),
  lines: new DXNList([]),
  note: null
});
const status: DXNKeyword | symbol = order.status;
const customer: Customer = order.customer;
const note: string | null | undefined = order.note;
const struct: DXNStruct = order.toDxn();
order.validate({ deprecations: 'error' });
void status;
void customer;
void note;
void struct;

// @ts-expect-error: a required field can't be left out
void new Customer({});

// The per-version steps, typed.
const v1: FieldsV1 = Pet.conformV1({ name: 'Rex', colour: 'red', born: 2019n });
const v2: FieldsV2 = Pet.upgradeFromV1(v1);
void v2;

// A class of TypeScript's own, with its hand-written upgrade.
export class Kitten extends AbstractPet {
  static {
    this.verify();
  }

  static upgradeV1(fields: UpgradeV1Fields): FieldsV2 {
    return { ...fields, born: String(fields.born) };
  }
}

// One without it does not compile.
export class Stray extends AbstractPet {
  static {
    // @ts-expect-error: upgradeV1 is missing
    this.verify();
  }
}

// Refusals are InvalidData, naming the field.
try {
  Customer.read(decode('%acme.shop/Customer{}'));
} catch (err) {
  if (err instanceof InvalidData) {
    const path: string[] = err.path;
    const category: string | null = err.category;
    void path;
    void category;
  }
}

// The decoder: every struct of a known schema read into its class.
const decoded: unknown = Decoder.decode('[%acme.shop/Customer{name: "Ada"}]', { deprecations: 'off', strict: true });
const known: typeof Customer = Decoder.CLASSES['acme.shop/Customer'];
void decoded;
void known;
