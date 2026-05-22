import { Routes, Route, Navigate } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import Login from './Login'
import Dashboard from './pages/Dashboard'
import NobuReservations from './pages/Reservations'
import KobuReservations from './pages/KobuReservations'
import NobuSettings from './pages/Settings'
import KobuSettings from './pages/KobuSettings'
import Users from './pages/Users'
import Admins from './pages/Admins'
import Logs from './pages/Logs'

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="reservations" element={<Navigate to="/admin/reservations/nobu" replace />} />
        <Route path="reservations/nobu" element={<NobuReservations />} />
        <Route path="reservations/kobu" element={<KobuReservations />} />
        <Route path="settings" element={<Navigate to="/admin/settings/nobu" replace />} />
        <Route path="settings/nobu" element={<NobuSettings />} />
        <Route path="settings/kobu" element={<KobuSettings />} />
        <Route path="users" element={<Users />} />
        <Route path="admins" element={<Admins />} />
        <Route path="logs" element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
