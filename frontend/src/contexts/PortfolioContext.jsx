import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const PortfolioContext = createContext();

export const usePortfolio = () => {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
};

export const PortfolioProvider = ({ children }) => {
  const [portfolios, setPortfolios] = useState([]);
  const [currentPortfolio, setCurrentPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      loadPortfolios();
    } else {
      setPortfolios([]);
      setCurrentPortfolio(null);
    }
  }, [isAuthenticated]);

  const loadPortfolios = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/portfolios');
      setPortfolios(response.data);
      
      // Если есть сохраненный портфель в localStorage, восстанавливаем его
      const savedPortfolioId = localStorage.getItem('currentPortfolioId');
      if (savedPortfolioId) {
        const savedPortfolio = response.data.find(p => p.id === parseInt(savedPortfolioId));
        if (savedPortfolio) {
          setCurrentPortfolio(savedPortfolio);
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки портфелей:', error);
    } finally {
      setLoading(false);
    }
  };

  const createPortfolio = async (name, type, currency, description) => {
    try {
      const response = await axios.post('/api/portfolios', {
        name,
        type,
        currency,
        description
      });
      
      const newPortfolio = response.data;
      setPortfolios(prev => [...prev, newPortfolio]);
      
      return { success: true, portfolio: newPortfolio };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Ошибка создания портфеля'
      };
    }
  };

  const updatePortfolio = async (id, name, currency, description) => {
    try {
      const response = await axios.put(`/api/portfolios/${id}`, {
        name,
        currency,
        description
      });
      
      const updatedPortfolio = response.data;
      setPortfolios(prev => 
        prev.map(p => p.id === id ? updatedPortfolio : p)
      );
      
      if (currentPortfolio?.id === id) {
        setCurrentPortfolio(updatedPortfolio);
      }
      
      return { success: true, portfolio: updatedPortfolio };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Ошибка обновления портфеля'
      };
    }
  };

  const deletePortfolio = async (id) => {
    try {
      await axios.delete(`/api/portfolios/${id}`);
      
      setPortfolios(prev => prev.filter(p => p.id !== id));
      
      if (currentPortfolio?.id === id) {
        setCurrentPortfolio(null);
        localStorage.removeItem('currentPortfolioId');
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Ошибка удаления портфеля'
      };
    }
  };

  const selectPortfolio = (portfolio) => {
    setCurrentPortfolio(portfolio);
    if (portfolio) {
      localStorage.setItem('currentPortfolioId', portfolio.id.toString());
      if (portfolio.type === 'SPOT') {
        localStorage.setItem('currentSpotPortfolioId', portfolio.id.toString());
      }
      if (portfolio.type === 'MARGIN') {
        localStorage.setItem('currentMarginPortfolioId', portfolio.id.toString());
      }
    } else {
      localStorage.removeItem('currentPortfolioId');
    }
  };

  const getPortfoliosByType = (type) => {
    return portfolios.filter(p => p.type === type);
  };

  const refreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const value = {
    portfolios,
    currentPortfolio,
    selectedPortfolio: currentPortfolio,
    loading,
    refreshTrigger,
    loadPortfolios,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    selectPortfolio,
    getPortfoliosByType,
    refreshData
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}; 
 
 
 
 
