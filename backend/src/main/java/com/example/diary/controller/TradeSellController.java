package com.example.diary.controller;

import com.example.diary.model.Portfolio;
import com.example.diary.model.User;
import com.example.diary.service.TradeService;
import com.example.diary.service.UserService;
import com.example.diary.repository.PortfolioRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;

@RestController
@RequestMapping("/trades/sell")
@CrossOrigin(origins = "*")
public class TradeSellController {

    @Autowired
    private TradeService tradeService;

    @Autowired
    private UserService userService;

    @Autowired
    private PortfolioRepository portfolioRepository;

    /**
     * Единый FIFO-селл: тикер, qty, цена, дата. Возвращает итог по закрытию.
     */
    @PostMapping("/fifo")
    public ResponseEntity<?> fifoSell(@RequestBody Map<String, Object> payload,
                                      @RequestHeader(value = "X-Portfolio-ID") Long portfolioId) {
        try {
            User user = getAuthenticatedUser();
            Portfolio portfolio = portfolioRepository.findByIdAndUser(portfolioId, user)
                    .orElseThrow(() -> new RuntimeException("Портфель не найден"));

            String symbol = payload.getOrDefault("symbol", "").toString().trim().toUpperCase();
            if (symbol.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Тикер обязателен"));
            }
            if (!payload.containsKey("quantity")) {
                return ResponseEntity.badRequest().body(Map.of("message", "quantity обязателен"));
            }
            int qty = ((Number) payload.get("quantity")).intValue();
            if (qty <= 0) {
                return ResponseEntity.badRequest().body(Map.of("message", "quantity должен быть > 0"));
            }
            if (!payload.containsKey("exitPrice")) {
                return ResponseEntity.badRequest().body(Map.of("message", "exitPrice обязателен"));
            }
            BigDecimal exitPrice = new BigDecimal(payload.get("exitPrice").toString());
            LocalDate exitDate = payload.get("exitDate") != null
                    ? LocalDate.parse(payload.get("exitDate").toString())
                    : LocalDate.now();
            String notes = payload.getOrDefault("notes", "").toString();

            Map<String, Object> result = tradeService.fifoClose(user, portfolio, symbol, qty, exitPrice, exitDate, notes);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", "Ошибка FIFO продажи: " + e.getMessage()));
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
}
