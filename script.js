import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/11.7.1/firebase-analytics.js';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  doc,
  increment,
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
try { getAnalytics(app); } catch (e) { }
const db = getFirestore(app);

let customers = [];
let transactions = [];

const navButtons = document.querySelectorAll('.nav-btn');
const pageSections = document.querySelectorAll('.page-section');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');

const customersCount = document.getElementById('customersCount');
const totalDebt = document.getElementById('totalDebt');
const totalSales = document.getElementById('totalSales');
const messageBox = document.getElementById('messageBox');

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
  sales: {
    title: 'إضافة عملية شراء',
    subtitle: 'سجل الشراء والزبون في خطوة واحدة'
  },
  debts: {
    title: 'الديون',
    subtitle: 'إدارة الديون والتسديدات بسهولة'
  },
  tracking: {
    title: 'التتبع والتقارير',
    subtitle: 'راجع مشتريات اليوم والديون وحدد أي فترة تريدها'
  }
};

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
  setTimeout(() => {
    messageBox.innerHTML = '';
  }, 4000);
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} شيكل`;
}

function getTransactionDate(transaction) {
  if (!transaction?.createdAt?.seconds) return null;
  return new Date(transaction.createdAt.seconds * 1000);
}

function formatDate(timestamp) {
  const date = getTransactionDate({ createdAt: timestamp });
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
  return customers.find(customer => customer.id === customerId) || {};
}

function findCustomerByPhone(phone = '') {
  const normalizedInputPhone = normalizePhone(phone);
  return customers.find(customer => normalizePhone(customer.phone || '') === normalizedInputPhone);
}

function updateStats() {
  if (customersCount) {
    customersCount.textContent = customers.length;
  }

  if (totalDebt) {
    totalDebt.textContent = formatMoney(
      customers.reduce((sum, customer) => sum + Number(customer.debt || 0), 0)
    );
  }

  if (totalSales) {
    totalSales.textContent = formatMoney(
      transactions
        .filter(transaction => transaction.type === 'purchase')
        .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0)
    );
  }
}

function populatePaymentSelect() {
  const debtCustomers = customers
    .filter(customer => Number(customer.debt || 0) > 0)
    .sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0));

  paymentCustomer.innerHTML = ['<option value="">اختر الزبون</option>']
    .concat(
      debtCustomers.map(customer =>
        `<option value="${customer.id}">${customer.name} - ${customer.phone} - ${formatMoney(customer.debt)}</option>`
      )
    )
    .join('');
}

function renderDebtCustomersTable() {
  const term = normalizeText(debtsSearchInput.value);

  const debtCustomers = customers.filter(customer => {
    if (Number(customer.debt || 0) <= 0) return false;
    const name = normalizeText(customer.name || '');
    const phone = normalizeText(customer.phone || '');
    return !term || name.includes(term) || phone.includes(term);
  });

  if (debtCustomers.length === 0) {
    debtCustomersTableBody.innerHTML = `<tr><td colspan="5">لا يوجد زبائن عليهم ديون.</td></tr>`;
    return;
  }

  debtCustomersTableBody.innerHTML = debtCustomers
    .sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0))
    .map(customer => `
      <tr>
        <td>${customer.name || ''}</td>
        <td>${customer.phone || ''}</td>
        <td>${formatMoney(customer.debt)}</td>
        <td>${formatMoney(customer.totalPurchases)}</td>
        <td><button class="pay-btn quick-pay-btn" data-id="${customer.id}">تسديد</button></td>
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

  const debtTransactions = transactions.filter(transaction => {
    if (!(transaction.type === 'payment' || (transaction.type === 'purchase' && Number(transaction.debtAdded || 0) > 0))) {
      return false;
    }

    const customer = getCustomerById(transaction.customerId);
    const customerName = normalizeText(customer.name || '');
    const customerPhone = normalizeText(customer.phone || '');

    const noteText = transaction.type === 'payment'
      ? (transaction.note || '')
      : `${transaction.itemName || ''} ${transaction.note || ''}`;

    const normalizedNote = normalizeText(noteText);

    return !term || customerName.includes(term) || customerPhone.includes(term) || normalizedNote.includes(term);
  });

  if (debtTransactions.length === 0) {
    debtsTableBody.innerHTML = `<tr><td colspan="5">لا يوجد سجل مطابق للبحث.</td></tr>`;
    return;
  }

  debtsTableBody.innerHTML = debtTransactions.map(transaction => {
    const customer = getCustomerById(transaction.customerId);
    const typeLabel = transaction.type === 'payment' ? 'تسديد' : 'دين ناتج عن شراء';
    const amount = transaction.type === 'payment' ? transaction.amount : transaction.debtAdded;
    const note = transaction.type === 'payment'
      ? (transaction.note || '-')
      : `${transaction.itemName || '-'}${transaction.note ? ' - ' + transaction.note : ''}`;

    return `
      <tr>
        <td>${customer.name || 'غير معروف'}</td>
        <td>${typeLabel}</td>
        <td>${formatMoney(amount)}</td>
        <td>${note}</td>
        <td>${formatDate(transaction.createdAt)}</td>
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

  if (preset === 'today') {
    return { start: getDayStart(now), end: getDayEnd(now) };
  }

  if (preset === 'current_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: getDayStart(firstDay), end: getDayEnd(now) };
  }

  if (!startDateInput.value || !endDateInput.value) return null;

  const start = new Date(startDateInput.value);
  const end = new Date(endDateInput.value);

  return { start: getDayStart(start), end: getDayEnd(end) };
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
    const filteredTransactions = transactions.filter(transaction => {
      if (!isTransactionInRange(transaction, range)) return false;

      const customer = getCustomerById(transaction.customerId);
      const name = normalizeText(customer.name || '');
      const phone = normalizeText(customer.phone || '');
      const detail = normalizeText(`${transaction.itemName || ''} ${transaction.note || ''}`);

      return !term || name.includes(term) || phone.includes(term) || detail.includes(term);
    });

    const periodPurchases = filteredTransactions
      .filter(transaction => transaction.type === 'purchase')
      .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);

    const periodDebts = filteredTransactions
      .filter(transaction => transaction.type === 'purchase')
      .reduce((sum, transaction) => sum + Number(transaction.debtAdded || 0), 0);

    periodPurchasesValue.textContent = formatMoney(periodPurchases);
    periodDebtsValue.textContent = formatMoney(periodDebts);

    if (filteredTransactions.length === 0) {
      trackingTableBody.innerHTML = `<tr><td colspan="6">لا توجد عمليات ضمن هذه الفترة.</td></tr>`;
    } else {
      trackingTableBody.innerHTML = filteredTransactions.map(transaction => {
        const customer = getCustomerById(transaction.customerId);
        const isPurchase = transaction.type === 'purchase';
        const detail = isPurchase
          ? `${transaction.itemName || '-'}${transaction.note ? ' - ' + transaction.note : ''}`
          : (transaction.note || '-');
        const amount = isPurchase ? Number(transaction.total || 0) : Number(transaction.amount || 0);
        const typeLabel = isPurchase ? 'شراء' : 'تسديد';

        return `
          <tr>
            <td>${customer.name || 'غير معروف'}</td>
            <td>${customer.phone || '-'}</td>
            <td>${typeLabel}</td>
            <td>${detail}</td>
            <td>${formatMoney(amount)}</td>
            <td>${formatDate(transaction.createdAt)}</td>
          </tr>
        `;
      }).join('');
    }
  }

  const todayRange = getTodayRange();

  const todayPurchases = transactions
    .filter(transaction => transaction.type === 'purchase' && isTransactionInRange(transaction, todayRange))
    .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);

  const todayDebts = transactions
    .filter(transaction => transaction.type === 'purchase' && isTransactionInRange(transaction, todayRange))
    .reduce((sum, transaction) => sum + Number(transaction.debtAdded || 0), 0);

  todayPurchasesValue.textContent = formatMoney(todayPurchases);
  todayDebtsValue.textContent = formatMoney(todayDebts);
}

debtsSearchInput.addEventListener('input', renderDebtCustomersTable);
trackingSearchInput.addEventListener('input', renderTracking);
debtHistorySearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    renderDebtHistory();
  }
});
debtHistorySearchBtn.addEventListener('click', renderDebtHistory);

datePreset.addEventListener('change', () => {
  if (datePreset.value !== 'custom') {
    setPresetDates(datePreset.value);
  }
  renderTracking();
});

applyDateFilterBtn.addEventListener('click', renderTracking);

startDateInput.addEventListener('change', () => {
  datePreset.value = 'custom';
  renderTracking();
});

endDateInput.addEventListener('change', () => {
  datePreset.value = 'custom';
  renderTracking();
});

document.getElementById('purchaseForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const enteredName = purchaseCustomerName.value.trim();
  const enteredPhone = purchaseCustomerPhone.value.trim();
  const itemName = document.getElementById('itemName').value.trim();
  const price = Number(document.getElementById('price').value || 0);
  const paidNow = Number(document.getElementById('paidNow').value || 0);
  const purchaseNote = document.getElementById('purchaseNote').value.trim();
  const total = price;
  const debtAdded = Math.max(total - paidNow, 0);

  if (!enteredName || !enteredPhone || !itemName || price <= 0) {
    showMessage('أدخل بيانات الشراء بشكل صحيح.');
    return;
  }

  try {
    let customerId;
    const existingCustomer = findCustomerByPhone(enteredPhone);

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const customerRef = await addDoc(collection(db, 'customers'), {
        name: enteredName,
        phone: enteredPhone,
        debt: 0,
        totalPurchases: 0,
        createdAt: serverTimestamp(),
      });
      customerId = customerRef.id;
    }

    await addDoc(collection(db, 'transactions'), {
      customerId,
      itemName,
      price,
      paidNow,
      total,
      debtAdded,
      note: purchaseNote,
      type: 'purchase',
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'customers', customerId), {
      debt: increment(debtAdded),
      totalPurchases: increment(total),
    });

    event.target.reset();
    document.getElementById('paidNow').value = 0;

    if (existingCustomer && normalizeText(existingCustomer.name || '') !== normalizeText(enteredName)) {
      showMessage(`تم اعتماد الاسم المخزّن مسبقًا: ${existingCustomer.name}، وتمت إضافة الشراء.`, 'success');
    } else {
      showMessage('تم حفظ عملية الشراء بنجاح.', 'success');
    }
  } catch (error) {
    console.error(error);
    showMessage('تعذر حفظ عملية الشراء.');
  }
});

document.getElementById('paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const customerId = paymentCustomer.value;
  const amount = Number(document.getElementById('paymentAmount').value || 0);
  const note = document.getElementById('paymentNote').value.trim();

  if (!customerId || amount <= 0) {
    showMessage('أدخل الزبون والمبلغ بشكل صحيح.');
    return;
  }

  try {
    await addDoc(collection(db, 'transactions'), {
      customerId,
      amount,
      note,
      type: 'payment',
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'customers', customerId), {
      debt: increment(-amount),
    });

    event.target.reset();
    showMessage('تم حفظ الدفعة بنجاح.', 'success');
  } catch (error) {
    console.error(error);
    showMessage('تعذر تسجيل الدفعة.');
  }
});

setPresetDates('current_month');

const customersQuery = query(collection(db, 'customers'), orderBy('createdAt', 'desc'));
onSnapshot(
  customersQuery,
  (snapshot) => {
    customers = snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
    updateStats();
    populatePaymentSelect();
    renderDebtCustomersTable();
    renderDebtHistory();
    renderTracking();
  },
  (error) => {
    console.error(error);
    showMessage('فشل تحميل الزبائن. تأكد من Firestore.');
  }
);

const transactionsQuery = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
onSnapshot(transactionsQuery, (snapshot) => {
  transactions = snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
  updateStats();
  renderDebtHistory();
  renderDebtCustomersTable();
  renderTracking();
});
