package com.example.diary.repository;

import com.example.diary.model.Trade;
import com.example.diary.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface TradeRepository extends JpaRepository<Trade, Long> {
    
    @Query("SELECT t FROM Trade t WHERE t.exitDate BETWEEN :startDate AND :endDate ORDER BY t.exitDate DESC")
    List<Trade> findByExitDateBetween(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);

    @Query("SELECT t.symbol, SUM((t.exitPrice - t.entryPrice) * t.quantity) as profit " +
           "FROM Trade t " +
           "WHERE t.exitDate BETWEEN :startDate AND :endDate AND t.portfolio.user = :user " +
           "GROUP BY t.symbol " +
           "ORDER BY profit DESC")
    List<Object[]> findSymbolProfits(@Param("startDate") LocalDate startDate,
                                     @Param("endDate") LocalDate endDate,
                                     @Param("user") User user);

    @Query("SELECT FUNCTION('FORMATDATETIME', t.exitDate, 'yyyy-MM') as month, " +
           "SUM((t.exitPrice - t.entryPrice) * t.quantity) as profit " +
           "FROM Trade t " +
           "WHERE t.exitDate BETWEEN :startDate AND :endDate AND t.portfolio.user = :user " +
           "GROUP BY FUNCTION('FORMATDATETIME', t.exitDate, 'yyyy-MM') " +
           "ORDER BY month")
    List<Object[]> findMonthlyProfits(@Param("startDate") LocalDate startDate,
                                      @Param("endDate") LocalDate endDate,
                                      @Param("user") User user);

    List<Trade> findByPortfolioIdAndPortfolioUser(Long portfolioId, User user);

    List<Trade> findByPortfolioUser(User user);

    Optional<Trade> findByIdAndPortfolioUser(Long id, User user);

    List<Trade> findByPortfolioUserAndSymbolAndExitDateIsNullOrderByEntryDateAsc(User user, String symbol);
}
