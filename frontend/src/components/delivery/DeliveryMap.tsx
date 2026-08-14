import { useEffect } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'

export interface MapPoint { latitude: number; longitude: number; label?: string; kind?: 'driver' | 'stop' | 'customer' }

function FitMap({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView([points[0]!.latitude, points[0]!.longitude], 15)
    if (points.length > 1) map.fitBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]), { padding: [32, 32] })
  }, [map, points])
  return null
}

export function DeliveryMap({ current, stops, geometry = [], className = 'h-[360px]' }: {
  current?: MapPoint | null
  stops: MapPoint[]
  geometry?: [number, number][]
  className?: string
}) {
  const points = [...(current ? [current] : []), ...stops]
  const center: LatLngExpression = points[0] ? [points[0].latitude, points[0].longitude] : [-14.235, -51.9253]
  return (
    <MapContainer center={center} zoom={points.length ? 14 : 4} scrollWheelZoom className={`z-0 w-full ${className}`}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {geometry.length > 1 && <Polyline positions={geometry.map(([longitude, latitude]) => [latitude, longitude])} pathOptions={{ color: '#4A103A', weight: 6, opacity: .85 }} />}
      {current && <CircleMarker center={[current.latitude, current.longitude]} radius={11} pathOptions={{ color: '#fff', weight: 4, fillColor: '#2563eb', fillOpacity: 1 }}><Tooltip permanent direction="top">Você</Tooltip></CircleMarker>}
      {stops.map((stop, index) => <CircleMarker key={`${stop.latitude}-${stop.longitude}-${index}`} center={[stop.latitude, stop.longitude]} radius={12} pathOptions={{ color: '#fff', weight: 4, fillColor: index === 0 ? '#D9A629' : '#4A103A', fillOpacity: 1 }}><Tooltip permanent direction="top">{stop.label ?? `${index + 1}ª parada`}</Tooltip></CircleMarker>)}
      {points.length > 0 && <FitMap points={points} />}
    </MapContainer>
  )
}
