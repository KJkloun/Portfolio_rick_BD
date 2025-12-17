import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import { fetchPricesMap } from '../../utils/priceClient';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Doughnut, Scatter } from 'react-chartjs-2';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePortfolio } from '../../contexts/PortfolioContext';
import SpotPageShell from './SpotPageShell';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const CHART_COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  success: '#10b981',
  danger: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  light: '#f3f4f6',
  dark: '#1f2937'
};

const FifoAnalysis = () => {
  const { currentPortfolio, refreshTrigger } = usePortfolio();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fifoResults, setFifoResults] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [transactions, setTransactions] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState('');

  // Получаем сохранённые курсы акций из localStorage один раз при монтировании
  useEffect(() => {
    fetchData();
  }, [currentPortfolio, refreshTrigger]);

  const fetchData = async () => {
    if (!currentPortfolio?.id) {
      setLoading(false);
      return;
    }

    try {
      const [txResp, statsResp] = await Promise.all([
        axios.get('/api/spot-transactions', { headers: { 'X-Portfolio-ID': currentPortfolio.id } }),
        axios.get('/api/spot-transactions/stats', { headers: { 'X-Portfolio-ID': currentPortfolio.id } })
      ]);

      const data = txResp.data;
      const transformedData = Array.isArray(data) ? data.map(tx => ({
        ...tx,
        tradeDate: tx.transactionDate || tx.tradeDate,
        totalAmount: tx.amount || tx.totalAmount
      })) : [];

      setTransactions(transformedData);

      // Готовые позиции на бэке для быстрых метрик
      const positionsResp = await axios.get('/api/spot-transactions/positions/open', { headers: { 'X-Portfolio-ID': currentPortfolio.id } });
      const positions = Array.isArray(positionsResp.data) ? positionsResp.data : [];

      const priceMap = await fetchPricesMap(positions.map(p => p.ticker));

      // Собираем FIFO для продаж (реализованный P/L)
      const fifoResultsData = buildFifoMatches(transformedData);
      const enriched = fifoResultsData.map(row => ({
        ...row,
        currentPrice: priceMap[row.ticker] || row.salePrice || row.purchasePrice || 0
      }));

      setFifoResults(enriched);
    } catch (error) {
      console.error('Error fetching FIFO data:', error);
      setError('Ошибка загрузки данных: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const buildFifoMatches = (txs) => {
    const tickerGroups = {};

    txs.forEach(tx => {
      if (!tx.ticker || tx.ticker === 'USD') return;

      if (!tickerGroups[tx.ticker]) {
        tickerGroups[tx.ticker] = {
          ticker: tx.ticker,
          company: tx.company,
          purchases: [],
          sales: []
        };
      }

      if (tx.transactionType === 'BUY') {
        tickerGroups[tx.ticker].purchases.push({
          ...tx,
          remainingQuantity: tx.quantity || 0
        });
      } else if (tx.transactionType === 'SELL') {
        tickerGroups[tx.ticker].sales.push(tx);
      }
    });

    const results = [];

    Object.values(tickerGroups).forEach(group => {
      if (group.sales.length === 0) return;

      group.purchases.sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));
      group.sales.sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));

      group.sales.forEach(sale => {
        let remainingSaleQuantity = sale.quantity || 0;
        const saleMatches = [];

        for (let i = 0; i < group.purchases.length && remainingSaleQuantity > 0; i++) {
          const purchase = group.purchases[i];

          if (purchase.remainingQuantity > 0) {
            const matchQuantity = Math.min(remainingSaleQuantity, purchase.remainingQuantity);
            const purchaseCostBasis = (purchase.price || 0) * matchQuantity;
            const saleProceeds = (sale.price || 0) * matchQuantity;
            const realizedPL = saleProceeds - purchaseCostBasis;

            saleMatches.push({
              saleDate: sale.tradeDate,
              salePrice: sale.price,
              purchaseDate: purchase.tradeDate,
              purchasePrice: purchase.price,
              quantity: matchQuantity,
              purchaseCostBasis,
              saleProceeds,
              realizedPL,
              realizedPLPercent: purchaseCostBasis > 0 ? (realizedPL / purchaseCostBasis) * 100 : 0
            });

            purchase.remainingQuantity -= matchQuantity;
            remainingSaleQuantity -= matchQuantity;
          }
        }

        saleMatches.forEach(match => {
          results.push({
            ticker: group.ticker,
            company: group.company,
            ...match
          });
        });
      });
    });

    results.sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate));
    return results;
  };

  // Get unique tickers for the dropdown
  const getAvailableTickers = () => {
    const tickers = [...new Set(fifoResults.map(result => result.ticker))];
    return tickers.sort();
  };

  // Filter results based on selected ticker
  const getFilteredResults = () => {
    if (!selectedTicker) return fifoResults;
    return fifoResults.filter(result => result.ticker === selectedTicker);
  };

  const formatCurrency = (amount) => {
    return formatPortfolioCurrency(amount, currentPortfolio, 2);
  };



  const formatPercent = (value) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  // Calculate summary statistics for filtered results
  const filteredResults = getFilteredResults();
  const summary = filteredResults.reduce((acc, result) => {
    acc.totalRealizedPL += result.realizedPL;
    acc.totalSaleProceeds += result.saleProceeds;
    acc.totalCostBasis += result.purchaseCostBasis;
    acc.totalQuantity += result.quantity;
    
    if (result.realizedPL > 0) {
      acc.profitableMatches++;
      acc.totalProfit += result.realizedPL;
    } else {
      acc.totalLoss += Math.abs(result.realizedPL);
    }
    
    return acc;
  }, {
    totalRealizedPL: 0,
    totalSaleProceeds: 0,
    totalCostBasis: 0,
    totalQuantity: 0,
    profitableMatches: 0,
    totalProfit: 0,
    totalLoss: 0
  });

  const winRate = filteredResults.length > 0 ? (summary.profitableMatches / filteredResults.length) * 100 : 0;
  const avgRealizedPL = filteredResults.length > 0 ? summary.totalRealizedPL / filteredResults.length : 0;

  if (loading) {
    return (
      <SpotPageShell title="FIFO Анализ" subtitle="Анализ реализованной прибыли/убытка" badge="Spot портфель">
        <div className="flex items-center justify-center py-24 text-slate-500">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 mx-auto mb-4"></div>
            <p>Загрузка FIFO анализа...</p>
          </div>
        </div>
      </SpotPageShell>
    );
  }

  if (error) {
    return (
      <SpotPageShell title="FIFO Анализ" subtitle="Анализ реализованной прибыли/убытка" badge="Spot портфель">
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
      <SpotPageShell title="FIFO Анализ" subtitle="Анализ реализованной прибыли/убытка" badge="Spot портфель">
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
      title="FIFO Анализ"
      subtitle={`Анализ реализованной прибыли/убытка по методу \"первым пришел - первым ушел\" (${currentPortfolio?.currency || 'USD'})`}
      badge="Spot портфель"
    >

        {/* Summary Cards */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 text-center">
              <div className={`text-2xl font-light ${summary.totalRealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatCurrency(summary.totalRealizedPL)}
              </div>
              <div className="text-xs text-gray-400">общая реализованная П/У</div>
            </div>
          </div>
          
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 text-center">
              <div className="text-2xl font-light text-blue-500">
                {winRate.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400">процент прибыльных</div>
            </div>
          </div>
          
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 text-center">
              <div className="text-2xl font-light text-indigo-600">
                {filteredResults.length}
              </div>
              <div className="text-xs text-gray-400">всего сделок</div>
            </div>
          </div>
          
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 text-center">
              <div className={`text-2xl font-light ${avgRealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatCurrency(avgRealizedPL)}
              </div>
              <div className="text-xs text-gray-400">средняя П/У</div>
            </div>
          </div>
        </div>

        {/* Additional Statistics */}
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4">
              <h6 className="text-base font-medium text-gray-700 mb-3">Общая статистика</h6>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Общий объем продаж:</span>
                  <span className="font-medium">{formatCurrency(summary.totalSaleProceeds)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Общая себестоимость:</span>
                  <span className="font-medium">{formatCurrency(summary.totalCostBasis)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Общее количество:</span>
                  <span className="font-medium">{summary.totalQuantity.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4">
              <h6 className="text-base font-medium text-gray-700 mb-3">Прибыльные сделки</h6>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Количество:</span>
                  <span className="font-medium text-green-600">{summary.profitableMatches}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Общая прибыль:</span>
                  <span className="font-medium text-green-600">{formatCurrency(summary.totalProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Средняя прибыль:</span>
                  <span className="font-medium text-green-600">
                    {summary.profitableMatches > 0 ? formatCurrency(summary.totalProfit / summary.profitableMatches) : formatCurrency(0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4">
              <h6 className="text-base font-medium text-gray-700 mb-3">Убыточные сделки</h6>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Количество:</span>
                  <span className="font-medium text-red-600">{filteredResults.length - summary.profitableMatches}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Общий убыток:</span>
                  <span className="font-medium text-red-600">{formatCurrency(-summary.totalLoss)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Средний убыток:</span>
                  <span className="font-medium text-red-600">
                    {(filteredResults.length - summary.profitableMatches) > 0 ? 
                      formatCurrency(-summary.totalLoss / (filteredResults.length - summary.profitableMatches)) : 
                      formatCurrency(0)
                    }
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FIFO Results Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h6 className="text-lg font-semibold text-slate-900 mb-1">FIFO Сопоставления</h6>
                <p className="text-sm text-slate-500">Детальный анализ сопоставления продаж с покупками</p>
              </div>
              <div className="flex items-center space-x-3">
                <label className="text-sm font-medium text-slate-600">Фильтр по акции:</label>
                <select
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 bg-white rounded-lg focus:ring-2 focus:ring-slate-300 focus:outline-none text-sm shadow-sm min-w-[140px]"
                >
                  <option value="">Все акции</option>
                  {getAvailableTickers().map(ticker => (
                    <option key={ticker} value={ticker}>{ticker}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          
          {filteredResults.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Тикер</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Дата продажи</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Дата покупки</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Количество</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Цена покупки</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Цена продажи</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Себестоимость</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Выручка</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">П/У</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">П/У %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((result, index) => (
                    <tr key={index} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                        {result.ticker}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800">
                        {result.saleDate ? format(new Date(result.saleDate), 'dd.MM.yyyy', { locale: ru }) : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800">
                        {result.purchaseDate ? format(new Date(result.purchaseDate), 'dd.MM.yyyy', { locale: ru }) : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800 text-right">
                        {result.quantity?.toLocaleString() || 0}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800 text-right">
                        {formatCurrency(result.purchasePrice || 0)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800 text-right">
                        {formatCurrency(result.salePrice || 0)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800 text-right">
                        {formatCurrency(result.purchaseCostBasis || 0)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-800 text-right">
                        {formatCurrency(result.saleProceeds || 0)}
                      </td>
                      <td className={`px-4 py-4 text-sm text-right font-semibold ${(result.realizedPL || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {(result.realizedPL || 0) >= 0 ? '+' : ''}{formatCurrency(result.realizedPL || 0)}
                      </td>
                      <td className={`px-4 py-4 text-sm text-right font-semibold ${(result.realizedPLPercent || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatPercent(result.realizedPLPercent || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-8 text-center">
              <div className="text-gray-400 text-sm">Нет данных для FIFO анализа</div>
              <p className="text-gray-400 text-xs mt-1">Для анализа необходимы операции продажи</p>
            </div>
          )}
        </div>
    </SpotPageShell>
  );
};

export default FifoAnalysis;
