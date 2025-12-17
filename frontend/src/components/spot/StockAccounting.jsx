import { useState, useEffect } from 'react';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';
import { fetchPricesMap } from '../../utils/priceClient';

function StockAccounting() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [positions, setPositions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPositions();
  }, [currentPortfolio, refreshTrigger]);

  const fetchPositions = async () => {
    if (!currentPortfolio?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get('/api/spot-transactions/positions/open', {
        headers: { 'X-Portfolio-ID': currentPortfolio.id }
      });
      const positions = Array.isArray(response.data) ? response.data : [];
      const statsResp = await axios.get('/api/spot-transactions/stats', {
        headers: { 'X-Portfolio-ID': currentPortfolio.id }
      });
      setStats(statsResp.data || {});
      const priceMap = await fetchPricesMap(positions.map(p => p.ticker));

      const enriched = positions.map(pos => {
        const currentPrice = priceMap[pos.ticker] || pos.avgPrice || 0;
        const quantity = Number(pos.quantity || 0);
        const currentValue = quantity * currentPrice;
        const avgCost = pos.avgPrice || 0;
        const unrealizedProfit = currentValue - (quantity * avgCost);
        return {
          ...pos,
          quantity,
          currentPrice,
          currentValue,
          unrealizedProfit,
          totalProfit: (pos.realizedProfit || 0) + unrealizedProfit,
          status: pos.quantity > 0 ? 'Активная' : 'Закрытая'
        };
      });

      setPositions(enriched);
    } catch (error) {
      console.error('Error fetching positions:', error);
      setError('Ошибка загрузки данных: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const activePositions = positions.filter(pos => pos.quantity > 0);
  const closedPositions = positions.filter(pos => pos.quantity === 0);
  const totalStocks = positions.length;
  const totalRealizedProfit = Number(stats?.realizedPnL || stats?.realizedProfit || 0);
  const totalUnrealizedProfit = positions.reduce((sum, pos) => sum + Number(pos.unrealizedProfit || 0), 0);
  const totalProfit = totalRealizedProfit + totalUnrealizedProfit;

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  const formatPercent = (value) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (loading) {
    return (
      <SpotPageShell title="Учёт акций" subtitle="Загрузка данных..." badge="Spot портфель">
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800"></div>
        </div>
      </SpotPageShell>
    );
  }

  if (error) {
    return (
      <SpotPageShell title="Учёт акций" subtitle="Полная статистика по всем акциям" badge="Spot портфель">
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
      <SpotPageShell title="Учёт акций" subtitle="Полная статистика по всем акциям" badge="Spot портфель">
        <div className="text-center space-y-3 py-16">
          <p className="text-gray-700 mb-2">Портфель не выбран</p>
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
      title="Учёт акций"
      subtitle={`Полная статистика по всем акциям с FIFO расчетом прибыли (${currentPortfolio?.currency || 'USD'})`}
      badge="Spot портфель"
    >

        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Metric label="Всего акций" value={totalStocks} />
          <Metric label="Активных позиций" value={activePositions.length} tone="indigo" />
          <Metric label="Закрытых позиций" value={closedPositions.length} tone="slate" />
          <Metric label="Реализованная П/У" value={formatCurrency(totalRealizedProfit)} tone={totalRealizedProfit>=0?'emerald':'rose'} />
          <Metric label="Нереализованная П/У" value={formatCurrency(totalUnrealizedProfit)} tone={totalUnrealizedProfit>=0?'emerald':'rose'} />
          <Metric label="Общая прибыль" value={formatCurrency(totalProfit)} tone={totalProfit>=0?'emerald':'rose'} />
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4">
            <h6 className="text-lg font-semibold text-slate-900 mb-1">Все акции</h6>
            <p className="text-sm text-slate-500">Полная статистика с FIFO расчетом: средняя цена покупки оставшихся акций, реализованная прибыль от продаж, нереализованная прибыль от текущих позиций</p>
          </div>
          
          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full spot-table">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <Th>Компания</Th>
                    <Th>Тикер</Th>
                    <Th align="center">Статус</Th>
                    <Th align="right">Кол-во</Th>
                    <Th align="right">Инвестировано</Th>
                    <Th align="right">Средняя цена</Th>
                    <Th align="right">Текущая цена</Th>
                    <Th align="right">Стоимость</Th>
                    <Th align="right">Реализ. П/У</Th>
                    <Th align="right">Нереализ. П/У</Th>
                    <Th align="right">Общая П/У</Th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.ticker} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${position.status === 'Закрытая' ? 'opacity-60' : ''}`}>
                      <Td>{position.company}</Td>
                      <Td className="font-semibold">{position.ticker}</Td>
                      <Td align="center">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          position.status === 'Активная' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {position.status}
                        </span>
                      </Td>
                      <Td align="right">{Number(position.quantity || 0).toLocaleString()}</Td>
                      <Td align="right">{formatCurrency(position.invested || 0)}</Td>
                      <Td align="right">{position.avgPrice > 0 ? formatCurrency(position.avgPrice) : '-'}</Td>
                      <Td align="right">{position.currentPrice > 0 ? formatCurrency(position.currentPrice) : '-'}</Td>
                      <Td align="right" className="font-semibold">{formatCurrency(position.currentValue || 0)}</Td>
                      <Td align="right" className={Number(position.realizedProfit || 0) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                        {Number(position.realizedProfit || 0) >= 0 ? '+' : ''}{formatCurrency(position.realizedProfit || 0)}
                      </Td>
                      <Td align="right" className={Number(position.unrealizedProfit || 0) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                        {position.quantity > 0 ? (Number(position.unrealizedProfit || 0) >= 0 ? '+' : '') + formatCurrency(position.unrealizedProfit || 0) : '-'}
                      </Td>
                      <Td align="right" className={Number(position.totalProfit || 0) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                        {Number(position.totalProfit || 0) >= 0 ? '+' : ''}{formatCurrency(position.totalProfit || 0)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100/80 rounded-full mb-3">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Нет данных по акциям</h3>
              <p className="text-xs text-gray-400 max-w-md mx-auto">У вас пока нет операций с акциями</p>
            </div>
          )}
        </div>
    </SpotPageShell>
  );
}

function Metric({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    indigo: 'bg-indigo-50 text-indigo-700',
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
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${alignClass}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td className={`px-4 py-4 text-sm text-slate-800 ${alignClass} ${className}`}>
      {children}
    </td>
  );
}

export default StockAccounting; 
