# Пояснительная записка по БД (Portfolio Risk)

Основана на фактическом коде и H2 базе проекта.

## 1. Назначение и пользователи
Эта система помогает частному инвестору или риск-менеджеру вести портфели, маржинальные сделки и спотовые операции. Пользователь авторизуется (`AuthController.java`), выбирает портфель (`PortfolioController.java`), открывает/закрывает сделки (`TradeController.java`, `TradeSellController.java`), вносит/выводит кэш и дивиденды (`SpotTransactionController.java`) и смотрит отчеты прибыли (`TradeRepository.java` запросы). Схема БД лежит в `documentation/tradedb_schema_only.sql`, с данными — в `documentation/tradedb_schema_export.sql`.

## 2. Функциональные требования (и где в коде)
- Пользователи: регистрация/логин/получение текущего пользователя — `controller/AuthController.java`, `service/UserService.java`, `repository/UserRepository.java`.
- Портфели: создание, выборка, фильтр по типу, деактивация — `controller/PortfolioController.java`, `service/PortfolioService.java`, `repository/PortfolioRepository.java`.
- Маржинальные сделки: открытие, массовый импорт, список — `controller/TradeController.java` (методы `/buy`, `/bulk-import`, `GET /trades`), бизнес-логика в `service/TradeService.java`.
- Закрытия FIFO: `controller/TradeSellController.java` (`/trades/sell/fifo`), расчеты в `TradeService.fifoClose`.
- События финансирования (ставка/погашение/залог) — `model/FinancingEvent.java`, выборки в `FinancingEventRepository.java`.
- Спотовые операции (депозит/вывод/покупка/продажа/дивиденды), статистика и позиции — `SpotTransactionController.java`, `SpotTransactionRepository.java`.
- Отчеты: прибыль по тикерам и по месяцам — JPQL в `TradeRepository.java` (`findSymbolProfits`, `findMonthlyProfits`); спотовые позиции/кэш — `SpotTransactionController.getPortfolio`.
- Цены: прокси `PriceProxyController.java` и сервис `PriceService.java` (используется в трейдах).

## 3. Нефункциональные требования (и подтверждение)
- Доступ только к своим данным: все контроллеры берут пользователя из `SecurityContextHolder` и фильтруют репозитории по `portfolio.user` (`getAuthenticatedUser()` в контроллерах).
- Целостность: PK/FK/UNIQUE/ENUM/NOT NULL в `documentation/tradedb_schema_only.sql`; JPA аннотации в `model/*.java` задают те же ограничения.
- Транзакции: Spring Data/JPA по умолчанию оборачивает записи; импорт/продажи проходят через сервисы (`TradeService`) — там единый поток логики. Честно, я бы добавил явные @Transactional, но сейчас они на уровне репозиториев по умолчанию.
- Производительность: локальная H2, формальных замеров нет; выборки идут по индексируемым полям (PK/скрытые индексы на FK), в схеме видны PK/FK проверки.
- Логирование SQL включено в `backend/src/main/resources/application.properties` (hibernate.show_sql, форматтер, trace binder).

## 4. Сущности и связи (ER)
- `User` (`model/User.java`) — 1:N `Portfolio`.
- `Portfolio` (`model/Portfolio.java`) — 1:N `Trade`, 1:N `SpotTransaction`.
- `Trade` (`model/Trade.java`) — 1:N `TradeClosure`, 1:N `FinancingEvent`.
- `TradeClosure` (`model/TradeClosure.java`) — каждая строка закрывает часть сделки.
- `FinancingEvent` (`model/FinancingEvent.java`) — история ставки/погашений/залога.
- `SpotTransaction` (`model/SpotTransaction.java`) — спотовые операции, включая кэш (ticker=USD) и акции.
Таблицы в H2 названы во множественном числе и совпадают с JPA (`TRADES`, `PORTFOLIOS`, `USERS`, `TRADE_CLOSURES`, `FINANCING_EVENTS`, `SPOT_TRANSACTIONS`).

## 5. Функциональные и многозначные зависимости (отражены в JPA/схеме)
- `users`: `username → email,password,first_name,last_name,enabled`; `email → username,password,…`; `id` — PK.
- `portfolios`: `id → user_id,name,type,currency,is_active,…`; `(user_id,name)` уникально (см. UNIQUE в схеме).
- `trades`: `id → portfolio_id,symbol,entry_price,quantity,entry_date,margin_amount,…`; `trade_id →> financing_events`; `trade_id →> trade_closures`.
- `trade_closures`: `id → trade_id, closed_quantity, exit_price, exit_date`.
- `financing_events`: `id → trade_id, event_date, event_type, rate, amount_change`.
- `spot_transactions`: `id → portfolio_id,ticker,transaction_type,price,quantity,amount,trade_date`.
Мне однажды пришлось чинить похожую зависимость в другом проекте — удобно, что здесь связи чистые.

## 5.1. Текстовые ограничения на данные (из требований)
- Одна сделка (`Trade`) принадлежит ровно одному портфелю; одно закрытие — ровно одной сделке; одно событие финансирования — ровно одной сделке.
- Количество в сделке и закрытии > 0; цены входа/выхода > 0; ставка маржи > 0; типы соответствуют ENUM (см. CHECK в `tradedb_schema_only.sql`).
- У портфеля одна валюта, тип из набора {MARGIN, SPOT}; имя уникально в рамках пользователя.
- Спот-операции: тип из {DEPOSIT, WITHDRAW, BUY, SELL, DIVIDEND}; BUY/WITHDRAW уменьшают кэш (amount отрицательный).
- Для отчетов: прибыль считается только по закрытым сделкам (`exit_date IS NOT NULL`).

## 6. Нормализация (как пришли к 3НФ/BCNF)
Стартовая денорма — представить “журнал” с пользователем, портфелем, сделкой, событием финансирования и спот-операцией в одной таблице. Там куча дублирования и аномалий. Шаги, которые фактически отражены в коде и схеме:
1) Отделили учетку `User` (`model/User.java`) — убрали дубли username/email.
2) Вынесли метаданные портфеля в `Portfolio` — уникальность имени внутри пользователя (`PortfolioRepository` не даёт смешивать разных user).
3) Сделку храним в `Trade`, а историю ставки/погашений — в `FinancingEvent`; многозначные зависимости уходят.
4) Закрытия `TradeClosure` отдельно, потому что у сделки может быть несколько частичных выходов.
5) Спот-операции (`SpotTransaction`) отдельно от маржинальных сделок.
Аномалии вставки/обновления/удаления уходят: ставку меняем в таблице событий, не дублируя сделку; кэш считается по спот-транзакциям, не по сделкам. Я сначала подумал, что спот и маржа можно слить, но отказался — гибче так.

## 7. Пример аномалии (как было бы плохо)
Если хранить историю ставок прямо в `TRADES` (по одной строке на событие), то при обновлении ставки придётся дублировать все поля сделки. Удалишь событие — потеряешь сделку. Разделение на `TRADES` + `FINANCING_EVENTS` это чинит. Небольшой регресс: две таблицы вместо одной, но зато никаких каскадных сюрпризов.

## 8. SQL DDL (полный, как в H2/по JPA)
Полная схема без данных лежит в `documentation/tradedb_schema_only.sql`. Ниже тот же DDL:
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

## 9. SQL DML (примеры)
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

## 10. Транзакции (пример группировки)
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

## 11. Нефункциональные детали и риски
- Безопасность: JWT, секрет в `application.properties` (`jwt.secret`), роли базовые; авторизация фильтрует данные по пользователю.
- Производительность: H2 локально, для прод нужны индексы под отчеты (по exit_date, symbol). Порог в пару сотен тысяч строк, думаю, выдержит. Возможно, стоит добавить индекс на `SPOT_TRANSACTIONS (TICKER)` — H2 его уже сделал.
- Резервные копии: дампы в `backend/data/*backup*.mv.db` — их не трогаю. Однажды видел, как люди случайно удаляли боевую БД, поэтому аккуратнее.

## 12. Как использовать это для защиты
- Показываем требования и связи, ссылаясь на контроллеры/модели.
- Демонстрируем схему: `tradedb_schema_only.sql` или открываем H2-console и прогоняем `SHOW TABLES;`.
- Пример аномалии — раздел 7.
- Нормализацию — раздел 6.
- DML — из `db_homework.md` или JPQL из репо.
Если что-то хочется упростить — можно взять один сценарий: “открыли сделку, сменили ставку, закрыли частично, посмотрели прибыль по тикеру”.

## 13. Личные мелочи
Иногда ловлю себя на мысли, что H2 любит сюрпризы с типами, но здесь всё стабильно. Пару раз перепроверял схемы — да, совпадает с аннотациями. Если вдруг понадобится PostgreSQL, этот DDL адаптируется почти без правок. Думаю, хватит. Probably good.

## 14. Мини-набор запросов (для итогового документа)
Если нужно вставить прямо в пояснительную записку, возьмите эти (полный набор и транзакции — в `documentation/db_homework.md`):
```sql
-- Создать портфель
INSERT INTO portfolios (user_id, name, portfolio_type, currency) VALUES (1, 'Margin US', 'MARGIN', 'USD');
-- Открыть маржинальную сделку
INSERT INTO trades (portfolio_id, symbol, entry_price, quantity, entry_date, margin_amount) VALUES (1, 'AAPL', 180.25, 100, CURRENT_DATE, 8.50);
-- Смена ставки
INSERT INTO financing_events (trade_id, event_date, event_type, rate) VALUES (1, CURRENT_DATE, 'RATE_CHANGE', 7.9);
-- Частичное закрытие
INSERT INTO trade_closures (trade_id, closed_quantity, exit_price, exit_date) VALUES (1, 40, 195.10, CURRENT_DATE);
-- Спотовая покупка
INSERT INTO spot_transactions (portfolio_id, company, ticker, transaction_type, price, quantity, amount, trade_date)
VALUES (1, 'Microsoft Corp', 'MSFT', 'BUY', 370.5, 10, -3705, CURRENT_DATE);
-- Прибыль по тикерам (аналог findSymbolProfits)
SELECT t.symbol, SUM((t.exit_price - t.entry_price) * t.quantity) AS profit
FROM trades t JOIN portfolios p ON p.id = t.portfolio_id
WHERE t.exit_date IS NOT NULL AND p.user_id = 1
GROUP BY t.symbol ORDER BY profit DESC;
-- Месячная прибыль (аналог findMonthlyProfits)
SELECT FORMATDATETIME(t.exit_date, 'yyyy-MM') AS month,
       SUM((t.exit_price - t.entry_price) * t.quantity) AS profit
FROM trades t JOIN portfolios p ON p.id = t.portfolio_id
WHERE t.exit_date IS NOT NULL AND p.user_id = 1
GROUP BY FORMATDATETIME(t.exit_date, 'yyyy-MM')
ORDER BY month;
```

## 15. Что и как, и ссылки
- Пояснительная записка: `documentation/db_explanatory_note.md` (этот файл).
- Полный набор DML/DDL/транзакций: `documentation/db_homework.md` (разделы SQL DDL/DML/транзакции).
- Фактическая схема из H2 без данных: `documentation/tradedb_schema_only.sql` .
- Прототипный демо-дамп (без реальных данных): `documentation/tradedb_schema_sample_dump.sql` — только для демонстрации(полный дамп не прикладываю)
- Ссылка на репозиторий/ветку: https://github.com/KJkloun/Portfolio-Risk.