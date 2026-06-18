import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Map from './components/Map.jsx'
import EditToolbar from './components/EditToolbar.jsx'
import MetricsPanel from './components/MetricsPanel.jsx'
import PopulationPanel from './components/PopulationPanel.jsx'
import { getBaseline, getProjection, addEdit, addEditsBatch, undoLastEdit, updateScenario, publishScenario, getCensusData } from './api.js'
import { useAuth } from './contexts/AuthContext.jsx'
import AuthModal from './components/AuthModal.jsx'
import { runSpacingAlgorithm } from './spacingAlgorithm.js'
import './App.css'

const R_EARTH = 6378137

function computePopulationServed(tractFeatures, stopsFC, radiusM) {
  if (!tractFeatures?.length || !stopsFC?.features?.length) return null
  const stops = stopsFC.features.map(f => {
    const [lng, lat] = f.geometry.coordinates
    return [lat * Math.PI / 180, lng * Math.PI / 180, Math.cos(lat * Math.PI / 180)]
  })
  let served = 0, total = 0
  for (const tract of tractFeatures) {
    const pop = tract.properties.population
    if (!pop || pop <= 0) continue
    total += pop
    // Use centroid stored as property (geometry is now a polygon for density overlay)
    const tLng = tract.properties.centroid_lng ?? tract.geometry.coordinates[0]
    const tLat = tract.properties.centroid_lat ?? tract.geometry.coordinates[1]
    const tLr = tLat * Math.PI / 180
    const tLnr = tLng * Math.PI / 180
    const cosTLat = Math.cos(tLr)
    let isServed = false
    for (const [sLr, sLnr, cosSLat] of stops) {
      const dlat = tLr - sLr
      const dlng = tLnr - sLnr
      const sdlat = Math.sin(dlat / 2)
      const sdlng = Math.sin(dlng / 2)
      const a = sdlat * sdlat + cosSLat * cosTLat * sdlng * sdlng
      if (2 * R_EARTH * Math.asin(Math.sqrt(a)) <= radiusM) { isServed = true; break }
    }
    if (isServed) served += pop
  }
  return { served, total, fraction: total > 0 ? served / total : 0 }
}

export default function App() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [baseline, setBaseline] = useState(null)
  const [projection, setProjection] = useState(null)
  const [scenarioId, setScenarioId] = useState(null)
  const [scenarioName, setScenarioName] = useState('New Map')
  const [editMode, setEditMode] = useState('select')
  const [selectedStop, setSelectedStop] = useState(null)
  const [canUndo, setCanUndo] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addStopRoute, setAddStopRoute] = useState(null)
  const [addStopDirection, setAddStopDirection] = useState(null)
  const [addStopTerminus, setAddStopTerminus] = useState(false)
  const [isPublished, setIsPublished] = useState(false)
  const [selectedRoutes, setSelectedRoutes] = useState(null)
  const [selectedStopIds, setSelectedStopIds] = useState(null)
  const [censusData, setCensusData] = useState(null)
  const [catchmentRadiusM, setCatchmentRadiusM] = useState(400)
  const [showCatchment, setShowCatchment] = useState(false)
  const { user } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const scopedStopsRef = useRef(null)

  const scenarioNameRef = useRef(scenarioName)
  scenarioNameRef.current = scenarioName

  // Escape cancels any active edit mode
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setEditMode('select')
        setSelectedStop(null)
        setSelectedStopIds(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Require a scenario= param — if missing, send back to landing
  useEffect(() => {
    const sid = searchParams.get('scenario')
    const cityId = searchParams.get('city') || 'chicago_cta'
    if (!sid) { navigate('/'); return }

    async function init() {
      try {
        const [data, initial, census] = await Promise.all([
          getBaseline(cityId),
          getProjection(sid),
          getCensusData(cityId).catch(() => null),
        ])
        setBaseline(data)
        setScenarioId(sid)
        setScenarioName(initial.name ?? 'New Map')
        setIsPublished(initial.is_published ?? false)
        setProjection(initial)
        setCensusData(census)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Edit actions
  // -------------------------------------------------------------------------

  async function applyEdit(editPayload) {
    if (!scenarioId) return
    try {
      const result = await addEdit(scenarioId, editPayload)
      setProjection(result)
      setCanUndo(true)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleStopClick(stopProps) {
    setSelectedStop(stopProps)
    setEditMode('select')
  }

  async function handleMapClick({ lng, lat }) {
    if (editMode === 'move' && selectedStop) {
      await applyEdit({ op: 'MOVE', stop_id: selectedStop.stop_id, new_lat: lat, new_lon: lng })
      setSelectedStop(null)
      setEditMode('select')
    }
    if (editMode === 'add') {
      await applyEdit({
        op: 'ADD',
        new_lat: lat,
        new_lon: lng,
        routes: addStopRoute ? [addStopRoute] : [],
        direction_id: addStopDirection,
        is_terminus: addStopTerminus,
      })
      setAddStopRoute(null)
      setAddStopDirection(null)
      setAddStopTerminus(false)
      setEditMode('select')
    }
  }

  function handleBeginAddStop(routeId, directionId, isTerminus) {
    setAddStopRoute(routeId || null)
    setAddStopDirection(directionId ?? null)
    setAddStopTerminus(!!isTerminus)
    setEditMode('add')
  }

  function handleCancelAdd() {
    setAddStopRoute(null)
    setAddStopDirection(null)
    setAddStopTerminus(false)
    setEditMode('select')
  }

  async function handleRemove(stop) {
    const target = stop || selectedStop
    if (!target) return
    await applyEdit({ op: 'REMOVE', stop_id: target.stop_id })
    setSelectedStop(null)
  }

  function handleMove(stop) {
    setSelectedStop(stop)
    setEditMode('move')
  }

  async function handleDeleteLine(routeId) {
    if (!scenarioId || !projectedStops) return
    const edits = projectedStops.features
      .filter(f => {
        const routes = f.properties.routes
        return Array.isArray(routes) && routes.length === 1 && routes[0] === routeId
      })
      .map(f => ({ op: 'REMOVE', stop_id: f.properties.stop_id }))
    if (edits.length === 0) return
    try {
      const result = await addEditsBatch(scenarioId, edits)
      setProjection(result)
      setCanUndo(true)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSpacingAlgorithm(minM, maxM) {
    if (!scenarioId || !projectedStops || !baseline) return
    const stopIds = runSpacingAlgorithm(scopedStopsRef.current ?? projectedStops, baseline.segments, minM, maxM)
    if (stopIds.length === 0) return
    const edits = stopIds.map(stop_id => ({ op: 'REMOVE', stop_id }))
    try {
      const result = await addEditsBatch(scenarioId, edits)
      setProjection(result)
      setCanUndo(true)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBulkRandomRemove(fraction) {
    if (!scenarioId || !projectedStops) return
    const allIds = (scopedStopsRef.current ?? projectedStops).features.map(f => f.properties.stop_id)
    const count = Math.round(fraction * allIds.length)
    if (count === 0) return
    // Fisher-Yates partial shuffle to pick `count` ids
    const ids = [...allIds]
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (ids.length - i))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    const edits = ids.slice(0, count).map(stop_id => ({ op: 'REMOVE', stop_id }))
    try {
      const result = await addEditsBatch(scenarioId, edits)
      setProjection(result)
      setCanUndo(true)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleSelectionChange(stopIds) {
    setSelectedStopIds(stopIds.size > 0 ? stopIds : null)
    setEditMode('select')
  }

  function handleClearSelection() {
    setSelectedStopIds(null)
  }

  async function handleUndo() {
    if (!scenarioId) return
    try {
      const result = await undoLastEdit(scenarioId)
      setProjection(result)
      setCanUndo(true)
    } catch {
      setCanUndo(false)
    }
  }

  async function handlePublish() {
    if (!scenarioId) return
    try {
      const result = await publishScenario(scenarioId)
      setIsPublished(result.is_published)
    } catch (err) {
      setError(err.message)
    }
  }

  const nameDebounceRef = useRef(null)
  function handleScenarioNameChange(name) {
    setScenarioName(name)
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    nameDebounceRef.current = setTimeout(() => {
      if (scenarioId) updateScenario(scenarioId, { name }).catch(() => {})
    }, 600)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const availableRoutes = baseline
    ? [...new Set(baseline.segments.features.map(f => String(f.properties.route_id)))].sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b)
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb
      })
    : []

  // Reset selection when a new baseline loads
  useEffect(() => {
    if (availableRoutes.length > 0) setSelectedRoutes(new Set(availableRoutes))
  }, [baseline]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeRoutes = selectedRoutes ?? new Set(availableRoutes)
  const allRoutesSelected = !selectedRoutes || selectedRoutes.size === availableRoutes.length

  function filterStops(fc) {
    if (!fc || allRoutesSelected) return fc
    return { ...fc, features: fc.features.filter(f => (f.properties.routes ?? []).some(r => activeRoutes.has(String(r)))) }
  }
  function filterSegments(fc) {
    if (!fc || allRoutesSelected) return fc
    return { ...fc, features: fc.features.filter(f => activeRoutes.has(String(f.properties.route_id))) }
  }

  function handleToggleRoute(routeId) {
    setSelectedRoutes(prev => {
      const next = new Set(prev ?? availableRoutes)
      if (next.has(routeId)) next.delete(routeId); else next.add(routeId)
      return next
    })
  }
  function handleSelectAllRoutes() { setSelectedRoutes(new Set(availableRoutes)) }
  function handleSelectNoRoutes() { setSelectedRoutes(new Set()) }

  const projectedStops = projection?.stops ?? null
  const projectedSegments = projection?.segments ?? null
  const metrics = projection?.metrics ?? null
  const changedStopIds = projection?.changed_stop_ids ?? []
  const stopPairs = baseline?.stop_pairs ?? []
  const mergedSegments = baseline?.merged_segments ?? null

  const visBaselineStops = filterStops(baseline?.stops)
  const visBaselineSegments = filterSegments(baseline?.segments)
  const visProjectedStops = filterStops(projectedStops)
  const visProjectedSegments = filterSegments(projectedSegments)

  // When a geo selection is active, restrict map to only selected stops/segments
  function filterToSelection(fc, isStops) {
    if (!fc || !selectedStopIds) return fc
    if (isStops) {
      return { ...fc, features: fc.features.filter(f => selectedStopIds.has(String(f.properties.stop_id))) }
    }
    return { ...fc, features: fc.features.filter(f =>
      selectedStopIds.has(String(f.properties.stop_id1)) && selectedStopIds.has(String(f.properties.stop_id2))
    )}
  }
  const mapBaselineStops    = filterToSelection(visBaselineStops, true)
  const mapBaselineSegments = filterToSelection(visBaselineSegments, false)
  const mapProjectedStops   = filterToSelection(visProjectedStops, true)
  scopedStopsRef.current = mapProjectedStops
  const mapProjectedSegments = filterToSelection(visProjectedSegments, false)
  const mapStopPairs = selectedStopIds
    ? (stopPairs ?? []).filter(p =>
        selectedStopIds.has(String(p.stop_id_0)) && selectedStopIds.has(String(p.stop_id_1)))
    : stopPairs
  // Center latitude for catchment circle radius approximation (per-city constant)
  const centerLat = (() => {
    const feats = baseline?.stops?.features
    if (!feats?.length) return 40
    return feats.reduce((s, f) => s + f.geometry.coordinates[1], 0) / feats.length
  })()

  // Full current stop set (all routes, no geo filter) — used for catchment overlay + population metric
  const catchmentStops = projection?.stops ?? baseline?.stops ?? null

  // Population served by the full current network at the given catchment radius
  const populationStats = censusData && catchmentStops
    ? computePopulationServed(censusData.features, catchmentStops, catchmentRadiusM)
    : null

  const mapMergedSegments = mergedSegments && selectedStopIds
    ? { ...mergedSegments, features: mergedSegments.features.filter(f => {
        const pairA = (stopPairs ?? []).find(p => p.pair_id === f.properties.pair_a_id)
        const pairB = (stopPairs ?? []).find(p => p.pair_id === f.properties.pair_b_id)
        return pairA && pairB &&
          selectedStopIds.has(String(pairA.stop_id_0)) && selectedStopIds.has(String(pairA.stop_id_1)) &&
          selectedStopIds.has(String(pairB.stop_id_0)) && selectedStopIds.has(String(pairB.stop_id_1))
      })}
    : mergedSegments

  return (
    <div className="app">
      <div className="title-bar">
        <button className="title-bar-back" onClick={() => navigate('/')}>← Maps</button>
        <span>Ethan's Retransiting App</span>
      </div>
      {!user && !loading && (
        <div className="guest-banner">
          Guest mode — this map won't appear in My Maps.{' '}
          <button className="guest-banner-signin" onClick={() => setShowAuthModal(true)}>Sign in to save</button>
        </div>
      )}
      {loading && <div className="loading-overlay">Loading network…</div>}
      {error && <div className="error-banner">Error: {error} <button onClick={() => setError(null)}>✕</button></div>}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      <Map
        baselineStops={mapBaselineStops}
        baselineSegments={mapBaselineSegments}
        projectedStops={mapProjectedStops}
        projectedSegments={mapProjectedSegments}
        changedStopIds={changedStopIds}
        stopPairs={mapStopPairs}
        mergedSegments={mapMergedSegments}
        activeRoutes={allRoutesSelected ? null : activeRoutes}
        editMode={editMode}
        onStopClick={handleStopClick}
        onRemove={handleRemove}
        onMove={handleMove}
        onMapClick={handleMapClick}
        onDeleteLine={handleDeleteLine}
        onSelectionChange={handleSelectionChange}
        selectedStopIds={selectedStopIds}
        catchmentStops={catchmentStops}
        censusData={censusData}
        showCatchment={showCatchment}
        catchmentRadiusM={catchmentRadiusM}
        centerLat={centerLat}
      />

      <EditToolbar
        scenarioName={scenarioName}
        onScenarioNameChange={handleScenarioNameChange}
        onUndo={handleUndo}
        canUndo={canUndo}
        projectedStopCount={mapProjectedStops?.features?.length ?? 0}
        onBulkRandomRemove={handleBulkRandomRemove}
        onSpacingAlgorithm={handleSpacingAlgorithm}
        availableRoutes={availableRoutes}
        selectedRoutes={activeRoutes}
        onToggleRoute={handleToggleRoute}
        onSelectAllRoutes={handleSelectAllRoutes}
        onSelectNoRoutes={handleSelectNoRoutes}
        baselineSegments={baseline?.segments}
        editMode={editMode}
        onBeginAddStop={handleBeginAddStop}
        onCancelAdd={handleCancelAdd}
        onSetEditMode={setEditMode}
        isPublished={isPublished}
        onPublish={user ? handlePublish : null}
        selectedStopIds={selectedStopIds}
        onClearSelection={handleClearSelection}
      />

      <PopulationPanel
        populationStats={populationStats}
        catchmentRadiusM={catchmentRadiusM}
        onCatchmentRadiusChange={setCatchmentRadiusM}
        showCatchment={showCatchment}
        onToggleCatchment={() => setShowCatchment(v => !v)}
        hasCensusData={!!censusData}
      />

      <MetricsPanel
        metrics={metrics}
        scenarioId={scenarioId}
        scenarioName={scenarioName}
        baselineSegments={visBaselineSegments}
        projectedSegments={visProjectedSegments}
        selectedStopIds={selectedStopIds}
        lineFilterActive={!allRoutesSelected}
      />
    </div>
  )
}
