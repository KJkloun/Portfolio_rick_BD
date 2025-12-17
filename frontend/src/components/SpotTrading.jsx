import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import AllTransactions from './spot/AllTransactions';
import BoughtStocks from './spot/BoughtStocks';
import SoldStocks from './spot/SoldStocks';
import CashMovements from './spot/CashMovements';
import CashAccounting from './spot/CashAccounting';
import StockAccounting from './spot/StockAccounting';
import CurrentProfit from './spot/CurrentProfit';
import DailySummary from './spot/DailySummary';
import TickerDetails from './spot/TickerDetails';
import FifoAnalysis from './spot/FifoAnalysis';
import SpotStockPrices from './spot/StockPrices';

function SpotTrading() {
  const location = useLocation();
  const navItems = [
    { to: '/spot', label: 'Все операции', end: true },
    { to: '/spot/fifo-analysis', label: 'FIFO' },
    { to: '/spot/bought', label: 'Позиции' },
    { to: '/spot/sold', label: 'Проданные' },
    { to: '/spot/cash-movements', label: 'Движение кэша' },
    { to: '/spot/cash-accounting', label: 'Учёт кэша' },
    { to: '/spot/stock-accounting', label: 'Учёт бумаг' },
    { to: '/spot/current-profit', label: 'PnL' },
    { to: '/spot/daily-summary', label: 'День' },
    { to: '/spot/stock-prices', label: 'Курсы' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
      <div className="mb-4 overflow-x-auto">
        <div className="inline-flex items-center gap-1 bg-white/80 border border-slate-100 rounded-2xl shadow-sm px-2 py-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                (isActive || location.pathname === item.to)
                  ? 'px-3 py-2 rounded-xl bg-slate-900 text-white text-sm'
                  : 'px-3 py-2 rounded-xl text-slate-700 hover:text-slate-900 text-sm'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>

      <Routes>
        <Route path="/" element={<AllTransactions />} />
        <Route path="/fifo-analysis" element={<FifoAnalysis />} />
        <Route path="/bought" element={<BoughtStocks />} />
        <Route path="/sold" element={<SoldStocks />} />
        <Route path="/cash-movements" element={<CashMovements />} />
        <Route path="/cash-accounting" element={<CashAccounting />} />
        <Route path="/stock-accounting" element={<StockAccounting />} />
        <Route path="/current-profit" element={<CurrentProfit />} />
        <Route path="/daily-summary" element={<DailySummary />} />
        <Route path="/stock-prices" element={<SpotStockPrices />} />
        <Route path="/ticker/:ticker" element={<TickerDetails />} />
      </Routes>
    </div>
  );
}

export default SpotTrading;
