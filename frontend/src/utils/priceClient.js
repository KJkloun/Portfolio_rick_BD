import axios from 'axios';

export async function fetchPricesMap(tickers = [], ttlSeconds = 600) {
  const unique = [...new Set((tickers || []).filter(Boolean).map(t => t.toUpperCase()))];
  if (unique.length === 0) return {};

  const res = await axios.post('/api/prices/batch', { tickers: unique }, { params: { ttlSeconds } });
  const payload = res.data?.prices || res.data;

  if (Array.isArray(payload)) {
    return payload.reduce((acc, item) => {
      const ticker = item?.ticker || item?.symbol;
      if (ticker && item?.price !== undefined && item?.price !== null) {
        acc[ticker] = Number(item.price);
      }
      return acc;
    }, {});
  }

  if (payload && typeof payload === 'object') {
    return Object.entries(payload).reduce((acc, [ticker, price]) => {
      if (price !== undefined && price !== null) {
        acc[ticker.toUpperCase()] = Number(price);
      }
      return acc;
    }, {});
  }

  return {};
}
