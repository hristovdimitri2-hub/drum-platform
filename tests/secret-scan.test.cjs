/**
 * Batch 6 / T2 — secret-scan.js target-directory behaviour.
 *   a) repo root, no arg → CLEAN, exit 0 (legacy behaviour, CI-safe);
 *   b) clean foreign git repo (arg) → CLEAN, exit 0;
 *   c) git repo with a committed fake live key (arg) → exit 1 + detection.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'secret-scan.js');
const REPO_ROOT = path.join(__dirname, '..');

// Built at RUNTIME from parts so this committed test file itself never
// contains a contiguous `sk_live_…` sequence (the root-history scan in the
// first test would (correctly!) flag it otherwise).
const FAKE_LIVE_KEY = ['sk', '_live_', '4f8a2B9c1D7e3G5h6J7k8L9m0'].join('');

function run(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-scan-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t.local', 'commit', '-m', 'fixture');
  return dir;
}

test('T2 scan: repo root without arg → CLEAN, exit 0 (legacy behaviour)', () => {
  const r = run([], REPO_ROOT);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /CLEAN: no secrets/);
});

test('T2 scan: clean foreign repo via [dir] → CLEAN, exit 0', () => {
  const dir = makeRepo({ 'README.md': '# fixture repo\nnothing to see here.\n' });
  try {
    const r = run([dir]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /CLEAN: no secrets/);
    assert.ok(r.out.includes(dir) || r.out.includes(fs.realpathSync(dir)), 'target dir is reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2 scan: committed fake live key via [dir] → exit 1 + detected', () => {
  const dir = makeRepo({
    'notes.txt': 'harmless notes\ndeploy key: ' + FAKE_LIVE_KEY + '\n',
  });
  try {
    const r = run([dir]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /SECRET FINDINGS/);
    assert.match(r.out, /Stripe live key/);
    assert.match(r.out, /notes\.txt:2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
