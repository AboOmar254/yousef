import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-analytics.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  doc,
  increment,
  setDoc
} from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBOTABxRSNsZrr35C0-i7DTgVf2lpNpY_4',
  authDomain: 'yousef-1d0cd.firebaseapp.com',
  projectId: 'yousef-1d0cd',
  storageBucket: 'yousef-1d0cd.firebasestorage.app',
  messagingSenderId: '938020489900',
  appId: '1:938020489900:web:26236a36bce65cb4deed09',
  measurementId: 'G-102D21VN9L'
};

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch (e) {}

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// ════════════════════════════════════════════════════════════════════════════
// IndexedDB — تخزين محلي دائم
// ════════════════════════════════════════════════════════════════════════════
const IDB_NAME    = 'smoke-kiosk-v2';
const IDB_VERSION = 1;
const S_CUSTOMERS    = 'customers';
const S_TRANSACTIONS = 'transactions';
const S_PENDING      = 'pending_sync';

let _idb = null;

function openIDB() {
  return new Promise((res, rej) => {
    if (_idb) { res(_idb); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(S_CUSTOMERS))
        d.createObjectStore(S_CUSTOMERS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(S_TRANSACTIONS))
        d.createObjectStore(S_TRANSACTIONS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(S_PENDING))
        d.createObjectStore(S_PENDING, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = e => rej(e.target.error);
  });
}

async function idbPut(store, data) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

async function idbGetAll(store) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function idbAddPending(op) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(S_PENDING, 'readwrite');
    tx.objectStore(S_PENDING).add(op);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

async function idbDeletePending(id) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(S_PENDING, 'readwrite');
    tx.objectStore(S_PENDING).delete(id);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

// البيانات الرئيسية
let customers    = [];   // قائمة الزبائن
let transactions = [];   // قائمة المعاملات

// ⭐ localOverrides: يحمي التحديثات المحلية من أن يُلغيها onSnapshot
// Map<customerId, { debt, totalPurchases }>
// يُزال الـ override فقط عند تأكيد Firebase أو عند onSnapshot بقيمة أحدث
const localOverrides = new Map();

// Map<transactionId> — معاملات أضفناها محلياً لم تصل Firebase بعد
const localTransactionIds = new Set();

let isSavingPurchase = false;
let isSavingPayment  = false;
let isSyncing        = false;

// ════════════════════════════════════════════════════════════════════════════
// DOM
// ════════════════════════════════════════════════════════════════════════════
const navButtons          = document.querySelectorAll('.nav-btn');
const pageSections        = document.querySelectorAll('.page-section');
const pageTitle           = document.getElementById('pageTitle');
const pageSubtitle        = document.getElementById('pageSubtitle');
const messageBox          = document.getElementById('messageBox');
const purchaseForm        = document.getElementById('purchaseForm');
const paymentForm         = document.getElementById('paymentForm');
const purchaseSubmitBtn   = purchaseForm.querySelector('button[type="submit"]');
const paymentSubmitBtn    = paymentForm.querySelector('button[type="submit"]');
const paymentCustomer     = document.getElementById('paymentCustomer');
const debtsSearchInput    = document.getElementById('debtsSearchInput');
const debtHistorySearchInput = document.getElementById('debtHistorySearchInput');
const debtHistorySearchBtn   = document.getElementById('debtHistorySearchBtn');
const trackingSearchInput = document.getElementById('trackingSearchInput');
const trackingTableBody   = document.getElementById('trackingTableBody');
const debtCustomersTableBody = document.getElementById('debtCustomersTableBody');
const debtsTableBody      = document.getElementById('debtsTableBody');
const datePreset          = document.getElementById('datePreset');
const startDateInput      = document.getElementById('startDate');
const endDateInput        = document.getElementById('endDate');
const applyDateFilterBtn  = document.getElementById('applyDateFilter');
const todayPurchasesValue = document.getElementById('todayPurchasesValue');
const todayDebtsValue     = document.getElementById('todayDebtsValue');
const periodPurchasesValue = document.getElementById('periodPurchasesValue');
const periodDebtsValue    = document.getElementById('periodDebtsValue');

const pageConfig = {
  sales:    { title: 'إضافة عملية شراء',    subtitle: 'سجل الشراء والزبون في خطوة واحدة' },
  debts:    { title: 'الديون',              subtitle: 'إدارة الديون والتسديدات بسهولة' },
  tracking: { title: 'التتبع والتقارير',    subtitle: 'راجع مشتريات اليوم والديون وحدد أي فترة تريدها' }
};

// ════════════════════════════════════════════════════════════════════════════
// مؤشر الاتصال
// ════════════════════════════════════════════════════════════════════════════
const connIndicator = (() => {
  const el = document.createElement('div');
  el.id = 'connIndicator';
  Object.assign(el.style, {
    position: 'fixed', bottom: '16px', left: '16px',
    padding: '8px 16px', borderRadius: '20px',
    fontSize: '14px', fontWeight: '700',
    zIndex: '9999', transition: 'all .3s',
    display: 'flex', alignItems: 'center', gap: '8px',
    pointerEvents: 'none'
  });
  document.body.appendChild(el);
  return el;
})();

function updateConnIndicator() {
  if (navigator.onLine) {
    connIndicator.style.cssText += 'background:#1f4a2d;color:#d8ffd8;border:1px solid #2f7a44';
    connIndicator.innerHTML = '🟢 متصل';
  } else {
    connIndicator.style.cssText += 'background:#4a2222;color:#ffd8d8;border:1px solid #7a3333';
    connIndicator.innerHTML = '🔴 غير متصل — يُحفظ محلياً';
  }
}
updateConnIndicator();

// ════════════════════════════════════════════════════════════════════════════
// مزامنة العمليات المعلقة عند عودة الاتصال
// ════════════════════════════════════════════════════════════════════════════
async function syncPending() {
  if (!navigator.onLine || isSyncing) return;
  const pending = await idbGetAll(S_PENDING).catch(() => []);
  if (!pending.length) return;

  isSyncing = true;
  let ok = 0, fail = 0;

  for (const op of pending) {
    try {
      if (op.type === 'newCustomer') {
        await setDoc(doc(db, 'customers', op.customerId), op.customerData);

      } else if (op.type === 'purchase') {
        await setDoc(doc(db, 'transactions', op.txId), op.txData);
        await updateDoc(doc(db, 'customers', op.customerId), {
          debt:           increment(op.debtDelta),
          totalPurchases: increment(op.purchasesDelta)
        });
        localOverrides.delete(op.customerId);

      } else if (op.type === 'payment') {
        await setDoc(doc(db, 'transactions', op.txId), op.txData);
        await updateDoc(doc(db, 'customers', op.customerId), {
          debt: increment(op.debtDelta)
        });
        localOverrides.delete(op.customerId);
      }

      await idbDeletePending(op.id);
      ok++;
    } catch (err) {
      console.error('syncPending error:', err);
      fail++;
    }
  }

  isSyncing = false;
  if (ok)   showMessage(`✅ تمت مزامنة ${ok} عملية مع قاعدة البيانات.`, 'success');
  if (fail) showMessage(`⚠️ تعذّر رفع ${fail} عملية، ستُعاد المحاولة لاحقاً.`, 'error');
}

// ════════════════════════════════════════════════════════════════════════════
// تحميل البيانات المحلية عند الفتح
// ════════════════════════════════════════════════════════════════════════════
async function loadLocalData() {
  try {
    const [c, t] = await Promise.all([
      idbGetAll(S_CUSTOMERS),
      idbGetAll(S_TRANSACTIONS)
    ]);
    if (c.length) customers    = c;
    if (t.length) transactions = mergeNoDupes(t);
    refreshAll();
  } catch (e) {
    console.error('loadLocalData:', e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// الدوال المساعدة
// ════════════════════════════════════════════════════════════════════════════
function generateLocalId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = 'local_';
  for (let i = 0; i < 20; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function generateOpId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function showPage(page) {
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.page === page));
  pageSections.forEach(s => s.classList.remove('active'));
  document.getElementById(`${page}Page`).classList.add('active');
  pageTitle.textContent    = pageConfig[page].title;
  pageSubtitle.textContent = pageConfig[page].subtitle;
}
navButtons.forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

let _msgTimer = null;
function showMessage(text, type = 'error') {
  clearTimeout(_msgTimer);
  messageBox.innerHTML = `<div class="message ${type}">${text}</div>`;
  _msgTimer = setTimeout(() => { messageBox.innerHTML = ''; }, 5500);
}

function formatMoney(v) { return `${Number(v || 0).toFixed(2)} شيكل`; }

function getTxDate(tx) {
  if (tx?.createdAt?.seconds)  return new Date(tx.createdAt.seconds * 1000);
  if (tx?.createdAtClient)     return new Date(tx.createdAtClient);
  return null;
}

function formatDate(tx) {
  const d = getTxDate(tx);
  return d ? d.toLocaleString('ar-EG') : '—';
}

function normText(t = '') {
  return String(t).toLowerCase().trim()
    .replace(/\s+/g, '').replace(/[-()+]/g, '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normPhone(p = '') {
  return String(p).trim()
    .replace(/\s+/g, '').replace(/[-()+]/g, '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function getCustomerById(id) { return customers.find(c => c.id === id) || {}; }
function findByPhone(phone)  {
  const n = normPhone(phone);
  return customers.find(c => normPhone(c.phone || '') === n);
}

function mergeNoDupes(list) {
  const map = new Map();
  for (const item of list) {
    const key = item.clientOpId || item.id ||
      `${item.customerId}_${item.type}_${item.createdAtClient || ''}`;
    const ex = map.get(key);
    if (!ex) { map.set(key, item); }
    else {
      map.set(key, {
        ...ex, ...item,
        createdAt:       item.createdAt       || ex.createdAt,
        createdAtClient: item.createdAtClient || ex.createdAtClient
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    return (getTxDate(b)?.getTime() || 0) - (getTxDate(a)?.getTime() || 0);
  });
}

// ⭐ يطبّق الـ overrides على بيانات الزبائن قبل الرسم
function getCustomerWithOverride(customer) {
  const ov = localOverrides.get(customer.id);
  if (!ov) return customer;
  return {
    ...customer,
    debt:           ov.debt           ?? customer.debt,
    totalPurchases: ov.totalPurchases ?? customer.totalPurchases
  };
}

// ⭐ تحديث override محلي — لا يُلغيه onSnapshot
function applyOverride(customerId, debtDelta, purchasesDelta = 0) {
  const base = getCustomerById(customerId);
  const prev = localOverrides.get(customerId) || {
    debt:           Number(base.debt           || 0),
    totalPurchases: Number(base.totalPurchases || 0)
  };
  localOverrides.set(customerId, {
    debt:           prev.debt           + debtDelta,
    totalPurchases: prev.totalPurchases + purchasesDelta
  });

  // أيضاً نحدّث customers في الذاكرة لضمان التوافق
  const idx = customers.findIndex(c => c.id === customerId);
  if (idx !== -1) {
    customers[idx] = {
      ...customers[idx],
      debt:           prev.debt           + debtDelta,
      totalPurchases: prev.totalPurchases + purchasesDelta
    };
    // حفظ في IndexedDB
    idbPut(S_CUSTOMERS, customers[idx]).catch(console.error);
  }
}

function addLocalTx(txData) {
  const id = txData.clientOpId || txData.id;
  localTransactionIds.add(id);
  transactions = mergeNoDupes([{ ...txData, id }, ...transactions]);
  idbPut(S_TRANSACTIONS, { ...txData, id }).catch(console.error);
}

function setBtn(btn, loading, loadTxt, normalTxt) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? loadTxt : normalTxt;
  btn.style.opacity = loading ? '0.7' : '1';
  btn.style.cursor  = loading ? 'not-allowed' : 'pointer';
}

// ════════════════════════════════════════════════════════════════════════════
// رسم الواجهة
// ════════════════════════════════════════════════════════════════════════════
function refreshAll() {
  populatePaymentSelect();
  renderDebtCustomers();
  renderDebtHistory();
  renderTracking();
}

function populatePaymentSelect() {
  const list = customers
    .map(getCustomerWithOverride)
    .filter(c => Number(c.debt || 0) > 0)
    .sort((a, b) => Number(b.debt) - Number(a.debt));

  paymentCustomer.innerHTML = ['<option value="">اختر الزبون</option>']
    .concat(list.map(c =>
      `<option value="${c.id}">${c.name} - ${c.phone} - ${formatMoney(c.debt)}</option>`
    )).join('');
}

function renderDebtCustomers() {
  const term = normText(debtsSearchInput.value);

  const list = customers
    .map(getCustomerWithOverride)
    .filter(c => {
      if (Number(c.debt || 0) <= 0) return false;
      return !term ||
        normText(c.name  || '').includes(term) ||
        normText(c.phone || '').includes(term);
    })
    .sort((a, b) => Number(b.debt) - Number(a.debt));

  if (!list.length) {
    debtCustomersTableBody.innerHTML = `<tr><td colspan="5">لا يوجد زبائن عليهم ديون.</td></tr>`;
    return;
  }

  debtCustomersTableBody.innerHTML = list.map(c => `
    <tr>
      <td>${c.name  || ''}</td>
      <td>${c.phone || ''}</td>
      <td>${formatMoney(c.debt)}</td>
      <td>${formatMoney(c.totalPurchases || 0)}</td>
      <td><button class="pay-btn quick-pay-btn" data-id="${c.id}">تسديد</button></td>
    </tr>
  `).join('');

  document.querySelectorAll('.quick-pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      paymentCustomer.value = btn.dataset.id;
      const amtInput = document.getElementById('paymentAmount');
      amtInput.focus();
      amtInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function renderDebtHistory() {
  const term = normText(debtHistorySearchInput.value);

  const list = transactions.filter(t => {
    if (!(t.type === 'payment' || (t.type === 'purchase' && Number(t.debtAdded || 0) > 0)))
      return false;
    const c = getCustomerById(t.customerId);
    const noteTxt = t.type === 'payment'
      ? (t.note || '')
      : `${t.itemName || ''} ${t.note || ''}`;
    return !term ||
      normText(c.name  || '').includes(term) ||
      normText(c.phone || '').includes(term) ||
      normText(noteTxt).includes(term);
  });

  if (!list.length) {
    debtsTableBody.innerHTML = `<tr><td colspan="5">لا يوجد سجل مطابق للبحث.</td></tr>`;
    return;
  }

  debtsTableBody.innerHTML = list.map(t => {
    const c      = getCustomerById(t.customerId);
    const label  = t.type === 'payment' ? 'تسديد' : 'دين ناتج عن شراء';
    const amount = t.type === 'payment' ? t.amount : t.debtAdded;
    const note   = t.type === 'payment'
      ? (t.note || '-')
      : `${t.itemName || '-'}${t.note ? ' - ' + t.note : ''}`;
    return `
      <tr>
        <td>${c.name || 'غير معروف'}</td>
        <td>${label}</td>
        <td>${formatMoney(amount)}</td>
        <td>${note}</td>
        <td>${formatDate(t)}</td>
      </tr>`;
  }).join('');
}

// ─── التتبع والتقارير ─────────────────────────────────────────────────────
function toDateVal(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function setPresetDates(preset) {
  const now = new Date();
  if (preset === 'today') {
    startDateInput.value = endDateInput.value = toDateVal(now);
  } else if (preset === 'current_month') {
    startDateInput.value = toDateVal(new Date(now.getFullYear(), now.getMonth(), 1));
    endDateInput.value   = toDateVal(now);
  }
}

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0); }
function dayEnd(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999); }

function getRange() {
  const p = datePreset.value, now = new Date();
  if (p === 'today')         return { start: dayStart(now), end: dayEnd(now) };
  if (p === 'current_month') return { start: dayStart(new Date(now.getFullYear(), now.getMonth(), 1)), end: dayEnd(now) };
  if (!startDateInput.value || !endDateInput.value) return null;
  return { start: dayStart(new Date(startDateInput.value)), end: dayEnd(new Date(endDateInput.value)) };
}

function inRange(tx, range) {
  const d = getTxDate(tx);
  return d && range && d >= range.start && d <= range.end;
}

function renderTracking() {
  const range = getRange();
  const term  = normText(trackingSearchInput.value);
  const today = { start: dayStart(new Date()), end: dayEnd(new Date()) };

  if (!range) {
    trackingTableBody.innerHTML = `<tr><td colspan="6">حدد التاريخ أولاً.</td></tr>`;
    periodPurchasesValue.textContent = periodDebtsValue.textContent = formatMoney(0);
  } else {
    const filtered = transactions.filter(t => {
      if (!inRange(t, range)) return false;
      const c = getCustomerById(t.customerId);
      return !term ||
        normText(c.name  || '').includes(term) ||
        normText(c.phone || '').includes(term) ||
        normText(`${t.itemName || ''} ${t.note || ''}`).includes(term);
    });

    const sumPurchases = filtered.filter(t => t.type === 'purchase')
      .reduce((s, t) => s + Number(t.total    || 0), 0);
    const sumDebts     = filtered.filter(t => t.type === 'purchase')
      .reduce((s, t) => s + Number(t.debtAdded || 0), 0);

    periodPurchasesValue.textContent = formatMoney(sumPurchases);
    periodDebtsValue.textContent     = formatMoney(sumDebts);

    trackingTableBody.innerHTML = filtered.length
      ? filtered.map(t => {
          const c   = getCustomerById(t.customerId);
          const isp = t.type === 'purchase';
          return `
            <tr>
              <td>${c.name  || 'غير معروف'}</td>
              <td>${c.phone || '-'}</td>
              <td>${isp ? 'شراء' : 'تسديد'}</td>
              <td>${isp ? `${t.itemName||'-'}${t.note?' - '+t.note:''}` : (t.note||'-')}</td>
              <td>${formatMoney(isp ? t.total : t.amount)}</td>
              <td>${formatDate(t)}</td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="6">لا توجد عمليات ضمن هذه الفترة.</td></tr>`;
  }

  // إحصائيات اليوم
  const tp = transactions.filter(t => t.type==='purchase' && inRange(t, today))
    .reduce((s,t) => s + Number(t.total    ||0), 0);
  const td = transactions.filter(t => t.type==='purchase' && inRange(t, today))
    .reduce((s,t) => s + Number(t.debtAdded||0), 0);
  todayPurchasesValue.textContent = formatMoney(tp);
  todayDebtsValue.textContent     = formatMoney(td);
}

// ════════════════════════════════════════════════════════════════════════════
// أحداث البحث والفلترة
// ════════════════════════════════════════════════════════════════════════════
debtsSearchInput.addEventListener('input', renderDebtCustomers);
trackingSearchInput.addEventListener('input', renderTracking);
debtHistorySearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); renderDebtHistory(); }
});
debtHistorySearchBtn.addEventListener('click', renderDebtHistory);
datePreset.addEventListener('change', () => {
  if (datePreset.value !== 'custom') setPresetDates(datePreset.value);
  renderTracking();
});
applyDateFilterBtn.addEventListener('click', renderTracking);
startDateInput.addEventListener('change', () => { datePreset.value = 'custom'; renderTracking(); });
endDateInput.addEventListener('change',   () => { datePreset.value = 'custom'; renderTracking(); });

// ════════════════════════════════════════════════════════════════════════════
// نموذج الشراء
// ════════════════════════════════════════════════════════════════════════════
purchaseForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (isSavingPurchase) return;
  isSavingPurchase = true;
  setBtn(purchaseSubmitBtn, true, 'جارٍ الحفظ...', 'حفظ عملية الشراء');

  const name        = document.getElementById('purchaseCustomerName').value.trim();
  const phone       = document.getElementById('purchaseCustomerPhone').value.trim();
  const itemName    = document.getElementById('itemName').value.trim();
  const price       = Number(document.getElementById('price').value || 0);
  const paidNow     = Number(document.getElementById('paidNow').value || 0);
  const note        = document.getElementById('purchaseNote').value.trim();
  const total       = price;
  const debtAdded   = Math.max(total - paidNow, 0);
  const createdAtClient = Date.now();
  const clientOpId  = generateOpId();

  if (!name || !phone || !itemName || price <= 0) {
    showMessage('أدخل بيانات الشراء بشكل صحيح.');
    isSavingPurchase = false;
    setBtn(purchaseSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ عملية الشراء');
    return;
  }

  try {
    // ── تحديد / إنشاء الزبون ────────────────────────────────────────────
    let customerId;
    const existing = findByPhone(phone);

    if (existing) {
      customerId = existing.id;
    } else {
      customerId = generateLocalId();
      const customerData = {
        id: customerId, name, phone,
        debt: 0, totalPurchases: 0, createdAtClient
      };
      // حفظ محلي فوري
      customers.unshift(customerData);
      idbPut(S_CUSTOMERS, customerData).catch(console.error);

      // Firebase (يخزن في الكاش محلياً أوفلاين)
      const fsCustomer = { name, phone, debt: 0, totalPurchases: 0, createdAt: serverTimestamp(), createdAtClient };
      setDoc(doc(db, 'customers', customerId), fsCustomer).catch(() => {
        idbAddPending({ type: 'newCustomer', customerId, customerData: fsCustomer }).catch(console.error);
      });
    }

    // ── تسجيل المعاملة محلياً فوراً ─────────────────────────────────────
    applyOverride(customerId, debtAdded, total);   // ⭐ يحمي من onSnapshot
    addLocalTx({
      id: clientOpId, clientOpId, customerId,
      itemName, price, paidNow, total, debtAdded,
      note, type: 'purchase', createdAtClient
    });

    // ── Firebase ─────────────────────────────────────────────────────────
    const txFs = {
      customerId, itemName, price, paidNow, total, debtAdded,
      note, type: 'purchase', createdAt: serverTimestamp(), createdAtClient, clientOpId
    };
    setDoc(doc(db, 'transactions', clientOpId), txFs).then(() =>
      updateDoc(doc(db, 'customers', customerId), {
        debt:           increment(debtAdded),
        totalPurchases: increment(total)
      })
    ).then(() => {
      localOverrides.delete(customerId);  // تم التأكيد من Firebase → نزيل الـ override
    }).catch(() => {
      idbAddPending({
        type: 'purchase', txId: clientOpId, customerId,
        txData: txFs, debtDelta: debtAdded, purchasesDelta: total
      }).catch(console.error);
    });

    // ── تحديث الواجهة ────────────────────────────────────────────────────
    refreshAll();
    e.target.reset();
    document.getElementById('paidNow').value = 0;
    showPage('tracking');
    renderTracking();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!navigator.onLine) {
      showMessage('💾 تم الحفظ محلياً وتحديث الواجهة فوراً. سيُرفع للسيرفر عند عودة الاتصال.', 'success');
    } else if (existing && normText(existing.name||'') !== normText(name)) {
      showMessage(`تم اعتماد الاسم المخزّن: ${existing.name}. تم حفظ الشراء وتحديث الدين.`, 'success');
    } else {
      showMessage('✅ تم حفظ عملية الشراء وتحديث الدين.', 'success');
    }

  } catch (err) {
    console.error(err);
    showMessage('تعذر حفظ عملية الشراء. حاول مجدداً.');
  } finally {
    isSavingPurchase = false;
    setBtn(purchaseSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ عملية الشراء');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// نموذج الدفعة
// ════════════════════════════════════════════════════════════════════════════
paymentForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (isSavingPayment) return;
  isSavingPayment = true;
  setBtn(paymentSubmitBtn, true, 'جارٍ الحفظ...', 'حفظ الدفعة');

  const customerId      = paymentCustomer.value;
  const amount          = Number(document.getElementById('paymentAmount').value || 0);
  const note            = document.getElementById('paymentNote').value.trim();
  const createdAtClient = Date.now();
  const clientOpId      = generateOpId();

  if (!customerId || amount <= 0) {
    showMessage('أدخل الزبون والمبلغ بشكل صحيح.');
    isSavingPayment = false;
    setBtn(paymentSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ الدفعة');
    return;
  }

  try {
    // ⭐ تحديث محلي فوري — محمي من onSnapshot
    applyOverride(customerId, -amount, 0);
    addLocalTx({
      id: clientOpId, clientOpId, customerId,
      amount, note, type: 'payment', createdAtClient
    });

    // ── Firebase ─────────────────────────────────────────────────────────
    const txFs = {
      customerId, amount, note,
      type: 'payment', createdAt: serverTimestamp(), createdAtClient, clientOpId
    };
    setDoc(doc(db, 'transactions', clientOpId), txFs).then(() =>
      updateDoc(doc(db, 'customers', customerId), { debt: increment(-amount) })
    ).then(() => {
      localOverrides.delete(customerId);  // تأكيد Firebase → نزيل الـ override
    }).catch(() => {
      idbAddPending({
        type: 'payment', txId: clientOpId, customerId,
        txData: txFs, debtDelta: -amount
      }).catch(console.error);
    });

    // ── تحديث الواجهة فوراً ───────────────────────────────────────────────
    refreshAll();
    e.target.reset();

    if (!navigator.onLine) {
      showMessage('💾 تم تسجيل الدفعة محلياً وتحديث الواجهة فوراً. سيُرفع للسيرفر عند عودة الاتصال.', 'success');
    } else {
      showMessage('✅ تم حفظ الدفعة وتحديث الدين.', 'success');
    }

  } catch (err) {
    console.error(err);
    showMessage('تعذر تسجيل الدفعة.');
  } finally {
    isSavingPayment = false;
    setBtn(paymentSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ الدفعة');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// أحداث الاتصال
// ════════════════════════════════════════════════════════════════════════════
window.addEventListener('offline', () => {
  updateConnIndicator();
  showMessage('🔴 غير متصل — يمكنك المتابعة بشكل طبيعي. كل العمليات تُحفظ محلياً وترفع عند عودة الشبكة.', 'error');
});

window.addEventListener('online', async () => {
  updateConnIndicator();
  showMessage('🟢 تم استعادة الاتصال. جارٍ مزامنة البيانات...', 'success');
  await syncPending();
});

// ════════════════════════════════════════════════════════════════════════════
// تهيئة التطبيق
// ════════════════════════════════════════════════════════════════════════════
setPresetDates('current_month');
loadLocalData();   // عرض فوري من IndexedDB

// ─── Firestore listeners ───────────────────────────────────────────────────
const customersQuery = query(collection(db, 'customers'), orderBy('createdAt', 'desc'));
onSnapshot(customersQuery,
  snap => {
    const fromServer = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // دمج: نحتفظ بالزبائن المحليين الذين لم يصلوا Firebase بعد
    const localOnly = customers.filter(lc =>
      !fromServer.some(sc => sc.id === lc.id)
    );
    customers = [...fromServer, ...localOnly];

    // حفظ في IndexedDB
    fromServer.forEach(c => idbPut(S_CUSTOMERS, c).catch(console.error));

    // ⭐ هنا المفتاح: عند onSnapshot نطبّق الـ overrides فوق بيانات السيرفر
    // لأن onSnapshot قد يجلب قيماً قديمة قبل وصول updateDoc للسيرفر
    // الـ override يُزال فقط عند تأكيد Firebase (في then() أعلاه)
    refreshAll();
  },
  err => {
    console.error('customers snapshot error:', err);
    if (navigator.onLine) showMessage('فشل تحميل الزبائن من السيرفر.', 'error');
  }
);

const transactionsQuery = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
onSnapshot(transactionsQuery,
  snap => {
    const fromServer = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    fromServer.forEach(t => idbPut(S_TRANSACTIONS, t).catch(console.error));
    transactions = mergeNoDupes([...fromServer, ...transactions]);
    renderDebtHistory();
    renderDebtCustomers();
    renderTracking();
  },
  err => console.error('transactions snapshot error:', err)
);

// مزامنة أي عمليات معلقة من جلسة سابقة
if (navigator.onLine) setTimeout(syncPending, 2500);
