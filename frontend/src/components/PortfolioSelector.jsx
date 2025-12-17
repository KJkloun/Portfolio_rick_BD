import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useAuth } from '../contexts/AuthContext';

function PortfolioSelector() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPortfolio, setNewPortfolio] = useState({
    name: '',
    currency: 'RUB',
    description: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { 
    portfolios, 
    currentPortfolio, 
    selectPortfolio, 
    createPortfolio, 
    deletePortfolio,
    loading: portfoliosLoading 
  } = usePortfolio();
  const { user, logout } = useAuth();

  const handleCreatePortfolio = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await createPortfolio(
      newPortfolio.name,
      'MARGIN',
      newPortfolio.currency,
      newPortfolio.description
    );

    if (result.success) {
      setShowCreateModal(false);
      setNewPortfolio({ name: '', currency: 'RUB', description: '' });
      selectPortfolio(result.portfolio);
    } else {
      setError(result.message);
    }

    setLoading(false);
  };

  const handleDelete = async (e, portfolio) => {
    e.stopPropagation();
    if (window.confirm(`Удалить портфель "${portfolio.name}"? Это действие необратимо.`)) {
      const result = await deletePortfolio(portfolio.id);
      if (!result.success) {
        alert(result.message);
      }
    }
  };

  if (portfoliosLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка портфелей...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-4xl mx-auto w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Добро пожаловать, {user?.firstName}!
          </h1>
          <p className="text-xl text-gray-600 mb-4">
            Выберите портфель для работы или создайте новый
          </p>
          <button
            onClick={logout}
            className="text-purple-600 hover:text-purple-700 font-medium text-sm"
          >
            Выйти из аккаунта
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
          {portfolios.map((portfolio) => (
            <div
              key={portfolio.id}
              onClick={() => selectPortfolio(portfolio)}
              onDoubleClick={() => {
                selectPortfolio(portfolio);
                navigate('/overview');
              }}
              className={`relative bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border cursor-pointer ${
                currentPortfolio?.id === portfolio.id 
                  ? 'border-purple-500 ring-2 ring-purple-200' 
                  : 'border-gray-100'
              }`}
              title="Клик — выбрать, двойной клик — войти"
            >
              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(e, portfolio)}
                className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 focus:outline-none"
                title="Удалить портфель"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-700">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-800">
                  Портфель
                </span>
              </div>
                             <h3 className="text-lg font-semibold text-gray-900 mb-2">
                 {portfolio.name}
               </h3>
               <div className="text-sm text-gray-600 mb-2">
                 <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                   {portfolio.currency}
                 </span>
               </div>
               {portfolio.description && (
                 <p className="text-gray-600 text-sm mb-4">
                   {portfolio.description}
                 </p>
               )}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Создан: {new Date(portfolio.createdAt).toLocaleDateString()}</span>
                {currentPortfolio?.id === portfolio.id && (
                  <span className="text-purple-600 font-medium">Выбран</span>
                )}
              </div>
            </div>
          ))}

          {/* Кнопка создания нового портфеля */}
          <div
            onClick={() => setShowCreateModal(true)}
            className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border border-dashed border-gray-300 cursor-pointer flex flex-col items-center justify-center min-h-[200px] hover:border-purple-400"
          >
            <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Создать портфель
            </h3>
            <p className="text-gray-600 text-sm text-center">
              Добавьте новый портфель для управления инвестициями
            </p>
          </div>
        </div>

        {currentPortfolio && (
          <div className="text-center">
            <button
              onClick={() => navigate('/overview')}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-8 py-3 rounded-lg font-medium hover:from-purple-600 hover:to-indigo-700 focus:ring-2 focus:ring-purple-400 focus:ring-offset-2"
            >
              Перейти к управлению портфелем
            </button>
          </div>
        )}

        {/* Модальное окно создания портфеля */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center px-4 z-50">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Создать новый портфель
              </h2>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleCreatePortfolio} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Название портфеля
                  </label>
                  <input
                    type="text"
                    value={newPortfolio.name}
                    onChange={(e) => setNewPortfolio({...newPortfolio, name: e.target.value})}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
                    placeholder="Например, Основной портфель"
                  />
                </div>

                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-2">
                     Валюта портфеля
                   </label>
                   <select
                     value={newPortfolio.currency}
                     onChange={(e) => setNewPortfolio({...newPortfolio, currency: e.target.value})}
                     className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
                   >
                     <option value="RUB">RUB - Российский рубль</option>
                     <option value="USD">USD - Доллар США</option>
                     <option value="EUR">EUR - Евро</option>
                     <option value="CNY">CNY - Китайский юань</option>
                     <option value="KZT">KZT - Казахстанский тенге</option>
                   </select>
                 </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Описание (опционально)
                  </label>
                  <textarea
                    value={newPortfolio.description}
                    onChange={(e) => setNewPortfolio({...newPortfolio, description: e.target.value})}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
                    placeholder="Краткое описание портфеля"
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                                         onClick={() => {
                       setShowCreateModal(false);
                       setError('');
                       setNewPortfolio({ name: '', type: 'MARGIN', currency: 'RUB', description: '' });
                     }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50"
                  >
                    {loading ? 'Создание...' : 'Создать'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PortfolioSelector;
 
 
 
