/* Syntax-check the JS inside HtmlService panel files.
 *
 *   node tools/htmlchk.js ControlPanel.html SettingsPanel.html
 *
 * A panel's script is one enormous block, and a syntax error in it is INVISIBLE until the dialog fails to open
 * in Apps Script — there is no build step to catch it. Worth its own tool because the failure mode that prompted
 * it is easy to repeat: appending a `// comment` to a handler written entirely on ONE line comments out the rest
 * of that line, including the handler's closing braces. Braces still balance (they are inside the comment), so
 * eyeballing the diff does not reveal it; only parsing does.
 *
 * GAS scriptlets (<?= x ?> / <?!= x ?>) are resolved server-side by HtmlService, so they are stubbed to a literal
 * before parsing. tools/** is clasp-ignored — this never reaches the Apps Script project. */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/htmlchk.js <file.html> [more.html …]'); process.exit(2); }

/* A listener bound to an id that no longer exists is a PANEL-KILLER, not a dead branch: $('gone') returns null
 * and .addEventListener on null throws while the script is still initialising, so nothing below it ever runs and
 * the dialog opens blank. Syntax checking cannot see it — the code is perfectly valid. This is exactly what a
 * removed tab leaves behind, which is how it was found. */
function checkBindings(file, src) {
  const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...src.matchAll(/\$\('([A-Za-z][\w-]*)'\)\s*\.\s*addEventListener/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((i) => !ids.has(i));
  if (!missing.length) { console.log(`  ${file}: ${new Set(used).size} id-bound listeners all resolve`); return 0; }
  console.error(`  ${file}: LISTENER BOUND TO A MISSING ELEMENT — ${missing.join(', ')}`);
  console.error('      $(id) returns null and .addEventListener throws during init; the panel opens blank.');
  return 1;
}

let failed = 0;
files.forEach((file) => {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error(`  ${file}: cannot read — ${e.message}`); failed = 1; return; }

  if (checkBindings(file, src)) failed = 1;

  const blocks = src.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  if (!blocks.length) { console.log(`  ${file}: no <script> blocks`); return; }

  blocks.forEach((block, i) => {
    const js = block
      .replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '')
      .replace(/<\?!?=?[\s\S]*?\?>/g, 'null'); // GAS template scriptlet -> a literal the parser accepts
    const label = `${file}${blocks.length > 1 ? ` [block ${i + 1}]` : ''}`;
    try {
      new Function(js);
      console.log(`  ${label}: OK (${js.split('\n').length} lines)`);
    } catch (e) {
      failed = 1;
      console.error(`  ${label}: SYNTAX ERROR — ${e.message}`);
      // Bisect by line so the report points at a place to look, not just "unexpected end of input".
      const lines = js.split('\n');
      let lastGood = 0;
      for (let n = 1; n <= lines.length; n++) {
        try { new Function(lines.slice(0, n).join('\n')); lastGood = n; } catch (ignored) { /* keep scanning */ }
      }
      if (lastGood && lastGood < lines.length) {
        console.error(`      last line that still parsed on its own: ${lastGood}`);
        console.error(`      first suspect line ${lastGood + 1}: ${String(lines[lastGood] || '').trim().slice(0, 120)}`);
      }
    }
  });
});
process.exit(failed);
