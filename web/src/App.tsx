import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { RotaProtegida } from '@/components/auth/RotaProtegida'
import { Layout } from '@/components/Layout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { AgendaPage } from '@/pages/AgendaPage'
import { ListaEsperaPage } from '@/pages/ListaEsperaPage'
import { ConversasPage } from '@/pages/ConversasPage'
import { MetricasPage } from '@/pages/MetricasPage'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RotaProtegida />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"    element={<DashboardPage />} />
              <Route path="/agenda"       element={<AgendaPage />} />
              <Route path="/lista-espera" element={<ListaEsperaPage />} />
              <Route path="/conversas"    element={<ConversasPage />} />
              <Route path="/metricas"     element={<MetricasPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
