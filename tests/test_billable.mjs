/**
 * Unit tests for BillableHours core logic (billable.js).
 * Run:  node --test tests/test_billable.mjs
 * No third-party packages — plain node:test + node:assert.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  lineAmountCents,
  toCents,
  parseQuickEntry,
  seedSampleData,
  AGENT_CHOICES,
  DEFAULT_AGENT,
} from "../billable.js";

function seededStore() {
  const store = createStore();
  const invoice = seedSampleData(store);
  return { store, invoice };
}

test("entry math: hours x rate in exact cents", () => {
  assert.equal(lineAmountCents(3.5, 65), 22750); // $227.50
  assert.equal(lineAmountCents(0.5, 65), 3250); // $32.50
  assert.equal(lineAmountCents(2, 75), 15000); // $150.00
  assert.equal(lineAmountCents(1.33, 33.33), 4433); // $44.33 (1.33*33.33=44.3289)
  assert.equal(lineAmountCents(1, 50), 5000);
  assert.equal(toCents(877.5), 87750);
});

test("sample invoice INV-0001 totals match the entries by hand", () => {
  const { store, invoice } = seededStore();
  assert.equal(invoice.number, "INV-0001");
  assert.equal(invoice.lines.length, 6);
  const hours = invoice.lines.reduce((s, l) => s + l.hours, 0);
  assert.equal(hours, 13.5);
  // By hand: 227.50 + 130.00 + 32.50 + 260.00 + 97.50 + 130.00 = 877.50
  assert.equal(invoice.subtotalCents, 87750);
  assert.equal(invoice.taxCents, 0);
  assert.equal(invoice.totalCents, 87750);
  assert.equal(invoice.status, "unpaid");
  assert.equal(invoice.dueDate, "2026-12-13"); // Net 30 from Nov 13
  // Its billable entries are now marked invoiced (the one non-billable
  // entry, Internal planning, stays uninvoiced by design).
  const billed = store.entriesFor({
    uninvoicedOnly: true, billableOnly: true, clientId: invoice.clientId,
  });
  assert.ok(!billed.some((e) => e.date >= "2026-11-02" && e.date <= "2026-11-06"));
});

test("invoice numbering increments", () => {
  const { store } = seededStore();
  assert.equal(store.nextInvoiceNumber(), "INV-0002");
  const beta = store.data.clients.find((c) => c.name === "Beta Studio");
  const inv2 = store.createInvoice({
    clientId: beta.id, fromDate: "2026-11-02", toDate: "2026-11-04", taxPct: 0,
  });
  assert.equal(inv2.number, "INV-0002");
  assert.equal(store.nextInvoiceNumber(), "INV-0003");
});

test("invoice tax math: 8% on $375.00 is $30.00, total $405.00", () => {
  const { store } = seededStore();
  const beta = store.data.clients.find((c) => c.name === "Beta Studio");
  const inv = store.createInvoice({
    clientId: beta.id, fromDate: "2026-11-02", toDate: "2026-11-04", taxPct: 8,
  });
  // By hand: 2.0h x $75 = $150.00; 3.0h x $75 = $225.00; subtotal $375.00.
  assert.equal(inv.subtotalCents, 37500);
  assert.equal(inv.taxCents, 3000);
  assert.equal(inv.totalCents, 40500);
});

test("mark paid and void free the entries again", () => {
  const { store, invoice } = seededStore();
  assert.equal(store.unpaidInvoiceTotalCents(), 87750);
  store.setInvoiceStatus(invoice.id, "paid");
  assert.equal(store.unpaidInvoiceTotalCents(), 0);
  assert.equal(store.getInvoice(invoice.id).status, "paid");
  store.voidInvoice(invoice.id);
  assert.equal(store.getInvoice(invoice.id), null);
  // The 6 entries can be billed again.
  const again = store.createInvoice({
    clientId: invoice.clientId, fromDate: "2026-11-02", toDate: "2026-11-06",
  });
  assert.equal(again.number, "INV-0001");
  assert.equal(again.totalCents, 87750);
});

test("quick-entry parser", () => {
  const { store } = seededStore();
  const acme = store.data.clients.find((c) => c.name === "Acme Consulting");
  const beta = store.data.clients.find((c) => c.name === "Beta Studio");

  let p = parseQuickEntry("2.5h login page for Acme", store);
  assert.equal(p.hours, 2.5);
  assert.equal(p.title, "Login page");
  assert.equal(p.clientId, acme.id);

  p = parseQuickEntry("45m call with Acme", store);
  assert.equal(p.hours, 0.75);
  assert.equal(p.title, "Call");
  assert.equal(p.clientId, acme.id);

  p = parseQuickEntry("3 hours design work for Beta Studio", store);
  assert.equal(p.hours, 3);
  assert.equal(p.title, "Design work");
  assert.equal(p.clientId, beta.id);

  p = parseQuickEntry("1h Acme status meeting", store);
  assert.equal(p.hours, 1);
  assert.equal(p.title, "Status meeting");
  assert.equal(p.clientId, acme.id);

  p = parseQuickEntry("2h fix bug for Zeta Corp", store);
  assert.equal(p.hours, 2);
  assert.equal(p.title, "Fix bug");
  assert.equal(p.clientId, null);
  assert.equal(p.clientName, "Zeta Corp");

  assert.throws(() => parseQuickEntry("login page for Acme", store), /No hours found/);
  assert.throws(() => parseQuickEntry("", store), /Type what you worked on/);
});

test("reports: totals by client, by month, grand, unpaid, uninvoiced", () => {
  const { store } = seededStore();
  const byClient = store.totalsByClient();
  assert.equal(byClient["Acme Consulting"].hours, 20);
  assert.equal(byClient["Acme Consulting"].amountCents, 130000);
  assert.equal(byClient["Beta Studio"].hours, 8.5);
  assert.equal(byClient["Beta Studio"].amountCents, 63750);
  assert.equal(byClient["Gamma Labs"].hours, 3);
  assert.equal(byClient["Gamma Labs"].amountCents, 15000);

  const byMonth = store.totalsByMonth();
  assert.equal(byMonth["2026-11"].hours, 31.5);
  assert.equal(byMonth["2026-11"].amountCents, 208750);

  const grand = store.grandTotals();
  assert.equal(grand.hours, 31.5);
  assert.equal(grand.amountCents, 208750);

  assert.equal(store.unpaidInvoiceTotalCents(), 87750);
  const uninv = store.uninvoicedTotal();
  assert.equal(uninv.hours, 18);
  assert.equal(uninv.amountCents, 121000);
});

test("non-billable entries stay out of invoices and money totals", () => {
  const { store } = seededStore();
  const entries = store.entriesFor({ billableOnly: true });
  assert.equal(entries.length, 15); // 16 seeded, 1 non-billable
  assert.ok(!entries.some((e) => e.title === "Internal planning"));
  const all = store.entriesFor();
  assert.equal(all.length, 16);
});

test("CSV report rows", () => {
  const { store } = seededStore();
  const rows = store.reportRows("by_client");
  assert.deepEqual(rows[0], ["Client", "Hours", "Amount"]);
  const acme = rows.find((r) => r[0] === "Acme Consulting");
  assert.deepEqual(acme, ["Acme Consulting", "20.00", "1300.00"]);
  const entryRows = store.reportRows("entries");
  assert.equal(entryRows.length, 17); // header + 16 entries
  const invRows = store.reportRows("invoices");
  assert.deepEqual(invRows[1].slice(0, 5),
    ["INV-0001", "Acme Consulting", "2026-11-13", "2026-12-13", "877.50"]);
});

test("validation errors", () => {
  const store = createStore();
  const client = store.addClient({ name: "Solo", rate: 60 });
  assert.throws(() => store.addClient({ name: "   " }), /Client name is required/);
  assert.throws(
    () => store.addEntry({ clientId: client.id, title: "", date: "2026-11-16", hours: 1 }),
    /Work title is required/);
  assert.throws(
    () => store.addEntry({ clientId: client.id, title: "X", date: "2026-11-16", hours: 0 }),
    /Hours must be more than 0/);
  assert.throws(
    () => store.addEntry({ clientId: "nope", title: "X", date: "2026-11-16", hours: 1 }),
    /Unknown client/);
  assert.throws(
    () => store.createInvoice({ clientId: client.id, fromDate: "2026-11-02", toDate: "2026-11-06" }),
    /No uninvoiced billable entries/);
  assert.throws(
    () => store.createInvoice({ clientId: client.id, fromDate: "2026-11-06", toDate: "2026-11-02" }),
    /From date must be on or before to date/);
});

test("settings: Muse is the default agent, choice is stored only", () => {
  const store = createStore();
  assert.equal(store.getSetting("agent"), DEFAULT_AGENT);
  assert.equal(DEFAULT_AGENT, "Muse");
  assert.ok(AGENT_CHOICES.includes("Muse"));
  assert.ok(AGENT_CHOICES.includes("ChatGPT"));
  store.setSetting("agent", "Claude");
  assert.equal(store.getSetting("agent"), "Claude");
  assert.equal(store.getSetting("defaultRate"), 65);
});
