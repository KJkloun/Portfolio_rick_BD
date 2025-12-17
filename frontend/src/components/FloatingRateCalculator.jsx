import { useState, useEffect, useCallback } from 'react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import axios from 'axios';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import MarginPageShell from './margin/MarginPageShell';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function FloatingRateCalculator() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [rateChanges, setRateChanges] = useState([]);
  const [updating, setUpdating] = useState(false);
  const [success, setSuccess] = useState('');

  // Форма для добавления нового изменения ставки
  const [newRate, setNewRate] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [viewMode, setViewMode] = useState('trade'); // 'overall' | 'symbol' | 'trade'
  const [selectedSymbol, setSelectedSymbol] = useState('');

  // Загрузка сделок
  const loadTrades = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/trades');
      
      // Фильтруем только открытые сделки и добавляем totalCost
      const openTrades = response.data
        .filter(trade => !trade.exitDate)
        .map(trade => ({
          ...trade,
          totalCost: Number(trade.entryPrice) * Number(trade.quantity)
        }));
      setTrades(openTrades);
      
      if (openTrades.length > 0 && !selectedTrade) {
        setSelectedTrade(openTrades[0]);
      }
    } catch (err) {
      console.error('Ошибка загрузки сделок:', err);
      setError('Ошибка загрузки сделок: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTrade]);

  // Загрузка данных при монтировании
  useEffect(() => {
    loadTrades();
    
    // Загружаем сохраненные изменения ставок
    const savedRates = localStorage.getItem('cbRateChanges');
    if (savedRates) {
      try {
        setRateChanges(JSON.parse(savedRates));
      } catch (e) {
        console.error('Ошибка парсинга сохраненных ставок:', e);
      }
    }
  }, [loadTrades]);

  // Сохранение изменений ставок
  const saveRateChanges = (rates) => {
    localStorage.setItem('cbRateChanges', JSON.stringify(rates));
    
    // Отправляем событие для обновления других компонентов
    window.dispatchEvent(new CustomEvent('rateChangesUpdated', {
      detail: {
        rateChanges: rates,
        source: 'central-bank-rates'
      }
    }));
  };

  // Добавление нового изменения ставки
  const addRateChange = () => {
    if (!newRate || !newDate || !newReason) {
      setError('Заполните все поля');
      return;
    }

    const newChange = {
      id: Date.now(),
      date: newDate,
      rate: parseFloat(newRate),
      reason: newReason
    };

    const updatedRates = [...rateChanges, newChange].sort((a, b) => new Date(a.date) - new Date(b.date));
    setRateChanges(updatedRates);
    saveRateChanges(updatedRates);

    // Очищаем форму
    setNewRate('');
    setNewDate('');
    setNewReason('');
    setShowForm(false);
    setError('');
    setSuccess('✅ Изменение ставки добавлено');
    setTimeout(() => setSuccess(''), 3000);
  };

  // Удаление изменения ставки
  const removeRateChange = (id) => {
    const updatedRates = rateChanges.filter(rate => rate.id !== id);
    setRateChanges(updatedRates);
    saveRateChanges(updatedRates);
  };

  const getPrincipal = (trade) => {
    if (!trade) return 0;
    if (trade.borrowedAmount != null) return Number(trade.borrowedAmount);
    if (trade.totalCost != null) return Number(trade.totalCost);
    if (trade.entryPrice && trade.quantity) return Number(trade.entryPrice) * Number(trade.quantity);
    return 0;
  };

  // Получение ставки для конкретной сделки на определенную дату
  const getRateForTradeOnDate = (trade, date) => {
    const tradeDate = new Date(trade.entryDate);
    const checkDate = new Date(date);
    
    // Если дата раньше открытия сделки, возвращаем исходную ставку сделки
    if (checkDate < tradeDate) {
      return Number(trade.marginAmount);
    }
    
    // Ищем последнее изменение ставки до этой даты
    const applicableChanges = rateChanges
      .filter(change => new Date(change.date) <= checkDate && new Date(change.date) >= tradeDate)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (applicableChanges.length > 0) {
      return applicableChanges[0].rate;
    }
    
    // Если изменений нет, возвращаем исходную ставку сделки
    return Number(trade.marginAmount);
  };

  // Расчет деталей по выбранной сделке
  const calculateTradeDetails = (trade) => {
    if (!trade) return null;

    const entryDate = new Date(trade.entryDate);
    const today = new Date();
    const daysHeld = differenceInDays(today, entryDate);
    
    // Создаем периоды для расчета процентов
    const periods = [];
    let currentDate = entryDate;
    let totalInterest = 0;

    // Добавляем изменения ставок, которые применяются к этой сделке
    const applicableChanges = rateChanges
      .filter(change => new Date(change.date) >= entryDate)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Первый период: от открытия сделки до первого изменения ставки (или до сегодня)
    const firstChangeDate = applicableChanges.length > 0 ? new Date(applicableChanges[0].date) : today;
    const firstPeriodEnd = firstChangeDate > today ? today : firstChangeDate;
    
    if (currentDate < firstPeriodEnd) {
      const periodDays = differenceInDays(firstPeriodEnd, currentDate);
      if (periodDays > 0) {
        const dailyRate = Number(trade.marginAmount) / 100 / 365;
        const periodInterest = getPrincipal(trade) * dailyRate * periodDays;
        
        periods.push({
          startDate: currentDate,
          endDate: firstPeriodEnd,
          days: periodDays,
          rate: Number(trade.marginAmount),
          interest: periodInterest,
          reason: 'Исходная ставка сделки'
        });

        totalInterest += periodInterest;
      }
      currentDate = firstPeriodEnd;
    }

    // Последующие периоды для каждого изменения ставки
    for (let i = 0; i < applicableChanges.length && currentDate < today; i++) {
      const change = applicableChanges[i];
      const changeDate = new Date(change.date);
      const nextChangeDate = i < applicableChanges.length - 1 
        ? new Date(applicableChanges[i + 1].date) 
        : today;

      const periodStart = currentDate > changeDate ? currentDate : changeDate;
      const periodEnd = nextChangeDate > today ? today : nextChangeDate;

      if (periodStart < periodEnd) {
        const periodDays = differenceInDays(periodEnd, periodStart);
        if (periodDays > 0) {
          const dailyRate = change.rate / 100 / 365;
        const periodInterest = getPrincipal(trade) * dailyRate * periodDays;
          
          periods.push({
            startDate: periodStart,
            endDate: periodEnd,
            days: periodDays,
            rate: change.rate,
            interest: periodInterest,
            reason: change.reason
          });

          totalInterest += periodInterest;
        }
      }

      currentDate = periodEnd;
    }

    return {
      trade,
      daysHeld,
      totalInterest,
      periods,
      currentRate: getRateForTradeOnDate(trade, today),
      savingsFromRateChanges: calculateSavings(trade)
    };
  };

  // Расчет экономии от снижения ставок
  const calculateSavings = (trade) => {
    const entryDate = new Date(trade.entryDate);
    const today = new Date();
    const originalRate = Number(trade.marginAmount);
    const currentRate = getRateForTradeOnDate(trade, today);
    const daysHeld = differenceInDays(today, entryDate);
    
    if (currentRate >= originalRate) return 0;
    
    const principal = getPrincipal(trade);
    const originalDailyInterest = principal * originalRate / 100 / 365;
    const currentDailyInterest = principal * currentRate / 100 / 365;
    
    return (originalDailyInterest - currentDailyInterest) * daysHeld;
  };

  // Подготовка данных для графика изменения ставок
  const prepareRateChartData = () => {
    if (!selectedTrade) return null;

    const entryDate = new Date(selectedTrade.entryDate);
    const today = new Date();
    const data = [];
    const labels = [];

    // Создаем точки для графика
    let currentDate = new Date(entryDate);
    while (currentDate <= today) {
      const rate = getRateForTradeOnDate(selectedTrade, currentDate);
      labels.push(format(currentDate, 'dd.MM', { locale: ru }));
      data.push(rate);
      
      // Переходим к следующей неделе
      currentDate.setDate(currentDate.getDate() + 7);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Ставка %',
          data,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4,
        }
      ]
    };
  };

  // Подготовка данных для графика накопленных процентов
  const prepareInterestChartData = () => {
    if (!selectedTrade) return null;

    const tradeDetails = calculateTradeDetails(selectedTrade);
    if (!tradeDetails) return null;

    const labels = tradeDetails.periods.map(p => 
      `${format(p.startDate, 'dd.MM', { locale: ru })} - ${format(p.endDate, 'dd.MM', { locale: ru })}`
    );
    
    const data = tradeDetails.periods.map(p => p.interest);

    return {
      labels,
      datasets: [
        {
          label: 'Проценты ₽',
          data,
          backgroundColor: data.map((_, index) => 
            index === 0 ? '#ef4444' : '#10b981'
          ),
        }
      ]
    };
  };

  // Объект с функцией для создания графика платежей, принимает произвольный список сделок
  const prepareDailyPaymentsChartDataGeneric = (list) => {
    if (list.length === 0) return null;
    const days = [];
    const payments = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      let dailyTotal = 0;
      list.forEach(trade => {
        const entryDate = new Date(trade.entryDate);
        if (date >= entryDate) {
          const currentRate = getRateForTradeOnDate(trade, date);
          const dailyInterest = getPrincipal(trade) * currentRate / 100 / 365;
          dailyTotal += dailyInterest;
        }
      });
      days.push(format(date, 'dd.MM', { locale: ru }));
      payments.push(Math.round(dailyTotal));
    }
    return {
      labels: days,
      datasets: [
        {
          label: 'Ежедневные выплаты ₽',
          data: payments,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4,
          fill: true,
        }
      ]
    };
  };

  const overallPaymentsData = prepareDailyPaymentsChartDataGeneric(trades);
  const symbolPaymentsData = selectedSymbol ? prepareDailyPaymentsChartDataGeneric(trades.filter(t=>t.symbol===selectedSymbol)) : null;

  const tradeDetails = selectedTrade ? calculateTradeDetails(selectedTrade) : null;
  const rateChartData = prepareRateChartData();
  const interestChartData = prepareInterestChartData();

  const availableSymbols = Array.from(new Set(trades.map(t => t.symbol))).sort();

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        beginAtZero: true,
        grid: { display: false },
        ticks: {
          color: '#9ca3af',
          callback: (value) => `₽${value}`
        }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#9ca3af' }
      }
    }
  };

  const computeAggregatedDetails = (list) => {
    if(!list || list.length === 0) return null;
    let daysSum = 0;
    let rateSum = 0;
    let interestSum = 0;
    let savingsSum = 0;
    list.forEach(tr => {
      const det = calculateTradeDetails(tr);
      daysSum += det.daysHeld;
      rateSum += det.currentRate;
      interestSum += det.totalInterest;
      savingsSum += det.savingsFromRateChanges;
    });
    return {
      daysHeld: Math.round(daysSum / list.length),
      currentRate: (rateSum / list.length).toFixed(1),
      totalInterest: interestSum,
      savings: savingsSum
    };
  };

  const overallDetails = computeAggregatedDetails(trades);
  const symbolDetails = viewMode==='symbol' && selectedSymbol ? computeAggregatedDetails(trades.filter(t=>t.symbol===selectedSymbol)) : null;
  const aggregatedChartData = viewMode==='overall' ? overallPaymentsData : symbolPaymentsData;

  // --- Aggregation helpers for rate/interest charts and periods table ---
  const aggregatePeriods = (list) => {
    const aggregated = {};
    list.forEach(tr => {
      const det = calculateTradeDetails(tr);
      det.periods.forEach(p => {
        const key = `${p.startDate}_${p.endDate}_${p.rate}`;
        if(!aggregated[key]) {
          aggregated[key] = { ...p };
        } else {
          aggregated[key].interest += p.interest;
          aggregated[key].days += p.days;
        }
      });
    });
    return Object.values(aggregated).sort((a,b)=> new Date(a.startDate) - new Date(b.startDate));
  };

  const prepareAggregatedRateChartData = (periods) => {
    if(!periods || periods.length===0) return null;
    const labels = [];
    const data = [];
    periods.forEach((p,idx)=>{
      labels.push(format(new Date(p.startDate), 'dd.MM', {locale:ru}));
      data.push(p.rate);
      if(idx===periods.length-1){
        labels.push(format(new Date(p.endDate), 'dd.MM', {locale:ru}));
        data.push(p.rate);
      }
    });
    return {
      labels,
      datasets:[{
        label:'Ставка %',
        data,
        borderColor:'#3b82f6',
        backgroundColor:'rgba(59,130,246,0.1)',
        tension:0,
        pointRadius:2
      }]
    };
  };

  const prepareAggregatedInterestChartData = (periods) => {
    if(!periods || periods.length===0) return null;
    const first = periods[0];
    const restSum = periods.slice(1).reduce((sum,p)=>sum+p.interest,0);
    return {
      labels:[`${format(new Date(first.startDate),'dd.MM', {locale:ru})} - ${format(new Date(first.endDate),'dd.MM',{locale:ru})}`, 'Остальные'],
      datasets:[{
        label:'Проценты ₽',
        data:[Math.round(first.interest), Math.round(restSum)],
        backgroundColor:['#ef4444','#10b981']
      }]
    };
  };

  const overallPeriods = aggregatePeriods(trades);
  const symbolPeriods = viewMode==='symbol' && selectedSymbol ? aggregatePeriods(trades.filter(t=>t.symbol===selectedSymbol)) : [];

  const overallRateChartData = prepareAggregatedRateChartData(overallPeriods);
  const overallInterestChartData = prepareAggregatedInterestChartData(overallPeriods);
  const symbolRateChartData = prepareAggregatedRateChartData(symbolPeriods);
  const symbolInterestChartData = prepareAggregatedInterestChartData(symbolPeriods);
  const openTrades = trades.filter(t => !t.exitDate);
  const avgOpenRate = openTrades.length
    ? openTrades.reduce((s, t) => s + Number(t.marginAmount || 0), 0) / openTrades.length
    : 0;

  if (loading) {
    return (
      <MarginPageShell title="Ставки ЦБ/финансирования" subtitle="Загрузка..." badge="Rates">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-300"></div>
        </div>
      </MarginPageShell>
    );
  }

  if(false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
        <div className="container-fluid p-4 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h3 className="text-2xl font-light text-gray-800 mb-2">Ставки ЦБ РФ</h3>
            <p className="text-gray-500">Анализ процентных выплат</p>
          </div>

          {/* Переключатель режимов */}
          <div className="mb-4 flex gap-2">
            {['overall','symbol','trade'].map(m => (
              <button key={m} onClick={()=>setViewMode(m)} className={`px-3 py-1.5 rounded-lg text-sm ${viewMode===m ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}>{m==='overall' ? 'Общая' : m==='symbol' ? 'По акциям' : 'По сделкам'}</button>
            ))}
          </div>

          {viewMode==='overall' && (
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden p-4">
              <h6 className="text-base font-medium text-gray-700 mb-1">Ежедневные выплаты (все сделки)</h6>
              {overallPaymentsData && (
                <Line data={overallPaymentsData} options={chartOptions} height={220} />
              )}
            </div>
          )}

          {viewMode==='symbol' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm mr-2">Акция:</label>
                <select value={selectedSymbol} onChange={e=>setSelectedSymbol(e.target.value)} className="border px-2 py-1 rounded">
                  <option value="">-- выберите --</option>
                  {availableSymbols.map(s=>(<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              {selectedSymbol && symbolPaymentsData && (
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden p-4">
                  <h6 className="text-base font-medium text-gray-700 mb-1">Ежедневные выплаты — {selectedSymbol}</h6>
                  <Line data={symbolPaymentsData} options={chartOptions} height={220} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <MarginPageShell
      title="Ставки ЦБ РФ"
      subtitle="Управление изменениями ставки и анализ влияния на открытые позиции"
      badge="Rates"
      actions={
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => setViewMode('trade')}
            className={`px-4 py-2 rounded-lg text-sm ${viewMode === 'trade' ? 'bg-gray-900 text-white' : 'bg-white/70 border border-gray-200 text-gray-700'}`}
          >
            По сделке
          </button>
          <button 
            onClick={() => setViewMode('overall')}
            className={`px-4 py-2 rounded-lg text-sm ${viewMode === 'overall' ? 'bg-gray-900 text-white' : 'bg-white/70 border border-gray-200 text-gray-700'}`}
          >
            По всем
          </button>
          <button 
            onClick={() => setViewMode('symbol')}
            className={`px-4 py-2 rounded-lg text-sm ${viewMode === 'symbol' ? 'bg-gray-900 text-white' : 'bg-white/70 border border-gray-200 text-gray-700'}`}
          >
            По тикеру
          </button>
        </div>
      }
    >

      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Открытые сделки" value={openTrades.length} />
        <SummaryCard label="Средняя ставка" value={`${avgOpenRate.toFixed(1)}%`} />
        <SummaryCard label="Изменений ставки" value={rateChanges.length} />
        <SummaryCard label="Режим" value={viewMode === 'trade' ? 'По сделке' : viewMode === 'symbol' ? 'По тикеру' : 'Общий'} />
      </div>

        {/* Переключатель режимов (перемещён в блок "Открытые позиции") */}
        {false && (<div className="mb-4 flex gap-2">
          {['overall','symbol','trade'].map(m => (
            <button key={m} onClick={()=>setViewMode(m)} className={`px-3 py-1.5 rounded-lg text-sm ${viewMode===m ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}>{m==='overall' ? 'Общая' : m==='symbol' ? 'По акциям' : 'По сделкам'}</button>
          ))}
        </div>)}

        {/* Rate Changes Management and Daily Payments */}
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Rate Changes Management */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h6 className="text-base font-medium text-gray-700 mb-1">История изменений ставки</h6>
                  <p className="text-xs text-gray-400">Добавляйте и отслеживайте изменения ключевой ставки ЦБ РФ</p>
                </div>
                <button 
                  className="px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-all duration-300 font-medium text-xs shadow-sm hover:shadow-md"
                  onClick={() => setShowForm(!showForm)}
                >
                  {showForm ? 'Отменить' : '+ Добавить'}
                </button>
              </div>
              
              {showForm && (
                <div className="mb-3 p-3 bg-gray-50/50 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Дата</label>
                      <input
                        type="date"
                        className="w-full px-2 py-1.5 border-0 bg-white rounded-md focus:ring-2 focus:ring-gray-300 focus:outline-none text-xs shadow-sm"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ставка (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full px-2 py-1.5 border-0 bg-white rounded-md focus:ring-2 focus:ring-gray-300 focus:outline-none text-xs shadow-sm"
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                        placeholder="21.0"
                      />
                    </div>
                    <div className="md:col-span-5">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Причина</label>
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 border-0 bg-white rounded-md focus:ring-2 focus:ring-gray-300 focus:outline-none text-xs shadow-sm"
                        value={newReason}
                        onChange={(e) => setNewReason(e.target.value)}
                        placeholder="Решение Совета директоров..."
                      />
                    </div>
                    <div className="md:col-span-2 flex items-end">
                      <button 
                        className="w-full px-2 py-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-all duration-300 font-medium text-xs shadow-sm"
                        onClick={addRateChange}
                      >
                        Сохранить
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="max-h-[200px] overflow-y-auto">
                {rateChanges.length > 0 ? (
                  <div className="space-y-1.5">
                    {rateChanges.map((rate) => (
                      <div key={rate.id} className="flex items-center justify-between p-2.5 bg-white/80 rounded-lg shadow-sm hover:shadow-md transition-all duration-300">
                        <div className="flex items-center space-x-3">
                          <div className="text-center">
                            <div className="text-sm font-light text-gray-800">{rate.rate}%</div>
                            <div className="text-xs text-gray-400">ставка</div>
                          </div>
                          <div className="h-6 w-px bg-gray-200"></div>
                          <div>
                            <div className="font-medium text-gray-800 text-sm">
                              {format(new Date(rate.date), 'dd MMM yyyy', { locale: ru })}
                            </div>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]">{rate.reason}</div>
                          </div>
                        </div>
                        <button
                          className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-md transition-all duration-300"
                          onClick={() => removeRateChange(rate.id)}
                          title="Удалить"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100/80 rounded-full mb-3">
                      <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-medium text-gray-600 mb-1">Нет данных об изменениях ставки</h3>
                    <p className="text-xs text-gray-400 max-w-md mx-auto">Добавьте первое изменение ставки ЦБ РФ</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Daily Payments Chart */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
            <div className="px-4 py-3">
              <h6 className="text-base font-medium text-gray-700 mb-1">Ежедневные выплаты по всем позициям</h6>
              <p className="text-xs text-gray-400 mb-3">Общая сумма ежедневных процентных выплат за последние 30 дней</p>
            </div>
            <div className="px-4 pb-3">
              {overallPaymentsData && (
                <Line 
                  data={overallPaymentsData} 
                  options={chartOptions}
                  height={180}
                />
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50/80 border-0 rounded-xl backdrop-blur-sm">
            <div className="flex items-center">
              <svg className="w-4 h-4 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-700 font-medium text-sm">{error}</span>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-50/80 border-0 rounded-xl backdrop-blur-sm">
            <div className="flex items-center">
              <svg className="w-4 h-4 text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-green-700 font-medium text-sm">{success}</span>
            </div>
          </div>
        )}

        {/* Analysis Section */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Trades List */}
          <div className="lg:col-span-2">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden h-[700px] flex flex-col">
              <div className="px-4 py-3">
                <h6 className="text-lg font-medium text-gray-700 mb-1">Открытые позиции</h6>
                <p className="text-sm text-gray-400 mb-3">{trades.length} активных позиций</p>

                {/* Кнопки режима статистики */}
                <div className="flex gap-2 flex-wrap mb-2">
                  {['trade','symbol','overall'].map(m => (
                    <button
                      key={m}
                      onClick={() => setViewMode(m)}
                      className={`px-2 py-0.5 rounded text-xs transition-all ${viewMode===m ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                      {m==='trade' ? 'По сделкам' : m==='symbol' ? 'По акциям' : 'Общая'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {viewMode==='trade' && trades.map(tr => {
                  const details=calculateTradeDetails(tr);
                  const isSelected = selectedTrade?.id===tr.id;
                  return (
                    <div key={tr.id} className={`p-2 cursor-pointer transition-all duration-300 mx-2 mb-1 rounded-xl text-sm ${isSelected?'bg-gray-100 border border-gray-200 shadow-sm':'bg-white/50 hover:bg-white/80 hover:shadow-sm'}`} onClick={()=>setSelectedTrade(tr)}>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <h6 className="font-semibold text-sm">{tr.symbol}</h6>
                          <p className="text-xs text-gray-500">{tr.quantity.toLocaleString()} × ₽{tr.entryPrice}</p>
                        </div>
                        <div className="text-right text-xs text-gray-400">{format(new Date(tr.entryDate),'dd.MM.yy')}</div>
                          </div>
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <div><span className="text-gray-500">Сумма:</span><div className="font-medium">₽{(tr.totalCost/1000).toFixed(0)}k</div></div>
                        <div><span className="text-gray-500">Ставка:</span><div className="inline-block px-1 py-0.5 rounded bg-gray-100 text-gray-600">{details.currentRate}%</div></div>
                        <div><span className="text-gray-500">Накоплено:</span><div className="font-semibold text-red-500">₽{(Math.round(details.totalInterest)/1000).toFixed(0)}k</div></div>
                        </div>
                      </div>
                  );
                })}

                {viewMode==='symbol' && availableSymbols.map(sym=>{
                  const list=trades.filter(t=>t.symbol===sym);
                  const agg=computeAggregatedDetails(list);
                  return (
                    <div key={sym} className={`p-2 cursor-pointer transition-all duration-300 mx-2 mb-1 rounded-xl text-sm ${selectedSymbol===sym?'bg-gray-100 border border-gray-200 shadow-sm':'bg-white/50 hover:bg-white/80 hover:shadow-sm'}`} onClick={()=>setSelectedSymbol(sym)}>
                      <div className="flex justify-between items-center">
                        <h6 className="font-semibold text-sm">{sym}</h6>
                        <span className="text-xs text-gray-400">{list.length} поз.</span>
                        </div>
                      <div className="grid grid-cols-3 gap-1 text-xs mt-1">
                        <div><span className="text-gray-500">Сумма:</span><div className="font-medium">₽{(list.reduce((s,t)=>s+t.totalCost,0)/1000).toFixed(0)}k</div></div>
                        <div><span className="text-gray-500">Ср. ставка:</span><div className="inline-block px-1 py-0.5 rounded bg-gray-100 text-gray-600">{agg.currentRate}%</div></div>
                        <div><span className="text-gray-500">Накоплено:</span><div className="font-semibold text-red-500">₽{(Math.round(agg.totalInterest)/1000).toFixed(0)}k</div></div>
                      </div>
                    </div>
                  );
                })}

                {viewMode==='overall' && (
                  <div className="p-2 mx-2 mb-1 rounded-xl bg-white/50 text-sm cursor-default">
                    <div className="flex justify-between items-center">
                      <h6 className="font-semibold text-sm">Все позиции</h6>
                      <span className="text-xs text-gray-400">{trades.length} поз.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Details and Charts */}
          <div className="lg:col-span-3">
            {viewMode==='trade' && tradeDetails ? (
              <div className="space-y-6">
                {/* Trade Overview */}
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                  <div className="px-6 py-4">
                    <h6 className="text-xl font-light text-gray-700 mb-4">{tradeDetails.trade.symbol}</h6>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-light text-gray-800">{tradeDetails.daysHeld}</div>
                        <div className="text-xs text-gray-400">дней удержания</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-blue-500">{tradeDetails.currentRate}%</div>
                        <div className="text-xs text-gray-400">текущая ставка</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-red-500">₽{Math.round(tradeDetails.totalInterest).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">накоплено процентов</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-green-500">₽{Math.round(tradeDetails.savingsFromRateChanges).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">экономия от ЦБ</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts - now only 2 charts for individual trade */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                    <div className="px-4 py-3">
                      <h6 className="text-sm font-medium text-gray-700 mb-2">Динамика ставки</h6>
                    </div>
                    <div className="px-4 pb-4">
                      {rateChartData && (
                        <Line 
                          data={rateChartData} 
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { display: false }
                            },
                            scales: {
                              y: {
                                beginAtZero: false,
                                grid: { display: false },
                                ticks: {
                                  color: '#9ca3af',
                                  font: { size: 10 },
                                  callback: function(value) { return value + '%'; }
                                }
                              },
                              x: {
                                grid: { display: false },
                                ticks: { 
                                  color: '#9ca3af',
                                  font: { size: 10 }
                                }
                              }
                            }
                          }}
                          height={150}
                        />
                      )}
                    </div>
                  </div>

                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                    <div className="px-4 py-3">
                      <h6 className="text-sm font-medium text-gray-700 mb-2">Проценты по периодам</h6>
                    </div>
                    <div className="px-4 pb-4">
                      {interestChartData && (
                        <Bar 
                          data={interestChartData} 
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { display: false }
                            },
                            scales: {
                              y: {
                                beginAtZero: true,
                                grid: { display: false },
                                ticks: {
                                  color: '#9ca3af',
                                  font: { size: 10 },
                                  callback: function(value) { return '₽' + value.toLocaleString(); }
                                }
                              },
                              x: {
                                grid: { display: false },
                                ticks: { 
                                  color: '#9ca3af',
                                  font: { size: 9 },
                                  maxRotation: 45 
                                }
                              }
                            }
                          }}
                          height={150}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Periods Details */}
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                  <div className="px-6 py-4">
                    <h6 className="text-lg font-medium text-gray-700 mb-4">Детализация периодов</h6>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Период</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дни</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Ставка</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Проценты</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Тип</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradeDetails.periods.map((period, index) => (
                          <tr key={index} className="hover:bg-gray-50/50 transition-colors duration-200">
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {format(period.startDate, 'dd.MM.yy')} - {format(period.endDate, 'dd.MM.yy')}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 font-medium">{period.days}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                index === 0 
                                  ? 'bg-gray-100 text-gray-600' 
                                  : 'bg-blue-100 text-blue-600'
                              }`}>
                                {period.rate}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-red-500">
                              ₽{Math.round(period.interest).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">{period.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Aggregated views */}
            {viewMode==='overall' && overallDetails && (
              <div className="space-y-6">
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                  <div className="px-6 py-4">
                    <h6 className="text-xl font-light text-gray-700 mb-4">Все открытые позиции</h6>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center">
                        <div className="text-2xl font-light text-gray-800">{overallDetails.daysHeld}</div>
                        <div className="text-xs text-gray-400">среднее дней</div>
                  </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-blue-500">{overallDetails.currentRate}%</div>
                        <div className="text-xs text-gray-400">средняя ставка</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-red-500">₽{Math.round(overallDetails.totalInterest).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">накоплено процентов</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-green-500">₽{Math.round(overallDetails.savings).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">экономия от ЦБ</div>
                      </div>
                    </div>
                  </div>
                </div>
                {(overallRateChartData && overallInterestChartData) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                      <div className="px-4 py-3"><h6 className="text-sm font-medium text-gray-700 mb-2">Динамика ставки</h6></div>
                      <div className="px-4 pb-4"><Line data={overallRateChartData} options={chartOptions} height={150} /></div>
                    </div>
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                      <div className="px-4 py-3"><h6 className="text-sm font-medium text-gray-700 mb-2">Проценты по периодам</h6></div>
                      <div className="px-4 pb-4"><Bar data={overallInterestChartData} options={chartOptions} height={150} /></div>
                </div>
              </div>
            )}

                {/* Periods table */}
                {viewMode==='symbol' && overallPeriods.length>0 && (
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                    <div className="px-6 py-4"><h6 className="text-lg font-medium text-gray-700 mb-4">Детализация периодов</h6></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Период</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дни</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Ставка</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Проценты</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overallPeriods.map((p,idx)=>(
                            <tr key={idx} className="border-t">
                              <td className="px-6 py-2">{format(new Date(p.startDate),'dd.MM.yy',{locale:ru})} – {format(new Date(p.endDate),'dd.MM.yy',{locale:ru})}</td>
                              <td className="px-4 py-2">{p.days}</td>
                              <td className="px-4 py-2"><span className="inline-block px-1 py-0.5 rounded bg-gray-100 text-gray-600">{p.rate}%</span></td>
                              <td className="px-4 py-2 text-red-600">₽{Math.round(p.interest).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
          </div>
        </div>
                )}
              </div>
            )}

            {viewMode==='symbol' && symbolDetails && (
              <div className="space-y-6">
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                  <div className="px-6 py-4">
                    <h6 className="text-xl font-light text-gray-700 mb-4">{selectedSymbol}</h6>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-light text-gray-800">{symbolDetails.daysHeld}</div>
                        <div className="text-xs text-gray-400">среднее дней</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-blue-500">{symbolDetails.currentRate}%</div>
                        <div className="text-xs text-gray-400">средняя ставка</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-red-500">₽{Math.round(symbolDetails.totalInterest).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">накоплено процентов</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-light text-green-500">₽{Math.round(symbolDetails.savings).toLocaleString()}</div>
                        <div className="text-xs text-gray-400">экономия от ЦБ</div>
                      </div>
                    </div>
                  </div>
                </div>
                {symbolRateChartData && symbolInterestChartData && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                      <div className="px-4 py-3"><h6 className="text-sm font-medium text-gray-700 mb-2">Динамика ставки</h6></div>
                      <div className="px-4 pb-4"><Line data={symbolRateChartData} options={chartOptions} height={150} /></div>
                    </div>
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border-0 overflow-hidden">
                      <div className="px-4 py-3"><h6 className="text-sm font-medium text-gray-700 mb-2">Проценты по периодам</h6></div>
                      <div className="px-4 pb-4"><Bar data={symbolInterestChartData} options={chartOptions} height={150} /></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {['overall','symbol'].includes(viewMode) && !aggregatedChartData && (
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm p-6 text-center text-sm text-gray-500">
                Нет данных для выбранного режима
              </div>
            )}
          </div>
        </div>
    </MarginPageShell>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-100 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export default FloatingRateCalculator; 
