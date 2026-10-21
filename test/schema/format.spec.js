import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// `format:`, the superset's group 5, as dextrin 71fbec0
// (design/schema-superset.md, Jan, 2026-10-20): a string in one of a
// closed set of formats. Each is checked the same way in every
// implementation: by the reader DXN has for the tagged value, or by the
// grammar DXNS.md §2a gives.
describe('schema format', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /** @param {string} format */
  const registry = (format) => compiled(`{:refine :string %{format: :${format}}}`);

  /**
   * Whether `value` is a `T` of `r`. Only a refusal, an error with a
   * schema category, answers false: any other error is thrown on.
   * @param {unknown} value @param {any} r
   */
  const takes = (value, r) => {
    try {
      return Schema.check(value, r, 'T');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  /**
   * That `format` takes every string of `good` and refuses every one of `bad`.
   * @param {string} format @param {string[]} good @param {string[]} bad
   */
  const check = (format, good, bad) => {
    const r = registry(format);
    for (const text of good) expect(takes(text, r), `${format} should take ${JSON.stringify(text)}`).to.equal(true);
    for (const text of bad) expect(takes(text, r), `${format} should refuse ${JSON.stringify(text)}`).to.equal(false);
  };

  it('dates and times, as DXN reads their tags', () => {
    check('date', ['2026-10-20'], ['2026-13-01', '2026-10-20T00:00:00Z', '']);
    check('time', ['14:30:00', '14:30:00.123456789'], ['24:00:00', '14:30']);
    check('datetime', ['2026-10-20T14:30:00Z', '2026-10-20T14:30:00+02:00'], ['2026-10-20T14:30:00', '2026-10-20 14:30:00Z']);
    check('local-datetime', ['2026-10-20T14:30:00'], ['2026-10-20T14:30:00Z']);
    check('duration', ['P1D', 'PT2.5S'], ['P', '1D']);
  });

  it('@uuid itself reads only 8-4-4-4-12 hex digits', () => {
    for (const bad of ['123e4567e89b12d3a456426614174000', '123e4567-e89b12d3-a456-4266-14174000']) {
      expect(() => decode(`@uuid "${bad}"`))
        .to.throw()
        .with.property('category', 'syntax');
    }
  });

  it('uuid, ipv4 and ipv6, as DXN reads @uuid and @ip', () => {
    check('uuid', ['123e4567-e89b-12d3-a456-426614174000'], ['123e4567e89b12d3a456426614174000']);
    check('ipv4', ['192.0.2.1'], ['2001:db8::1', '10.0.0.0/8', '1.2.3']);
    check('ipv6', ['2001:db8::1', '::ffff:192.0.2.1'], ['192.0.2.1', '2001:db8::/32', 'fe80::1%eth0']);
  });

  it('hostname: RFC 1123 labels, 253 characters at most', () => {
    check(
      'hostname',
      ['example.com', 'a', 'xn--bcher-kva.example', 'a-b.c'],
      [
        '-a.com',
        'a-.com',
        'a..com',
        'example.com.',
        'ex_ample.com',
        'bücher.example',
        `${'a'.repeat(64)}.com`,
        Array(4).fill('a'.repeat(63)).join('.')
      ]
    );
  });

  it('idn-hostname: labels of letters, digits, marks and hyphens in any script', () => {
    check('idn-hostname', ['bücher.example', '例え.テスト', 'example.com'], ['-bücher.example', 'bü cher.example', 'a..b']);
  });

  it('email: a dot-atom or quoted local part, at a hostname or an address literal', () => {
    check(
      'email',
      ['joe@example.com', 'first.last+tag@example.com', '"joe smith"@example.com', 'joe@[192.0.2.1]', 'joe@[IPv6:2001:db8::1]'],
      [
        'joe',
        'joe@',
        '@example.com',
        '.joe@example.com',
        'jo..e@example.com',
        'joe@example..com',
        'jöe@example.com',
        'joe@[2001:db8::1]',
        `${'a'.repeat(65)}@example.com`
      ]
    );
  });

  it('idn-email: an email that may hold characters of any script', () => {
    check('idn-email', ['jöe@bücher.example', 'joe@example.com'], ['jöe', 'jöe@-bücher.example']);
  });

  it('uri and uri-reference: RFC 3986', () => {
    check(
      'uri',
      ['https://example.com/a/b?q=1#f', 'mailto:joe@example.com', 'urn:isbn:0451450523', 'http://[2001:db8::1]:8080/', 'http://user:pw@host/%20x'],
      ['/relative/path', '//example.com', 'http://exa mple.com', 'http://[nope]/', '1http://x', 'http://x/%zz']
    );
    check('uri-reference', ['/relative/path', '?q', '#f', '', '../a', 'https://example.com'], ['a:b c', 'http://exa mple.com', '%zz']);
  });

  it('iri and iri-reference: a uri that may hold characters of any script', () => {
    check('iri', ['https://bücher.example/straße'], ['/straße', 'https://bü cher.example']);
    check('iri-reference', ['/straße', 'https://bücher.example'], ['a b']);
  });

  it('uri-template: RFC 6570', () => {
    check('uri-template', ['https://example.com/{id}', '/s{?q,lang}', '{+path:6}/x', '{list*}', 'plain'], ['{', '{}', '{a b}', 'x}', '{?}', '{a:0}']);
  });

  it('json-pointer and relative-json-pointer: RFC 6901 and its draft', () => {
    check('json-pointer', ['', '/a/b', '/a~0b/c~1d', '/'], ['a', '/a~2', '/~']);
    check('relative-json-pointer', ['0', '1/a', '2#', '0/'], ['', '/a', '01', '-1', '1#/a']);
  });

  it('semver: Semantic Versioning 2.0.0', () => {
    check('semver', ['1.2.3', '0.0.0', '1.0.0-alpha.1', '1.0.0+build.5', '1.0.0-rc.1+sha.abc'], ['1.2', '01.2.3', '1.2.3-', '1.2.3-01', 'v1.2.3']);
  });

  it('mac: six or eight pairs of hex digits, one separator throughout', () => {
    check('mac', ['00:1a:2B:3c:4d:5e', '00-1a-2b-3c-4d-5e', '00:1a:2b:3c:4d:5e:6f:70'], ['00:1a:2b-3c:4d:5e', '001a2b3c4d5e', '00:1a:2b:3c:4d', '00:1a:2b:3c:4d:5e:6f']);
  });

  it('host-port: a hostname, an IPv4 address or a bracketed IPv6 one, and a port', () => {
    check('host-port', ['example.com:443', '192.0.2.1:0', '[2001:db8::1]:65535'], ['example.com', 'example.com:65536', 'example.com:08', '2001:db8::1:80', ':80']);
  });

  it('a format refuses a value that is no string', () => {
    const value = decode('@uuid "123e4567-e89b-12d3-a456-426614174000"');
    expect(takes(value, registry('uuid'))).to.equal(false);
  });

  it('an unknown format is refused when the schema compiles', () => {
    expect(() => compiled('{:refine :string %{format: :regex}}'))
      .to.throw(/format/)
      .with.property('category', 'schema/compile');
  });
});
