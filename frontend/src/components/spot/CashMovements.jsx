import { useState, useEffect } from 'react';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';

function CashMovements() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactions();
  }, [currentPortfolio, refreshTrigger]);

  const fetchTransactions = async () => {
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

      // Filter only cash movement transactions and sort by date (newest first)
      const cashMovements = transformed
        .filter(tx => ['DEPOSIT', 'WITHDRAW', 'DIVIDEND'].includes(tx.transactionType))
        .sort((a, b) => new Date(b.tradeDate) - new Date(a.tradeDate));

      setTransactions(cashMovements);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate cash flow statistics
  const totalDeposits = transactions
    .filter(tx => tx.transactionType === 'DEPOSIT')
    .reduce((sum, tx) => sum + (tx.totalAmount ?? tx.price * tx.quantity), 0);

  const totalWithdrawals = transactions
    .filter(tx => tx.transactionType === 'WITHDRAW')
    .reduce((sum, tx) => sum + Math.abs(tx.totalAmount ?? tx.price * tx.quantity), 0);

  const totalDividends = transactions
    .filter(tx => tx.transactionType === 'DIVIDEND')
    .reduce((sum, tx) => sum + (tx.totalAmount ?? tx.price * tx.quantity), 0);

  const netCashFlow = totalDeposits + totalDividends - totalWithdrawals;

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  const getMovementType = (transactionType) => {
    switch (transactionType) {
      case 'DEPOSIT':
        return {
          label: 'Пополнение',
          color: 'text-green-600',
          description: 'Поступление средств на счет'
        };
      case 'WITHDRAW':
        return {
          label: 'Снятие',
          color: 'text-red-600',
          description: 'Снятие средств со счета'
        };
      case 'DIVIDEND':
        return {
          label: 'Дивиденды',
          color: 'text-purple-600',
          description: 'Дивидендные выплаты'
        };
      default:
        return {
          label: transactionType,
          color: 'text-gray-600',
          description: 'Прочие операции'
        };
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <SpotPageShell
      title="Движение наличных"
      subtitle="Пополнения, снятия и дивиденды"
      badge="Spot портфель"
    >

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Всего пополнений" value={formatCurrency(totalDeposits)} tone="emerald" />
        <Stat label="Всего снятий" value={formatCurrency(totalWithdrawals)} tone="rose" />
        <Stat label="Дивиденды" value={formatCurrency(totalDividends)} tone="indigo" />
        <Stat label="Чистый поток" value={formatCurrency(netCashFlow)} tone={netCashFlow >=0 ? 'emerald' : 'rose'} />
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">История движений</h3>
          <p className="text-sm text-slate-500">Пополнения, снятия, дивиденды</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 spot-table">
            <thead className="bg-slate-50">
              <tr>
                <Th>Дата</Th>
                <Th>Тип операции</Th>
                <Th>Описание</Th>
                <Th align="right">Сумма</Th>
                <Th>Примечание</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {transactions.map((transaction) => {
                const movementType = getMovementType(transaction.transactionType);
                const amount = transaction.totalAmount ?? (transaction.price * transaction.quantity);
                const isPositive = transaction.transactionType === 'DEPOSIT' || transaction.transactionType === 'DIVIDEND';
                
                return (
                  <tr key={transaction.id} className="hover:bg-slate-50/60 transition-colors">
                    <Td>{new Date(transaction.tradeDate).toLocaleDateString('ru-RU')}</Td>
                    <Td className={`font-semibold ${movementType.color}`}>{movementType.label}</Td>
                    <Td>
                      {transaction.transactionType === 'DIVIDEND' 
                        ? `Дивиденды от ${transaction.company} (${transaction.ticker})`
                        : movementType.description
                      }
                    </Td>
                    <Td align="right" className={`${isPositive ? 'text-emerald-600' : 'text-rose-600'} font-semibold`}>
                      {isPositive ? '+' : '-'}{formatCurrency(amount)}
                    </Td>
                    <Td className="max-w-xs truncate text-slate-500">
                      {transaction.note || '-'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {transactions.length === 0 && (
          <div className="text-center py-12 text-slate-500">Нет движений денежных средств</div>
        )}
      </div>
    </SpotPageShell>
  );
}

export default CashMovements; 

function Stat({ label, value, tone }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    slate: 'bg-slate-50 text-slate-700'
  };
  const toneClass = colors[tone] || colors.slate;
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
