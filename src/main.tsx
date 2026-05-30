import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import LiffApp from './liff/LiffApp'
import AdminApp from './admin/AdminApp'
import { ToastProvider } from './contexts/ToastContext'

const router = createBrowserRouter([
  { path: '/admin/*', element: <AdminApp /> },
  { path: '/*',       element: <LiffApp /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
)
