import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { isSupabaseConfigured } from './data/supabase'
import { AppErrorBoundary, ConfigErrorScreen } from './shared/ErrorScreens'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>{isSupabaseConfigured() ? <App /> : <ConfigErrorScreen />}</AppErrorBoundary>
  </StrictMode>,
)
