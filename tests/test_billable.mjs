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

// -- v2: contact info, documents, email log ---------------------------

test("client contact fields round-trip", () => {
  const store = createStore();
  const c = store.addClient({
    name: "Delta Co", rate: 80, email: "ops@delta.example",
    contactName: "Dana Reed", phone: "520-555-0142",
    website: "https://delta.example", contactNotes: "Call after 2pm.",
  });
  assert.equal(c.contactName, "Dana Reed");
  assert.equal(c.phone, "520-555-0142");
  assert.equal(c.website, "https://delta.example");
  assert.equal(c.contactNotes, "Call after 2pm.");
  store.updateClient(c.id, { phone: "520-555-9999", contactName: "Dana R." });
  assert.equal(store.getClient(c.id).phone, "520-555-9999");
  assert.equal(store.getClient(c.id).contactName, "Dana R.");
  // Clients without contact info default to empty strings.
  const plain = store.addClient({ name: "Plain", rate: 50 });
  assert.equal(plain.contactName, "");
  assert.equal(plain.phone, "");
  assert.equal(plain.website, "");
  assert.equal(plain.contactNotes, "");
});

test("documents: attach, link to entries, show on invoices", () => {
  const { store } = seededStore();
  const acme = store.data.clients.find((c) => c.name === "Acme Consulting");
  const doc = store.addDocument({
    clientId: acme.id, kind: "requirements",
    title: "Acme API spec v2",
    promptText: "Build the API per the spec: auth, rate limits, webhooks.",
  });
  assert.equal(doc.kind, "requirements");
  assert.equal(store.documentTitle(doc.id), "Acme API spec v2");
  assert.throws(
    () => store.addDocument({ clientId: acme.id, kind: "contract", title: "X" }),
    /kind must be sow, requirements, or other/);
  assert.throws(
    () => store.addDocument({ clientId: acme.id, kind: "sow", title: "  " }),
    /Document title is required/);

  // Link a fresh entry to the document; it lands on the next invoice.
  const entry = store.addEntry({
    clientId: acme.id, title: "API build", date: "2026-11-12", hours: 2, documentId: doc.id,
  });
  assert.equal(store.documentTitle(entry.documentId), "Acme API spec v2");
  const inv = store.createInvoice({
    clientId: acme.id, fromDate: "2026-11-09", toDate: "2026-11-12",
  });
  const line = inv.lines.find((l) => l.entryId === entry.id);
  assert.equal(line.documentTitle, "Acme API spec v2");
  assert.equal(line.amountCents, 13000); // 2.0h x $65
  assert.deepEqual(store.invoiceDocumentTitles(inv.id), ["Acme API spec v2"]);

  // A document from another client cannot be linked.
  const beta = store.data.clients.find((c) => c.name === "Beta Studio");
  assert.throws(
    () => store.addEntry({ clientId: beta.id, title: "X", date: "2026-11-12", hours: 1, documentId: doc.id }),
    /different client/);

  // Delete is blocked while entries refer to the document; updating the
  // title (not the file) is allowed.
  assert.throws(() => store.deleteDocument(doc.id), /linked to time entries/);
  store.updateDocument(doc.id, { title: "Acme API spec v3" });
  assert.equal(store.documentTitle(doc.id), "Acme API spec v3");
  assert.equal(store.entriesFor({ documentId: doc.id }).length, 1);
});

test("email log: manual add and Gmail dedupe by message id", () => {
  const { store } = seededStore();
  const acme = store.data.clients.find((c) => c.name === "Acme Consulting");
  const mail = store.logEmail({
    clientId: acme.id, direction: "outbound", emailDate: "2026-11-13",
    subject: "Invoice INV-0001", body: "Attached — due Dec 13.",
    fromEmail: "stephen@example.com", toEmail: "amy@acme.example",
  });
  assert.equal(mail.status, "logged");
  assert.equal(mail.gmailMessageId, null);
  assert.throws(
    () => store.logEmail({ clientId: acme.id, direction: "sideways", emailDate: "2026-11-13" }),
    /Direction must be inbound or outbound/);

  // Gmail-checked mail: first save adds, re-save of the same ids skips.
  const checked = [
    { gmailMessageId: "msg-aaa", direction: "inbound", emailDate: "2026-11-12", subject: "Scope ok", fromEmail: "amy@acme.example", toEmail: "stephen@example.com" },
    { gmailMessageId: "msg-bbb", direction: "inbound", emailDate: "2026-11-12", subject: "Thanks", fromEmail: "amy@acme.example", toEmail: "stephen@example.com" },
  ];
  assert.deepEqual(store.saveCheckedEmails(acme.id, checked), { added: 2, skipped: 0 });
  assert.deepEqual(store.saveCheckedEmails(acme.id, checked), { added: 0, skipped: 2 });
  assert.deepEqual(store.saveCheckedEmails(acme.id, [checked[0]]), { added: 0, skipped: 1 });
  assert.throws(
    () => store.saveCheckedEmails(acme.id, [{ direction: "inbound", emailDate: "2026-11-12" }]),
    /needs a Gmail message id/);

  // Newest first in the log; send outcome is recorded, not re-sent.
  const log = store.emailsFor(acme.id);
  assert.equal(log.length, 4); // 1 seeded + 1 manual + 2 checked
  assert.equal(log[0].emailDate, "2026-11-13");
  store.confirmEmailSent(mail.id, "msg-sent-1");
  assert.equal(store.getEmail(mail.id).status, "sent");
  assert.equal(store.getEmail(mail.id).gmailMessageId, "msg-sent-1");
  store.confirmEmailSendFailed(mail.id);
  assert.equal(store.getEmail(mail.id).status, "send-failed");

  store.deleteEmail(mail.id);
  assert.equal(store.getEmail(mail.id), null);
  assert.throws(() => store.deleteEmail("nope"), /Unknown email/);
});

test("CSV entries gain a Document column", () => {
  const { store } = seededStore();
  const rows = store.reportRows("entries");
  assert.deepEqual(rows[0],
    ["Date", "Client", "Work title", "Hours", "Rate", "Amount", "Billable", "Invoiced", "Document", "Notes"]);
  assert.equal(rows.length, 17); // header + 16 entries
  const login = rows.find((r) => r[2] === "Login page build");
  assert.equal(login[8], "Acme website redesign — SOW");
  const deploy = rows.find((r) => r[2] === "Deploy");
  assert.equal(deploy[8], "");
});

test("sample data: one SOW document and one logged email; invoice totals unchanged", () => {
  const { store, invoice } = seededStore();
  assert.equal(store.data.documents.length, 1);
  assert.equal(store.data.documents[0].kind, "sow");
  assert.equal(store.data.documents[0].title, "Acme website redesign — SOW");
  assert.equal(store.data.emails.length, 1);
  assert.equal(store.data.emails[0].direction, "inbound");
  assert.equal(store.data.emails[0].subject, "Re: login page scope");
  // The linked entry's document rides onto the sample invoice line.
  assert.equal(invoice.lines[0].documentTitle, "Acme website redesign — SOW");
  assert.deepEqual(store.invoiceDocumentTitles(invoice.id), ["Acme website redesign — SOW"]);
  // Money totals are exactly the v1 hand-checked ones.
  assert.equal(invoice.subtotalCents, 87750);
  assert.equal(invoice.totalCents, 87750);
  assert.equal(store.grandTotals().amountCents, 208750);
});

test("deleteClient blocked by documents and logged emails", () => {
  const store = createStore();
  const c = store.addClient({ name: "Solo", rate: 60 });
  store.addDocument({ clientId: c.id, kind: "sow", title: "Solo SOW" });
  assert.throws(() => store.deleteClient(c.id), /documents/);
  store.deleteDocument(store.data.documents[0].id);
  store.logEmail({ clientId: c.id, direction: "inbound", emailDate: "2026-11-16", subject: "Hi" });
  assert.throws(() => store.deleteClient(c.id), /logged emails/);
  store.deleteEmail(store.data.emails[0].id);
  store.deleteClient(c.id);
  assert.equal(store.getClient(c.id), null);
});
