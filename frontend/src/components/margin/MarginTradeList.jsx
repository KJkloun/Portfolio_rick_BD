import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import MarginPageShell from './MarginPageShell';
import TradeDetailsModal from '../TradeDetailsModal';
import { getRateForDate, getRateChangesFromStorage, calculateAccumulatedInterest } from '../../utils/interestCalculations';

function MarginTradeList() {
  const { currentPortfolio } = usePortfolio();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all | open | closed
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // cards | table
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [groupBy, setGroupBy] = useState('none'); // none | symbol

  const [fifoSymbol, setFifoSymbol] = useState('');
  const [fifoQty, setFifoQty] = useState('');
  const [fifoPrice, setFifoPrice] = useState('');
  const [fifoDate, setFifoDate] = useState('');
  const [fifoNote, setFifoNote] = useState('');
  const [fifoResult, setFifoResult] = useState(null);

  const [selectedTrade, setSelectedTrade] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const formatCurrency = (amount, decimals = 2) => formatPortfolioCurrency(amount, currentPortfolio, decimals);

  useEffect(() => {
    loadTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPortfolio]);

  const loadTrades = async () => {
    if (!currentPortfolio?.id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const resp = await axios.get('/api/trades', { headers: { 'X-Portfolio-ID': currentPortfolio.id } });
      setTrades(Array.isArray(resp.data) ? resp.data : []);
      setError('');
    } catch (e) {
      setError('Не удалось загрузить сделки');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredTrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trades.filter(t => {
      if (filter === 'open' && t.exitDate) return false;
      if (filter === 'closed' && !t.exitDate) return false;
      if (q && !(t.symbol || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [trades, filter, search]);

  const pagedTrades = useMemo(() => {
    if (viewMode !== 'table') return filteredTrades;
    const start = (page - 1) * PAGE_SIZE;
    return filteredTrades.slice(start, start + PAGE_SIZE);
  }, [filteredTrades, page, viewMode]);

  const totalPages = useMemo(() => {
    if (viewMode !== 'table') return 1;
    return Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  }, [filteredTrades.length, viewMode]);

  const summary = useMemo(() => {
    const openTrades = trades.filter(t => !t.exitDate);
    const closed = trades.length - openTrades.length;
    const avgRate = trades.length
      ? trades.reduce((s, t) => s + Number(t.marginAmount || 0), 0) / trades.length
      : 0;
    const exposure = openTrades.reduce(
      (s, t) => s + Number(t.entryPrice || 0) * Number(t.quantity || 0),
      0
    );
    const borrowed = openTrades.reduce((s, t) => {
      const total = Number(t.entryPrice || 0) * Number(t.quantity || 0);
      return s + (t.borrowedAmount != null ? Number(t.borrowedAmount) : total);
    }, 0);
    return { total: trades.length, open: openTrades.length, closed, avgRate, exposure, borrowed };
  }, [trades]);

  const handleFifoClose = async () => {
    if (!fifoSymbol || !fifoQty || !fifoPrice) {
      setFifoResult({ type: 'error', message: 'Укажите тикер, количество и цену' });
      return;
    }
    if (!currentPortfolio?.id) {
      setFifoResult({ type: 'error', message: 'Портфель не выбран' });
      return;
    }
    try {
      const payload = {
        symbol: fifoSymbol.trim().toUpperCase(),
        quantity: Number(fifoQty),
        exitPrice: Number(fifoPrice),
        exitDate: fifoDate || undefined,
        notes: fifoNote || undefined,
      };
      const resp = await axios.post('/api/trades/sell/fifo', payload, {
        headers: { 'X-Portfolio-ID': currentPortfolio.id },
      });
      setFifoResult({ type: 'success', message: resp.data.message || 'Закрыто' });
      setFifoSymbol('');
      setFifoQty('');
      setFifoPrice('');
      setFifoDate('');
      setFifoNote('');
      loadTrades();
      window.dispatchEvent(new CustomEvent('tradesUpdated', { detail: { source: 'fifo-close' } }));
    } catch (err) {
      const msg = err.response?.data?.message || 'Ошибка FIFO закрытия';
      setFifoResult({ type: 'error', message: msg });
    }
  };

  if (!currentPortfolio) {
    return (
      <MarginPageShell title="Журнал маржинальных сделок" subtitle="Портфель не выбран" badge="Journal" />
    );
  }

  if (loading) {
    return (
      <MarginPageShell title="Журнал маржинальных сделок" subtitle="Загрузка..." badge="Journal">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400"></div>
        </div>
      </MarginPageShell>
    );
  }

  return (
    <MarginPageShell
      title="Журнал маржинальных сделок"
      subtitle={`Открытые и закрытые операции (${currentPortfolio?.currency || 'RUB'})`}
      badge="Journal"
    >
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <Metric label="Всего" value={summary.total} helper="Заведенных сделок" tone="slate" />
        <Metric label="Открыто" value={summary.open} helper="В работе" tone="emerald" />
        <Metric label="Закрыто" value={summary.closed} helper="Завершено" tone="blue" />
        <Metric label="Ср. ставка" value={`${summary.avgRate.toFixed(1)}%`} helper="По всем" tone="indigo" />
        <Metric label="Экспозиция" value={formatCurrency(summary.exposure, 0)} helper="Открытые позиции" tone="amber" />
        <Metric label="Заёмные" value={formatCurrency(summary.borrowed, 0)} helper="Работает заемных" tone="rose" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-2 bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex gap-2 flex-wrap">
              {['all', 'open', 'closed'].map(key => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-4 py-2 rounded-lg text-sm ${
                    filter === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-700'
                  }`}
                >
                  {key === 'all' ? 'Все' : key === 'open' ? 'Открытые' : 'Закрытые'}
                </button>
              ))}
              <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-2 py-1 bg-slate-50">
                <span className="text-xs text-slate-500">Вид</span>
                {['cards', 'table'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setViewMode(mode); setPage(1); }}
                    className={`px-3 py-1 rounded-lg text-xs ${
                      viewMode === mode
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    {mode === 'cards' ? 'Карточки' : 'Таблица'}
                  </button>
                ))}
              </div>
              {viewMode === 'cards' && (
                <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-2 py-1 bg-slate-50">
                  <span className="text-xs text-slate-500">Группировка</span>
                  {['none','symbol'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => {
                        setGroupBy(mode);
                        if (mode === 'symbol') {
                          setFilter(filter === 'all' ? 'open' : filter); // при включении группы используем текущий статус (если all — авто open)
                        }
                      }}
                      className={`px-3 py-1 rounded-lg text-xs ${
                        groupBy === mode
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      {mode === 'none' ? 'Нет' : 'По тикеру'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по тикеру"
              className="w-full md:w-64 px-3 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-slate-200 text-sm"
            />
          </div>

          {filteredTrades.length === 0 ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-6 text-center">
              По текущему фильтру сделок нет.
            </div>
          ) : viewMode === 'cards' ? (
            <div className="space-y-4">
              {groupBy === 'symbol'
                ? Object.entries(filteredTrades.reduce((acc, t) => {
                    acc[t.symbol] = acc[t.symbol] || [];
                    acc[t.symbol].push(t);
                    return acc;
                  }, {})).map(([symbol, list]) => {
                    const totalCost = list.reduce((s,t)=> s + Number(t.entryPrice||0)*Number(t.quantity||0), 0);
                    const totalQty = list.reduce((s,t)=> s + Number(t.quantity||0), 0);
                    const weighted = list.reduce((s,t)=>{
                      const cost = Number(t.entryPrice||0) * Number(t.quantity||0);
                      const borrowed = t.borrowedAmount != null ? Number(t.borrowedAmount) : cost;
                      const rateEff = effectiveRate(t);
                      const days = Math.max(1, differenceInDays(t.exitDate ? new Date(t.exitDate) : new Date(), new Date(t.entryDate)));
                      const weight = borrowed * days;
                      return { rateSum: s.rateSum + rateEff * weight, weight: s.weight + weight };
                    }, { rateSum: 0, weight: 0 });
                    const avgRate = weighted.weight > 0 ? weighted.rateSum / weighted.weight : 0;
                    const openCount = list.filter(t=>!t.exitDate).length;
                    const closedCount = list.length - openCount;
                    return (
                      <GroupCard
                        key={symbol}
                        symbol={symbol}
                        trades={list}
                        totalCost={totalCost}
                        totalQty={totalQty}
                        avgRate={avgRate}
                        openCount={openCount}
                        closedCount={closedCount}
                        formatCurrency={formatCurrency}
                        onOpenModal={(t)=>{setSelectedTrade(t); setIsModalOpen(true);}}
                      />
                    );
                  })
                : filteredTrades.map((trade, idx) => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    index={idx + 1}
                    formatCurrency={formatCurrency}
                    onOpenModal={(t) => {
                      setSelectedTrade(t);
                      setIsModalOpen(true);
                    }}
                  />
                ))}
            </div>
          ) : (
            <>
              <div className="overflow-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-sm text-slate-800">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Тикер</th>
                      <th className="px-3 py-2 text-right">Вход</th>
                      <th className="px-3 py-2 text-right">Кол-во</th>
                      <th className="px-3 py-2 text-right">Ставка</th>
                      <th className="px-3 py-2 text-right">Экспозиция</th>
                      <th className="px-3 py-2 text-right">Заёмные</th>
                      <th className="px-3 py-2 text-right">LTV</th>
                      <th className="px-3 py-2 text-right">Проценты/д</th>
                      <th className="px-3 py-2 text-right">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrades.map((trade, idx) => {
                      const totalCost = Number(trade.entryPrice || 0) * Number(trade.quantity || 0);
                      const borrowed = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : totalCost;
                      const ltv = totalCost > 0 ? (borrowed / totalCost) * 100 : 0;
                      const interestPerDay = borrowed * Number(trade.marginAmount || 0) / 100 / 365;
                      return (
                        <tr
                          key={trade.id}
                          className="hover:bg-slate-50 cursor-pointer border-b border-slate-100"
                          onClick={() => {
                            setSelectedTrade(trade);
                            setIsModalOpen(true);
                          }}
                        >
                          <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{trade.symbol}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(Number(trade.entryPrice))}</td>
                          <td className="px-3 py-2 text-right">{trade.quantity}</td>
                          <td className="px-3 py-2 text-right">{trade.marginAmount}%</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(totalCost, 0)}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(borrowed, 0)}</td>
                          <td className="px-3 py-2 text-right">{ltv.toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(interestPerDay, 0)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                              trade.exitDate ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            }`}>
                              {trade.exitDate ? 'Закрыта' : 'Открыта'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
                  <div>Страница {page} из {totalPages}</div>
                  <div className="flex gap-2">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-50"
                    >
                      ←
                    </button>
                    <button
                      disabled={page === totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-50"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Закрытие FIFO</p>
              <h3 className="text-lg font-semibold text-slate-900">Закрыть очередь</h3>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm mb-2">
            <input
              value={fifoSymbol}
              onChange={e => setFifoSymbol(e.target.value.toUpperCase())}
              placeholder="Тикер"
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
            />
            <input
              type="number"
              min="1"
              value={fifoQty}
              onChange={e => setFifoQty(e.target.value)}
              placeholder="Кол-во"
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
            />
            <input
              type="number"
              step="0.01"
              value={fifoPrice}
              onChange={e => setFifoPrice(e.target.value)}
              placeholder="Цена"
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
            />
            <input
              type="date"
              value={fifoDate}
              onChange={e => setFifoDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
            />
          </div>
          <input
            value={fifoNote}
            onChange={e => setFifoNote(e.target.value)}
            placeholder="Заметка (опционально)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm mb-2"
          />
          <button
            onClick={handleFifoClose}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800"
          >
            Закрыть
          </button>
          {fifoResult && (
            <div
              className={`mt-2 text-xs rounded-lg px-3 py-2 ${
                fifoResult.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
              }`}
            >
              {fifoResult.message}
            </div>
          )}
        </div>
      </div>

      {isModalOpen && selectedTrade && (
        <TradeDetailsModal
          tradeId={selectedTrade.id}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTrade(null);
            loadTrades();
          }}
        />
      )}
    </MarginPageShell>
  );
}

function TradeCard({ trade, index, formatCurrency, onOpenModal }) {
  const isOpen = !trade.exitDate;
  const totalCost = Number(trade.entryPrice || 0) * Number(trade.quantity || 0);
  const borrowed = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : totalCost;
  const ltv = totalCost > 0 ? (borrowed / totalCost) * 100 : 0;
  const rateToday = getRateForDate(trade, new Date(), getRateChangesFromStorage());
  const interestPerDay = borrowed * rateToday / 100 / 365;
  const dailyRatePct = rateToday / 365;
  const holdingDays = trade.entryDate
    ? differenceInDays(trade.exitDate ? new Date(trade.exitDate) : new Date(), new Date(trade.entryDate))
    : null;

  return (
    <div
      className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition cursor-pointer"
      onClick={() => onOpenModal(trade)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white text-sm flex items-center justify-center">
            {index}
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900">{trade.symbol}</div>
            <div className="text-xs text-slate-500">
              {trade.entryDate ? format(new Date(trade.entryDate), 'dd MMM yyyy', { locale: ru }) : ''}
            </div>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            isOpen ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-blue-50 text-blue-700 border border-blue-100'
          }`}
        >
          {isOpen ? 'Открыта' : 'Закрыта'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Metric label="Вход" value={formatCurrency(Number(trade.entryPrice))} />
        <Metric label="Кол-во" value={trade.quantity} />
        <Metric label="Ставка" value={`${rateToday.toFixed(2)}%`} helper={`~${dailyRatePct.toFixed(3)}% в день`} />
        {trade.exitPrice && <Metric label="Выход" value={formatCurrency(Number(trade.exitPrice))} />}
        <Metric label="Экспозиция" value={formatCurrency(totalCost, 0)} />
        <Metric label="Заёмные" value={formatCurrency(borrowed, 0)} />
        <Metric label="LTV" value={`${ltv.toFixed(0)}%`} />
        <Metric label="Проценты/день" value={formatCurrency(interestPerDay, 0)} />
        {holdingDays !== null && <Metric label="Дней в работе" value={holdingDays} />}
      </div>
    </div>
  );
}

function GroupCard({ symbol, trades, totalCost, totalQty, avgRate, openCount, closedCount, formatCurrency, onOpenModal }) {
  const interestPerDay = trades.reduce((s,t)=>{
    const cost = Number(t.entryPrice||0) * Number(t.quantity||0);
    const borrowed = t.borrowedAmount != null ? Number(t.borrowedAmount) : cost;
    const rateEff = effectiveRate(t);
    return s + borrowed * rateEff / 100 / 365;
  },0);
  const firstTrade = trades[0];
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-900 text-white text-sm flex items-center justify-center">{symbol}</div>
          <div>
            <div className="text-lg font-semibold text-slate-900">{symbol}</div>
            <div className="text-xs text-slate-500">Сделок: {trades.length} (открыто {openCount}, закрыто {closedCount})</div>
          </div>
        </div>
        <div className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-700">
          Ср. ставка: {avgRate.toFixed(2)}%
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Metric label="Экспозиция" value={formatCurrency(totalCost,0)} />
        <Metric label="Кол-во" value={totalQty} />
        <Metric label="Ср. ставка/день" value={`~${(avgRate/365).toFixed(3)}%`} />
        <Metric label="Проценты/день" value={formatCurrency(interestPerDay,0)} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
        {trades.slice(0,3).map(t=>(
          <button
            key={t.id}
            onClick={()=>onOpenModal(t)}
            className="px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            {t.symbol} • {t.entryDate}{t.exitDate ? ` → ${t.exitDate}`:''}
          </button>
        ))}
        {trades.length>3 && <span className="text-slate-500">и ещё {trades.length-3}…</span>}
      </div>
    </div>
  );
}

// Средневзвешенная по времени ставка для сделки
function effectiveRate(trade) {
  const rateChanges = getRateChangesFromStorage();
  const start = trade.entryDate ? new Date(trade.entryDate) : new Date();
  const end = trade.exitDate ? new Date(trade.exitDate) : new Date();
  const days = Math.max(1, differenceInDays(end, start));
  const cost = Number(trade.entryPrice || 0) * Number(trade.quantity || 0);
  const borrowed = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : cost;
  const accrued = calculateAccumulatedInterest(trade, rateChanges);
  if (borrowed > 0 && accrued !== null && accrued !== undefined) {
    return (accrued * 36500) / (borrowed * days);
  }
  return getRateForDate(trade, end, rateChanges);
}

function Metric({ label, value, helper, tone = 'slate' }) {
  const toneClasses = {
    slate: 'bg-slate-50 text-slate-800 border-slate-100',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-100',
    blue: 'bg-blue-50 text-blue-800 border-blue-100',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-100',
    amber: 'bg-amber-50 text-amber-900 border-amber-100',
    rose: 'bg-rose-50 text-rose-800 border-rose-100',
  }[tone] || 'bg-slate-50 text-slate-800 border-slate-100';

  return (
    <div className={`p-3 rounded-xl border ${toneClasses}`}>
      <div className="text-xs text-slate-500 mb-1 uppercase tracking-[0.08em]">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
      {helper && <div className="text-xs text-slate-500">{helper}</div>}
    </div>
  );
}

export default MarginTradeList;
