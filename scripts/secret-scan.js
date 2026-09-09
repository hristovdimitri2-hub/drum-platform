/**
 * ЕТАП 5.1 — Secret scan over the ENTIRE git history (gitleaks-equivalent,
 * deterministic, local). Patterns: live/test API keys, GitHub tokens, AWS,
 * private keys, OpenRouter, generic password assignments.
 * Allowlist: sk_test_ placeholders in .env.example/tests (documented).
 * Exit 1 if a NON-allowlisted secret is found.
 */

const { execFileSync } = require('child_process');

const REPO = 'C:/Users/AlienWare/Desktop/проекти/DRUM/drum-mvp';

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const PATTERNS = [
  { name: 'Stripe live key', re: /sk_live_[A-Za-z0-9]{10,}/ },
  { name: 'GitHub token (ghp/gho/ghu/ghs/ghr)', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'GitHub fine-grained PAT', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'OpenRouter key', re: /sk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI key', re: /sk-proj-[A-Za-z0-9\-_]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z\-_]{30,}/ },
  { name: 'Generic password assignment', re: /([Pp]assword|[Pp]asswd|[Pp]wd)\s*[=:]\s*['"][^'"]{8,}['"]/ },
];

const ALLOW = [
  /sk_test_[xX]*$/,          // .env.example placeholder (sk_test_xxx…)
  /sk_test_dummy/,
  /sk_test_1|sk_test_2/,     // test fixtures use fake short suffixes (caught by length anyway)
];

function scanBlob(commit, file, content) {
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) {
      const m = lines[i].match(p.re);
      if (!m) continue;
      if (ALLOW.some((a) => a.test(m[0]))) continue;
      hits.push(`${commit} ${file}:${i + 1} [${p.name}] ${lines[i].trim().slice(0, 100)}`);
    }
  }
  return hits;
}

function main() {
  const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
  console.log(`Scanning ${commits.length} commits x all files...`);
  const all = [];
  for (const c of commits) {
    const files = git(['ls-tree', '-r', '--name-only', c]).split('\n').filter(Boolean);
    for (const f of files) {
      let content = '';
      try { content = git(['show', `${c}:${f}`]); } catch { continue; }
      all.push(...scanBlob(c, f, content));
    }
  }
  if (all.length) {
    console.error('SECRET FINDINGS:');
    for (const h of all) console.error('  ' + h);
    process.exit(1);
  }
  console.log('CLEAN: no secrets in entire git history (' + commits.length + ' commits).');
}

main();
