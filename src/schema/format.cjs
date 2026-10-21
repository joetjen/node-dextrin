'use strict';

/**
 * @fileoverview The formats a refine's `format:` names (DXNS.md §2a,
 * Jan, 2026-10-20): a closed set, each checked the same way in every
 * implementation, mirroring `Dextrin.Schema.Format`. A format DXN has a
 * tag for is read by that tag's reader; every other one by a grammar
 * written as a regular expression that PCRE, JavaScript (with the `u`
 * flag) and PHP all read alike. The grammars below are the reference's,
 * character for character, built from the same parts.
 */

const temporal = require('../text/temporal.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNIp = require('../values/ip.cjs');

// ---- the grammars' parts, RFC 3986 and RFC 3987 ---------------------------

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HOSTNAME = `^${LABEL}(?:\\.${LABEL})*$`;
const U_LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\p{M}-]{0,61}[\\p{L}\\p{N}\\p{M}])?';
const IDN_HOSTNAME = `^${U_LABEL}(?:\\.${U_LABEL})*$`;

const ATEXT = "[\\-A-Za-z0-9!#$%&'*+/=?^_`{|}~]";
// Past ASCII: every character an IRI or an internationalised address
// adds, written so PCRE, JavaScript and PHP read it alike.
const BEYOND = '[^\\x00-\\x7F]';
const QUOTED = String.raw`"(?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*"`;
const LOCAL = `^(?:${ATEXT}+(?:\\.${ATEXT}+)*|${QUOTED})$`;
const IDN_ATEXT = `(?:${ATEXT}|${BEYOND})`;
const IDN_LOCAL = `^(?:${IDN_ATEXT}+(?:\\.${IDN_ATEXT}+)*|${QUOTED})$`;

/**
 * The URI grammar; `extra` is what an IRI adds to the characters a URI
 * leaves unencoded: every character past ASCII; nothing for a URI.
 * `absolute` asks for a scheme, else a relative reference.
 * @param {string} extra @param {boolean} absolute @returns {string}
 */
function uriGrammar(extra, absolute) {
  const pct = `%[0-9A-Fa-f]{2}${extra}`;
  const u = "\\-A-Za-z0-9._~!$&'()*+,;=";
  const pchar = `(?:[${u}:@]|${pct})`;
  const nc = `(?:[${u}@]|${pct})`;
  const userinfo = `(?:(?:[${u}:]|${pct})*@)?`;
  const host = `(?:\\[[^\\]]*\\]|(?:[${u}]|${pct})*)`;
  const authority = `${userinfo}${host}(?::[0-9]*)?`;
  const abempty = `(?:/${pchar}*)*`;
  const absolutePath = `/(?:${pchar}+(?:/${pchar}*)*)?`;
  const rootless = `${pchar}+(?:/${pchar}*)*`;
  const noscheme = `${nc}+(?:/${pchar}*)*`;
  const tail = `(?:\\?(?:${pchar}|[/?])*)?(?:#(?:${pchar}|[/?])*)?`;

  return absolute
    ? `^[A-Za-z][A-Za-z0-9+.-]*:(?://${authority}${abempty}|${absolutePath}|${rootless}|)${tail}$`
    : `^(?://${authority}${abempty}|${absolutePath}|${noscheme}|)${tail}$`;
}

const URI_EXTRA = '';
const IRI_EXTRA = `|${BEYOND}`;

const VARSPEC = '(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9][0-9]{0,3}|\\*)?';
const URI_TEMPLATE = `^(?:[^\\x00-\\x20"'%<>\\\\^\`{|}\\x7F]|%[0-9A-Fa-f]{2}|\\{[+#./;?&=,!@|]?${VARSPEC}(?:,${VARSPEC})*\\})*$`;

const JSON_POINTER = '^(?:/(?:[^~/]|~[01])*)*$';
const RELATIVE_JSON_POINTER = '^(?:0|[1-9][0-9]*)(?:#|(?:/(?:[^~/]|~[01])*)*)$';

const SEMVER =
  '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)' +
  '(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?' +
  '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';

const MAC = '^[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\\1[0-9A-Fa-f]{2}){4}(?:(?:\\1[0-9A-Fa-f]{2}){2})?$';
const PORT = '^(?:0|[1-9][0-9]{0,4})$';

// A `[...]` host in a URI, and RFC 3986's IPvFuture inside one.
const BRACKETED_HOST = '//[^/?#]*?\\[([^\\]]*)\\]';
const IP_FUTURE = "^v[0-9A-Fa-f]+\\.[A-Za-z0-9._~!$&'()*+,;=:-]+$";

/** @type {{[name: string]: string}} */
const GRAMMARS = {
  hostname: HOSTNAME,
  'idn-hostname': IDN_HOSTNAME,
  'uri-template': URI_TEMPLATE,
  'json-pointer': JSON_POINTER,
  'relative-json-pointer': RELATIVE_JSON_POINTER,
  semver: SEMVER,
  mac: MAC
};

const NAMES = [
  'date', 'time', 'datetime', 'local-datetime', 'duration', 'uuid', 'ipv4', 'ipv6', 'hostname', 'idn-hostname',
  'email', 'idn-email', 'uri', 'uri-reference', 'iri', 'iri-reference', 'uri-template', 'json-pointer',
  'relative-json-pointer', 'semver', 'mac', 'host-port'
];

/** Every format's name, sorted. @returns {string[]} */
function names() {
  return [...NAMES].sort();
}

/** @type {Map<string, RegExp>} */
const COMPILED = new Map();

/**
 * The grammar `source` compiled with the `u` flag, once, on first use.
 * @param {string} source @param {string} [flags] @returns {RegExp}
 */
function regex(source, flags = 'u') {
  const key = `${flags}/${source}`;
  let re = COMPILED.get(key);
  if (re === undefined) {
    re = new RegExp(source, flags);
    COMPILED.set(key, re);
  }
  return re;
}

// A lone surrogate: a string that is no Unicode text, as a binary that
// is no UTF-8 is none to the reference's `String.valid?/1`.
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * Whether `text` is in the format named `name`.
 * @param {string} name @param {string} text @returns {boolean}
 */
function valid(name, text) {
  return typeof text === 'string' && !LONE_SURROGATE.test(text) && check(name, text);
}

/**
 * Whether `read` takes `text` without throwing: a tag's own reader.
 * @param {(text: string) => unknown} read @param {string} text @returns {boolean}
 */
function reads(read, text) {
  try {
    read(text);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} name @param {string} text @returns {boolean} */
function check(name, text) {
  switch (name) {
    case 'date':
      return reads(temporal.parseDate, text);
    case 'time':
      return reads(temporal.parseTime, text);
    case 'datetime':
      return reads(temporal.parseDateTime, text);
    case 'local-datetime':
      return reads(temporal.parseLocalDateTime, text);
    case 'duration':
      return reads(temporal.parseDuration, text);
    case 'uuid':
      return reads(DXNUUID.fromString, text);
    case 'ipv4':
      return address(text, 4);
    case 'ipv6':
      return address(text, 6);
    // RFC 1123's labels, the whole at most 253 codepoints.
    case 'hostname':
    case 'idn-hostname':
      return codepoints(text) <= 253 && matches(name, text);
    case 'email':
      return email(text, LOCAL, 'hostname');
    case 'idn-email':
      return email(text, IDN_LOCAL, 'idn-hostname');
    case 'uri':
      return uri(text, URI_EXTRA, true);
    case 'uri-reference':
      return uri(text, URI_EXTRA, true) || uri(text, URI_EXTRA, false);
    case 'iri':
      return uri(text, IRI_EXTRA, true);
    case 'iri-reference':
      return uri(text, IRI_EXTRA, true) || uri(text, IRI_EXTRA, false);
    case 'host-port': {
      const at = text.lastIndexOf(':');
      if (at < 0) return false;
      const host = text.slice(0, at);
      const port = text.slice(at + 1);
      return hostPortHost(host) && regex(PORT).test(port) && Number(port) <= 65_535;
    }
    default:
      return matches(name, text);
  }
}

/** @param {string} name @param {string} text @returns {boolean} */
function matches(name, text) {
  return regex(GRAMMARS[name]).test(text);
}

/**
 * `text`'s length in codepoints, as DXN.md counts a string's length (the
 * reference counted graphemes until a56339b).
 * @param {string} text @returns {number}
 */
function codepoints(text) {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Whether `text` is an address, no prefix, of IP `version`, as `@ip` reads it.
 * @param {string} text @param {4 | 6} version @returns {boolean}
 */
function address(text, version) {
  try {
    const ip = DXNIp.fromString(text);
    return ip.prefix === null && ip.version === version;
  } catch {
    return false;
  }
}

/**
 * A local part, `@`, then a hostname or an address literal: `[IPv4]` or
 * `[IPv6:...]` (RFC 5321 §4.1.3); the local part at most 64 bytes.
 * @param {string} text @param {string} local @param {string} hostname @returns {boolean}
 */
function email(text, local, hostname) {
  const at = text.lastIndexOf('@');
  if (at < 0) return false;
  const name = text.slice(0, at);
  const domain = text.slice(at + 1);
  return Buffer.byteLength(name, 'utf8') <= 64 && regex(local).test(name) && (check(hostname, domain) || addressLiteral(domain));
}

/** @param {string} domain @returns {boolean} */
function addressLiteral(domain) {
  if (domain.startsWith('[IPv6:')) return bracketed(domain.slice('[IPv6:'.length), 6);
  if (domain.startsWith('[')) return bracketed(domain.slice(1), 4);
  return false;
}

/** @param {string} rest @param {4 | 6} version @returns {boolean} */
function bracketed(rest, version) {
  return rest.endsWith(']') && address(rest.slice(0, -1), version);
}

/** @param {string} host @returns {boolean} */
function hostPortHost(host) {
  if (host.startsWith('[')) return addressLiteral(`[IPv6:${host.slice(1)}`);
  return check('hostname', host) || address(host, 4);
}

/**
 * The grammar, then any `[...]` host an IPv6 address or RFC 3986's
 * IPvFuture.
 * @param {string} text @param {string} extra @param {boolean} absolute @returns {boolean}
 */
function uri(text, extra, absolute) {
  if (!regex(uriGrammar(extra, absolute)).test(text)) return false;
  for (const [, inside] of text.matchAll(regex(BRACKETED_HOST, 'gu'))) {
    if (!(address(inside, 6) || regex(IP_FUTURE).test(inside))) return false;
  }
  return true;
}

module.exports = { names, valid };
