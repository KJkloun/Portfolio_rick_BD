import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import MarginDashboard from './margin/MarginDashboard';
import MarginTradeList from './margin/MarginTradeList';
import MarginTradeForm from './margin/MarginTradeForm';
import MarginBulkImport from './margin/MarginBulkImport';
import Statistics from './Statistics';
import StockPrices from './StockPrices';
import FloatingRateCalculator from './FloatingRateCalculator';
import TradeDetails from './TradeDetails';

function MarginTrading() {
  const location = useLocation();
  const navItems = [
    { to: '/margin', label: 'Дашборд', end: true },
    { to: '/margin/trades', label: 'Журнал' },
    { to: '/margin/new', label: 'Новая позиция' },
    { to: '/margin/import', label: 'Импорт' },
    { to: '/margin/statistics', label: 'Аналитика' },
    { to: '/margin/stock-prices', label: 'Курсы' },
    { to: '/margin/floating-rates', label: 'Ставки ЦБ' },
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
        <Route path="/" element={<MarginDashboard />} />
        <Route path="/trades" element={<MarginTradeList />} />
        <Route path="/new" element={<MarginTradeForm />} />
        <Route path="/import" element={<MarginBulkImport />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/stock-prices" element={<StockPrices />} />
        <Route path="/floating-rates" element={<FloatingRateCalculator />} />
        <Route path="/trade/:id" element={<TradeDetails />} />
      </Routes>
    </div>
  );
}

export default MarginTrading;
