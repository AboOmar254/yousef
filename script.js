import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-analytics.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
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

try {
  getAnalytics(app);
} catch (e) {
  console.log('Analytics not available in this environment.');
}

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// ─── IndexedDB للتخزين المحلي الكامل أوفلاين ───────────────────────────────
const IDB_NAME = 'smoke-kiosk-offline';
const IDB_VERSION = 1;
const STORE_CUSTOMERS = 'customers';
const STORE_TRANSACTIONS = 'transactions';
const STORE_PENDING = 'pending_sync';

let idb = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (idb) { resolve(idb); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
        db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
        db.createObjectStore(STORE_TRANSACTIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => { idb = e.target.result; resolve(idb); };
    req.onerror = e => reject(e.target.error);
  });
}

async function idbPut(storeName, data) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbAddPending(operation) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readwrite');
    tx.objectStore(STORE_PENDING).add(operation);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

async function idbGetAllPending() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readonly');
    const req = tx.objectStore(STORE_PENDING).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbDeletePending(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readwrite');
    tx.objectStore(STORE_PENDING).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

// ─── توليد ID محلي لا يتعارض مع Firebase ───────────────────────────────────
function generateLocalId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'local_';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateClientOpId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── حالة التطبيق ───────────────────────────────────────────────────────────
let customers = [];
let transactions = [];
let isSavingPurchase = false;
let isSavingPayment = false;
let isSyncing = false;

// ─── عناصر DOM ───────────────────────────────────────────────────────────────
const navButtons = document.querySelectorAll('.nav-btn');
const pageSections = document.querySelectorAll('.page-section');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const messageBox = document.getElementById('messageBox');
const purchaseForm = document.getElementById('purchaseForm');
const paymentForm = document.getElementById('paymentForm');
const purchaseSubmitBtn = purchaseForm.querySelector('button[type="submit"]');
const paymentSubmitBtn = paymentForm.querySelector('button[type="submit"]');
const purchaseCustomerName = document.getElementById('purchaseCustomerName');
const purchaseCustomerPhone = document.getElementById('purchaseCustomerPhone');
const paymentCustomer = document.getElementById('paymentCustomer');
const debtsSearchInput = document.getElementById('debtsSearchInput');
const debtHistorySearchInput = document.getElementById('debtHistorySearchInput');
const debtHistorySearchBtn = document.getElementById('debtHistorySearchBtn');
const trackingSearchInput = document.getElementById('trackingSearchInput');
const trackingTableBody = document.getElementById('trackingTableBody');
const debtCustomersTableBody = document.getElementById('debtCustomersTableBody');
const debtsTableBody = document.getElementById('debtsTableBody');
const datePreset = document.getElementById('datePreset');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const applyDateFilterBtn = document.getElementById('applyDateFilter');
const todayPurchasesValue = document.getElementById('todayPurchasesValue');
const todayDebtsValue = document.getElementById('todayDebtsValue');
const periodPurchasesValue = document.getElementById('periodPurchasesValue');
const periodDebtsValue = document.getElementById('periodDebtsValue');

const pageConfig = {
  sales: { title: 'إضافة عملية شراء', subtitle: 'سجل الشراء والزبون في خطوة واحدة' },
  debts: { title: 'الديون', subtitle: 'إدارة الديون والتسديدات بسهولة' },
  tracking: { title: 'التتبع والتقارير', subtitle: 'راجع مشتريات اليوم والديون وحدد أي فترة تريدها' }
};

// ─── إضافة مؤشر حالة الاتصال ─────────────────────────────────────────────────
function createConnectionIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'connectionIndicator';
  indicator.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 700;
    z-index: 9999;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  document.body.appendChild(indicator);
  return indicator;
}

const connectionIndicator = createConnectionIndicator();

function updateConnectionIndicator() {
  if (navigator.onLine) {
    connectionIndicator.style.background = '#1f4a2d';
    connectionIndicator.style.color = '#d8ffd8';
    connectionIndicator.style.border = '1px solid #2f7a44';
    connectionIndicator.innerHTML = '🟢 متصل';
  } else {
    connectionIndicator.style.background = '#4a2222';
    connectionIndicator.style.color = '#ffd8d8';
    connectionIndicator.style.border = '1px solid #7a3333';
    connectionIndicator.innerHTML = '🔴 غير متصل — البيانات تُحفظ محلياً';
  }
}

updateConnectionIndicator();

// ─── المزامنة عند عودة الاتصال ───────────────────────────────────────────────
async function syncPendingOperations() {
  if (!navigator.onLine || isSyncing) return;

  const pending = await idbGetAllPending();
  if (pending.length === 0) return;

  isSyncing = true;
  let syncedCount = 0;
  let failedCount = 0;

  for (const op of pending) {
    try {
      if (op.type === 'addCustomer') {
        // إنشاء الزبون في Firebase بنفس الـ ID المحلي
        await setDoc(doc(db, 'customers', op.customerId), op.data);

      } else if (op.type === 'addPurchase') {
        // إضافة عملية الشراء
        await setDoc(doc(db, 'transactions', op.transactionId), op.data);
        // تحديث أرصدة الزبون
        await updateDoc(doc(db, 'customers', op.customerId), {
          debt: increment(op.debtDelta),
          totalPurchases: increment(op.purchasesDelta)
        });

      } else if (op.type === 'addPayment') {
        await setDoc(doc(db, 'transactions', op.transactionId), op.data);
        await updateDoc(doc(db, 'customers', op.customerId), {
          debt: increment(op.debtDelta)
        });
      }

      await idbDeletePending(op.id);
      syncedCount++;
    } catch (error) {
      console.error('فشل رفع العملية:', op, error);
      failedCount++;
    }
  }

  isSyncing = false;

  if (syncedCount > 0) {
    showMessage(`تمت مزامنة ${syncedCount} عملية مع قاعدة البيانات بنجاح.`, 'success');
  }
  if (failedCount > 0) {
    showMessage(`تعذّر رفع ${failedCount} عملية، ستُعاد المحاولة لاحقاً.`, 'error');
  }
}

// ─── تحميل البيانات من IndexedDB عند بدء التشغيل ────────────────────────────
async function loadLocalData() {
  try {
    const [localCustomers, localTransactions] = await Promise.all([
      idbGetAll(STORE_CUSTOMERS),
      idbGetAll(STORE_TRANSACTIONS)
    ]);

    if (localCustomers.length > 0) {
      customers = localCustomers;
    }
    if (localTransactions.length > 0) {
      transactions = mergeTransactionsWithoutDuplicates(localTransactions);
    }

    refreshAllViews();
  } catch (error) {
    console.error('خطأ في تحميل البيانات المحلية:', error);
  }
}

// ─── الدوال المساعدة ─────────────────────────────────────────────────────────
function showPage(page) {
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  pageSections.forEach(section => section.classList.remove('active'));
  document.getElementById(`${page}Page`).classList.add('active');
  pageTitle.textContent = pageConfig[page].title;
  pageSubtitle.textContent = pageConfig[page].subtitle;
}

navButtons.forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});

function showMessage(text, type = 'error') {
  messageBox.innerHTML = `<div class="message ${type}">${text}</div>`;
  setTimeout(() => { messageBox.innerHTML = ''; }, 5000);
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} شيكل`;
}

function getTransactionDate(transaction) {
  if (transaction?.createdAt?.seconds) {
    return new Date(transaction.createdAt.seconds * 1000);
  }
  if (transaction?.createdAtClient) {
    return new Date(transaction.createdAtClient);
  }
  return null;
}

function formatDate(timestampOrTransaction) {
  let date = null;
  if (timestampOrTransaction?.seconds || timestampOrTransaction?.createdAtClient) {
    date = getTransactionDate(
      timestampOrTransaction?.seconds
        ? { createdAt: timestampOrTransaction }
        : timestampOrTransaction
    );
  } else if (timestampOrTransaction?.createdAt) {
    date = getTransactionDate(timestampOrTransaction);
  }
  return date ? date.toLocaleString('ar-EG') : '—';
}

function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[-()+]/g, '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normalizePhone(phone = '') {
  return String(phone)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[-()+]/g, '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function getCustomerById(customerId) {
  return customers.find(c => c.id === customerId) || {};
}

function findCustomerByPhone(phone = '') {
  const norm = normalizePhone(phone);
  return customers.find(c => normalizePhone(c.phone || '') === norm);
}

function sortTransactionsDescending(list) {
  return [...list].sort((a, b) => {
    const dateA = getTransactionDate(a)?.getTime() || 0;
    const dateB = getTransactionDate(b)?.getTime() || 0;
    return dateB - dateA;
  });
}

function mergeTransactionsWithoutDuplicates(list) {
  const map = new Map();
  for (const item of list) {
    const key = item.clientOpId || item.id || `${item.customerId}_${item.type}_${item.createdAtClient || ''}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else {
      map.set(key, {
        ...existing,
        ...item,
        createdAt: item.createdAt || existing.createdAt,
        createdAtClient: item.createdAtClient || existing.createdAtClient
      });
    }
  }
  return sortTransactionsDescending([...map.values()]);
}

function upsertLocalCustomer(customerData) {
  const index = customers.findIndex(c => c.id === customerData.id);
  if (index === -1) {
    customers.unshift(customerData);
  } else {
    customers[index] = { ...customers[index], ...customerData };
  }
  customers = [...customers];
  // حفظ في IndexedDB
  idbPut(STORE_CUSTOMERS, customerData).catch(console.error);
}

function applyLocalCustomerTotals(customerId, debtDelta = 0, purchasesDelta = 0) {
  const customer = getCustomerById(customerId);
  if (!customer.id) return;
  const updated = {
    ...customer,
    debt: Number(customer.debt || 0) + Number(debtDelta || 0),
    totalPurchases: Number(customer.totalPurchases || 0) + Number(purchasesDelta || 0)
  };
  upsertLocalCustomer(updated);
}

function addLocalTransaction(transactionData) {
  transactions = mergeTransactionsWithoutDuplicates([transactionData, ...transactions]);
  // حفظ في IndexedDB
  idbPut(STORE_TRANSACTIONS, { ...transactionData, id: transactionData.clientOpId || transactionData.id }).catch(console.error);
}

function refreshAllViews() {
  populatePaymentSelect();
  renderDebtCustomersTable();
  renderDebtHistory();
  renderTracking();
}

// ─── واجهة المستخدم ───────────────────────────────────────────────────────────
function populatePaymentSelect() {
  const debtCustomers = customers
    .filter(c => Number(c.debt || 0) > 0)
    .sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0));

  paymentCustomer.innerHTML = ['<option value="">اختر الزبون</option>']
    .concat(debtCustomers.map(c =>
      `<option value="${c.id}">${c.name} - ${c.phone} - ${formatMoney(c.debt)}</option>`
    ))
    .join('');
}

function renderDebtCustomersTable() {
  const term = normalizeText(debtsSearchInput.value);
  const debtCustomers = customers.filter(c => {
    if (Number(c.debt || 0) <= 0) return false;
    const name = normalizeText(c.name || '');
    const phone = normalizeText(c.phone || '');
    return !term || name.includes(term) || phone.includes(term);
  });

  if (debtCustomers.length === 0) {
    debtCustomersTableBody.innerHTML = `<tr><td colspan="5">لا يوجد زبائن عليهم ديون.</td></tr>`;
    return;
  }

  debtCustomersTableBody.innerHTML = debtCustomers
    .sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0))
    .map(c => `
      <tr>
        <td>${c.name || ''}</td>
        <td>${c.phone || ''}</td>
        <td>${formatMoney(c.debt)}</td>
        <td>${formatMoney(c.totalPurchases || 0)}</td>
        <td><button class="pay-btn quick-pay-btn" data-id="${c.id}">تسديد</button></td>
      </tr>
    `).join('');

  document.querySelectorAll('.quick-pay-btn').forEach(button => {
    button.addEventListener('click', () => {
      paymentCustomer.value = button.dataset.id;
      document.getElementById('paymentAmount').focus();
      document.getElementById('paymentAmount').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function renderDebtHistory() {
  const term = normalizeText(debtHistorySearchInput.value);
  const debtTransactions = transactions.filter(t => {
    if (!(t.type === 'payment' || (t.type === 'purchase' && Number(t.debtAdded || 0) > 0))) return false;
    const c = getCustomerById(t.customerId);
    const noteText = t.type === 'payment' ? (t.note || '') : `${t.itemName || ''} ${t.note || ''}`;
    return !term ||
      normalizeText(c.name || '').includes(term) ||
      normalizeText(c.phone || '').includes(term) ||
      normalizeText(noteText).includes(term);
  });

  if (debtTransactions.length === 0) {
    debtsTableBody.innerHTML = `<tr><td colspan="5">لا يوجد سجل مطابق للبحث.</td></tr>`;
    return;
  }

  debtsTableBody.innerHTML = debtTransactions.map(t => {
    const c = getCustomerById(t.customerId);
    const typeLabel = t.type === 'payment' ? 'تسديد' : 'دين ناتج عن شراء';
    const amount = t.type === 'payment' ? t.amount : t.debtAdded;
    const note = t.type === 'payment'
      ? (t.note || '-')
      : `${t.itemName || '-'}${t.note ? ' - ' + t.note : ''}`;

    return `
      <tr>
        <td>${c.name || 'غير معروف'}</td>
        <td>${typeLabel}</td>
        <td>${formatMoney(amount)}</td>
        <td>${note}</td>
        <td>${formatDate(t)}</td>
      </tr>
    `;
  }).join('');
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setPresetDates(preset) {
  const now = new Date();
  if (preset === 'today') {
    const today = toDateInputValue(now);
    startDateInput.value = today;
    endDateInput.value = today;
  } else if (preset === 'current_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startDateInput.value = toDateInputValue(firstDay);
    endDateInput.value = toDateInputValue(now);
  }
}

function getDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getDayEnd(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function getSelectedRange() {
  const preset = datePreset.value;
  const now = new Date();

  if (preset === 'today') return { start: getDayStart(now), end: getDayEnd(now) };
  if (preset === 'current_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: getDayStart(firstDay), end: getDayEnd(now) };
  }
  if (!startDateInput.value || !endDateInput.value) return null;

  return {
    start: getDayStart(new Date(startDateInput.value)),
    end: getDayEnd(new Date(endDateInput.value))
  };
}

function isTransactionInRange(transaction, range) {
  const date = getTransactionDate(transaction);
  if (!date || !range) return false;
  return date >= range.start && date <= range.end;
}

function getTodayRange() {
  const now = new Date();
  return { start: getDayStart(now), end: getDayEnd(now) };
}

function renderTracking() {
  const range = getSelectedRange();
  const term = normalizeText(trackingSearchInput.value);

  if (!range) {
    trackingTableBody.innerHTML = `<tr><td colspan="6">حدد التاريخ أولاً.</td></tr>`;
    periodPurchasesValue.textContent = formatMoney(0);
    periodDebtsValue.textContent = formatMoney(0);
  } else {
    const filteredTransactions = transactions.filter(t => {
      if (!isTransactionInRange(t, range)) return false;
      const c = getCustomerById(t.customerId);
      const name = normalizeText(c.name || '');
      const phone = normalizeText(c.phone || '');
      const detail = normalizeText(`${t.itemName || ''} ${t.note || ''}`);
      return !term || name.includes(term) || phone.includes(term) || detail.includes(term);
    });

    const periodPurchases = filteredTransactions
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + Number(t.total || 0), 0);

    const periodDebts = filteredTransactions
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + Number(t.debtAdded || 0), 0);

    periodPurchasesValue.textContent = formatMoney(periodPurchases);
    periodDebtsValue.textContent = formatMoney(periodDebts);

    if (filteredTransactions.length === 0) {
      trackingTableBody.innerHTML = `<tr><td colspan="6">لا توجد عمليات ضمن هذه الفترة.</td></tr>`;
    } else {
      trackingTableBody.innerHTML = filteredTransactions.map(t => {
        const c = getCustomerById(t.customerId);
        const isPurchase = t.type === 'purchase';
        const detail = isPurchase
          ? `${t.itemName || '-'}${t.note ? ' - ' + t.note : ''}`
          : (t.note || '-');
        const amount = isPurchase ? Number(t.total || 0) : Number(t.amount || 0);

        return `
          <tr>
            <td>${c.name || 'غير معروف'}</td>
            <td>${c.phone || '-'}</td>
            <td>${isPurchase ? 'شراء' : 'تسديد'}</td>
            <td>${detail}</td>
            <td>${formatMoney(amount)}</td>
            <td>${formatDate(t)}</td>
          </tr>
        `;
      }).join('');
    }
  }

  const todayRange = getTodayRange();
  const todayPurchases = transactions
    .filter(t => t.type === 'purchase' && isTransactionInRange(t, todayRange))
    .reduce((sum, t) => sum + Number(t.total || 0), 0);
  const todayDebts = transactions
    .filter(t => t.type === 'purchase' && isTransactionInRange(t, todayRange))
    .reduce((sum, t) => sum + Number(t.debtAdded || 0), 0);

  todayPurchasesValue.textContent = formatMoney(todayPurchases);
  todayDebtsValue.textContent = formatMoney(todayDebts);
}

function setButtonLoadingState(button, isLoading, loadingText, normalText) {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : normalText;
  button.style.opacity = isLoading ? '0.7' : '1';
  button.style.cursor = isLoading ? 'not-allowed' : 'pointer';
}

// ─── أحداث البحث والتصفية ────────────────────────────────────────────────────
debtsSearchInput.addEventListener('input', renderDebtCustomersTable);
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
endDateInput.addEventListener('change', () => { datePreset.value = 'custom'; renderTracking(); });

// ─── نموذج الشراء ────────────────────────────────────────────────────────────
purchaseForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isSavingPurchase) return;
  isSavingPurchase = true;
  setButtonLoadingState(purchaseSubmitBtn, true, 'جارٍ الحفظ...', 'حفظ عملية الشراء');

  const enteredName = purchaseCustomerName.value.trim();
  const enteredPhone = purchaseCustomerPhone.value.trim();
  const itemName = document.getElementById('itemName').value.trim();
  const price = Number(document.getElementById('price').value || 0);
  const paidNow = Number(document.getElementById('paidNow').value || 0);
  const purchaseNote = document.getElementById('purchaseNote').value.trim();
  const total = price;
  const debtAdded = Math.max(total - paidNow, 0);
  const createdAtClient = Date.now();
  const clientOpId = generateClientOpId();

  if (!enteredName || !enteredPhone || !itemName || price <= 0) {
    showMessage('أدخل بيانات الشراء بشكل صحيح.');
    isSavingPurchase = false;
    setButtonLoadingState(purchaseSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ عملية الشراء');
    return;
  }

  try {
    let customerId;
    const existingCustomer = findCustomerByPhone(enteredPhone);

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      // توليد ID محلي يُستخدم كـ ID في Firebase أيضاً (setDoc بدل addDoc)
      customerId = generateLocalId();

      const customerData = {
        id: customerId,
        name: enteredName,
        phone: enteredPhone,
        debt: 0,
        totalPurchases: 0,
        createdAtClient
      };

      // حفظ فوري محلياً
      upsertLocalCustomer(customerData);

      // محاولة Firebase — يعمل أوفلاين عبر persistentLocalCache
      setDoc(doc(db, 'customers', customerId), {
        name: enteredName,
        phone: enteredPhone,
        debt: 0,
        totalPurchases: 0,
        createdAt: serverTimestamp(),
        createdAtClient
      }).catch(() => {
        // إذا فشل فوراً (نادر مع persistentLocalCache)، نضيف للقائمة المعلقة
        idbAddPending({
          type: 'addCustomer',
          customerId,
          data: { name: enteredName, phone: enteredPhone, debt: 0, totalPurchases: 0, createdAtClient }
        }).catch(console.error);
      });
    }

    const transactionId = clientOpId;
    const transactionData = {
      customerId,
      itemName,
      price,
      paidNow,
      total,
      debtAdded,
      note: purchaseNote,
      type: 'purchase',
      createdAtClient,
      clientOpId
    };

    // حفظ محلي فوري
    applyLocalCustomerTotals(customerId, debtAdded, total);
    addLocalTransaction({ id: transactionId, ...transactionData });

    // محاولة Firebase
    const firestoreData = {
      ...transactionData,
      createdAt: serverTimestamp()
    };

    setDoc(doc(db, 'transactions', transactionId), firestoreData).then(() => {
      return updateDoc(doc(db, 'customers', customerId), {
        debt: increment(debtAdded),
        totalPurchases: increment(total)
      });
    }).catch(() => {
      // الحفظ في قائمة الانتظار للمزامنة لاحقاً
      idbAddPending({
        type: 'addPurchase',
        transactionId,
        customerId,
        data: firestoreData,
        debtDelta: debtAdded,
        purchasesDelta: total
      }).catch(console.error);
    });

    refreshAllViews();
    event.target.reset();
    document.getElementById('paidNow').value = 0;
    showPage('tracking');
    renderTracking();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!navigator.onLine) {
      showMessage('تم حفظ عملية الشراء محلياً وتحديث الواجهة فوراً. ستُرفع لقاعدة البيانات عند عودة الاتصال.', 'success');
    } else if (existingCustomer && normalizeText(existingCustomer.name || '') !== normalizeText(enteredName)) {
      showMessage(`تم اعتماد الاسم المخزّن: ${existingCustomer.name}. تم حفظ الشراء وتحديث الدين.`, 'success');
    } else {
      showMessage('تم حفظ عملية الشراء وتحديث الدين مباشرة.', 'success');
    }

  } catch (error) {
    console.error(error);
    showMessage('تعذر حفظ عملية الشراء. حاول مجدداً.');
  } finally {
    isSavingPurchase = false;
    setButtonLoadingState(purchaseSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ عملية الشراء');
  }
});

// ─── نموذج الدفعة ────────────────────────────────────────────────────────────
paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isSavingPayment) return;
  isSavingPayment = true;
  setButtonLoadingState(paymentSubmitBtn, true, 'جارٍ الحفظ...', 'حفظ الدفعة');

  const customerId = paymentCustomer.value;
  const amount = Number(document.getElementById('paymentAmount').value || 0);
  const note = document.getElementById('paymentNote').value.trim();
  const createdAtClient = Date.now();
  const clientOpId = generateClientOpId();

  if (!customerId || amount <= 0) {
    showMessage('أدخل الزبون والمبلغ بشكل صحيح.');
    isSavingPayment = false;
    setButtonLoadingState(paymentSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ الدفعة');
    return;
  }

  try {
    const transactionId = clientOpId;
    const transactionData = {
      customerId,
      amount,
      note,
      type: 'payment',
      createdAtClient,
      clientOpId
    };

    // حفظ محلي فوري
    applyLocalCustomerTotals(customerId, -amount, 0);
    addLocalTransaction({ id: transactionId, ...transactionData });

    // محاولة Firebase
    const firestoreData = { ...transactionData, createdAt: serverTimestamp() };

    setDoc(doc(db, 'transactions', transactionId), firestoreData).then(() => {
      return updateDoc(doc(db, 'customers', customerId), {
        debt: increment(-amount)
      });
    }).catch(() => {
      idbAddPending({
        type: 'addPayment',
        transactionId,
        customerId,
        data: firestoreData,
        debtDelta: -amount
      }).catch(console.error);
    });

    refreshAllViews();
    event.target.reset();

    if (!navigator.onLine) {
      showMessage('تم حفظ الدفعة محلياً وتحديث الواجهة فوراً. ستُرفع لقاعدة البيانات عند عودة الاتصال.', 'success');
    } else {
      showMessage('تم حفظ الدفعة وتحديث الدين مباشرة.', 'success');
    }

  } catch (error) {
    console.error(error);
    showMessage('تعذر تسجيل الدفعة.');
  } finally {
    isSavingPayment = false;
    setButtonLoadingState(paymentSubmitBtn, false, 'جارٍ الحفظ...', 'حفظ الدفعة');
  }
});

// ─── أحداث الاتصال ───────────────────────────────────────────────────────────
window.addEventListener('offline', () => {
  updateConnectionIndicator();
  showMessage('أنت الآن غير متصل. يمكنك المتابعة بشكل طبيعي، وستُحفظ العمليات محلياً وترفع تلقائياً عند عودة الشبكة.', 'error');
});

window.addEventListener('online', async () => {
  updateConnectionIndicator();
  showMessage('تم استعادة الاتصال. جارٍ مزامنة البيانات...', 'success');
  await syncPendingOperations();
});

// ─── تهيئة التطبيق ───────────────────────────────────────────────────────────
setPresetDates('current_month');

// 1. تحميل البيانات المحلية أولاً لعرض فوري
loadLocalData();

// 2. الاستماع لـ Firebase (يعمل من الكاش المحلي أوفلاين، ومن السيرفر أونلاين)
const customersQuery = query(collection(db, 'customers'), orderBy('createdAt', 'desc'));
onSnapshot(
  customersQuery,
  (snapshot) => {
    const serverCustomers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // دمج: الزبائن الذين أضفناهم محلياً (ID يبدأ بـ local_) نحتفظ بهم حتى تنتهي المزامنة
    const localOnlyCustomers = customers.filter(localC =>
      !serverCustomers.some(serverC => serverC.id === localC.id)
    );

    customers = [...serverCustomers, ...localOnlyCustomers];

    // تحديث IndexedDB
    serverCustomers.forEach(c => idbPut(STORE_CUSTOMERS, c).catch(console.error));

    refreshAllViews();
  },
  (error) => {
    console.error(error);
    // لا نُظهر خطأ أوفلاين — البيانات المحلية كافية
    if (navigator.onLine) {
      showMessage('فشل تحميل الزبائن من السيرفر. تأكد من Firestore.', 'error');
    }
  }
);

const transactionsQuery = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
onSnapshot(
  transactionsQuery,
  (snapshot) => {
    const serverTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // تحديث IndexedDB
    serverTransactions.forEach(t => idbPut(STORE_TRANSACTIONS, t).catch(console.error));

    transactions = mergeTransactionsWithoutDuplicates([...serverTransactions, ...transactions]);
    renderDebtHistory();
    renderDebtCustomersTable();
    renderTracking();
  },
  (error) => {
    console.error(error);
  }
);

// 3. عند بدء التشغيل أونلاين، نزامن أي عمليات معلقة
if (navigator.onLine) {
  setTimeout(syncPendingOperations, 2000);
}