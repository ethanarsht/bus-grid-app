import { useState, useEffect, useRef } from 'react'
import Map from './components/Map.jsx'
import EditToolbar from './components/EditToolbar.jsx'
import MetricsPanel from './components/MetricsPanel.jsx'
import { getBaseline, createScenario, getProjection, addEdit, addEditsBatch, undoLastEdit } from './api.js'
import { runSpacingAlgorithm } from './spacingAlgorithm.js'
import './App.css'

export default function App() {
  const [baseline, setBaseline] = useState(null)          // { stops, segments }
  const [projection, setProjection] = useState(null)      // ProjectionResponse
  const [scenarioId, setScenarioId] = useState(null)
  const [scenarioName, setScenarioName] = useState('New Scenario')
  const [editMode, setEditMode] = useState('select')       // 'select' | 'move'
  const [selectedStop, setSelectedStop] = useState(null)
  const [canUndo, setCanUndo] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addStopRoute, setAddStopRoute] = useState(null)
  const [addStopDirection, setAddStopDirection] = useState(null)
  const [addStopTerminus, setAddStopTerminus] = useState(false)

  const scenarioNameRef = useRef(scenarioName)
  scenarioNameRef.current = scenarioName

  // Escape cancels any active edit mode
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setEditMode('select')
        setSelectedStop(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Load baseline and initialise scenario on mount (or from URL param)
  useEffect(() => {
    async function init() {
      try {
        const data = await getBaseline()
        setBaseline(data)

        // Check for ?scenario= in URL
        const params = new URLSearchParams(window.location.search)
        const sid = params.get('scenario')
        let resolvedId
        if (sid) {
          resolvedId = sid
          setScenarioId(sid)
        } else {
          // Create a fresh scenario
          const { scenario_id } = await createScenario(scenarioNameRef.current)
          resolvedId = scenario_id
          setScenarioId(scenario_id)
        }

        // Load baseline metrics immediately so the panel is populated on launch
        const initial = await getProjection(resolvedId)
        setProjection(initial)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

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
    const stopIds = runSpacingAlgorithm(projectedStops, baseline.segments, minM, maxM)
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
    const allIds = projectedStops.features.map(f => f.properties.stop_id)
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

  async function handleScenarioNameChange(name) {
    setScenarioName(name)
    // TODO: persist name change via PATCH /api/scenarios/:id when implemented
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

  const projectedStops = projection?.stops ?? null
  const projectedSegments = projection?.segments ?? null
  const metrics = projection?.metrics ?? null
  const changedStopIds = projection?.changed_stop_ids ?? []
  const stopPairs = baseline?.stop_pairs ?? []
  const mergedSegments = baseline?.merged_segments ?? null

  return (
    <div className="app">
      <div className="title-bar">Ethan's Retransiting App</div>
      {loading && <div className="loading-overlay">Loading Chicago CTA network…</div>}
      {error && <div className="error-banner">Error: {error} <button onClick={() => setError(null)}>✕</button></div>}

      <Map
        baselineStops={baseline?.stops}
        baselineSegments={baseline?.segments}
        projectedStops={projectedStops}
        projectedSegments={projectedSegments}
        changedStopIds={changedStopIds}
        stopPairs={stopPairs}
        mergedSegments={mergedSegments}
        editMode={editMode}
        onStopClick={handleStopClick}
        onRemove={handleRemove}
        onMove={handleMove}
        onMapClick={handleMapClick}
        onDeleteLine={handleDeleteLine}
      />

      <EditToolbar
        scenarioName={scenarioName}
        onScenarioNameChange={handleScenarioNameChange}
        onUndo={handleUndo}
        canUndo={canUndo}
        projectedStopCount={projectedStops?.features?.length ?? 0}
        onBulkRandomRemove={handleBulkRandomRemove}
        onSpacingAlgorithm={handleSpacingAlgorithm}
        availableRoutes={availableRoutes}
        baselineSegments={baseline?.segments}
        editMode={editMode}
        onBeginAddStop={handleBeginAddStop}
        onCancelAdd={handleCancelAdd}
      />

      <MetricsPanel
        metrics={metrics}
        scenarioId={scenarioId}
        scenarioName={scenarioName}
        baselineSegments={baseline?.segments}
        projectedSegments={projectedSegments}
      />
    </div>
  )
}
