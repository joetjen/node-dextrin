import { expect } from 'chai';
import { tokenize, LexError } from '../../src/text/lexer.cjs';

/** @param {string} src */
function types(src) {
  return tokenize(src).map((t) => t.type);
}

describe('text/lexer', () => {
  it('skips whitespace, commas, and comments as insignificant trivia', () => {
    expect(types('1,  2\t3\n4')).to.deep.equal(['INTEGER', 'INTEGER', 'INTEGER', 'INTEGER', 'EOF']);
    expect(types('1 # a comment\n2')).to.deep.equal(['INTEGER', 'INTEGER', 'EOF']);
  });

  it('lexes reserved words distinctly from identifiers', () => {
    expect(types('nil true false')).to.deep.equal(['NIL', 'TRUE', 'FALSE', 'EOF']);
    expect(types('NaN Infinity')).to.deep.equal(['FLOAT', 'FLOAT', 'EOF']);
  });

  it('classifies number literals by their trailing form', () => {
    expect(types('42')).to.deep.equal(['INTEGER', 'EOF']);
    expect(types('-42')).to.deep.equal(['INTEGER', 'EOF']);
    expect(types('3.14')).to.deep.equal(['FLOAT', 'EOF']);
    expect(types('5e10')).to.deep.equal(['FLOAT', 'EOF']);
    expect(types('19.99M')).to.deep.equal(['DECIMAL', 'EOF']);
    expect(types('42M')).to.deep.equal(['DECIMAL', 'EOF']);
    expect(types('22/7')).to.deep.equal(['RATIONAL', 'EOF']);
  });

  it('lexes -Infinity as one FLOAT token, distinct from a bare "-" plus identifier', () => {
    const tokens = tokenize('-Infinity');
    expect(tokens).to.have.lengthOf(2);
    expect(tokens[0]).to.include({ type: 'FLOAT', value: '-Infinity' });
  });

  it('distinguishes MAP_KEY (identifier immediately followed by ":") from a separate IDENTIFIER + KEYWORD', () => {
    expect(types('foo:1')).to.deep.equal(['MAP_KEY', 'INTEGER', 'EOF']);
    expect(types('foo :bar')).to.deep.equal(['IDENTIFIER', 'KEYWORD', 'EOF']);
  });

  it('lexes namespaced identifiers (Namespace/Name)', () => {
    const tokens = tokenize('Foo/Bar');
    expect(tokens[0]).to.include({ type: 'IDENTIFIER', value: 'Foo/Bar' });
  });

  it('lexes "_" as its own identifier, distinct from a longer "_foo" one', () => {
    expect(tokenize('_')[0]).to.include({ type: 'IDENTIFIER', value: '_' });
    expect(tokenize('_foo')[0]).to.include({ type: 'IDENTIFIER', value: '_foo' });
  });

  // DXN 0.2's sigils are gone (Jan, 2026-10-20): `~` begins no token.
  it('refuses a sigil: "~" begins no token', () => {
    for (const old of ['~D[2024-01-01]', '~T[12:00:00]', '~U[2024-01-01 12:00:00Z]', '~r/abc/i']) {
      expect(() => tokenize(old), old).to.throw(LexError);
    }
  });

  it('lexes a regex header as parentheses around an identifier', () => {
    expect(types('@regex(im) "a"')).to.deep.equal(['AT', 'IDENTIFIER', 'LPAREN', 'IDENTIFIER', 'RPAREN', 'STRING', 'EOF']);
  });

  it('lexes brackets, braces, and the leader characters as their own tokens', () => {
    expect(types('[]{}%@')).to.deep.equal(['LBRACKET', 'RBRACKET', 'LBRACE', 'RBRACE', 'PERCENT', 'AT', 'EOF']);
  });

  it('lexes the arrow token', () => {
    expect(types('1=>2')).to.deep.equal(['INTEGER', 'ARROW', 'INTEGER', 'EOF']);
  });

  it('throws LexError on an unterminated string', () => {
    expect(() => tokenize('"abc')).to.throw(LexError);
  });

  it('throws LexError on a malformed number', () => {
    expect(() => tokenize('-')).to.throw(LexError);
  });

  it('throws LexError on a genuinely unexpected character', () => {
    expect(() => tokenize('`')).to.throw(LexError);
  });
});
