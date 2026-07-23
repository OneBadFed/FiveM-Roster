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
| **This workbook** (the internal roster) | **Staff only** — people you invite by share | Everything: the roster with private member details (email, DOB, phone), LOA tracker, patrol log, signups, discipline, webhooks, config |
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
3. **👥 Roster ▸ 🔌 Install Triggers** — this is the step people forget. Triggers are what make forms sync
   automatically, leaves start and expire overnight, and the public roster update live. **Run it once per copy
   of the file.**
4. **Pick your ID type:** 👥 Roster ▸ 🆔 Unique ID Type — Discord IDs (17–19 digits) or Community IDs (1–8
   digits). Every member is keyed by this ID; it's how forms, patrol logs, and transfers find people.
5. **Want to see it working before adding real people?** 🧪 Dev / QA ▸ **🎬 Load Demo Roster** fills the whole
   system with a realistic fictional department — members, processed signups, patrol hours that add up, LOA
   history. ⚠️ It **overwrites the roster**, so only use it on a fresh copy, never after real data exists.
6. **Publish the public roster:** 👥 Roster ▸ **🌐 Set Up Public Roster**, then copy the tabs you want public
   into that file (the public file's tab list is the allow-list). From then on it stays current by itself;
   🌐 Publish Public Roster forces a pass any time.

---

## 🎛️ Daily driving: the Control Panel

**👥 Roster ▸ 🎛️ Open Control Panel** is where day-to-day management happens:

- **Members** — search, filter, bulk status changes, and expandable profile cards: move/transfer a member,
  schedule a leave, see hours and history, record discipline.
- **Add member** — pick an open slot (grouped by rank), type a name and ID, done.
- **Signups** — the applicant queue (see below). Pick an applicant, pick an open slot, **Approve & seat**.
- **Dividers** — style your roster's section headers (pills, tones, icons).
- **Tools** — one-click actions and Discord webhook setup.
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
expires it on its end date, and posts the Discord embeds you've enabled. The countdown/length columns compute
themselves.

## 🚔 Patrol hours

Sessions go on the **Patrol Log** tab (or via a linked patrol form). Valid entries credit the member's HOURS
automatically; suspicious ones get **Flagged** with the reason written next to them — fix the data, or mark the
row *Processed* to approve an over-length session anyway. Totals always reconcile: a member's HOURS equals the
sum of their valid logs, no matter how much you edit, re-edit, or delete.
*(Don't touch the narrow hidden first column on that tab — it's the bookkeeping that makes un-crediting work.)*

## 📸 Activity cycles

**👥 Roster ▸ 📸 Capture & Reset Activity** archives everyone's hours to history and zeroes the week (cadence —
weekly, biweekly, monthly — is configurable in Settings, and can run itself on schedule).

---

## 🎨 Make it yours

**👥 Roster ▸ ⚙️ Engine Settings** opens the full settings studio. Nearly everything is white-label:

- **Statuses & tiers** — your status names, your hour thresholds, per-rank ladders, colors.
- **Sheets & layout** — rename any tab; tell the engine where your headers and data start.
- **Callsign format** — `S-{00}` → S-01, S-02… any prefix/padding you like.
- **Discord** — one section per channel (Audit log · LOAs · Patrol logs · Errors). Paste a webhook URL, toggle
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
   - *A member isn't getting patrol credit?* → their Unique ID on the log doesn't match the roster (the row
     will be Flagged with the reason).
4. **Every edit is audited** — Control Panel ▸ System shows who changed what, when. Editors whose email is on
   a member's roster row show up by *name*.
5. **Snapshots** — the panel keeps roster snapshots; restore is two clicks if something goes badly wrong.

---

## ✅ House rules (the short list)

- Staff get invited to **this** file; members only ever get the **public roster's** link.
- Run **🔌 Install Triggers** once on every new copy.
- Unique IDs are the backbone — keep them accurate, one per member.
- Don't edit the hidden first column on the Patrol Log.
- 🎬 Load Demo Roster is for fresh copies only — it overwrites.
- After big changes, the 🧪 Dev / QA menu can run the engine's own test suite (Parts 1–3) against sandbox tabs —
  it never touches your live data.

---

*Roster Engine v1.0.0 · white-label · Google Apps Script · see [DOCUMENTATION.md](DOCUMENTATION.md) for how it
all works inside.*
