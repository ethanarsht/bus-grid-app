import { useEffect, useRef, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import './Map.css'

const CHICAGO = { lng: -87.6298, lat: 41.8781, zoom: 11 }

const ROUTE_COLOURS = [
  '#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce',
  '#805ad5','#d53f8c','#00b5d8','#667eea','#f6e05e',
]

function routeColor(routeId) {
  let h = 0
  for (let i = 0; i < routeId.length; i++) h = (h * 31 + routeId.charCodeAt(i)) | 0
  return ROUTE_COLOURS[Math.abs(h) % ROUTE_COLOURS.length]
}

function buildStopCard(stopId, stopName, routes, heading, onRemove, onMove) {
  const card = document.createElement('div')
  card.className = 'pair-popup-stop'

  if (heading) {
    const dirEl = document.createElement('div')
    dirEl.className = 'pair-popup-direction'
    dirEl.textContent = heading
    card.appendChild(dirEl)
  }

  const idEl = document.createElement('div')
  idEl.className = 'stop-popup-id'
  idEl.textContent = stopId
  card.appendChild(idEl)

  if (routes.length) {
    const routesEl = document.createElement('div')
    routesEl.className = 'stop-popup-routes'
    routes.forEach(r => {
      const pill = document.createElement('span')
      pill.className = 'route-pill'
      pill.style.background = routeColor(r)
      pill.textContent = r
      routesEl.appendChild(pill)
    })
    card.appendChild(routesEl)
  }

  const actions = document.createElement('div')
  actions.className = 'stop-popup-actions'

  const stopProps = { stop_id: stopId, stop_name: stopName, routes: JSON.stringify(routes) }

  const removeBtn = document.createElement('button')
  removeBtn.className = 'popup-btn popup-btn-remove'
  removeBtn.textContent = 'Remove'
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(stopProps) })

  const moveBtn = document.createElement('button')
  moveBtn.className = 'popup-btn popup-btn-move'
  moveBtn.textContent = 'Move'
  moveBtn.addEventListener('click', (e) => { e.stopPropagation(); onMove(stopProps) })

  actions.appendChild(removeBtn)
  actions.appendChild(moveBtn)
  card.appendChild(actions)

  return card
}

function appendDeleteLineSection(container, routes, onDeleteLine) {
  if (!routes.length || !onDeleteLine) return
  const divider = document.createElement('div')
  divider.className = 'popup-section-divider'
  container.appendChild(divider)

  const label = document.createElement('div')
  label.className = 'popup-delete-label'
  label.textContent = 'Delete line'
  container.appendChild(label)

  const row = document.createElement('div')
  row.className = 'popup-delete-row'
  routes.forEach(r => {
    const btn = document.createElement('button')
    btn.className = 'popup-btn popup-btn-delete-line'
    btn.style.setProperty('--route-color', routeColor(r))
    btn.textContent = r
    btn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteLine(r) })
    row.appendChild(btn)
  })
  container.appendChild(row)
}

function buildPopupDOM(props, onRemove, onMove, onDeleteLine) {
  let routes = []
  try { routes = JSON.parse(props.routes) } catch { routes = [] }

  const container = document.createElement('div')
  container.className = 'stop-popup'

  const nameEl = document.createElement('div')
  nameEl.className = 'stop-popup-name'
  nameEl.textContent = props.stop_name || props.stop_id
  container.appendChild(nameEl)

  if (props.heading) {
    const dirEl = document.createElement('div')
    dirEl.className = 'pair-popup-direction'
    dirEl.textContent = props.heading
    container.appendChild(dirEl)
  }

  const idEl = document.createElement('div')
  idEl.className = 'stop-popup-id'
  idEl.textContent = props.stop_id
  container.appendChild(idEl)

  if (routes.length) {
    const routesEl = document.createElement('div')
    routesEl.className = 'stop-popup-routes'
    routes.forEach(r => {
      const pill = document.createElement('span')
      pill.className = 'route-pill'
      pill.style.background = routeColor(r)
      pill.textContent = r
      routesEl.appendChild(pill)
    })
    container.appendChild(routesEl)
  }

  const actions = document.createElement('div')
  actions.className = 'stop-popup-actions'

  const removeBtn = document.createElement('button')
  removeBtn.className = 'popup-btn popup-btn-remove'
  removeBtn.textContent = 'Remove'
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(props) })

  const moveBtn = document.createElement('button')
  moveBtn.className = 'popup-btn popup-btn-move'
  moveBtn.textContent = 'Move'
  moveBtn.addEventListener('click', (e) => { e.stopPropagation(); onMove(props) })

  actions.appendChild(removeBtn)
  actions.appendChild(moveBtn)
  container.appendChild(actions)

  appendDeleteLineSection(container, routes, onDeleteLine)

  return container
}

function buildPairPopupDOM(props, onRemove, onMove, onDeleteLine) {
  let routes0 = [], routes1 = []
  try { routes0 = JSON.parse(props.routes_0) } catch { routes0 = [] }
  try { routes1 = JSON.parse(props.routes_1) } catch { routes1 = [] }

  const container = document.createElement('div')
  container.className = 'stop-popup'

  const nameEl = document.createElement('div')
  nameEl.className = 'stop-popup-name'
  nameEl.textContent = props.stop_name
  container.appendChild(nameEl)

  const stopsRow = document.createElement('div')
  stopsRow.className = 'pair-popup-stops'

  stopsRow.appendChild(buildStopCard(
    props.stop_id_0, props.stop_name, routes0, props.heading_0, onRemove, onMove,
  ))
  stopsRow.appendChild(buildStopCard(
    props.stop_id_1, props.stop_name, routes1, props.heading_1, onRemove, onMove,
  ))

  container.appendChild(stopsRow)

  const allRoutes = [...new Set([...routes0, ...routes1])]
  appendDeleteLineSection(container, allRoutes, onDeleteLine)

  return container
}

export default function Map({
  baselineStops,
  baselineSegments,
  projectedStops,
  projectedSegments,
  changedStopIds,
  stopPairs,
  mergedSegments,
  editMode,
  onStopClick,
  onRemove,
  onMove,
  onMapClick,
  onDeleteLine,
}) {
  const [mapLoaded, setMapLoaded] = useState(false)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const onRemoveRef = useRef(onRemove)
  const onMoveRef = useRef(onMove)
  const onStopClickRef = useRef(onStopClick)
  const onDeleteLineRef = useRef(onDeleteLine)
  onRemoveRef.current = onRemove
  onMoveRef.current = onMove
  onStopClickRef.current = onStopClick
  onDeleteLineRef.current = onDeleteLine

  const syncMap = useCallback((map, bs, bsegs, msegs, ps, psegs, cids, pairs) => {
    const empty = { type: 'FeatureCollection', features: [] }
    // Only populate projected sources when there are actual edits to display.
    // Avoids pushing all baseline stops into projected-stops source on initial load,
    // which can cause the filter to render them briefly.
    const hasEdits = !!(cids && cids.length)
    map.getSource('projected-stops')?.setData(hasEdits ? (ps || empty) : empty)
    map.getSource('projected-segments')?.setData(hasEdits ? (psegs || empty) : empty)

    // Active pairs: neither stop has been edited
    const changedSet = new Set((cids || []).map(String))
    const activePairs = (pairs || []).filter(
      p => !changedSet.has(String(p.stop_id_0)) && !changedSet.has(String(p.stop_id_1))
    )
    const pairedIdSet = new Set(activePairs.flatMap(p => [String(p.stop_id_0), String(p.stop_id_1)]))
    const activePairIds = new Set(activePairs.map(p => p.pair_id))

    // Build pair-stops source from active pairs
    map.getSource('pair-stops')?.setData({
      type: 'FeatureCollection',
      features: activePairs.map(pair => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pair.lon, pair.lat] },
        properties: {
          pair_id:    pair.pair_id,
          stop_name:  pair.stop_name,
          stop_id_0:  pair.stop_id_0,
          stop_id_1:  pair.stop_id_1,
          heading_0:  pair.heading_0,
          heading_1:  pair.heading_1,
          routes_0:   JSON.stringify(pair.routes_0),
          routes_1:   JSON.stringify(pair.routes_1),
        },
      })),
    })

    // Rebuild visible-stops: baseline minus changed + actively-paired
    const excludeSet = new Set([...(cids || []).map(String), ...pairedIdSet])
    const visibleStopFeats = bs
      ? bs.features.filter(f => !excludeSet.has(String(f.properties.stop_id)))
      : []
    map.getSource('visible-stops')?.setData({ type: 'FeatureCollection', features: visibleStopFeats })

    // Rebuild visible-segments: baseline minus changed-stop segments and merged corridors
    // (merged corridors are replaced by the thicker merged-segs-layer)
    const visibleSegFeats = bsegs
      ? bsegs.features.filter(f => {
          const s1 = String(f.properties.stop_id1)
          const s2 = String(f.properties.stop_id2)
          if (changedSet.has(s1) || changedSet.has(s2)) return false
          if (f.properties.merged && pairedIdSet.has(s1) && pairedIdSet.has(s2)) return false
          return true
        })
      : []
    map.getSource('visible-segments')?.setData({ type: 'FeatureCollection', features: visibleSegFeats })

    // Rebuild merged-segs: only corridors where both pairs are still active
    const mergedSegFeats = msegs
      ? msegs.features.filter(f =>
          activePairIds.has(f.properties.pair_a_id) &&
          activePairIds.has(f.properties.pair_b_id)
        )
      : []
    map.getSource('merged-segs')?.setData({ type: 'FeatureCollection', features: mergedSegFeats })

    if (!cids || cids.length === 0) {
      map.setFilter('projected-stops-layer', ['==', 1, 0])
      map.setFilter('projected-segments-layer', ['==', 1, 0])
    } else {
      const ids = ['literal', cids]
      map.setFilter('projected-stops-layer', ['in', ['get', 'stop_id'], ids])
      map.setFilter('projected-segments-layer', ['any',
        ['has', 'bridge'],
        ['in', ['get', 'stop_id1'], ids],
        ['in', ['get', 'stop_id2'], ids],
      ])
    }
  }, [])

  // Initialise map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [CHICAGO.lng, CHICAGO.lat],
      zoom: CHICAGO.zoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      map.addSource('visible-segments',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('merged-segs',        { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('visible-stops',      { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('projected-segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('projected-stops',    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('pair-stops',         { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      map.addLayer({
        id: 'segments-layer',
        type: 'line',
        source: 'visible-segments',
        paint: { 'line-color': '#4a9eff', 'line-width': 2, 'line-opacity': 0.6 },
      })

      map.addLayer({
        id: 'merged-segs-layer',
        type: 'line',
        source: 'merged-segs',
        paint: { 'line-color': '#4a9eff', 'line-width': 4, 'line-opacity': 0.8 },
      })

      map.addLayer({
        id: 'stops-layer',
        type: 'circle',
        source: 'visible-stops',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#4a9eff',
        },
      })

      // Pair stops: teal double-ring to indicate merged directional pair
      map.addLayer({
        id: 'pair-stops-layer',
        type: 'circle',
        source: 'pair-stops',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#00c9b1',
        },
      })

      map.addLayer({
        id: 'projected-segments-layer',
        type: 'line',
        source: 'projected-segments',
        paint: { 'line-color': '#ffd700', 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [4, 2] },
      })

      map.addLayer({
        id: 'projected-stops-layer',
        type: 'circle',
        source: 'projected-stops',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffd700',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      // Single-stop click → standard popup
      map.on('click', 'stops-layer', (e) => {
        e.preventDefault()
        const feature = e.features[0]
        const props = feature.properties
        const coords = feature.geometry.coordinates
        popupRef.current?.remove()
        const domContent = buildPopupDOM(
          props,
          (p) => { popupRef.current?.remove(); onRemoveRef.current?.(p) },
          (p) => { popupRef.current?.remove(); onMoveRef.current?.(p) },
          (r) => { popupRef.current?.remove(); onDeleteLineRef.current?.(r) },
        )
        const popup = new maplibregl.Popup({ maxWidth: '260px', className: 'stop-popup-wrapper' })
          .setLngLat(coords)
          .setDOMContent(domContent)
          .addTo(map)
        popupRef.current = popup
        onStopClickRef.current?.({ ...props, lng: coords[0], lat: coords[1] })
      })

      // Pair stop click → combined directional popup
      map.on('click', 'pair-stops-layer', (e) => {
        e.preventDefault()
        const feature = e.features[0]
        const props = feature.properties
        const coords = feature.geometry.coordinates
        popupRef.current?.remove()
        const domContent = buildPairPopupDOM(
          props,
          (p) => { popupRef.current?.remove(); onRemoveRef.current?.(p) },
          (p) => { popupRef.current?.remove(); onMoveRef.current?.(p) },
          (r) => { popupRef.current?.remove(); onDeleteLineRef.current?.(r) },
        )
        const popup = new maplibregl.Popup({ maxWidth: '380px', className: 'stop-popup-wrapper' })
          .setLngLat(coords)
          .setDOMContent(domContent)
          .addTo(map)
        popupRef.current = popup
      })

      // Projected stop click (moved/added stops) → standard popup
      map.on('click', 'projected-stops-layer', (e) => {
        e.preventDefault()
        const feature = e.features[0]
        const props = feature.properties
        const coords = feature.geometry.coordinates
        popupRef.current?.remove()
        const domContent = buildPopupDOM(
          props,
          (p) => { popupRef.current?.remove(); onRemoveRef.current?.(p) },
          (p) => { popupRef.current?.remove(); onMoveRef.current?.(p) },
          (r) => { popupRef.current?.remove(); onDeleteLineRef.current?.(r) },
        )
        const popup = new maplibregl.Popup({ maxWidth: '260px', className: 'stop-popup-wrapper' })
          .setLngLat(coords)
          .setDOMContent(domContent)
          .addTo(map)
        popupRef.current = popup
        onStopClickRef.current?.({ ...props, lng: coords[0], lat: coords[1] })
      })

      // Close popup when clicking outside any stop layer
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['stops-layer', 'pair-stops-layer', 'projected-stops-layer'],
        })
        if (!hits.length) popupRef.current?.remove()
      })

      map.on('mouseenter', 'stops-layer',           () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'stops-layer',           () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'pair-stops-layer',      () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'pair-stops-layer',      () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'projected-stops-layer', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'projected-stops-layer', () => { map.getCanvas().style.cursor = '' })

      setMapLoaded(true)
    })

    return () => { map.remove(); setMapLoaded(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle map click for move mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e) => {
      if (editMode === 'move' || editMode === 'add') {
        onMapClick && onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat })
      }
    }
    map.on('click', handler)
    map.getCanvas().style.cursor = (editMode === 'move' || editMode === 'add') ? 'crosshair' : ''
    return () => map.off('click', handler)
  }, [editMode, onMapClick])

  // Sync all source data + layer filters whenever anything changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    syncMap(map, baselineStops, baselineSegments, mergedSegments, projectedStops, projectedSegments, changedStopIds, stopPairs)
  }, [mapLoaded, baselineStops, baselineSegments, mergedSegments, projectedStops, projectedSegments, changedStopIds, stopPairs, syncMap])

  return <div ref={containerRef} className="map-container" />
}
