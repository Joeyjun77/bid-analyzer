import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'
ReactDOM.createRoot(document.getElementById('root')).render(<AuthGate><App /></AuthGate>)
