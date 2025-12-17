package com.example.diary.model;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * События по финансированию маржинальной позиции:
 * изменение ставки, погашение займа, пополнение залога.
 */
@Entity
@Table(name = "financing_events")
public class FinancingEvent {

    public enum EventType {
        RATE_CHANGE,
        REPAYMENT,
        COLLATERAL_TOPUP
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "trade_id", nullable = false)
    @JsonBackReference("trade-financing-events")
    private Trade trade;

    @NotNull
    @Column(name = "event_date", nullable = false)
    private LocalDate eventDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false)
    private EventType eventType = EventType.RATE_CHANGE;

    // Новая ставка, если событие RATE_CHANGE
    @Column(name = "rate", precision = 10, scale = 4)
    private BigDecimal rate;

    // Изменение суммы займа/залога, если REPAYMENT или COLLATERAL_TOPUP
    @Column(name = "amount_change", precision = 19, scale = 6)
    private BigDecimal amountChange;

    @Column(columnDefinition = "TEXT")
    private String notes;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Trade getTrade() {
        return trade;
    }

    public void setTrade(Trade trade) {
        this.trade = trade;
    }

    public LocalDate getEventDate() {
        return eventDate;
    }

    public void setEventDate(LocalDate eventDate) {
        this.eventDate = eventDate;
    }

    public EventType getEventType() {
        return eventType;
    }

    public void setEventType(EventType eventType) {
        this.eventType = eventType;
    }

    public BigDecimal getRate() {
        return rate;
    }

    public void setRate(BigDecimal rate) {
        this.rate = rate;
    }

    public BigDecimal getAmountChange() {
        return amountChange;
    }

    public void setAmountChange(BigDecimal amountChange) {
        this.amountChange = amountChange;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }
}
