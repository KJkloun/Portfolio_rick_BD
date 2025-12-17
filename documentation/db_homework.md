# Пояснительная записка (БД) — Portfolio Risk

Основано на фактической модели и API проекта (`backend/src/main/java/com/example/diary/model` и `controller`/`repository`). Код не менялся, описаны только БД-аспекты.

## 1. Назначение и пользователи
- Пользователь (инвестор/риск-менеджер) ведет портфели, маржинальные сделки, события финансирования и спотовые операции; получает прибыль/убыток, проценты и кэш-позиции.
- Использование: авторизоваться → выбрать портфель → заводить сделки/операции → смотреть отчеты прибыли/кэша → закрывать сделки (FIFO).

## 2. Функциональные требования (по существующему API)
- Пользователи: регистрация/логин (AuthController).
- Портфели: создание/обновление/деактивация, выборка по типу (PortfolioController).
- Маржинальные сделки: открытие, массовый импорт, получение списка, закрытия FIFO (TradeController, TradeSellController).
- События финансирования: история ставок/погашений/залога по сделке (FinancingEventRepository).
- Закрытия сделок: частичные/полные закрытия с количеством и ценой (TradeClosureRepository).
- Спотовые операции: депозит/вывод/покупка/продажа/дивиденды, портфельные позиции и статистика (SpotTransactionController).
- Отчеты: прибыль по тикерам и по месяцам (JPQL в TradeRepository), спотовые позиции/кэш.

## 3. Нефункциональные требования
- Доступ только к своим данным: все контроллеры фильтруют по user из security-контекста.
- Целостность: PK/FK/NOT NULL/UNIQUE/ENUM; денежные поля NUMERIC(19,6), ставки NUMERIC(10,4).
- Транзакционность на уровне сервисов при импорте/закрытии (Spring/JPA).
- Логи SQL включены в `backend/src/main/resources/application.properties`; БД — H2 file, авто-DDL update.

## 4. ER-модель (сущности и связи)
- User 1‑N Portfolio.
- Portfolio 1‑N Trade; 1‑N SpotTransaction.
- Trade 1‑N TradeClosure; 1‑N FinancingEvent.
- TradeClosure — частичное/полное закрытие сделки.
- FinancingEvent — история ставки/погашений/залога.
- SpotTransaction — спотовые операции (кэш и бумаги).

## 5. Функциональные и многозначные зависимости
- users: username → email,password,first_name,last_name,enabled; email → username,password,…; id — ключ.
- portfolios: id → user_id,name,type,currency,is_active,…; (user_id,name) → id (уникальность имени в рамках пользователя).
- trades: id → portfolio_id,symbol,entry_price,quantity,entry_date,margin_amount,…; trade_id →> financing_events; trade_id →> trade_closures.
- trade_closures: id → trade_id, closed_quantity, exit_price, exit_date.
- financing_events: id → trade_id, event_date, event_type, rate, amount_change.
- spot_transactions: id → portfolio_id,ticker,transaction_type,price,quantity,amount,trade_date.

## 6. Нормализация
Стартовая денорма (воображаемая) Ledger(user, portfolio, symbol, entry_price, exit_price, qty, event_type, amount_change, spot_ticker, spot_amount…). Шаги, отражённые в схеме:
1) User выносит учетные данные отдельно → убирает дубли username/email.
2) Portfolio отделяет метаданные портфеля → уникальность имени в рамках пользователя.
3) Trade хранит параметры позиции; многозначные зависимости (ставки, закрытия) вынесены в FinancingEvent и TradeClosure.
4) SpotTransaction отделяет кэш/бумаги от маржинальных сделок.
Итог: 3НФ/BCNF — зависимые атрибуты зависят только от ключей своих таблиц, транзитивные и многозначные зависимости вынесены.

## 7. Пример аномалии (недонорма → проблема)
Если хранить историю ставок в таблице Trades (по одной строке на событие), обновление ставки дублирует все поля сделки; удаление старого события удалит и сделку. Разделение на trades + financing_events устраняет аномалии вставки/обновления/удаления.

## 8. SQL DDL (по JPA-аннотациям, H2/PostgreSQL-совместимо)
```sql
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE portfolios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  portfolio_type VARCHAR(10) NOT NULL CHECK (portfolio_type IN ('MARGIN','SPOT')),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (user_id, name)
);

CREATE TABLE trades (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol VARCHAR(10) NOT NULL,
  entry_price NUMERIC(19,6) NOT NULL CHECK (entry_price > 0),
  exit_price NUMERIC(19,6) CHECK (exit_price > 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  entry_date DATE NOT NULL,
  exit_date DATE,
  margin_amount NUMERIC(10,4) NOT NULL CHECK (margin_amount > 0),
  leverage NUMERIC(10,2),
  borrowed_amount NUMERIC(19,6),
  collateral_amount NUMERIC(19,6),
  maintenance_margin NUMERIC(10,4),
  financing_rate_type VARCHAR(8) CHECK (financing_rate_type IN ('FIXED','FLOATING')),
  financing_currency VARCHAR(5),
  daily_interest TEXT,
  notes TEXT
);
CREATE INDEX idx_trades_portfolio ON trades(portfolio_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);

CREATE TABLE trade_closures (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  closed_quantity INT NOT NULL CHECK (closed_quantity > 0),
  exit_price NUMERIC(19,6) NOT NULL CHECK (exit_price > 0),
  exit_date DATE NOT NULL,
  notes TEXT
);
CREATE INDEX idx_trade_closure_trade ON trade_closures(trade_id);

CREATE TABLE financing_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('RATE_CHANGE','REPAYMENT','COLLATERAL_TOPUP')),
  rate NUMERIC(10,4),
  amount_change NUMERIC(19,6),
  notes TEXT
);
CREATE INDEX idx_financing_trade ON financing_events(trade_id, event_date);

CREATE TABLE spot_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  company VARCHAR(255),
  ticker VARCHAR(20),
  transaction_type VARCHAR(20) CHECK (transaction_type IN ('DEPOSIT','WITHDRAW','BUY','SELL','DIVIDEND')),
  price NUMERIC(19,6),
  quantity NUMERIC(19,6),
  amount NUMERIC(19,6),
  trade_date DATE,
  note TEXT
);
CREATE INDEX idx_spot_portfolio ON spot_transactions(portfolio_id);
CREATE INDEX idx_spot_ticker ON spot_transactions(ticker);
```

## 9. SQL DML (примеры под требования)
```sql
-- Создать пользователя
INSERT INTO users (username, email, password, first_name, last_name)
VALUES ('risk.officer', 'risk@example.com', '{bcrypt}', 'Ivan', 'Petrov');

-- Создать портфель
INSERT INTO portfolios (user_id, name, portfolio_type, currency, description)
VALUES (1, 'Margin US', 'MARGIN', 'USD', 'US equity margin book');

-- Открыть маржинальную сделку
INSERT INTO trades (portfolio_id, symbol, entry_price, quantity, entry_date,
                    margin_amount, leverage, borrowed_amount, collateral_amount,
                    maintenance_margin, financing_rate_type, financing_currency)
VALUES (1, 'AAPL', 180.25, 100, DATE '2024-03-01',
        8.50, 2.5, 18000, 7200, 25.0, 'FIXED', 'USD');

-- Смена ставки финансирования
INSERT INTO financing_events (trade_id, event_date, event_type, rate, notes)
VALUES (1, DATE '2024-03-15', 'RATE_CHANGE', 7.90, 'Fed cut');

-- Частичное закрытие сделки
INSERT INTO trade_closures (trade_id, closed_quantity, exit_price, exit_date, notes)
VALUES (1, 40, 195.10, DATE '2024-04-05', 'partial exit');

-- Спотовые операции: депозит и покупка
INSERT INTO spot_transactions (portfolio_id, company, ticker, transaction_type, price, quantity, amount, trade_date, note)
VALUES (1, 'Cash', 'USD', 'DEPOSIT', 1, 5000, 5000, DATE '2024-03-01', 'Initial funding');
INSERT INTO spot_transactions (portfolio_id, company, ticker, transaction_type, price, quantity, amount, trade_date, note)
VALUES (1, 'Microsoft Corp', 'MSFT', 'BUY', 370.5, 10, -3705, DATE '2024-03-02', 'Lot 1');

-- Прибыль по тикерам (по аналогии с findSymbolProfits)
SELECT t.symbol,
       SUM((t.exit_price - t.entry_price) * t.quantity) AS profit
FROM trades t
JOIN portfolios p ON p.id = t.portfolio_id
WHERE t.exit_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
  AND p.user_id = 1
GROUP BY t.symbol
ORDER BY profit DESC;

-- Месячная прибыль (аналог findMonthlyProfits)
SELECT FORMATDATETIME(t.exit_date, 'yyyy-MM') AS month,
       SUM((t.exit_price - t.entry_price) * t.quantity) AS profit
FROM trades t
JOIN portfolios p ON p.id = t.portfolio_id
WHERE t.exit_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
  AND p.user_id = 1
GROUP BY FORMATDATETIME(t.exit_date, 'yyyy-MM')
ORDER BY month;

-- Текущие спотовые позиции и кэш по портфелю
SELECT ticker,
       SUM(CASE WHEN transaction_type='BUY' THEN quantity
                WHEN transaction_type='SELL' THEN -quantity ELSE 0 END) AS position_qty,
       SUM(amount) AS cash_flow
FROM spot_transactions
WHERE portfolio_id = 1
GROUP BY ticker;

-- Исправление знаков для BUY/WITHDRAW (как в SpotTransactionRepository)
UPDATE spot_transactions
SET amount = -ABS(amount)
WHERE transaction_type IN ('WITHDRAW','BUY') AND amount > 0;
```

## 10. Транзакции (группировка запросов)
```sql
-- Импорт одной сделки с событиями/закрытием
BEGIN;
  INSERT INTO trades (...) VALUES (...);           -- вернет trade_id = currval(...)
  INSERT INTO financing_events (trade_id, event_date, event_type, rate)
    VALUES (currval('trades_id_seq'), DATE '2024-03-15', 'RATE_CHANGE', 7.9);
  INSERT INTO trade_closures (trade_id, closed_quantity, exit_price, exit_date)
    VALUES (currval('trades_id_seq'), 50, 195.1, DATE '2024-04-05');
COMMIT;

-- Батч загрузки спот-операций
BEGIN;
  INSERT INTO spot_transactions (...) VALUES (...);
  INSERT INTO spot_transactions (...) VALUES (...);
COMMIT;
-- В случае ошибки: ROLLBACK;
```
