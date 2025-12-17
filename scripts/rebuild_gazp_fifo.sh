#!/usr/bin/env bash

# Пересборка сделок GAZP под модель FIFO:
# 1) Снимаем бэкап базы и выгрузку текущих сделок GAZP.
# 2) Удаляем все сделки GAZP в маржинальном портфеле.
# 3) Создаём их заново только как покупки.
# 4) Прогоняем продажи через /trades/sell/fifo в хронологическом порядке.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="http://localhost:8081/api"
DB_PATH="$ROOT/backend/data/tradedb.mv.db"
BACKUP_PATH="$ROOT/backend/data/tradedb_fifo_backup_$(date +%s).mv.db"
EXPORT_JSON="$ROOT/scripts/gazp_trades_backup.json"

USERNAME="${USERNAME:-kj}"
PASSWORD="${PASSWORD:-password}"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ Требуется jq (sudo apt-get install jq или brew install jq)"
  exit 1
fi

log() { printf "[%s] %s\n" "$(date +%T)" "$*"; }

log "Создаю бэкап базы: $BACKUP_PATH"
cp "$DB_PATH" "$BACKUP_PATH"
log "Бэкап готов"

log "Получаю JWT..."
TOKEN=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | jq -r '.token')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "❌ Не удалось получить токен"
  exit 1
fi
log "Токен получен"

PORTFOLIO_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_BASE/portfolios" \
  | jq -r '.[] | select(.type=="MARGIN") | .id' | head -n1)

if [[ -z "$PORTFOLIO_ID" || "$PORTFOLIO_ID" == "null" ]]; then
  echo "❌ Маржинальный портфель не найден"
  exit 1
fi
log "Маржинальный портфель: $PORTFOLIO_ID"

log "Выгружаю текущие сделки GAZP..."
GAZP_RAW=$(curl -s "$API_BASE/trades" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Portfolio-ID: $PORTFOLIO_ID" \
  | jq 'map(select(.symbol=="GAZP"))')

echo "$GAZP_RAW" > "$EXPORT_JSON"
log "Сохранён слепок GAZP: $EXPORT_JSON"

BUY_QTY=$(echo "$GAZP_RAW" | jq 'map(.quantity) | add')
SELL_QTY=$(echo "$GAZP_RAW" | jq '[.[] | select(.exitDate!=null) | .quantity] | add')
BUY_COUNT=$(echo "$GAZP_RAW" | jq 'length')
SELL_COUNT=$(echo "$GAZP_RAW" | jq '[.[] | select(.exitDate!=null)] | length')

log "Покупок всего: $BUY_COUNT (объём $BUY_QTY)"
log "Продаж (закрытий): $SELL_COUNT (объём $SELL_QTY)"

if [[ "$BUY_COUNT" -eq 0 ]]; then
  echo "❌ Сделок GAZP не найдено — останавливаюсь"
  exit 1
fi

# Готовим упорядоченные списки
BUYS=$(echo "$GAZP_RAW" | jq 'sort_by(.entryDate, .id) | map({symbol, entryPrice, quantity, entryDate, marginAmount, notes: (.notes // "")})')
SELLS=$(echo "$GAZP_RAW" | jq '[.[] | select(.exitDate!=null) | {symbol, quantity, exitPrice, exitDate, notes: ((.notes // "") + " [src:" + (.id|tostring) + "]")} ] | sort_by(.exitDate)')

log "Удаляю старые сделки GAZP..."
while IFS= read -r TRADE_ID; do
  [[ -z "$TRADE_ID" ]] && continue
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_BASE/trades/$TRADE_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Portfolio-ID: $PORTFOLIO_ID")
  if [[ "$STATUS" != "200" ]]; then
    echo "❌ Ошибка удаления $TRADE_ID (HTTP $STATUS)"
    exit 1
  fi
done <<< "$(echo "$GAZP_RAW" | jq -r '.[].id')"
log "Удалено $(echo "$GAZP_RAW" | jq 'length') записей"

log "Создаю покупки (открытия) заново..."
BUY_TOTAL=$(echo "$BUYS" | jq 'length')
BUY_DONE=0
while IFS= read -r PAYLOAD; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/trades/buy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Portfolio-ID: $PORTFOLIO_ID" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  if [[ "$STATUS" != "201" && "$STATUS" != "200" ]]; then
    echo "❌ Ошибка создания сделки (HTTP $STATUS) payload: $PAYLOAD"
    exit 1
  fi
  BUY_DONE=$((BUY_DONE + 1))
  echo -ne "\rСоздано покупок: $BUY_DONE/$BUY_TOTAL"
done <<< "$(echo "$BUYS" | jq -c '.[]')"
echo ""
log "Покупки созданы"

log "Закрываю через FIFO..."
SELL_TOTAL=$(echo "$SELLS" | jq 'length')
SELL_DONE=0
while IFS= read -r PAYLOAD; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/trades/sell/fifo" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Portfolio-ID: $PORTFOLIO_ID" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  if [[ "$STATUS" != "200" ]]; then
    echo "❌ Ошибка FIFO продажи (HTTP $STATUS) payload: $PAYLOAD"
    exit 1
  fi
  SELL_DONE=$((SELL_DONE + 1))
  echo -ne "\rЗакрыто FIFO: $SELL_DONE/$SELL_TOTAL"
done <<< "$(echo "$SELLS" | jq -c '.[]')"
echo ""
log "FIFO продажи выполнены"

log "ГОТОВО. Проверьте http://localhost:3000/margin"
