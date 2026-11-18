'use strict';

/**
 * @fileoverview The hand-written regions of a generated file
 * (`codegen/javascript.cjs`): `// dextrin:keep NAME` ... `// dextrin:end
 * NAME`. Before a file is rewritten, every region of the old one is taken
 * by its name and put back into the slot of that name in the new one. A
 * region whose slot is gone -- or one the user made up where no slot is --
 * is never dropped: it is kept as `orphaned_NAME` at the end of the file,
 * inside a block comment, where it does not run (code that stood inside a
 * method would not parse at the top of a module), and `--check` fails
 * until someone moves or deletes it. The end of a block comment in its
 * code is written `*\/` there, so the comment holds. The port of php-dextrin's
 * `Codegen\Regions`, which keeps orphans after `__halt_compiler();`.
 */

const REGION = /^([ \t]*)\/\/ dextrin:keep (\S+)\n([\s\S]*?)^[ \t]*\/\/ dextrin:end \2\n/gm;
const WAS = '// Was in the region ';
const ORPHANS = '/* dextrin:orphans -- code from regions whose place is gone. It does not run here: move it, or delete it.\n';

/**
 * `generated` with the regions of `old` put back by name, those whose slot
 * is gone kept as orphans.
 * @param {string} generated the file as generated now, its slots empty
 * @param {string | null} old the file as it is on disk, if it is
 * @returns {string} the file to write
 */
function merge(generated, old) {
  if (old === null) return generated;
  /** @type {Map<string, string>} */
  const kept = new Map();
  for (const match of old.matchAll(REGION)) if (match[3] !== '') kept.set(match[2], match[3]);
  const slots = new Set(Array.from(generated.matchAll(REGION), (m) => m[2]));

  const filled = generated.replace(REGION, (whole, indent, name) => {
    const body = kept.get(name);
    return body === undefined ? whole : `${indent}// dextrin:keep ${name}\n${body}${indent}// dextrin:end ${name}\n`;
  });

  const orphans = [];
  for (const name of Array.from(kept.keys()).sort()) {
    if (slots.has(name)) continue;
    const body = /** @type {string} */ (kept.get(name)).replaceAll('*/', '*\\/');
    const was = name.startsWith('orphaned_') ? name.slice('orphaned_'.length) : name;
    const note = body.startsWith(WAS) ? '' : `${WAS}${was}, whose place is gone: move it, or delete it.\n`;
    orphans.push(`// dextrin:keep orphaned_${was}\n${note}${body}// dextrin:end orphaned_${was}\n`);
  }
  return orphans.length === 0 ? filled : `${filled}\n${ORPHANS}${orphans.join('\n')}*/\n`;
}

/**
 * The names of the orphaned regions `text` holds.
 * @param {string} text @returns {string[]}
 */
function orphans(text) {
  return Array.from(text.matchAll(/^\/\/ dextrin:keep (orphaned_\S+)$/gm), (m) => m[1]);
}

module.exports = { merge, orphans };
