/**
 * BillableHours — standalone page UI.
 * Uses billable.js for all logic. Data lives in this browser's
 * localStorage (the Muse app version stores it server-side instead,
 * so phone and PC share it).
 */
import {
  VERSION,
  AGENT_CHOICES,
  DOCUMENT_KIND_LABELS,
  createStore,
  defaultData,
  lineAmountCents,
  parseQuickEntry,
  seedSampleData,
} from "./billable.js";

const LS_KEY = "billablehours-data-v1";

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.clients)) return parsed;
    }
  } catch (_) { /* fall through to empty data */ }
  return defaultData();
}

const store = createStore(loadData());
store.onSave = (data) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (_) { /* storage full or unavailable; data stays in memory */ }
};

const $ = (id) => document.getElementById(id);
const money = (cents, currency = "USD") => {
  const sym = { USD: "$", EUR: "€", GBP: "£" }[currency] || (currency + " ");
  return sym + (cents / 100).toFixed(2);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// -- tabs ---------------------------------------------------------------
document.querySelectorAll("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// -- clients ------------------------------------------------------------
function clientOptions(select, includeAll = false) {
  const cur = select.value;
  select.innerHTML = (includeAll ? `<option value="">All clients</option>` : "") +
    store.data.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  if (cur) select.value = cur;
}

function renderClients() {
  clientOptions($("entryClient"));
  clientOptions($("invoiceClient"));
  clientOptions($("entryFilter"), true);
  clientOptions($("docClient"));
  clientOptions($("emailClient"));
  const list = $("clientList");
  if (store.data.clients.length === 0) {
    list.innerHTML = `<p class="hint">No clients yet — add your first one above, or load the sample data in Settings.</p>`;
    return;
  }
  list.innerHTML = store.data.clients.map((c) => {
    const contact = [
      c.contactName ? esc(c.contactName) : "",
      c.phone ? `<a href="tel:${esc(c.phone.replace(/[^+0-9]/g, ""))}">${esc(c.phone)}</a>` : "",
      c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : "",
    ].filter(Boolean).join(" · ");
    return `
    <div class="card">
      <div class="title">${esc(c.name)}</div>
      <div class="meta">${esc(c.email)}${c.address ? " · " + esc(c.address).replace(/\n/g, ", ") : ""}</div>
      ${contact ? `<div class="meta">${contact}</div>` : ""}
      ${c.contactNotes ? `<div class="meta">${esc(c.contactNotes)}</div>` : ""}
      <div class="meta">${money(Math.round(c.rate * 100), c.currency)}/hr · Net ${c.termsDays} days</div>
      <div class="actions">
        <button class="small" data-del-client="${c.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-del-client]").forEach((b) => {
    b.addEventListener("click", () => {
      try {
        store.deleteClient(b.dataset.delClient);
        renderAll();
      } catch (err) { alert(err.message); }
    });
  });
}

$("clientForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  try {
    store.addClient({
      name: $("clientName").value,
      email: $("clientEmail").value,
      address: $("clientAddress").value,
      contactName: $("clientContactName").value,
      phone: $("clientPhone").value,
      website: $("clientWebsite").value,
      contactNotes: $("clientContactNotes").value,
      rate: $("clientRate").value === "" ? null : Number($("clientRate").value),
      currency: $("clientCurrency").value,
      termsDays: Number($("clientTerms").value) || 30,
    });
    ev.target.reset();
    $("clientTerms").value = 30;
    renderAll();
  } catch (err) { alert(err.message); }
});

// -- client documents (SOW / requirements = the prompt) --------------
function renderDocuments() {
  const list = $("docList");
  const docs = store.data.documents;
  if (docs.length === 0) {
    list.innerHTML = `<p class="hint">No documents yet.</p>`;
    return;
  }
  list.innerHTML = docs.map((d) => {
    const c = store.getClient(d.clientId);
    return `<div class="card">
      <div class="title">${esc(d.title)}</div>
      <div class="meta">${DOCUMENT_KIND_LABELS[d.kind] || d.kind} · ${esc(c ? c.name : "?")}
        ${d.fileName ? " · file: " + esc(d.fileName) : ""}</div>
      ${d.promptText ? `<div class="meta">${esc(d.promptText.slice(0, 300))}${d.promptText.length > 300 ? "…" : ""}</div>` : ""}
      <div class="actions"><button class="small" data-del-doc="${d.id}">Delete</button></div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-del-doc]").forEach((b) => {
    b.addEventListener("click", () => {
      try {
        store.deleteDocument(b.dataset.delDoc);
        renderAll();
      } catch (err) { alert(err.message); }
    });
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

$("docForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("docMsg");
  try {
    const file = $("docFile").files[0] || null;
    const fileBase64 = file ? await readFileAsBase64(file) : "";
    store.addDocument({
      clientId: $("docClient").value,
      kind: $("docKind").value,
      title: $("docTitle").value,
      promptText: $("docText").value,
      fileName: file ? file.name : "",
      mimeType: file ? file.type : "",
      fileBase64,
    });
    msg.classList.remove("error");
    msg.textContent = "Document added.";
    ev.target.reset();
    renderAll();
  } catch (err) {
    msg.classList.add("error");
    msg.textContent = err.message;
  }
});

// -- time entries ---------------------------------------------------------
function refreshEntryDocuments() {
  const select = $("entryDocument");
  const clientId = $("entryClient").value;
  const cur = select.value;
  const docs = clientId ? store.documentsFor(clientId) : [];
  select.innerHTML = `<option value="">— No document —</option>` +
    docs.map((d) => `<option value="${d.id}">${esc(d.title)} (${DOCUMENT_KIND_LABELS[d.kind] || d.kind})</option>`).join("");
  if (cur && docs.some((d) => d.id === cur)) select.value = cur;
}

$("entryClient").addEventListener("change", refreshEntryDocuments);

function renderEntries() {
  const filter = $("entryFilter").value || null;
  const entries = store.entriesFor({ clientId: filter });
  const list = $("entryList");
  if (entries.length === 0) {
    list.innerHTML = `<p class="hint">No entries yet.</p>`;
    return;
  }
  list.innerHTML = entries.slice().reverse().map((e) => {
    const c = store.getClient(e.clientId);
    const amount = c ? lineAmountCents(e.hours, c.rate) : 0;
    const docTitle = store.documentTitle(e.documentId);
    return `<div class="card">
      <div class="title">${esc(e.title)}</div>
      <div class="meta">${esc(c ? c.name : "?")} · ${e.date} · ${e.hours.toFixed(2)} h
        ${e.billable ? "· <span class='amount'>" + money(amount, c ? c.currency : "USD") + "</span>" : "· non-billable"}
        ${e.invoiced ? "· invoiced" : ""}</div>
      ${docTitle ? `<div class="meta">Per: ${esc(docTitle)}</div>` : ""}
      ${e.notes ? `<div class="meta">${esc(e.notes)}</div>` : ""}
      <div class="actions"><button class="small" data-del-entry="${e.id}">Delete</button></div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-del-entry]").forEach((b) => {
    b.addEventListener("click", () => {
      try {
        store.deleteEntry(b.dataset.delEntry);
        renderAll();
      } catch (err) { alert(err.message); }
    });
  });
}

$("entryFilter").addEventListener("change", renderEntries);

$("entryForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  try {
    store.addEntry({
      clientId: $("entryClient").value,
      title: $("entryTitle").value,
      date: $("entryDate").value,
      hours: Number($("entryHours").value),
      billable: $("entryBillable").checked,
      notes: $("entryNotes").value,
      documentId: $("entryDocument").value || null,
    });
    ev.target.reset();
    $("entryDate").value = todayISO();
    $("entryBillable").checked = true;
    renderAll();
  } catch (err) { alert(err.message); }
});

$("quickAdd").addEventListener("click", () => {
  const msg = $("quickMsg");
  try {
    const p = parseQuickEntry($("quickText").value, store);
    let clientId = p.clientId;
    if (!clientId) {
      if (store.data.clients.length === 1) {
        clientId = store.data.clients[0].id;
      } else {
        throw new Error("I could not tell which client — add the client first, or use 'for <client>'.");
      }
    }
    const entry = store.addEntry({
      clientId, title: p.title || "Work", date: p.date, hours: p.hours,
    });
    const c = store.getClient(clientId);
    msg.classList.remove("error");
    msg.textContent = `Added: ${entry.hours.toFixed(2)} h — ${entry.title} (${c.name})`;
    $("quickText").value = "";
    renderAll();
  } catch (err) {
    msg.classList.add("error");
    msg.textContent = err.message;
  }
});

// -- invoices ---------------------------------------------------------------
function renderInvoices() {
  const list = $("invoiceList");
  if (store.data.invoices.length === 0) {
    list.innerHTML = `<p class="hint">No invoices yet.</p>`;
    $("invoiceView").innerHTML = "";
    return;
  }
  list.innerHTML = store.data.invoices.slice().reverse().map((inv) => {
    const c = store.getClient(inv.clientId);
    return `<div class="card">
      <div class="title">${inv.number} — ${esc(c ? c.name : "?")}</div>
      <div class="meta">${inv.fromDate} to ${inv.toDate} · due ${inv.dueDate}</div>
      <div class="meta"><span class="amount">${money(inv.totalCents, c ? c.currency : "USD")}</span>
        <span class="pill ${inv.status}">${inv.status}</span></div>
      <div class="actions">
        <button class="small" data-view-inv="${inv.id}">View / PDF</button>
        ${inv.status === "unpaid"
          ? `<button class="small" data-pay-inv="${inv.id}">Mark paid</button>` : ""}
        <button class="small" data-void-inv="${inv.id}">Void</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-view-inv]").forEach((b) =>
    b.addEventListener("click", () => showInvoice(b.dataset.viewInv)));
  list.querySelectorAll("[data-pay-inv]").forEach((b) =>
    b.addEventListener("click", () => {
      store.setInvoiceStatus(b.dataset.payInv, "paid");
      renderAll();
    }));
  list.querySelectorAll("[data-void-inv]").forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm("Void this invoice? Its entries become billable again.")) {
        store.voidInvoice(b.dataset.voidInv);
        $("invoiceView").innerHTML = "";
        renderAll();
      }
    }));
}

function showInvoice(invoiceId) {
  const inv = store.getInvoice(invoiceId);
  if (!inv) return;
  const c = store.getClient(inv.clientId);
  const cur = c ? c.currency : "USD";
  const rows = inv.lines.map((l) => `<tr>
      <td>${l.date}</td><td>${esc(l.title)}${l.documentTitle ? `<br><span class="hint">Per: ${esc(l.documentTitle)}</span>` : ""}</td>
      <td class="num">${l.hours.toFixed(2)}</td>
      <td class="num">${money(Math.round(l.rate * 100), cur)}</td>
      <td class="num">${money(l.amountCents, cur)}</td>
    </tr>`).join("");
  const docTitles = store.invoiceDocumentTitles(inv.id);
  $("invoiceView").innerHTML = `
    <div class="card" id="print-area">
      <div class="title">INVOICE ${inv.number}</div>
      <div class="meta">From: ${esc(store.getSetting("businessName") || "")}</div>
      <div class="meta">Bill to: ${esc(c ? c.name : "?")}${c && c.address ? " — " + esc(c.address).replace(/\n/g, ", ") : ""}</div>
      <div class="meta">Invoice date: ${inv.date} · Due: ${inv.dueDate} · ${inv.fromDate} to ${inv.toDate}</div>
      <div class="meta">Status: <span class="pill ${inv.status}">${inv.status}</span></div>
      ${docTitles.length ? `<div class="meta">Work performed per: ${docTitles.map(esc).join("; ")}</div>` : ""}
      <div class="scroll"><table>
        <tr><th>Date</th><th>Work</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr>
        ${rows}
      </table></div>
      <p style="text-align:right">Subtotal: <b>${money(inv.subtotalCents, cur)}</b><br>
      ${inv.taxPct ? `Tax (${inv.taxPct}%): <b>${money(inv.taxCents, cur)}</b><br>` : ""}
      Total: <b>${money(inv.totalCents, cur)}</b></p>
      <div class="actions no-print">
        <button class="primary" onclick="window.print()">Print / save as PDF</button>
      </div>
    </div>`;
  $("invoiceView").scrollIntoView({ behavior: "smooth" });
}

$("invoiceForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const msg = $("invoiceMsg");
  try {
    const inv = store.createInvoice({
      clientId: $("invoiceClient").value,
      fromDate: $("invoiceFrom").value,
      toDate: $("invoiceTo").value,
      taxPct: Number($("invoiceTax").value) || 0,
    });
    msg.classList.remove("error");
    msg.textContent = `Created ${inv.number}: ${money(inv.totalCents)} (${inv.lines.length} lines).`;
    renderAll();
    showInvoice(inv.id);
  } catch (err) {
    msg.classList.add("error");
    msg.textContent = err.message;
  }
});

// -- email log ------------------------------------------------------------
function renderEmails() {
  const clientId = $("emailClient").value;
  const list = $("emailList");
  const mails = clientId ? store.emailsFor(clientId) : store.data.emails.slice().sort((a, b) => (a.emailDate < b.emailDate ? 1 : -1));
  if (mails.length === 0) {
    list.innerHTML = `<p class="hint">No emails logged yet.</p>`;
    return;
  }
  list.innerHTML = mails.map((m) => {
    const c = store.getClient(m.clientId);
    return `<div class="card">
      <div class="title">${esc(m.subject || "(no subject)")} <span class="pill">${m.direction}</span> <span class="pill">${esc(m.status)}</span></div>
      <div class="meta">${esc(c ? c.name : "?")} · ${m.emailDate} · ${esc(m.fromEmail)} → ${esc(m.toEmail)}</div>
      ${m.body ? `<div class="meta">${esc(m.body.slice(0, 300))}${m.body.length > 300 ? "…" : ""}</div>` : ""}
      <div class="actions"><button class="small" data-del-email="${m.id}">Delete</button></div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-del-email]").forEach((b) => {
    b.addEventListener("click", () => {
      try {
        store.deleteEmail(b.dataset.delEmail);
        renderAll();
      } catch (err) { alert(err.message); }
    });
  });
}

$("emailClient").addEventListener("change", renderEmails);

$("emailForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  try {
    store.logEmail({
      clientId: $("emailClient").value,
      direction: $("emailDirection").value,
      emailDate: $("emailDate").value,
      subject: $("emailSubject").value,
      body: $("emailBody").value,
      fromEmail: $("emailFrom").value,
      toEmail: $("emailTo").value,
    });
    ev.target.reset();
    $("emailDate").value = todayISO();
    renderAll();
  } catch (err) { alert(err.message); }
});

// -- reports ------------------------------------------------------------------
function renderReports() {
  const grand = store.grandTotals();
  const uninv = store.uninvoicedTotal();
  $("reportSummary").innerHTML = `
    <div class="card">
      <div class="meta">All billable work: <span class="amount">${grand.hours.toFixed(2)} h · ${money(grand.amountCents)}</span></div>
      <div class="meta">Unpaid invoices: <span class="amount">${money(store.unpaidInvoiceTotalCents())}</span></div>
      <div class="meta">Uninvoiced billable: <span class="amount">${uninv.hours.toFixed(2)} h · ${money(uninv.amountCents)}</span></div>
    </div>`;
  const byClient = store.totalsByClient();
  $("reportByClient").innerHTML = `<div class="scroll"><table>
    <tr><th>Client</th><th class="num">Hours</th><th class="num">Amount</th></tr>
    ${Object.entries(byClient).sort().map(([name, r]) =>
      `<tr><td>${esc(name)}</td><td class="num">${r.hours.toFixed(2)}</td><td class="num">${money(r.amountCents, r.currency)}</td></tr>`).join("")}
    </table></div>`;
  const byMonth = store.totalsByMonth();
  $("reportByMonth").innerHTML = `<div class="scroll"><table>
    <tr><th>Month</th><th class="num">Hours</th><th class="num">Amount</th></tr>
    ${Object.entries(byMonth).map(([m, r]) =>
      `<tr><td>${m}</td><td class="num">${r.hours.toFixed(2)}</td><td class="num">${money(r.amountCents)}</td></tr>`).join("")}
    </table></div>`;
}

function downloadCsv(kind, filename) {
  const rows = store.reportRows(kind);
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("exportEntriesCsv").addEventListener("click", () => downloadCsv("entries", "billable-entries.csv"));
$("exportByClientCsv").addEventListener("click", () => downloadCsv("by_client", "billable-by-client.csv"));
$("exportByMonthCsv").addEventListener("click", () => downloadCsv("by_month", "billable-by-month.csv"));
$("exportInvoicesCsv").addEventListener("click", () => downloadCsv("invoices", "billable-invoices.csv"));

// -- settings -------------------------------------------------------------------
function renderSettings() {
  $("setBusinessName").value = store.getSetting("businessName") || "";
  $("setBusinessEmail").value = store.getSetting("businessEmail") || "";
  $("setDefaultRate").value = store.getSetting("defaultRate");
  const agent = $("setAgent");
  agent.innerHTML = AGENT_CHOICES.map((a) => `<option>${a}</option>`).join("");
  agent.value = store.getSetting("agent") || "Muse";
  $("versionLine").textContent = "BillableHours " + VERSION + " — sample data only, no real client data.";
}

$("settingsForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  store.setSetting("businessName", $("setBusinessName").value);
  store.setSetting("businessEmail", $("setBusinessEmail").value);
  store.setSetting("defaultRate", Number($("setDefaultRate").value) || 0);
  store.setSetting("agent", $("setAgent").value);
  renderAll();
  alert("Settings saved.");
});

$("seedSample").addEventListener("click", () => {
  if (store.data.clients.length > 0 || store.data.entries.length > 0) {
    if (!confirm("This adds the sample clients and entries alongside your current data. Continue?")) return;
  }
  seedSampleData(store);
  renderAll();
  alert("Sample data loaded: 3 clients, 16 entries, invoice INV-0001, 1 SOW document, 1 logged email.");
});

$("clearData").addEventListener("click", () => {
  if (confirm("Delete ALL clients, documents, entries, emails, and invoices? This cannot be undone.")) {
    localStorage.removeItem(LS_KEY);
    location.reload();
  }
});

// -- init -----------------------------------------------------------------------
function renderAll() {
  renderClients();
  renderDocuments();
  renderEntries();
  refreshEntryDocuments();
  renderInvoices();
  renderReports();
  renderEmails();
  renderSettings();
}

$("entryDate").value = todayISO();
$("emailDate").value = todayISO();
renderAll();
