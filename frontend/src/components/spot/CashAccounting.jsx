import { useState, useEffect } from 'react';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';

function CashAccounting() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      const transformedData = Array.isArray(data) ? data.map(tx => ({
        ...tx,
        tradeDate: tx.transactionDate || tx.tradeDate,
        totalAmount: tx.amount || tx.totalAmount
      })) : [];
      
      // Sort by date, newest first
      const sortedData = transformedData.sort((a, b) => new Date(b.tradeDate) - new Date(a.tradeDate));
      setTransactions(sortedData);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setError('Ошибка загрузки данных: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate cash flows
  const calculateCashFlows = () => {
    const cashFlows = [];
    let runningBalance = 0;

    // Process transactions chronologically for running balance
    const chronologicalTxs = [...transactions].sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));
    
    chronologicalTxs.forEach(tx => {
      let amount = 0;
      let type = '';
      let description = '';

      switch (tx.transactionType) {
        case 'DEPOSIT':
          amount = tx.price * tx.quantity;
          type = 'inflow';
          description = `Пополнение счета`;
          break;
        case 'WITHDRAW':
          amount = -(tx.price * tx.quantity);
          type = 'outflow';
          description = `Снятие средств`;
          break;
        case 'BUY':
          amount = -(tx.price * tx.quantity);
          type = 'outflow';
          description = `Покупка ${tx.ticker} (${tx.quantity} шт.)`;
          break;
        case 'SELL':
          amount = tx.price * tx.quantity;
          type = 'inflow';
          description = `Продажа ${tx.ticker} (${tx.quantity} шт.)`;
          break;
        case 'DIVIDEND':
          amount = tx.price * tx.quantity;
          type = 'inflow';
          description = `Дивиденды ${tx.company}`;
          break;
        default:
          amount = 0;
          type = 'neutral';
          description = tx.note || 'Прочая операция';
      }

      runningBalance += amount;

      cashFlows.push({
        ...tx,
        amount,
        type,
        description,
        runningBalance
      });
    });

    return cashFlows.reverse(); // Show newest first
  };

  const cashFlows = calculateCashFlows();
  const currentBalance = cashFlows.length > 0 ? cashFlows[0].runningBalance : 0;
  
  const totalInflows = cashFlows
    .filter(cf => cf.type === 'inflow')
    .reduce((sum, cf) => sum + cf.amount, 0);
  
  const totalOutflows = cashFlows
    .filter(cf => cf.type === 'outflow')
    .reduce((sum, cf) => sum + Math.abs(cf.amount), 0);

  const netCashFlow = totalInflows - totalOutflows;

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  const getTypeConfig = (type) => {
    switch (type) {
      case 'inflow':
        return { color: 'text-green-600', label: 'Поступление' };
      case 'outflow':
        return { color: 'text-red-600', label: 'Списание' };
      default:
        return { color: 'text-gray-600', label: 'Операция' };
    }
  };

  if (loading) {
    return (
      <SpotPageShell title="Учёт наличных" subtitle="Загрузка данных..." badge="Spot портфель">
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800"></div>
        </div>
      </SpotPageShell>
    );
  }

  if (error) {
    return (
      <SpotPageShell title="Учёт наличных" subtitle="Полная статистика" badge="Spot портфель">
        <div className="text-center space-y-3 py-16">
          <p className="text-gray-700">{error}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Выбрать портфель
          </button>
        </div>
      </SpotPageShell>
    );
  }

  if (!currentPortfolio) {
    return (
      <SpotPageShell title="Учёт наличных" subtitle="Движение денежных средств" badge="Spot портфель">
        <div className="text-center space-y-3 py-16">
          <p className="text-gray-700">Портфель не выбран</p>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Выбрать портфель
          </button>
        </div>
      </SpotPageShell>
    );
  }

  return (
    <SpotPageShell
      title="Учёт наличных"
      subtitle={`Движение денежных средств в портфеле (${currentPortfolio?.currency || 'USD'})`}
      badge="Spot портфель"
    >

        {/* Current Balance - Featured Card */}
        <div className="mb-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-8 py-6 text-center">
              <div className="text-sm font-medium text-slate-500 mb-2">Текущий баланс наличных</div>
              <div className={`text-4xl font-light ${currentBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(currentBalance)}
              </div>
              <div className="text-xs text-slate-400 mt-2">доступно для инвестирования</div>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Metric label="Всего поступлений" value={formatCurrency(totalInflows)} tone="emerald" />
          <Metric label="Всего списаний" value={formatCurrency(totalOutflows)} tone="rose" />
          <Metric label="Чистый поток" value={formatCurrency(netCashFlow)} tone={netCashFlow>=0?'emerald':'rose'} />
        </div>

        {/* Cash Flow Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h6 className="text-lg font-semibold text-slate-900 mb-1">История движения средств</h6>
            <p className="text-sm text-slate-500">Детальный анализ всех денежных операций</p>
          </div>
          
          {cashFlows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full spot-table">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <Th>Дата</Th>
                    <Th>Тип</Th>
                    <Th>Описание</Th>
                    <Th align="right">Сумма</Th>
                    <Th align="right">Баланс</Th>
                    <Th>Примечание</Th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlows.map((flow, index) => {
                    const typeConfig = getTypeConfig(flow.type);
                    return (
                      <tr key={index} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                        <Td>{flow.tradeDate ? format(new Date(flow.tradeDate), 'dd.MM.yyyy', { locale: ru }) : '-'}</Td>
                        <Td className={`font-semibold ${typeConfig.color}`}>{typeConfig.label}</Td>
                        <Td>{flow.description}</Td>
                        <Td align="right" className={typeConfig.color}>
                          {flow.amount >= 0 ? '+' : ''}{formatCurrency(flow.amount)}
                        </Td>
                        <Td align="right" className={flow.runningBalance >= 0 ? 'text-slate-800' : 'text-rose-600'}>
                          {formatCurrency(flow.runningBalance)}
                        </Td>
                        <Td className="text-slate-500">{flow.note || '-'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100/80 rounded-full mb-3">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Нет движения средств</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto">История операций с наличными средствами пока пуста</p>
            </div>
          )}
        </div>
    </SpotPageShell>
  );
}

export default CashAccounting;

function Metric({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
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
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th className={`px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${alignClass}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <td className={`px-4 py-4 text-sm text-slate-800 ${alignClass} ${className}`}>
      {children}
    </td>
  );
}
