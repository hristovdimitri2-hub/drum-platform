/**
 * P2 — regression guard: no file under src/ may swallow an error silently.
 *
 * The audit listed five empty catch blocks (anomalies.js:79,175 and
 * photoProof.js:73,80,132) plus three throwaway `_tmp-*.js` driver scripts.
 * Every one of those catches now either logs (with the code/reason) or is a
 * proven-benign race that is explicitly documented. This test fails the build
 * if an empty `catch {}` / `catch (e) { /* comment *\/ }` reappears.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** `catch {}`, `catch (e) {}` or a block holding only a comment. */
const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\}/g;

test('P2 no-silent-catch: src/ contains no empty catch block', () => {
  const offenders = [];
  for (const file of walkJs(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    EMPTY_CATCH.lastIndex = 0;
    let m;
    while ((m = EMPTY_CATCH.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(ROOT, file)}:${line} → ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(offenders, [], 'silent catch blocks found:\n  ' + offenders.join('\n  '));
});

test('P2 no-silent-catch: the previously-silent modules now log', () => {
  for (const rel of ['src/services/photoProof.js', 'src/services/anomalies.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /require\('\.\/security'\)/, `${rel} must import the logger`);
    assert.ok(
      (src.match(/logger\.(warn|error|info)\(/g) || []).length >= 2,
      `${rel} must actually emit at least two log records`
    );
  }
});

test('P2 no-silent-catch: the _tmp driver scripts are gone', () => {
  const scripts = path.join(ROOT, 'scripts');
  const leftovers = fs.existsSync(scripts)
    ? fs.readdirSync(scripts).filter((f) => /^_tmp-/.test(f))
    : [];
  assert.deepEqual(leftovers, [], `throwaway scripts must be deleted: ${leftovers.join(', ')}`);
});