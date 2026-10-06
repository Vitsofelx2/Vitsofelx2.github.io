'use strict';

/* =========================================================
   Mis Finanzas — app de finanzas personales (offline, PWA)
   Todos los datos se guardan en localStorage del dispositivo.
   ========================================================= */

const STORAGE_KEY = 'misFinanzas.v1';
const UI_KEY = 'misFinanzas.ui';

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISO(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const monthOf = (iso) => iso.slice(0, 7);
const addMonthsKey = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const monthLabel = (key, short = false) => { const s = parseISO(key + '-01').toLocaleDateString('es', short ? { month: 'short' } : { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const dateLabel = (iso) => parseISO(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (iso) => parseISO(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };

function addPeriod(iso, freq) {
  const d = parseISO(iso);
  const day = d.getDate();
  switch (freq) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'quarterly':
    case 'monthly':
    case 'yearly': {
      const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
      d.setDate(1);
      d.setMonth(d.getMonth() + months);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
  }
  return toISO(d);
}
const FREQ = { daily: 'Diario', weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual', quarterly: 'Trimestral', yearly: 'Anual' };
const FREQ_PER_MONTH = { daily: 30.4, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

const CURRENCIES = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'VES', 'BOB', 'UYU', 'PYG', 'GTQ', 'HNL', 'NIO', 'CRC', 'PAB', 'DOP', 'CUP', 'BRL', 'GBP', 'CAD'];

let fmtCache = {};
function money(n, opts = {}) {
  const cur = opts.currency || state.settings.currency;
  const key = cur + (opts.compact ? 'c' : '');
  if (!fmtCache[key]) {
    try {
      fmtCache[key] = new Intl.NumberFormat('es', { style: 'currency', currency: cur, notation: opts.compact ? 'compact' : 'standard', maximumFractionDigits: opts.compact ? 1 : 2 });
    } catch { fmtCache[key] = { format: (v) => cur + ' ' + Number(v).toFixed(2) }; }
  }
  return fmtCache[key].format(Number(n) || 0);
}
const pct = (n) => (isFinite(n) ? Math.round(n) : 0) + '%';

/* ---------- Estado ---------- */
const DEFAULT_CATEGORIES = [
  ['Comida', '🍔', '#ef4444', 'expense'], ['Supermercado', '🛒', '#f97316', 'expense'],
  ['Transporte', '🚌', '#eab308', 'expense'], ['Vivienda', '🏠', '#84cc16', 'expense'],
  ['Servicios', '💡', '#22c55e', 'expense'], ['Salud', '💊', '#14b8a6', 'expense'],
  ['Educación', '📚', '#06b6d4', 'expense'], ['Entretenimiento', '🎬', '#3b82f6', 'expense'],
  ['Ropa', '👕', '#6366f1', 'expense'], ['Suscripciones', '📺', '#8b5cf6', 'expense'],
  ['Teléfono e internet', '📱', '#a855f7', 'expense'], ['Mascotas', '🐶', '#d946ef', 'expense'],
  ['Regalos', '🎁', '#ec4899', 'expense'], ['Viajes', '✈️', '#f43f5e', 'expense'],
  ['Deudas', '💳', '#64748b', 'expense'], ['Otros gastos', '📦', '#94a3b8', 'expense'],
  ['Salario', '💼', '#16a34a', 'income'], ['Negocio', '🏪', '#059669', 'income'],
  ['Freelance', '💻', '#0d9488', 'income'], ['Inversiones', '📈', '#0891b2', 'income'],
  ['Regalos recibidos', '🎉', '#2563eb', 'income'], ['Otros ingresos', '💵', '#4f46e5', 'income'],
];
const ACCOUNT_TYPES = { cash: ['Efectivo', '💵'], bank: ['Cuenta bancaria', '🏦'], savings: ['Ahorros', '🐷'], credit: ['Tarjeta de crédito', '💳'], wallet: ['Billetera digital', '📱'], invest: ['Inversiones', '📈'] };

function defaultState() {
  return {
    version: 1,
    settings: { currency: 'USD', theme: 'auto', name: '', pinHash: null, rates: {} },
    accounts: [
      { id: uid(), name: 'Efectivo', type: 'cash', initial: 0, color: '#16a34a', archived: false },
      { id: uid(), name: 'Banco', type: 'bank', initial: 0, color: '#2563eb', archived: false },
    ],
    categories: DEFAULT_CATEGORIES.map(([name, icon, color, type]) => ({ id: uid(), name, icon, color, type })),
    transactions: [],
    budgets: [],
    goals: [],
    debts: [],
    recurring: [],
    notes: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.error(e); }
  return defaultState();
}
let state = loadState();
let ui = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })();
ui.month = ui.month || monthOf(today());

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('⚠️ No se pudo guardar: ' + e.message); }
}
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }

/* ---------- Consultas ---------- */
const catById = (id) => state.categories.find((c) => c.id === id) || { name: 'Sin categoría', icon: '❔', color: '#94a3b8' };
const accById = (id) => state.accounts.find((a) => a.id === id) || { name: '—', color: '#94a3b8', type: 'cash' };
const txInMonth = (key) => state.transactions.filter((t) => monthOf(t.date) === key);

function accountBalance(accId, upTo = null) {
  const acc = state.accounts.find((a) => a.id === accId);
  let bal = acc ? Number(acc.initial) || 0 : 0;
  for (const t of state.transactions) {
    if (upTo && t.date > upTo) continue;
    if (t.type === 'income' && t.accountId === accId) bal += t.amount;
    else if (t.type === 'expense' && t.accountId === accId) bal -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === accId) bal -= t.amount;
      if (t.toAccountId === accId) bal += t.amount;
    }
  }
  return round2(bal);
}
const totalBalance = (upTo = null) => round2(sum(state.accounts, (a) => accountBalance(a.id, upTo)));

function monthTotals(key) {
  const txs = txInMonth(key);
  const income = sum(txs.filter((t) => t.type === 'income'), (t) => t.amount);
  const expense = sum(txs.filter((t) => t.type === 'expense'), (t) => t.amount);
  return { income: round2(income), expense: round2(expense), net: round2(income - expense), count: txs.length };
}

function byCategory(key, type = 'expense') {
  const map = new Map();
  for (const t of txInMonth(key)) {
    if (t.type !== type) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return [...map.entries()].map(([id, value]) => ({ id, value: round2(value), cat: catById(id) })).sort((a, b) => b.value - a.value);
}

function debtRemaining(d) { return round2(Math.max(0, d.amount - sum(d.payments || [], (p) => p.amount))); }
function goalSaved(g) { return round2(sum(g.contributions || [], (c) => c.amount)); }

function netWorth() {
  const owe = sum(state.debts.filter((d) => d.kind === 'owe'), debtRemaining);
  const owed = sum(state.debts.filter((d) => d.kind === 'owed'), debtRemaining);
  return { assets: totalBalance(), owe: round2(owe), owed: round2(owed), total: round2(totalBalance() + owed - owe) };
}

/* Genera transacciones de pagos recurrentes vencidos (los marcados como automáticos) */
function processRecurring() {
  const t = today();
  let created = 0;
  for (const r of state.recurring) {
    if (!r.auto || r.paused) continue;
    let guard = 0;
    while (r.nextDate <= t && guard++ < 400) {
      if (r.endDate && r.nextDate > r.endDate) break;
      state.transactions.push({ id: uid(), type: r.type, amount: r.amount, date: r.nextDate, categoryId: r.categoryId, accountId: r.accountId, note: r.name, recurringId: r.id });
      r.nextDate = addPeriod(r.nextDate, r.frequency);
      created++;
    }
  }
  if (created) { save(); setTimeout(() => toast(`🔁 Se registraron ${created} pago(s) recurrente(s)`), 600); }
}

/* ---------- Gráficos SVG ---------- */
function donutChart(items, { size = 180, thickness = 28, center = '' } = {}) {
  const total = sum(items, (i) => i.value);
  const r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = total > 0 ? items.map((i) => {
    const len = (i.value / total) * circ;
    const s = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${thickness}" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${c} ${c})"><title>${esc(i.label)}: ${money(i.value)}</title></circle>`;
    offset += len;
    return s;
  }).join('') : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" style="max-width:${size}px">${segs}
    <text x="${c}" y="${c - 4}" text-anchor="middle" style="font-size:11px">${esc(center)}</text>
    <text x="${c}" y="${c + 14}" text-anchor="middle" style="font-size:14px;font-weight:700;fill:var(--text)">${money(total, { compact: true })}</text></svg>`;
}

function legend(items) {
  const total = sum(items, (i) => i.value) || 1;
  return `<div class="legend">${items.map((i) => `<div class="lg"><span class="dot" style="background:${i.color}"></span><span class="name">${esc(i.label)}</span><span class="num">${money(i.value)}</span><span class="muted num" style="width:40px;text-align:right">${pct((i.value / total) * 100)}</span></div>`).join('')}</div>`;
}

function barChart(data, series, { height = 220 } = {}) {
  const W = 640, H = height, padL = 54, padB = 26, padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const nice = niceMax(max);
  const plotW = W - padL - 6, plotH = H - padB - padT;
  const groupW = plotW / data.length;
  const barW = Math.min(22, (groupW - 8) / series.length);
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    out += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--border)"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${money((nice * i) / 4, { compact: true })}</text>`;
  }
  data.forEach((d, i) => {
    const gx = padL + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, j) => {
      const v = d[s.key] || 0;
      const h = (v / nice) * plotH;
      out += `<rect x="${gx + j * barW}" y="${padT + plotH - h}" width="${barW - 2}" height="${Math.max(0, h)}" rx="3" fill="${s.color}"><title>${esc(d.label)} · ${s.label}: ${money(v)}</title></rect>`;
    });
    out += `<text x="${padL + i * groupW + groupW / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

function lineChart(points, { height = 200, color = 'var(--primary)' } = {}) {
  const W = 640, H = height, padL = 54, padB = 26, padT = 10;
  const vals = points.map((p) => p.value);
  let min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  if (max === min) max = min + 1;
  const plotW = W - padL - 10, plotH = H - padB - padT;
  const x = (i) => padL + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    out += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${money(v, { compact: true })}</text>`;
  }
  if (min < 0) out += `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;
  out += `<path d="${area}" fill="${color}" opacity=".12"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`;
  points.forEach((p, i) => {
    out += `<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" fill="${color}"><title>${esc(p.label)}: ${money(p.value)}</title></circle>`;
    if (points.length <= 12 || i % Math.ceil(points.length / 12) === 0) out += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

function niceMax(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/* ---------- UI: modal, toast, formularios ---------- */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal(title, html, onMount) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  onMount && onMount($('#modal-body'));
  const first = $('#modal-body input:not([type=hidden]):not([type=color]), #modal-body select');
  if (first && window.matchMedia('(min-width: 761px)').matches) first.focus();
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }

function confirmDialog(msg, onYes, yesLabel = 'Eliminar') {
  openModal('Confirmar', `<p>${esc(msg)}</p><div class="form-actions"><button class="btn" data-a="no">Cancelar</button><button class="btn danger" data-a="yes">${esc(yesLabel)}</button></div>`, (b) => {
    b.querySelector('[data-a=no]').onclick = closeModal;
    b.querySelector('[data-a=yes]').onclick = () => { closeModal(); onYes(); };
  });
}

/* Construye un formulario genérico.
   fields: [{name,label,type,options,required,step,min,placeholder,half}] */
function formModal(title, fields, values, onSubmit, { onDelete, submitLabel = 'Guardar', extraHTML = '' } = {}) {
  const fieldHTML = (f) => {
    const v = values[f.name] ?? f.default ?? '';
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<label class="field" style="flex-direction:row;align-items:center;gap:10px;color:var(--text)"><input type="checkbox" name="${f.name}" style="width:auto" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    } else {
      input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
    }
    return `<label class="field">${esc(f.label)}${input}</label>`;
  };
  // agrupa campos "half" en filas de dos
  let html = '', buf = [];
  const flush = () => { if (buf.length) { html += buf.length === 2 ? `<div class="form-row">${buf.join('')}</div>` : buf.join(''); buf = []; } };
  for (const f of fields) {
    if (f.half) { buf.push(fieldHTML(f)); if (buf.length === 2) flush(); }
    else { flush(); html += fieldHTML(f); }
  }
  flush();
  openModal(title, `<form class="form">${html}${extraHTML}<div class="form-actions">${onDelete ? '<button type="button" class="btn danger" data-a="del">Eliminar</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-a="cancel">Cancelar</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></div></form>`, (b) => {
    const form = b.querySelector('form');
    b.querySelector('[data-a=cancel]').onclick = closeModal;
    if (onDelete) b.querySelector('[data-a=del]').onclick = () => confirmDialog('¿Seguro que quieres eliminar esto? No se puede deshacer.', onDelete);
    form.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (!el) continue;
        if (f.type === 'number') out[f.name] = el.value === '' ? 0 : round2(parseFloat(el.value));
        else if (f.type === 'checkbox') out[f.name] = el.checked;
        else out[f.name] = el.value.trim();
      }
      if (onSubmit(out, form) !== false) closeModal();
    };
  });
}

const catOptions = (type) => state.categories.filter((c) => !type || c.type === type).map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }));
const accOptions = () => state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${ACCOUNT_TYPES[a.type]?.[1] || '💰'} ${a.name}` }));

/* ---------- Formulario de transacción ---------- */
function transactionForm(tx = null, preset = {}) {
  if (!state.accounts.length) { toast('Primero crea una cuenta'); go('accounts'); return; }
  const isEdit = !!tx;
  const t = tx ? { ...tx } : { type: preset.type || 'expense', amount: '', date: today(), accountId: state.accounts.find((a) => !a.archived)?.id, ...preset };
  const render = () => {
    const isTransfer = t.type === 'transfer';
    return `<form class="form" id="tx-form">
      <div class="type-toggle">${[['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']].map(([v, l]) => `<button type="button" data-v="${v}" class="${t.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="amount-input" name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" value="${t.amount ?? ''}" required>
      ${isTransfer ? '' : `<label class="field">Categoría<select name="categoryId">${catOptions(t.type).map((o) => `<option value="${o.value}" ${o.value === t.categoryId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`}
      <div class="form-row">
        <label class="field">${isTransfer ? 'Desde' : 'Cuenta'}<select name="accountId">${accOptions().map((o) => `<option value="${o.value}" ${o.value === t.accountId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
        ${isTransfer ? `<label class="field">Hacia<select name="toAccountId">${accOptions().map((o) => `<option value="${o.value}" ${o.value === t.toAccountId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>` : `<label class="field">Fecha<input type="date" name="date" value="${t.date}" required></label>`}
      </div>
      ${isTransfer ? `<label class="field">Fecha<input type="date" name="date" value="${t.date}" required></label>` : ''}
      <label class="field">Descripción / nota<input name="note" value="${esc(t.note || '')}" placeholder="Ej: almuerzo con amigos" list="note-suggestions"></label>
      <datalist id="note-suggestions">${[...new Set(state.transactions.slice(-200).map((x) => x.note).filter(Boolean))].slice(0, 50).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="field">Etiquetas (separadas por coma)<input name="tags" value="${esc((t.tags || []).join(', '))}" placeholder="trabajo, vacaciones"></label>
      <div class="form-actions">
        ${isEdit ? '<button type="button" class="btn danger" data-a="del">Eliminar</button><button type="button" class="btn" data-a="dup">Duplicar</button><span class="spacer"></span>' : ''}
        <button type="button" class="btn" data-a="cancel">Cancelar</button>
        ${isEdit ? '' : '<button type="button" class="btn" data-a="another">Guardar y otro</button>'}
        <button type="submit" class="btn primary">Guardar</button>
      </div>
    </form>`;
  };
  const mount = (b) => {
    const form = $('#tx-form', b);
    const read = () => {
      const fd = new FormData(form);
      t.amount = fd.get('amount');
      t.accountId = fd.get('accountId');
      t.date = fd.get('date') || t.date;
      t.note = fd.get('note');
      t.tags = String(fd.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (fd.has('categoryId')) t.categoryId = fd.get('categoryId');
      if (fd.has('toAccountId')) t.toAccountId = fd.get('toAccountId');
    };
    $$('.type-toggle button', b).forEach((btn) => btn.onclick = () => {
      read();
      t.type = btn.dataset.v;
      if (t.type !== 'transfer' && catById(t.categoryId).type !== t.type) t.categoryId = catOptions(t.type)[0]?.value;
      if (t.type === 'transfer' && !t.toAccountId) t.toAccountId = state.accounts.find((a) => a.id !== t.accountId && !a.archived)?.id;
      b.innerHTML = render(); mount(b);
    });
    const commit = () => {
      read();
      const amount = round2(parseFloat(t.amount));
      if (!(amount > 0)) { toast('Introduce un monto válido'); return false; }
      if (t.type === 'transfer' && t.accountId === t.toAccountId) { toast('Elige dos cuentas distintas'); return false; }
      const rec = { id: t.id || uid(), type: t.type, amount, date: t.date, accountId: t.accountId, note: t.note, tags: t.tags };
      if (t.type === 'transfer') rec.toAccountId = t.toAccountId; else rec.categoryId = t.categoryId || catOptions(t.type)[0]?.value;
      if (isEdit) { const i = state.transactions.findIndex((x) => x.id === tx.id); state.transactions[i] = { ...tx, ...rec }; delete state.transactions[i][t.type === 'transfer' ? 'categoryId' : 'toAccountId']; }
      else state.transactions.push(rec);
      save();
      checkBudgetAlert(rec);
      return true;
    };
    form.onsubmit = (e) => { e.preventDefault(); if (commit()) { closeModal(); render_(); toast(isEdit ? 'Movimiento actualizado' : 'Movimiento guardado ✅'); } };
    $('[data-a=cancel]', b).onclick = closeModal;
    const another = $('[data-a=another]', b);
    if (another) another.onclick = () => { if (form.reportValidity() && commit()) { toast('Guardado ✅'); t.id = undefined; t.amount = ''; t.note = ''; b.innerHTML = render(); mount(b); render_(); } };
    const del = $('[data-a=del]', b);
    if (del) del.onclick = () => confirmDialog('¿Eliminar este movimiento?', () => { state.transactions = state.transactions.filter((x) => x.id !== tx.id); save(); render_(); toast('Eliminado'); });
    const dup = $('[data-a=dup]', b);
    if (dup) dup.onclick = () => { read(); closeModal(); transactionForm(null, { ...t, id: undefined, date: today() }); };
  };
  openModal(isEdit ? 'Editar movimiento' : 'Nuevo movimiento', render(), mount);
}

function checkBudgetAlert(tx) {
  if (tx.type !== 'expense') return;
  const b = state.budgets.find((x) => x.categoryId === tx.categoryId);
  if (!b) return;
  const spent = sum(txInMonth(monthOf(tx.date)).filter((t) => t.type === 'expense' && t.categoryId === b.categoryId), (t) => t.amount);
  const p = (spent / b.amount) * 100;
  if (p >= 100) setTimeout(() => toast(`🚨 Superaste el presupuesto de ${catById(b.categoryId).name} (${pct(p)})`), 2700);
  else if (p >= 80) setTimeout(() => toast(`⚠️ Llevas ${pct(p)} del presupuesto de ${catById(b.categoryId).name}`), 2700);
}

function txItem(t) {
  const isT = t.type === 'transfer';
  const cat = isT ? { icon: '🔄', color: '#2563eb', name: 'Transferencia' } : catById(t.categoryId);
  const meta = isT ? `${accById(t.accountId).name} → ${accById(t.toAccountId).name}` : `${cat.name} · ${accById(t.accountId).name}`;
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `<div class="item clickable" data-tx="${t.id}">
    <div class="avatar" style="background:${cat.color}22">${cat.icon}</div>
    <div class="main"><div class="title">${esc(t.note || cat.name)}</div><div class="meta">${esc(meta)}${t.recurringId ? ' · 🔁' : ''}${(t.tags || []).map((g) => ' · #' + esc(g)).join('')}</div></div>
    <div class="amount num ${t.type}">${sign}${money(t.amount)}</div>
  </div>`;
}
function bindTxItems(root) { $$('[data-tx]', root).forEach((el) => el.onclick = () => transactionForm(state.transactions.find((t) => t.id === el.dataset.tx))); }

const emptyBox = (icon, text, btn = '') => `<div class="empty"><div class="big">${icon}</div><p>${text}</p>${btn}</div>`;

/* =========================================================
   VISTAS
   ========================================================= */
const VIEWS = {};

/* ---------- Inicio ---------- */
VIEWS.dashboard = {
  title: 'Inicio', icon: '🏠', month: true,
  render() {
    const m = ui.month;
    const tot = monthTotals(m);
    const prev = monthTotals(addMonthsKey(m, -1));
    const nw = netWorth();
    const savingsRate = tot.income > 0 ? (tot.net / tot.income) * 100 : 0;
    const cats = byCategory(m, 'expense');
    const top = cats.slice(0, 6).map((c) => ({ label: c.cat.icon + ' ' + c.cat.name, value: c.value, color: c.cat.color }));
    if (cats.length > 6) top.push({ label: 'Otros', value: sum(cats.slice(6), (c) => c.value), color: '#94a3b8' });
    const months = Array.from({ length: 6 }, (_, i) => addMonthsKey(m, i - 5)).map((k) => ({ label: monthLabel(k, true), ...monthTotals(k) }));
    const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || 0).slice(0, 7);
    const upcoming = upcomingPayments(14);
    const isCurrent = m === monthOf(today());
    const dayN = isCurrent ? new Date().getDate() : daysInMonth(m);
    const dailyAvg = tot.expense / dayN;
    const projected = isCurrent ? dailyAvg * daysInMonth(m) : tot.expense;

    return `
      ${state.settings.name ? `<p class="muted" style="margin:0 0 14px">Hola, <b>${esc(state.settings.name)}</b> 👋</p>` : ''}
      <div class="grid cols-4 keep-2">
        <div class="card stat"><div class="label">💰 Saldo total</div><div class="value num">${money(nw.assets)}</div><div class="sub">${state.accounts.length} cuenta(s)</div></div>
        <div class="card stat"><div class="label">⬆️ Ingresos del mes</div><div class="value num income">${money(tot.income)}</div><div class="sub">${trend(tot.income, prev.income, true)}</div></div>
        <div class="card stat"><div class="label">⬇️ Gastos del mes</div><div class="value num expense">${money(tot.expense)}</div><div class="sub">${trend(tot.expense, prev.expense, false)}</div></div>
        <div class="card stat"><div class="label">📊 Balance del mes</div><div class="value num ${tot.net >= 0 ? 'income' : 'expense'}">${money(tot.net)}</div><div class="sub">Tasa de ahorro: <b>${pct(savingsRate)}</b></div></div>
      </div>

      <div class="grid cols-3 section">
        <div class="card stat"><div class="label">🏛️ Patrimonio neto</div><div class="value num">${money(nw.total)}</div><div class="sub">Debes ${money(nw.owe)} · Te deben ${money(nw.owed)}</div></div>
        <div class="card stat"><div class="label">📅 Gasto diario promedio</div><div class="value num">${money(dailyAvg)}</div><div class="sub">${isCurrent ? `Proyección del mes: <b>${money(projected)}</b>` : `${dayN} días`}</div></div>
        <div class="card stat"><div class="label">🎯 Metas de ahorro</div><div class="value num">${money(sum(state.goals, goalSaved))}</div><div class="sub">de ${money(sum(state.goals, (g) => g.target))} en ${state.goals.length} meta(s)</div></div>
      </div>

      <div class="grid cols-2 section">
        <div class="card"><h3>Gastos por categoría</h3>
          ${top.length ? `<div class="donut-wrap"><div class="chart">${donutChart(top, { center: 'Gastos' })}</div>${legend(top)}</div>` : emptyBox('🍃', 'Sin gastos este mes')}
        </div>
        <div class="card"><h3>Últimos 6 meses</h3>
          <div class="chart">${barChart(months, [{ key: 'income', label: 'Ingresos', color: 'var(--income)' }, { key: 'expense', label: 'Gastos', color: 'var(--expense)' }])}</div>
          <div class="chips" style="margin-top:8px"><span class="badge green">■ Ingresos</span><span class="badge red">■ Gastos</span></div>
        </div>
      </div>

      <div class="grid cols-2 section">
        <div class="card"><h3>💡 Consejos y alertas</h3>${insights(m).map((i) => `<div class="insight"><span>${i[0]}</span><span>${i[1]}</span></div>`).join('') || '<p class="muted">Todo en orden 👌</p>'}</div>
        <div class="card"><h3>Presupuestos <a href="#budgets" class="btn small ghost">Ver todos</a></h3>${budgetBars(m, 5) || emptyBox('📋', 'Aún no tienes presupuestos', '<a class="btn small primary" href="#budgets">Crear presupuesto</a>')}</div>
      </div>

      <div class="grid cols-2 section">
        <div class="card"><h3>Movimientos recientes <a href="#transactions" class="btn small ghost">Ver todos</a></h3>
          <div class="list">${recent.map(txItem).join('') || emptyBox('🧾', 'Aún no hay movimientos.<br>Toca <b>+</b> para agregar tu primer gasto o ingreso.')}</div>
        </div>
        <div class="card"><h3>Próximos pagos (14 días) <a href="#recurring" class="btn small ghost">Gestionar</a></h3>
          <div class="list">${upcoming.map((u) => `<div class="item"><div class="avatar">${u.icon}</div><div class="main"><div class="title">${esc(u.name)}</div><div class="meta">${shortDate(u.date)} · ${u.days === 0 ? '<b class="warn-text">Hoy</b>' : u.days < 0 ? `<b class="danger-text">Vencido</b>` : `en ${u.days} día(s)`}</div></div><div class="amount num ${u.type}">${money(u.amount)}</div></div>`).join('') || emptyBox('📆', 'No hay pagos próximos')}</div>
        </div>
      </div>`;
  },
  mount(root) { bindTxItems(root); },
};

function trend(cur, prev, upIsGood) {
  if (!prev) return 'vs mes anterior: —';
  const d = ((cur - prev) / prev) * 100;
  const good = upIsGood ? d >= 0 : d <= 0;
  return `<span class="${good ? 'income' : 'expense'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))}</span> vs mes anterior`;
}

function upcomingPayments(days) {
  const t = today();
  const out = [];
  for (const r of state.recurring) {
    if (r.paused) continue;
    let d = r.nextDate, g = 0;
    while (daysBetween(t, d) <= days && g++ < 60) {
      if (r.endDate && d > r.endDate) break;
      out.push({ name: r.name, date: d, days: daysBetween(t, d), amount: r.amount, type: r.type, icon: catById(r.categoryId).icon });
      d = addPeriod(d, r.frequency);
    }
  }
  for (const debt of state.debts) {
    if (debt.dueDate && debtRemaining(debt) > 0) {
      const dd = daysBetween(t, debt.dueDate);
      if (dd <= days) out.push({ name: (debt.kind === 'owe' ? 'Pagar a ' : 'Cobrar a ') + debt.name, date: debt.dueDate, days: dd, amount: debtRemaining(debt), type: debt.kind === 'owe' ? 'expense' : 'income', icon: debt.kind === 'owe' ? '💳' : '🤝' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function insights(m) {
  const out = [];
  const tot = monthTotals(m), prev = monthTotals(addMonthsKey(m, -1));
  if (tot.income > 0 && tot.expense > tot.income) out.push(['🚨', `Este mes gastas más de lo que ingresas: déficit de <b>${money(tot.expense - tot.income)}</b>.`]);
  if (tot.income > 0) {
    const r = (tot.net / tot.income) * 100;
    if (r >= 20) out.push(['🌟', `¡Excelente! Estás ahorrando el <b>${pct(r)}</b> de tus ingresos.`]);
    else if (r > 0 && r < 10) out.push(['💡', `Tu tasa de ahorro es <b>${pct(r)}</b>. Intenta llegar al 20% (regla 50/30/20).`]);
  }
  const cur = byCategory(m), prv = byCategory(addMonthsKey(m, -1));
  for (const c of cur.slice(0, 5)) {
    const p = prv.find((x) => x.id === c.id);
    if (p && p.value > 0 && c.value > p.value * 1.3 && c.value - p.value > 10) out.push(['📈', `Gastaste <b>${pct(((c.value - p.value) / p.value) * 100)}</b> más en ${c.cat.icon} ${esc(c.cat.name)} que el mes pasado.`]);
  }
  for (const b of state.budgets) {
    const spent = sum(txInMonth(m).filter((t) => t.type === 'expense' && t.categoryId === b.categoryId), (t) => t.amount);
    if (spent > b.amount) out.push(['⛔', `Superaste el presupuesto de ${esc(catById(b.categoryId).name)} por <b>${money(spent - b.amount)}</b>.`]);
  }
  const monthlyExp = avgMonthlyExpense(3);
  const emergency = sum(state.accounts.filter((a) => a.type === 'savings'), (a) => accountBalance(a.id));
  if (monthlyExp > 0 && state.transactions.length > 10) {
    const months = emergency / monthlyExp;
    if (months < 3) out.push(['🛟', `Tu fondo de emergencia (cuentas de ahorro) cubre <b>${months.toFixed(1)}</b> meses. Lo ideal es de 3 a 6.`]);
  }
  for (const a of state.accounts) {
    const bal = accountBalance(a.id);
    if (a.type !== 'credit' && bal < 0) out.push(['⚠️', `La cuenta <b>${esc(a.name)}</b> está en negativo (${money(bal)}).`]);
  }
  const subs = sum(state.recurring.filter((r) => r.type === 'expense' && !r.paused), (r) => r.amount * FREQ_PER_MONTH[r.frequency]);
  if (subs > 0 && tot.income > 0 && subs / tot.income > 0.5) out.push(['🔁', `Tus gastos fijos/recurrentes son el <b>${pct((subs / tot.income) * 100)}</b> de tus ingresos.`]);
  if (prev.expense > 0 && tot.expense < prev.expense * 0.9 && m !== monthOf(today())) out.push(['👏', `Gastaste <b>${money(prev.expense - tot.expense)}</b> menos que el mes anterior.`]);
  return out.slice(0, 6);
}

function avgMonthlyExpense(n) {
  const cur = monthOf(today());
  const ks = Array.from({ length: n }, (_, i) => addMonthsKey(cur, -i - 1));
  const vals = ks.map((k) => monthTotals(k).expense).filter((v) => v > 0);
  if (!vals.length) return monthTotals(cur).expense;
  return sum(vals) / vals.length;
}

function budgetBars(m, limit = 99) {
  return state.budgets.slice(0, limit).map((b) => {
    const cat = catById(b.categoryId);
    const spent = sum(txInMonth(m).filter((t) => t.type === 'expense' && t.categoryId === b.categoryId), (t) => t.amount);
    const p = (spent / b.amount) * 100;
    return `<div style="margin-bottom:12px" data-budget="${b.id}"><div class="row"><span>${cat.icon} ${esc(cat.name)}</span><span class="num"><b>${money(spent)}</b> <span class="muted">/ ${money(b.amount)}</span></span></div>
      <div class="progress ${p >= 100 ? 'over' : p >= 80 ? 'warn' : ''}"><div style="width:${clamp(p, 0, 100)}%;${p < 80 ? `background:${cat.color}` : ''}"></div></div>
      <div class="row muted" style="font-size:.8rem"><span>${pct(p)} usado</span><span>${spent <= b.amount ? `Quedan ${money(b.amount - spent)}` : `<span class="danger-text">Excedido ${money(spent - b.amount)}</span>`}</span></div></div>`;
  }).join('');
}

/* ---------- Movimientos ---------- */
VIEWS.transactions = {
  title: 'Movimientos', icon: '🧾', month: true,
  render() {
    const f = ui.txFilter || (ui.txFilter = { q: '', type: '', cat: '', acc: '', all: false });
    const q = f.q.toLowerCase();
    let txs = state.transactions.filter((t) =>
      (f.all || monthOf(t.date) === ui.month) &&
      (!f.type || t.type === f.type) && (!f.cat || t.categoryId === f.cat) &&
      (!f.acc || t.accountId === f.acc || t.toAccountId === f.acc) &&
      (!q || [t.note, catById(t.categoryId).name, accById(t.accountId).name, ...(t.tags || []), String(t.amount)].join(' ').toLowerCase().includes(q)));
    txs.sort((a, b) => b.date.localeCompare(a.date));
    const inc = sum(txs.filter((t) => t.type === 'income'), (t) => t.amount), exp = sum(txs.filter((t) => t.type === 'expense'), (t) => t.amount);
    const groups = {};
    txs.forEach((t) => (groups[t.date] = groups[t.date] || []).push(t));
    const shown = Object.keys(groups).slice(0, ui.txLimit || 60);
    return `
      <div class="filters">
        <input type="search" id="f-q" placeholder="🔍 Buscar por nota, categoría, etiqueta, monto…" value="${esc(f.q)}">
        <select id="f-type"><option value="">Todos los tipos</option><option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Gastos</option><option value="income" ${f.type === 'income' ? 'selected' : ''}>Ingresos</option><option value="transfer" ${f.type === 'transfer' ? 'selected' : ''}>Transferencias</option></select>
        <select id="f-cat"><option value="">Todas las categorías</option>${catOptions().map((o) => `<option value="${o.value}" ${o.value === f.cat ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
        <select id="f-acc"><option value="">Todas las cuentas</option>${accOptions().map((o) => `<option value="${o.value}" ${o.value === f.acc ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </div>
      <div class="row wrap" style="margin-bottom:12px">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="f-all" style="width:auto" ${f.all ? 'checked' : ''}> Ver todos los meses</label>
        <div class="chips"><span class="badge green num">+${money(inc)}</span><span class="badge red num">−${money(exp)}</span><span class="badge num">${txs.length} mov.</span><button class="btn small" id="export-csv">⬇️ CSV</button></div>
      </div>
      <div class="card"><div class="list">
        ${shown.map((d) => `<div class="day-head"><span>${dateLabel(d)}</span><span class="num">${money(sum(groups[d], (t) => t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0))}</span></div>${groups[d].map(txItem).join('')}`).join('') || emptyBox('🔎', 'No hay movimientos con estos filtros.')}
      </div>
      ${Object.keys(groups).length > shown.length ? '<button class="btn block" id="more">Cargar más</button>' : ''}</div>`;
  },
  mount(root) {
    bindTxItems(root);
    const f = ui.txFilter;
    const upd = (k, v) => { f[k] = v; saveUI(); render_(); };
    $('#f-q', root).oninput = (e) => { f.q = e.target.value; clearTimeout(this.t); this.t = setTimeout(() => { saveUI(); render_(); const el = $('#f-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
    $('#f-type', root).onchange = (e) => upd('type', e.target.value);
    $('#f-cat', root).onchange = (e) => upd('cat', e.target.value);
    $('#f-acc', root).onchange = (e) => upd('acc', e.target.value);
    $('#f-all', root).onchange = (e) => upd('all', e.target.checked);
    $('#export-csv', root).onclick = exportCSV;
    const more = $('#more', root);
    if (more) more.onclick = () => { ui.txLimit = (ui.txLimit || 60) + 60; render_(); };
  },
};

/* ---------- Cuentas ---------- */
VIEWS.accounts = {
  title: 'Cuentas', icon: '🏦',
  render() {
    const active = state.accounts.filter((a) => !a.archived), archived = state.accounts.filter((a) => a.archived);
    const card = (a) => {
      const bal = accountBalance(a.id);
      const [tName, tIcon] = ACCOUNT_TYPES[a.type] || ['Cuenta', '💰'];
      const extra = a.type === 'credit' && a.limit ? `<div style="font-size:.8rem;opacity:.9">Disponible: ${money(a.limit + bal)} de ${money(a.limit)}</div>` : '';
      return `<div class="acc-card" data-acc="${a.id}" style="background:linear-gradient(135deg, ${a.color}, ${a.color}bb)">
        <div><div class="acc-type">${tIcon} ${tName}</div><div class="acc-name">${esc(a.name)}</div></div>
        <div><div class="acc-bal">${money(bal)}</div>${extra}</div></div>`;
    };
    const nw = netWorth();
    const points = Array.from({ length: 12 }, (_, i) => addMonthsKey(monthOf(today()), i - 11)).map((k) => ({ label: monthLabel(k, true), value: totalBalance(`${k}-${pad(daysInMonth(k))}`) }));
    return `
      <div class="grid cols-3 keep-2">
        <div class="card stat"><div class="label">Saldo en cuentas</div><div class="value num">${money(nw.assets)}</div></div>
        <div class="card stat"><div class="label">Deudas pendientes</div><div class="value num expense">${money(nw.owe)}</div></div>
        <div class="card stat"><div class="label">Patrimonio neto</div><div class="value num ${nw.total >= 0 ? 'income' : 'expense'}">${money(nw.total)}</div></div>
      </div>
      <div class="section-head section"><h2>Mis cuentas</h2><div class="chips"><button class="btn small" id="transfer">🔄 Transferir</button><button class="btn small primary" id="add-acc">+ Nueva cuenta</button></div></div>
      <div class="grid cols-3">${active.map(card).join('')}</div>
      ${!active.length ? emptyBox('🏦', 'No tienes cuentas activas') : ''}
      ${archived.length ? `<div class="section"><h2 style="font-size:1rem;margin-bottom:10px" class="muted">Archivadas</h2><div class="grid cols-3">${archived.map(card).join('')}</div></div>` : ''}
      <div class="card section"><h3>Evolución del saldo total (12 meses)</h3><div class="chart">${lineChart(points)}</div></div>`;
  },
  mount(root) {
    $('#add-acc', root).onclick = () => accountForm();
    $('#transfer', root).onclick = () => transactionForm(null, { type: 'transfer' });
    $$('[data-acc]', root).forEach((el) => el.onclick = () => accountDetail(el.dataset.acc));
  },
};

function accountForm(acc = null) {
  formModal(acc ? 'Editar cuenta' : 'Nueva cuenta', [
    { name: 'name', label: 'Nombre', required: true, placeholder: 'Ej: Cuenta nómina' },
    { name: 'type', label: 'Tipo', type: 'select', options: Object.entries(ACCOUNT_TYPES).map(([v, [l, i]]) => ({ value: v, label: `${i} ${l}` })), half: true },
    { name: 'color', label: 'Color', type: 'color', default: '#0f766e', half: true },
    { name: 'initial', label: 'Saldo inicial (negativo si es deuda de tarjeta)', type: 'number', step: '0.01', half: true },
    { name: 'limit', label: 'Límite de crédito (opcional)', type: 'number', step: '0.01', half: true },
    { name: 'archived', label: 'Archivar cuenta (ocultar de formularios)', type: 'checkbox' },
  ], acc || {}, (v) => {
    if (acc) Object.assign(acc, v); else state.accounts.push({ id: uid(), ...v });
    save(); render_(); toast('Cuenta guardada');
  }, {
    onDelete: acc ? () => {
      const used = state.transactions.some((t) => t.accountId === acc.id || t.toAccountId === acc.id);
      if (used) { toast('La cuenta tiene movimientos. Archívala en lugar de eliminarla.'); return; }
      state.accounts = state.accounts.filter((a) => a.id !== acc.id); save(); render_();
    } : null,
  });
}

function accountDetail(id) {
  const acc = state.accounts.find((a) => a.id === id);
  const txs = state.transactions.filter((t) => t.accountId === id || t.toAccountId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  openModal(acc.name, `<div class="stat"><div class="label">Saldo actual</div><div class="value num">${money(accountBalance(id))}</div></div>
    <div class="form-actions" style="justify-content:flex-start;margin:12px 0"><button class="btn small" data-a="edit">✏️ Editar</button><button class="btn small" data-a="adjust">⚖️ Ajustar saldo</button><button class="btn small" data-a="add">+ Movimiento</button></div>
    <div class="list">${txs.map(txItem).join('') || emptyBox('🧾', 'Sin movimientos')}</div>`, (b) => {
    bindTxItems(b);
    $('[data-a=edit]', b).onclick = () => { closeModal(); accountForm(acc); };
    $('[data-a=add]', b).onclick = () => { closeModal(); transactionForm(null, { accountId: id }); };
    $('[data-a=adjust]', b).onclick = () => {
      closeModal();
      formModal('Ajustar saldo', [{ name: 'real', label: 'Saldo real actual', type: 'number', step: '0.01', required: true }], { real: accountBalance(id) }, (v) => {
        const diff = round2(v.real - accountBalance(id));
        if (!diff) return;
        const cat = state.categories.find((c) => c.type === (diff > 0 ? 'income' : 'expense') && /otros/i.test(c.name)) || state.categories.find((c) => c.type === (diff > 0 ? 'income' : 'expense'));
        state.transactions.push({ id: uid(), type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), date: today(), accountId: id, categoryId: cat?.id, note: 'Ajuste de saldo' });
        save(); render_(); toast('Saldo ajustado');
      });
    };
  });
}

/* ---------- Presupuestos ---------- */
VIEWS.budgets = {
  title: 'Presupuestos', icon: '📋', month: true,
  render() {
    const m = ui.month;
    const totalB = sum(state.budgets, (b) => b.amount);
    const spentB = sum(state.budgets, (b) => sum(txInMonth(m).filter((t) => t.type === 'expense' && t.categoryId === b.categoryId), (t) => t.amount));
    const tot = monthTotals(m);
    const isCurrent = m === monthOf(today());
    const daysLeft = isCurrent ? daysInMonth(m) - new Date().getDate() + 1 : 0;
    const unbudgeted = byCategory(m).filter((c) => !state.budgets.some((b) => b.categoryId === c.id));
    return `
      <div class="grid cols-3 keep-2">
        <div class="card stat"><div class="label">Presupuesto total</div><div class="value num">${money(totalB)}</div></div>
        <div class="card stat"><div class="label">Gastado (en presupuestos)</div><div class="value num ${spentB > totalB ? 'expense' : ''}">${money(spentB)}</div><div class="progress ${spentB > totalB ? 'over' : ''}"><div style="width:${clamp(totalB ? (spentB / totalB) * 100 : 0, 0, 100)}%"></div></div></div>
        <div class="card stat"><div class="label">Disponible</div><div class="value num ${totalB - spentB < 0 ? 'expense' : 'income'}">${money(totalB - spentB)}</div>${isCurrent && totalB > spentB ? `<div class="sub">≈ ${money((totalB - spentB) / daysLeft)} por día (${daysLeft} días restantes)</div>` : ''}</div>
      </div>
      <div class="section-head section"><h2>Por categoría</h2><div class="chips"><button class="btn small" id="b-auto">✨ Sugerir</button><button class="btn small primary" id="b-add">+ Presupuesto</button></div></div>
      <div class="card">${budgetBars(m) || emptyBox('📋', 'Define cuánto quieres gastar como máximo cada mes en cada categoría.')}</div>
      ${unbudgeted.length ? `<div class="card section"><h3>Gastos sin presupuesto este mes</h3><div class="list">${unbudgeted.map((c) => `<div class="item"><div class="avatar" style="background:${c.cat.color}22">${c.cat.icon}</div><div class="main"><div class="title">${esc(c.cat.name)}</div></div><div class="num">${money(c.value)}</div><button class="btn small" data-quick="${c.id}">+ Presupuesto</button></div>`).join('')}</div></div>` : ''}
      <div class="card section"><h3>Regla 50/30/20 con tus ingresos del mes</h3>${rule503020(tot.income)}</div>`;
  },
  mount(root) {
    $('#b-add', root).onclick = () => budgetForm();
    $('#b-auto', root).onclick = suggestBudgets;
    $$('[data-budget]', root).forEach((el) => { el.style.cursor = 'pointer'; el.onclick = () => budgetForm(state.budgets.find((b) => b.id === el.dataset.budget)); });
    $$('[data-quick]', root).forEach((el) => el.onclick = () => budgetForm(null, el.dataset.quick));
  },
};

function rule503020(income) {
  if (!income) return '<p class="muted">Registra tus ingresos del mes para ver la distribución recomendada.</p>';
  return `<div class="grid cols-3">${[['🏠 Necesidades', 0.5, 'Vivienda, comida, servicios, transporte'], ['🎉 Deseos', 0.3, 'Ocio, restaurantes, compras'], ['🐷 Ahorro / deudas', 0.2, 'Fondo de emergencia, inversión, pagar deudas']].map(([n, p, d]) => `<div class="result-box" style="margin:0"><div>${n} (${p * 100}%)</div><div class="big num">${money(income * p)}</div><div class="muted" style="font-size:.8rem">${d}</div></div>`).join('')}</div>`;
}

function budgetForm(b = null, presetCat = null) {
  const used = state.budgets.filter((x) => x !== b).map((x) => x.categoryId);
  const opts = catOptions('expense').filter((o) => !used.includes(o.value));
  if (!opts.length) { toast('Ya tienes presupuesto para todas las categorías'); return; }
  formModal(b ? 'Editar presupuesto' : 'Nuevo presupuesto', [
    { name: 'categoryId', label: 'Categoría', type: 'select', options: opts },
    { name: 'amount', label: 'Monto mensual máximo', type: 'number', step: '0.01', min: '0.01', required: true },
  ], b || { categoryId: presetCat }, (v) => {
    if (!(v.amount > 0)) { toast('Monto inválido'); return false; }
    if (b) Object.assign(b, v); else state.budgets.push({ id: uid(), ...v });
    save(); render_(); toast('Presupuesto guardado');
  }, { onDelete: b ? () => { state.budgets = state.budgets.filter((x) => x !== b); save(); render_(); } : null });
}

function suggestBudgets() {
  const cur = monthOf(today());
  const ks = [1, 2, 3].map((i) => addMonthsKey(cur, -i));
  const totals = {};
  ks.forEach((k) => byCategory(k).forEach((c) => (totals[c.id] = (totals[c.id] || 0) + c.value)));
  const entries = Object.entries(totals).filter(([id]) => !state.budgets.some((b) => b.categoryId === id));
  if (!entries.length) { toast('No hay suficiente historial (3 meses) o ya tienes presupuestos para todo'); return; }
  const sugg = entries.map(([id, v]) => ({ id, amount: Math.ceil((v / 3) * 0.95 / 5) * 5 }));
  openModal('Presupuestos sugeridos', `<p class="muted">Basado en tu gasto promedio de los últimos 3 meses (con un 5% de reducción).</p>
    <div class="list">${sugg.map((s) => `<div class="item"><div class="avatar">${catById(s.id).icon}</div><div class="main"><div class="title">${esc(catById(s.id).name)}</div></div><div class="num">${money(s.amount)}</div></div>`).join('')}</div>
    <div class="form-actions"><button class="btn" data-a="no">Cancelar</button><button class="btn primary" data-a="yes">Aplicar todos</button></div>`, (b) => {
    $('[data-a=no]', b).onclick = closeModal;
    $('[data-a=yes]', b).onclick = () => { sugg.forEach((s) => state.budgets.push({ id: uid(), categoryId: s.id, amount: s.amount })); save(); closeModal(); render_(); toast('Presupuestos creados'); };
  });
}

/* ---------- Metas de ahorro ---------- */
VIEWS.goals = {
  title: 'Metas de ahorro', icon: '🎯',
  render() {
    const total = sum(state.goals, (g) => g.target), saved = sum(state.goals, goalSaved);
    return `
      <div class="grid cols-3 keep-2">
        <div class="card stat"><div class="label">Ahorrado en metas</div><div class="value num income">${money(saved)}</div></div>
        <div class="card stat"><div class="label">Objetivo total</div><div class="value num">${money(total)}</div><div class="progress"><div style="width:${clamp(total ? (saved / total) * 100 : 0, 0, 100)}%"></div></div></div>
        <div class="card stat"><div class="label">Metas completadas</div><div class="value num">${state.goals.filter((g) => goalSaved(g) >= g.target).length} / ${state.goals.length}</div></div>
      </div>
      <div class="section-head section"><h2>Mis metas</h2><button class="btn small primary" id="g-add">+ Nueva meta</button></div>
      <div class="grid cols-2">${state.goals.map((g) => {
        const s = goalSaved(g), p = g.target ? (s / g.target) * 100 : 0;
        let plan = '';
        if (g.deadline && s < g.target) {
          const months = Math.max(1, (parseISO(g.deadline) - new Date()) / (86400000 * 30.44));
          plan = daysBetween(today(), g.deadline) < 0 ? '<span class="danger-text">Fecha límite vencida</span>' : `Ahorra <b>${money((g.target - s) / months)}</b>/mes (${money((g.target - s) / Math.max(1, months * 4.345))}/semana) para lograrlo el ${shortDate(g.deadline)}`;
        }
        return `<div class="card"><h3><span>${esc(g.icon || '🎯')} ${esc(g.name)}</span>${p >= 100 ? '<span class="badge green">¡Lograda! 🎉</span>' : `<span class="badge">${pct(p)}</span>`}</h3>
          <div class="row"><span class="num"><b>${money(s)}</b> <span class="muted">de ${money(g.target)}</span></span><span class="muted num">Faltan ${money(Math.max(0, g.target - s))}</span></div>
          <div class="progress"><div style="width:${clamp(p, 0, 100)}%;background:${g.color || 'var(--primary)'}"></div></div>
          <p class="muted" style="font-size:.85rem;margin:8px 0">${plan}</p>
          <div class="chips"><button class="btn small primary" data-gadd="${g.id}">+ Aportar</button><button class="btn small" data-gsub="${g.id}">− Retirar</button><button class="btn small ghost" data-gedit="${g.id}">✏️ Editar</button><button class="btn small ghost" data-ghist="${g.id}">🕑 Historial</button></div></div>`;
      }).join('')}</div>
      ${!state.goals.length ? `<div class="card">${emptyBox('🎯', 'Crea metas como "Fondo de emergencia", "Viaje" o "Laptop nueva" y registra tus aportes.')}</div>` : ''}`;
  },
  mount(root) {
    $('#g-add', root).onclick = () => goalForm();
    const find = (id) => state.goals.find((g) => g.id === id);
    $$('[data-gedit]', root).forEach((el) => el.onclick = () => goalForm(find(el.dataset.gedit)));
    $$('[data-gadd]', root).forEach((el) => el.onclick = () => goalContribution(find(el.dataset.gadd), 1));
    $$('[data-gsub]', root).forEach((el) => el.onclick = () => goalContribution(find(el.dataset.gsub), -1));
    $$('[data-ghist]', root).forEach((el) => el.onclick = () => {
      const g = find(el.dataset.ghist);
      openModal('Historial: ' + g.name, `<div class="list">${[...(g.contributions || [])].reverse().map((c) => `<div class="item"><div class="main"><div class="title">${shortDate(c.date)}</div><div class="meta">${esc(c.note || '')}</div></div><div class="num ${c.amount >= 0 ? 'income' : 'expense'}">${money(c.amount)}</div></div>`).join('') || emptyBox('🕑', 'Sin aportes todavía')}</div>`);
    });
  },
};

function goalForm(g = null) {
  formModal(g ? 'Editar meta' : 'Nueva meta', [
    { name: 'name', label: 'Nombre de la meta', required: true, placeholder: 'Ej: Fondo de emergencia' },
    { name: 'icon', label: 'Emoji', default: '🎯', half: true },
    { name: 'color', label: 'Color', type: 'color', default: '#0f766e', half: true },
    { name: 'target', label: 'Monto objetivo', type: 'number', step: '0.01', min: '0.01', required: true, half: true },
    { name: 'deadline', label: 'Fecha límite (opcional)', type: 'date', half: true },
    ...(g ? [] : [{ name: 'initial', label: 'Ya tengo ahorrado (opcional)', type: 'number', step: '0.01' }]),
  ], g || {}, (v) => {
    if (g) { Object.assign(g, v); }
    else {
      const initial = v.initial; delete v.initial;
      state.goals.push({ id: uid(), ...v, contributions: initial > 0 ? [{ date: today(), amount: initial, note: 'Saldo inicial' }] : [] });
    }
    save(); render_(); toast('Meta guardada');
  }, { onDelete: g ? () => { state.goals = state.goals.filter((x) => x !== g); save(); render_(); } : null });
}

function goalContribution(g, sign) {
  formModal(sign > 0 ? `Aportar a "${g.name}"` : `Retirar de "${g.name}"`, [
    { name: 'amount', label: 'Monto', type: 'number', step: '0.01', min: '0.01', required: true },
    { name: 'date', label: 'Fecha', type: 'date', default: today(), half: true },
    { name: 'accountId', label: sign > 0 ? 'Sacar dinero de (opcional)' : 'Depositar en (opcional)', type: 'select', options: [{ value: '', label: '— No registrar movimiento —' }, ...accOptions()], half: true },
    { name: 'note', label: 'Nota' },
  ], {}, (v) => {
    if (!(v.amount > 0)) return false;
    g.contributions = g.contributions || [];
    g.contributions.push({ date: v.date, amount: sign * v.amount, note: v.note });
    if (v.accountId) {
      const savingsAcc = state.accounts.find((a) => a.type === 'savings' && a.id !== v.accountId && !a.archived);
      if (savingsAcc) state.transactions.push({ id: uid(), type: 'transfer', amount: v.amount, date: v.date, accountId: sign > 0 ? v.accountId : savingsAcc.id, toAccountId: sign > 0 ? savingsAcc.id : v.accountId, note: `Meta: ${g.name}` });
      else toast('Tip: crea una cuenta de tipo "Ahorros" para mover el dinero automáticamente');
    }
    save(); render_();
    if (sign > 0 && goalSaved(g) >= g.target) setTimeout(() => toast(`🎉 ¡Felicidades! Completaste la meta "${g.name}"`), 300);
  });
}

/* ---------- Deudas y préstamos ---------- */
VIEWS.debts = {
  title: 'Deudas y préstamos', icon: '💳',
  render() {
    const owe = state.debts.filter((d) => d.kind === 'owe'), owed = state.debts.filter((d) => d.kind === 'owed');
    const block = (list, title, emptyMsg) => `<div class="section-head section"><h2>${title}</h2></div>
      <div class="grid cols-2">${list.map((d) => {
        const rem = debtRemaining(d), paid = d.amount - rem, p = d.amount ? (paid / d.amount) * 100 : 0;
        const due = d.dueDate ? daysBetween(today(), d.dueDate) : null;
        const dueTxt = due === null ? '' : rem <= 0 ? '' : due < 0 ? `<span class="badge red">Vencida hace ${-due} días</span>` : due <= 7 ? `<span class="badge amber">Vence en ${due} días</span>` : `<span class="badge">Vence ${shortDate(d.dueDate)}</span>`;
        return `<div class="card"><h3><span>${d.kind === 'owe' ? '💳' : '🤝'} ${esc(d.name)}</span>${rem <= 0 ? '<span class="badge green">Saldada ✓</span>' : dueTxt}</h3>
          <div class="row"><span>Pendiente: <b class="num ${d.kind === 'owe' ? 'expense' : 'income'}">${money(rem)}</b></span><span class="muted num">de ${money(d.amount)}</span></div>
          <div class="progress"><div style="width:${clamp(p, 0, 100)}%;background:var(--income)"></div></div>
          <p class="muted" style="font-size:.82rem;margin:6px 0">${d.interest ? `Interés: ${d.interest}% anual · ` : ''}${d.minPayment ? `Pago mínimo: ${money(d.minPayment)} · ` : ''}${(d.payments || []).length} pago(s)${d.note ? ' · ' + esc(d.note) : ''}</p>
          <div class="chips">${rem > 0 ? `<button class="btn small primary" data-dpay="${d.id}">${d.kind === 'owe' ? 'Registrar pago' : 'Registrar cobro'}</button>` : ''}<button class="btn small ghost" data-dedit="${d.id}">✏️ Editar</button><button class="btn small ghost" data-dhist="${d.id}">🕑 Pagos</button></div></div>`;
      }).join('')}</div>${!list.length ? `<div class="card">${emptyBox(title.split(' ')[0], emptyMsg)}</div>` : ''}`;
    const active = owe.filter((d) => debtRemaining(d) > 0);
    const strategy = active.length > 1 ? `<div class="card section"><h3>🧠 Estrategia para salir de deudas</h3>
      <div class="grid cols-2"><div><b>❄️ Bola de nieve</b> <span class="muted">(menor saldo primero, más motivación)</span><ol>${[...active].sort((a, b) => debtRemaining(a) - debtRemaining(b)).map((d) => `<li>${esc(d.name)} — ${money(debtRemaining(d))}</li>`).join('')}</ol></div>
      <div><b>🏔️ Avalancha</b> <span class="muted">(mayor interés primero, ahorras más)</span><ol>${[...active].sort((a, b) => (b.interest || 0) - (a.interest || 0)).map((d) => `<li>${esc(d.name)} — ${d.interest || 0}%</li>`).join('')}</ol></div></div>
      <p class="muted" style="font-size:.85rem">Paga el mínimo en todas y destina todo el dinero extra a la primera de la lista. Cuando la saldes, pasa a la siguiente.</p></div>` : '';
    return `
      <div class="grid cols-3 keep-2">
        <div class="card stat"><div class="label">Yo debo</div><div class="value num expense">${money(sum(owe, debtRemaining))}</div></div>
        <div class="card stat"><div class="label">Me deben</div><div class="value num income">${money(sum(owed, debtRemaining))}</div></div>
        <div class="card stat"><div class="label">Balance</div><div class="value num">${money(sum(owed, debtRemaining) - sum(owe, debtRemaining))}</div></div>
      </div>
      <div class="row section" style="justify-content:flex-end"><button class="btn small primary" id="d-add">+ Nueva deuda / préstamo</button></div>
      ${block(owe, '💳 Lo que debo', 'Registra préstamos, tarjetas o dinero que debes.')}
      ${strategy}
      ${block(owed, '🤝 Lo que me deben', 'Registra el dinero que prestaste a otros.')}`;
  },
  mount(root) {
    const find = (id) => state.debts.find((d) => d.id === id);
    $('#d-add', root).onclick = () => debtForm();
    $$('[data-dedit]', root).forEach((el) => el.onclick = () => debtForm(find(el.dataset.dedit)));
    $$('[data-dpay]', root).forEach((el) => el.onclick = () => debtPayment(find(el.dataset.dpay)));
    $$('[data-dhist]', root).forEach((el) => el.onclick = () => {
      const d = find(el.dataset.dhist);
      openModal('Pagos: ' + d.name, `<div class="list">${[...(d.payments || [])].reverse().map((p) => `<div class="item"><div class="main"><div class="title">${shortDate(p.date)}</div><div class="meta">${esc(p.note || '')}</div></div><div class="num">${money(p.amount)}</div></div>`).join('') || emptyBox('🕑', 'Sin pagos aún')}</div>`);
    });
  },
};

function debtForm(d = null) {
  formModal(d ? 'Editar deuda' : 'Nueva deuda / préstamo', [
    { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'owe', label: '💳 Yo debo' }, { value: 'owed', label: '🤝 Me deben' }] },
    { name: 'name', label: 'Persona o entidad', required: true, placeholder: 'Ej: Banco, Tarjeta Visa, Juan' },
    { name: 'amount', label: 'Monto total', type: 'number', step: '0.01', min: '0.01', required: true, half: true },
    { name: 'interest', label: 'Interés anual % (opcional)', type: 'number', step: '0.01', half: true },
    { name: 'minPayment', label: 'Pago mínimo (opcional)', type: 'number', step: '0.01', half: true },
    { name: 'dueDate', label: 'Fecha de vencimiento', type: 'date', half: true },
    { name: 'note', label: 'Nota', type: 'textarea' },
  ], d || {}, (v) => {
    if (d) Object.assign(d, v); else state.debts.push({ id: uid(), ...v, payments: [], created: today() });
    save(); render_(); toast('Guardado');
  }, { onDelete: d ? () => { state.debts = state.debts.filter((x) => x !== d); save(); render_(); } : null });
}

function debtPayment(d) {
  const rem = debtRemaining(d);
  const cat = state.categories.find((c) => c.type === 'expense' && /deuda/i.test(c.name));
  formModal(d.kind === 'owe' ? `Pago a ${d.name}` : `Cobro a ${d.name}`, [
    { name: 'amount', label: `Monto (pendiente: ${money(rem)})`, type: 'number', step: '0.01', min: '0.01', required: true },
    { name: 'date', label: 'Fecha', type: 'date', default: today(), half: true },
    { name: 'accountId', label: 'Cuenta', type: 'select', options: [{ value: '', label: '— No registrar movimiento —' }, ...accOptions()], half: true },
    { name: 'note', label: 'Nota' },
  ], { amount: d.minPayment && d.minPayment < rem ? d.minPayment : rem, accountId: state.accounts[0]?.id }, (v) => {
    if (!(v.amount > 0)) return false;
    d.payments = d.payments || [];
    d.payments.push({ date: v.date, amount: v.amount, note: v.note });
    if (v.accountId) {
      const type = d.kind === 'owe' ? 'expense' : 'income';
      const c = type === 'expense' ? cat : state.categories.find((x) => x.type === 'income' && /otros/i.test(x.name));
      state.transactions.push({ id: uid(), type, amount: v.amount, date: v.date, accountId: v.accountId, categoryId: c?.id || catOptions(type)[0]?.value, note: (d.kind === 'owe' ? 'Pago deuda: ' : 'Cobro préstamo: ') + d.name });
    }
    save(); render_();
    if (debtRemaining(d) <= 0) setTimeout(() => toast(`🎉 ¡Deuda con ${d.name} saldada!`), 300);
  });
}

/* ---------- Recurrentes ---------- */
VIEWS.recurring = {
  title: 'Pagos recurrentes', icon: '🔁',
  render() {
    const exp = state.recurring.filter((r) => r.type === 'expense' && !r.paused), inc = state.recurring.filter((r) => r.type === 'income' && !r.paused);
    const monthlyExp = sum(exp, (r) => r.amount * FREQ_PER_MONTH[r.frequency]), monthlyInc = sum(inc, (r) => r.amount * FREQ_PER_MONTH[r.frequency]);
    const list = [...state.recurring].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
    return `
      <div class="grid cols-3 keep-2">
        <div class="card stat"><div class="label">Gastos fijos / mes</div><div class="value num expense">${money(monthlyExp)}</div><div class="sub">${money(monthlyExp * 12)} al año</div></div>
        <div class="card stat"><div class="label">Ingresos fijos / mes</div><div class="value num income">${money(monthlyInc)}</div></div>
        <div class="card stat"><div class="label">Libre después de fijos</div><div class="value num">${money(monthlyInc - monthlyExp)}</div></div>
      </div>
      <div class="section-head section"><h2>Suscripciones, facturas y salarios</h2><button class="btn small primary" id="r-add">+ Nuevo recurrente</button></div>
      <div class="card"><div class="list">${list.map((r) => {
        const cat = catById(r.categoryId), dd = daysBetween(today(), r.nextDate);
        return `<div class="item clickable" data-rec="${r.id}"><div class="avatar" style="background:${cat.color}22">${cat.icon}</div>
          <div class="main"><div class="title">${esc(r.name)} ${r.paused ? '<span class="badge">Pausado</span>' : ''}</div><div class="meta">${FREQ[r.frequency]} · próximo: ${shortDate(r.nextDate)}${dd >= 0 && dd <= 3 && !r.paused ? ' ⏰' : ''} · ${r.auto ? 'Automático' : 'Manual'}</div></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="amount num ${r.type}">${money(r.amount)}</span>${!r.auto && !r.paused ? `<button class="btn small" data-rpay="${r.id}">Registrar</button>` : ''}</div></div>`;
      }).join('') || emptyBox('🔁', 'Agrega tu alquiler, Netflix, salario, luz, gimnasio… Se registrarán solos en su fecha.')}</div></div>`;
  },
  mount(root) {
    $('#r-add', root).onclick = () => recurringForm();
    $$('[data-rec]', root).forEach((el) => el.onclick = (e) => { if (e.target.closest('[data-rpay]')) return; recurringForm(state.recurring.find((r) => r.id === el.dataset.rec)); });
    $$('[data-rpay]', root).forEach((el) => el.onclick = () => {
      const r = state.recurring.find((x) => x.id === el.dataset.rpay);
      state.transactions.push({ id: uid(), type: r.type, amount: r.amount, date: r.nextDate > today() ? today() : r.nextDate, categoryId: r.categoryId, accountId: r.accountId, note: r.name, recurringId: r.id });
      r.nextDate = addPeriod(r.nextDate, r.frequency);
      save(); render_(); toast('Pago registrado ✅');
    });
  },
};

function recurringForm(r = null) {
  const type = r?.type || 'expense';
  formModal(r ? 'Editar recurrente' : 'Nuevo pago recurrente', [
    { name: 'type', label: 'Tipo', type: 'select', options: [{ value: 'expense', label: '⬇️ Gasto' }, { value: 'income', label: '⬆️ Ingreso' }], half: true },
    { name: 'frequency', label: 'Frecuencia', type: 'select', options: Object.entries(FREQ).map(([v, l]) => ({ value: v, label: l })), default: 'monthly', half: true },
    { name: 'name', label: 'Nombre', required: true, placeholder: 'Ej: Netflix, Alquiler, Salario' },
    { name: 'amount', label: 'Monto', type: 'number', step: '0.01', min: '0.01', required: true, half: true },
    { name: 'nextDate', label: 'Próxima fecha', type: 'date', default: today(), required: true, half: true },
    { name: 'categoryId', label: 'Categoría', type: 'select', options: [...catOptions('expense'), ...catOptions('income')], half: true },
    { name: 'accountId', label: 'Cuenta', type: 'select', options: accOptions(), half: true },
    { name: 'endDate', label: 'Fecha de fin (opcional)', type: 'date' },
    { name: 'auto', label: 'Registrar automáticamente en su fecha', type: 'checkbox', default: true },
    { name: 'paused', label: 'Pausado', type: 'checkbox' },
  ], r || { type }, (v) => {
    if (catById(v.categoryId).type !== v.type) v.categoryId = catOptions(v.type)[0]?.value;
    if (r) Object.assign(r, v); else state.recurring.push({ id: uid(), ...v });
    processRecurring(); save(); render_(); toast('Guardado');
  }, { onDelete: r ? () => { state.recurring = state.recurring.filter((x) => x !== r); save(); render_(); } : null });
}

/* ---------- Reportes ---------- */
VIEWS.reports = {
  title: 'Reportes', icon: '📊', month: true,
  render() {
    const m = ui.month;
    const range = ui.reportRange || 12;
    const keys = Array.from({ length: range }, (_, i) => addMonthsKey(m, i - range + 1));
    const months = keys.map((k) => ({ key: k, label: monthLabel(k, true), ...monthTotals(k) }));
    const exp = byCategory(m).map((c) => ({ label: c.cat.icon + ' ' + c.cat.name, value: c.value, color: c.cat.color }));
    const inc = byCategory(m, 'income').map((c) => ({ label: c.cat.icon + ' ' + c.cat.name, value: c.value, color: c.cat.color }));
    const withData = months.filter((x) => x.count);
    const avgInc = withData.length ? sum(withData, (x) => x.income) / withData.length : 0;
    const avgExp = withData.length ? sum(withData, (x) => x.expense) / withData.length : 0;
    const topTx = txInMonth(m).filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);
    // gasto por día de la semana
    const dow = [0, 0, 0, 0, 0, 0, 0];
    txInMonth(m).filter((t) => t.type === 'expense').forEach((t) => (dow[(parseISO(t.date).getDay() + 6) % 7] += t.amount));
    const dowData = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((l, i) => ({ label: l, v: dow[i] }));
    // acumulado del mes
    let acc = 0;
    const dim = m === monthOf(today()) ? new Date().getDate() : daysInMonth(m);
    const daily = Array.from({ length: dim }, (_, i) => { const d = `${m}-${pad(i + 1)}`; acc += sum(state.transactions.filter((t) => t.date === d && t.type === 'expense'), (t) => t.amount); return { label: String(i + 1), value: acc }; });
    // etiquetas
    const tags = {};
    txInMonth(m).filter((t) => t.type === 'expense').forEach((t) => (t.tags || []).forEach((g) => (tags[g] = (tags[g] || 0) + t.amount)));
    return `
      <div class="chips" style="margin-bottom:14px">${[3, 6, 12, 24].map((n) => `<button class="chip ${range === n ? 'active' : ''}" data-range="${n}">${n} meses</button>`).join('')}</div>
      <div class="grid cols-4 keep-2">
        <div class="card stat"><div class="label">Ingreso promedio/mes</div><div class="value num income">${money(avgInc)}</div></div>
        <div class="card stat"><div class="label">Gasto promedio/mes</div><div class="value num expense">${money(avgExp)}</div></div>
        <div class="card stat"><div class="label">Ahorro total (${range}m)</div><div class="value num">${money(sum(months, (x) => x.net))}</div></div>
        <div class="card stat"><div class="label">Tasa de ahorro (${range}m)</div><div class="value num">${pct(sum(months, (x) => x.income) ? (sum(months, (x) => x.net) / sum(months, (x) => x.income)) * 100 : 0)}</div></div>
      </div>
      <div class="card section"><h3>Ingresos vs gastos</h3><div class="chart">${barChart(months, [{ key: 'income', label: 'Ingresos', color: 'var(--income)' }, { key: 'expense', label: 'Gastos', color: 'var(--expense)' }])}</div></div>
      <div class="card section"><h3>Ahorro neto por mes</h3><div class="chart">${lineChart(months.map((x) => ({ label: x.label, value: x.net })))}</div></div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Gastos · ${monthLabel(m)}</h3>${exp.length ? `<div class="donut-wrap"><div class="chart">${donutChart(exp, { center: 'Gastos' })}</div>${legend(exp)}</div>` : emptyBox('🍃', 'Sin gastos')}</div>
        <div class="card"><h3>Ingresos · ${monthLabel(m)}</h3>${inc.length ? `<div class="donut-wrap"><div class="chart">${donutChart(inc, { center: 'Ingresos' })}</div>${legend(inc)}</div>` : emptyBox('🍃', 'Sin ingresos')}</div>
      </div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Gasto acumulado del mes</h3><div class="chart">${lineChart(daily, { color: 'var(--expense)' })}</div></div>
        <div class="card"><h3>Gasto por día de la semana</h3><div class="chart">${barChart(dowData, [{ key: 'v', label: 'Gasto', color: 'var(--warn)' }])}</div></div>
      </div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Top 5 gastos del mes</h3><div class="list">${topTx.map(txItem).join('') || emptyBox('🍃', 'Sin gastos')}</div></div>
        <div class="card"><h3>Gastos por etiqueta</h3>${Object.keys(tags).length ? `<div class="legend">${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([g, v]) => `<div class="lg"><span class="name">#${esc(g)}</span><span class="num">${money(v)}</span></div>`).join('')}</div>` : '<p class="muted">Agrega etiquetas a tus movimientos (ej. "vacaciones") para agruparlos aquí.</p>'}</div>
      </div>
      <div class="card section"><h3>Resumen mensual</h3><div class="table-wrap"><table><thead><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Neto</th><th class="r">Ahorro</th></tr></thead><tbody>
        ${[...months].reverse().map((x) => `<tr><td>${monthLabel(x.key)}</td><td class="r num income">${money(x.income)}</td><td class="r num expense">${money(x.expense)}</td><td class="r num ${x.net >= 0 ? 'income' : 'expense'}">${money(x.net)}</td><td class="r">${x.income ? pct((x.net / x.income) * 100) : '—'}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  },
  mount(root) {
    bindTxItems(root);
    $$('[data-range]', root).forEach((el) => el.onclick = () => { ui.reportRange = Number(el.dataset.range); saveUI(); render_(); });
  },
};

/* ---------- Herramientas / calculadoras ---------- */
const TOOLS = {
  compound: {
    name: '📈 Interés compuesto', desc: '¿Cuánto crecerá tu dinero invirtiendo?',
    fields: [['initial', 'Monto inicial', 1000], ['monthly', 'Aporte mensual', 100], ['rate', 'Interés anual (%)', 8], ['years', 'Años', 10]],
    calc({ initial, monthly, rate, years }) {
      const r = rate / 100 / 12; let bal = initial; const rows = [];
      for (let y = 1; y <= years; y++) { for (let mm = 0; mm < 12; mm++) bal = bal * (1 + r) + monthly; rows.push({ y, bal, contrib: initial + monthly * 12 * y }); }
      const contrib = initial + monthly * 12 * years;
      return `<div class="result-box"><div class="muted">Valor final</div><div class="big num income">${money(bal)}</div><div class="muted">Aportaste ${money(contrib)} · Intereses ganados: <b>${money(bal - contrib)}</b></div></div>
        <div class="chart" style="margin-top:12px">${lineChart(rows.map((x) => ({ label: 'A' + x.y, value: x.bal })))}</div>`;
    },
  },
  loan: {
    name: '🏦 Préstamo / crédito', desc: 'Calcula la cuota mensual y el costo total',
    fields: [['amount', 'Monto del préstamo', 10000], ['rate', 'Interés anual (%)', 15], ['months', 'Plazo (meses)', 24]],
    calc({ amount, rate, months }) {
      const r = rate / 100 / 12;
      const pay = r ? (amount * r) / (1 - Math.pow(1 + r, -months)) : amount / months;
      let bal = amount, rows = '';
      for (let i = 1; i <= months; i++) { const int = bal * r, cap = pay - int; bal -= cap; if (i <= 12 || i === months) rows += `<tr><td>${i}</td><td class="r num">${money(pay)}</td><td class="r num">${money(cap)}</td><td class="r num">${money(int)}</td><td class="r num">${money(Math.max(0, bal))}</td></tr>`; else if (i === 13) rows += '<tr><td colspan="5" class="muted">…</td></tr>'; }
      return `<div class="result-box"><div class="muted">Cuota mensual</div><div class="big num">${money(pay)}</div><div class="muted">Total a pagar: <b>${money(pay * months)}</b> · Intereses: <b class="expense">${money(pay * months - amount)}</b></div></div>
        <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th class="r">Cuota</th><th class="r">Capital</th><th class="r">Interés</th><th class="r">Saldo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    },
  },
  payoff: {
    name: '💳 Salir de una deuda', desc: '¿Cuánto tardarás en pagar tu tarjeta?',
    fields: [['balance', 'Saldo de la deuda', 3000], ['rate', 'Interés anual (%)', 36], ['payment', 'Pago mensual', 200]],
    calc({ balance, rate, payment }) {
      const r = rate / 100 / 12; let bal = balance, m = 0, interest = 0;
      if (payment <= balance * r) return `<div class="result-box danger-text">Con ese pago nunca terminarás: el interés mensual es ${money(balance * r)}. Necesitas pagar más.</div>`;
      while (bal > 0 && m < 1200) { const i = bal * r; interest += i; bal = bal + i - payment; m++; }
      return `<div class="result-box"><div class="muted">Tiempo para pagarla</div><div class="big">${Math.floor(m / 12)} años y ${m % 12} meses</div><div class="muted">Pagarás <b class="expense">${money(interest)}</b> en intereses (total ${money(balance + interest)})</div></div>`;
    },
  },
  emergency: {
    name: '🛟 Fondo de emergencia', desc: 'Cuánto deberías tener ahorrado para imprevistos',
    fields: [['expenses', 'Gastos mensuales esenciales', 0], ['months', 'Meses de cobertura (3-6)', 6], ['saved', 'Ya tengo ahorrado', 0], ['monthly', 'Puedo ahorrar al mes', 100]],
    defaults() { return { expenses: Math.round(avgMonthlyExpense(3)) || 800, saved: Math.round(sum(state.accounts.filter((a) => a.type === 'savings'), (a) => accountBalance(a.id))) }; },
    calc({ expenses, months, saved, monthly }) {
      const target = expenses * months, left = Math.max(0, target - saved);
      return `<div class="result-box"><div class="muted">Meta del fondo</div><div class="big num">${money(target)}</div><div class="progress"><div style="width:${clamp((saved / (target || 1)) * 100, 0, 100)}%"></div></div><div class="muted">Te faltan ${money(left)}${monthly > 0 && left > 0 ? ` · Lo lograrás en <b>${Math.ceil(left / monthly)} meses</b>` : ''}</div></div>`;
    },
  },
  goalplan: {
    name: '🎯 Plan de ahorro', desc: 'Cuánto ahorrar por mes para lograr una meta',
    fields: [['target', 'Meta', 5000], ['saved', 'Ya tengo', 0], ['months', 'En cuántos meses', 12], ['rate', 'Rendimiento anual (%)', 0]],
    calc({ target, saved, months, rate }) {
      const r = rate / 100 / 12;
      const fvSaved = saved * Math.pow(1 + r, months);
      const need = Math.max(0, target - fvSaved);
      const pay = r ? (need * r) / (Math.pow(1 + r, months) - 1) : need / months;
      return `<div class="result-box"><div class="muted">Debes ahorrar</div><div class="big num">${money(pay)} / mes</div><div class="muted">≈ ${money(pay / 4.345)} por semana · ${money(pay / 30.4)} por día</div></div>`;
    },
  },
  budget: {
    name: '⚖️ Regla 50/30/20', desc: 'Distribuye tu ingreso de forma saludable',
    fields: [['income', 'Ingreso mensual neto', 0]],
    defaults() { return { income: Math.round(monthTotals(monthOf(today())).income) || 1500 }; },
    calc({ income }) { return rule503020(income); },
  },
  hourly: {
    name: '⏱️ Costo en horas de trabajo', desc: '¿Cuántas horas de trabajo cuesta algo?',
    fields: [['price', 'Precio del producto', 100], ['income', 'Ingreso mensual', 1500], ['hours', 'Horas trabajadas al mes', 160]],
    calc({ price, income, hours }) {
      const perHour = income / (hours || 1), h = price / (perHour || 1);
      return `<div class="result-box"><div class="muted">Esto te cuesta</div><div class="big">${h.toFixed(1)} horas de trabajo</div><div class="muted">≈ ${(h / 8).toFixed(1)} días laborales · ganas ${money(perHour)}/hora</div></div>`;
    },
  },
  split: {
    name: '🍕 Dividir cuenta', desc: 'Divide una cuenta entre amigos con propina',
    fields: [['total', 'Total de la cuenta', 100], ['people', 'Personas', 4], ['tip', 'Propina (%)', 10]],
    calc({ total, people, tip }) {
      const t = total * (1 + tip / 100);
      return `<div class="result-box"><div class="muted">Cada persona paga</div><div class="big num">${money(t / (people || 1))}</div><div class="muted">Total con propina: ${money(t)} (propina ${money(t - total)})</div></div>`;
    },
  },
  discount: {
    name: '🏷️ Descuentos e IVA', desc: 'Calcula precio final con descuento e impuesto',
    fields: [['price', 'Precio', 100], ['discount', 'Descuento (%)', 20], ['tax', 'Impuesto / IVA (%)', 16]],
    calc({ price, discount, tax }) {
      const d = price * (1 - discount / 100), f = d * (1 + tax / 100);
      return `<div class="result-box"><div class="muted">Precio final</div><div class="big num">${money(f)}</div><div class="muted">Ahorras ${money(price - d)} · Impuesto ${money(f - d)} · Sin impuesto ${money(d)}</div></div>`;
    },
  },
  inflation: {
    name: '🎈 Inflación', desc: 'Cuánto valdrá tu dinero en el futuro',
    fields: [['amount', 'Monto de hoy', 1000], ['rate', 'Inflación anual (%)', 5], ['years', 'Años', 10]],
    calc({ amount, rate, years }) {
      const f = Math.pow(1 + rate / 100, years);
      return `<div class="result-box"><div class="muted">Poder de compra en ${years} años</div><div class="big num expense">${money(amount / f)}</div><div class="muted">Necesitarás ${money(amount * f)} para comprar lo mismo que hoy con ${money(amount)}</div></div>`;
    },
  },
  retire: {
    name: '🏖️ Retiro (regla del 4%)', desc: 'Cuánto necesitas para vivir de tus inversiones',
    fields: [['monthly', 'Gasto mensual deseado en el retiro', 1500], ['saved', 'Ahorro/inversión actual', 0], ['contrib', 'Aporte mensual', 300], ['rate', 'Rendimiento anual (%)', 7]],
    calc({ monthly, saved, contrib, rate }) {
      const target = monthly * 12 * 25, r = rate / 100 / 12;
      let bal = saved, m = 0;
      while (bal < target && m < 1200) { bal = bal * (1 + r) + contrib; m++; }
      return `<div class="result-box"><div class="muted">Necesitas acumular</div><div class="big num">${money(target)}</div><div class="muted">${m >= 1200 ? 'Con esos aportes no se alcanza en 100 años.' : `Lo lograrías en <b>${Math.floor(m / 12)} años y ${m % 12} meses</b>`}</div></div>`;
    },
  },
  currency: {
    name: '💱 Conversor de divisas', desc: 'Con la tasa que tú indiques (funciona sin internet)',
    fields: [['amount', 'Monto', 100], ['rate', 'Tasa de cambio (1 unidad = X)', 1]],
    defaults() { return { rate: state.settings.rates?.last || 1 }; },
    calc({ amount, rate }) {
      state.settings.rates = { ...(state.settings.rates || {}), last: rate }; save();
      return `<div class="result-box"><div class="big num">${(amount * rate).toLocaleString('es', { maximumFractionDigits: 2 })}</div><div class="muted">Inverso: ${amount} ÷ ${rate} = ${(amount / (rate || 1)).toLocaleString('es', { maximumFractionDigits: 4 })}</div></div>`;
    },
  },
};

VIEWS.tools = {
  title: 'Calculadoras', icon: '🧮',
  render() {
    const open = ui.tool;
    if (open && TOOLS[open]) {
      const t = TOOLS[open];
      const vals = { ...Object.fromEntries(t.fields.map(([k, , d]) => [k, d])), ...(t.defaults ? t.defaults() : {}) };
      return `<button class="btn small ghost" id="back">← Todas las calculadoras</button>
        <div class="card section"><h3>${t.name}</h3><p class="muted" style="margin-top:-6px">${t.desc}</p>
        <form class="form" id="tool-form"><div class="grid cols-2" style="gap:12px">${t.fields.map(([k, l]) => `<label class="field">${l}<input type="number" step="any" inputmode="decimal" name="${k}" value="${vals[k]}"></label>`).join('')}</div></form>
        <div id="tool-out"></div></div>`;
    }
    return `<div class="grid cols-3">${Object.entries(TOOLS).map(([k, t]) => `<div class="card item clickable" data-tool="${k}" style="flex-direction:column;align-items:flex-start;border-bottom:1px solid var(--border)"><div class="title" style="white-space:normal">${t.name}</div><div class="muted" style="font-size:.85rem">${t.desc}</div></div>`).join('')}</div>`;
  },
  mount(root) {
    $$('[data-tool]', root).forEach((el) => el.onclick = () => { ui.tool = el.dataset.tool; render_(); });
    const back = $('#back', root);
    if (back) back.onclick = () => { ui.tool = null; render_(); };
    const form = $('#tool-form', root);
    if (form) {
      const run = () => {
        const v = Object.fromEntries([...new FormData(form)].map(([k, x]) => [k, parseFloat(x) || 0]));
        $('#tool-out', root).innerHTML = TOOLS[ui.tool].calc(v);
      };
      form.oninput = run; form.onsubmit = (e) => e.preventDefault(); run();
    }
  },
};

/* ---------- Notas / lista de compras ---------- */
VIEWS.notes = {
  title: 'Lista de deseos', icon: '📝',
  render() {
    const items = state.notes;
    const pending = items.filter((n) => !n.done);
    return `<div class="card"><h3>Lista de compras / deseos</h3>
      <p class="muted" style="margin-top:-6px;font-size:.85rem">Anota lo que quieres comprar y espera 30 días antes de hacerlo: así evitas compras impulsivas.</p>
      <form id="note-form" class="row" style="gap:8px;margin:12px 0"><input name="text" placeholder="Ej: Audífonos" required style="flex:2"><input name="price" type="number" step="0.01" inputmode="decimal" placeholder="Precio" style="flex:1"><button class="btn primary">+</button></form>
      <div class="list">${items.map((n) => {
        const days = daysBetween(n.date, today());
        return `<div class="item"><input type="checkbox" data-ndone="${n.id}" ${n.done ? 'checked' : ''} style="width:20px;height:20px"><div class="main"><div class="title" style="${n.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(n.text)}</div><div class="meta">Agregado hace ${days} días ${!n.done && days >= 30 ? '· <span class="income">✓ ya pasaron 30 días</span>' : ''}</div></div>${n.price ? `<span class="num">${money(n.price)}</span>` : ''}<button class="icon-btn" data-ndel="${n.id}" aria-label="Eliminar">🗑️</button></div>`;
      }).join('') || emptyBox('📝', 'Tu lista está vacía')}</div>
      ${pending.length ? `<p class="muted" style="text-align:right">Total pendiente: <b class="num">${money(sum(pending, (n) => n.price))}</b></p>` : ''}</div>`;
  },
  mount(root) {
    $('#note-form', root).onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.notes.unshift({ id: uid(), text: fd.get('text'), price: round2(parseFloat(fd.get('price')) || 0), date: today(), done: false });
      save(); render_();
    };
    $$('[data-ndone]', root).forEach((el) => el.onchange = () => { const n = state.notes.find((x) => x.id === el.dataset.ndone); n.done = el.checked; save(); render_(); });
    $$('[data-ndel]', root).forEach((el) => el.onclick = () => { state.notes = state.notes.filter((x) => x.id !== el.dataset.ndel); save(); render_(); });
  },
};

/* ---------- Ajustes ---------- */
VIEWS.settings = {
  title: 'Ajustes', icon: '⚙️',
  render() {
    const s = state.settings;
    const catList = (type) => state.categories.filter((c) => c.type === type).map((c) => `<button class="chip" data-cat="${c.id}" style="border-color:${c.color}">${c.icon} ${esc(c.name)}</button>`).join('');
    return `
      <div class="grid cols-2">
        <div class="card"><h3>👤 General</h3><div class="form">
          <label class="field">Tu nombre<input id="s-name" value="${esc(s.name)}" placeholder="Opcional"></label>
          <label class="field">Moneda<select id="s-cur">${CURRENCIES.map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field">Tema<select id="s-theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Automático (según el sistema)</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>☀️ Claro</option><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>🌙 Oscuro</option></select></label>
        </div></div>
        <div class="card"><h3>🔒 Seguridad</h3>
          <p class="muted" style="font-size:.85rem">Protege la app con un PIN al abrirla en este dispositivo.</p>
          <div class="chips">${s.pinHash ? '<button class="btn" id="s-pin">Cambiar PIN</button><button class="btn danger" id="s-nopin">Quitar PIN</button>' : '<button class="btn primary" id="s-pin">Activar PIN</button>'}</div>
          <h3 style="margin-top:20px">💾 Copia de seguridad</h3>
          <p class="muted" style="font-size:.85rem">Tus datos se guardan solo en este dispositivo/navegador. Exporta una copia regularmente para pasarla a otro dispositivo (PC ↔ celular).</p>
          <div class="chips"><button class="btn" id="s-export">⬇️ Exportar (JSON)</button><button class="btn" id="s-import">⬆️ Importar (JSON)</button><button class="btn" id="s-csv">📄 Exportar CSV</button><button class="btn" id="s-csv-in">📥 Importar CSV</button></div>
          <input type="file" id="s-file" accept=".json,application/json" hidden><input type="file" id="s-file-csv" accept=".csv,text/csv" hidden>
          <p class="muted" style="font-size:.8rem">Última copia: ${s.lastBackup ? shortDate(s.lastBackup) : 'nunca'}</p>
        </div>
      </div>
      <div class="card section"><h3>🏷️ Categorías de gasto <button class="btn small primary" data-newcat="expense">+ Nueva</button></h3><div class="chips">${catList('expense')}</div>
        <h3 style="margin-top:18px">🏷️ Categorías de ingreso <button class="btn small primary" data-newcat="income">+ Nueva</button></h3><div class="chips">${catList('income')}</div></div>
      <div class="card section"><h3>🧪 Datos</h3>
        <p class="muted" style="font-size:.85rem">${state.transactions.length} movimientos · ${state.accounts.length} cuentas · ${state.goals.length} metas · ${state.debts.length} deudas · ${state.recurring.length} recurrentes</p>
        <div class="chips"><button class="btn" id="s-demo">✨ Cargar datos de ejemplo</button><button class="btn danger" id="s-reset">🗑️ Borrar todos los datos</button></div></div>
      <p class="muted" style="text-align:center;font-size:.8rem;margin-top:20px">Mis Finanzas · funciona sin conexión · tus datos nunca salen de tu dispositivo</p>`;
  },
  mount(root) {
    const s = state.settings;
    $('#s-name', root).onchange = (e) => { s.name = e.target.value.trim(); save(); };
    $('#s-cur', root).onchange = (e) => { s.currency = e.target.value; fmtCache = {}; save(); render_(); toast('Moneda actualizada'); };
    $('#s-theme', root).onchange = (e) => { s.theme = e.target.value; applyTheme(); save(); };
    $('#s-pin', root).onclick = () => formModal('PIN de acceso', [{ name: 'pin', label: 'Nuevo PIN (4-8 dígitos)', type: 'password', required: true }, { name: 'pin2', label: 'Repite el PIN', type: 'password', required: true }], {}, (v) => {
      if (!/^\d{4,8}$/.test(v.pin)) { toast('El PIN debe tener de 4 a 8 dígitos'); return false; }
      if (v.pin !== v.pin2) { toast('Los PIN no coinciden'); return false; }
      hashPin(v.pin).then((h) => { s.pinHash = h; save(); render_(); toast('PIN activado 🔒'); });
    });
    const nopin = $('#s-nopin', root);
    if (nopin) nopin.onclick = () => confirmDialog('¿Quitar el PIN?', () => { s.pinHash = null; save(); render_(); }, 'Quitar');
    $('#s-export', root).onclick = exportJSON;
    $('#s-csv', root).onclick = exportCSV;
    $('#s-import', root).onclick = () => $('#s-file', root).click();
    $('#s-csv-in', root).onclick = () => $('#s-file-csv', root).click();
    $('#s-file', root).onchange = (e) => importJSON(e.target.files[0]);
    $('#s-file-csv', root).onchange = (e) => importCSV(e.target.files[0]);
    $$('[data-cat]', root).forEach((el) => el.onclick = () => categoryForm(state.categories.find((c) => c.id === el.dataset.cat)));
    $$('[data-newcat]', root).forEach((el) => el.onclick = () => categoryForm(null, el.dataset.newcat));
    $('#s-demo', root).onclick = () => confirmDialog('Esto agregará cuentas, movimientos y metas de ejemplo a tus datos actuales.', loadDemo, 'Cargar');
    $('#s-reset', root).onclick = () => confirmDialog('Se borrarán TODOS tus datos de este dispositivo. Exporta una copia antes si la necesitas.', () => { state = defaultState(); save(); fmtCache = {}; applyTheme(); render_(); toast('Datos borrados'); }, 'Borrar todo');
  },
};

function categoryForm(c = null, type = 'expense') {
  formModal(c ? 'Editar categoría' : 'Nueva categoría', [
    { name: 'name', label: 'Nombre', required: true },
    { name: 'icon', label: 'Emoji', default: '🏷️', half: true },
    { name: 'color', label: 'Color', type: 'color', default: '#64748b', half: true },
  ], c || { type }, (v) => {
    if (c) Object.assign(c, v); else state.categories.push({ id: uid(), type, ...v });
    save(); render_();
  }, {
    onDelete: c ? () => {
      if (state.transactions.some((t) => t.categoryId === c.id)) { toast('Esta categoría tiene movimientos; no se puede eliminar'); return; }
      state.categories = state.categories.filter((x) => x !== c);
      state.budgets = state.budgets.filter((b) => b.categoryId !== c.id);
      save(); render_();
    } : null,
  });
}

/* ---------- Importar / exportar ---------- */
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportJSON() {
  state.settings.lastBackup = today(); save();
  download(`mis-finanzas-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Copia exportada'); render_();
}
function exportCSV() {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['Fecha', 'Tipo', 'Monto', 'Categoría', 'Cuenta', 'Cuenta destino', 'Nota', 'Etiquetas'].join(',')];
  const TYPE = { income: 'Ingreso', expense: 'Gasto', transfer: 'Transferencia' };
  [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => rows.push([t.date, TYPE[t.type], t.amount, q(t.type === 'transfer' ? '' : catById(t.categoryId).name), q(accById(t.accountId).name), q(t.toAccountId ? accById(t.toAccountId).name : ''), q(t.note), q((t.tags || []).join('; '))].join(',')));
  download(`movimientos-${today()}.csv`, '﻿' + rows.join('\n'), 'text/csv;charset=utf-8');
}
function importJSON(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('Formato no válido');
      confirmDialog('Esto reemplazará tus datos actuales por los del archivo.', () => { state = Object.assign(defaultState(), data); fmtCache = {}; save(); applyTheme(); render_(); toast('Datos importados ✅'); }, 'Importar');
    } catch (e) { toast('Error: ' + e.message); }
  };
  r.readAsText(file);
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',' || ch === ';' && !text.slice(0, 200).includes(',')) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function importCSV(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const rows = parseCSV(r.result.replace(/^﻿/, '')).filter((x) => x.length > 2);
    rows.shift();
    let n = 0;
    for (const [date, tipo, amount, catName, accName, toName, note, tags] of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const type = /ingreso|income/i.test(tipo) ? 'income' : /transf/i.test(tipo) ? 'transfer' : 'expense';
      const findAcc = (name) => { if (!name) return null; let a = state.accounts.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!a) { a = { id: uid(), name, type: 'bank', initial: 0, color: '#64748b' }; state.accounts.push(a); } return a.id; };
      let cat = null;
      if (type !== 'transfer') {
        cat = state.categories.find((c) => c.type === type && c.name.toLowerCase() === (catName || '').toLowerCase());
        if (!cat && catName) { cat = { id: uid(), name: catName, icon: '🏷️', color: '#64748b', type }; state.categories.push(cat); }
        cat = cat || state.categories.find((c) => c.type === type);
      }
      const tx = { id: uid(), type, amount: Math.abs(round2(parseFloat(String(amount).replace(',', '.')))), date, accountId: findAcc(accName) || state.accounts[0]?.id, note: note || '', tags: (tags || '').split(';').map((s) => s.trim()).filter(Boolean) };
      if (type === 'transfer') tx.toAccountId = findAcc(toName); else tx.categoryId = cat?.id;
      if (tx.amount > 0) { state.transactions.push(tx); n++; }
    }
    save(); render_(); toast(`${n} movimientos importados`);
  };
  r.readAsText(file);
}

/* ---------- Datos de ejemplo ---------- */
function loadDemo() {
  const c = (name) => state.categories.find((x) => x.name === name)?.id;
  const mkAcc = (name, type, initial, color) => { const a = { id: uid(), name, type, initial, color }; state.accounts.push(a); return a.id; };
  const bank = mkAcc('Banco (demo)', 'bank', 1200, '#2563eb');
  const cash = mkAcc('Efectivo (demo)', 'cash', 150, '#16a34a');
  const atm = (k) => state.transactions.push({ id: uid(), type: 'transfer', amount: 300, date: `${k}-01`, accountId: bank, toAccountId: cash, note: 'Retiro cajero' });
  const sav = mkAcc('Ahorros (demo)', 'savings', 2000, '#9333ea');
  const card = mkAcc('Tarjeta (demo)', 'credit', 0, '#dc2626');
  state.accounts.find((a) => a.id === card).limit = 2000;
  const cur = monthOf(today());
  const rnd = (a, b) => round2(a + Math.random() * (b - a));
  for (let i = 5; i >= 0; i--) {
    const k = addMonthsKey(cur, -i);
    const maxDay = i === 0 ? new Date().getDate() : daysInMonth(k);
    const d = (day) => `${k}-${pad(Math.min(day, maxDay))}`;
    const push = (type, amount, day, cat, acc, note) => state.transactions.push({ id: uid(), type, amount, date: d(day), categoryId: c(cat), accountId: acc, note });
    push('income', 2200, 1, 'Salario', bank, 'Salario');
    atm(k);
    if (Math.random() > .5) push('income', rnd(150, 500), 15, 'Freelance', bank, 'Proyecto freelance');
    push('expense', 650, 2, 'Vivienda', bank, 'Alquiler');
    push('expense', rnd(40, 70), 5, 'Servicios', bank, 'Luz');
    push('expense', 30, 6, 'Teléfono e internet', bank, 'Internet');
    push('expense', 15.99, 8, 'Suscripciones', card, 'Netflix');
    for (let j = 0; j < 6; j++) push('expense', rnd(30, 90), 3 + j * 4, 'Supermercado', j % 2 ? card : bank, 'Supermercado');
    for (let j = 0; j < 8; j++) push('expense', rnd(5, 25), 2 + j * 3, 'Comida', cash, ['Almuerzo', 'Café', 'Cena', 'Pizza'][j % 4]);
    for (let j = 0; j < 4; j++) push('expense', rnd(10, 30), 4 + j * 7, 'Transporte', cash, 'Transporte');
    push('expense', rnd(20, 80), 20, 'Entretenimiento', card, 'Cine y salida');
    if (Math.random() > .5) push('expense', rnd(30, 120), 18, 'Ropa', card, 'Ropa');
    state.transactions.push({ id: uid(), type: 'transfer', amount: 200, date: d(2), accountId: bank, toAccountId: sav, note: 'Ahorro mensual' });
  }
  state.budgets.push({ id: uid(), categoryId: c('Comida'), amount: 150 }, { id: uid(), categoryId: c('Supermercado'), amount: 350 }, { id: uid(), categoryId: c('Entretenimiento'), amount: 60 }, { id: uid(), categoryId: c('Transporte'), amount: 100 });
  state.goals.push({ id: uid(), name: 'Fondo de emergencia', icon: '🛟', color: '#0f766e', target: 6000, deadline: addMonthsKey(cur, 12) + '-01', contributions: [{ date: today(), amount: 2000, note: 'Inicial' }] },
    { id: uid(), name: 'Vacaciones', icon: '🏖️', color: '#f97316', target: 1500, deadline: addMonthsKey(cur, 6) + '-15', contributions: [{ date: today(), amount: 450, note: '' }] });
  state.debts.push({ id: uid(), kind: 'owe', name: 'Préstamo auto', amount: 8000, interest: 12, minPayment: 250, dueDate: addMonthsKey(cur, 1) + '-10', payments: [{ date: today(), amount: 2500 }] },
    { id: uid(), kind: 'owe', name: 'Tarjeta tienda', amount: 600, interest: 45, minPayment: 50, payments: [] },
    { id: uid(), kind: 'owed', name: 'Carlos', amount: 120, dueDate: addMonthsKey(cur, 0) + '-28', payments: [] });
  state.recurring.push({ id: uid(), name: 'Netflix', type: 'expense', amount: 15.99, frequency: 'monthly', nextDate: addMonthsKey(cur, 1) + '-08', categoryId: c('Suscripciones'), accountId: card, auto: true },
    { id: uid(), name: 'Gimnasio', type: 'expense', amount: 35, frequency: 'monthly', nextDate: addPeriod(today(), 'weekly'), categoryId: c('Salud'), accountId: bank, auto: false },
    { id: uid(), name: 'Salario', type: 'income', amount: 2200, frequency: 'monthly', nextDate: addMonthsKey(cur, 1) + '-01', categoryId: c('Salario'), accountId: bank, auto: true });
  state.notes.push({ id: uid(), text: 'Audífonos inalámbricos', price: 89, date: toISO(new Date(Date.now() - 35 * 86400000)), done: false });
  save(); render_(); toast('Datos de ejemplo cargados ✨');
}

/* ---------- PIN ---------- */
async function hashPin(pin) {
  const data = new TextEncoder().encode('mis-finanzas:' + pin);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const b of data) h = (h * 31 + b) | 0; return 'x' + h;
}
function showLock() {
  if (!state.settings.pinHash) return;
  const lock = $('#lock');
  lock.classList.remove('hidden');
  const inp = $('#lock-pin');
  setTimeout(() => inp.focus(), 50);
  const tryUnlock = async () => {
    if ((await hashPin(inp.value)) === state.settings.pinHash) { lock.classList.add('hidden'); inp.value = ''; $('#lock-err').textContent = ''; }
    else { $('#lock-err').textContent = 'PIN incorrecto'; inp.value = ''; }
  };
  $('#lock-btn').onclick = tryUnlock;
  inp.onkeydown = (e) => { if (e.key === 'Enter') tryUnlock(); };
}

/* =========================================================
   Router / arranque
   ========================================================= */
const NAV_ORDER = ['dashboard', 'transactions', 'accounts', 'budgets', 'goals', 'debts', 'recurring', 'reports', 'tools', 'notes', 'settings'];
const BOTTOM_NAV = ['dashboard', 'transactions', 'budgets', 'reports'];
let current = 'dashboard';

function go(view) { location.hash = view; }

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function buildNav() {
  $('#nav').innerHTML = NAV_ORDER.map((k) => `<a href="#${k}" data-v="${k}"><span class="ico">${VIEWS[k].icon}</span>${VIEWS[k].title}</a>`).join('');
  $('#bottom-nav').innerHTML = BOTTOM_NAV.map((k) => `<a href="#${k}" data-v="${k}"><span class="ico">${VIEWS[k].icon}</span>${VIEWS[k].title.split(' ')[0]}</a>`).join('') + `<a href="#" id="more-nav"><span class="ico">☰</span>Más</a>`;
  $('#more-nav').onclick = (e) => { e.preventDefault(); toggleDrawer(true); };
}

function toggleDrawer(open) {
  $('.sidebar').classList.toggle('open', open);
  $('#drawer-backdrop').classList.toggle('hidden', !open);
}

function render_() {
  const v = VIEWS[current];
  $('#view-title').textContent = v.title;
  document.title = `${v.title} · Mis Finanzas`;
  $('#month-picker').style.visibility = v.month ? 'visible' : 'hidden';
  $('#month-label').textContent = monthLabel(ui.month);
  $$('#nav a, #bottom-nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === current));
  const root = $('#view');
  root.innerHTML = v.render();
  v.mount && v.mount(root);
}

function route() {
  const h = location.hash.slice(1);
  const next = VIEWS[h] ? h : 'dashboard';
  if (next !== current) { ui.txLimit = 60; window.scrollTo(0, 0); }
  current = next;
  toggleDrawer(false);
  render_();
}

function init() {
  applyTheme();
  buildNav();
  processRecurring();
  window.addEventListener('hashchange', route);
  $('#menu-btn').onclick = () => toggleDrawer(true);
  $('#drawer-backdrop').onclick = () => toggleDrawer(false);
  $('#fab').onclick = () => transactionForm();
  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  $$('#month-picker [data-month]').forEach((b) => b.onclick = () => { ui.month = addMonthsKey(ui.month, Number(b.dataset.month)); saveUI(); render_(); });
  $('#month-label').onclick = () => { ui.month = monthOf(today()); saveUI(); render_(); };
  $('#month-label').title = 'Volver al mes actual';
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); toggleDrawer(false); }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#modal').classList.contains('hidden')) { e.preventDefault(); transactionForm(); }
  });
  // Bloquear con PIN también al volver a la app tras 2 minutos en segundo plano
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else { if (hiddenAt && Date.now() - hiddenAt > 120000) showLock(); processRecurring(); }
  });
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = loadState(); render_(); } });
  route();
  showLock();

  // PWA: instalación y modo offline
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#install-btn').hidden = false; });
  $('#install-btn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#install-btn').hidden = true; };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
