import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { formatPortfolioCurrency } from '../../utils/currencyFormatter';
import MarginPageShell from './MarginPageShell';

function MarginBulkImport() {
  const { currentPortfolio } = usePortfolio();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tradesText, setTradesText] = useState('');

  const formatCurrency = (amount) => formatPortfolioCurrency(amount, currentPortfolio, 2);

  const exampleData = `SBER,250.5,100,10.5,2024-01-15,Покупка Сбербанка
LKOH,6800,10,12.0,16.01.2024,Покупка ЛУКОЙЛа
GAZP,180.2,50,9.5,2024/01/17,Газпром
YNDX,3200,20,11.0,2024-01-20,2024-02-20,3400,Яндекс - закрыта с прибылью`;

  const parseFlexibleDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === '') return null;
    const trimmed = dateStr.trim();
    const patterns = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    ];

    if (patterns[0].test(trimmed)) return trimmed;
    if (patterns[1].test(trimmed)) {
      const [, day, month, year] = trimmed.match(patterns[1]);
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    for (let i = 2; i < patterns.length; i++) {
      if (patterns[i].test(trimmed)) {
        const parts = trimmed.split(/[\/.-]/);
        if (parts.length === 3) {
          const [first, second, third] = parts;
          if (parseInt(third) > 1900) {
            return `${third}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
          }
        }
      }
    }
    throw new Error(`Неверный формат даты: ${dateStr}`);
  };

  const parseTrades = (text) => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const trades = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 5) throw new Error(`Строка ${i + 1}: Недостаточно данных (нужно минимум 5 полей)`);

      const [symbol, entryPrice, quantity, marginAmount, entryDateRaw, ...rest] = parts;

      let exitDate = null;
      let exitPrice = null;
      let notes = '';

      if (rest.length >= 2) {
        const possibleExitDate = rest[0];
        const possibleExitPrice = rest[1];
        try {
          exitDate = parseFlexibleDate(possibleExitDate);
          const parsedExitPrice = parseFloat(possibleExitPrice);
          if (!isNaN(parsedExitPrice) && parsedExitPrice > 0) {
            exitPrice = parsedExitPrice;
            notes = rest.slice(2).join(',').trim();
          } else {
            notes = rest.join(',').trim();
            exitDate = null;
          }
        } catch (e) {
          notes = rest.join(',').trim();
        }
      } else {
        notes = rest.join(',').trim();
      }

      if (!symbol?.trim()) throw new Error(`Строка ${i + 1}: Тикер не может быть пустым`);

      const parsedEntryPrice = parseFloat(entryPrice);
      if (isNaN(parsedEntryPrice) || parsedEntryPrice <= 0) throw new Error(`Строка ${i + 1}: Неверная цена входа: ${entryPrice}`);

      const parsedQuantity = parseInt(quantity);
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) throw new Error(`Строка ${i + 1}: Неверное количество: ${quantity}`);

      const parsedMarginAmount = parseFloat(marginAmount);
      if (isNaN(parsedMarginAmount) || parsedMarginAmount <= 0 || parsedMarginAmount > 100) {
        throw new Error(`Строка ${i + 1}: Неверная ставка маржи: ${marginAmount}%`);
      }

      const entryDate = parseFlexibleDate(entryDateRaw);
      if (!entryDate) throw new Error(`Строка ${i + 1}: Неверная дата входа: ${entryDateRaw}`);

      const trade = {
        symbol: symbol.trim().toUpperCase(),
        entryPrice: parsedEntryPrice,
        quantity: parsedQuantity,
        marginAmount: parsedMarginAmount,
        entryDate,
        notes: notes.trim(),
      };

      if (exitDate && exitPrice) {
        trade.exitDate = exitDate;
        trade.exitPrice = exitPrice;
      }
      trades.push(trade);
    }
    return trades;
  };

  const handleImport = async () => {
    if (!currentPortfolio?.id) {
      setError('Портфель не выбран');
      return;
    }
    if (!tradesText.trim()) {
      setError('Введите данные для импорта');
      return;
    }
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const trades = parseTrades(tradesText);
      if (trades.length === 0) {
        setError('Не найдено валидных сделок для импорта');
        return;
      }

      const response = await axios.post('/api/trades/bulk-import', { trades }, { headers: { 'X-Portfolio-ID': currentPortfolio.id } });

      if (response.data.success || response.data.importedCount) {
        setSuccess(`Успешно импортировано ${response.data.importedCount || trades.length} сделок`);
        setTradesText('');
        setTimeout(() => navigate('/margin/trades'), 1500);
      } else {
        setError(response.data.message || 'Ошибка при импорте');
      }
    } catch (err) {
      if (err.message?.startsWith('Строка')) setError(err.message);
      else if (err.response?.data?.message) setError(err.response.data.message);
      else setError('Ошибка при импорте сделок');
    } finally {
      setLoading(false);
    }
  };

  const loadExample = () => setTradesText(exampleData);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setTradesText(e.target.result);
    reader.onerror = () => setError('Ошибка при чтении файла');
    reader.readAsText(file);
  };

  if (!currentPortfolio) {
    return <MarginPageShell title="Импорт сделок" subtitle="Портфель не выбран" />;
  }

  return (
    <MarginPageShell
      title="Импорт маржинальных сделок"
      subtitle="Вставьте сделки списком, мы разберём даты, ставки и можем сразу закрыть по указанной цене"
      badge="Import"
      actions={
        <button
          onClick={() => navigate('/margin/trades')}
          className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          К списку сделок
        </button>
      }
    >
      {(error || success) && (
        <div className="mb-6">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100/70 flex items-center justify-between">
            <div>
              <h4 className="text-lg font-semibold text-gray-900">Вставьте данные</h4>
              <p className="text-sm text-gray-500">symbol,entryPrice,quantity,marginAmount,entryDate,[exitDate,exitPrice,notes]</p>
            </div>
            <label className="inline-flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm cursor-pointer hover:bg-gray-800 transition-colors">
              Загрузить .txt
              <input type="file" className="hidden" accept=".txt" onChange={handleFileUpload} />
            </label>
          </div>
          <div className="px-6 py-6 space-y-4">
            <textarea
              value={tradesText}
              onChange={(e) => setTradesText(e.target.value)}
              rows={14}
              placeholder="SBER,250.5,100,10.5,2024-01-15,Покупка..." 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white/50 focus:ring-2 focus:ring-gray-200 focus:border-gray-300 transition-all font-mono"
            />
            
            <div className="flex flex-wrap gap-3">
              <button onClick={loadExample} className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Подставить пример
              </button>
              <button
                onClick={handleImport}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {loading ? 'Импорт...' : 'Импортировать'}
              </button>
              <button
                onClick={() => setTradesText('')}
                className="px-4 py-2 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm"
              >
                Очистить
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">Как это работает</h4>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>• Каждая строка — отдельная сделка</li>
              <li>• Даты: YYYY-MM-DD, DD.MM.YYYY или со слешами</li>
              <li>• Можно указать дату/цену выхода для автозакрытия</li>
              <li>• Пустые строки игнорируются</li>
              <li>• Ставка маржи — число (макс 100%)</li>
            </ul>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">Пример данных</h4>
            <pre className="text-xs bg-gray-900 text-gray-50 rounded-xl p-4 overflow-x-auto">{exampleData}</pre>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">Кратко о формате</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">Поле</th>
                  <th className="py-2">Описание</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {[
                  ['symbol', 'Тикер (обяз.)'],
                  ['entryPrice', 'Цена входа (обяз.)'],
                  ['quantity', 'Кол-во (обяз.)'],
                  ['marginAmount', 'Ставка % годовых (обяз.)'],
                  ['entryDate', 'Дата входа (обяз.)'],
                  ['exitDate', 'Дата выхода (опц.)'],
                  ['exitPrice', 'Цена выхода (опц.)'],
                  ['notes', 'Заметки (опц.)'],
                ].map(([field, desc]) => (
                  <tr key={field} className="border-t border-gray-100">
                    <td className="py-2 font-medium">{field}</td>
                    <td className="py-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MarginPageShell>
  );
}

export default MarginBulkImport;
