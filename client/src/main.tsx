import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { initTheme } from './stores/theme';
import './styles/index.css';

// 初始化主题
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster 
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            borderRadius: '12px',
            padding: '12px 16px',
            border: '1px solid var(--border-color)',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: 'var(--text-primary)',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: 'var(--text-primary)',
            },
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
