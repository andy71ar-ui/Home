const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const fixture = require('./helpers/services-fixture.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
  .replace(/^import \* as pdfjs.*\r?\n/m, '')
  .replace(/^pdfjs\.GlobalWorkerOptions.*\r?\n/m, '')
  .replace(/^bootAuth\(\);/m, '');
const plain = value => JSON.parse(JSON.stringify(value));

function application(data = fixture()) {
  const nodes = new Map(['lock', 'month', 'add-main', 'nav', 'connection-status', 'view'].map(id => ['#' + id, {}]));
  const context = vm.createContext({
    TextEncoder, TextDecoder, URLSearchParams, crypto: webcrypto, btoa, atob,
    location: { hostname: 'localhost', search: '?local=1' }, navigator: {},
    document: { querySelector: selector => nodes.get(selector) || null, addEventListener() {} }
  });
  vm.runInContext(source + `
    render=()=>{};toast=()=>{};save=async()=>{};
    globalThis.app={
      load(data,month='2026-11'){state=normalizeState(data);selectedMonth=month},
      get state(){return state},setMonth(m){selectedMonth=m},
      status:payeeMonthStatus,setPaid:setPayeeMonthPaid,
      table:renderPayeeMonths,
      setFilter(value){payeeStatusFilter=value},
      setSave(fn){save=fn},snapshot(){return cloudSnapshot(state)},
      balance(){return accountBalanceThrough(state.accounts[0])},
      record(data,id){return recordTransaction(data,byId(state.transactions,id)||{})},
      async shift(months){wire();await $('#view').onclick({target:{closest:()=>({dataset:{payeeShift:String(months)}})}})},
      get month(){return selectedMonth},
      cloud(value){cloud=value;currentUser={uid:'test-user'};storageMode='cloud';cloudMirror=cloudSnapshot(state);save=saveCloudState},
      async reloadCloud(){const loaded=await loadCloudState();state=loaded.data;cloudMirror=loaded.mirror},
      async backup(){const s=crypto.getRandomValues(new Uint8Array(16)),k=await derive('test-only-password',s);return (await unlocked(await encrypted(state,k,s),'test-only-password')).data}
    };
  `, context);
  context.app.load(data);
  return context.app;
}

function expense(overrides = {}) {
  return { kind: 'expense', currency: 'ARS', accountId: 'bank', payeeId: 'gas', expenseCategoryId: 'services', date: '2026-11-05', amount: 10, description: 'Gas', member: 'Yo', ...overrides };
}

test('every saved place appears every month, including those with no invoice or due date', () => {
  const app = application(), html = app.table();
  for (const name of ['Edenor', 'AySA', 'Internet', 'Gas']) assert.match(html, new RegExp(name));
  assert.equal(app.status('gas').paid, false);
  assert.equal(app.status('gas').bills.length, 0);
  assert.match(html, /service-paid">Pagado/);
  assert.match(html, /service-unpaid">No pagado/);
  assert.match(html, /Sin vencimiento cargado/);
});

test('past expenses and paid bills are recognized only in their own month', () => {
  const app = application();
  assert.equal(app.status('edenor', '2026-10').paid, true);
  assert.equal(app.status('edenor', '2026-11').paid, false);
  assert.equal(app.status('aysa', '2026-11').paid, true);
  assert.equal(app.status('internet', '2026-11').paid, true);
  assert.equal(app.status('internet', '2026-12').paid, false);
  assert.equal(app.status('aysa', '2026-10').paid, false);
});

test('manual confirmation is stored per month without adding expenses or changing balances', async () => {
  const app = application(), transactions = JSON.stringify(app.state.transactions), bills = JSON.stringify(app.state.bills), balance = app.balance();
  await app.setPaid('gas', '2026-11', true);
  assert.equal(app.status('gas', '2026-11').paid, true);
  assert.equal(app.status('gas', '2026-10').paid, false);
  assert.equal(app.status('gas', '2026-12').paid, false);
  await app.setPaid('gas', '2026-10', true);
  await app.setPaid('gas', '2026-11', false);
  assert.equal(app.status('gas', '2026-10').paid, true);
  assert.equal(app.status('gas', '2026-11').paid, false);
  assert.equal(app.state.payeeMonths.length, 2);
  assert.equal(JSON.stringify(app.state.transactions), transactions);
  assert.equal(JSON.stringify(app.state.bills), bills);
  assert.equal(app.balance(), balance);
  const restored = await app.backup();
  app.load(restored);
  assert.equal(app.status('gas', '2026-10').paid, true);
  assert.equal(app.status('gas', '2026-11').paid, false);
});

test('manual save failures restore the previous monthly state and do not create a false paid status', async () => {
  const app = application(), before = JSON.stringify(app.state);
  app.setSave(async () => { throw Error('Sin conexión'); });
  await assert.rejects(app.setPaid('gas', '2026-11', true), /Sin conexión/);
  assert.equal(JSON.stringify(app.state), before);
  for (const args of [['missing', '2026-11', true], ['gas', '2026-13', true], ['gas', '2026-11', 'true']]) {
    await assert.rejects(app.setPaid(...args));
    assert.equal(JSON.stringify(app.state), before);
  }
});

test('paying a previous month uses the service period while the cash movement retains its real payment date', () => {
  const app = application();
  app.record(expense({ serviceMonth: '2026-10' }));
  assert.equal(app.status('gas', '2026-10').paid, true);
  assert.equal(app.status('gas', '2026-11').paid, false);
  assert.equal(app.state.transactions.at(-1).date, '2026-11-05');
  assert.equal(app.balance(), 840);
  const id = app.state.transactions.at(-1).id;
  app.record(expense({ serviceMonth: '2026-11' }), id);
  assert.equal(app.status('gas', '2026-10').paid, false);
  assert.equal(app.status('gas', '2026-11').paid, true);
  assert.equal(app.state.transactions.filter(t => t.id === id).length, 1);
  app.state.transactions = app.state.transactions.filter(t => t.id !== id);
  assert.equal(app.status('gas', '2026-11').paid, false);
});

test('a partial payment cannot make a known unpaid monthly invoice look fully paid', () => {
  const app = application();
  app.state.bills.push({ id: 'gas-bill', name: 'Gas', payeeId: 'gas', serviceMonth: '2026-11', amount: 100, due: '', paid: false });
  app.record(expense({ amount: 40 }));
  assert.equal(app.status('gas').paid, false);
  assert.match(app.status('gas').detail, /parcial/);
  app.record(expense({ amount: 60 }));
  assert.equal(app.status('gas').paid, true);
  assert.equal(app.state.bills.at(-1).paid, false);
});

test('income, transfers and unrelated or ambiguous descriptions cannot be mistaken for service payments', () => {
  const app = application();
  app.state.transactions.push({ kind: 'income', accountId: 'bank', payeeId: 'gas', date: '2026-11-03', amount: 10, description: 'Gas' });
  app.state.transactions.push({ kind: 'expense', accountId: 'bank', date: '2026-11-03', amount: 10, description: 'Gas comprado para otro domicilio' });
  assert.equal(app.status('gas').paid, false);
  app.state.transactions.push({ kind: 'expense', accountId: 'bank', date: '2026-11-03', amount: 10, description: 'GAS' });
  assert.equal(app.status('gas').paid, true);
  app.state.payees.push({ id: 'gas-duplicate', name: 'Gás', categoryId: 'services' });
  assert.equal(app.status('gas').paid, false);
  assert.equal(app.status('gas-duplicate').paid, false);
});

test('month navigation crosses a year boundary without changing recorded states', async () => {
  const app = application();
  await app.setPaid('gas', '2026-12', true);
  app.setMonth('2026-12');
  const before = JSON.stringify(app.state);
  await app.shift(1);
  assert.equal(app.month, '2027-01');
  assert.equal(app.status('gas').paid, false);
  await app.shift(-1);
  assert.equal(app.month, '2026-12');
  assert.equal(app.status('gas').paid, true);
  assert.equal(JSON.stringify(app.state), before);
});

test('status filters retain all totals while showing the chosen monthly rows', () => {
  const app = application();
  app.setFilter('unpaid');
  assert.doesNotMatch(app.table(), /<strong>Internet<\/strong>/);
  assert.match(app.table(), /<strong>Gas<\/strong>/);
  app.setFilter('paid');
  assert.match(app.table(), /<strong>Internet<\/strong>/);
  assert.doesNotMatch(app.table(), /<strong>Gas<\/strong>/);
});

test('monthly flags synchronize and reload through their own cloud collection without rewriting transactions', async () => {
  const app = application(), initial = plain(app.state), records = new Map(), writes = [];
  for (const [collection, items] of Object.entries(initial)) if (Array.isArray(items)) for (const item of items) if (item.id) records.set(`users/test-user/${collection}/${item.id}`, item);
  const api = {
    collection: (_, ...parts) => parts.join('/'), doc: (...parts) => parts.filter(p => typeof p === 'string').join('/'),
    serverTimestamp: () => 'test-time',
    getDoc: async () => ({ exists: () => true, data: () => ({ version: 1, members: ['Yo'] }) }),
    getDocs: async ref => {
      const items = [...records].filter(([name]) => name.startsWith(ref + '/')).map(([name, data]) => ({ id: name.split('/').at(-1), data: () => structuredClone(data) }));
      return { empty: !items.length, docs: items };
    },
    writeBatch: () => {
      const ops = [];
      return { set: (ref, data) => ops.push({ ref, data: plain(data) }), delete: () => { throw Error('Unexpected deletion'); }, commit: async () => { for (const op of ops) { records.set(op.ref, op.data); writes.push(op); } } };
    }
  };
  app.cloud({ db: {}, dbApi: api });
  await app.setPaid('gas', '2026-11', true);
  assert.equal(writes.filter(w => w.ref.includes('/payeeMonths/')).length, 1);
  assert.equal(writes.filter(w => w.ref.includes('/transactions/') || w.ref.includes('/accounts/')).length, 0);
  assert.equal(JSON.parse(app.snapshot().payeeMonths['pm-gas-2026-11']).paid, true);
  await app.reloadCloud();
  assert.equal(app.status('gas', '2026-11').paid, true);
  assert.equal(app.status('gas', '2026-12').paid, false);
  assert.deepEqual(plain(app.state.transactions), initial.transactions);
});
