import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import LiffApp from './liff/LiffApp'
import AdminApp from './admin/AdminApp'

const router = createBrowserRouter([
  { path: '/admin/*', element: <AdminApp /> },
  { path: '/*',       element: <LiffApp /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
