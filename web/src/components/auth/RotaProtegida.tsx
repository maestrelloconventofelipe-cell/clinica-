import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { TelaCarregando } from '@/components/ui/Spinner'

export function RotaProtegida() {
  const { usuario, carregando } = useAuth()

  if (carregando) return <TelaCarregando />
  if (!usuario)   return <Navigate to="/login" replace />

  return <Outlet />
}
