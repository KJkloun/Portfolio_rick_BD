package com.example.diary.controller;

import com.example.diary.model.Portfolio;
import com.example.diary.model.Trade;
import com.example.diary.model.TradeClosure;
import com.example.diary.model.FinancingEvent;
import com.example.diary.model.User;
import com.example.diary.model.FinancingEvent.EventType;
import com.example.diary.service.TradeService;
import com.example.diary.repository.FinancingEventRepository;
import com.example.diary.repository.TradeClosureRepository;
import com.example.diary.repository.TradeRepository;
import com.example.diary.service.UserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.temporal.ChronoUnit;
import java.util.stream.Collectors;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import com.example.diary.service.PriceService;
import com.example.diary.service.PriceService.Quote;

@RestController
@RequestMapping("/trades")
@CrossOrigin(origins = "*")
public class TradeController {

    private static final Logger logger = LoggerFactory.getLogger(TradeController.class);

    @Autowired
    private TradeRepository tradeRepository;

    @Autowired
    private TradeClosureRepository tradeClosureRepository;

    @Autowired
    private TradeService tradeService;

    @Autowired
    private FinancingEventRepository financingEventRepository;

    @Autowired
    private com.example.diary.repository.PortfolioRepository portfolioRepository;

    @Autowired
    private UserService userService;

    @Autowired
    private PriceService priceService;
    @GetMapping
    public ResponseEntity<List<Trade>> getAllTrades(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<Trade> trades;
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            trades = tradeRepository.findByPortfolioIdAndPortfolioUser(portfolio.getId(), user);
        } else {
            trades = tradeRepository.findByPortfolioUser(user);
        }
        return ResponseEntity.ok(trades);
    }

    @PostMapping("/buy")
    public ResponseEntity<?> buyTrade(@RequestBody Trade trade,
                                      @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            logger.info("Получен запрос на покупку: {}", trade);

            if (portfolioId == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Не указан портфель для сделки"));
            }

            User user = getAuthenticatedUser();
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            trade.setPortfolio(portfolio);

            // Используем дату из запроса, если она не указана - используем текущую
            if (trade.getEntryDate() == null) {
                trade.setEntryDate(LocalDate.now());
            }
            
            // Проверка, что необходимые поля не null
            if (trade.getSymbol() == null || trade.getSymbol().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Тикер не может быть пустым"));
            }
            
            if (trade.getEntryPrice() == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Цена входа не может быть пустой"));
            }
            
            if (trade.getQuantity() == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Количество не может быть пустым"));
            }
            
            if (trade.getMarginAmount() == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Процент за кредит не может быть пустым"));
            }

            Trade savedTrade = tradeService.openTrade(trade, portfolio);
            logger.info("Сделка сохранена с ID: {}", savedTrade.getId());

            URI location = ServletUriComponentsBuilder
                .fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(savedTrade.getId())
                .toUri();

            Map<String, Object> response = new HashMap<>();
            response.put("trade", savedTrade);
            response.put("totalCost", savedTrade.getTotalCost());
            response.put("dailyInterest", savedTrade.getDailyInterestAmount());

            return ResponseEntity.created(location).body(response);
        } catch (Exception e) {
            logger.error("Ошибка при создании сделки", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка создания сделки: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    @PostMapping("/bulk-import")
    public ResponseEntity<?> bulkImportTrades(@RequestBody Map<String, List<Map<String, Object>>> request,
                                              @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            logger.info("Получен запрос на массовый импорт сделок");

            if (portfolioId == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Не указан портфель для импорта сделок"));
            }

            User user = getAuthenticatedUser();
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);

            List<Map<String, Object>> tradesToImport = request.get("trades");
            if (tradesToImport == null || tradesToImport.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Список сделок пуст"));
            }

            List<Trade> savedTrades = new ArrayList<>();
            int importedCount = 0;
            int errorCount = 0;
            List<Map<String, String>> errors = new ArrayList<>();

            for (int i = 0; i < tradesToImport.size(); i++) {
                try {
                    Map<String, Object> tradeData = tradesToImport.get(i);
                    Trade trade = new Trade();
                    trade.setPortfolio(portfolio);

                    // Обязательные поля
                    String symbol = (String) tradeData.get("symbol");
                    if (symbol == null || symbol.trim().isEmpty()) {
                        throw new IllegalArgumentException("Тикер не может быть пустым");
                    }
                    trade.setSymbol(symbol.trim().toUpperCase());

                    // Цена входа
                    Object entryPriceObj = tradeData.get("entryPrice");
                    if (entryPriceObj == null) {
                        throw new IllegalArgumentException("Цена входа не может быть пустой");
                    }
                    BigDecimal entryPrice;
                    if (entryPriceObj instanceof String) {
                        entryPrice = new BigDecimal((String) entryPriceObj);
                    } else if (entryPriceObj instanceof Number) {
                        entryPrice = BigDecimal.valueOf(((Number) entryPriceObj).doubleValue());
                    } else {
                        throw new IllegalArgumentException("Неверный формат цены входа");
                    }
                    trade.setEntryPrice(entryPrice);

                    // Количество
                    Object quantityObj = tradeData.get("quantity");
                    if (quantityObj == null) {
                        throw new IllegalArgumentException("Количество не может быть пустым");
                    }
                    Integer quantity;
                    if (quantityObj instanceof String) {
                        quantity = Integer.parseInt((String) quantityObj);
                    } else if (quantityObj instanceof Number) {
                        quantity = ((Number) quantityObj).intValue();
                    } else {
                        throw new IllegalArgumentException("Неверный формат количества");
                    }
                    trade.setQuantity(quantity);

                    // Процент маржи
                    Object marginAmountObj = tradeData.get("marginAmount");
                    if (marginAmountObj == null) {
                        throw new IllegalArgumentException("Процент маржи не может быть пустым");
                    }
                    BigDecimal marginAmount;
                    if (marginAmountObj instanceof String) {
                        marginAmount = new BigDecimal((String) marginAmountObj);
                    } else if (marginAmountObj instanceof Number) {
                        marginAmount = BigDecimal.valueOf(((Number) marginAmountObj).doubleValue());
                    } else {
                        throw new IllegalArgumentException("Неверный формат процента маржи");
                    }
                    trade.setMarginAmount(marginAmount);

                    // Дата входа
                    Object entryDateObj = tradeData.get("entryDate");
                    if (entryDateObj == null) {
                        throw new IllegalArgumentException("Дата входа не может быть пустой");
                    }
                    LocalDate entryDate;
                    if (entryDateObj instanceof String) {
                        entryDate = LocalDate.parse((String) entryDateObj);
                    } else {
                        throw new IllegalArgumentException("Неверный формат даты входа");
                    }
                    trade.setEntryDate(entryDate);

                    // Опциональные поля
                    // Заметки
                    if (tradeData.containsKey("notes")) {
                        trade.setNotes((String) tradeData.get("notes"));
                    }

                    // Дата выхода (если есть)
                    if (tradeData.containsKey("exitDate") && tradeData.get("exitDate") != null && !((String) tradeData.get("exitDate")).isEmpty()) {
                        LocalDate exitDate = LocalDate.parse((String) tradeData.get("exitDate"));
                        trade.setExitDate(exitDate);

                        // Если есть дата выхода, должна быть и цена выхода
                        if (tradeData.containsKey("exitPrice") && tradeData.get("exitPrice") != null) {
                            Object exitPriceObj = tradeData.get("exitPrice");
                            BigDecimal exitPrice;
                            if (exitPriceObj instanceof String) {
                                if (!((String) exitPriceObj).isEmpty()) {
                                    exitPrice = new BigDecimal((String) exitPriceObj);
                                    trade.setExitPrice(exitPrice);
                                }
                            } else if (exitPriceObj instanceof Number) {
                                exitPrice = BigDecimal.valueOf(((Number) exitPriceObj).doubleValue());
                                trade.setExitPrice(exitPrice);
                            }
                        }
                    }
                    // Сохраняем сделку
                    Trade savedTrade = tradeRepository.save(trade);
                    savedTrades.add(savedTrade);
                    importedCount++;
                    logger.info("Импортирована сделка с ID: {}", savedTrade.getId());
                } catch (Exception e) {
                    errorCount++;
                    Map<String, String> error = new HashMap<>();
                    error.put("row", String.valueOf(i + 1));
                    error.put("message", e.getMessage());
                    errors.add(error);
                    logger.error("Ошибка при импорте строки {}: {}", i + 1, e.getMessage());
                }
            }

            Map<String, Object> response = new HashMap<>();
            response.put("importedCount", importedCount);
            response.put("errorCount", errorCount);
            if (!errors.isEmpty()) {
                response.put("errors", errors);
            }

            if (importedCount > 0) {
                return ResponseEntity.ok(response);
            } else {
                return ResponseEntity.badRequest().body(response);
            }
        } catch (Exception e) {
            logger.error("Ошибка при массовом импорте сделок", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка массового импорта сделок: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    // Ручное закрытие отключено: используйте FIFO
    @PostMapping("/{id}/sell")
    public ResponseEntity<?> sellTrade(
            @PathVariable Long id,
            @RequestParam Double exitPrice,
            @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        return ResponseEntity.badRequest().body(Map.of(
            "message", "Используйте FIFO закрытие /trades/fifo-close. Ручное закрытие сделки отключено."
        ));
    }

    @GetMapping("/{id}/daily-interest")
    public ResponseEntity<?> getDailyInterest(@PathVariable Long id) {
        try {
            User user = getAuthenticatedUser();
            Trade trade = tradeRepository.findByIdAndPortfolioUser(id, user)
                .orElseThrow(() -> new RuntimeException("Сделка не найдена"));

            Map<String, Object> response = new HashMap<>();
            response.put("dailyInterest", trade.getDailyInterestAmount());
            response.put("totalInterest", trade.getTotalInterest());
            response.put("interests", trade.getDailyInterestList());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Ошибка при получении процентов", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка получения ежедневных процентов: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    @GetMapping("/{id}/financing-events")
    public ResponseEntity<?> getFinancingEvents(@PathVariable Long id) {
        try {
            User user = getAuthenticatedUser();
            List<FinancingEvent> events = financingEventRepository.findByTradeIdAndUser(id, user);
            return ResponseEntity.ok(events);
        } catch (Exception e) {
            logger.error("Ошибка при получении событий финансирования", e);
            return ResponseEntity.badRequest().body(Map.of("message", "Ошибка получения событий: " + e.getMessage()));
        }
    }

    @PostMapping("/{id}/financing-events")
    public ResponseEntity<?> addFinancingEvent(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        try {
            User user = getAuthenticatedUser();
            Trade trade = tradeRepository.findByIdAndPortfolioUser(id, user)
                .orElseThrow(() -> new RuntimeException("Сделка не найдена"));

            FinancingEvent event = new FinancingEvent();
            event.setTrade(trade);

            String typeStr = payload.getOrDefault("eventType", EventType.RATE_CHANGE.name()).toString();
            EventType eventType = EventType.valueOf(typeStr.toUpperCase());
            event.setEventType(eventType);

            LocalDate eventDate = payload.get("eventDate") != null
                ? LocalDate.parse(payload.get("eventDate").toString())
                : LocalDate.now();
            event.setEventDate(eventDate);

            if (payload.get("rate") != null) {
                event.setRate(new BigDecimal(payload.get("rate").toString()));
            }

            if (payload.get("amountChange") != null) {
                event.setAmountChange(new BigDecimal(payload.get("amountChange").toString()));
            }

            if (payload.get("notes") != null) {
                event.setNotes(payload.get("notes").toString());
            }

            FinancingEvent saved = financingEventRepository.save(event);

            // Применяем изменения к сделке (быстрый пересчёт)
            if (eventType == EventType.REPAYMENT && event.getAmountChange() != null) {
                BigDecimal borrowed = trade.getBorrowedAmount() == null ? BigDecimal.ZERO : trade.getBorrowedAmount();
                BigDecimal updated = borrowed.subtract(event.getAmountChange());
                if (updated.compareTo(BigDecimal.ZERO) < 0) updated = BigDecimal.ZERO;
                trade.setBorrowedAmount(updated.setScale(2, RoundingMode.HALF_UP));
            } else if (eventType == EventType.COLLATERAL_TOPUP && event.getAmountChange() != null) {
                BigDecimal collateral = trade.getCollateralAmount() == null ? BigDecimal.ZERO : trade.getCollateralAmount();
                BigDecimal updated = collateral.add(event.getAmountChange());
                trade.setCollateralAmount(updated.setScale(2, RoundingMode.HALF_UP));
            } else if (eventType == EventType.RATE_CHANGE && event.getRate() != null) {
                trade.setMarginAmount(event.getRate().setScale(4, RoundingMode.HALF_UP));
            }

            tradeRepository.save(trade);

            return ResponseEntity.ok(Map.of(
                "event", saved,
                "tradeId", trade.getId(),
                "borrowedAmount", trade.getBorrowedAmount(),
                "collateralAmount", trade.getCollateralAmount(),
                "currentRate", trade.getMarginAmount()
            ));
        } catch (Exception e) {
            logger.error("Ошибка при добавлении события финансирования", e);
            return ResponseEntity.badRequest().body(Map.of("message", "Ошибка добавления события: " + e.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getTrade(@PathVariable Long id,
                                                @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        Optional<Trade> tradeOpt = tradeRepository.findByIdAndPortfolioUser(id, user);
        if (tradeOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        Trade trade = tradeOpt.get();
        if (portfolioId != null && !trade.getPortfolio().getId().equals(portfolioId)) {
            return ResponseEntity.status(403).build();
        }
        return ResponseEntity.ok().body(trade);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTrade(@PathVariable Long id,
                                         @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            User user = getAuthenticatedUser();
            Optional<Trade> tradeOpt = tradeRepository.findByIdAndPortfolioUser(id, user);
            if (tradeOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            Trade trade = tradeOpt.get();
            if (portfolioId != null && !trade.getPortfolio().getId().equals(portfolioId)) {
                return ResponseEntity.status(403).build();
            }
            tradeRepository.delete(trade);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            logger.error("Ошибка при удалении сделки", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка удаления сделки: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }
    
    // Аналитика на основе реальных данных
    @GetMapping("/analytics/summary")
    public ResponseEntity<?> getAnalyticsSummary(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<Trade> allTrades;
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            allTrades = tradeRepository.findByPortfolioIdAndPortfolioUser(portfolio.getId(), user);
        } else {
            allTrades = tradeRepository.findByPortfolioUser(user);
        }
        
        // Фильтрация по дате, если указаны параметры
        if (startDate != null || endDate != null) {
            LocalDate start = startDate != null ? 
                LocalDate.parse(startDate) : LocalDate.of(1900, 1, 1);
            LocalDate end = endDate != null ? 
                LocalDate.parse(endDate) : LocalDate.now();
            
            allTrades = allTrades.stream()
                .filter(trade -> {
                    // Фильтруем по дате входа для открытых сделок или по дате выхода для закрытых
                    LocalDate date = trade.getExitDate() != null ? trade.getExitDate() : trade.getEntryDate();
                    return !date.isBefore(start) && !date.isAfter(end);
                })
                .collect(Collectors.toList());
        }
        
        // Считаем количество сделок
        int totalTrades = allTrades.size();
        
        // Считаем количество прибыльных сделок (только для закрытых)
        List<Trade> closedTrades = allTrades.stream()
            .filter(trade -> trade.getExitDate() != null)
            .collect(Collectors.toList());
        
        int winningTrades = 0;
        double totalProfit = 0.0;
        
        for (Trade trade : closedTrades) {
            Double profit = trade.getProfit();
            if (profit != null) {
                if (profit > 0) {
                    winningTrades++;
                }
                totalProfit += profit;
            }
        }
        
        // Рассчитываем процент успешных сделок
        double winRate = closedTrades.isEmpty() ? 0 : 
            Math.round((double) winningTrades / closedTrades.size() * 10000) / 100.0;
        
        Map<String, Object> summary = new HashMap<>();
        summary.put("totalTrades", totalTrades);
        summary.put("closedTrades", closedTrades.size());
        summary.put("winningTrades", winningTrades);
        summary.put("winRate", winRate);
        summary.put("totalProfit", Math.round(totalProfit * 100) / 100.0);
        
        return ResponseEntity.ok(summary);
    }
    
    @GetMapping("/analytics/monthly")
    public ResponseEntity<?> getMonthlyAnalytics(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<Trade> allTrades;
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            allTrades = tradeRepository.findByPortfolioIdAndPortfolioUser(portfolio.getId(), user);
        } else {
            allTrades = tradeRepository.findByPortfolioUser(user);
        }
        
        // Фильтрация по дате, если указаны параметры
        LocalDate start = startDate != null ? 
            LocalDate.parse(startDate) : LocalDate.of(LocalDate.now().getYear() - 1, 1, 1);
        LocalDate end = endDate != null ? 
            LocalDate.parse(endDate) : LocalDate.now();
        
        // Создаем карту для хранения данных по месяцам
        Map<String, Double> monthlyData = new HashMap<>();
        
        // Подготавливаем список всех месяцев в диапазоне
        LocalDate current = start.withDayOfMonth(1);
        DateTimeFormatter monthFormatter = DateTimeFormatter.ofPattern("yyyy-MM");
        
        while (!current.isAfter(end)) {
            monthlyData.put(current.format(monthFormatter), 0.0);
            current = current.plusMonths(1);
        }
        
        // Заполняем данные по закрытым сделкам
        for (Trade trade : allTrades) {
            if (trade.getExitDate() != null) {
                // Используем дату закрытия сделки
                LocalDate exitDate = trade.getExitDate();
                if (!exitDate.isBefore(start) && !exitDate.isAfter(end)) {
                    String month = exitDate.format(monthFormatter);
                    Double profit = trade.getProfit();
                    if (profit != null) {
                        monthlyData.put(month, monthlyData.getOrDefault(month, 0.0) + profit);
                    }
                }
            }
        }
        
        // Формируем список результатов по месяцам
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, Double> entry : monthlyData.entrySet()) {
            Map<String, Object> monthData = new HashMap<>();
            monthData.put("month", entry.getKey());
            monthData.put("profit", Math.round(entry.getValue() * 100) / 100.0);
            result.add(monthData);
        }
        
        // Сортируем по месяцам
        result.sort((a, b) -> ((String) a.get("month")).compareTo((String) b.get("month")));
        
        return ResponseEntity.ok(result);
    }
    
    @GetMapping("/analytics/symbols")
    public ResponseEntity<?> getSymbolAnalytics(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<Trade> allTrades;
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            allTrades = tradeRepository.findByPortfolioIdAndPortfolioUser(portfolio.getId(), user);
        } else {
            allTrades = tradeRepository.findByPortfolioUser(user);
        }
        
        // Фильтрация по дате, если указаны параметры
        if (startDate != null || endDate != null) {
            LocalDate start = startDate != null ? 
                LocalDate.parse(startDate) : LocalDate.of(1900, 1, 1);
            LocalDate end = endDate != null ? 
                LocalDate.parse(endDate) : LocalDate.now();
            
            allTrades = allTrades.stream()
                .filter(trade -> {
                    // Для закрытых сделок используем дату закрытия, для открытых - дату открытия
                    LocalDate date = trade.getExitDate() != null ? trade.getExitDate() : trade.getEntryDate();
                    return !date.isBefore(start) && !date.isAfter(end);
                })
                .collect(Collectors.toList());
        }
        
        // Группируем данные по символам
        Map<String, Double> symbolData = new HashMap<>();
        Map<String, Integer> symbolCount = new HashMap<>();
        
        for (Trade trade : allTrades) {
            String symbol = trade.getSymbol();
            symbolCount.put(symbol, symbolCount.getOrDefault(symbol, 0) + 1);
            
            if (trade.getExitDate() != null) {
                Double profit = trade.getProfit();
                if (profit != null) {
                    symbolData.put(symbol, symbolData.getOrDefault(symbol, 0.0) + profit);
                }
            }
        }
        
        // Формируем результат
        List<Map<String, Object>> result = new ArrayList<>();
        for (String symbol : symbolData.keySet()) {
            Map<String, Object> data = new HashMap<>();
            data.put("symbol", symbol);
            data.put("profit", Math.round(symbolData.get(symbol) * 100) / 100.0);
            data.put("count", symbolCount.get(symbol));
            result.add(data);
        }
        
        // Сортируем по прибыли (по убыванию)
        result.sort((a, b) -> Double.compare((Double) b.get("profit"), (Double) a.get("profit")));
        
        return ResponseEntity.ok(result);
    }

    @PostMapping("/update-interest-rates")
    public ResponseEntity<?> updateInterestRates(@RequestBody Map<String, Object> request) {
        try {
            logger.info("Получен запрос на обновление процентных ставок");
            
            User user = getAuthenticatedUser();

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rateChanges = (List<Map<String, Object>>) request.get("rateChanges");
            Boolean applyToOpenTrades = (Boolean) request.get("applyToOpenTrades");
            
            if (rateChanges == null || rateChanges.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Список изменений ставок пуст"));
            }
            
            // Получаем все открытые сделки
            List<Trade> openTrades = tradeRepository.findByPortfolioUser(user).stream()
                .filter(trade -> trade.getExitDate() == null)
                .collect(Collectors.toList());
            
            if (applyToOpenTrades != null && applyToOpenTrades && !openTrades.isEmpty()) {
                // Находим самую последнюю ставку
                @SuppressWarnings("unchecked")
                Map<String, Object> latestRateChange = rateChanges.stream()
                    .max((a, b) -> ((String) a.get("date")).compareTo((String) b.get("date")))
                    .orElse(null);
                
                if (latestRateChange != null) {
                    Object rateObj = latestRateChange.get("rate");
                    BigDecimal newRate;
                    
                    if (rateObj instanceof Number) {
                        newRate = BigDecimal.valueOf(((Number) rateObj).doubleValue());
                    } else {
                        newRate = new BigDecimal(rateObj.toString());
                    }
                    newRate = newRate.setScale(4, RoundingMode.HALF_UP);
                    
                    // Обновляем ставки во всех открытых сделках
                    List<Trade> updatedTrades = new ArrayList<>();
                    for (Trade trade : openTrades) {
                        trade.setMarginAmount(newRate);
                        Trade savedTrade = tradeRepository.save(trade);
                        updatedTrades.add(savedTrade);
                    }
                    
                    logger.info("Обновлены ставки в {} открытых сделках на {}", 
                               updatedTrades.size(), newRate);
                    
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    response.put("updatedTrades", updatedTrades.size());
                    response.put("newRate", newRate);
                    response.put("message", String.format("Ставка %s%% применена к %d открытым сделкам", 
                                                        newRate, updatedTrades.size()));
                    
                    return ResponseEntity.ok(response);
                }
            }
            
            // Если не нужно применять к сделкам, просто возвращаем успех
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "Изменения ставок сохранены");
            response.put("rateChangesCount", rateChanges.size());
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            logger.error("Ошибка при обновлении процентных ставок", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка обновления процентных ставок: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    @PostMapping("/analytics/floating-rates-impact")
    public ResponseEntity<?> getFloatingRatesImpact(@RequestBody Map<String, Object> request) {
        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rateChanges = (List<Map<String, Object>>) request.get("rateChanges");
            
            if (rateChanges == null || rateChanges.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Список изменений ставок пуст"));
            }

            User user = getAuthenticatedUser();
            List<Trade> openTrades = tradeRepository.findByPortfolioUser(user).stream()
                .filter(trade -> trade.getExitDate() == null)
                .collect(Collectors.toList());
            
            // Рассчитываем влияние изменения ставок на открытые позиции
            double totalInvested = 0.0;
            double totalInterestOld = 0.0;

            for (Trade trade : openTrades) {
                Double investment = trade.getTotalCost();
                if (investment != null) {
                    totalInvested += investment;
                }

                Double dailyInterest = trade.getDailyInterestAmount();
                if (dailyInterest != null && trade.getEntryDate() != null) {
                    long daysHeld = ChronoUnit.DAYS.between(trade.getEntryDate(), LocalDate.now());
                    totalInterestOld += dailyInterest * daysHeld;
                }
            }
            
            Map<String, Object> impact = new HashMap<>();
            impact.put("openTrades", openTrades.size());
            impact.put("totalInvested", Math.round(totalInvested * 100) / 100.0);
            impact.put("totalInterestCurrent", Math.round(totalInterestOld * 100) / 100.0);
            impact.put("rateChangesCount", rateChanges.size());
            
            return ResponseEntity.ok(impact);
            
        } catch (Exception e) {
            logger.error("Ошибка при расчете влияния плавающих ставок", e);
            Map<String, String> error = new HashMap<>();
            error.put("message", "Ошибка расчета влияния: " + e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    @PostMapping("/{id}/close-part")
    public ResponseEntity<?> closePartOfTrade(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        try {
            User user = getAuthenticatedUser();
            Optional<Trade> optTrade = tradeRepository.findByIdAndPortfolioUser(id, user);
            if (optTrade.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            Trade trade = optTrade.get();

            // Извлечение параметров
            if (!payload.containsKey("quantity") || !payload.containsKey("exitPrice")) {
                return ResponseEntity.badRequest().body(Map.of("message", "quantity и exitPrice обязательны"));
            }
            int qty = ((Number) payload.get("quantity")).intValue();
            BigDecimal exitPrice = new BigDecimal(payload.get("exitPrice").toString());
            LocalDate exitDate = payload.containsKey("exitDate") && payload.get("exitDate") != null
                    ? LocalDate.parse(payload.get("exitDate").toString())
                    : LocalDate.now();
            String notes = payload.getOrDefault("notes", "").toString();

            // Проверки
            if (qty <= 0) {
                return ResponseEntity.badRequest().body(Map.of("message", "Количество должно быть > 0"));
            }
            Integer openQty = trade.getOpenQuantity();
            if (openQty == null || qty > openQty) {
                return ResponseEntity.badRequest().body(Map.of("message", "Недостаточно открытых лотов для закрытия"));
            }

            // Создание closure
            TradeClosure closure = new TradeClosure();
            closure.setTrade(trade);
            closure.setClosedQuantity(qty);
            closure.setExitPrice(exitPrice);
            closure.setExitDate(exitDate);
            closure.setNotes(notes);

            tradeClosureRepository.save(closure);

            // Возвращаем обновлённую сделку с открытиями и закрытиями
            return ResponseEntity.ok(Map.of("message", "Частичное закрытие сохранено", "trade", tradeRepository.findByIdAndPortfolioUser(id, user).get()));
        } catch (Exception e) {
            logger.error("Ошибка при частичном закрытии", e);
            return ResponseEntity.badRequest().body(Map.of("message", "Ошибка: " + e.getMessage()));
        }
    }

    /**
     * FIFO закрытие по тикеру: закрывает указанное количество лотов, начиная с самых старых открытых сделок.
     */
    @PostMapping("/fifo-close")
    public ResponseEntity<?> closeFifo(
            @RequestBody Map<String, Object> payload,
            @RequestHeader(value = "X-Portfolio-ID") Long portfolioId) {
        try {
            User user = getAuthenticatedUser();
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);

            String symbol = payload.getOrDefault("symbol", "").toString().trim().toUpperCase();
            if (symbol.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Тикер обязателен"));
            }

            if (!payload.containsKey("quantity")) {
                return ResponseEntity.badRequest().body(Map.of("message", "quantity обязателен"));
            }
            int qtyToClose = ((Number) payload.get("quantity")).intValue();
            if (qtyToClose <= 0) {
                return ResponseEntity.badRequest().body(Map.of("message", "quantity должен быть > 0"));
            }

            if (!payload.containsKey("exitPrice")) {
                return ResponseEntity.badRequest().body(Map.of("message", "exitPrice обязателен"));
            }
            BigDecimal exitPrice = new BigDecimal(payload.get("exitPrice").toString());
            LocalDate exitDate = payload.containsKey("exitDate") && payload.get("exitDate") != null
                    ? LocalDate.parse(payload.get("exitDate").toString())
                    : LocalDate.now();
            String notes = payload.getOrDefault("notes", "").toString();

            Map<String, Object> response = tradeService.fifoClose(user, portfolio, symbol, qtyToClose, exitPrice, exitDate, notes);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Ошибка при FIFO закрытии", e);
            return ResponseEntity.badRequest().body(Map.of("message", "Ошибка FIFO закрытия: " + e.getMessage()));
        }
    }

    private User getAuthenticatedUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new RuntimeException("Пользователь не авторизован");
        }
        String username = authentication.getName();
        return userService.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
    }

    private Portfolio getPortfolioForUser(Long portfolioId, User user) {
        return portfolioRepository.findByIdAndUser(portfolioId, user)
                .filter(portfolio -> portfolio.getIsActive() == null || Boolean.TRUE.equals(portfolio.getIsActive()))
                .orElseThrow(() -> new RuntimeException("Портфель не найден или недоступен"));
    }

    /**
     * Сводная статистика по маржинальным сделкам (на бэке, чтобы не считать на фронте).
     */
    @GetMapping("/stats")
    public ResponseEntity<?> getStats(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<Trade> trades = portfolioId != null
                ? tradeRepository.findByPortfolioIdAndPortfolioUser(portfolioId, user)
                : tradeRepository.findByPortfolioUser(user);

        double totalCostOpen = 0;
        double totalSharesOpen = 0;
        double borrowedTotal = 0;
        double weightedRate = 0;
        double weight = 0;
        double totalInterestDaily = 0;
        double totalInterestMonthly = 0;
        double totalAccruedInterest = 0;
        double closedProfit = 0;
        double totalInterestPaid = 0;
        double potentialProfit = 0;
        double potentialProfitAfterInterest = 0;
        int openCount = 0;
        int closedCount = 0;

        for (Trade t : trades) {
            double total = safeMul(t.getEntryPrice(), t.getQuantity());
            double borrowed = t.getBorrowedAmount() != null ? t.getBorrowedAmount().doubleValue() : total;

            // Текущая дневная ставка по сделке
            Double daily = t.getDailyInterestAmount();
            double rateToday;
            if (daily != null && borrowed > 0) {
                rateToday = daily * 365 * 100 / borrowed;
            } else {
                rateToday = t.getMarginAmount() != null ? t.getMarginAmount().doubleValue() : 0;
                daily = borrowed * rateToday / 100 / 365;
            }

            if (t.getExitDate() == null) {
                openCount++;
                totalCostOpen += total;
                totalSharesOpen += t.getQuantity() != null ? t.getQuantity() : 0;
                borrowedTotal += borrowed;
                weightedRate += rateToday * borrowed;
                weight += borrowed;
                totalInterestDaily += daily != null ? daily : 0;
                totalInterestMonthly += (daily != null ? daily : 0) * 30;

                Double price = getLivePrice(t.getSymbol());
                if (price != null) {
                    double pot = (price - t.getEntryPrice().doubleValue()) * t.getQuantity();
                    potentialProfit += pot;
                    double accrued = t.getTotalInterest() != null ? t.getTotalInterest() : 0;
                    potentialProfitAfterInterest += pot - accrued;
                }
            } else {
                closedCount++;
                if (t.getExitPrice() != null) {
                    closedProfit += (t.getExitPrice().doubleValue() - t.getEntryPrice().doubleValue()) * t.getQuantity();
                }
            }

            Double totalInterest = t.getTotalInterest();
            if (totalInterest != null) {
                totalAccruedInterest += totalInterest;
                if (t.getExitDate() != null) {
                    totalInterestPaid += totalInterest;
                }
            }
        }

        double avgRate = weight > 0 ? weightedRate / weight : 0;

        Map<String, Object> resp = new HashMap<>();
        resp.put("totalCostOpen", round(totalCostOpen));
        resp.put("totalSharesOpen", round(totalSharesOpen));
        resp.put("borrowedTotal", round(borrowedTotal));
        resp.put("avgRate", round(avgRate, 2));
        resp.put("totalInterestDaily", round(totalInterestDaily));
        resp.put("totalInterestMonthly", round(totalInterestMonthly));
        resp.put("totalInterestYearly", round(totalInterestDaily * 365));
        resp.put("totalAccruedInterest", round(totalAccruedInterest));
        resp.put("totalInterestPaid", round(totalInterestPaid));
        resp.put("totalProfit", round(closedProfit));
        resp.put("totalOverallProfitAfterInterest", round(closedProfit - totalInterestPaid));
        resp.put("potentialProfit", round(potentialProfit));
        resp.put("potentialProfitAfterInterest", round(potentialProfitAfterInterest));
        resp.put("totalOverallProfit", round(closedProfit + potentialProfit));
        resp.put("totalOverallProfitNet", round(closedProfit - totalInterestPaid + potentialProfitAfterInterest));
        resp.put("openCount", openCount);
        resp.put("closedCount", closedCount);

        return ResponseEntity.ok(resp);
    }

    /**
     * Детализация открытых позиций (для карточек/таблиц на фронте).
     */
    @GetMapping("/positions/open")
    public ResponseEntity<?> getOpenPositions(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            logger.debug("GET /api/trades/positions portfolioId={}", portfolioId);
            User user = getAuthenticatedUser();
            List<Trade> trades = portfolioId != null
                    ? tradeRepository.findByPortfolioIdAndPortfolioUser(portfolioId, user)
                    : tradeRepository.findByPortfolioUser(user);

            List<Map<String, Object>> positions = trades.stream()
                    .filter(t -> t.getExitDate() == null)
                    .map(t -> {
                        double total = safeMul(t.getEntryPrice(), t.getQuantity());
                        double borrowed = t.getBorrowedAmount() != null ? t.getBorrowedAmount().doubleValue() : total;
                        double ltv = total > 0 ? (borrowed / total) * 100 : 0;
                        Double dailyInterest = t.getDailyInterestAmount();
                        double rateToday;
                        if (dailyInterest != null && borrowed > 0) {
                            rateToday = dailyInterest * 365 * 100 / borrowed;
                        } else {
                            rateToday = t.getMarginAmount() != null ? t.getMarginAmount().doubleValue() : 0;
                            dailyInterest = borrowed * rateToday / 100 / 365;
                        }
                        long heldDays = 0;
                        if (t.getEntryDate() != null) {
                            heldDays = ChronoUnit.DAYS.between(t.getEntryDate(), LocalDate.now());
                            if (heldDays < 0) heldDays = 0;
                        }
                        Map<String, Object> row = new HashMap<>();
                        row.put("id", t.getId());
                        row.put("symbol", t.getSymbol());
                        row.put("entryPrice", t.getEntryPrice());
                        row.put("quantity", t.getQuantity());
                        row.put("entryDate", t.getEntryDate());
                        row.put("borrowed", round(borrowed));
                        row.put("exposure", round(total));
                        row.put("ltv", round(ltv, 2));
                        row.put("rate", round(rateToday, 2));
                        row.put("interestPerDay", round(dailyInterest != null ? dailyInterest : 0));
                        row.put("maintenanceMargin", t.getMaintenanceMargin());
                        row.put("heldDays", heldDays);
                        return row;
                    })
                    .toList();

            return ResponseEntity.ok(positions);
        } catch (Exception e) {
            logger.error("Ошибка в /api/trades/positions", e);
            return ResponseEntity.ok(Collections.emptyList());
        }
    }

    private double safeMul(BigDecimal price, Integer qty) {
        if (price == null || qty == null) return 0;
        return price.doubleValue() * qty;
    }

    private double round(double val) {
        return round(val, 2);
    }

    private double round(double val, int scale) {
        return BigDecimal.valueOf(val).setScale(scale, RoundingMode.HALF_UP).doubleValue();
    }

    private Double getLivePrice(String ticker) {
        Quote quote = priceService.getPrice(ticker, 600);
        return quote != null ? quote.price() : null;
    }
}
