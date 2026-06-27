import { addDays, startOfWeek, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

export const GRID_START_HOUR = 7
export const GRID_END_HOUR = 19
export const SLOT_HEIGHT_PX = 48
export const SLOT_MIN = 30

export function inicioSemana(data: Date): Date {
  return startOfWeek(data, { weekStartsOn: 1 })
}

export function diasDaSemana(inicio: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(inicio, i))
}

export function formatarDiaHeader(data: Date): { abrev: string; numero: string } {
  return {
    abrev: format(data, 'EEE', { locale: ptBR }),
    numero: format(data, 'd/MM'),
  }
}

export function formatarHora(isoUtc: string, timezone: string): string {
  return toZonedTime(new Date(isoUtc), timezone).toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatarDataCurta(isoUtc: string, timezone: string): string {
  return toZonedTime(new Date(isoUtc), timezone).toLocaleDateString('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatarDataHoraLonga(isoUtc: string, timezone: string): string {
  return toZonedTime(new Date(isoUtc), timezone).toLocaleString('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatarTelefone(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 5)} ${d.slice(5, 9)}-${d.slice(9)}`
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return e164
}

export function minutosLocaisDesdeInicioDia(isoUtc: string, timezone: string): number {
  const d = toZonedTime(new Date(isoUtc), timezone)
  return d.getHours() * 60 + d.getMinutes()
}

export function topPxNoGrid(inicioIso: string, timezone: string): number {
  const localMin = minutosLocaisDesdeInicioDia(inicioIso, timezone)
  return ((localMin - GRID_START_HOUR * 60) / SLOT_MIN) * SLOT_HEIGHT_PX
}

export function heightPxNoGrid(inicioIso: string, fimIso: string): number {
  const dur = (new Date(fimIso).getTime() - new Date(inicioIso).getTime()) / 60_000
  return Math.max((dur / SLOT_MIN) * SLOT_HEIGHT_PX, 24)
}

export function isMesmoDia(isoUtc: string, dia: Date, timezone: string): boolean {
  const local = toZonedTime(new Date(isoUtc), timezone)
  const ref   = toZonedTime(dia, timezone)
  return (
    local.getFullYear() === ref.getFullYear() &&
    local.getMonth()    === ref.getMonth()    &&
    local.getDate()     === ref.getDate()
  )
}

export function localDateToUtcIso(dateStr: string, timeStr: string, timezone: string): string {
  return fromZonedTime(new Date(`${dateStr}T${timeStr}:00`), timezone).toISOString()
}

export function hojeLocal(timezone: string): string {
  return toZonedTime(new Date(), timezone).toLocaleDateString('sv-SE', { timeZone: timezone })
}

export function percentual(valor: number): string {
  return `${(valor * 100).toFixed(1)}%`
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}
