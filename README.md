# BillableHours

Freelance time logging and invoicing — log the client, the work title, and
the hours per task, then generate a detailed invoice. Built for Stephen's
own freelance work. **Not a product for sale (yet).**

## Live app — phone and PC

The live app runs as a Muse app: open **BillableHours** from the Library
in the Muse app on Android, or on the PC in the browser. Entries logged on
the phone show up on the PC and vice versa — the data is kept server-side
in the app, shared across devices.

No accounts, no sign-ups, no third-party cloud, no paid services.

## Standalone page (this repo)

`index.html` + `app.js` + `billable.js` is the same app as a plain web
page. Open `index.html` in any browser; on the standalone page the data
is kept in that browser's localStorage.

## What it does

- **Clients** — name, contact email, address, hourly rate, currency
  (default USD), payment terms (Net days). Plus contact information:
  contact person, phone (tap-to-call), website, and contact notes.
- **Documents — SOW / requirements** — a client's statement of work or
  requirements document is the prompt for the work. Attach it to the
  client as pasted text and/or an uploaded file, then link time entries
  to it. Entry lists show "Per: \<document>", invoice lines show the
  document each line was done per, invoices add a "Work performed per:"
  line, and the entries CSV has a Document column.
- **Email log** — log mail to and from a client by hand (direction,
  date, subject, body). The hosted Muse app can also check Gmail for
  mail with a client and log what it finds, deduped by Gmail message id
  so re-checks never double-log, and send mail from Gmail on your
  behalf. **The live Gmail check/send runs on the hosted app's server —
  this repo only stores the email log; it never reads or sends mail.**
- **Time entries** — client, work title, date, hours (decimal), notes,
  billable / non-billable. A **quick-entry box** parses plain words:
  `2.5h login page for Acme` fills in 2.5 hours, title "Login page",
  client Acme. Parsing is local — no AI service is called.
- **Invoices** — one per client and date range, built from uninvoiced
  billable entries. Auto-numbered `INV-0001`, `INV-0002`, …
  Line items (date, work title, hours, rate, amount), subtotal,
  optional tax %, total. Status unpaid/paid with mark-paid, and void
  (frees the entries to be billed again). Print / save as PDF from the
  invoice view.
- **Reports** — totals by client and by month (hours + amounts), unpaid
  invoice total, uninvoiced billable total. CSV export for entries,
  by-client, by-month, and invoices.
- **Settings** — default hourly rate, business name, and AI agent
  choice. **Muse is the default**; ChatGPT, Claude, and Gemini are the
  other choices. The choice is stored only — the app never calls any AI
  service and never asks for an API key.

Features borrowed from Toggl Track, Harvest, Clockify, and FreshBooks:
per-client rates, billable vs non-billable, invoice numbering, paid/unpaid
status, marking hours as invoiced, monthly summaries, CSV/PDF export.

## Sample data (sample data only — no real client data)

Load it from Settings → "Load sample data", or from code:

```js
import { createStore, seedSampleData } from "./billable.js";
const store = createStore();
seedSampleData(store);
```

3 sample clients, 16 entries across Nov 2–13, 2026, 1 sample invoice.
The seed also adds one sample SOW document (Acme, "Acme website
redesign — SOW", linked to the "Login page build" entry, so INV-0001
line 1 carries it) and one sample logged email from Acme. Money totals
are unchanged from v1. Hand-checked totals:

| | Hours | Amount |
|---|---:|---:|
| Acme Consulting ($65/hr) | 20.0 | $1,300.00 |
| Beta Studio ($75/hr) | 8.5 | $637.50 |
| Gamma Labs ($50/hr) | 3.0 | $150.00 |
| **Grand total (billable)** | **31.5** | **$2,087.50** |

Sample invoice **INV-0001** (Acme, Nov 2–6, 2026): 6 lines, 13.5 hours,
subtotal $877.50, tax $0.00, total **$877.50**, due Dec 13, 2026 (Net 30).
Line 1 (Login page build, 3.5 h × $65 = $227.50) is per "Acme website
redesign — SOW". Uninvoiced after it: 18.0 hours, $1,210.00. One entry (Acme, Nov 6,
"Internal planning", 1.0 h) is non-billable and excluded from all money
totals. A second example, verified in the tests: a Beta invoice at 8%
tax — subtotal $375.00, tax $30.00, total $405.00.

## Tests

No third-party packages. Node 18+:

```sh
npm test
# or: node --test tests/test_billable.mjs
```

11 tests, all passing: entry math (exact cents), invoice totals
(including tax), invoice numbering, mark-paid/void, the quick-entry
parser, report sums, non-billable exclusion, CSV rows, validation
errors, and settings — plus 6 more for v2: client contact fields,
documents linked to entries and invoices, the email log with Gmail
dedupe, the CSV Document column, the seeded document/email, and
delete-client guards. 17 tests total, all passing.

Money is computed in integer cents (`billable.js`), so invoice totals
are exact — no floating-point drift.

## Files

- `billable.js` — core logic: clients (with contact info), documents,
  entries (optionally per-document), email log, invoices, parser,
  reports, CSV rows, sample data. No DOM, no network. Tested by
  `tests/test_billable.mjs`.
- `app.js` — standalone page UI (tabs, forms, invoice view, CSV
  download). Uses `billable.js`; stores data in localStorage.
- `index.html`, `styles.css` — standalone page, mobile-first
  (big tap targets, readable on a phone screen).
- `tests/test_billable.mjs` — unit tests.
