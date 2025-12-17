import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { differenceInDays, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import MarginPageShell from './MarginPageShell';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import { calculateAccumulatedInterest, getRateChangesFromStorage, getRateForDate } from '../../utils/interestCalculations';

function MarginDashboard() {
  const navigate = useNavigate();
  const { currentPortfolio } = usePortfolio();
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [rateChanges, setRateChanges] = useState(getRateChangesFromStorage());
  const [fifoForm, setFifoForm] = useState({ symbol: '', quantity: '', price: '', date: '', note: '' });
  const [fifoStatus, setFifoStatus] = useState(null);

  useEffect(() => {
    const handleStorageUpdate = (event) => {
      if (event.key === 'cbRateChanges') {
        setRateChanges(getRateChangesFromStorage());
      }
    };
    window.addEventListener('storage', handleStorageUpdate);
    return () => window.removeEventListener('storage', handleStorageUpdate);
  }, []);

  useEffect(() => {
    loadTrades();
    loadPositions();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPortfolio]);

  const loadTrades = async () => {
    if (!currentPortfolio?.id) {
      setTrades([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const resp = await axios.get('/api/trades', { headers: { 'X-Portfolio-ID': currentPortfolio.id } });
      setTrades(Array.isArray(resp.data) ? resp.data : []);
      setError('');
    } catch (e) {
      setError('Не удалось загрузить сделки для текущего портфеля');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    if (!currentPortfolio?.id) {
      setStats(null);
      return;
    }
    try {
      const resp = await axios.get('/api/trades/stats', { headers: { 'X-Portfolio-ID': currentPortfolio.id } });
      setStats(resp.data || null);
    } catch (e) {
      console.error('Ошибка загрузки сводки:', e);
      setStats(null);
    }
  };

  const loadPositions = async () => {
    if (!currentPortfolio?.id) {
      setPositions([]);
      return;
    }
    try {
      const resp = await axios.get('/api/trades/positions/open', { headers: { 'X-Portfolio-ID': currentPortfolio.id } });
      setPositions(Array.isArray(resp.data) ? resp.data : []);
    } catch (e) {
      console.error('Ошибка загрузки позиций:', e);
      setPositions([]);
    }
  };

  const formatCurrency = (amount, decimals = 0) => formatPortfolioCurrency(amount, currentPortfolio, decimals);

  const openTrades = useMemo(() => trades.filter(t => !t.exitDate), [trades]);
  const closedTrades = useMemo(() => trades.filter(t => t.exitDate), [trades]);

  const totals = useMemo(() => {
    // Текущая ставка = последняя изменённая (rateChanges) или бэковая текущая
    const latestRateChange = [...rateChanges]
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const currentRate = latestRateChange
      ? Number(latestRateChange.rate || 0)
      : (stats?.avgRateCurrent ?? stats?.avgRate ?? 0);

    // Открытые позиции: экспозиция/заёмные
    const fromPositions = positions.length > 0 ? positions.reduce((acc, p) => {
      const exposure = Number(p.exposure || (p.entryPrice || 0) * (p.quantity || 0));
      const borrowed = p.borrowed != null ? Number(p.borrowed) : exposure;
      acc.openExposure += exposure;
      acc.borrowedTotal += borrowed;
      return acc;
    }, { openExposure: 0, borrowedTotal: 0 }) : null;

    const openExposure = stats?.totalCostOpen || fromPositions?.openExposure || 0;
    const borrowedTotal = fromPositions?.borrowedTotal || stats?.borrowedTotal || 0;

    // Проценты/день считаем от текущей ставки и заёмных
    const dailyInterest = borrowedTotal && currentRate
      ? borrowedTotal * currentRate / 100 / 365
      : (stats?.totalInterestDaily || 0);

    const avgRate = currentRate || (borrowedTotal > 0 && dailyInterest > 0 ? (dailyInterest * 365 * 100) / borrowedTotal : 0);
    const accrued = stats?.totalAccruedInterest ?? trades.reduce((sum, trade) => sum + calculateAccumulatedInterest(trade, rateChanges), 0);

    return {
      openExposure,
      borrowedTotal,
      avgRate,
      dailyInterest,
      monthlyInterest: dailyInterest * 30,
      yearlyInterest: dailyInterest * 365,
      accrued,
    };
  }, [positions, stats, trades, rateChanges]);

  const symbolExposure = useMemo(() => {
    const source = positions.length > 0 ? positions : openTrades;
    const map = {};
    source.forEach(item => {
      const exposure = Number(item.exposure || (item.entryPrice || 0) * (item.quantity || 0));
      const symbol = item.symbol;
      map[symbol] = (map[symbol] || 0) + exposure;
    });
    return Object.entries(map)
      .map(([symbol, exposure]) => ({ symbol, exposure }))
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 4);
  }, [openTrades, positions]);

  const watchlist = useMemo(() => {
    const source = positions.length > 0 ? positions : openTrades;
    return source
      .map(item => {
        const total = Number(item.exposure || (item.entryPrice || 0) * (item.quantity || 0));
        const borrowed = item.borrowed != null ? Number(item.borrowed) : (item.borrowedAmount != null ? Number(item.borrowedAmount) : total);
        const ltv = total > 0 ? (borrowed / total) * 100 : 0;
        const rateToday = item.rate != null ? Number(item.rate) : getRateForDate(item, new Date(), rateChanges);
        const interestPerDay = item.interestPerDay != null ? Number(item.interestPerDay) : borrowed * rateToday / 100 / 365;
        const heldDays = item.heldDays != null ? item.heldDays : (item.entryDate ? differenceInDays(new Date(), new Date(item.entryDate)) : 0);
        return {
          id: item.id,
          symbol: item.symbol,
          ltv,
          interestPerDay,
          rate: rateToday,
          maintenance: item.maintenanceMargin || item.maintenance,
          heldDays,
        };
      })
      .sort((a, b) => b.ltv - a.ltv || b.rate - a.rate)
      .slice(0, 4);
  }, [openTrades, positions, rateChanges]);

  const fundingLog = useMemo(() => {
    return [...rateChanges]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
  }, [rateChanges]);

  const handleFifoSubmit = async () => {
    if (!fifoForm.symbol || !fifoForm.quantity || !fifoForm.price) {
      setFifoStatus({ type: 'error', text: 'Тикер, количество и цена обязательны' });
      return;
    }
    if (!currentPortfolio?.id) {
      setFifoStatus({ type: 'error', text: 'Сначала выберите портфель' });
      return;
    }

    try {
      setFifoStatus({ type: 'progress', text: 'Отправляем...' });
      const payload = {
        symbol: fifoForm.symbol.trim().toUpperCase(),
        quantity: Number(fifoForm.quantity),
        exitPrice: Number(fifoForm.price),
        exitDate: fifoForm.date || undefined,
        notes: fifoForm.note || undefined,
      };

      const resp = await axios.post('/api/trades/sell/fifo', payload, {
        headers: { 'X-Portfolio-ID': currentPortfolio.id },
      });

      setFifoStatus({ type: 'success', text: resp.data?.message || 'Закрытие выполнено' });
      setFifoForm({ symbol: '', quantity: '', price: '', date: '', note: '' });
      loadTrades();
      window.dispatchEvent(new CustomEvent('tradesUpdated', { detail: { source: 'margin-dashboard' } }));
    } catch (err) {
      setFifoStatus({ type: 'error', text: err.response?.data?.message || 'Ошибка FIFO закрытия' });
    }
  };

  if (!currentPortfolio) {
    return (
      <MarginPageShell
        title="Маржинальный контур"
        subtitle="Выберите портфель, чтобы управлять маржинальными позициями"
        badge="Margin 2.0"
      >
        <div className="bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl p-8 text-center text-slate-600">
          <div className="text-3xl mb-3">🗂️</div>
          <p className="text-base">Портфель не выбран. Перейдите к списку портфелей и выберите нужный.</p>
          <button
            className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition"
            onClick={() => navigate('/portfolios')}
          >
            Перейти к портфелям
          </button>
        </div>
      </MarginPageShell>
    );
  }

  return (
    <MarginPageShell
      title="Маржинальный контур"
      subtitle={`Новая сцена управления займом и риском для ${currentPortfolio?.name || 'портфеля'}`}
      badge="Margin 2.0"
      actions={
        <>
          <button
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
            onClick={() => navigate('/margin/statistics')}
          >
            Аналитика
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
            onClick={() => navigate('/margin/new')}
          >
            Новая позиция
          </button>
        </>
      }
    >
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white/70 border border-slate-100 rounded-2xl shadow-sm p-6 text-slate-500">
          Загружаем сделки...
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Открыто" value={openTrades.length} helper="Активных позиций" tone="emerald" />
            <StatCard label="Закрыто" value={closedTrades.length} helper="Завершено" tone="slate" />
            <StatCard label="Занято" value={formatCurrency(totals.borrowedTotal, 0)} helper="Работает заёмных" tone="amber" />
            <StatCard label="Ставка" value={`${totals.avgRate.toFixed(1)}%`} helper="Текущая по открытому" tone="indigo" />
            <StatCard label="Проценты/день" value={formatCurrency(totals.dailyInterest, 0)} helper="Капает сегодня" tone="rose" />
            <StatCard label="Начислено" value={formatCurrency(totals.accrued, 0)} helper="Итого к выплате" tone="blue" />
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-8 bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Операционный стол</p>
                  <h3 className="text-lg font-semibold text-slate-900">Что делаем прямо сейчас</h3>
                </div>
                <button
                  className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => navigate('/margin/trades')}
                >
                  Перейти к журналу
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    title: 'Завести новую позицию',
                    desc: 'Сформировать новую маржинальную сделку с контролем плеча и поддерживающей маржи.',
                    action: () => navigate('/margin/new'),
                    tone: 'bg-emerald-50 text-emerald-800 border-emerald-100',
                    cta: 'Добавить',
                  },
                  {
                    title: 'Импортировать сделки',
                    desc: 'Быстрая загрузка из CSV для портфеля, чтобы не заполнять вручную.',
                    action: () => navigate('/margin/import'),
                    tone: 'bg-indigo-50 text-indigo-800 border-indigo-100',
                    cta: 'Импорт',
                  },
                  {
                    title: 'Закрыть через FIFO',
                    desc: 'Закрыть по очереди в один клик. Введите параметры и зафиксируйте продажу.',
                    tone: 'bg-amber-50 text-amber-800 border-amber-100',
                    action: () => document.getElementById('fifo-form')?.scrollIntoView({ behavior: 'smooth' }),
                    cta: 'Закрыть FIFO',
                  },
                  {
                    title: 'Посмотреть риски',
                    desc: 'Перейти в аналитику и контроль LTV, чтобы понять, что держать, а что сбросить.',
                    action: () => navigate('/margin/statistics'),
                    tone: 'bg-slate-50 text-slate-800 border-slate-200',
                    cta: 'Риск-карта',
                  },
                ].map(card => (
                  <button
                    key={card.title}
                    onClick={card.action}
                    className={`text-left rounded-2xl border ${card.tone} px-4 py-4 hover:shadow transition`}
                  >
                    <div className="text-sm font-semibold mb-1">{card.title}</div>
                    <p className="text-sm text-slate-600 mb-3">{card.desc}</p>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white text-slate-800 border border-white/60 shadow-sm">
                      {card.cta}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="xl:col-span-4 bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Процентный журнал</p>
                  <h3 className="text-lg font-semibold text-slate-900">Календарь ставок</h3>
                </div>
              </div>

              <div className="space-y-3">
                {fundingLog.length === 0 ? (
                  <div className="text-sm text-slate-500">Нет сохраненных изменений ставок.</div>
                ) : (
                  fundingLog.map(change => (
                    <div key={change.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                      <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
                        {change.rate}%
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900">{format(new Date(change.date), 'd MMM', { locale: ru })}</div>
                        <div className="text-sm text-slate-600">{change.reason}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">До начисления</div>
                <div className="text-2xl font-semibold text-slate-900">{formatCurrency(totals.monthlyInterest, 0)}</div>
                <div className="text-sm text-slate-600">При сохранении текущих ставок за ближайшие 30 дней</div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Позиции</p>
                  <h3 className="text-lg font-semibold text-slate-900">Открытые сделки</h3>
                </div>
                <button
                  className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => navigate('/margin/trades')}
                >
                  Все сделки
                </button>
              </div>
              {openTrades.length === 0 ? (
                <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-6 text-center">
                  Нет открытых сделок. Создайте новую позицию или импортируйте CSV.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {openTrades.slice(0, 4).map(trade => (
                    <PositionCard
                      key={trade.id}
                      trade={trade}
                      formatCurrency={formatCurrency}
                      onOpen={() => navigate(`/margin/trade/${trade.id}`)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Фокус</p>
                <h3 className="text-lg font-semibold text-slate-900">Самые нагруженные</h3>
              </div>
              {watchlist.length === 0 ? (
                <div className="text-sm text-slate-500">Пока нечего контролировать.</div>
              ) : (
                <div className="space-y-3">
                  {watchlist.map(item => (
                    <div key={item.id} className="border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-semibold text-slate-900">{item.symbol}</div>
                        <span className={`text-xs px-2 py-1 rounded-full ${item.ltv > 70 ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                          LTV {item.ltv.toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center justify-between">
                        <span>Ставка {item.rate}%</span>
                        <span>{item.interestPerDay > 0 ? formatCurrency(item.interestPerDay, 0) : '—'} в день</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full ${item.ltv > 70 ? 'bg-rose-400' : item.ltv > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${Math.min(item.ltv, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-dashed border-slate-200 p-4" id="fifo-form">
                <div className="text-sm font-semibold mb-2 text-slate-900">Быстрое закрытие FIFO</div>
                <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                  <input
                    value={fifoForm.symbol}
                    onChange={e => setFifoForm({ ...fifoForm, symbol: e.target.value.toUpperCase() })}
                    placeholder="Тикер"
                    className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  />
                  <input
                    type="number"
                    min="1"
                    value={fifoForm.quantity}
                    onChange={e => setFifoForm({ ...fifoForm, quantity: e.target.value })}
                    placeholder="Кол-во"
                    className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={fifoForm.price}
                    onChange={e => setFifoForm({ ...fifoForm, price: e.target.value })}
                    placeholder="Цена"
                    className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  />
                  <input
                    type="date"
                    value={fifoForm.date}
                    onChange={e => setFifoForm({ ...fifoForm, date: e.target.value })}
                    className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  />
                </div>
                <input
                  value={fifoForm.note}
                  onChange={e => setFifoForm({ ...fifoForm, note: e.target.value })}
                  placeholder="Заметка (необязательно)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm mb-2"
                />
                <button
                  onClick={handleFifoSubmit}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800"
                >
                  Закрыть
                </button>
                {fifoStatus && (
                  <div
                    className={`mt-2 text-xs rounded-lg px-3 py-2 ${
                      fifoStatus.type === 'success'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        : fifoStatus.type === 'progress'
                          ? 'bg-slate-50 text-slate-700 border border-slate-100'
                          : 'bg-rose-50 text-rose-700 border border-rose-100'
                    }`}
                  >
                    {fifoStatus.text}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Фокус по тикерам</p>
                  <h3 className="text-lg font-semibold text-slate-900">Где концентрирована маржа</h3>
                </div>
              </div>
              {symbolExposure.length === 0 ? (
                <div className="text-sm text-slate-500">Нет открытых позиций.</div>
              ) : (
                <div className="space-y-2">
                  {symbolExposure.map(item => (
                    <div key={item.symbol} className="flex items-center gap-3 border border-slate-100 rounded-xl px-3 py-2">
                      <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
                        {item.symbol}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900">{formatCurrency(item.exposure, 0)}</div>
                        <div className="text-xs text-slate-500">Экспозиция по открытым позициям</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Режим выплат</p>
                  <h3 className="text-lg font-semibold text-slate-900">Стоимость финансирования</h3>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-slate-100 rounded-xl p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500 mb-1">30 дней</div>
                  <div className="text-xl font-semibold text-slate-900">{formatCurrency(totals.monthlyInterest, 0)}</div>
                  <div className="text-xs text-slate-500">При текущих ставках</div>
                </div>
                <div className="border border-slate-100 rounded-xl p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500 mb-1">12 месяцев</div>
                  <div className="text-xl font-semibold text-slate-900">{formatCurrency(totals.yearlyInterest, 0)}</div>
                  <div className="text-xs text-slate-500">Без учета снижения ставки</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-600">
                Используйте снижение ключевой ставки в калькуляторе ставок, чтобы сразу увидеть экономию по процентам.
              </div>
              <button
                className="mt-3 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                onClick={() => navigate('/margin/floating-rates')}
              >
                Управление ставками ЦБ
              </button>
            </div>
          </section>
        </>
      )}
    </MarginPageShell>
  );
}

function StatCard({ label, value, helper, tone = 'slate' }) {
  const toneClasses = {
    slate: 'bg-slate-50 text-slate-800 border-slate-100',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-100',
    amber: 'bg-amber-50 text-amber-900 border-amber-100',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-100',
    rose: 'bg-rose-50 text-rose-800 border-rose-100',
    blue: 'bg-blue-50 text-blue-800 border-blue-100',
  }[tone] || 'bg-slate-50 text-slate-800 border-slate-100';

  return (
    <div className={`rounded-2xl border ${toneClasses} px-4 py-3 shadow-sm`}>
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-1">{label}</div>
      <div className="text-lg number-unified">{value}</div>
      <div className="text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function PositionCard({ trade, formatCurrency, onOpen }) {
  const totalCost = Number(trade.entryPrice || 0) * Number(trade.quantity || 0);
  const borrowed = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : totalCost;
  const ltv = totalCost > 0 ? (borrowed / totalCost) * 100 : 0;
  const interestPerDay = borrowed * Number(trade.marginAmount || 0) / 100 / 365;
  const entryDate = trade.entryDate
    ? format(new Date(trade.entryDate), 'd MMM yyyy', { locale: ru })
    : '—';

  return (
    <div className="border border-slate-100 rounded-2xl p-4 hover:shadow-md transition cursor-pointer" onClick={onOpen}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-lg font-semibold text-slate-900">{trade.symbol}</div>
        <span className="text-xs px-3 py-1 rounded-full bg-slate-900 text-white">Маржа {trade.marginAmount}%</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">Вход {entryDate}</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-slate-500">Экспозиция</div>
          <div className="font-semibold">{formatCurrency(totalCost, 0)}</div>
        </div>
        <div>
          <div className="text-slate-500">Заёмные</div>
          <div className="font-semibold">{formatCurrency(borrowed, 0)}</div>
        </div>
        <div>
          <div className="text-slate-500">LTV</div>
          <div className="font-semibold">{ltv.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-slate-500">Проценты/день</div>
          <div className="font-semibold">{formatCurrency(interestPerDay, 0)}</div>
        </div>
      </div>
    </div>
  );
}

export default MarginDashboard;
