// Temp: run each test file separately, report pass/fail per file
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/AlienWare/Desktop/проекти/DRUM/drum-mvp/tests';
for (const f of fs.readdirSync(dir).filter((x) => /\.(test|spec)\.(c|m)?js$/.test(x))) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, ['--test', path.join(dir, f)], { encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = e.stdout || '';
  }
  const pass = (out.match(/pass \d+/) || ['pass ?'])[0];
  const fail = (out.match(/fail \d+/) || ['fail ?'])[0];
  const failing = out.split('\n').filter((l) => l.startsWith('✖')).slice(0, 3);
  console.log(`${f}: ${pass} ${fail} (exit ${code})`);
  for (const l of failing) console.log('   ' + l.trim().slice(0, 110));
}
