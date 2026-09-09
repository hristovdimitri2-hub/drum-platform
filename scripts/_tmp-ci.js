// Temp: extract failing test lines from CI log
const fs = require('fs');
const log = fs.readFileSync(process.env.TEMP + '/ci.log', 'utf8');
const lines = log.split('\n').filter((x) => x.includes('ci\tTests\t'));
const out = [];
for (const l of lines) {
  if (l.includes('not ok') || l.includes('AssertionError') || l.includes('Error:') || l.includes('✖')) {
    out.push(l.replace(/^ci\tTests\t[^\t]*\t/, '').slice(0, 160));
  }
}
fs.writeFileSync(process.env.TEMP + '/cifails.txt', out.join('\n'));
console.log('lines: ' + lines.length + ', marks: ' + out.length);
