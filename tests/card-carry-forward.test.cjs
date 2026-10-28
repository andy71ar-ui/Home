const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Run the application logic with a minimal DOM and no authentication or network.
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
  .replace(/^import \* as pdfjs.*\r?\n/m, '')
  .replace(/^pdfjs\.GlobalWorkerOptions.*\r?\n/m, '')
  .replace(/^bootAuth\(\);/m, '');

function fixture() {
  return {
    accounts: [{ id: 'bank', name: 'Banco', opening: 1000 }],
    cards: [{ id: 'visa', name: 'Visa', accountId: 'bank' }],
    members: ['Yo'], bills: [], loans: [], charges: [],
    transactions: [{ id: 'payment', kind: 'card_payment', cardId: 'visa',
      statementMonth: '2026-09', date: '2026-09-10', accountId: 'bank', amount: 100 }],
    statements: [
      { id: 'previous', cardId: 'visa', month: '2026-09', amount: 500, usdAmount: 20, due: '2026-09-15' },
      { id: 'current', cardId: 'visa', month: '2026-10', amount: 700, usdAmount: 30, due: '2026-10-15' }
    ]
  };
}

function application(data = fixture()) {
  const nodes = new Map();
  for (const id of ['lock', 'month', 'add-main', 'nav', 'connection-status', 'view']) nodes.set(`#${id}`, {});
  const alerts = [], saved = [];
  const context = vm.createContext({
    TextEncoder, TextDecoder, URLSearchParams, crypto: webcrypto, btoa, atob,
    location: { hostname: 'localhost', search: '?local=1' }, navigator: {},
    document: { querySelector: selector => nodes.get(selector) || null, addEventListener() {} },
    alert: message => alerts.push(message)
  });
  vm.runInContext(source + `
    render=()=>{}; toast=()=>{};
    let lastModal=null;
    modal=(title,body)=>{lastModal={title,body}};
    globalThis.app={
      load(data,month='2026-09'){state=normalizeState(data);selectedMonth=month},
      get state(){return state},
      dueForCard, dueItems, dueIsPending, dueStatus, dueBadge,
      renderCards, renderHome, renderDues, toggleStatementCarryForward,
      get lastModal(){return lastModal},
      async clickCarriedStatements(){wire();const button={dataset:{viewCarriedStatements:'1'}};
        await $('#view').onclick({target:{closest:()=>button}})},
      setSave(fn){save=fn},
      setFilter(filter){dueStatusFilter=filter},
      async clickCarryForward(id){wire();const button={dataset:{carryStatement:id}};
        await $('#view').onclick({target:{closest:()=>button}})},
      balance(){return accountBalanceThrough(state.accounts[0])},
      snapshot(){return cloudSnapshot(state)},
      async backupRoundTrip(){const s=crypto.getRandomValues(new Uint8Array(16));
        const key=await derive('test-password-only',s);
        return (await unlocked(await encrypted(state,key,s),'test-password-only')).data}
    };
  `, context);
  const app = context.app;
  app.load(data);
  app.setSave(async () => saved.push(JSON.parse(JSON.stringify(app.state))));
  return { app, alerts, saved };
}

test('carrying a partially paid summary closes the old debt without recording a payment or duplicating the next summary', async () => {
  const { app, saved } = application();
  const before = JSON.stringify(app.state), balance = app.balance();
  assert.match(app.renderCards(), /data-carry-statement="previous"/);
  await app.clickCarryForward('previous');
  const d = app.dueForCard(app.state.cards[0]);
  assert.equal(d.total, 500);
  assert.equal(d.paid, 100);
  assert.equal(d.carriedAmount, 400);
  assert.equal(d.carriedUsdAmount, 20);
  assert.equal(d.remaining, 0);
  assert.equal(d.usdRemaining, 0);
  assert.equal(app.balance(), balance);
  const expected = JSON.parse(before);
  expected.statements[0].carriedForward = true;
  assert.deepEqual(JSON.parse(JSON.stringify(app.state)), expected);
  assert.deepEqual(saved, [expected]);
  assert.match(app.renderCards(), /Pasó al resumen siguiente/);
  assert.match(app.renderCards(), /Pasó al resumen siguiente<\/strong><strong class="carried-amount">[^<]*400,00[^<]*20,00/);
  assert.match(app.renderCards(), /Deshacer pase/);
});

test('carried summaries are neither pending nor paid and stay out of dashboard reminders and debt totals', async () => {
  const { app } = application();
  await app.toggleStatementCarryForward('previous');
  const dues = app.dueItems(), previous = dues.find(d => d.id === 'previous');
  assert.equal(previous.paid, false);
  assert.equal(app.dueStatus(previous), 'carried');
  assert.equal(app.dueIsPending(previous), false);
  assert.equal(dues.filter(app.dueIsPending).length, 1);
  assert.equal(dues.filter(app.dueIsPending).reduce((sum, d) => sum + d.amount, 0), 700);
  assert.equal(dues.filter(app.dueIsPending).reduce((sum, d) => sum + d.usdAmount, 0), 30);
  assert.match(app.dueBadge(previous), /Pasó al resumen siguiente/);
  assert.doesNotMatch(app.dueBadge(previous), /Pagado|Vencido/);
  assert.doesNotMatch(app.renderHome(), /Resumen septiembre/);
  assert.match(app.renderDues(), /Vencimientos pendientes<\/span><strong>1<\/strong>/);
  assert.match(app.renderDues(), /class="carried-amount">[^<]*400,00[^<]*20,00/);
  app.setFilter('paid');
  assert.doesNotMatch(app.renderDues(), /Resumen septiembre/);
  app.setFilter('carried');
  assert.match(app.renderDues(), /Resumen septiembre/);
});

test('undo restores the unpaid pesos and dollars while keeping the actual partial payment', async () => {
  const { app } = application();
  await app.toggleStatementCarryForward('previous');
  await app.toggleStatementCarryForward('previous');
  const d = app.dueForCard(app.state.cards[0]);
  assert.equal(d.carriedForward, false);
  assert.equal(d.carriedAmount, 0);
  assert.equal(d.carriedUsdAmount, 0);
  assert.equal(d.remaining, 400);
  assert.equal(d.usdRemaining, 20);
  assert.equal(d.paid, 100);
  assert.equal(app.dueItems().filter(app.dueIsPending).length, 2);
});

test('unpaid summaries in pesos only or dollars only can be carried even without a due date or next summary', async () => {
  for (const [amount, usdAmount] of [[500, 0], [0, 20]]) {
    const data = fixture();
    data.transactions = [];
    data.statements = [{ ...data.statements[0], amount, usdAmount, due: '' }];
    const { app } = application(data);
    assert.match(app.renderCards(), /data-carry-statement="previous"/);
    await app.toggleStatementCarryForward('previous');
    assert.equal(app.state.statements.length, 1);
    assert.equal(app.state.transactions.length, 0);
    assert.equal(app.dueForCard(app.state.cards[0]).remaining, 0);
    assert.equal(app.dueForCard(app.state.cards[0]).usdRemaining, 0);
    assert.equal(app.dueForCard(app.state.cards[0]).carriedAmount, amount);
    assert.equal(app.dueForCard(app.state.cards[0]).carriedUsdAmount, usdAmount);
  }
});

test('already paid summaries and cards with no summary do not offer or create a carry', async () => {
  const data = fixture();
  data.statements[0].amount = 100;
  data.statements[0].usdAmount = 0;
  const { app, saved } = application(data);
  assert.doesNotMatch(app.renderCards(), /data-carry-statement=/);
  await app.toggleStatementCarryForward('previous');
  await app.toggleStatementCarryForward('missing');
  assert.equal(saved.length, 0);
  app.state.statements = [];
  assert.doesNotMatch(app.renderCards(), /data-carry-statement=/);
});

test('save failures restore the original carry state and leave balances and transactions intact', async () => {
  const { app, alerts } = application();
  const before = JSON.stringify(app.state);
  app.setSave(async () => { throw Error('Sin conexión'); });
  await app.toggleStatementCarryForward('previous');
  assert.equal(JSON.stringify(app.state), before);
  assert.match(alerts[0], /No se pudo guardar el cambio/);
  app.state.statements[0].carriedForward = true;
  await app.toggleStatementCarryForward('previous');
  assert.equal(app.state.statements[0].carriedForward, true);
});

test('the carry state survives encrypted backups, normalization and cloud serialization across a year change', async () => {
  const data = fixture();
  data.statements[0].month = '2026-12';
  const { app } = application(data);
  app.load(app.state, '2026-12');
  await app.toggleStatementCarryForward('previous');
  assert.match(app.renderCards(), /enero de 2027/);
  assert.equal(JSON.parse(app.snapshot().statements.previous).carriedForward, true);
  const restored = await app.backupRoundTrip();
  app.load(restored, '2026-12');
  assert.equal(app.dueForCard(app.state.cards[0]).carriedForward, true);
  assert.equal(app.dueItems().find(d => d.id === 'previous').paid, false);
});

test('carry history shows only carried summaries across months and cards, deducts real payments and preserves state', async () => {
  const data = fixture();
  data.statements[0].carriedForward = true;
  data.cards.push({ id: 'master', name: 'Master de baja', accountId: 'bank', active: false });
  data.statements.push({ id: 'year-end', cardId: 'master', month: '2026-12', amount: 900,
    usdAmount: 0, due: '', carriedForward: true });
  const { app, saved } = application(data);
  app.load(app.state, '2026-10');
  const before = JSON.stringify(app.state);
  await app.clickCarriedStatements();
  const { title, body } = app.lastModal;
  assert.equal(title, 'Ver lo que pasó al resumen siguiente');
  assert.match(body, /Visa/);
  assert.match(body, /Resumen de septiembre de 2026/);
  assert.match(body, /Pasó al resumen de octubre de 2026/);
  assert.match(body, /400,00/);
  assert.match(body, /20,00/);
  assert.match(body, /Importe que pasó<\/small><strong class="carried-amount">[^<]*400,00[^<]*20,00/);
  assert.doesNotMatch(body, /500,00|700,00|30,00/);
  assert.match(body, /Master de baja/);
  assert.match(body, /Pasó al resumen de enero de 2027/);
  assert.ok(body.indexOf('Master de baja') < body.indexOf('Visa'));
  assert.equal(JSON.stringify(app.state), before);
  assert.equal(saved.length, 0);
});

test('carry history explains when no summaries are marked and removes undone entries', async () => {
  const { app } = application();
  await app.clickCarriedStatements();
  assert.match(app.lastModal.body, /Todavía no marcaste ningún resumen/);
  await app.toggleStatementCarryForward('previous');
  await app.clickCarriedStatements();
  assert.match(app.lastModal.body, /Resumen de septiembre de 2026/);
  await app.toggleStatementCarryForward('previous');
  await app.clickCarriedStatements();
  assert.match(app.lastModal.body, /Todavía no marcaste ningún resumen/);
});
