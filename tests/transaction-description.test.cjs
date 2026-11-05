const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
  .replace(/^import \* as pdfjs.*\r?\n/m, '')
  .replace(/^pdfjs\.GlobalWorkerOptions.*\r?\n/m, '')
  .replace(/^bootAuth\(\);/m, '');

function fixture() {
  return {
    version: 1, members: ['Yo'],
    accounts: [
      { id: 'mp', name: 'Mercado Pago', opening: 1000 },
      { id: 'pp', name: 'Personal Pay', opening: 2000 }
    ],
    expenseCategories: [{ id: 'yield', name: 'Ingreso - rendimiento' }],
    payees: [], cards: [], charges: [], statements: [], loans: [], bills: [],
    transactions: ['mp', 'pp'].map((accountId, i) => ({
      id: accountId + '-yield', date: '2026-11-04', time: '10:15',
      accountId, amount: 10 + i, kind: 'income', description: 'Gasto',
      category: 'Ingreso - rendimiento', expenseCategoryId: 'yield', member: 'Yo'
    }))
  };
}

function application(data = fixture()) {
  const nodes = new Map(['lock', 'month', 'add-main', 'nav', 'connection-status', 'view']
    .map(id => ['#' + id, {}]));
  const context = vm.createContext({
    TextEncoder, TextDecoder, URLSearchParams, crypto: webcrypto, btoa, atob,
    location: { hostname: 'localhost', search: '?local=1' }, navigator: {},
    document: { querySelector: selector => nodes.get(selector) || null, addEventListener() {} }
  });
  vm.runInContext(source + `
    render=()=>{}; toast=()=>{}; start=()=>{};
    let formHandler=null,form=null;
    modal=()=>{}; submit=handler=>{formHandler=handler};
    globalThis.app={
      load(data){state=normalizeState(data);selectedMonth='2026-11'},
      get state(){return state},
      table(){return txTable(state.transactions)},
      balances(){return state.accounts.filter(a=>accountCurrency(a)==='ARS').map(a=>accountBalanceThrough(a))},
      snapshot(){return cloudSnapshot(state)},
      edit(id){
        const seed=byId(state.transactions,id);
        form={elements:{kind:{value:seed.kind},description:{value:seed.description},
          accountId:{closest:()=>({firstChild:{textContent:''}})}},
          querySelector:()=>({innerHTML:''})};
        globalThis.setForm(form);openTransaction(seed)
      },
      changeKind(kind){form.elements.kind.value=kind;form.elements.kind.onchange();return form.elements.description.value},
      setDescription(value){form.elements.description.value=value},
      saveForm(data){formHandler({...data,description:form.elements.description.value})},
      setCloud(value,user){cloud=value;currentUser=user;storageMode='cloud'},
      loadCloudState,openCloudSpace
    };
  `, context);
  context.setForm = form => nodes.set('#edit-form', form);
  context.app.load(data);
  return context.app;
}

test('previously corrected yields show Ingreso in both wallet details without changing financial data', () => {
  const data = fixture(), before = structuredClone(data.transactions);
  const app = application(data);
  assert.deepEqual(Array.from(app.balances()), [1010, 2011]);
  for (const [i, tx] of app.state.transactions.entries()) {
    assert.equal(tx.description, 'Ingreso');
    assert.deepEqual(JSON.parse(JSON.stringify(tx)), { ...before[i], description: 'Ingreso' });
  }
  assert.doesNotMatch(app.table(), />Gasto</);
  assert.match(app.table(), /Ingreso · Ingreso - rendimiento/);
  assert.equal(JSON.parse(app.snapshot().transactions['mp-yield']).description, 'Ingreso');
  const once = JSON.stringify(app.state);
  app.load(app.state);
  assert.equal(JSON.stringify(app.state), once);
});

test('normalization preserves custom descriptions and legitimate expenses', () => {
  const data = fixture();
  data.transactions[0].description = 'Gasto reintegrado por Mercado Pago';
  data.transactions[1].kind = 'expense';
  const app = application(data);
  assert.equal(app.state.transactions[0].description, 'Gasto reintegrado por Mercado Pago');
  assert.equal(app.state.transactions[1].description, 'Gasto');
});

test('changing expense to income updates the automatic detail before saving and preserves its identity', () => {
  const data = fixture();
  data.transactions[0].kind = 'expense';
  const app = application(data);
  app.edit('mp-yield');
  assert.equal(app.changeKind('income'), 'Ingreso');
  app.saveForm({ ...app.state.transactions[0], kind: 'income' });
  assert.equal(app.state.transactions.length, 2);
  const tx = app.state.transactions.find(t => t.id === 'mp-yield');
  assert.equal(tx.description, 'Ingreso');
  assert.equal(tx.kind, 'income');
  assert.equal(tx.amount, 10);
  assert.equal(tx.accountId, 'mp');
  assert.deepEqual(Array.from(app.balances()), [1010, 2011]);
});

test('switching types repeatedly updates automatic descriptions and retains custom text', () => {
  const app = application();
  app.edit('mp-yield');
  assert.equal(app.changeKind('expense'), 'Gasto');
  assert.equal(app.changeKind('income'), 'Ingreso');
  app.setDescription('Rendimiento diario de Mercado Pago');
  assert.equal(app.changeKind('expense'), 'Rendimiento diario de Mercado Pago');
  assert.equal(app.changeKind('income'), 'Rendimiento diario de Mercado Pago');
});

test('opening cloud data persists repaired details instead of treating normalized data as already saved', async () => {
  const raw = fixture(), app = application(), commits = [];
  const dbApi = {
    collection: (...parts) => parts.slice(1).join('/'),
    doc: (...parts) => parts.filter(p => typeof p === 'string').join('/'),
    getDoc: async () => ({ exists: () => true, data: () => ({ version: 1, members: ['Yo'] }) }),
    getDocs: async ref => {
      const items = raw[ref.split('/').at(-1)] || [];
      return { empty: !items.length, docs: items.map(item => ({ id: item.id, data: () => structuredClone(item) })) };
    },
    serverTimestamp: () => 'now',
    writeBatch: () => {
      const writes = [];
      return { set: (ref, data) => writes.push({ ref, data }), delete: ref => { throw Error('Unexpected deletion: ' + ref); }, commit: async () => commits.push(writes) };
    }
  };
  app.setCloud({ db: {}, dbApi }, { uid: 'test-user' });
  await app.openCloudSpace({ uid: 'test-user' });
  const writes = commits.flat().filter(w => w.ref.includes('/transactions/'));
  assert.equal(writes.length, 2);
  for (const write of writes) assert.equal(write.data.description, 'Ingreso');
  assert.deepEqual(Array.from(app.balances()), [1010, 2011]);
});
