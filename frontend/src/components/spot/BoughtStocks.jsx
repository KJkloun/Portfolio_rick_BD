import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';

function BoughtStocks() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoughtStocks();
  }, [currentPortfolio, refreshTrigger]);

  const fetchBoughtStocks = async () => {
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

      const boughtStocks = transformed
        .filter(tx => tx.transactionType === 'BUY')
        .sort((a, b) => new Date(b.tradeDate) - new Date(a.tradeDate));

      setTransactions(boughtStocks);
    } catch (error) {
      console.error('Error fetching bought stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  const totalAmount = transactions.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
  const uniqueStocks = [...new Set(transactions.map(tx => tx.ticker))].length;
  const avgAmount = transactions.length ? totalAmount / transactions.length : 0;

  if (loading) {
    return (
      <SpotPageShell title="Купленные позиции" subtitle="Загрузка данных..." badge="Spot портфель">
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-800"></div>
        </div>
      </SpotPageShell>
    );
  }

  return (
    <SpotPageShell
      title="Купленные позиции"
      subtitle="Все операции покупки в хронологическом порядке"
      badge="Spot портфель"
    >

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Metric label="Всего операций" value={transactions.length} tone="slate" />
        <Metric label="Уникальных тикеров" value={uniqueStocks} tone="emerald" />
        <Metric label="Общая сумма" value={formatCurrency(totalAmount)} tone="indigo" />
        <Metric label="Средняя сумма" value={formatCurrency(avgAmount)} tone="amber" />
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">История покупок</h2>
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
                <Th align="right">Сумма</Th>
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
                  <Td align="right" className="text-rose-600 font-semibold">
                    {formatCurrency(Math.abs(transaction.amount))}
                  </Td>
                  <Td className="max-w-xs truncate text-slate-600">{transaction.note}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-slate-600 text-lg">Нет операций покупки</div>
            <p className="text-slate-400 mt-2">
              <Link to="/spot" className="text-indigo-600 hover:text-indigo-700">
                Добавьте операции покупки
              </Link>
            </p>
          </div>
        )}
      </div>
    </SpotPageShell>
  );
}

export default BoughtStocks; 

function Metric({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  const toneClass = tones[tone] || tones.slate;
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 p-4">
      <div className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${toneClass}`}>{label}</div>
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
