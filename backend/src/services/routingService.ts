import { env } from '../config/env.js'

export interface Coordinate { latitude: number; longitude: number }
export interface RouteStep {
  distance: number
  duration: number
  name: string
  maneuver: { type: string; modifier?: string; location: [number, number] }
}
export interface RouteResult {
  distanceMeters: number
  durationSeconds: number
  geometry: [number, number][]
  legs: Array<{ distance: number; duration: number; steps: RouteStep[] }>
}

const coordPath = (points: Coordinate[]) => points.map((p) => `${p.longitude},${p.latitude}`).join(';')

async function requestJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Servico de mapas indisponivel (${response.status}).`)
  return response.json() as Promise<T>
}

let nextGeocodeAt = 0
let geocodeTail: Promise<unknown> = Promise.resolve()

/** Geocodifica uma vez e persiste no pedido. A fila respeita o limite do Nominatim publico. */
export async function geocodeAddress(address: string): Promise<Coordinate | null> {
  const task = async () => {
    const wait = Math.max(0, nextGeocodeAt - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    nextGeocodeAt = Date.now() + 1_050
    const query = new URLSearchParams({ q: `${address}, Brasil`, format: 'jsonv2', limit: '1', countrycodes: 'br' })
    const data = await requestJson<Array<{ lat: string; lon: string }>>(
      `${env.GEOCODING_BASE_URL.replace(/\/$/, '')}/search?${query}`,
      { 'User-Agent': env.MAPS_USER_AGENT, 'Accept-Language': 'pt-BR' },
    )
    const first = data[0]
    if (!first) return null
    return { latitude: Number(first.lat), longitude: Number(first.lon) }
  }
  const result = geocodeTail.then(task, task)
  geocodeTail = result.catch(() => undefined)
  return result
}

export async function durationMatrix(points: Coordinate[]): Promise<Array<Array<number | null>>> {
  const query = new URLSearchParams({ annotations: 'duration' })
  const data = await requestJson<{ code: string; durations?: Array<Array<number | null>> }>(
    `${env.ROUTING_BASE_URL.replace(/\/$/, '')}/table/v1/driving/${coordPath(points)}?${query}`,
  )
  if (data.code !== 'Ok' || !data.durations) throw new Error('Nao foi possivel calcular a ordem das paradas.')
  return data.durations
}

export async function routeBetween(points: Coordinate[]): Promise<RouteResult> {
  const query = new URLSearchParams({ steps: 'true', geometries: 'geojson', overview: 'full' })
  const data = await requestJson<{
    code: string
    routes?: Array<{
      distance: number
      duration: number
      geometry: { coordinates: [number, number][] }
      legs: Array<{ distance: number; duration: number; steps: RouteStep[] }>
    }>
  }>(`${env.ROUTING_BASE_URL.replace(/\/$/, '')}/route/v1/driving/${coordPath(points)}?${query}`)
  const route = data.routes?.[0]
  if (data.code !== 'Ok' || !route) throw new Error('Nao existe rota de carro ou moto entre estas paradas.')
  return { distanceMeters: route.distance, durationSeconds: route.duration, geometry: route.geometry.coordinates, legs: route.legs }
}

/** Vizinho mais proximo usando tempo real de rua, sempre partindo do entregador. */
export async function optimizeStopOrder(start: Coordinate, stops: Coordinate[]): Promise<number[]> {
  if (stops.length <= 1) return stops.map((_, index) => index)
  const matrix = await durationMatrix([start, ...stops])
  const remaining = new Set(stops.map((_, index) => index + 1))
  const order: number[] = []
  let current = 0
  while (remaining.size) {
    let best: number | null = null
    let bestDuration = Number.POSITIVE_INFINITY
    for (const candidate of remaining) {
      const duration = matrix[current]?.[candidate]
      if (duration != null && duration < bestDuration) { best = candidate; bestDuration = duration }
    }
    if (best == null) best = remaining.values().next().value as number
    remaining.delete(best)
    order.push(best - 1)
    current = best
  }
  return order
}
