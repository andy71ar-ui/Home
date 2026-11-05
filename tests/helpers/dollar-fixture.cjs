module.exports = () => ({
  version: 1, members: ['Yo'],
  accounts: [
    { id: 'nacion', name: 'Banco Nación (nuevo)', type: 'bank', opening: 1000, usdOpening: 1250.50, color: '#2073ad' },
    { id: 'santander', name: 'Santander', type: 'bank', opening: 2000, color: '#db323e' },
    { id: 'icbc', name: 'ICBC', type: 'bank', opening: 3000, usdOpening: 100, color: '#8065b2' }
  ],
  expenseCategories: [{ id: 'other', name: 'Otros' }], payees: [],
  cards: [{ id: 'visa', name: 'Visa Nación', accountId: 'nacion' }],
  transactions: [
    { id: 'income-ars', kind: 'income', accountId: 'nacion', date: '2026-11-01', amount: 100, description: 'Ingreso de prueba en pesos' },
    { id: 'payment-ars', kind: 'card_payment', accountId: 'nacion', cardId: 'visa', statementMonth: '2026-11', date: '2026-11-02', amount: 20, description: 'Pago previo en pesos' }
  ],
  statements: [
    { id: 'november', cardId: 'visa', month: '2026-11', amount: 500, usdAmount: 50, due: '2026-11-15' },
    { id: 'december', cardId: 'visa', month: '2026-12', amount: 700, usdAmount: 10, due: '2026-12-15' }
  ],
  charges: [{ id: 'future', cardId: 'visa', month: '2026-12', amount: 30, usdAmount: 5, description: 'Consumo futuro' }],
  bills: [], loans: []
});
