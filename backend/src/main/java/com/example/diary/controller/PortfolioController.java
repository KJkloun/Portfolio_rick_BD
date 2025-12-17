package com.example.diary.controller;

import com.example.diary.model.Portfolio;
import com.example.diary.model.User;
import com.example.diary.service.PortfolioService;
import com.example.diary.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/portfolios")
@CrossOrigin(origins = "*")
public class PortfolioController {
    
    @Autowired
    private PortfolioService portfolioService;
    
    @Autowired
    private UserService userService;

    @PostMapping
    public ResponseEntity<?> createPortfolio(@RequestBody CreatePortfolioRequest request) {
        try {
            User user = getAuthenticatedUser();
            
            Portfolio portfolio = portfolioService.createPortfolio(
                request.getName(),
                Portfolio.PortfolioType.valueOf(request.getType()),
                request.getCurrency(),
                request.getDescription(),
                user
            );
            
            return ResponseEntity.ok(createPortfolioResponse(portfolio));
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }
    
    @GetMapping
    public ResponseEntity<?> getUserPortfolios() {
        try {
            User user = getAuthenticatedUser();
            List<Portfolio> portfolios = portfolioService.getUserPortfolios(user);
            
            return ResponseEntity.ok(portfolios.stream()
                .map(this::createPortfolioResponse)
                .toList());
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }
    
    @GetMapping("/type/{type}")
    public ResponseEntity<?> getUserPortfoliosByType(@PathVariable String type) {
        try {
            User user = getAuthenticatedUser();
            Portfolio.PortfolioType portfolioType = Portfolio.PortfolioType.valueOf(type.toUpperCase());
            List<Portfolio> portfolios = portfolioService.getUserPortfoliosByType(user, portfolioType);
            
            return ResponseEntity.ok(portfolios.stream()
                .map(this::createPortfolioResponse)
                .toList());
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }
    
    @PutMapping("/{id}")
    public ResponseEntity<?> updatePortfolio(@PathVariable Long id, @RequestBody UpdatePortfolioRequest request) {
        try {
            User user = getAuthenticatedUser();
            Portfolio portfolio = portfolioService.updatePortfolio(id, request.getName(), request.getCurrency(), request.getDescription(), user);
            
            return ResponseEntity.ok(createPortfolioResponse(portfolio));
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }
    
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deactivatePortfolio(@PathVariable Long id) {
        try {
            User user = getAuthenticatedUser();
            portfolioService.deactivatePortfolio(id, user);
            
            Map<String, String> response = new HashMap<>();
            response.put("message", "Портфель деактивирован");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(error);
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
    
    private Map<String, Object> createPortfolioResponse(Portfolio portfolio) {
        Map<String, Object> response = new HashMap<>();
        response.put("id", portfolio.getId());
        response.put("name", portfolio.getName());
        response.put("type", portfolio.getType().name());
        response.put("typeDisplay", portfolio.getType().getDisplayName());
        response.put("currency", portfolio.getCurrency());
        response.put("description", portfolio.getDescription());
        response.put("isActive", portfolio.getIsActive());
        response.put("createdAt", portfolio.getCreatedAt());
        return response;
    }
    
    public static class CreatePortfolioRequest {
        private String name;
        private String type;
        private String currency = "RUB";
        private String description;
        
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getCurrency() { return currency; }
        public void setCurrency(String currency) { this.currency = currency; }
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
    }
    
    public static class UpdatePortfolioRequest {
        private String name;
        private String currency;
        private String description;
        
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getCurrency() { return currency; }
        public void setCurrency(String currency) { this.currency = currency; }
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
    }
} 
 
 
 
