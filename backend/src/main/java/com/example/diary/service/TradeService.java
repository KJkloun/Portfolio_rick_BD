package com.example.diary.service;

import com.example.diary.model.Portfolio;
import com.example.diary.model.Trade;
import com.example.diary.model.TradeClosure;
import com.example.diary.repository.TradeClosureRepository;
import com.example.diary.repository.TradeRepository;
import com.example.diary.model.User;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class TradeService {
    private final TradeRepository tradeRepository;
    private final TradeClosureRepository tradeClosureRepository;

    public TradeService(TradeRepository tradeRepository, TradeClosureRepository tradeClosureRepository) {
        this.tradeRepository = tradeRepository;
        this.tradeClosureRepository = tradeClosureRepository;
    }

    /**
     * Открытие сделки: нормализует плечо/заём/залог.
     */
    public Trade openTrade(Trade trade, Portfolio portfolio) {
        trade.setPortfolio(portfolio);

        if (trade.getEntryDate() == null) {
            trade.setEntryDate(LocalDate.now());
        }
        BigDecimal positionCost = trade.getEntryPrice().multiply(BigDecimal.valueOf(trade.getQuantity()));

        if (trade.getLeverage() != null && trade.getLeverage().compareTo(BigDecimal.ONE) < 0) {
            throw new IllegalArgumentException("Плечо должно быть не меньше 1");
        }

        if (trade.getBorrowedAmount() == null) {
            if (trade.getLeverage() != null && trade.getLeverage().compareTo(BigDecimal.ZERO) > 0) {
                BigDecimal ownFunds = positionCost.divide(trade.getLeverage(), 6, RoundingMode.HALF_UP);
                BigDecimal borrowed = positionCost.subtract(ownFunds);
                trade.setBorrowedAmount(borrowed.max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
                trade.setCollateralAmount(ownFunds.max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            } else if (trade.getCollateralAmount() != null) {
                BigDecimal borrowed = positionCost.subtract(trade.getCollateralAmount());
                trade.setBorrowedAmount(borrowed.max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
            } else {
                trade.setBorrowedAmount(positionCost.setScale(2, RoundingMode.HALF_UP));
                trade.setCollateralAmount(BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP));
            }
        } else if (trade.getCollateralAmount() == null) {
            trade.setCollateralAmount(positionCost.subtract(trade.getBorrowedAmount()).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP));
        }

        if (trade.getLeverage() == null && trade.getBorrowedAmount() != null) {
            BigDecimal ownFunds = positionCost.subtract(trade.getBorrowedAmount());
            if (ownFunds.compareTo(BigDecimal.ZERO) > 0) {
                trade.setLeverage(positionCost.divide(ownFunds, 4, RoundingMode.HALF_UP));
            }
        }

        if (trade.getMaintenanceMargin() == null) {
            trade.setMaintenanceMargin(BigDecimal.valueOf(20));
        }

        if (trade.getFinancingRateType() == null) {
            trade.setFinancingRateType(Trade.FinancingRateType.FIXED);
        }

        if (trade.getFinancingCurrency() == null) {
            trade.setFinancingCurrency(portfolio.getCurrency());
        }

        return tradeRepository.save(trade);
    }

    /**
     * FIFO закрытие по тикеру.
     */
    public Map<String, Object> fifoClose(User user, Portfolio portfolio, String symbol, int qtyToClose, BigDecimal exitPrice, LocalDate exitDate, String notes) {
        List<Trade> openTrades = tradeRepository
                .findByPortfolioUserAndSymbolAndExitDateIsNullOrderByEntryDateAsc(user, symbol);
        if (openTrades.isEmpty()) {
            throw new IllegalArgumentException("Нет открытых сделок по тикеру " + symbol);
        }

        int remaining = qtyToClose;
        int closedLots = 0;
        List<Long> affected = new ArrayList<>();
        BigDecimal totalProceeds = BigDecimal.ZERO;
        BigDecimal totalCost = BigDecimal.ZERO;

        for (Trade trade : openTrades) {
            if (remaining <= 0) break;
            Integer openQty = trade.getOpenQuantity();
            if (openQty == null || openQty <= 0) continue;

            int portion = Math.min(remaining, openQty);
            TradeClosure closure = new TradeClosure();
            closure.setTrade(trade);
            closure.setClosedQuantity(portion);
            closure.setExitPrice(exitPrice);
            closure.setExitDate(exitDate);
            closure.setNotes(notes == null || notes.isEmpty() ? "FIFO" : "FIFO: " + notes);
            tradeClosureRepository.save(closure);

            remaining -= portion;
            closedLots += portion;
            affected.add(trade.getId());
            totalProceeds = totalProceeds.add(exitPrice.multiply(BigDecimal.valueOf(portion)));
            totalCost = totalCost.add(trade.getEntryPrice().multiply(BigDecimal.valueOf(portion)));

            if (portion == openQty) {
                trade.setExitPrice(exitPrice);
                trade.setExitDate(exitDate);
                tradeRepository.save(trade);
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("requested", qtyToClose);
        response.put("closed", closedLots);
        response.put("leftover", remaining);
        response.put("affectedTrades", affected);
        response.put("grossProceeds", totalProceeds);
        response.put("entryCost", totalCost);
        response.put("grossPnL", totalProceeds.subtract(totalCost));
        response.put("message", remaining > 0
                ? "Закрыто не полностью: не хватило открытых лотов"
                : "Закрытие FIFO выполнено");
        return response;
    }
}
