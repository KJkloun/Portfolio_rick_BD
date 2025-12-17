import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';

function SoldStocks() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSoldStocks();
  }, [currentPortfolio, refreshTrigger]);

  const fetchSoldStocks = async () => {
    if (!currentPortfolio?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get('/api/spot-transactions', {
        headers: {
          'X-Portfolio-ID': currentPortfolio.id
        }
      });
      const data = response.data;
      const transformed = Array.isArray(data) ? data.map(tx => ({
        ...tx,
        tradeDate: tx.transactionDate || tx.tradeDate,
        totalAmount: tx.amount || tx.totalAmount
      })) : [];

      const soldStocks = transformed
        .filter(tx => tx.transactionType === 'SELL')
        .sort((a, b) => new Date(b.tradeDate) - new Date(a.tradeDate));

      setTransactions(soldStocks);
    } catch (error) {
      console.error('Error fetching sold stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const uniqueStocks = [...new Set(transactions.map(tx => tx.ticker))].length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#9333ea]"></div>
      </div>
    );
  }

  const avgAmount = transactions.length > 0 ? totalAmount / transactions.length : 0;

  return (
    <SpotPageShell
      title="Проданные позиции"
      subtitle="Все операции продажи в хронологическом порядке"
      badge="Spot портфель"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Всего операций" value={transactions.length} tone="slate" />
        <StatCard label="Уникальных тикеров" value={uniqueStocks} tone="amber" />
        <StatCard label="Общая выручка" value={formatCurrency(totalAmount)} tone="emerald" />
        <StatCard label="Средняя выручка" value={formatCurrency(avgAmount)} tone="indigo" />
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">История продаж</h2>
            <p className="text-sm text-slate-500">Детальная информация по каждой операции</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full spot-table">
            <thead className="bg-slate-50">
              <tr>
                <Th>№</Th>
                <Th>Дата</Th>
                <Th>Компания</Th>
                <Th>Тикер</Th>
                <Th align="right">Цена</Th>
                <Th align="right">Кол-во</Th>
                <Th align="right">Выручка</Th>
                <Th>Примечание</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {transactions.map((transaction, index) => (
                <tr key={transaction.id} className="hover:bg-slate-50/60 transition-colors">
                  <Td>{transactions.length - index}</Td>
                  <Td>{new Date(transaction.tradeDate).toLocaleDateString('ru-RU')}</Td>
                  <Td>{transaction.company}</Td>
                  <Td className="font-semibold text-slate-800">
                    <Link to={`/spot/ticker/${transaction.ticker}`} className="hover:text-slate-900">
                      {transaction.ticker}
                    </Link>
                  </Td>
                  <Td align="right">{formatCurrency(transaction.price)}</Td>
                  <Td align="right">{transaction.quantity.toLocaleString('ru-RU')}</Td>
                  <Td align="right" className="text-emerald-600 font-semibold">
                    {formatCurrency(transaction.amount)}
                  </Td>
                  <Td className="max-w-xs truncate text-slate-600">{transaction.note}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-slate-600 text-lg">Нет операций продажи</div>
            <p className="text-slate-400 mt-2">
              <Link to="/spot" className="text-indigo-600 hover:text-indigo-700">
                Добавьте операции продажи
              </Link>
            </p>
          </div>
        )}
      </div>
    </SpotPageShell>
  );
}

export default SoldStocks; 

function StatCard({ label, value, tone }) {
  const tones = {
    slate: 'bg-slate-900 text-white',
    amber: 'bg-amber-500 text-white',
    emerald: 'bg-emerald-500 text-white',
    indigo: 'bg-indigo-500 text-white',
  };
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 p-4">
      <div className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold ${tones[tone] || tones.slate}`}>
        {label}
      </div>
      <div className="mt-3 text-2xl number-unified">{value}</div>
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th className={`px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  return (
    <td className={`px-6 py-4 text-sm text-slate-800 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  );
}
