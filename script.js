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

const salesSearchInput = document.getElementById('salesSearchInput');
const debtsSearchInput = document.getElementById('debtsSearchInput');

const salesTableBody = document.getElementById('salesTableBody');
const debtCustomersTableBody = document.getElementById('debtCustomersTableBody');
const debtsTableBody = document.getElementById('debtsTableBody');

const pageConfig = {
    sales: {
        title: 'إضافة عملية شراء',
        subtitle: 'سجل الشراء والزبون في خطوة واحدة'
    },
    debts: {
        title: 'الديون',
        subtitle: 'إدارة الديون والتسديدات بسهولة'
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

function formatDate(timestamp) {
    if (!timestamp?.seconds) return '—';
    return new Date(timestamp.seconds * 1000).toLocaleString('ar-EG');
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
    customersCount.textContent = customers.length;

    const debtSum = customers.reduce((sum, customer) => sum + Number(customer.debt || 0), 0);
    totalDebt.textContent = formatMoney(debtSum);

    const salesSum = transactions
        .filter(transaction => transaction.type === 'purchase')
        .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);

    totalSales.textContent = formatMoney(salesSum);
}

function populatePaymentSelect() {
    const debtCustomers = customers
        .filter(customer => Number(customer.debt || 0) > 0)
        .sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0));

    const options = ['<option value="">اختر الزبون</option>']
        .concat(
            debtCustomers.map(customer =>
                `<option value="${customer.id}">${customer.name} - ${customer.phone} - ${formatMoney(customer.debt)}</option>`
            )
        )
        .join('');

    paymentCustomer.innerHTML = options;
}

function renderSalesTable() {
    const term = normalizeText(salesSearchInput.value);

    const sales = transactions.filter(transaction => {
        if (transaction.type !== 'purchase') return false;

        const customer = getCustomerById(transaction.customerId);
        const customerName = normalizeText(customer.name || '');
        const customerPhone = normalizeText(customer.phone || '');
        const itemName = normalizeText(transaction.itemName || '');

        if (!term) return true;

        return (
            customerName.includes(term) ||
            customerPhone.includes(term) ||
            itemName.includes(term)
        );
    });

    if (sales.length === 0) {
        salesTableBody.innerHTML = `<tr><td colspan="7">لا توجد عمليات شراء مطابقة.</td></tr>`;
        return;
    }

    salesTableBody.innerHTML = sales.slice(0, 50).map(transaction => {
        const customer = getCustomerById(transaction.customerId);

        return `
      <tr>
        <td>${customer.name || 'غير معروف'}</td>
        <td>${customer.phone || '-'}</td>
        <td>${transaction.itemName || ''}</td>
        <td>${formatMoney(transaction.price)}</td>
        <td>${formatMoney(transaction.paidNow)}</td>
        <td>${formatMoney(transaction.debtAdded)}</td>
        <td>${formatDate(transaction.createdAt)}</td>
      </tr>
    `;
    }).join('');
}

function renderDebtCustomersTable() {
    const term = normalizeText(debtsSearchInput.value);

    const debtCustomers = customers.filter(customer => {
        if (Number(customer.debt || 0) <= 0) return false;

        const name = normalizeText(customer.name || '');
        const phone = normalizeText(customer.phone || '');

        if (!term) return true;
        return name.includes(term) || phone.includes(term);
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
        <td>
          <button class="pay-btn quick-pay-btn" data-id="${customer.id}">
            تسديد
          </button>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('.quick-pay-btn').forEach(button => {
        button.addEventListener('click', () => {
            paymentCustomer.value = button.dataset.id;
            document.getElementById('paymentAmount').focus();
            document.getElementById('paymentAmount').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        });
    });
}

function renderDebtHistory() {
    const debtTransactions = transactions.filter(transaction =>
        transaction.type === 'payment' || (transaction.type === 'purchase' && Number(transaction.debtAdded || 0) > 0)
    );

    if (debtTransactions.length === 0) {
        debtsTableBody.innerHTML = `<tr><td colspan="5">لا يوجد سجل ديون أو تسديدات.</td></tr>`;
        return;
    }

    debtsTableBody.innerHTML = debtTransactions.map(transaction => {
        const customer = getCustomerById(transaction.customerId);

        const typeLabel = transaction.type === 'payment' ? 'تسديد' : 'دين ناتج عن شراء';
        const amount = transaction.type === 'payment' ? transaction.amount : transaction.debtAdded;
        const note = transaction.type === 'payment' ? (transaction.note || '-') : (transaction.itemName || '-');

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

salesSearchInput.addEventListener('input', renderSalesTable);
debtsSearchInput.addEventListener('input', renderDebtCustomersTable);

document.getElementById('purchaseForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const enteredName = purchaseCustomerName.value.trim();
    const enteredPhone = purchaseCustomerPhone.value.trim();
    const itemName = document.getElementById('itemName').value.trim();
    const price = Number(document.getElementById('price').value || 0);
    const paidNow = Number(document.getElementById('paidNow').value || 0);

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

const customersQuery = query(collection(db, 'customers'), orderBy('createdAt', 'desc'));
onSnapshot(customersQuery, (snapshot) => {
    customers = snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
    updateStats();
    populatePaymentSelect();
    renderDebtCustomersTable();
    renderSalesTable();
}, (error) => {
    console.error(error);
    showMessage('فشل تحميل الزبائن. تأكد من Firestore.');
});

const transactionsQuery = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
onSnapshot(transactionsQuery, (snapshot) => {
    transactions = snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
    updateStats();
    renderSalesTable();
    renderDebtHistory();
    renderDebtCustomersTable();
});