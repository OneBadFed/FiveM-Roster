# Roster Engine v1.0

**A complete personnel-management system that lives inside a Google Sheet.**
Signups, rosters, leaves of absence, patrol hours, Discord notifications, and a public roster your members can
see — all driven from one workbook, no external services, no hosting.

This README is for the person opening the roster for the **first time**. (Developers: the full system reference
is [DOCUMENTATION.md](DOCUMENTATION.md).)

---

## ⚡ The one thing to understand first

There are **two spreadsheets**:

| | Who sees it | What's in it |
|---|---|---|
| **This workbook** (the internal roster) | **Staff only** — people you invite by share | Everything: the roster with private member details (email, DOB, phone), LOA tracker, patrol log, signups, webhooks, config, system logs |
| **The public roster** (a separate file) | Your members — read-only link | A live, one-way mirror of the tabs you choose, with private columns automatically stripped |

**Never share the internal workbook with members.** Google's share list *is* the security — anyone who can view
a Sheet can read every tab in it, hidden or not. Members get the public roster's link instead; it updates itself
within seconds of any change here.

---

## 🚀 First-time setup (10 minutes)

1. **Open the workbook.** After a moment a **👥 Roster** menu appears in the menu bar. (First use asks Google
   for authorization — that's the script asking to manage *this* spreadsheet on your behalf.)
2. **👥 Roster ▸ 🚀 First-Run Setup** — creates/verifies the ⚙️ Config tab and everything the engine needs.
   Safe to run again any time; it never deletes your data.
3. First-Run Setup also installs the configured triggers. **👥 Roster ▸ 🔌 Install Triggers** reinstalls them
   after schedule changes or repairs. Public edit/change and minute catch-up triggers are installed when a
   public roster is linked. No Google Form is created or relinked; existing response-sheet formatting is retained.
4. **Pick your ID type:** 👥 Roster ▸ 🆔 Unique ID Type — Discord IDs (17–19 digits) or Community IDs (1–8
   digits). Every member is keyed by this ID; it's how forms, patrol logs, and transfers find people.
5. **Want to see it working before adding real people?** 🧪 Dev / QA ▸ **🎬 Load Demo Roster** fills the whole
   system with a realistic fictional department — members, processed signups, patrol hours that add up, LOA
   history. ⚠️ It **overwrites the roster**, so only use it on a fresh copy, never after real data exists.
6. **Publish the public roster:** 👥 Roster ▸ **🌐 Set Up Public Roster**, then copy the tabs you want public
   into that file (the public file's tab list is the allow-list). From then on it stays current by itself;
   🌐 Publish Public Roster forces a pass any time. Rows that land past the styled area of a public tab are
   dressed to match the rows above them, so a growing roster keeps its banding and status chips.

---

## 🎛️ Daily driving: the Control Panel

**👥 Roster ▸ 🎛️ Open Control Panel** is where day-to-day management happens:

- **Members** — search, filter, bulk status changes, and expandable profile cards: move/transfer a member,
  schedule a leave, see their hours trend and leave history.
- **Add member** — pick an open slot (grouped by rank), type a name and ID, done.
- **Signups** — the applicant queue (see below). Pick an applicant, pick an open slot, **Approve & seat**.
- **Tools** — one-click maintenance actions and Discord webhook setup.
- **Columns** — tell the engine which columns belong to the *person* (move with them) vs the *slot* (stay put).
- **System** — health checks, snapshots/restore, and the audit timeline.

You can also just **work directly on the sheet** — the engine watches for it:
- Type a member's hours → their activity status recomputes from your configured tiers.
- Paste an existing member's ID onto another row → a **transfer** (with a confirmation prompt).
- Set a signup row's STATUS to `Approved` → a slot picker pops up right there.

---

## 📥 How people get onto the roster

1. **They fill out your signup Google Form.** Submissions land on a response tab and sync into the
   **Roster Signups** review tab as *Pending* (automatic; or 👥 Roster ▸ 🧾 Sync Signup Form to Review).
2. **You review and approve** — Control Panel ▸ Signups (or the sheet-side STATUS dropdown). Approving seats
   them in an open slot, copies their private details onto their roster row, carries their join date, and marks
   the signup *Processed*.

## 🌴 Leaves of absence

Members submit the LOA form → the request appears at the top of the **LOA Tracker** as *Pending* → you set it
*Approved*. The engine does the rest: starts the leave on its start date (roster status flips automatically),
ends it on its end date, and posts the Discord embeds you've enabled. The countdown/length columns compute
themselves.

Two switches under ⚙️ Engine Settings ▸ Leave ▸ *Ending* control the automatic half. **Auto-end leaves** off
means nothing is ever ended on a schedule — a leave stays live until you change its status by hand (due leaves
still start). **Expire unapproved too** additionally ends a request still sitting on *Pending* once its end date
has gone by. Anything an admin has explicitly set — Denied, or your own terminal status — is never touched.

## 🚔 Patrol hours

Sessions go on the **Patrol Log** tab (or via a linked patrol form). Valid entries credit the member's HOURS
automatically; suspicious ones get **Flagged** with the reason written next to them — fix the data, or mark the
row *Processed* to approve an over-length session anyway. Totals always reconcile: a member's HOURS equals the
sum of their valid logs, no matter how much you edit, re-edit, or delete.
*(Don't touch the narrow hidden first column on that tab — it's the bookkeeping that makes un-crediting work.)*

The **Activity Panel** tab is the searchable view of all of it: one row per submitted patrol — member, start,
end, length, and its current status from the Patrol Log — with a filter button on every column, so you can
search members or dates and sort by patrol length (or anything else). It rebuilds itself after every sync, so
treat it as read-only: statuses are managed on the Patrol Log, and hand edits on the panel won't survive.

## 📸 Activity cycles

**👥 Roster ▸ 📸 Capture & Reset Activity** archives everyone's hours to history and zeroes the week (cadence —
weekly, biweekly, monthly — is configurable in Settings, and can run itself on schedule). It also rolls your
PREVIOUS-ACTIVITY columns one period older and re-applies their colouring per ⚙️ Engine Settings ▸ Sheets &
layout ▸ *Previous-activity style* (match the status colours, or a calm grey).

Prefer to close periods by hand? ⚙️ Engine Settings ▸ Automation & logging ▸ Hours reset ▸ **Auto-reset
activity** turns the scheduled reset off entirely — nothing is ever zeroed until you run the menu item yourself.
It applies immediately; the rest of the schedule fields hide while it's off.

---

## 🎨 Make it yours

**👥 Roster ▸ ⚙️ Engine Settings** opens the full settings studio. Nearly everything is white-label:

- **Statuses & tiers** — your status names, your hour thresholds, per-rank ladders, colors.
- **Sheets & layout** — rename any tab; tell the engine where your headers and data start.
- **Callsign format** — `S-{00}` → S-01, S-02… any prefix/padding you like.
- **Discord** — one section per channel (Audit log · LOAs · Patrol logs · Signups · Errors). Paste a webhook URL, toggle
  events, and design every embed in the builder with a live preview. One webhook can feed several channels.
  URLs are write-only secrets: the panel never shows them back.
- **Theme** — the colors the engine paints with.

And a rule the engine lives by: **your layout is yours.** It fills values into your design — it doesn't resize,
restructure, or reformat your sheets.

---

## 🧯 When something looks wrong

1. **Control Panel ▸ System** — the health check tells you what's misconfigured and usually offers the fix.
2. **Errors come with codes and hints** (e.g. `E-102: Config invalid — …`) — the message says what to fix.
3. **The usual suspects:**
   - *Forms not syncing? Nothing happens overnight? Public roster stale?* → 🔌 Install Triggers wasn't run on
     this copy.
   - *Renamed a tab and things stopped?* → point the engine at the new name in ⚙️ Engine Settings ▸ Sheets &
     layout.
   - *Deleted or added roster columns and now typing gets rejected* (e.g. a name refused with a "Unique ID"
     message)? → deleting a column slides the old entry-validation rules onto a neighboring column. Run
     **🚀 First-Run Setup** once — it scrubs the stranded rules and re-applies them to the right columns.
     (Columns like OOC NAME are optional; removing them is fine.)
   - *A member isn't getting patrol credit?* → their Unique ID on the log doesn't match the roster (the row
     will be Flagged with the reason).
4. **Every edit is audited** — Control Panel ▸ System shows who changed what, when. Editors whose email is on
   a member's roster row show up by *name*.
5. **Snapshots** — the panel keeps roster snapshots; restore is two clicks if something goes badly wrong.

---

## ✅ House rules (the short list)

- Staff get invited to **this** file; members only ever get the **public roster's** link.
- Run **🔌 Install Triggers** once on every new copy.
- You never add rows on the **LOA Tracker**, **Patrol Log**, or **Roster Signups** — each submission brings its
  own row (styled like your others), and leftover blank rows below the data are tidied away automatically.
- Unique IDs are the backbone — keep them accurate, one per member.
- Don't edit the hidden first column on the Patrol Log.
- 🎬 Load Demo Roster is for fresh copies only — it overwrites.
- To prepare a demo copy for another department, use **🧪 Dev / QA ▸ 🗑️ Reset for a new department…** and type **RESET DEPARTMENT**. This permanently clears members (including custom MEMBER columns), LOAs, patrol logs, signups, linked response-sheet rows, history, snapshots, webhooks, rank icons and saved department configuration. SLOT values such as ranks/callsigns, dividers, borders, formatting, custom tab names and structural column mappings remain. Other settings return to defaults with scheduled activity reset off. The public roster is disconnected before cleanup; no other spreadsheet or Google Form is changed. Engine triggers belonging to the current user are removed; any other trigger owners must remove theirs separately. Run it on a copy, inspect any manually maintained content, then link the new department's own response tabs, configure its connections and run First-Run Setup. The reset is not transactional: if it reports a failure, keep the copy private and retry after resolving the error.
- After big changes, the 🧪 Dev / QA menu can run the engine's own test suite (Parts 1–3) against sandbox tabs —
  it never touches your live data.

---

*Roster Engine v1.0.0 · white-label · Google Apps Script · see [DOCUMENTATION.md](DOCUMENTATION.md) for how it
all works inside.*


## Automatic Apps Script updates from GitHub

The local [data-integrity and recovery audit](DATA_INTEGRITY_AUDIT.md) documents interrupted patrol credits/imports, member transfers/assignments, activity-reset checkpoints and the recovery procedure. It includes local verification and live acceptance checks; these audit changes are not deployed until pushed and uploaded. Use **Roster → Recover Interrupted Transfer** for pending transfers, member assignments or linked signup approvals. An interrupted activity reset requires the checkpoint review described in that report before rerunning it.

**Reset for a new department** clears statuses, per-rank ladders, status rules, the Ranks configuration, section tags, dashboard headcount groups and embed overrides. Column mappings and physical roster layout remain intact. Empty configuration tables stay empty through startup. Without tiers, activity statuses stay unchanged; without configured leave types, leave imports and activation pause until setup is complete. Existing form submissions remain available for later import.

**Config sheet appearance:** use **Roster → Restyle Config sheet** to apply the dark layout without resetting configuration. Section headers, blue input cells, wrapped help text and colour swatches make the sheet easier to scan. Only the engine's A–E area is styled; extra columns remain untouched. First-Run Setup applies the current design once, then skips repainting an unchanged configuration.

`.github/workflows/apps-script.yml` checks the code and uploads it to the configured sheet script whenever `main` changes. It can also be run manually from GitHub Actions ? Sync Apps Script ? Run workflow. The target Script ID is `1SoCIV1N8-h_yyG9GtUgOWNO83yKxyexEUJ14dTnYRvnb5v58JGW8BQUg`.

One-time setup:

1. Enable the Apps Script API at https://script.google.com/home/usersettings.
2. Install Node.js 22, then run `npm install --global @google/clasp@3.4.1` and `clasp login`. Sign in with the Google account that can edit the target script.
3. In GitHub ? Settings ? Secrets and variables ? Actions ? New repository secret, create `CLASPRC_JSON`. Paste the full contents of your local `.clasprc.json` credential file. On Windows, it normally lives at `%USERPROFILE%\.clasprc.json`. Do not post the contents in chat or commit this file.
4. Run the workflow manually once and check the Actions log for a successful upload.

The workflow replaces the target script's source files and manifest with the repository versions. It does not run First-Run Setup, create forms, install triggers, or change spreadsheet data. Edit code in GitHub/local files going forward; manual edits in the Apps Script editor are overwritten by the next sync. Existing versioned library/web-app deployments are not updated by this workflow; it uploads the current project source only. Separate copied sheets require their own target configuration.

Google's clasp guide: https://developers.google.com/apps-script/guides/clasp.
