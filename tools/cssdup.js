/* Two rules sharing a selector is legal layering. The BUG signature is the later rule re-declaring a property
   the earlier one already set — equal specificity, later silently wins, and the first declaration is dead. */
const fs = require('fs');
const file = process.argv[2] || 'ControlPanel.html';
const L = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const start = L.findIndex((l) => /<style/.test(l));
const end = L.findIndex((l) => /<\/style>/.test(l));
if (start < 0) { console.log('no <style> in ' + file); process.exit(0); }
const css = L.slice(start, end + 1).join('\n');
const base = start + 1;

let i = 0, line = 1, depth = 0, buf = '', ctx = [], pending = null;
const rules = [];
while (i < css.length) {
  const c = css[i];
  if (c === '\n') { line++; buf += c; i++; continue; }
  if (c === '/' && css[i + 1] === '*') { const j = css.indexOf('*/', i); line += (css.slice(i, j + 2).match(/\n/g) || []).length; i = j + 2; continue; }
  if (c === '{') {
    const sel = buf.trim().replace(/\s+/g, ' ');
    if (/^@/.test(sel)) ctx.push(sel);
    else if (sel) pending = { sel, line: base + line - 1, ctx: ctx.join(' > '), body: '' };
    depth++; buf = ''; i++; continue;
  }
  if (c === '}') {
    depth--;
    if (pending) { rules.push(pending); pending = null; }
    else if (ctx.length && depth < ctx.length) ctx.pop();
    buf = ''; i++; continue;
  }
  if (pending) pending.body += c;
  buf += c; i++;
}

const props = (body) => {
  const set = new Map();
  body.split(';').forEach((d) => {
    const k = d.split(':')[0];
    if (!k) return;
    const name = k.trim().toLowerCase();
    if (name && !/\s/.test(name) && !name.startsWith('--')) set.set(name, d.trim().slice(0, 60));
  });
  return set;
};

const seen = {};
rules.forEach((r) => {
  r.sel.split(',').map((x) => x.trim()).filter(Boolean).forEach((one) => {
    (seen[r.ctx + '||' + one] = seen[r.ctx + '||' + one] || []).push(r);
  });
});

let shadowed = 0, layered = 0;
const report = [];
Object.keys(seen).forEach((k) => {
  const list = seen[k]; if (list.length < 2) return;
  const sel = k.split('||')[1], c = k.split('||')[0];
  const clashes = [];
  for (let a = 0; a < list.length - 1; a++) {
    const pa = props(list[a].body);
    for (let b = a + 1; b < list.length; b++) {
      const pb = props(list[b].body);
      pa.forEach((v, name) => { if (pb.has(name)) clashes.push({ name, from: list[a], to: list[b], vFrom: v, vTo: pb.get(name) }); });
    }
  }
  if (clashes.length) { shadowed++; report.push({ sel, c, clashes }); } else layered++;
});

console.log('  ' + file + ': ' + rules.length + ' rules');
console.log('  ' + layered + ' selector(s) split across rules with NO overlapping property (legal layering)');
console.log('  ' + shadowed + ' selector(s) where a later rule OVERRIDES an earlier declaration:\n');
report.forEach((r) => {
  console.log('  ' + r.sel + (r.c ? '  [' + r.c + ']' : ''));
  r.clashes.forEach((cl) => {
    console.log('      ' + cl.name);
    console.log('         line ' + String(cl.from.line).padEnd(6) + 'dead : ' + cl.vFrom);
    console.log('         line ' + String(cl.to.line).padEnd(6) + 'wins : ' + cl.vTo);
  });
  console.log('');
});
if (!shadowed) console.log('  (no property-level shadowing found)');
