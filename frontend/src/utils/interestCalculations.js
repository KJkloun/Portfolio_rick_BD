import { differenceInDays } from 'date-fns';

/**
 * Расчет накопленных процентов для сделки с учетом изменений ставок ЦБ РФ
 * @param {Object} trade - Сделка
 * @param {Array} rateChanges - Массив изменений ставок ЦБ РФ
 * @returns {number} - Накопленные проценты в рублях
 */
export const calculateAccumulatedInterest = (trade, rateChanges = []) => {
  if (!trade || !trade.entryDate) return 0;

  const entryDate = new Date(trade.entryDate);
  // Для закрытых сделок используем exitDate, для открытых - сегодняшнюю дату
  const endDate = trade.exitDate ? new Date(trade.exitDate) : new Date();
  const totalCost = Number(trade.entryPrice) * Number(trade.quantity);
  const principal = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : totalCost;
  
  // Получаем изменения ставок, которые применяются к этой сделке
  const applicableChanges = rateChanges
    .filter(change => new Date(change.date) >= entryDate && new Date(change.date) <= endDate)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let currentDate = entryDate;
  let totalInterest = 0;

  // Первый период: от открытия сделки до первого изменения ставки (или до закрытия/сегодня)
  const firstChangeDate = applicableChanges.length > 0 ? new Date(applicableChanges[0].date) : endDate;
  const firstPeriodEnd = firstChangeDate > endDate ? endDate : firstChangeDate;
  
  if (currentDate < firstPeriodEnd) {
    const periodDays = differenceInDays(firstPeriodEnd, currentDate);
    if (periodDays > 0) {
      const dailyRate = Number(trade.marginAmount) / 100 / 365;
      const periodInterest = principal * dailyRate * periodDays;
      totalInterest += periodInterest;
    }
    currentDate = firstPeriodEnd;
  }

  // Последующие периоды для каждого изменения ставки
  for (let i = 0; i < applicableChanges.length && currentDate < endDate; i++) {
    const change = applicableChanges[i];
    const changeDate = new Date(change.date);
    const nextChangeDate = i < applicableChanges.length - 1 
      ? new Date(applicableChanges[i + 1].date) 
      : endDate;

    const periodStart = currentDate > changeDate ? currentDate : changeDate;
    const periodEnd = nextChangeDate > endDate ? endDate : nextChangeDate;

    if (periodStart < periodEnd) {
      const periodDays = differenceInDays(periodEnd, periodStart);
      if (periodDays > 0) {
        const dailyRate = change.rate / 100 / 365;
        const periodInterest = principal * dailyRate * periodDays;
        totalInterest += periodInterest;
      }
    }

    currentDate = periodEnd;
  }

  return totalInterest;
};

/**
 * Получение изменений ставок из localStorage
 * @returns {Array} - Массив изменений ставок
 */
export const getRateChangesFromStorage = () => {
  try {
    const savedRates = localStorage.getItem('cbRateChanges');
    return savedRates ? JSON.parse(savedRates) : [];
  } catch (e) {
    console.error('Ошибка загрузки изменений ставок:', e);
    return [];
  }
};

/**
 * Расчет экономии от снижения ставок для сделки
 * @param {Object} trade - Сделка
 * @param {Array} rateChanges - Массив изменений ставок ЦБ РФ
 * @returns {number} - Экономия в рублях
 */
export const calculateSavingsFromRateChanges = (trade, rateChanges = []) => {
  if (!trade || !trade.entryDate) return 0;

  const entryDate = new Date(trade.entryDate);
  // Для закрытых сделок используем exitDate, для открытых - сегодняшнюю дату
  const endDate = trade.exitDate ? new Date(trade.exitDate) : new Date();
  const totalCost = Number(trade.entryPrice) * Number(trade.quantity);
  const principal = trade.borrowedAmount != null ? Number(trade.borrowedAmount) : totalCost;
  const originalRate = Number(trade.marginAmount);
  const daysHeld = differenceInDays(endDate, entryDate);
  
  // Находим последнее изменение ставки, применимое к этой сделке
  const applicableChanges = rateChanges
    .filter(change => new Date(change.date) >= entryDate && new Date(change.date) <= endDate)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
    
  if (applicableChanges.length === 0) return 0;
  
  const currentRate = applicableChanges[0].rate;
  
  if (currentRate >= originalRate) return 0;

  const originalDailyInterest = principal * originalRate / 100 / 365;
  const currentDailyInterest = principal * currentRate / 100 / 365;
  
  return (originalDailyInterest - currentDailyInterest) * daysHeld;
};

/**
 * Получить актуальную ставку для сделки на указанную дату
 * @param {Object} trade - сделка (entryDate, marginAmount)
 * @param {Date} date - дата, для которой нужна ставка (обычно сегодня)
 * @param {Array} rateChanges - массив изменений ставок ЦБ РФ {date, rate}
 * @returns {number} - ставка в процентах
 */
export const getRateForDate = (trade, date = new Date(), rateChanges = []) => {
  if (!trade?.entryDate) return Number(trade?.marginAmount || 0);
  const entryDate = new Date(trade.entryDate);
  // если дата до открытия сделки — базовая ставка сделки
  if (date < entryDate) return Number(trade.marginAmount || 0);

  const applicable = rateChanges
    .filter(r => {
      const d = new Date(r.date);
      return d <= date && d >= entryDate;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (applicable.length > 0) return Number(applicable[0].rate || trade.marginAmount || 0);
  return Number(trade.marginAmount || 0);
};
