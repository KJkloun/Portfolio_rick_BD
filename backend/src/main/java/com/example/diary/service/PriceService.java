package com.example.diary.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PriceService {

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${alphavantage.api.key:}")
    private String alphaKey;

    @Value("${alphavantage.api.keys:}")
    private String alphaKeysProp;

    private static final Set<String> RU_TICKERS = Set.of(
            "GAZP","ROSN","SBER","NVTK","GMKN","LKOH","SIBN","PLZL","PHOR","SNGS","TATN","NLMK","RUAL","CHMF",
            "AKRN","VSMO","PIKK","ALRS","MTSS","MGNT","TCSG","T","MAGN","HYDR","IRKT","UNAC","IRAO","VTBR","RTKM",
            "RASP","MOEX","BANE","SMLT","CBOM","NKNC","AFKS","SGZH","KZOS","MGTS","FEES","GCHE","NMTP","APTK",
            "UPRO","FLOT","YAKG","FESH","MSNG","LSNG","AVAN","KAZT","VKCO","POSI","GLTR","VK","AGRO","RAGR","MVID"
    );

    // алиасы тикеров (старый -> новый)
    private static final Map<String, String> TICKER_ALIASES = Map.of(
            "TCSG", "T"
    );

    private final Map<String, String> moexBoardMap = Map.ofEntries(
            Map.entry("GAZP", "TQBR"),
            Map.entry("VKCO", "TQBR"),
            Map.entry("SBER", "TQBR"),
            Map.entry("VTBR", "TQBR"),
            Map.entry("LKOH", "TQBR"),
            Map.entry("PLZL", "TQBR"),
            Map.entry("MGNT", "TQBR"),
            Map.entry("MVID", "TQBR"),
            Map.entry("T", "TQBR"),
            Map.entry("TATN", "TQBR"),
            Map.entry("ALRS", "TQBR"),
            Map.entry("MTSS", "TQBR"),
            Map.entry("POSI", "TQTF"),
            Map.entry("GLTR", "TQTF"),
            Map.entry("VK", "TQBR")
    );

    private record CachedQuote(Double price, Instant ts, String source, String currency) {}

    public record Quote(String ticker, Double price, String source, String currency) {}

    private final Map<String, CachedQuote> cache = new ConcurrentHashMap<>();

    public Quote getPrice(String ticker, long ttlSeconds) {
        if (ticker == null || ticker.isBlank()) {
            return null;
        }
        String requested = ticker.toUpperCase(Locale.ROOT);
        String sym = TICKER_ALIASES.getOrDefault(requested, requested);
        CachedQuote cached = cache.get(sym);
        if (cached != null && Duration.between(cached.ts(), Instant.now()).getSeconds() < ttlSeconds) {
            return new Quote(requested, cached.price(), cached.source(), cached.currency());
        }

        boolean isRu = RU_TICKERS.contains(sym);
        Double price = null;
        String source = null;
        String currency = null;

        if (isRu) {
            price = fetchMoexPrice(sym);
            if (price != null) {
                source = "moex";
                currency = "RUB";
            }
        }

        if (price == null) {
            Double alphaPrice = fetchAlphaPrice(sym, isRu);
            if (alphaPrice != null) {
                price = alphaPrice;
                source = "alpha";
                currency = isRu ? "RUB" : "USD";
            }
        }

        if (price == null) {
            return null;
        }

        cache.put(sym, new CachedQuote(price, Instant.now(), source, currency));
        return new Quote(requested, price, source, currency);
    }

    public List<Quote> getPrices(Collection<String> tickers, long ttlSeconds) {
        if (tickers == null || tickers.isEmpty()) return Collections.emptyList();
        List<Quote> quotes = new ArrayList<>();
        for (String ticker : tickers) {
            Quote q = getPrice(ticker, ttlSeconds);
            if (q != null) {
                quotes.add(q);
            }
        }
        return quotes;
    }

    private Double fetchMoexPrice(String ticker) {
        String mappedBoard = moexBoardMap.getOrDefault(ticker, "TQBR");
        String[] boards = new String[]{mappedBoard, "TQBR", "TQTF"};
        for (String b : boards) {
            String url = String.format(
                    "https://iss.moex.com/iss/engines/stock/markets/shares/boards/%s/securities/%s.json?iss.meta=off&iss.only=securities,marketdata&marketdata.columns=LAST&securities.columns=SECID,BOARDID",
                    b, ticker);
            try {
                Map<?, ?> resp = restTemplate.getForObject(url, Map.class);
                if (resp != null && resp.containsKey("marketdata")) {
                    Object md = ((Map<?, ?>) resp.get("marketdata")).get("data");
                    if (md instanceof List<?> list && !list.isEmpty()) {
                        Object first = list.get(0);
                        if (first instanceof List<?> row && !row.isEmpty()) {
                            Object val = row.get(0);
                            if (val instanceof Number num) {
                                return num.doubleValue();
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    private Double fetchAlphaPrice(String ticker, boolean ruTicker) {
        List<String> keys = resolveAlphaKeys();
        if (keys.isEmpty()) return null;
        String symbol = ruTicker ? ticker + ".ME" : ticker;

        for (String key : keys) {
            if (key == null || key.isBlank()) continue;
            String url = String.format(
                    "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=%s&apikey=%s",
                    symbol, key.trim());
            try {
                Map<?, ?> resp = restTemplate.getForObject(url, Map.class);
                // Alpha Vantage вернёт "Note" при исчерпании лимита
                if (resp != null && resp.containsKey("Note")) {
                    continue; // пробуем следующий ключ
                }
                if (resp != null && resp.containsKey("Global Quote")) {
                    Object quote = resp.get("Global Quote");
                    if (quote instanceof Map<?, ?> map && map.get("05. price") != null) {
                        try {
                            return Double.parseDouble(map.get("05. price").toString());
                        } catch (NumberFormatException ignored) {}
                    }
                }
            } catch (Exception ignored) {
                // пробуем следующий ключ
            }
        }
        return null;
    }

    private List<String> resolveAlphaKeys() {
        // приоритет множественного свойства alphavantage.api.keys, далее одиночное alphavantage.api.key
        if (alphaKeysProp != null && !alphaKeysProp.isBlank()) {
            return Arrays.stream(alphaKeysProp.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .toList();
        }
        if (alphaKey != null && !alphaKey.isBlank()) {
            return List.of(alphaKey.trim());
        }
        return List.of();
    }
}
