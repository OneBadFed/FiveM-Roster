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
2. **👥 Roster ▸ 🚀 Setup ▸ First-Run Setup** — creates/verifies the ⚙️ Config tab and prepares missing support sheets: snapshots, integrity log, leave coverage and hours history (using configured tab names). New support sheets contain formatted headers only; existing records are preserved. Startup applies the shared dark layout and column filters to SYS Log, Edit Log and these four support sheets, with readable headers, wrapped text, suitable column widths and a dark background through the unused rows. Logs and snapshots show newest records first; Hours History shows newest weeks first, including legacy date cells. New writes maintain this order and resize filters as needed, preserving filter criteria. Retention removes oldest records from the bottom and keeps complete snapshots. Leave Coverage rebuilds with newest requests first (legacy requests without submission timestamps fall back to their start date); its summary stays outside the filter. Run First-Run Setup once on an existing roster to apply these changes, then rebuild Leave Coverage to refresh that view. Unused columns are hidden while populated custom columns stay visible. Newly created snapshots and hours history are hidden. The main roster/template sheets must already exist.
   Safe to run again any time; it never deletes your data.
3. First-Run Setup also installs the configured triggers. **👥 Roster ▸ 🚀 Setup ▸ Install / repair triggers** reinstalls them
   after schedule changes or repairs. Public edit/change and minute catch-up triggers are installed when a
   public roster is linked. No Google Form is created or relinked; existing response-sheet formatting is retained.
4. **Pick your ID type:** 👥 Roster ▸ 🚀 Setup ▸ Unique ID type — Discord IDs (17–19 digits) or Community IDs (1–8
   digits). Every member is keyed by this ID; it's how forms, patrol logs, and transfers find people.
5. **Want to see it working before adding real people?** 🧪 Dev / QA ▸ Demo / department reset ▸ **Load demo data (overwrites this copy)…** fills the whole
   existing roster slots with fictional members, processed signups, matching patrol hours and leave history.
   IDs, tiers, leave statuses and member-owned shifts follow your settings; slot-owned shifts stay in place.
   With no activity tiers configured (including after department reset), hours are seeded and ordinary activity
   and history statuses stay blank; configured leaves and per-rank ladders still apply. The result explains this.
   It **overwrites member and tracking records**. Use a dedicated copy with its own connections: retained form
   responses can be imported later, and a linked public roster receives demo data through its publishing queue.
   See [DEMO_AUDIT.md](DEMO_AUDIT.md) for checks, prerequisites and live verification limits.
6. **Publish the public roster:** 👥 Roster ▸ 🌐 Public roster ▸ **Set up / change public roster…**, then copy the tabs you want public
   into that file (the public file's tab list is the allow-list). From then on it stays current by itself;
   🌐 Public roster ▸ Publish now forces a pass any time. Rows that land past the styled area of a public tab are
   dressed to match the rows above them, so a growing roster keeps its banding and status chips.
   Completed tables publish together; catch-ups retry only remaining work while retaining concurrent edits.
   The manifest enables the advanced Sheets service for bulk dimension copying, with a complete fallback.
   After an update, approve any Google permission prompt when running **Public roster → Publish now**.
   Standard Cloud projects also need the Google Sheets API enabled; default projects enable it automatically.
   Full publishes and
   background passes taking ten seconds or more include total/per-tab timings in SYS Log. See
   [PUBLISH_AUDIT.md](PUBLISH_AUDIT.md) for performance changes and live verification steps.
   Linking installs automatic publish triggers even if First-Run Setup ran before the public file existed.
   For a previously linked department whose edits update only when forced, run **Install Triggers** once after
   updating the code, or force-publish once to repair its triggers. Welcome application status at **AA5:AA6**
   mirrors automatically; **F6:W7** remains the only Welcome area owned by the public copy.

---

## 🎛️ Daily driving: the Control Panel

The Roster menu has eight main entries: Control Panel, Engine Settings, Review Roster Signups, Refresh & Update All, Public roster, Form sync, Maintenance and Setup. Infrequent repairs and destructive resets are grouped inside submenus. **Refresh & Update All** imports all linked forms, reconciles credits and statuses, updates derived views, then publishes; its summary identifies failed or skipped steps. See [MENU_AUDIT.md](MENU_AUDIT.md) for every action reviewed and the verification limits.

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
- Paste an existing member's ID onto another row → a **transfer** (with a confirmation prompt). If maintenance or publishing is busy, the confirmed move stays queued and retries automatically; leave the pasted ID in place. Clear it to cancel an unstarted move. Group/Academy views update in the background rather than keeping the transfer dialog waiting.
- Set a signup row's STATUS to `Approved` → a slot picker pops up right there.

Academy and shift/division refreshes use the same member-row rules as the main roster: divider, header and footer rows are excluded. Genuine missing/duplicate member IDs stop the affected refresh before it clears existing records; SYS Log identifies the sheet and ID cell to correct. Competing refreshes keep their work queued for the next sweep instead of reporting lock contention as a failed build.

After uploading the transfer retry update, run **Roster → Setup → Install / repair triggers** once. The member-transfer edit catch-up and minute worker also run in internal rosters with no linked public file. Queued transfers recheck the approved identity, ranks, column classification and destination fields; conflicts pause the move and appear in SYS Log. Use **Maintenance → Recover interrupted member changes** for an interrupted copy/clear operation.

---

## 📥 How people get onto the roster

1. **They fill out your signup Google Form.** Submissions land on a response tab and sync into the
   **Roster Signups** review tab as *Pending* (automatic; or 👥 Roster ▸ 📥 Form sync ▸ Signup form → review).
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

**👥 Roster ▸ 🛠️ Maintenance ▸ Capture & reset activity…** archives everyone's hours to history and zeroes the week (cadence —
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
- To prepare a demo copy for another department, use **🧪 Dev / QA ▸ Demo / department reset ▸ Reset for a new department…** and type **RESET DEPARTMENT**. This permanently clears members (including custom MEMBER columns), LOAs, patrol logs, signups, linked response-sheet rows, history, snapshots, webhooks, rank icons and saved department configuration. SLOT values such as ranks/callsigns, dividers, borders, formatting, custom tab names and structural column mappings remain. Other settings return to defaults with scheduled activity reset off. The public roster is disconnected before cleanup; no other spreadsheet or Google Form is changed. Engine triggers belonging to the current user are removed; any other trigger owners must remove theirs separately. Run it on a copy, inspect any manually maintained content, then link the new department's own response tabs, configure its connections and run First-Run Setup. The reset is not transactional: if it reports a failure, keep the copy private and retry after resolving the error.
- The old in-sheet test suite was replaced by freshly authored QA scenarios. **Dev / QA → Run all QA tests** runs 775 core scenarios and 17 Sheets platform checks using synthetic data in a new sandbox tab **inside your internal roster**; **core logic** and **Sheets platform** can run separately. After testing, run-owned helper tabs are removed and that same sandbox becomes **🧪 QA Results**, styled like Config with a summary, filterable case results, status colours and wrapped diagnostics. Older reports and live roster tabs stay intact. QA tabs are excluded from public publishing, dashboards, Settings pickers and edit-audit notifications. No live roster writers, forms, triggers or public publishing actions are executed by this suite. Repository verification uses `node tools/qa.js`: 28 suites/checks, including 279 additional local service/feature fault scenarios and existing regressions. See [QA_TESTING.md](QA_TESTING.md) for coverage and limits. Demo loading, department reset and old sandbox cleanup remain separate tools.

---

*Roster Engine v1.0.0 · white-label · Google Apps Script · see [DOCUMENTATION.md](DOCUMENTATION.md) for how it
all works inside.*


## Automatic Apps Script updates from GitHub

The local [data-integrity and recovery audit](DATA_INTEGRITY_AUDIT.md) documents interrupted patrol credits/imports, member transfers/assignments, activity-reset checkpoints and the recovery procedure. It includes local verification and live acceptance checks; these audit changes are not deployed until pushed and uploaded. Use **Roster → Maintenance → Recover interrupted member changes** for pending transfers, member assignments or linked signup approvals. An interrupted activity reset requires the checkpoint review described in that report before rerunning it.

**Reset for a new department** clears statuses, per-rank ladders, status rules, the Ranks configuration, section tags, dashboard headcount groups and embed overrides. Column mappings and physical roster layout remain intact. Empty configuration tables stay empty through startup. Without tiers, activity statuses stay unchanged; without configured leave types, leave imports and activation pause until setup is complete. Existing form submissions remain available for later import.

**Live Welcome statistics:** Settings → Ranks manages icons and rank labels; Dashboard & sections manages the headcount groups and live-display switch. Recognized Welcome statistic boxes, tags and the patrol leaderboard refresh after roster and relevant Settings changes, preserving the sheet design. Use `#group:division1` for a custom group or `#active` for the highest activity tier. Changes queue for the installed worker and then public publication; unchanged counters cause no additional writes. See [DASHBOARD_AUDIT.md](DASHBOARD_AUDIT.md) for supported box layouts and audit coverage.

All three form-response settings accept a blank value to disable that intake. Blank leave-form intake does not block publishing, auditing, manual tracker entries or leave scheduling. Group markers can use any department heading, such as `#group: Duty rotation = Swings`, regardless of its column position. Alternatively configure the assignment heading under Settings → Roster layout → Shift header. Blank assignment keywords leave unresolved assignment views inactive with existing rows retained.

If **Publish now** encounters an active publisher, it waits briefly for the background pass to yield. If it still cannot start, it queues a full publish and reports that automatic retry is pending. Completed passes recover immediately after busy cleanup; live owners are never forcibly unlocked. These fixes affect the sheet after the source is uploaded; live Google timing/permissions still require verification.

**Config sheet appearance:** use **Roster → Maintenance → Restyle Config sheet** to apply the dark layout without resetting configuration. Section headers, blue input cells, wrapped help text and colour swatches make the sheet easier to scan. Only the engine's A–E area is styled; extra columns remain untouched. First-Run Setup applies the current design once, then skips repainting an unchanged configuration.

`.github/workflows/apps-script.yml` checks the code and uploads it to the configured sheet script whenever `main` changes. It can also be run manually from GitHub Actions ? Sync Apps Script ? Run workflow. The target Script ID is `1SoCIV1N8-h_yyG9GtUgOWNO83yKxyexEUJ14dTnYRvnb5v58JGW8BQUg`.

One-time setup:

1. Enable the Apps Script API at https://script.google.com/home/usersettings.
2. Install Node.js 22, then run `npm install --global @google/clasp@3.4.1` and `clasp login`. Sign in with the Google account that can edit the target script.
3. In GitHub ? Settings ? Secrets and variables ? Actions ? New repository secret, create `CLASPRC_JSON`. Paste the full contents of your local `.clasprc.json` credential file. On Windows, it normally lives at `%USERPROFILE%\.clasprc.json`. Do not post the contents in chat or commit this file.
4. Run the workflow manually once and check the Actions log for a successful upload.

The workflow replaces the target script's source files and manifest with the repository versions. It does not run First-Run Setup, create forms, install triggers, or change spreadsheet data. Edit code in GitHub/local files going forward; manual edits in the Apps Script editor are overwritten by the next sync. Existing versioned library/web-app deployments are not updated by this workflow; it uploads the current project source only. Separate copied sheets require their own target configuration.

If **Install Triggers** previously stopped with "Another trigger installation is running," update the script and retry **Roster → Setup → Install / repair triggers**. Trigger setup now uses a separate user lock so public publishing and member changes cannot occupy its setup lock. Approve permissions if prompted and check that the completion message includes **Public roster: live on edit**. Automatic publishing requires a linked public file and those installed triggers.

Google's clasp guide: https://developers.google.com/apps-script/guides/clasp.
