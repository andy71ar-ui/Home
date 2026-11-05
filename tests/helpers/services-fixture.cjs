module.exports = () => ({
  version: 1, members: ['Yo'],
  accounts: [{ id: 'bank', name: 'Banco Nación', opening: 1000, type: 'bank', color: '#2073ad' }],
  expenseCategories: [{ id: 'services', name: 'Servicios' }],
  payees: [
    { id: 'edenor', name: 'Edenor', categoryId: 'services' },
    { id: 'aysa', name: 'AySA', categoryId: 'services' },
    { id: 'internet', name: 'Internet', categoryId: 'services' },
    { id: 'gas', name: 'Gas', categoryId: 'services' }
  ],
  transactions: [
    { id: 'october', kind: 'expense', accountId: 'bank', payeeId: 'edenor', expenseCategoryId: 'services', date: '2026-10-10', amount: 100, description: 'Edenor' },
    { id: 'november', kind: 'expense', accountId: 'bank', payeeId: 'internet', expenseCategoryId: 'services', date: '2026-11-03', amount: 50, description: 'Internet' }
  ],
  bills: [{ id: 'water', name: 'AySA', payeeId: 'aysa', expenseCategoryId: 'services', amount: 20, due: '2026-11-10', paid: true }],
  cards: [], charges: [], statements: [], loans: []
});
