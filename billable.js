/**
 * BillableHours — core logic for a freelance time-log and invoicing app.
 *
 * Pure logic, no DOM, no network, no AI calls. Works in the browser and
 * under Node for the unit tests. Money is handled in integer cents so
 * invoice totals are exact (hours and rates are kept to 2 decimals).
 *
 * Storage is the caller's job: the Muse app keeps state server-side,
 * the standalone page in this repo uses localStorage.
 *
 * v2 adds what the live app gained after v1: client contact information
 * (contact person, phone, website, contact notes); client documents —
 * a statement of work or requirements document is the prompt for the
 * work, and time entries can be tied to one; and a per-client email log
 * (manual entries, plus Gmail-checked mail deduped by Gmail message id).
 * The live Gmail check/send itself runs on the hosted app's server and
 * is NOT in this repo — here the email log is data only.
 */

export const VERSION = "2.0.0";
export const AGENT_CHOICES = ["Muse", "ChatGPT", "Claude", "Gemini"];
export const DEFAULT_AGENT = "Muse";
export const DOCUMENT_KINDS = ["sow", "requirements", "other"];
export const DOCUMENT_KIND_LABELS = {
  sow: "SOW",
  requirements: "Requirements",
  other: "Other",
};

/** Round a 2-decimal number to integer cents, half-up. */
export function toCents(value) {
  return Math.round(Math.round(Number(value) * 100));
}

/** Amount for one entry line, in integer cents: hours x rate. */
export function lineAmountCents(hours, rate) {
  const h100 = Math.round(Number(hours) * 100);
  const rCents = Math.round(Number(rate) * 100);
  return Math.round((h100 * rCents) / 100);
}

export function centsToDollars(cents) {
  return Math.round(cents) / 100;
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function validDate(value) {
  const d = value instanceof Date ? value : new Date(String(value) + "T00:00:00");
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date: " + value);
  return d.toISOString().slice(0, 10);
}

export function defaultData() {
  return {
    version: 2,
    clients: [],
    documents: [],
    entries: [],
    emails: [],
    invoices: [],
    settings: {
      defaultRate: 65,
      agent: DEFAULT_AGENT,
      businessName: "Stephen Vowell",
      businessEmail: "",
    },
  };
}

export function createStore(initialData) {
  const data = initialData || defaultData();
  // Tolerate v1 data (no documents / emails arrays yet).
  if (!Array.isArray(data.documents)) data.documents = [];
  if (!Array.isArray(data.emails)) data.emails = [];

  function save() {
    if (typeof store.onSave === "function") store.onSave(data);
  }

  const store = {
    data,
    onSave: null,

    getSetting(key) {
      return data.settings[key];
    },
    setSetting(key, value) {
      data.settings[key] = value;
      save();
    },

    // -- clients ---------------------------------------------------
    addClient({
      name, email = "", address = "", rate = null, currency = "USD", termsDays = 30,
      contactName = "", phone = "", website = "", contactNotes = "",
    }) {
      name = String(name || "").trim();
      if (!name) throw new Error("Client name is required.");
      if (rate === null || rate === undefined || rate === "") {
        rate = Number(data.settings.defaultRate) || 0;
      }
      const client = {
        id: newId(),
        name,
        email: String(email).trim(),
        address: String(address).trim(),
        contactName: String(contactName).trim(),
        phone: String(phone).trim(),
        website: String(website).trim(),
        contactNotes: String(contactNotes).trim(),
        rate: Number(rate),
        currency: String(currency || "USD").trim().toUpperCase(),
        termsDays: parseInt(termsDays, 10) || 30,
      };
      data.clients.push(client);
      save();
      return client;
    },

    updateClient(clientId, fields) {
      const client = store.getClient(clientId);
      if (!client) throw new Error("Unknown client.");
      for (const key of ["name", "email", "address", "currency", "contactName", "phone", "website", "contactNotes"]) {
        if (key in fields) client[key] = String(fields[key]).trim();
      }
      if ("rate" in fields) client.rate = Number(fields.rate);
      if ("termsDays" in fields) client.termsDays = parseInt(fields.termsDays, 10);
      save();
      return client;
    },

    deleteClient(clientId) {
      if (data.entries.some((e) => e.clientId === clientId)) {
        throw new Error("Client has time entries; delete those first.");
      }
      if (data.documents.some((d) => d.clientId === clientId)) {
        throw new Error("Client has documents; delete those first.");
      }
      if (data.emails.some((m) => m.clientId === clientId)) {
        throw new Error("Client has logged emails; delete those first.");
      }
      if (data.invoices.some((i) => i.clientId === clientId)) {
        throw new Error("Client has invoices; void those first.");
      }
      data.clients = data.clients.filter((c) => c.id !== clientId);
      save();
    },

    getClient(clientId) {
      return data.clients.find((c) => c.id === clientId) || null;
    },

    findClientByName(text) {
      const hay = String(text || "").toLowerCase();
      let best = null;
      let bestLen = 0;
      for (const client of data.clients) {
        const name = client.name.toLowerCase();
        const first = name.split(/\s+/)[0] || "";
        for (const cand of [name, first]) {
          if (cand && hay.includes(cand) && cand.length > bestLen) {
            best = client;
            bestLen = cand.length;
          }
        }
      }
      return best;
    },

    // -- client documents (SOW / requirements = the prompt) -------
    addDocument({ clientId, kind, title, promptText = "", fileName = "", mimeType = "", fileBase64 = "" }) {
      if (!store.getClient(clientId)) throw new Error("Unknown client.");
      if (!DOCUMENT_KINDS.includes(kind)) {
        throw new Error("Document kind must be sow, requirements, or other.");
      }
      title = String(title || "").trim();
      if (!title) throw new Error("Document title is required.");
      const doc = {
        id: newId(),
        clientId,
        kind,
        title,
        promptText: String(promptText || ""),
        fileName: String(fileName || "").trim(),
        mimeType: String(mimeType || "").trim(),
        hasFile: Boolean(fileBase64),
        // The file itself is base64 in the hosted app; the standalone
        // page keeps only the name (files stay in the browser's memory).
        fileBase64: String(fileBase64 || ""),
      };
      data.documents.push(doc);
      save();
      return doc;
    },

    getDocument(documentId) {
      return data.documents.find((d) => d.id === documentId) || null;
    },

    documentsFor(clientId) {
      return data.documents.filter((d) => d.clientId === clientId);
    },

    updateDocument(documentId, fields) {
      const doc = store.getDocument(documentId);
      if (!doc) throw new Error("Unknown document.");
      if ("kind" in fields) {
        if (!DOCUMENT_KINDS.includes(fields.kind)) {
          throw new Error("Document kind must be sow, requirements, or other.");
        }
        doc.kind = fields.kind;
      }
      if ("title" in fields) {
        const title = String(fields.title || "").trim();
        if (!title) throw new Error("Document title is required.");
        doc.title = title;
      }
      if ("promptText" in fields) doc.promptText = String(fields.promptText || "");
      // The attached file itself is never replaced — delete and re-add.
      save();
      return doc;
    },

    deleteDocument(documentId) {
      const doc = store.getDocument(documentId);
      if (!doc) throw new Error("Unknown document.");
      if (data.entries.some((e) => e.documentId === documentId)) {
        throw new Error("Document is linked to time entries; unlink those first.");
      }
      data.documents = data.documents.filter((d) => d.id !== documentId);
      save();
    },

    documentTitle(documentId) {
      if (!documentId) return null;
      const doc = store.getDocument(documentId);
      return doc ? doc.title : null;
    },

    // -- time entries ----------------------------------------------
    addEntry({ clientId, title, date, hours, billable = true, notes = "", documentId = null }) {
      if (!store.getClient(clientId)) throw new Error("Unknown client.");
      title = String(title || "").trim();
      if (!title) throw new Error("Work title is required.");
      hours = Math.round(Number(hours) * 100) / 100;
      if (!(hours > 0)) throw new Error("Hours must be more than 0.");
      if (documentId) {
        const doc = store.getDocument(documentId);
        if (!doc) throw new Error("Unknown document.");
        if (doc.clientId !== clientId) {
          throw new Error("Document belongs to a different client.");
        }
      }
      const entry = {
        id: newId(),
        clientId,
        title,
        date: validDate(date),
        hours,
        billable: Boolean(billable),
        notes: String(notes || "").trim(),
        documentId: documentId || null,
        invoiced: false,
        invoiceId: null,
      };
      data.entries.push(entry);
      save();
      return entry;
    },

    deleteEntry(entryId) {
      const entry = store.getEntry(entryId);
      if (!entry) throw new Error("Unknown entry.");
      if (entry.invoiced) throw new Error("Entry is on an invoice; void that invoice first.");
      data.entries = data.entries.filter((e) => e.id !== entryId);
      save();
    },

    getEntry(entryId) {
      return data.entries.find((e) => e.id === entryId) || null;
    },

    entriesFor({ clientId = null, fromDate = null, toDate = null, billableOnly = false, uninvoicedOnly = false, documentId = null } = {}) {
      const out = data.entries.filter((e) => {
        if (clientId && e.clientId !== clientId) return false;
        if (fromDate && e.date < validDate(fromDate)) return false;
        if (toDate && e.date > validDate(toDate)) return false;
        if (billableOnly && !e.billable) return false;
        if (uninvoicedOnly && e.invoiced) return false;
        if (documentId && e.documentId !== documentId) return false;
        return true;
      });
      out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
      return out;
    },

    // -- email log ---------------------------------------------------
    // Manual log entries and Gmail-checked mail share this log. The
    // hosted app checks Gmail server-side and dedupes by gmailMessageId;
    // this repo only stores the log — it never reads or sends mail.
    logEmail({
      clientId, direction, emailDate, subject = "", body = "",
      fromEmail = "", toEmail = "", gmailMessageId = null, status = "logged",
    }) {
      if (!store.getClient(clientId)) throw new Error("Unknown client.");
      if (direction !== "inbound" && direction !== "outbound") {
        throw new Error("Direction must be inbound or outbound.");
      }
      const mail = {
        id: newId(),
        clientId,
        direction,
        emailDate: validDate(emailDate),
        subject: String(subject || "").trim(),
        body: String(body || ""),
        fromEmail: String(fromEmail || "").trim(),
        toEmail: String(toEmail || "").trim(),
        gmailMessageId: gmailMessageId ? String(gmailMessageId) : null,
        status,
      };
      data.emails.push(mail);
      save();
      return mail;
    },

    /** Store Gmail-checked mail, skipping any message id already logged. */
    saveCheckedEmails(clientId, items) {
      if (!store.getClient(clientId)) throw new Error("Unknown client.");
      let added = 0;
      let skipped = 0;
      for (const item of items || []) {
        if (!item || !item.gmailMessageId) throw new Error("Checked email needs a Gmail message id.");
        if (data.emails.some((m) => m.gmailMessageId === item.gmailMessageId)) {
          skipped += 1;
          continue;
        }
        store.logEmail({ clientId, ...item, status: "logged" });
        added += 1;
      }
      return { added, skipped };
    },

    getEmail(emailId) {
      return data.emails.find((m) => m.id === emailId) || null;
    },

    emailsFor(clientId) {
      const out = data.emails.filter((m) => m.clientId === clientId);
      out.sort((a, b) => (a.emailDate < b.emailDate ? 1 : a.emailDate > b.emailDate ? -1 : 0));
      return out;
    },

    deleteEmail(emailId) {
      const mail = store.getEmail(emailId);
      if (!mail) throw new Error("Unknown email.");
      data.emails = data.emails.filter((m) => m.id !== emailId);
      save();
    },

    /** Outcome of a send started elsewhere (hosted app): sent or failed. */
    confirmEmailSent(emailId, gmailMessageId) {
      const mail = store.getEmail(emailId);
      if (!mail) throw new Error("Unknown email.");
      mail.status = "sent";
      if (gmailMessageId) mail.gmailMessageId = String(gmailMessageId);
      save();
      return mail;
    },

    confirmEmailSendFailed(emailId) {
      const mail = store.getEmail(emailId);
      if (!mail) throw new Error("Unknown email.");
      mail.status = "send-failed";
      save();
      return mail;
    },

    // -- invoices --------------------------------------------------
    nextInvoiceNumber() {
      let max = 0;
      for (const inv of data.invoices) {
        const m = /^INV-(\d+)$/.exec(inv.number);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return "INV-" + String(max + 1).padStart(4, "0");
    },

    createInvoice({ clientId, fromDate, toDate, taxPct = 0, invoiceDate = null }) {
      const client = store.getClient(clientId);
      if (!client) throw new Error("Unknown client.");
      fromDate = validDate(fromDate);
      toDate = validDate(toDate);
      if (fromDate > toDate) throw new Error("From date must be on or before to date.");
      const linesEntries = store.entriesFor({
        clientId, fromDate, toDate, billableOnly: true, uninvoicedOnly: true,
      });
      if (linesEntries.length === 0) {
        throw new Error("No uninvoiced billable entries in that range.");
      }
      const lines = [];
      let subtotalCents = 0;
      for (const entry of linesEntries) {
        const amountCents = lineAmountCents(entry.hours, client.rate);
        subtotalCents += amountCents;
        lines.push({
          entryId: entry.id,
          date: entry.date,
          title: entry.title,
          hours: entry.hours,
          rate: client.rate,
          amountCents,
          documentId: entry.documentId || null,
          documentTitle: store.documentTitle(entry.documentId),
        });
      }
      const taxCents = Math.round((subtotalCents * Number(taxPct)) / 100);
      const totalCents = subtotalCents + taxCents;
      const invDate = invoiceDate ? validDate(invoiceDate) : new Date().toISOString().slice(0, 10);
      const due = new Date(invDate + "T00:00:00");
      due.setDate(due.getDate() + (parseInt(client.termsDays, 10) || 30));
      const invoice = {
        id: newId(),
        number: store.nextInvoiceNumber(),
        clientId,
        date: invDate,
        dueDate: due.toISOString().slice(0, 10),
        fromDate,
        toDate,
        taxPct: Number(taxPct),
        status: "unpaid",
        lines,
        subtotalCents,
        taxCents,
        totalCents,
      };
      data.invoices.push(invoice);
      for (const entry of linesEntries) {
        entry.invoiced = true;
        entry.invoiceId = invoice.id;
      }
      save();
      return invoice;
    },

    getInvoice(invoiceId) {
      return data.invoices.find((i) => i.id === invoiceId) || null;
    },

    /** Distinct document titles an invoice's lines were performed per. */
    invoiceDocumentTitles(invoiceId) {
      const inv = store.getInvoice(invoiceId);
      if (!inv) throw new Error("Unknown invoice.");
      const seen = [];
      for (const line of inv.lines) {
        if (line.documentTitle && !seen.includes(line.documentTitle)) seen.push(line.documentTitle);
      }
      return seen;
    },

    setInvoiceStatus(invoiceId, status) {
      if (status !== "unpaid" && status !== "paid") {
        throw new Error("Status must be unpaid or paid.");
      }
      const inv = store.getInvoice(invoiceId);
      if (!inv) throw new Error("Unknown invoice.");
      inv.status = status;
      save();
      return inv;
    },

    voidInvoice(invoiceId) {
      const inv = store.getInvoice(invoiceId);
      if (!inv) throw new Error("Unknown invoice.");
      for (const entry of data.entries) {
        if (entry.invoiceId === invoiceId) {
          entry.invoiced = false;
          entry.invoiceId = null;
        }
      }
      data.invoices = data.invoices.filter((i) => i.id !== invoiceId);
      save();
    },

    // -- reports ---------------------------------------------------
    totalsByClient() {
      const out = {};
      for (const entry of data.entries) {
        if (!entry.billable) continue;
        const client = store.getClient(entry.clientId);
        if (!client) continue;
        const row = (out[client.name] = out[client.name] || {
          clientId: client.id,
          hours: 0,
          amountCents: 0,
          currency: client.currency,
          rate: client.rate,
        });
        row.hours = Math.round((row.hours + entry.hours) * 100) / 100;
        row.amountCents += lineAmountCents(entry.hours, client.rate);
      }
      return out;
    },

    totalsByMonth() {
      const out = {};
      for (const entry of data.entries) {
        if (!entry.billable) continue;
        const client = store.getClient(entry.clientId);
        if (!client) continue;
        const month = entry.date.slice(0, 7);
        const row = (out[month] = out[month] || { hours: 0, amountCents: 0 });
        row.hours = Math.round((row.hours + entry.hours) * 100) / 100;
        row.amountCents += lineAmountCents(entry.hours, client.rate);
      }
      const sorted = {};
      for (const k of Object.keys(out).sort()) sorted[k] = out[k];
      return sorted;
    },

    unpaidInvoiceTotalCents() {
      return data.invoices
        .filter((i) => i.status === "unpaid")
        .reduce((sum, i) => sum + i.totalCents, 0);
    },

    uninvoicedTotal() {
      let hours = 0;
      let amountCents = 0;
      for (const entry of data.entries) {
        if (entry.billable && !entry.invoiced) {
          const client = store.getClient(entry.clientId);
          if (!client) continue;
          hours = Math.round((hours + entry.hours) * 100) / 100;
          amountCents += lineAmountCents(entry.hours, client.rate);
        }
      }
      return { hours, amountCents };
    },

    grandTotals() {
      let hours = 0;
      let amountCents = 0;
      for (const entry of data.entries) {
        if (!entry.billable) continue;
        const client = store.getClient(entry.clientId);
        if (!client) continue;
        hours = Math.round((hours + entry.hours) * 100) / 100;
        amountCents += lineAmountCents(entry.hours, client.rate);
      }
      return { hours, amountCents };
    },

    // -- CSV export ------------------------------------------------
    reportRows(kind) {
      if (kind === "entries") {
        const rows = [["Date", "Client", "Work title", "Hours", "Rate", "Amount", "Billable", "Invoiced", "Document", "Notes"]];
        for (const entry of store.entriesFor()) {
          const client = store.getClient(entry.clientId);
          const name = client ? client.name : "?";
          const rate = client ? client.rate : 0;
          rows.push([
            entry.date, name, entry.title,
            entry.hours.toFixed(2), Number(rate).toFixed(2),
            entry.billable ? (lineAmountCents(entry.hours, rate) / 100).toFixed(2) : "0.00",
            entry.billable ? "yes" : "no",
            entry.invoiced ? "yes" : "no",
            store.documentTitle(entry.documentId) || "",
            entry.notes,
          ]);
        }
        return rows;
      }
      if (kind === "by_client") {
        const rows = [["Client", "Hours", "Amount"]];
        for (const [name, row] of Object.entries(store.totalsByClient()).sort()) {
          rows.push([name, row.hours.toFixed(2), (row.amountCents / 100).toFixed(2)]);
        }
        return rows;
      }
      if (kind === "by_month") {
        const rows = [["Month", "Hours", "Amount"]];
        for (const [month, row] of Object.entries(store.totalsByMonth())) {
          rows.push([month, row.hours.toFixed(2), (row.amountCents / 100).toFixed(2)]);
        }
        return rows;
      }
      if (kind === "invoices") {
        const rows = [["Invoice", "Client", "Date", "Due", "Total", "Status"]];
        for (const inv of data.invoices) {
          const client = store.getClient(inv.clientId);
          rows.push([inv.number, client ? client.name : "?", inv.date, inv.dueDate,
            (inv.totalCents / 100).toFixed(2), inv.status]);
        }
        return rows;
      }
      throw new Error("Unknown report kind: " + kind);
    },
  };

  return store;
}

// -- natural-language quick entry ---------------------------------------

const DURATION_RE = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i;

/**
 * Parse e.g. "2.5h login page for Acme" into { hours, title, clientId,
 * clientName, date }. Throws when no duration is found. Local only —
 * no AI service is called.
 */
export function parseQuickEntry(text, store) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw new Error("Type what you worked on, e.g. '2.5h login page for Acme'.");
  }
  const m = DURATION_RE.exec(raw);
  if (!m) {
    throw new Error("No hours found. Start with the time, e.g. '2.5h' or '45m'.");
  }
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const hours = Math.round((unit.startsWith("m") ? value / 60 : value) * 100) / 100;

  let rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length)).trim();
  rest = rest.replace(/\s+/g, " ");

  let client = null;
  let clientName = null;
  const fm = /\bfor\s+(.+)$/i.exec(rest);
  if (fm) {
    const cand = fm[1].trim().replace(/[.,]+$/, "");
    const found = store.findClientByName(cand);
    if (found) {
      client = found;
      clientName = found.name;
    } else {
      clientName = cand;
    }
    rest = rest.slice(0, fm.index).trim();
  }
  if (!client) {
    const found = store.findClientByName(rest);
    if (found) {
      client = found;
      clientName = found.name;
      rest = rest.replace(new RegExp(escapeRegExp(found.name), "i"), "").trim();
      const first = found.name.split(/\s+/)[0];
      rest = rest.replace(new RegExp("\\b" + escapeRegExp(first) + "\\b", "i"), "").trim();
    }
  }
  rest = rest.replace(/\s+/g, " ").replace(/[\s\-.,]+$/, "");
  rest = rest.replace(/^(for|with)\s+/i, "").replace(/\s+(for|with)$/i, "");
  const title = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "";
  return {
    hours,
    title,
    clientId: client ? client.id : null,
    clientName,
    date: new Date().toISOString().slice(0, 10),
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -- sample data (SAMPLE DATA ONLY — no real client data) ----------------

export const SAMPLE_CLIENTS = [
  { name: "Acme Consulting", email: "amy@acme.example", address: "100 Main St\nTucson, AZ 85701", rate: 65, currency: "USD", termsDays: 30, contactName: "Amy Chen", phone: "520-555-0101", website: "https://acme.example", contactNotes: "Prefers email; approves invoices on Fridays." },
  { name: "Beta Studio", email: "hello@beta.example", address: "250 Art Ave\nPhoenix, AZ 85004", rate: 75, currency: "USD", termsDays: 15 },
  { name: "Gamma Labs", email: "team@gamma.example", address: "77 Science Park\nSierra Vista, AZ 85635", rate: 50, currency: "USD", termsDays: 30 },
];

// [client index, title, date, hours, billable, notes]
export const SAMPLE_ENTRIES = [
  [0, "Login page build", "2026-11-02", 3.5, true, "React + auth flow"],
  [0, "Dashboard fixes", "2026-11-03", 2.0, true, ""],
  [0, "Client call", "2026-11-03", 0.5, true, "Weekly check-in"],
  [0, "API integration", "2026-11-04", 4.0, true, ""],
  [0, "Bug fixes", "2026-11-05", 1.5, true, ""],
  [0, "Code review", "2026-11-06", 2.0, true, ""],
  [0, "Internal planning", "2026-11-06", 1.0, false, "Not billed"],
  [1, "Logo design", "2026-11-02", 2.0, true, ""],
  [1, "Landing page", "2026-11-04", 3.0, true, ""],
  [2, "Data cleanup", "2026-11-05", 1.0, true, ""],
  [0, "Settings page", "2026-11-09", 2.5, true, ""],
  [0, "Testing", "2026-11-10", 3.0, true, ""],
  [2, "Report formatting", "2026-11-10", 2.0, true, ""],
  [1, "Brand guide", "2026-11-11", 2.0, true, ""],
  [0, "Deploy", "2026-11-12", 1.0, true, ""],
  [1, "Homepage tweaks", "2026-11-13", 1.5, true, ""],
];

/**
 * Seed a store with the sample data. Returns the sample invoice.
 * Hand-checked totals: Acme 20.0h / $1,300.00; Beta 8.5h / $637.50;
 * Gamma 3.0h / $150.00; grand 31.5h / $2,087.50 (billable only).
 * INV-0001 (Acme, Nov 2–6): 13.5h, subtotal $877.50, tax $0.00,
 * total $877.50. Uninvoiced after it: 18.0h / $1,210.00.
 * The seed also adds one sample SOW document for Acme (linked to the
 * "Login page build" entry, so INV-0001 line 1 carries it) and one
 * sample logged email from Acme.
 */
export function seedSampleData(store) {
  const clients = SAMPLE_CLIENTS.map((c) => store.addClient(c));
  const doc = store.addDocument({
    clientId: clients[0].id,
    kind: "sow",
    title: "Acme website redesign — SOW",
    promptText: "Rebuild the Acme marketing site: login page with auth, dashboard, and settings. React, mobile-first, done by Nov 13.",
  });
  for (const [ci, title, date, hours, billable, notes] of SAMPLE_ENTRIES) {
    store.addEntry({
      clientId: clients[ci].id, title, date, hours, billable, notes,
      documentId: title === "Login page build" ? doc.id : null,
    });
  }
  store.logEmail({
    clientId: clients[0].id,
    direction: "inbound",
    emailDate: "2026-11-03",
    subject: "Re: login page scope",
    body: "Login page is in scope for this phase — go ahead.",
    fromEmail: "amy@acme.example",
    toEmail: "stephen@example.com",
  });
  return store.createInvoice({
    clientId: clients[0].id,
    fromDate: "2026-11-02",
    toDate: "2026-11-06",
    taxPct: 0,
    invoiceDate: "2026-11-13",
  });
}
