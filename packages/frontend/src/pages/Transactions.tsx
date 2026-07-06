import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import './Transactions.css';

const REASON_LABELS: Record<string, string> = {
  contract_payment:     'Contract Payment',
  wage:                 'Wages',
  hire_cost:            'Hire Cost',
  property_build:       'Property Built',
  property_maintenance: 'Maintenance',
  penalty:              'Penalty',
  starting_gold:        'Starting Capital',
  admin_adjustment:     'Admin Adjustment',
};

export default function Transactions() {
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');

  const { data: playerData } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions.list(200, 0),
  });

  const gold = playerData?.player.gold ?? 0;
  const transactions = data?.transactions ?? [];
  const total = data?.total ?? 0;

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter(tx => filter === 'income' ? tx.amount > 0 : tx.amount < 0);

  const totalIncome  = transactions.filter(tx => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0);
  const totalExpense = transactions.filter(tx => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0);

  return (
    <div className="transactions-page">
      <div className="page-header">
        <h1>Financial Ledger</h1>
        <span className="label">All guild transactions</span>
      </div>

      <div className="ledger-summary panel">
        <div className="ledger-summary-grid">
          <div className="ls-item">
            <span className="label">Current Balance</span>
            <span className="currency" style={{ fontSize: '1.8rem', fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
              {gold.toLocaleString()} gp
            </span>
          </div>
          <div className="ls-item">
            <span className="label">Total Income</span>
            <span className="currency positive">{totalIncome.toLocaleString()} gp</span>
          </div>
          <div className="ls-item">
            <span className="label">Total Expenses</span>
            <span className="currency negative">{Math.abs(totalExpense).toLocaleString()} gp</span>
          </div>
          <div className="ls-item">
            <span className="label">Transactions</span>
            <span className="value">{total}</span>
          </div>
        </div>
      </div>

      <div className="ledger-filters panel panel-sm">
        {(['all', 'income', 'expense'] as const).map(f => (
          <button
            key={f}
            className={`tier-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && ` (${transactions.filter(tx => f === 'income' ? tx.amount > 0 : tx.amount < 0).length})`}
          </button>
        ))}
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="empty-state">Loading ledger…</div>
        ) : (
          <table className="ledger-table">
            <thead>
              <tr>
                <th className="label">Date</th>
                <th className="label">Description</th>
                <th className="label">Category</th>
                <th className="label text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => (
                <tr key={tx.id} className="ledger-table-row">
                  <td className="tx-date label">
                    {new Date(tx.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </td>
                  <td className="tx-desc">{tx.description}</td>
                  <td>
                    <span className="tx-category">{REASON_LABELS[tx.reason] ?? tx.reason}</span>
                  </td>
                  <td className={`tx-amount text-right ${tx.amount > 0 ? 'currency positive' : 'currency negative'}`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} gp
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="empty-state">No transactions found.</div>
        )}
      </div>
    </div>
  );
}
