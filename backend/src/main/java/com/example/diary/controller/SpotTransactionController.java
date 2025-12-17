package com.example.diary.controller;

import com.example.diary.model.Portfolio;
import com.example.diary.model.SpotTransaction;
import com.example.diary.model.User;
import com.example.diary.repository.SpotTransactionRepository;
import com.example.diary.repository.PortfolioRepository;
import com.example.diary.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/spot-transactions")
@CrossOrigin(origins = "*")
public class SpotTransactionController {

    private static final Logger logger = LoggerFactory.getLogger(SpotTransactionController.class);

    @Autowired
    private SpotTransactionRepository repository;
    
    @Autowired
    private PortfolioRepository portfolioRepository;

    @Autowired
    private UserService userService;

    // Получить все транзакции
    @GetMapping
    public List<SpotTransaction> getAllTransactions(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            return repository.findByPortfolioId(portfolio.getId());
        }
        return repository.findByPortfolioUser(user);
    }

    // Создать новую транзакцию
    @PostMapping
    public ResponseEntity<?> createTransaction(@RequestBody SpotTransaction transaction, @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        if (portfolioId == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Не указан портфель для транзакции"));
        }
        User user = getAuthenticatedUser();
        Portfolio portfolio = getPortfolioForUser(portfolioId, user);
        transaction.setPortfolio(portfolio);
        SpotTransaction saved = repository.save(transaction);
        return ResponseEntity.ok(saved);
    }

    // Получить транзакцию по ID
    @GetMapping("/{id}")
    public ResponseEntity<SpotTransaction> getTransaction(@PathVariable Long id) {
        User user = getAuthenticatedUser();
        return repository.findByIdAndPortfolioUser(id, user)
                .map(transaction -> ResponseEntity.ok().body(transaction))
                .orElse(ResponseEntity.notFound().build());
    }

    // Обновить транзакцию
    @PutMapping("/{id}")
    public ResponseEntity<SpotTransaction> updateTransaction(@PathVariable Long id, @RequestBody SpotTransaction transactionDetails) {
        User user = getAuthenticatedUser();
        return repository.findByIdAndPortfolioUser(id, user)
                .map(transaction -> {
                    transaction.setCompany(transactionDetails.getCompany());
                    transaction.setTicker(transactionDetails.getTicker());
                    transaction.setTransactionType(transactionDetails.getTransactionType());
                    transaction.setPrice(transactionDetails.getPrice());
                    transaction.setQuantity(transactionDetails.getQuantity());
                    transaction.setTradeDate(transactionDetails.getTradeDate());
                    transaction.setNote(transactionDetails.getNote());
                    return ResponseEntity.ok(repository.save(transaction));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // Удалить транзакцию
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTransaction(@PathVariable Long id) {
        User user = getAuthenticatedUser();
        return repository.findByIdAndPortfolioUser(id, user)
                .map(transaction -> {
                    repository.delete(transaction);
                    return ResponseEntity.ok().build();
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // Получить портфель (текущие позиции)
    @GetMapping("/portfolio")
    public Map<String, Object> getPortfolio(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        List<SpotTransaction> transactions;
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            transactions = repository.findByPortfolioId(portfolio.getId());
        } else {
            transactions = repository.findByPortfolioUser(user);
        }
        
        // Группируем по тикерам
        Map<String, List<SpotTransaction>> byTicker = transactions.stream()
                .collect(Collectors.groupingBy(SpotTransaction::getTicker));
        
        List<Map<String, Object>> positions = new ArrayList<>();
        BigDecimal totalCash = BigDecimal.ZERO;
        
        for (Map.Entry<String, List<SpotTransaction>> entry : byTicker.entrySet()) {
            String ticker = entry.getKey();
            List<SpotTransaction> tickerTransactions = entry.getValue();
            
            if ("USD".equals(ticker)) {
                // Считаем наличные
                totalCash = tickerTransactions.stream()
                        .map(SpotTransaction::getAmount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
            } else {
                // Считаем позицию по акциям
                BigDecimal totalQuantity = BigDecimal.ZERO;
                BigDecimal totalCost = BigDecimal.ZERO;
                String company = "";
                
                for (SpotTransaction tx : tickerTransactions) {
                    if (tx.getTransactionType() == SpotTransaction.TransactionType.BUY) {
                        totalQuantity = totalQuantity.add(tx.getQuantity());
                        totalCost = totalCost.add(tx.getAmount().abs()); // amount для покупок отрицательный
                        company = tx.getCompany();
                    } else if (tx.getTransactionType() == SpotTransaction.TransactionType.SELL) {
                        totalQuantity = totalQuantity.subtract(tx.getQuantity());
                        totalCost = totalCost.subtract(tx.getAmount().abs());
                    }
                }
                
                if (totalQuantity.compareTo(BigDecimal.ZERO) != 0) {
                    Map<String, Object> position = new HashMap<>();
                    position.put("ticker", ticker);
                    position.put("company", company);
                    position.put("quantity", totalQuantity);
                    position.put("averagePrice", totalCost.divide(totalQuantity, 2, RoundingMode.HALF_UP));
                    position.put("totalCost", totalCost);
                    positions.add(position);
                }
            }
        }
        
        Map<String, Object> result = new HashMap<>();
        result.put("positions", positions);
        result.put("cash", totalCash);
        
        return result;
    }

    // Получить статистику
    @GetMapping("/statistics")
    public Map<String, Object> getStatistics() {
        User user = getAuthenticatedUser();
        List<SpotTransaction> transactions = repository.findByPortfolioUser(user);
        
        // Общая статистика
        long totalTransactions = transactions.size();
        BigDecimal totalInvested = transactions.stream()
                .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.BUY)
                .map(tx -> tx.getAmount().abs())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        
        BigDecimal totalReceived = transactions.stream()
                .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.SELL)
                .map(SpotTransaction::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        
        BigDecimal totalDividends = transactions.stream()
                .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.DIVIDEND)
                .map(SpotTransaction::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        
        // Статистика по тикерам
        Map<String, List<SpotTransaction>> byTicker = transactions.stream()
                .filter(tx -> !"USD".equals(tx.getTicker()))
                .collect(Collectors.groupingBy(SpotTransaction::getTicker));
        
        List<Map<String, Object>> tickerStats = new ArrayList<>();
        for (Map.Entry<String, List<SpotTransaction>> entry : byTicker.entrySet()) {
            String ticker = entry.getKey();
            List<SpotTransaction> tickerTransactions = entry.getValue();
            
            BigDecimal bought = tickerTransactions.stream()
                    .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.BUY)
                    .map(tx -> tx.getAmount().abs())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            
            BigDecimal sold = tickerTransactions.stream()
                    .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.SELL)
                    .map(SpotTransaction::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            
            BigDecimal dividends = tickerTransactions.stream()
                    .filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.DIVIDEND)
                    .map(SpotTransaction::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            
            Map<String, Object> stat = new HashMap<>();
            stat.put("ticker", ticker);
            stat.put("company", tickerTransactions.get(0).getCompany());
            stat.put("totalBought", bought);
            stat.put("totalSold", sold);
            stat.put("totalDividends", dividends);
            stat.put("netResult", sold.subtract(bought).add(dividends));
            
            tickerStats.add(stat);
        }
        
        Map<String, Object> result = new HashMap<>();
        result.put("totalTransactions", totalTransactions);
        result.put("totalInvested", totalInvested);
        result.put("totalReceived", totalReceived);
        result.put("totalDividends", totalDividends);
        result.put("netProfit", totalReceived.subtract(totalInvested).add(totalDividends));
        result.put("tickerStatistics", tickerStats);
        
        return result;
    }

    // Получить транзакции по тикеру
    @GetMapping("/by-ticker/{ticker}")
    public List<SpotTransaction> getTransactionsByTicker(@PathVariable String ticker, @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            return repository.findByPortfolioIdAndTickerOrderByTradeDateDesc(portfolio.getId(), ticker);
        }
        return repository.findByPortfolioUser(user).stream()
                .filter(tx -> ticker.equalsIgnoreCase(tx.getTicker()))
                .sorted(Comparator.comparing(SpotTransaction::getTradeDate, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    // Получить транзакции по типу
    @GetMapping("/by-type/{type}")
    public List<SpotTransaction> getTransactionsByType(@PathVariable SpotTransaction.TransactionType type, @RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        User user = getAuthenticatedUser();
        if (portfolioId != null) {
            Portfolio portfolio = getPortfolioForUser(portfolioId, user);
            return repository.findByPortfolioIdAndTransactionTypeOrderByTradeDateDesc(portfolio.getId(), type);
        }
        return repository.findByPortfolioUser(user).stream()
                .filter(tx -> tx.getTransactionType() == type)
                .sorted(Comparator.comparing(SpotTransaction::getTradeDate, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
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
     * Сводная статистика по спотовым сделкам (расчёты на бэке).
     */
    @GetMapping("/stats")
    public ResponseEntity<?> getStats(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            logger.debug("GET /api/spot-transactions/stats portfolioId={}", portfolioId);
            User user = getAuthenticatedUser();
            List<SpotTransaction> txs;
            if (portfolioId != null) {
                Portfolio portfolio = getPortfolioForUser(portfolioId, user);
                txs = repository.findByPortfolioId(portfolio.getId());
            } else {
                txs = repository.findByPortfolioUser(user);
            }

        double cash = 0;
        double totalInvested = 0;
        double totalReceived = 0;
        double totalDividends = 0;
        double realizedPnL = 0;

        record Pos(double qty, double cost) {}
        Map<String, Pos> positions = new HashMap<>();

        for (SpotTransaction tx : txs) {
            double price = tx.getPrice() != null ? tx.getPrice().doubleValue() : 0;
            double qty = tx.getQuantity() != null ? tx.getQuantity().doubleValue() : 0;
            double amt = tx.getAmount() != null ? tx.getAmount().doubleValue() : 0;
            cash += amt;

            switch (tx.getTransactionType()) {
                case BUY -> {
                    totalInvested += price * qty;
                    Pos p = positions.getOrDefault(tx.getTicker(), new Pos(0, 0));
                    positions.put(tx.getTicker(), new Pos(p.qty + qty, p.cost + price * qty));
                }
                case SELL -> {
                    totalReceived += price * qty;
                    Pos p = positions.getOrDefault(tx.getTicker(), new Pos(0, 0));
                    double remainingQty = p.qty - qty;
                    double avgCost = p.qty > 0 ? p.cost / p.qty : 0;
                    realizedPnL += (price - avgCost) * qty;
                    double newCost = Math.max(0, p.cost - avgCost * qty);
                    positions.put(tx.getTicker(), new Pos(Math.max(0, remainingQty), newCost));
                }
                case DIVIDEND -> totalDividends += amt;
                case DEPOSIT, WITHDRAW -> { /* cash уже учли */ }
            }
        }

        int openPositionsCount = (int) positions.values().stream().filter(p -> p.qty > 0).count();
        int closedPositionsCount = (int) txs.stream().filter(tx -> tx.getTransactionType() == SpotTransaction.TransactionType.SELL).count();

        Map<String, Object> resp = new HashMap<>();
        resp.put("cashBalance", round(cash));
        resp.put("totalInvested", round(totalInvested));
        resp.put("totalReceived", round(totalReceived));
        resp.put("totalDividends", round(totalDividends));
        resp.put("realizedPnL", round(realizedPnL + totalDividends));
        resp.put("openPositions", openPositionsCount);
        resp.put("closedPositions", closedPositionsCount);
        resp.put("positionsCount", positions.size());
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            logger.error("Ошибка /api/spot-transactions/stats", e);
            return ResponseEntity.ok(Map.of());
        }
    }

    /**
     * Открытые позиции (количество, средняя цена).
     */
    @GetMapping("/positions/open")
    public ResponseEntity<?> getOpenPositions(@RequestHeader(value = "X-Portfolio-ID", required = false) Long portfolioId) {
        try {
            logger.debug("GET /api/spot-transactions/positions portfolioId={}", portfolioId);
            User user = getAuthenticatedUser();
            List<SpotTransaction> txs;
            if (portfolioId != null) {
                Portfolio portfolio = getPortfolioForUser(portfolioId, user);
                txs = repository.findByPortfolioId(portfolio.getId());
            } else {
                txs = repository.findByPortfolioUser(user);
            }

        class PosAcc {
            double qty = 0;
            double cost = 0;
            String company;
        }
        Map<String, PosAcc> map = new HashMap<>();
        for (SpotTransaction tx : txs) {
            if (tx.getTransactionType() == SpotTransaction.TransactionType.BUY || tx.getTransactionType() == SpotTransaction.TransactionType.SELL) {
                PosAcc acc = map.computeIfAbsent(tx.getTicker(), k -> new PosAcc());
                acc.company = tx.getCompany();
                double price = tx.getPrice() != null ? tx.getPrice().doubleValue() : 0;
                double qty = tx.getQuantity() != null ? tx.getQuantity().doubleValue() : 0;
                if (tx.getTransactionType() == SpotTransaction.TransactionType.BUY) {
                    acc.qty += qty;
                    acc.cost += price * qty;
                } else {
                    double avg = acc.qty > 0 ? acc.cost / acc.qty : 0;
                    acc.qty -= qty;
                    acc.cost = Math.max(0, acc.cost - avg * qty);
                }
            }
        }

            List<Map<String, Object>> result = map.entrySet().stream()
                    .filter(e -> e.getValue().qty > 0)
                    .map(e -> {
                        PosAcc acc = e.getValue();
                        Map<String, Object> row = new HashMap<>();
                        row.put("ticker", e.getKey());
                        row.put("company", acc.company);
                        row.put("quantity", round(acc.qty));
                        row.put("avgPrice", acc.qty > 0 ? round(acc.cost / acc.qty) : 0);
                        row.put("invested", round(acc.cost));
                        return row;
                    })
                    .toList();

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            logger.error("Ошибка /api/spot-transactions/positions", e);
            return ResponseEntity.ok(Collections.emptyList());
        }
    }

    private double round(double val) {
        return BigDecimal.valueOf(val).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }
}
