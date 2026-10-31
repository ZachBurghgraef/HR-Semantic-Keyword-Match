import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import outputs from '../amplify_outputs.json' // Generated automatically by the Amplify framework
import App from './App'
import './index.css' // Your Canva exported styles

// Initialize Amplify globally so your authentication and functions work everywhere
Amplify.configure(outputs)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
