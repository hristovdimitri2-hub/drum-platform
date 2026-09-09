/**
 * ЕТАП 5 — build REPORT.md → REPORT.html → PDF (Edge headless, print-to-pdf).
 * Run: node scripts/build-report.js
 * Deterministic: same input → same HTML; PDF via fixed page settings.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const REPORT_MD = path.join(ROOT, 'reports', 'REPORT.md');
const REPORT_HTML = path.join(ROOT, 'reports', 'REPORT.html');
const REPORT_PDF = path.join(ROOT, 'reports', 'DRUM_Investor_Readiness_Report_v1.pdf');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('No Edge/Chrome found — install one or use pandoc.');
}

function mdToHtml(md) {
  return marked.parse(md, { async: false });
}

function htmlShell(bodyHtml) {
  return `<!DOCTYPE html><html lang="bg"><head><meta charset="utf-8">
<title>DRUM 3.0 — Investor Readiness Report v1</title>
<style>
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; color: #1a2b20; line-height: 1.5; }
  h1 { color: #0d1b12; border-bottom: 3px solid #34d17b; padding-bottom: 8px; font-size: 22pt; }
  h2 { color: #14532d; font-size: 15pt; margin-top: 22px; border-bottom: 1px solid #cfe8da; padding-bottom: 4px; page-break-after: avoid; }
  h3 { color: #14532d; font-size: 12.5pt; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 10px 0; }
  th { background: #dff2e6; text-align: left; padding: 6px 8px; border: 1px solid #b6d9c4; }
  td { padding: 5px 8px; border: 1px solid #cfe8da; }
  img { max-width: 100%; border: 1px solid #b6d9c4; border-radius: 6px; margin: 8px 0; }
  pre { background: #0d1b12; color: #b8e6cc; padding: 12px; border-radius: 8px; font-size: 8.5pt; white-space: pre-wrap; page-break-inside: avoid; }
  code { background: #eaf5ee; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
  pre code { background: transparent; }
  blockquote { border-left: 4px solid #34d17b; margin: 10px 0; padding: 6px 14px; background: #eaf5ee; }
  .cover { text-align: center; padding: 120px 0 60px; page-break-after: always; }
  .cover h1 { font-size: 34pt; border: none; color: #0d1b12; }
  .cover .sub { font-size: 16pt; color: #14532d; margin: 10px 0 40px; }
  .cover table { max-width: 480px; margin: 0 auto; font-size: 10.5pt; }
  .pagebreak { page-break-before: always; }
</style></head><body>${bodyHtml}</body></html>`;
}

function main() {
  const md = fs.readFileSync(REPORT_MD, 'utf8');
  // Split: first table = title block → styled cover; rest = normal flow.
  const firstHr = md.indexOf('\n---\n');
  const head = md.slice(0, firstHr);
  const body = md.slice(firstHr + 5);

  const headHtml = mdToHtml(head)
    .replace('<table>', '<div class="cover"><table>')
    .replace('</table>', '</table><div class="sub">Confidential — за разпространение към потенциални инвеститори</div></div>');

  const bodyHtml = mdToHtml(body)
    .replace(/<p>---<\/p>/g, '<div class="pagebreak"></div>');

  fs.writeFileSync(REPORT_HTML, htmlShell(headHtml + bodyHtml));
  console.log('HTML: ' + REPORT_HTML);

  const browser = findBrowser();
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${REPORT_PDF}`,
    'file:///' + REPORT_HTML.replace(/\\/g, '/'),
  ], { stdio: 'ignore' });

  const size = fs.statSync(REPORT_PDF).size;
  console.log(`PDF: ${REPORT_PDF} (${(size / 1024).toFixed(0)} KB)`);
}

main();
