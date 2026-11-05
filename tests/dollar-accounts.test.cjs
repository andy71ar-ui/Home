const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const fixture = require('./helpers/dollar-fixture.cjs');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
  .replace(/^import \* as pdfjs.*\r?\n/m, '')
  .replace(/^pdfjs\.GlobalWorkerOptions.*\r?\n/m, '')
  .replace(/^bootAuth\(\);/m, '');

function application(data = fixture()) {
  const alerts = [];
  const nodes = new Map(['lock', 'month', 'add-main', 'nav', 'connection-status', 'view']
    .map(id => ['#' + id, {}]));
  const context = vm.createContext({
    TextEncoder, TextDecoder, URLSearchParams, crypto: webcrypto, btoa, atob,
    location: { hostname: 'localhost', search: '?local=1' }, navigator: {}, confirm: () => true, alert: message => alerts.push(message),
    FormData: class { constructor(form) { return Object.entries(form.data); } },
    document: { querySelector: selector => nodes.get(selector) || null, addEventListener() {} }
  });
  vm.runInContext(source + `
    render=()=>{};toast=()=>{};close=()=>{};save=async()=>{};
    const actualSubmit=submit;
    let lastModal=null,handler=null;
    modal=(title,body)=>{lastModal={title,body};globalThis.makeForm()};
    submit=fn=>{handler=fn};
    globalThis.app={
      load(data){state=normalizeState(data);selectedMonth='2026-11';view='inicio'},
      get state(){return state},get modal(){return lastModal},
      balance(id){return accountBalanceThrough(byId(state.accounts,id))},
      due(month='2026-11'){return dueForCard(state.cards[0],month)},
      record(data,id){recordTransaction(data,byId(state.transactions,id)||{})},
      setView(value){view=value},setMonth(value){selectedMonth=value},
      renderHome,renderDollarHome,renderTransactions,renderCards,dueItems,
      options(currency){return accountOptions('',false,true,currency)},
      rows(){return getTransactionRows()},snapshot(){return cloudSnapshot(state)},
      async delete(id){wire();await $('#view').onclick({target:{closest:()=>({dataset:{deleteTx:id}})}})},
      toggleStatementCarryForward,openCardPayment,
      saveForm(data){handler(data)},
      async trySave(data,fail){
        globalThis.makeSubmission(data);
        save=async()=>{if(fail)throw Error('Error de conexión de prueba')};
        actualSubmit(d=>recordTransaction(d));
        await $('#edit-form').onsubmit({preventDefault(){},target:$('#edit-form')});
      },
      async backup(){const s=crypto.getRandomValues(new Uint8Array(16)),k=await derive('test-only-password',s);return (await unlocked(await encrypted(state,k,s),'test-only-password')).data}
    };
  `, context);
  context.makeForm = () => nodes.set('#edit-form', {
    elements: { kind: { value: 'card_payment' }, description: { value: '' }, accountId: { closest: () => ({ firstChild: {} }) } },
    querySelector: () => ({ innerHTML: '' })
  });
  context.makeSubmission = data => nodes.set('#edit-form', { data });
  context.app.load(data);
  return { app: context.app, nodes, alerts };
}

function payment(amount, overrides = {}) {
  return { kind: 'card_payment', currency: 'USD', accountId: 'usd-nacion', cardId: 'visa', statementMonth: '2026-11', date: '2026-11-04', amount, description: '', member: 'Yo', ...overrides };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('three separate dollar accounts preserve legacy dollar balances once and leave peso balances unchanged', async () => {
  const { app } = application();
  assert.deepEqual(plain(app.state.accounts.filter(a => a.currency === 'USD').map(a => [a.name, a.opening])), [
    ['Banco Nación', 1250.5], ['Santander', 0], ['ICBC', 100]
  ]);
  assert.equal(app.balance('nacion'), 1080);
  assert.equal(app.balance('usd-nacion'), 1250.5);
  assert.equal(app.state.accounts.find(a => a.id === 'nacion').usdOpening, 0);
  const before = JSON.stringify(app.state);
  app.load(app.state);
  assert.equal(JSON.stringify(app.state), before);
  const restored = await app.backup();
  app.load(restored);
  assert.equal(JSON.stringify(app.state), before);
  assert.equal(JSON.parse(app.snapshot().accounts['usd-nacion']).currency, 'USD');
  app.state.accounts.find(a => a.id === 'usd-nacion').name = 'Mi ahorro';
  app.load(app.state);
  assert.equal(app.state.accounts.filter(a => a.currency === 'USD').length, 3);
});

test('legacy dollars in two different Nación accounts are retained in distinct dollar accounts', () => {
  const data = fixture();
  data.accounts.unshift({ id: 'old-nacion', name: 'Banco Nación (viejo)', opening: 12, usdOpening: 22 });
  const { app } = application(data);
  assert.equal(app.balance('usd-nacion'), 1250.5);
  assert.equal(app.balance('usd-old-nacion'), 22);
  assert.equal(app.balance('old-nacion'), 12);
  app.load(app.state);
  assert.equal(app.balance('usd-old-nacion'), 22);
});

test('partial and full dollar card payments only reduce USD debt, and the statement is paid when both currencies are settled', () => {
  const { app } = application();
  app.record(payment(20));
  assert.equal(app.due().paid, 20);
  assert.equal(app.due().usdPaid, 20);
  assert.equal(app.due().remaining, 480);
  assert.equal(app.due().usdRemaining, 30);
  assert.equal(app.balance('usd-nacion'), 1230.5);
  assert.equal(app.balance('nacion'), 1080);
  assert.equal(app.due('2026-12').usdRemaining, 10);
  app.record(payment(30));
  assert.equal(app.due().usdRemaining, 0);
  assert.equal(app.dueItems().find(d => d.id === 'november').paid, false);
  app.record(payment(480, { currency: 'ARS', accountId: 'nacion' }));
  assert.equal(app.due().remaining, 0);
  assert.equal(app.dueItems().find(d => d.id === 'november').paid, true);
  assert.match(app.renderCards(), /class="badge paid">Pagado/);
  assert.equal(app.balance('nacion'), 600);
  assert.equal(app.balance('usd-nacion'), 1200.5);
});

test('editing and deleting a dollar payment restores the correct account and statement without duplication', async () => {
  const { app } = application();
  app.record(payment(20));
  const id = app.state.transactions.at(-1).id;
  app.record(payment(5, { accountId: 'usd-icbc', statementMonth: '2026-12' }), id);
  assert.equal(app.state.transactions.length, 3);
  assert.equal(app.balance('usd-nacion'), 1250.5);
  assert.equal(app.balance('usd-icbc'), 95);
  assert.equal(app.due().usdRemaining, 50);
  assert.equal(app.due('2026-12').usdRemaining, 5);
  await app.delete(id);
  assert.equal(app.balance('usd-icbc'), 100);
  assert.equal(app.due('2026-12').usdRemaining, 10);
  assert.equal(app.balance('nacion'), 1080);
});

test('dollar transfers preserve the combined balance and edits replace both linked entries', () => {
  const { app } = application();
  const transfer = payment(40, { kind: 'transfer_out', toAccountId: 'usd-icbc' });
  app.record(transfer);
  const id = app.state.transactions.at(-2).id, linked = app.state.transactions.at(-1).id;
  assert.equal(app.balance('usd-nacion'), 1210.5);
  assert.equal(app.balance('usd-icbc'), 140);
  app.record({ ...transfer, amount: 10 }, linked);
  assert.equal(app.state.transactions.filter(t => t.id === id || t.linkedId === id).length, 2);
  assert.equal(app.balance('usd-nacion'), 1240.5);
  assert.equal(app.balance('usd-icbc'), 110);
  assert.equal(app.due().usdRemaining, 50);
});

test('invalid currency combinations fail before modifying transactions or balances', () => {
  const { app } = application(), before = JSON.stringify(app.state);
  for (const invalid of [
    payment(10, { accountId: 'nacion' }),
    payment(10, { kind: 'transfer_out', toAccountId: 'icbc' }),
    payment(10, { kind: 'cash_withdrawal' }),
    payment(10, { kind: 'loan_payment' }),
    payment(10, { currency: 'EUR' }),
    payment(10, { statementMonth: '' }),
    payment(0.001)
  ]) {
    assert.throws(() => app.record(invalid));
    assert.equal(JSON.stringify(app.state), before);
  }
});

test('decimal dollar payments settle exactly and carrying a summary only carries its unpaid dollars', async () => {
  const { app } = application();
  app.record(payment(20));
  await app.toggleStatementCarryForward('november');
  assert.equal(app.due().carriedUsdAmount, 30);
  assert.equal(app.due().usdRemaining, 0);
  assert.equal(app.balance('usd-nacion'), 1230.5);
  await app.toggleStatementCarryForward('november');
  assert.equal(app.due().usdRemaining, 30);
  app.state.statements[0].usdAmount = 20.3;
  app.record(payment(0.1));app.record(payment(0.2));
  assert.equal(app.due().usdRemaining, 0);
  assert.equal(app.due().usdPaid, 20.3);
});

test('dollar summary, histories and account filters stay separate from pesos', () => {
  const { app, nodes } = application();
  app.record(payment(20, { description: 'Pago USD separado' }));
  app.record(payment(10, { kind: 'income', expenseCategoryId: 'other', description: 'Ingreso USD separado' }));
  assert.doesNotMatch(app.renderHome(), /Pago USD separado|Ingreso USD separado|US\$/);
  assert.match(app.renderDollarHome(), /Ingreso USD separado/);
  assert.doesNotMatch(app.renderDollarHome(), /Ingreso de prueba en pesos|Pago previo en pesos/);
  app.setView('movimientos');
  assert.doesNotMatch(app.renderTransactions(), /Pago USD separado/);
  assert.equal(app.rows().length, 2);
  app.setView('movimientos-usd');
  assert.match(app.renderTransactions(), /Pago USD separado/);
  assert.doesNotMatch(app.renderTransactions(), /Ingreso de prueba en pesos/);
  assert.equal(app.rows().length, 2);
  nodes.set('#filter-search', { value: 'pago usd' });
  assert.equal(app.rows().length, 1);
  assert.doesNotMatch(app.options('USD'), /value="nacion"/);
  assert.doesNotMatch(app.options('ARS'), /value="usd-nacion"/);
});

test('card payment form preselects the dollar bank, pending amount and statement month', () => {
  const { app } = application();
  app.openCardPayment('visa', 'USD');
  assert.match(app.modal.title, /dólares/);
  assert.match(app.modal.body, /Importe en dólares/);
  assert.match(app.modal.body, /name="amount" value="50"/);
  assert.match(app.modal.body, /value="usd-nacion" selected/);
  assert.doesNotMatch(app.modal.body, /option value="nacion"/);
  // The month stays the one selected when the form was opened.
  app.setMonth('2026-12');
  app.saveForm(payment(50));
  assert.equal(app.due('2026-11').usdRemaining, 0);
  assert.equal(app.due('2026-12').usdRemaining, 10);
});

test('failed cloud saves roll back the payment so retrying cannot double the dollar debit', async () => {
  const { app, alerts } = application(), before = JSON.stringify(app.state);
  await app.trySave(payment(20), true);
  assert.equal(JSON.stringify(app.state), before);
  assert.match(alerts[0], /conexión/);
  await app.trySave(payment(20), false);
  assert.equal(app.state.transactions.length, 3);
  assert.equal(app.balance('usd-nacion'), 1230.5);
  assert.equal(app.due().usdRemaining, 30);
});
