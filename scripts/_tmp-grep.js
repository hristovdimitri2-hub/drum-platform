// Temp: extract failing test names from test log
const fs = require('fs');
const log = fs.readFileSync(process.env.TEMP + '/t.log', 'utf8').replace(/\r\n/g, '\n');
const lines = log.split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('not ok')) {
    out.push(lines[i]);
    out.push(lines[i + 1] || '');
    out.push(lines[i + 2] || '');
    out.push('---');
  }
}
fs.writeFileSync(process.env.TEMP + '/fails.txt', out.join('\n'));
console.log('extracted ' + (out.length / 4) + ' failures');
