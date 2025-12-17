import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import { fetchPricesMap } from '../../utils/priceClient';

function SpotStockPrices() {
  const { currentPortfolio } = usePortfolio();
  const [transactions, setTransactions] = useState([]);
  const [stockPrices, setStockPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingLive, setLoadingLive] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  // Load on mount
  useEffect(() => {
    loadTransactions();
  }, [currentPortfolio]);

  // Автообновление при загрузке транзакций и раз в час
  useEffect(() => {
    if (transactions.length > 0) {
      fetchLivePrices(true);
    }
    const interval = setInterval(() => fetchLivePrices(), 60 * 60 * 1000); // раз в час
    return () => clearInterval(interval);
  }, [transactions]);
  // Hide success automatically
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      setError('');
      const headers = currentPortfolio?.id ? { 'X-Portfolio-ID': currentPortfolio.id } : {};
      const res = await axios.get('/api/spot-transactions', { headers });
      setTransactions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error loading spot transactions:', err);
      setError('Не удалось загрузить операции');
    } finally {
      setLoading(false);
    }
  };
  const buildStocks = () => {
    const tickers = [...new Set(transactions.map(t => t.ticker))];
    return tickers.map(symbol => {
      const txs = transactions.filter(t => t.ticker === symbol);
      const lastTx = txs.sort((a,b) => new Date(b.tradeDate) - new Date(a.tradeDate))[0];
      const openShares = txs.reduce((sum, tx) => {
        if (tx.transactionType === 'BUY') return sum + tx.quantity;
        if (tx.transactionType === 'SELL') return sum - tx.quantity;
        return sum;
      }, 0);
      return {
        symbol,
        lastTradeDate: lastTx?.tradeDate,
        openPositions: openShares,
        totalPositions: txs.length,
        lastPrice: lastTx?.price
      };
    }).sort((a,b)=>{
      if(a.openPositions>0 && b.openPositions===0) return -1;
      if(a.openPositions===0 && b.openPositions>0) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
  };
  const stocks = buildStocks();

  const fetchLivePrices = async (force = false) => {
    if (!currentPortfolio) return;
    const tickers = [...new Set(transactions.map(t => t.ticker))];
    if (tickers.length === 0) return;
    setLoadingLive(true);
    try {
      const updated = await fetchPricesMap(tickers);
      setStockPrices(updated);
      setLastUpdated(new Date());
      if (Object.keys(updated).length === 0) {
        setError('Котировки не получены: проверьте ALPHAVANTAGE_API_KEY или лимит запросов');
      } else {
        setError('');
        setSuccessMessage('Котировки обновлены');
      }
    } catch (e) {
      setError('Не удалось обновить котировки');
    } finally {
      setLoadingLive(false);
    }
  };

  const filteredStocks = stocks.filter(s => s.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-gray-400 border-r-2 border-b-2 border-transparent"></div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <h1 className="text-2xl font-medium text-gray-900">Курсы акций (Спот)</h1>
          <div className="flex gap-3 items-center">
            <button onClick={() => fetchLivePrices(true)} disabled={loadingLive} className="px-3 py-2 text-sm text-white bg-slate-900 border border-slate-900 rounded-md hover:bg-slate-800 disabled:bg-slate-500">
              {loadingLive ? 'Обновление...' : 'Обновить котировки'}
            </button>
            <div className="relative w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
              </div>
              <input type="text" placeholder="Поиск тикера..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
          </div>
        </div>
        {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {successMessage && <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{successMessage}</div>}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Тикер</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Открытые<br/>акции</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Всего<br/>операций</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Последняя<br/>цена</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Последняя<br/>операция</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Текущий<br/>курс</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredStocks.map(stock => (
                    <tr key={stock.symbol} className={stock.openPositions>0?'bg-blue-50':''}>
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{stock.symbol}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{stock.openPositions}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stock.totalPositions}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatPortfolioCurrency(Number(stock.lastPrice||0), currentPortfolio, 2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stock.lastTradeDate?format(new Date(stock.lastTradeDate),'d MMM yyyy',{locale:ru}):'—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {formatPortfolioCurrency(Number(stockPrices[stock.symbol] ?? stock.lastPrice ?? 0), currentPortfolio, 2)}
                      <div className="text-xs text-gray-400">
                        {lastUpdated ? `обновлено ${format(lastUpdated,'HH:mm')}` : '—'}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredStocks.length===0&&<tr><td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">{searchQuery?'Тикер не найден':'Нет операций'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
export default SpotStockPrices;
