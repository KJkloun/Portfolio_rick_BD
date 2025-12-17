package com.example.diary.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import com.fasterxml.jackson.annotation.JsonBackReference;
import com.example.diary.model.FinancingEvent.EventType;

@Entity
@Table(name = "trades")
public class Trade {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Symbol is required")
    @Size(min = 1, max = 10, message = "Symbol must be between 1 and 10 characters")
    @Column(nullable = false)
    private String symbol;

    @NotNull(message = "Entry price is required")
    @DecimalMin(value = "0.01", message = "Entry price must be greater than 0")
    @Column(name = "entry_price", nullable = false)
    private BigDecimal entryPrice;

    @DecimalMin(value = "0.01", message = "Exit price must be greater than 0")
    @Column(name = "exit_price", nullable = true)
    private BigDecimal exitPrice;

    @NotNull(message = "Quantity is required")
    @Min(value = 1, message = "Quantity must be at least 1")
    @Column(nullable = false)
    private Integer quantity;

    @NotNull(message = "Entry date is required")
    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(name = "exit_date", nullable = true)
    private LocalDate exitDate;

    @NotNull(message = "Margin amount is required")
    @DecimalMin(value = "0.01", message = "Margin amount must be greater than 0")
    @Column(name = "margin_amount", nullable = false)
    private BigDecimal marginAmount;

    // Плечо сделки (например, 2.5 означает 2.5x)
    @Column(name = "leverage", precision = 10, scale = 2)
    private BigDecimal leverage;

    // Сумма, взятая в заём под плечо
    @Column(name = "borrowed_amount", precision = 19, scale = 6)
    private BigDecimal borrowedAmount;

    // Собственные средства, заложенные под позицию
    @Column(name = "collateral_amount", precision = 19, scale = 6)
    private BigDecimal collateralAmount;

    // Поддерживающая маржа (в процентах)
    @Column(name = "maintenance_margin", precision = 10, scale = 4)
    private BigDecimal maintenanceMargin;

    public enum FinancingRateType { FIXED, FLOATING }

    @Enumerated(EnumType.STRING)
    @Column(name = "financing_rate_type")
    private FinancingRateType financingRateType = FinancingRateType.FIXED;

    @Column(name = "financing_currency", length = 5)
    private String financingCurrency;

    @Column(name = "daily_interest", columnDefinition = "TEXT")
    private String dailyInterest;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @OneToMany(mappedBy = "trade", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonManagedReference("trade-closures")
    private List<TradeClosure> closures = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "portfolio_id", nullable = false)
    @JsonBackReference("portfolio-trades")
    private Portfolio portfolio;

    @OneToMany(mappedBy = "trade", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonManagedReference("trade-financing-events")
    private List<FinancingEvent> financingEvents = new ArrayList<>();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }

    public BigDecimal getEntryPrice() { return entryPrice; }
    public void setEntryPrice(BigDecimal entryPrice) { this.entryPrice = entryPrice; }

    public BigDecimal getExitPrice() { return exitPrice; }
    public void setExitPrice(BigDecimal exitPrice) { this.exitPrice = exitPrice; }

    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }

    public LocalDate getEntryDate() { return entryDate; }
    public void setEntryDate(LocalDate entryDate) { this.entryDate = entryDate; }

    public LocalDate getExitDate() { return exitDate; }
    public void setExitDate(LocalDate exitDate) { this.exitDate = exitDate; }

    public BigDecimal getMarginAmount() { return marginAmount; }
    public void setMarginAmount(BigDecimal marginAmount) { this.marginAmount = marginAmount; }

    public BigDecimal getLeverage() { return leverage; }
    public void setLeverage(BigDecimal leverage) { this.leverage = leverage; }

    public BigDecimal getBorrowedAmount() { return borrowedAmount; }
    public void setBorrowedAmount(BigDecimal borrowedAmount) { this.borrowedAmount = borrowedAmount; }

    public BigDecimal getCollateralAmount() { return collateralAmount; }
    public void setCollateralAmount(BigDecimal collateralAmount) { this.collateralAmount = collateralAmount; }

    public BigDecimal getMaintenanceMargin() { return maintenanceMargin; }
    public void setMaintenanceMargin(BigDecimal maintenanceMargin) { this.maintenanceMargin = maintenanceMargin; }

    public FinancingRateType getFinancingRateType() { return financingRateType; }
    public void setFinancingRateType(FinancingRateType financingRateType) { this.financingRateType = financingRateType; }

    public String getFinancingCurrency() { return financingCurrency; }
    public void setFinancingCurrency(String financingCurrency) { this.financingCurrency = financingCurrency; }

    public String getDailyInterest() { return dailyInterest; }
    public void setDailyInterest(String dailyInterest) { this.dailyInterest = dailyInterest; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public List<TradeClosure> getClosures() { return closures; }
    public void setClosures(List<TradeClosure> closures) { this.closures = closures; }

    public Portfolio getPortfolio() { return portfolio; }
    public void setPortfolio(Portfolio portfolio) { this.portfolio = portfolio; }

    public List<FinancingEvent> getFinancingEvents() { return financingEvents; }
    public void setFinancingEvents(List<FinancingEvent> financingEvents) { this.financingEvents = financingEvents; }

    @Transient
    public Double getTotalCost() {
        if (entryPrice == null || quantity == null) {
            return null;
        }
        BigDecimal total = entryPrice.multiply(BigDecimal.valueOf(quantity));
        return total.setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    @Transient
    public BigDecimal getPrincipal() {
        if (borrowedAmount != null) {
            return borrowedAmount;
        }
        if (entryPrice == null || quantity == null) {
            return null;
        }
        return entryPrice.multiply(BigDecimal.valueOf(quantity));
    }

    @Transient
    public Double getLeverageValue() {
        if (leverage != null) return leverage.doubleValue();
        if (entryPrice != null && quantity != null) {
            BigDecimal total = entryPrice.multiply(BigDecimal.valueOf(quantity));
            if (borrowedAmount != null && total.compareTo(BigDecimal.ZERO) > 0) {
                BigDecimal ownFunds = total.subtract(borrowedAmount);
                if (ownFunds.compareTo(BigDecimal.ZERO) > 0) {
                    return total.divide(ownFunds, 4, RoundingMode.HALF_UP).doubleValue();
                }
            }
        }
        return null;
    }

    @Transient
    public Double getLiquidationPrice() {
        // Приближённая оценка: P*Q*(1 - mm) = borrowed -> P = borrowed / (Q*(1 - mm))
        if (maintenanceMargin == null || quantity == null || quantity == 0) return null;
        BigDecimal principal = getPrincipal();
        if (principal == null || principal.compareTo(BigDecimal.ZERO) <= 0) return null;

        BigDecimal mm = maintenanceMargin.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP);
        BigDecimal denominator = BigDecimal.valueOf(quantity).multiply(BigDecimal.ONE.subtract(mm));
        if (denominator.compareTo(BigDecimal.ZERO) <= 0) return null;

        return principal.divide(denominator, 4, RoundingMode.HALF_UP).doubleValue();
    }

    @Transient
    public Double getMarginRequired() {
        // Не используется в новой модели, оставляем для совместимости
        return null;
    }

    @Transient
    private BigDecimal getCurrentRate(LocalDate asOfDate) {
        if (financingEvents != null && !financingEvents.isEmpty()) {
            return financingEvents.stream()
                .filter(e -> e.getEventType() == EventType.RATE_CHANGE && !e.getEventDate().isAfter(asOfDate))
                .max((a, b) -> a.getEventDate().compareTo(b.getEventDate()))
                .map(FinancingEvent::getRate)
                .orElse(marginAmount);
        }
        return marginAmount;
    }

    @Transient
    public Double getDailyInterestAmount() {
        BigDecimal principal = getPrincipal();
        if (principal == null || marginAmount == null) {
            return null;
        }
        BigDecimal rate = getCurrentRate(LocalDate.now());
        if (rate == null) return null;
        BigDecimal yearlyInterest = principal
                .multiply(rate)
                .divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP);
        BigDecimal dailyInterest = yearlyInterest.divide(BigDecimal.valueOf(365), 10, RoundingMode.HALF_UP);
        return dailyInterest.setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    @Transient
    public Double getTotalInterest() {
        if (entryDate == null) return null;
        LocalDate endDate = exitDate != null ? exitDate : LocalDate.now();
        if (endDate.isBefore(entryDate)) return 0.0;

        BigDecimal principal = getPrincipal();
        if (principal == null || marginAmount == null) return null;

        BigDecimal totalInterest = BigDecimal.ZERO;
        LocalDate currentStart = entryDate;

        List<FinancingEvent> rateChanges = financingEvents == null ? new ArrayList<>() : financingEvents;
        rateChanges = rateChanges.stream()
            .filter(e -> e.getEventType() == EventType.RATE_CHANGE && !e.getEventDate().isAfter(endDate) && !e.getEventDate().isBefore(entryDate))
            .sorted((a, b) -> a.getEventDate().compareTo(b.getEventDate()))
            .toList();

        BigDecimal currentRate = marginAmount;
        for (FinancingEvent evt : rateChanges) {
            LocalDate periodEnd = evt.getEventDate();
            long days = ChronoUnit.DAYS.between(currentStart, periodEnd);
            if (days > 0) {
                totalInterest = totalInterest.add(
                    principal.multiply(currentRate)
                        .divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP)
                        .divide(BigDecimal.valueOf(365), 10, RoundingMode.HALF_UP)
                        .multiply(BigDecimal.valueOf(days))
                );
            }
            currentRate = evt.getRate() != null ? evt.getRate() : currentRate;
            currentStart = periodEnd;
        }

        long remainingDays = ChronoUnit.DAYS.between(currentStart, endDate);
        if (remainingDays > 0) {
            totalInterest = totalInterest.add(
                principal.multiply(currentRate)
                    .divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP)
                    .divide(BigDecimal.valueOf(365), 10, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(remainingDays))
            );
        }

        return totalInterest.setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    @Transient
    public Double getProfit() {
        if (exitPrice == null || entryPrice == null || quantity == null || getTotalInterest() == null) {
            return null;
        }
        BigDecimal exitTotal = exitPrice.multiply(BigDecimal.valueOf(quantity));
        BigDecimal entryTotal = entryPrice.multiply(BigDecimal.valueOf(quantity));
        BigDecimal priceProfit = exitTotal.subtract(entryTotal);
        BigDecimal totalInterest = BigDecimal.valueOf(getTotalInterest());
        return priceProfit.subtract(totalInterest).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    @Transient
    public List<DailyInterest> getDailyInterestList() {
        List<DailyInterest> result = new ArrayList<>();
        if (entryDate == null || exitDate == null || getDailyInterestAmount() == null) return result;

        LocalDate currentDate = entryDate;
        while (!currentDate.isAfter(exitDate)) {
            DailyInterest daily = new DailyInterest();
            daily.setDate(currentDate);
            daily.setAmount(getDailyInterestAmount());
            result.add(daily);
            currentDate = currentDate.plusDays(1);
        }
        return result;
    }

    @Transient
    public Integer getOpenQuantity() {
        if (quantity == null) return null;
        int closed = closures.stream().mapToInt(c -> c.getClosedQuantity()).sum();
        return quantity - closed;
    }

    public static class DailyInterest {
        private LocalDate date;
        private Double amount;

        public LocalDate getDate() { return date; }
        public void setDate(LocalDate date) { this.date = date; }
        public Double getAmount() { return amount; }
        public void setAmount(Double amount) { this.amount = amount; }
    }
}
