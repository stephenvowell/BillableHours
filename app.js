/**
 * BillableHours — standalone page UI.
 * Uses billable.js for all logic. Data lives in this browser's
 * localStorage (the Muse app version stores it server-side instead,
 * so phone and PC share it).
 */
import {
  VERSION,
  AGENT_CHOICES,
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
  const list = $("clientList");
  if (store.data.clients.length === 0) {
    list.innerHTML = `<p class="hint">No clients yet — add your first one above, or load the sample data in Settings.</p>`;
    return;
  }
  list.innerHTML = store.data.clients.map((c) => `
    <div class="card">
      <div class="title">${esc(c.name)}</div>
      <div class="meta">${esc(c.email)}${c.address ? " · " + esc(c.address).replace(/\n/g, ", ") : ""}</div>
      <div class="meta">${money(Math.round(c.rate * 100), c.currency)}/hr · Net ${c.termsDays} days</div>
      <div class="actions">
        <button class="small" data-del-client="${c.id}">Delete</button>
      </div>
    </div>`).join("");
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
      rate: $("clientRate").value === "" ? null : Number($("clientRate").value),
      currency: $("clientCurrency").value,
      termsDays: Number($("clientTerms").value) || 30,
    });
    ev.target.reset();
    $("clientTerms").value = 30;
    renderAll();
  } catch (err) { alert(err.message); }
});

// -- time entries ---------------------------------------------------------
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
    return `<div class="card">
      <div class="title">${esc(e.title)}</div>
      <div class="meta">${esc(c ? c.name : "?")} · ${e.date} · ${e.hours.toFixed(2)} h
        ${e.billable ? "· <span class='amount'>" + money(amount, c ? c.currency : "USD") + "</span>" : "· non-billable"}
        ${e.invoiced ? "· invoiced" : ""}</div>
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
      <td>${l.date}</td><td>${esc(l.title)}</td>
      <td class="num">${l.hours.toFixed(2)}</td>
      <td class="num">${money(Math.round(l.rate * 100), cur)}</td>
      <td class="num">${money(l.amountCents, cur)}</td>
    </tr>`).join("");
  $("invoiceView").innerHTML = `
    <div class="card" id="print-area">
      <div class="title">INVOICE ${inv.number}</div>
      <div class="meta">From: ${esc(store.getSetting("businessName") || "")}</div>
      <div class="meta">Bill to: ${esc(c ? c.name : "?")}${c && c.address ? " — " + esc(c.address).replace(/\n/g, ", ") : ""}</div>
      <div class="meta">Invoice date: ${inv.date} · Due: ${inv.dueDate} · ${inv.fromDate} to ${inv.toDate}</div>
      <div class="meta">Status: <span class="pill ${inv.status}">${inv.status}</span></div>
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
  alert("Sample data loaded: 3 clients, 16 entries, invoice INV-0001.");
});

$("clearData").addEventListener("click", () => {
  if (confirm("Delete ALL clients, entries, and invoices? This cannot be undone.")) {
    localStorage.removeItem(LS_KEY);
    location.reload();
  }
});

// -- init -----------------------------------------------------------------------
function renderAll() {
  renderClients();
  renderEntries();
  renderInvoices();
  renderReports();
  renderSettings();
}

$("entryDate").value = todayISO();
renderAll();
