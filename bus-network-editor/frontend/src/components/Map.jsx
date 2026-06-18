import { useEffect, useRef, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import './Map.css'

const ROUTE_COLOURS = [
  '#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce',
  '#805ad5','#d53f8c','#00b5d8','#667eea','#f6e05e',
]

function routeColor(routeId) {
  let h = 0
  for (let i = 0; i < routeId.length; i++) h = (h * 31 + routeId.charCodeAt(i)) | 0
  return ROUTE_COLOURS[Math.abs(h) % ROUTE_COLOURS.length]
}

function pointInPolygon(lng, lat, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
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
  stopsRow.appendChild(buildStopCard(props.stop_id_0, props.stop_name, routes0, props.heading_0, onRemove, onMove))
  stopsRow.appendChild(buildStopCard(props.stop_id_1, props.stop_name, routes1, props.heading_1, onRemove, onMove))
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
  activeRoutes,
  editMode,
  onStopClick,
  onRemove,
  onMove,
  onMapClick,
  onDeleteLine,
  onSelectionChange,
  selectedStopIds,
  catchmentStops,
  censusData,
  showCatchment,
  catchmentRadiusM,
  centerLat,
}) {
  const [mapLoaded, setMapLoaded] = useState(false)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const onRemoveRef = useRef(onRemove)
  const onMoveRef = useRef(onMove)
  const onStopClickRef = useRef(onStopClick)
  const onDeleteLineRef = useRef(onDeleteLine)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const editModeRef = useRef(editMode)
  const baselineStopsRef = useRef(baselineStops)
  onRemoveRef.current = onRemove
  onMoveRef.current = onMove
  onStopClickRef.current = onStopClick
  onDeleteLineRef.current = onDeleteLine
  onSelectionChangeRef.current = onSelectionChange
  editModeRef.current = editMode
  baselineStopsRef.current = baselineStops

  const syncMap = useCallback((map, bs, bsegs, msegs, ps, psegs, cids, pairs, routes) => {
    const empty = { type: 'FeatureCollection', features: [] }
    const hasEdits = !!(cids && cids.length)
    map.getSource('projected-stops')?.setData(hasEdits ? (ps || empty) : empty)
    map.getSource('projected-segments')?.setData(hasEdits ? (psegs || empty) : empty)

    const changedSet = new Set((cids || []).map(String))
    const activePairs = (pairs || []).filter(p => {
      if (changedSet.has(String(p.stop_id_0)) || changedSet.has(String(p.stop_id_1))) return false
      if (routes && !(
        (p.routes_0 ?? []).some(r => routes.has(String(r))) ||
        (p.routes_1 ?? []).some(r => routes.has(String(r)))
      )) return false
      return true
    })
    const pairedIdSet = new Set(activePairs.flatMap(p => [String(p.stop_id_0), String(p.stop_id_1)]))
    const activePairIds = new Set(activePairs.map(p => p.pair_id))

    map.getSource('pair-stops')?.setData({
      type: 'FeatureCollection',
      features: activePairs.map(pair => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pair.lon, pair.lat] },
        properties: {
          pair_id:   pair.pair_id,
          stop_name: pair.stop_name,
          stop_id_0: pair.stop_id_0,
          stop_id_1: pair.stop_id_1,
          heading_0: pair.heading_0,
          heading_1: pair.heading_1,
          routes_0:  JSON.stringify(pair.routes_0),
          routes_1:  JSON.stringify(pair.routes_1),
        },
      })),
    })

    const excludeSet = new Set([...(cids || []).map(String), ...pairedIdSet])
    const visibleStopFeats = bs
      ? bs.features.filter(f => !excludeSet.has(String(f.properties.stop_id)))
      : []
    map.getSource('visible-stops')?.setData({ type: 'FeatureCollection', features: visibleStopFeats })

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
      center: [0, 30],
      zoom: 2,
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
      map.addSource('selection-shape',    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('catchment-overlay',  { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('census-density',     { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      // Census population density choropleth — drawn first, beneath everything
      map.addLayer({
        id: 'census-density-fill',
        type: 'fill',
        source: 'census-density',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'density'],
            0,     'rgba(124,158,245,0)',
            500,   'rgba(124,158,245,0.18)',
            2000,  'rgba(100,120,245,0.35)',
            8000,  'rgba(160,80,220,0.5)',
            20000, 'rgba(220,60,180,0.65)',
          ],
          'fill-opacity': 1,
        },
      })
      map.addLayer({
        id: 'census-density-line',
        type: 'line',
        source: 'census-density',
        layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(180,180,255,0.15)', 'line-width': 0.5 },
      })

      // Catchment overlay — drawn above density, beneath stops
      map.addLayer({
        id: 'catchment-overlay-layer',
        type: 'circle',
        source: 'catchment-overlay',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#4a9eff',
          'circle-opacity': 0.08,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#4a9eff',
          'circle-stroke-opacity': 0.3,
          'circle-pitch-alignment': 'map',
          'circle-radius': 10,
        },
      })

      map.addLayer({ id: 'segments-layer', type: 'line', source: 'visible-segments',
        paint: { 'line-color': '#4a9eff', 'line-width': 2, 'line-opacity': 0.6 } })
      map.addLayer({ id: 'merged-segs-layer', type: 'line', source: 'merged-segs',
        paint: { 'line-color': '#4a9eff', 'line-width': 4, 'line-opacity': 0.8 } })
      map.addLayer({ id: 'stops-layer', type: 'circle', source: 'visible-stops',
        paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#4a9eff' } })
      map.addLayer({ id: 'pair-stops-layer', type: 'circle', source: 'pair-stops',
        paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': '#00c9b1' } })
      map.addLayer({ id: 'projected-segments-layer', type: 'line', source: 'projected-segments',
        paint: { 'line-color': '#ffd700', 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [4, 2] } })
      map.addLayer({ id: 'projected-stops-layer', type: 'circle', source: 'projected-stops',
        paint: { 'circle-radius': 6, 'circle-color': '#ffd700', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

      // Selection shape (fill + stroke)
      map.addLayer({ id: 'selection-shape-fill', type: 'fill', source: 'selection-shape',
        paint: { 'fill-color': '#7c9ef5', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'selection-shape-stroke', type: 'line', source: 'selection-shape',
        paint: { 'line-color': '#7c9ef5', 'line-width': 1.5, 'line-dasharray': [4, 2] } })


      // Stop click handlers — skipped in selection modes
      map.on('click', 'stops-layer', (e) => {
        const mode = editModeRef.current
        if (mode === 'box-select' || mode === 'lasso-select') return
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
          .setLngLat(coords).setDOMContent(domContent).addTo(map)
        popupRef.current = popup
        onStopClickRef.current?.({ ...props, lng: coords[0], lat: coords[1] })
      })

      map.on('click', 'pair-stops-layer', (e) => {
        const mode = editModeRef.current
        if (mode === 'box-select' || mode === 'lasso-select') return
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
          .setLngLat(coords).setDOMContent(domContent).addTo(map)
        popupRef.current = popup
      })

      map.on('click', 'projected-stops-layer', (e) => {
        const mode = editModeRef.current
        if (mode === 'box-select' || mode === 'lasso-select') return
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
          .setLngLat(coords).setDOMContent(domContent).addTo(map)
        popupRef.current = popup
        onStopClickRef.current?.({ ...props, lng: coords[0], lat: coords[1] })
      })

      map.on('click', (e) => {
        const mode = editModeRef.current
        if (mode === 'box-select' || mode === 'lasso-select') return
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

  // Handle map click for move/add mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e) => {
      if (editMode === 'move' || editMode === 'add') {
        onMapClick && onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat })
      }
    }
    map.on('click', handler)
    const isDrawing = editMode === 'box-select' || editMode === 'lasso-select'
    map.getCanvas().style.cursor = (editMode === 'move' || editMode === 'add' || isDrawing) ? 'crosshair' : ''
    return () => map.off('click', handler)
  }, [editMode, onMapClick])

  // Box selection drawing
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || editMode !== 'box-select') return

    let startLngLat = null

    const setShape = (s, e) => {
      map.getSource('selection-shape')?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: 'Polygon',
          coordinates: [[
            [s.lng, s.lat], [e.lng, s.lat], [e.lng, e.lat], [s.lng, e.lat], [s.lng, s.lat]
          ]],
        }, properties: {} }],
      })
    }

    const onMouseDown = (e) => {
      if (e.originalEvent.button !== 0) return
      startLngLat = e.lngLat
      map.dragPan.disable()
    }
    const onMouseMove = (e) => {
      if (!startLngLat) return
      setShape(startLngLat, e.lngLat)
    }
    const onMouseUp = (e) => {
      if (!startLngLat) return
      const end = e.lngLat
      map.dragPan.enable()
      const minLng = Math.min(startLngLat.lng, end.lng)
      const maxLng = Math.max(startLngLat.lng, end.lng)
      const minLat = Math.min(startLngLat.lat, end.lat)
      const maxLat = Math.max(startLngLat.lat, end.lat)
      startLngLat = null
      if ((maxLng - minLng) < 0.0001 && (maxLat - minLat) < 0.0001) return

      const stops = baselineStopsRef.current
      const ids = new Set()
      for (const f of (stops?.features ?? [])) {
        const [lng, lat] = f.geometry.coordinates
        if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat)
          ids.add(String(f.properties.stop_id))
      }
      onSelectionChangeRef.current?.(ids)
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.dragPan.enable()
    }
  }, [mapLoaded, editMode])

  // Lasso selection drawing
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || editMode !== 'lasso-select') return

    const vertices = []

    const updateSource = (preview = null) => {
      const pts = preview ? [...vertices, preview] : vertices
      if (pts.length < 2) {
        map.getSource('selection-shape')?.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const closed = [...pts, pts[0]]
      map.getSource('selection-shape')?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: pts.length >= 3 ? 'Polygon' : 'LineString',
          coordinates: pts.length >= 3 ? [closed] : closed,
        }, properties: {} }],
      })
    }

    const finalize = () => {
      if (vertices.length < 3) return
      const stops = baselineStopsRef.current
      const ids = new Set()
      for (const f of (stops?.features ?? [])) {
        const [lng, lat] = f.geometry.coordinates
        if (pointInPolygon(lng, lat, vertices)) ids.add(String(f.properties.stop_id))
      }
      onSelectionChangeRef.current?.(ids)
    }

    const onClick = (e) => {
      vertices.push([e.lngLat.lng, e.lngLat.lat])
      updateSource()
      // Close if clicking near first vertex
      if (vertices.length >= 4) {
        const firstPx = map.project(vertices[0])
        const d = Math.hypot(firstPx.x - e.point.x, firstPx.y - e.point.y)
        if (d < 20) { vertices.pop(); finalize(); return }
      }
    }
    const onMouseMove = (e) => {
      if (vertices.length > 0) updateSource([e.lngLat.lng, e.lngLat.lat])
    }
    const onDblClick = (e) => {
      e.preventDefault()
      if (vertices.length > 0) vertices.pop() // remove the extra click vertex
      finalize()
    }

    map.on('click', onClick)
    map.on('mousemove', onMouseMove)
    map.on('dblclick', onDblClick)
    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMouseMove)
      map.off('dblclick', onDblClick)
      vertices.length = 0
    }
  }, [mapLoaded, editMode])

  // Update catchment overlay stop source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const empty = { type: 'FeatureCollection', features: [] }
    map.getSource('catchment-overlay')?.setData(catchmentStops || empty)
  }, [mapLoaded, catchmentStops])

  // Update census density source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const empty = { type: 'FeatureCollection', features: [] }
    map.getSource('census-density')?.setData(censusData || empty)
  }, [mapLoaded, censusData])

  // Toggle overlay visibility + update catchment radius expression
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const vis = showCatchment ? 'visible' : 'none'
    map.setLayoutProperty('catchment-overlay-layer', 'visibility', vis)
    map.setLayoutProperty('census-density-fill', 'visibility', vis)
    map.setLayoutProperty('census-density-line', 'visibility', vis)
    if (showCatchment) {
      // WebMercator: 1 pixel at zoom 0 = 2π*R/512 ≈ 78271 m at equator, × 1/cos(lat) at latitude.
      // interpolate exponential base-2 from zoom 0→22 gives pixel = v0 * 2^zoom at any zoom.
      const cosLat = Math.cos((centerLat ?? 40) * Math.PI / 180)
      const v0 = catchmentRadiusM * cosLat / 78271
      map.setPaintProperty('catchment-overlay-layer', 'circle-radius',
        ['interpolate', ['exponential', 2], ['zoom'], 0, v0, 22, v0 * Math.pow(2, 22)])
    }
  }, [mapLoaded, showCatchment, catchmentRadiusM, centerLat])

  // Clear selection shape when geo selection is cleared externally
  useEffect(() => {
    if (!mapLoaded || selectedStopIds) return
    mapRef.current?.getSource('selection-shape')?.setData({ type: 'FeatureCollection', features: [] })
  }, [mapLoaded, selectedStopIds])

  // Fit map to baseline stops the first time they load
  const fittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !baselineStops?.features?.length || fittedRef.current) return
    fittedRef.current = true
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const f of baselineStops.features) {
      const [lng, lat] = f.geometry.coordinates
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 0 })
  }, [mapLoaded, baselineStops])

  // Sync all source data + layer filters whenever anything changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    syncMap(map, baselineStops, baselineSegments, mergedSegments, projectedStops, projectedSegments, changedStopIds, stopPairs, activeRoutes)
  }, [mapLoaded, baselineStops, baselineSegments, mergedSegments, projectedStops, projectedSegments, changedStopIds, stopPairs, activeRoutes, syncMap])

  return <div ref={containerRef} className="map-container" />
}
