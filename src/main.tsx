import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// StrictMode disabled to prevent double-mounting the game engine
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
