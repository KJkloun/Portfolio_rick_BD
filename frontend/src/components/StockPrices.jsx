import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePortfolio } from '../contexts/PortfolioContext';
import { getCurrencySymbol } from '../utils/currencyFormatter';
import MarginPageShell from './margin/MarginPageShell';

function StockPrices() {
  const { currentPortfolio } = usePortfolio();
  const ruTickers = useMemo(() => new Set([
    'GAZP','ROSN','SBER','NVTK','GMKN','LKOH','SIBN','PLZL','PHOR','SNGS','TATN','NLMK','RUAL','CHMF','AKRN','VSMO',
    'PIKK','ALRS','MTSS','MGNT','TCSG','MAGN','HYDR','IRKT','UNAC','IRAO','VTBR','RTKM','RASP','MOEX','BANE','SMLT',
    'CBOM','NKNC','AFKS','SGZH','KZOS','MGTS','FEES','GCHE','NMTP','APTK','UPRO','FLOT','YAKG','FESH','MSNG','LSNG',
    'AVAN','KAZT','VKCO','POSI','GLTR','VK','AGRO'
  ]), []);
  const [trades, setTrades] = useState([]);
  const [stockPrices, setStockPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingLive, setLoadingLive] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [savingStock, setSavingStock] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const currency = currentPortfolio?.currency || 'RUB';
  const storageKey = useMemo(
    () => (currentPortfolio?.id ? `stockPrices_${currentPortfolio.id}` : 'stockPrices'),
    [currentPortfolio?.id]
  );
  const storageTsKey = useMemo(
    () => (currentPortfolio?.id ? `stockPrices_last_${currentPortfolio.id}` : 'stockPrices_last'),
    [currentPortfolio?.id]
  );

  useEffect(() => {
    loadTrades();
    loadSavedPrices();
  }, [currentPortfolio]);

  // Автообновление при наличии сделок + каждые 60 минут
  useEffect(() => {
    if (stocks.length > 0) {
      fetchLivePrices(true);
    }
    const interval = setInterval(() => fetchLivePrices(), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [trades]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

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
    } catch (err) {
      console.error('Error loading trades:', err);
      setError('Не удалось загрузить сделки');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  const stocks = useMemo(() => {
    const map = {};
    trades.forEach(trade => {
      const sym = trade.symbol;
      if (!map[sym]) {
        map[sym] = { trades: [], open: 0 };
      }
      map[sym].trades.push(trade);
      if (!trade.exitDate) map[sym].open += 1;
    });
    return Object.entries(map)
      .map(([symbol, data]) => {
        const sorted = [...data.trades].sort(
          (a, b) => new Date(b.entryDate || b.createdAt || 0) - new Date(a.entryDate || a.createdAt || 0)
        );
        const lastTrade = sorted[0];
        return {
          symbol,
          lastTradeDate: lastTrade?.entryDate || lastTrade?.createdAt,
          openPositions: data.open,
          totalPositions: data.trades.length,
          lastPrice: lastTrade?.entryPrice,
        };
      })
      .sort((a, b) => {
        if (a.openPositions > 0 && b.openPositions === 0) return -1;
        if (a.openPositions === 0 && b.openPositions > 0) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [trades]);

  const loadSavedPrices = () => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setStockPrices(JSON.parse(saved));
    } catch (e) {
      console.error('Error loading saved prices:', e);
    }
  };

  const updateStockPrice = (symbol, price) => {
    const updated = { ...stockPrices, [symbol]: price ? parseFloat(price) : '' };
    setStockPrices(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  const saveAsLastPrice = stock => {
    if (!stockPrices[stock.symbol] || isNaN(parseFloat(stockPrices[stock.symbol]))) {
      setError(`Введите корректный курс для ${stock.symbol}`);
      return;
    }
    setSavingStock(stock.symbol);
    try {
      const updated = { ...stockPrices, [stock.symbol]: parseFloat(stockPrices[stock.symbol]) };
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setSuccessMessage(`Курс для ${stock.symbol} сохранен`);
    } catch (err) {
      console.error('Error saving price:', err);
      setError(`Не удалось сохранить курс для ${stock.symbol}`);
    } finally {
      setSavingStock(null);
    }
  };

  const resetStockPrices = () => {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(storageTsKey);
    setStockPrices({});
    setSuccessMessage('Курсы сброшены');
  };

  const initializeDefaultPrices = () => {
    const defaults = {};
    stocks.forEach(s => {
      if (s.lastPrice) defaults[s.symbol] = parseFloat(s.lastPrice);
    });
    localStorage.setItem(storageKey, JSON.stringify(defaults));
    setStockPrices(defaults);
    setSuccessMessage('Курсы инициализированы последними ценами сделок');
  };

  const fetchLivePrices = async (force = false) => {
    if (!currentPortfolio) return;
    const tickers = stocks.map(s => s.symbol);
    if (tickers.length === 0) return;

    const now = Date.now();
    const lastTsRaw = localStorage.getItem(storageTsKey);
    const allHavePrices = tickers.every(t => stockPrices[t]);
    if (!force && lastTsRaw && allHavePrices) {
      const lastTs = parseInt(lastTsRaw, 10);
      if (!isNaN(lastTs) && now - lastTs < 10 * 60 * 1000) {
        setSuccessMessage('Котировки уже обновлялись менее 10 минут назад');
        return;
      }
    }

    setLoadingLive(true);
    try {
      const updated = { ...stockPrices };

      await Promise.all(
        tickers.map(async ticker => {
          if (!/^[A-Z]{1,6}$/.test(ticker)) {
            return;
          }
          if (['USD','EUR','USDT','BTC','BTCUSD'].includes(ticker)) {
            return;
          }
          // MOEX c таймаутом (только для российских тикеров)
          if (ruTickers.has(ticker)) {
            try {
              const moex = await axios.get('/api/prices/moex', { params: { ticker }, timeout: 10000 });
              if (moex.data?.price) {
                updated[ticker] = moex.data.price;
                return;
              }
            } catch (e) {
              // fallback to alpha
            }
          }
          try {
            const alpha = await axios.get('/api/prices/alpha', { params: { ticker }, timeout: 10000 });
            if (alpha.data?.price) {
              updated[ticker] = alpha.data.price;
            }
          } catch (e) {
            // ignore
          }
        })
      );
      setStockPrices(updated);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      localStorage.setItem(storageTsKey, String(now));
      setSuccessMessage('Котировки обновлены');
    } catch (e) {
      setError('Не удалось обновить котировки');
    } finally {
      setLoadingLive(false);
    }
  };

  const filteredStocks = stocks.filter(s => s.symbol.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) {
    return (
      <MarginPageShell title="Курсы акций" subtitle="Загрузка цен..." badge="Prices">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-300"></div>
        </div>
      </MarginPageShell>
    );
  }

  if (!currentPortfolio) {
    return (
      <MarginPageShell title="Курсы акций" subtitle="Портфель не выбран" badge="Prices">
        <div className="text-center space-y-3 py-12 text-slate-600">
          <p>Выберите портфель, чтобы управлять котировками.</p>
          <button
            className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition"
            onClick={() => (window.location.href = '/portfolios')}
          >
            К портфелям
          </button>
        </div>
      </MarginPageShell>
    );
  }

  return (
    <MarginPageShell
      title="Курсы акций"
      subtitle="Автообновление по MOEX / Alpha Vantage"
      badge="Prices"
      actions={
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() => fetchLivePrices(true)}
            disabled={loadingLive}
            className="px-3 py-2 text-sm text-white bg-slate-900 border border-slate-900 rounded-md hover:bg-slate-800 disabled:bg-slate-500"
          >
            {loadingLive ? 'Обновление...' : 'Обновить котировки'}
          </button>
          <button
            onClick={resetStockPrices}
            className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Сбросить
          </button>
          <button
            onClick={initializeDefaultPrices}
            className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Инициализировать
          </button>
          <div className="relative w-full sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-4 w-4 text-gray-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Поиск тикера..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
      }
    >
      <>
        {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Тикер</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Открытые</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Всего</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Последняя цена</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Последняя сделка</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Текущий курс</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Действия</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredStocks.map(stock => (
                  <tr key={stock.symbol} className={stock.openPositions > 0 ? 'bg-blue-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{stock.symbol}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{stock.openPositions}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stock.totalPositions}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stock.lastPrice ? `${getCurrencySymbol(currency)}${Number(stock.lastPrice).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stock.lastTradeDate ? format(new Date(stock.lastTradeDate), 'd MMM yyyy', { locale: ru }) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="relative rounded-md w-32">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500 text-sm">{getCurrencySymbol(currency)}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={stockPrices[stock.symbol] || ''}
                          onChange={e => updateStockPrice(stock.symbol, e.target.value)}
                          className="w-full pl-7 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-gray-400"
                          placeholder="0.00"
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <button
                        onClick={() => saveAsLastPrice(stock)}
                        disabled={savingStock === stock.symbol || !stockPrices[stock.symbol]}
                        className="px-3 py-2 text-sm text-white bg-gray-700 border border-gray-700 rounded-md hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        {savingStock === stock.symbol ? 'Сохранение...' : 'Сохранить'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredStocks.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-8 text-center text-sm text-gray-500">
                      {searchQuery ? 'Тикер не найден' : 'Нет сделок'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    </MarginPageShell>
  );
}

export default StockPrices;
