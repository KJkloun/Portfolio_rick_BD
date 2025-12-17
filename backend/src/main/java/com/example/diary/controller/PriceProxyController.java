package com.example.diary.controller;

import com.example.diary.service.PriceService;
import com.example.diary.service.PriceService.Quote;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/prices")
@CrossOrigin(origins = "*")
public class PriceProxyController {

    @Autowired
    private PriceService priceService;

    @GetMapping
    public ResponseEntity<?> getPrice(@RequestParam String ticker,
                                      @RequestParam(required = false, defaultValue = "600") long ttlSeconds) {
        Quote quote = priceService.getPrice(ticker, ttlSeconds);
        if (quote == null) {
            return ResponseEntity.status(502).body(Map.of("message", "Price not found"));
        }
        return ResponseEntity.ok(toMap(quote));
    }

    @PostMapping("/batch")
    public ResponseEntity<?> batch(@RequestBody Map<String, Object> payload,
                                   @RequestParam(required = false, defaultValue = "600") long ttlSeconds) {
        Object ticks = payload.get("tickers");
        if (!(ticks instanceof Collection<?> collection)) {
            return ResponseEntity.badRequest().body(Map.of("message", "tickers is required"));
        }
        List<String> tickers = collection.stream()
                .map(Object::toString)
                .filter(s -> !s.isBlank())
                .map(s -> s.toUpperCase(Locale.ROOT))
                .distinct()
                .toList();

        List<Quote> quotes = priceService.getPrices(tickers, ttlSeconds);
        return ResponseEntity.ok(Map.of("prices", quotes.stream().map(this::toMap).toList()));
    }

    @GetMapping("/moex")
    public ResponseEntity<?> moex(@RequestParam String ticker,
                                  @RequestParam(required = false, defaultValue = "TQBR") String board,
                                  @RequestParam(required = false, defaultValue = "600") long ttlSeconds) {
        Quote quote = priceService.getPrice(ticker, ttlSeconds);
        if (quote == null || !"moex".equalsIgnoreCase(quote.source())) {
            return ResponseEntity.status(502).body(Map.of("message", "MOEX price not found"));
        }
        return ResponseEntity.ok(toMap(quote));
    }

    @GetMapping("/alpha")
    public ResponseEntity<?> alpha(@RequestParam String ticker,
                                   @RequestParam(required = false, defaultValue = "3600") long ttlSeconds,
                                   @RequestParam(required = false, defaultValue = ".ME") String suffix) {
        Quote quote = priceService.getPrice(ticker, ttlSeconds);
        if (quote == null) {
            return ResponseEntity.status(502).body(Map.of("message", "Alpha quote not found"));
        }
        return ResponseEntity.ok(toMap(quote));
    }

    private Map<String, Object> toMap(Quote q) {
        return Map.of(
                "ticker", q.ticker(),
                "price", q.price(),
                "source", q.source(),
                "currency", q.currency()
        );
    }
}
