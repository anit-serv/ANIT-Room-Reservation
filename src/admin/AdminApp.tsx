import { Routes, Route, Navigate } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import Login from './Login'
import Dashboard from './pages/Dashboard'
import Reservations from './pages/Reservations'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Admins from './pages/Admins'

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users" element={<Users />} />
        <Route path="admins" element={<Admins />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
