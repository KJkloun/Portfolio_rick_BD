import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import MarginPageShell from './margin/MarginPageShell';

function TradeDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [exitDate, setExitDate] = useState('');
  const [notes, setNotes] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadTrade();
  }, [id]);

  const loadTrade = async () => {
    try {
      setLoading(true);
      const resp = await axios.get(`/api/trades/${id}`);
      setTrade(resp.data);
      setError('');
    } catch (e) {
      setError('Не удалось загрузить сделку');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePart = async () => {
    if (!quantity || !exitPrice) return;
    try {
      const payload = { quantity: Number(quantity), exitPrice: Number(exitPrice) };
      if (exitDate) payload.exitDate = exitDate;
      if (notes) payload.notes = notes;
      const resp = await axios.post(`/api/trades/${id}/close-part`, payload);
      setSuccessMsg(resp.data.message || 'Частичное закрытие сохранено');
      setQuantity('');
      setExitPrice('');
      setExitDate('');
      setNotes('');
      loadTrade();
      // Даем сигнал другим компонентам
      window.dispatchEvent(new CustomEvent('tradesUpdated', { detail: { source: 'trade-details' } }));
    } catch (e) {
      setError(e.response?.data?.message || 'Ошибка сохранения');
    }
  };

  if (loading) return <MarginPageShell title="Сделка" subtitle="Загрузка..."><div className="p-4">Загрузка...</div></MarginPageShell>;
  if (error) return <MarginPageShell title="Сделка" subtitle="Ошибка"><div className="p-4 text-red-500">{error}</div></MarginPageShell>;
  if (!trade) return null;

  const openQty = trade.openQuantity ?? trade.quantity; // backend transient serialization might be camel-case
  const liquidation = trade.liquidationPrice ? Number(trade.liquidationPrice).toFixed(2) : null;

  return (
    <MarginPageShell
      title={`Сделка ${trade.symbol}`}
      subtitle={`Дата входа ${trade.entryDate}`}
      badge="Trade"
      actions={
        <button onClick={() => navigate(-1)} className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">← Назад</button>
      }
    >
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-sm space-y-1">
          <div>Дата входа: {trade.entryDate}</div>
          <div>Цена входа: ₽{trade.entryPrice}</div>
          <div>Количество: {trade.quantity}</div>
          <div>Открыто осталось: {openQty}</div>
          <div>Процент кредита: {trade.marginAmount}%</div>
          {trade.leverage && <div>Плечо: {trade.leverage}x</div>}
          {trade.borrowedAmount != null && <div>Заёмные средства: ₽{trade.borrowedAmount}</div>}
          {trade.collateralAmount != null && <div>Собственные средства: ₽{trade.collateralAmount}</div>}
          {trade.maintenanceMargin != null && <div>Поддерживающая маржа: {trade.maintenanceMargin}%</div>}
          {liquidation && <div>Цена ликвидации (оценочно): ₽{liquidation}</div>}
        </div>
      </div>

      {/* Список частичных закрытий, если есть */}
      {trade.closures && trade.closures.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="font-medium mb-2">Частичные закрытия</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1">Дата</th>
                <th className="py-1">Кол-во</th>
                <th className="py-1">Цена</th>
                <th className="py-1">Сумма</th>
                <th className="py-1">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {trade.closures.map(cl => (
                <tr key={cl.id} className="border-t">
                  <td className="py-1">{cl.exitDate}</td>
                  <td className="py-1">{cl.closedQuantity}</td>
                  <td className="py-1">₽{cl.exitPrice}</td>
                  <td className="py-1">₽{cl.amount}</td>
                  <td className="py-1">{cl.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Форма закрытия части */}
      {openQty > 0 && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h3 className="font-medium">Закрыть часть позиции</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
            <input type="number" min="1" max={openQty} value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Кол-во" className="border rounded px-2 py-1" />
            <input type="number" step="0.01" value={exitPrice} onChange={e=>setExitPrice(e.target.value)} placeholder="Цена выхода" className="border rounded px-2 py-1" />
            <input type="date" value={exitDate} onChange={e=>setExitDate(e.target.value)} className="border rounded px-2 py-1" />
            <input type="text" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Заметка" className="border rounded px-2 py-1" />
          </div>
          <button onClick={handleClosePart} className="mt-2 bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-700">Сохранить</button>
          {successMsg && <div className="text-green-600 text-sm mt-1">{successMsg}</div>}
        </div>
      )}
    </MarginPageShell>
  );
}

export default TradeDetails; 
