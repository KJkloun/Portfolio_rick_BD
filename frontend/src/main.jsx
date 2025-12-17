import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import axios from 'axios'

// Настройка axios для работы с API бэкенда
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8081';
axios.defaults.baseURL = apiBaseUrl.replace(/\/$/, '');

// Добавляем interceptor для автоматического добавления токена авторизации
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    const portfolioId = localStorage.getItem('currentPortfolioId');
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    if (portfolioId) {
      config.headers['X-Portfolio-ID'] = portfolioId;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Добавляем interceptor для обработки ошибок ответов
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const status = error.response?.status;
    // Тихо игнорируем 404 для опционального спотового summary
    if (status === 404 && url.includes('/spot/summary')) {
      return Promise.resolve({ data: null, status: 404, headers: {}, config: error.config });
    }
    console.error('API Error:', error.response?.data || error.message);
    
    // Если получили 401 ошибку, очищаем токен и перенаправляем на логин
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('currentPortfolioId');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
