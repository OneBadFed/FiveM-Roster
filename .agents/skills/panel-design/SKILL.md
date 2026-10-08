---
description: Rules and constraints for working on the Roster Engine's HtmlService panels (ControlPanel.html, SettingsPanel.html) — the design system, the dispatch security contract, and how to preview changes in a browser. Use when editing, restyling, or overhauling either panel, adding a settings section or control, or adding a panel server endpoint.
---

# Roster Engine — panel work

Two single-file HtmlService dialogs, no build step: **`ControlPanel.html`** (modeless 1180×760, day-to-day
management) and **`SettingsPanel.html`** (full-screen config editor). Everything ships inline in one file —
no imports, no bundler, no framework. External CSS/fonts over https *are* allowed (both panels already load
Google Fonts), but nothing is compiled, so write plain ES5-flavoured JS that runs as-is.

## See your change before you ship it

You cannot open the panels in Apps Script from here. Render them locally instead:

```bash
node tools/preview.js both        # or: settings | control
```

Writes `tools/.preview/*.preview.html` — open in any browser. `google.script.run` is stubbed, and the settings
payload is generated from the **real** `BLOCK_SPECS_`, so every key, default, enum and help string is the live
one. Do this after any visual change and ask the operator to look, or check the rendered markup yourself.

To check *behaviour* rather than looks, drive the rendered preview in headless Edge — the same engine the Apps
Script dialog runs in. Append a probe script that clicks things and writes its findings into a known element,
then read that element back:

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --user-data-dir=<scratch>/edgeprofile --virtual-time-budget=4000 --dump-dom probe.html | grep -o 'id="PROBE">[^<]*'
```

`--user-data-dir` is required or the dump comes back empty. Two traps, both of which have already cost a
debugging round: headless reports **`prefers-reduced-motion: reduce`**, so anything branching on it takes the
reduced path; and **neither animations NOR CSS transitions tick under `--virtual-time-budget`** (no compositor frames),
so sampled heights, colours and shadows stay frozen at their START value — a focus ring reads as transparent
and a just-clicked button reads as its resting colour. Inject
`*{transition:none !important;animation:none !important}` in the probe to read settled values. Timers and clicks *do* run. Use this to prove state
transitions, handler wiring and settle logic — never to judge whether motion looks right.

The same command runs two consistency checks and exits non-zero on the first:

- **Panel references a key the server never sends.** The sidebar renders from `SECTIONS` in the HTML while the
  server sends `CP_SETTINGS_KV_` from `RosterControlPanel.gs`. Nothing links them, so a key can be listed in a
  card and never arrive — the control renders blank and saving it does nothing, silently. This has shipped
  before.
- **A schema block nobody serves.** (`COLUMNS` is deliberate — SLOT/MEMBER classes are edited on Control
  Panel ▸ Columns.)

## Hard constraints

1. **Every server call goes through `dispatch(name, args)`** — design decision D5. The client never names a
   function directly. Adding an endpoint means three edits, all required: `DISPATCH_ENDPOINTS_` in
   `RosterControlPanel.gs`, `RE_ENDPOINTS` in `TEMPLATE-SHIM.gs`, and the endpoint count in `DOCUMENTATION.md`.
   Miss the shim and library-mode installs get `E-506`.
2. **`google.script.run` is asynchronous and returns nothing.** Always `withSuccessHandler` +
   `withFailureHandler`. Custom error properties are stripped in transit — `dispatch` folds the code and hint
   into the message string, so never rely on `err.code` client-side.
3. **Webhook URLs are write-only secrets.** Never render one back into the page, never log one. The panel shows
   configured/not-set, never the value.
4. **Escape everything that came from the sheet.** Config text, member names and headers are untrusted input;
   `esc()` before it reaches markup. `dcRender` escapes *first*, then builds markup — keep that order if you
   touch it.
5. **A settings key belongs to exactly one section.** `sectionOf()` returns the first match, so a duplicate
   lights one section's dirty dot and not the other's, and double-counts in search.
6. **Don't break deep links.** `openControlPanel('signups')` lands on a tab via the `initialTab` template var.

## The design system

Layered glass, and the reason it reads as one system: **elevation replaces borders.** Surfaces step
`--bg` → `--e1` → `--e2` → `--e3` → `--e4`; depth comes from `--hi` (inner top highlight) plus `--sh-1/2/3`,
not from outlines. Motion is uniformly `--t` (180ms) on `--ease`. Radii are `--r-in` (12px controls) and
`--r-card` (18px). Spacing is an 8px grid. Accent colours are per-section (`--a`), set on the section and
inherited by its cards and icons.

Keep new UI inside those tokens rather than introducing one-off hex values, shadows or timings — that
consistency is what the panels have that a generic dashboard doesn't. If a redesign changes the tokens, change
them at `:root` and let everything inherit.

## Before you commit

```bash
node tools/htmlchk.js ControlPanel.html SettingsPanel.html   # ALWAYS — see below
node tools/preview.js both                                   # renders + the two consistency checks
node tools/cfgcheck.js RosterConfig.gs                       # only if the config schema changed
```

`htmlchk` is not optional. A panel has no build step, so a syntax error in its script is invisible until the
dialog fails to open in Apps Script. The specific trap: **handlers are written entirely on one line**, so
appending a `// comment` to one comments out the rest of that line — including its closing braces. Braces still
balance (they are inside the comment), so the diff looks fine and only parsing catches it. Use `/* … */` when
annotating anything mid-line. This has bitten once already.
