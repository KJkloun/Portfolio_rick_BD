import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePortfolio } from '../../contexts/PortfolioContext';

function AppLayout() {
  const { logout } = useAuth();
  const { currentPortfolio } = usePortfolio();

  const navItems = [
    { to: '/overview', label: 'Обзор', end: true },
    { to: '/margin', label: 'Маржа' },
    { to: '/spot', label: 'Спот' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-100/70 bg-white/80 backdrop-blur-md">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -left-10 -top-10 w-72 h-72 bg-emerald-100 rounded-full mix-blend-multiply blur-3xl opacity-40" />
            <div className="absolute -right-10 top-16 w-80 h-80 bg-indigo-100 rounded-full mix-blend-multiply blur-3xl opacity-30" />
          </div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link to="/portfolios" className="text-slate-500 hover:text-slate-900 text-sm font-semibold">Portfolio Risk</Link>
              {currentPortfolio && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-900 text-white shadow">
                  {currentPortfolio.name} ({currentPortfolio.currency})
                </span>
              )}
            </div>
            <nav className="flex items-center gap-2 bg-white/80 border border-slate-100 rounded-2xl shadow-sm px-3 py-2">
              {navItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive
                      ? 'px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm'
                      : 'px-3 py-1.5 rounded-xl text-slate-700 hover:text-slate-900 text-sm'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <button
              onClick={logout}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="py-4 sm:py-6 lg:py-8">
        <div className="animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppLayout;
