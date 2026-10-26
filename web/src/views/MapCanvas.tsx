import { LngLatBounds, Map as MapGL, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point, Polygon } from 'geojson'
import { useEffect, useRef } from 'react'
import { useTheme } from '@/lib/hooks'

export interface MapPoint { lon: number; lat: number; nome: string; uf: string; mun: number; local: string; secoes: number; aptos: number; color: string }
interface Props {
  geoUrl: string
  /** chave da propriedade da feature (uf ou cd) → { color, tip } */
  fills: Map<string | number, { color: string; tip: string; title?: string }>
  keyProp: 'uf' | 'cd'
  selected: (string | number)[]
  points: MapPoint[] | null
  onFeature: (key: string | number) => void
  onPoint: (p: MapPoint) => void
  label: string
}

setWorkerUrl(new URL('/maplibre/maplibre-gl-worker.mjs', location.origin).href)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default function MapCanvas({ geoUrl, fills, keyProp, selected, points, onFeature, onPoint, label }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const ready = useRef(false)
  const readyCbs = useRef<(() => void)[]>([])
  const whenReady = (cb: () => void) => (ready.current ? cb() : readyCbs.current.push(cb))
  const latest = useRef({ fills, keyProp, onFeature, onPoint, points })
  latest.current = { fills, keyProp, onFeature, onPoint, points }
  const [dark] = useTheme()
  const lastGeo = useRef('')

  useEffect(() => {
    if (!el.current) return
    const m = new MapGL({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': 'transparent' } }] },
      center: [-52, -14], zoom: 3.4, attributionControl: { compact: true, customAttribution: 'Malhas: IBGE · Dados: TSE' },
      dragRotate: false, pitchWithRotate: false,
    })
    map.current = m
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    m.on('load', () => {
      m.addSource('geo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'fill', type: 'fill', source: 'geo', paint: { 'fill-color': ['coalesce', ['get', '_color'], '#d4d4d8'], 'fill-opacity': 0.92 } })
      m.addLayer({ id: 'line', type: 'line', source: 'geo', paint: { 'line-color': ['case', ['boolean', ['get', '_sel'], false], '#111827', '#ffffff'], 'line-width': ['case', ['boolean', ['get', '_sel'], false], 1.8, 0.4] } })
      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 11, clusterRadius: 38 })
      m.addLayer({ id: 'clusters', type: 'circle', source: 'pts', filter: ['has', 'point_count'], paint: { 'circle-color': '#52525b', 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 12, 50, 16, 300, 21], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } })
      m.addLayer({ id: 'cluster-n', type: 'symbol', source: 'pts', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 }, paint: { 'text-color': '#fff' } })
      m.addLayer({ id: 'point', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 5, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } })
      ready.current = true
      readyCbs.current.splice(0).forEach((cb) => cb())
    })
    m.on('mousemove', 'fill', (e) => {
      const f = e.features?.[0]
      if (!f) return
      m.getCanvas().style.cursor = 'pointer'
      popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px Inter Variable,sans-serif;color:#111">${f.properties?._tip ?? ''}</div>`).addTo(m)
    })
    m.on('mouseleave', 'fill', () => { m.getCanvas().style.cursor = ''; popup.remove() })
    m.on('click', 'fill', (e) => {
      const f = e.features?.[0]
      if (f) latest.current.onFeature(f.properties?.[latest.current.keyProp] as string | number)
    })
    m.on('click', 'clusters', async (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
      const z = await (m.getSource('pts') as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id)
      m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: z + 0.5 })
    })
    m.on('mousemove', 'point', (e) => {
      const p = e.features?.[0]?.properties
      if (!p) return
      m.getCanvas().style.cursor = 'pointer'
      popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px Inter Variable,sans-serif;color:#111"><b>${esc(String(p.nome ?? ''))}</b><br/>${p.secoes} seções · ${Number(p.aptos).toLocaleString('pt-BR')} aptos</div>`).addTo(m)
    })
    m.on('mouseleave', 'point', () => { m.getCanvas().style.cursor = ''; popup.remove() })
    m.on('click', 'point', (e) => {
      const p = e.features?.[0]?.properties
      if (p) latest.current.onPoint(p as unknown as MapPoint)
    })
    return () => { ready.current = false; m.remove(); map.current = null; lastGeo.current = '' }
  }, [])

  // geometrias + preenchimento
  useEffect(() => {
    const m = map.current
    if (!m) return
    let cancelled = false
    const apply = async () => {
      const src = m.getSource('geo') as GeoJSONSource
      if (lastGeo.current !== geoUrl) {
        const gj: FeatureCollection = await fetch(geoUrl).then((r) => r.json())
        if (cancelled) return
        geoCache.set(geoUrl, gj)
        lastGeo.current = geoUrl
        const b = new LngLatBounds()
        const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') b.extend(c as [number, number]); else (c as unknown[]).forEach(walk) }
        gj.features.forEach((f) => walk((f.geometry as Polygon).coordinates))
        if (!b.isEmpty()) m.fitBounds(b, { padding: 24, duration: 500 })
      }
      const gj = geoCache.get(geoUrl)!
      const kp = latest.current.keyProp
      for (const f of gj.features) {
        const k = f.properties![kp]
        const x = fills.get(k)
        f.properties!._color = x?.color ?? '#e4e4e7'
        const title = esc(String(x?.title ?? f.properties!.nome ?? k))
        f.properties!._tip = x ? `<b>${title}</b><br/>${x.tip}` : `<b>${title}</b><br/>sem dados no recorte`
        f.properties!._sel = selected.includes(k)
      }
      src.setData(gj)
    }
    whenReady(apply)
    return () => { cancelled = true }
  }, [geoUrl, fills, selected])

  // pontos
  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => {
      const src = m.getSource('pts') as GeoJSONSource | undefined
      if (!src) return
      src.setData({
        type: 'FeatureCollection',
        features: (points ?? []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { ...p } })),
      })
    }
    whenReady(apply)
  }, [points])

  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    m.setPaintProperty('line', 'line-color', ['case', ['boolean', ['get', '_sel'], false], dark ? '#fafafa' : '#111827', dark ? '#27272a' : '#ffffff'])
  }, [dark])

  return <div ref={el} className="size-full" role="application" aria-label={label} />
}

const geoCache = new Map<string, FeatureCollection>()
