package com.example.diary.repository;

import com.example.diary.model.FinancingEvent;
import com.example.diary.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FinancingEventRepository extends JpaRepository<FinancingEvent, Long> {

    @Query("SELECT fe FROM FinancingEvent fe WHERE fe.trade.id = :tradeId AND fe.trade.portfolio.user = :user ORDER BY fe.eventDate ASC")
    List<FinancingEvent> findByTradeIdAndUser(@Param("tradeId") Long tradeId, @Param("user") User user);
}
