import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { usePortfolio } from '../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../utils/currencyFormatter';
import { Link } from 'react-router-dom';
import { fetchPricesMap } from '../utils/priceClient';

function Dashboard() {
  const { currentPortfolio, getPortfoliosByType, portfolios } = usePortfolio();
  const [spotStats, setSpotStats] = useState(null);
  const [marginStats, setMarginStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const spotPortfolio = useMemo(() => {
    // всегда приоритет текущему выбранному портфелю, даже если он формально MARGIN (мы объединяли типы)
    if (currentPortfolio) return currentPortfolio;
    const spots = getPortfoliosByType('SPOT');
    const storedId = localStorage.getItem('currentSpotPortfolioId');
    if (storedId) {
      const stored = spots.find(p => String(p.id) === storedId);
      if (stored) return stored;
    }
    // если спотов нет — используем любой доступный, чтобы хотя бы показать валюту
    if (spots.length) return spots[0];
    return portfolios?.[0] || null;
  }, [currentPortfolio, getPortfoliosByType, portfolios]);

  const marginPortfolio = useMemo(() => {
    if (currentPortfolio) return currentPortfolio;
    const margins = getPortfoliosByType('MARGIN');
    const storedId = localStorage.getItem('currentMarginPortfolioId');
    if (storedId) {
      const stored = margins.find(p => String(p.id) === storedId);
      if (stored) return stored;
    }
    if (margins.length) return margins[0];
    return portfolios?.[0] || null;
  }, [currentPortfolio, getPortfoliosByType, portfolios]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        // Спот
        if (spotPortfolio) {
          try {
            const spotResp = await axios.get('/api/spot-transactions/stats', { headers: { 'X-Portfolio-ID': spotPortfolio.id } });
            const statsBase = spotResp.data || {};
            // заберем позиции и посчитаем текущую стоимость по актуальным ценам
            const posResp = await axios.get('/api/spot-transactions/positions/open', { headers: { 'X-Portfolio-ID': spotPortfolio.id } });
            const positions = Array.isArray(posResp.data) ? posResp.data : [];
            const priceMap = await fetchPricesMap(positions.map(p => p.ticker));
            const positionsWithPrices = positions.map(p => {
              const qty = Number(p.quantity || 0);
              const avg = Number(p.avgPrice || 0);
              const price = priceMap[p.ticker] || avg;
              const value = qty * price;
              const unrealized = value - qty * avg;
              return { ...p, quantity: qty, avgPrice: avg, currentPrice: price, currentValue: value, unrealized };
            });
            const currentValue = positionsWithPrices.reduce((s, p) => s + (p.currentValue || 0), 0);
            const totalUnrealized = positionsWithPrices.reduce((s, p) => s + (p.unrealized || 0), 0);
            const merged = {
              ...statsBase,
              openPositions: positionsWithPrices.length,
              positionsCount: positionsWithPrices.length,
              currentValue,
              pnl: (statsBase.realizedPnL || 0) + totalUnrealized,
              dividends: statsBase.totalDividends || statsBase.dividends || 0,
            };
            setSpotStats(merged);
          } catch (err) {
            // fallback на старый способ
            const txResp = await axios.get('/api/spot-transactions', { headers: { 'X-Portfolio-ID': spotPortfolio.id } });
            const stats = buildSpotFallbackStats(txResp.data || [], spotPortfolio);
            setSpotStats(stats);
          }
        }

        // Маржа
        if (marginPortfolio) {
          try {
            const marginResp = await axios.get('/api/trades/stats', { headers: { 'X-Portfolio-ID': marginPortfolio.id } });
            const base = marginResp.data || {};
            let merged = { ...base };
            try {
              const posResp = await axios.get('/api/trades/positions/open', { headers: { 'X-Portfolio-ID': marginPortfolio.id } });
              const positions = Array.isArray(posResp.data) ? posResp.data : [];
              const borrowed = positions.reduce((s,p)=> s + Number(p.borrowed || 0), 0);
              const dailyInterest = positions.reduce((s,p)=> s + Number(p.interestPerDay || 0), 0);
              if (borrowed > 0) {
                merged.borrowedTotal = borrowed;
                merged.totalInterestDaily = dailyInterest;
                merged.avgRateCurrent = dailyInterest * 365 * 100 / borrowed;
              }
              merged.exposure = positions.reduce((s,p)=> s + Number(p.exposure || 0), 0);
              merged.open = positions.length;
            } catch (e) {
              // ignore, оставляем base
            }
            setMarginStats(merged);
          } catch (err) {
            const tradesResp = await axios.get('/api/trades', { headers: { 'X-Portfolio-ID': marginPortfolio.id } });
            const trades = Array.isArray(tradesResp.data) ? tradesResp.data : [];
            const open = trades.filter(t => !t.exitDate);
            const closed = trades.filter(t => t.exitDate);
            const exposure = open.reduce((s,t)=> s + Number(t.entryPrice||0)*Number(t.quantity||0), 0);
            const profit = closed.reduce((s,t)=> s + ((Number(t.exitPrice||0)-Number(t.entryPrice||0))*Number(t.quantity||0)), 0);
            const interestDaily = open.reduce((s,t)=>{
              const cost = Number(t.entryPrice||0)*Number(t.quantity||0);
              const borrowed = t.borrowedAmount != null ? Number(t.borrowedAmount) : cost;
              return s + borrowed * Number(t.marginAmount||0)/100/365;
            },0);
            const avgRate = open.length ? open.reduce((s,t)=> s+Number(t.marginAmount||0),0)/open.length : 0;
            setMarginStats({ exposure, open: open.length, closed: closed.length, profit, interestDaily, avgRate, trades });
          }
        }
      } catch (e) {
        console.error(e);
        setError('Не удалось загрузить данные по портфелям');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [spotPortfolio, marginPortfolio]);

  const buildSpotFallbackStats = (transactions, portfolio) => {
    if (!Array.isArray(transactions)) return null;
    const prices = (() => {
      try { return JSON.parse(localStorage.getItem('stockPrices') || '{}'); }
      catch { return {}; }
    })();

    const fifo = {};
    let realizedProfit = 0;
    let dividends = 0;
    transactions.forEach(tx => {
      const { ticker, transactionType, price = 0, quantity = 0, amount = 0, totalAmount = 0 } = tx;
      const qty = Number(quantity) || 0;
      const px = Number(price) || 0;
      const signedAmount = Number(amount || totalAmount || 0);

      if (!ticker || ticker === 'USD') return;

      if (transactionType === 'DIVIDEND') {
        dividends += signedAmount;
        return;
      }

      if (!fifo[ticker]) fifo[ticker] = [];

      if (transactionType === 'BUY') {
        fifo[ticker].push({ qty, price: px });
      }

      if (transactionType === 'SELL') {
        let remaining = qty;
        while (remaining > 0 && fifo[ticker].length > 0) {
          const lot = fifo[ticker][0];
          const take = Math.min(lot.qty, remaining);
          realizedProfit += (px - lot.price) * take;
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 0) fifo[ticker].shift();
        }
      }
    });

    let currentValue = 0;
    let costBasisRemaining = 0;
    let openPositions = 0;

    Object.entries(fifo).forEach(([ticker, lots]) => {
      const qtyTotal = lots.reduce((s, l) => s + l.qty, 0);
      if (qtyTotal > 0) {
        openPositions += 1;
        const avgCost = lots.reduce((s, l) => s + l.price * l.qty, 0) / qtyTotal;
        const livePrice = prices[ticker] || avgCost;
        currentValue += qtyTotal * livePrice;
        costBasisRemaining += qtyTotal * avgCost;
      }
    });

    const closedPositions = Math.max(new Set(transactions.map(t => t.ticker).filter(Boolean)).size - openPositions, 0);

    return {
      totalTransactions: transactions.length,
      openPositions,
      closedPositions,
      currentValue,
      pnl: realizedProfit + (currentValue - costBasisRemaining),
      dividends,
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center text-slate-600">
        Загрузка дашборда...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center text-red-600">
        {error}
      </div>
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center text-slate-700">
        <div className="bg-white/80 backdrop-blur-sm border border-slate-100 rounded-3xl shadow-sm p-6 text-center space-y-3">
          <div className="text-lg font-semibold">Портфели не найдены</div>
          <p className="text-sm text-slate-500">Создайте портфель, чтобы увидеть сводку</p>
          <Link to="/portfolios" className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm">
            Перейти к портфелям
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 text-slate-900">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-10 -top-10 w-72 h-72 bg-emerald-100 rounded-full mix-blend-multiply blur-3xl opacity-40" />
          <div className="absolute -right-10 top-16 w-80 h-80 bg-indigo-100 rounded-full mix-blend-multiply blur-3xl opacity-30" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-6">
          <div className="bg-white/80 backdrop-blur-xl border border-slate-100/70 shadow-lg shadow-slate-200/30 rounded-3xl px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-900 text-white shadow">
                  Обзор
                </span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Портфели</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                Сводка спот + маржа
              </h1>
              {currentPortfolio && (
                <p className="text-sm text-slate-600">Текущий портфель: {currentPortfolio.name} ({currentPortfolio.currency})</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/margin" className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm">Маржа</Link>
              <Link to="/spot" className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm">Спот</Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PortfolioCard
              title="Маржинальный контур"
              subtitle={marginPortfolio?.name || '—'}
              metrics={[
                { label: 'Экспозиция', value: formatPortfolioCurrency(marginStats?.exposure || marginStats?.totalCostOpen || 0, marginPortfolio, 0) },
                { label: 'Открыто', value: marginStats?.open ?? marginStats?.openCount ?? '—' },
                { label: 'Закрыто', value: marginStats?.closed ?? marginStats?.closedCount ?? '—' },
                { label: 'Ставка (текущая)', value: `${((marginStats?.avgRateCurrent ?? marginStats?.avgRate ?? 0)).toFixed(2)}%` },
                { label: 'Проценты/день', value: formatPortfolioCurrency(marginStats?.totalInterestDaily ?? marginStats?.interestDaily ?? 0, marginPortfolio, 0) },
                { label: 'Прибыль закрытых', value: formatPortfolioCurrency(marginStats?.totalProfit ?? marginStats?.profit ?? 0, marginPortfolio, 0) },
              ]}
              link="/margin"
            />
            <PortfolioCard
              title="Спотовый контур"
              subtitle={spotPortfolio?.name || '—'}
              metrics={[
                { label: 'Сделок', value: spotStats?.totalTransactions ?? '—' },
                { label: 'Открытые позиции', value: spotStats?.openPositions ?? spotStats?.positionsCount ?? '—' },
                { label: 'Закрытые позиции', value: spotStats?.closedPositions ?? '—' },
                { label: 'Текущая стоимость', value: spotStats ? formatPortfolioCurrency((spotStats.currentValue ?? (spotStats.totalInvested || 0) + (spotStats.cashBalance || 0)), spotPortfolio, 0) : '—' },
                { label: 'PnL', value: spotStats ? formatPortfolioCurrency((spotStats.pnl ?? spotStats.realizedPnL ?? 0), spotPortfolio, 0) : '—' },
                { label: 'Дивиденды', value: spotStats ? formatPortfolioCurrency((spotStats.dividends || spotStats.totalDividends || 0), spotPortfolio, 0) : '—' },
              ]}
              link="/spot"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PortfolioCard({ title, subtitle, metrics, link }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{subtitle || 'Портфель'}</p>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <Link to={link} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Открыть</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m, idx)=>(
          <div key={idx} className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="text-xs text-slate-500">{m.label}</div>
            <div className="text-base number-unified">{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Dashboard;
