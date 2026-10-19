import { expect } from 'chai';
import { parse } from '../../src/text/parser.cjs';
import { compile } from '../../src/schema/compiler.cjs';
import Registry from '../../src/registry.js';
import { print } from '../../src/text/printer.cjs';
import { pretty } from '../../src/text/formatter.cjs';

class Point {
  /** @param {number} x @param {number} y */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

describe('text print/pretty with a registry', () => {
  const schemaDoc = parse('%{ Point: %schema{ x: :float, y: :float } }');

  it('print() serializes a registered class instance as its named struct form', () => {
    const registry = compile(schemaDoc, new Registry()).putStructModule('Point', Point);
    expect(print(new Point(1.0, 2.0), { registry })).to.equal('%Point(1){x:1.0,y:2.0}');
  });

  it('print() throws for an unregistered class instance, same as before', () => {
    expect(() => print(new Point(1.0, 2.0))).to.throw(TypeError);
  });

  it('print() falls back to a registered tag encoder when no schema module matches', () => {
    class Meters {
      constructor(n) {
        this.n = n;
      }
    }
    const registry = new Registry().putTagEncoder(Meters, 'meters', (v) => v.n);
    expect(print(new Meters(5n), { registry })).to.equal('@meters 5');
  });

  it('pretty() renders a registered class instance multi-line, like an equivalent keyed struct', () => {
    const registry = compile(schemaDoc, new Registry()).putStructModule('Point', Point);
    expect(pretty(new Point(1.0, 2.0), { registry })).to.equal('%Point(1){\n  x: 1.0\n  y: 2.0\n}');
  });
});
