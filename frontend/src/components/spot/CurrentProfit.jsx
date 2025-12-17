import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import SpotPageShell from './SpotPageShell';
import { fetchPricesMap } from '../../utils/priceClient';

function CurrentProfit() {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [positions, setPositions] = useState([]);
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

    try {
      const posResp = await axios.get('/api/spot-transactions/positions/open', {
        headers: { 'X-Portfolio-ID': currentPortfolio.id }
      });

      const rawPositions = Array.isArray(posResp.data) ? posResp.data : [];
      const priceMap = await fetchPricesMap(rawPositions.map(p => p.ticker));

      const enriched = rawPositions.map(pos => {
        const quantity = Number(pos.quantity || 0);
        const avgPrice = pos.avgPrice ?? pos.averagePrice ?? 0;
        const currentPrice = priceMap[pos.ticker] || avgPrice || 0;
        const currentValue = quantity * currentPrice;
        const invested = pos.invested ?? quantity * avgPrice;
        const unrealizedProfit = currentValue - invested;
        return { ...pos, quantity, averagePrice: avgPrice, currentPrice, currentValue, unrealizedProfit, invested };
      });

      setPositions(enriched);
    } catch (error) {
      console.error('Error fetching positions:', error);
      setError('Ошибка загрузки данных: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };

  if (loading) {
    return (
      <SpotPageShell title="Текущие позиции" subtitle="Загрузка данных..." badge="Spot портфель">
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800"></div>
        </div>
      </SpotPageShell>
    );
  }

  if (error) {
    return (
      <SpotPageShell title="Текущие позиции" subtitle="Ошибка загрузки" badge="Spot портфель">
        <div className="text-center space-y-3 py-16 text-slate-700">{error}</div>
      </SpotPageShell>
    );
  }

  const totalUnrealized = positions.reduce((sum, pos) => sum + (pos.unrealizedProfit || 0), 0);
  const totalValue = positions.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
  const profitableCount = positions.filter(p => (p.unrealizedProfit || 0) > 0).length;
  const lossCount = positions.filter(p => (p.unrealizedProfit || 0) < 0).length;
  const topMovers = [...positions]
    .sort((a, b) => Math.abs(b.unrealizedProfit || 0) - Math.abs(a.unrealizedProfit || 0))
    .slice(0, 5);

  return (
    <SpotPageShell
      title="Текущие позиции"
      subtitle={`Открытые бумаги (${currentPortfolio?.currency || 'USD'})`}
      badge="Spot портфель"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Metric label="Стоимость позиций" value={formatCurrency(totalValue)} />
        <Metric label="Нереализованная П/У" value={formatCurrency(totalUnrealized)} tone={totalUnrealized >=0 ? 'emerald' : 'rose'} />
        <Metric label="Активных позиций" value={positions.length} />
        <Metric label="Плюс / минус" value={`${profitableCount} / ${lossCount}`} tone="indigo" />
      </div>

      {topMovers.length > 0 && (
        <div className="mb-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-800">Топ по движению П/У</h4>
            <span className="text-xs text-slate-500">по абсолютному отклонению</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {topMovers.map((mover) => {
              const positive = (mover.unrealizedProfit || 0) >= 0;
              return (
                <div
                  key={mover.ticker}
                  className={`px-3 py-2 rounded-xl border text-sm ${positive ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}
                >
                  <div className="font-semibold">{mover.ticker}</div>
                  <div className="text-xs">{positive ? '+' : ''}{formatCurrency(mover.unrealizedProfit || 0)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {positions.length > 0 ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h6 className="text-lg font-semibold text-slate-900">Открытые позиции</h6>
            <p className="text-sm text-slate-500">{positions.length} активных позиций</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full spot-table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <Th>Компания</Th>
                  <Th>Тикер</Th>
                  <Th align="right">Кол-во</Th>
                  <Th align="right">Средняя цена</Th>
                  <Th align="right">Текущая цена</Th>
                  <Th align="right">Стоимость</Th>
                  <Th align="right">П/У</Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position, index) => (
                  <tr key={index} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <Td>{position.company}</Td>
                    <Td className="font-semibold">{position.ticker}</Td>
                    <Td align="right">{position.quantity?.toLocaleString() || 0}</Td>
                    <Td align="right">{formatCurrency(position.averagePrice || 0)}</Td>
                    <Td align="right">{formatCurrency(position.currentPrice || 0)}</Td>
                    <Td align="right" className="font-semibold">{formatCurrency(position.currentValue || 0)}</Td>
                    <Td align="right" className={(position.unrealizedProfit || 0) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                      {(position.unrealizedProfit || 0) >= 0 ? '+' : ''}{formatCurrency(position.unrealizedProfit || 0)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Итого нереализованная П/У</span>
              <span className={`text-base font-semibold ${totalUnrealized >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {totalUnrealized >= 0 ? '+' : ''}{formatCurrency(totalUnrealized)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <h3 className="text-lg font-medium text-slate-800 mb-2">Нет открытых позиций</h3>
          <p className="text-slate-500">Все позиции закрыты или отсутствуют транзакции</p>
        </div>
      )}
    </SpotPageShell>
  );
}

export default CurrentProfit;

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
  return (
    <th className={`px-4 sm:px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  return (
    <td className={`px-4 sm:px-6 py-4 text-sm text-slate-800 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  );
}
