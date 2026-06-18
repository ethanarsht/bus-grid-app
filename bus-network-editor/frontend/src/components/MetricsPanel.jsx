import { useState, useEffect } from 'react'
import { exportUrl } from '../api.js'
import './MetricsPanel.css'

const round2 = v => Math.round(v * 100) / 100
const round3 = v => Math.round(v * 1000) / 1000

function spacingStats(segmentsFC, maxM) {
  let segs = segmentsFC?.features?.map(f => f.properties) ?? []
  if (maxM != null) segs = segs.filter(s => s.distance_m <= maxM)
  if (segs.length === 0) return { naive: 0, weighted: 0, totalKm: 0 }
  const totalDist = segs.reduce((s, x) => s + x.distance_m, 0)
  const naive = totalDist / segs.length
  const totalTraversals = segs.reduce((s, x) => s + (x.traversals ?? 1), 0)
  const weighted = totalTraversals === 0
    ? naive
    : segs.reduce((s, x) => s + x.distance_m * (x.traversals ?? 1), 0) / totalTraversals
  return { naive, weighted, totalKm: totalDist / 1000 }
}

function Delta({ value, unit = '', invert = false }) {
  if (value === undefined || value === null) return null
  const positive = value > 0
  // invert: for spacing metrics, lower is better (green)
  const good = invert ? !positive : positive
  const cls = value === 0 ? 'delta-neutral' : good ? 'delta-good' : 'delta-bad'
  const sign = value > 0 ? '+' : ''
  return (
    <span className={cls}>
      {sign}{value.toFixed(unit === 'km' ? 2 : 1)}{unit}
    </span>
  )
}

function MetricRow({ label, baseline, projected, delta, unit, invert, footnote }) {
  return (
    <div className="metric-row">
      <div className="metric-label">{label}{footnote && <sup>†</sup>}</div>
      <div className="metric-values">
        <span className="metric-baseline">{baseline !== undefined ? `${typeof baseline === 'number' ? baseline.toFixed(unit === 'km' ? 2 : 1) : baseline}${unit}` : '—'}</span>
        <span className="metric-arrow">→</span>
        <span className="metric-projected">{projected !== undefined ? `${typeof projected === 'number' ? projected.toFixed(unit === 'km' ? 2 : 1) : projected}${unit}` : '—'}</span>
        <Delta value={delta} unit={unit} invert={invert} />
      </div>
    </div>
  )
}

function selectionSpacingStats(segments, selectedStopIds) {
  if (!segments?.features) return null
  // selectedStopIds null = use all (route-filtered) segments; non-null = geo intersection
  let segs = segments.features.map(f => f.properties)
  if (selectedStopIds?.size) {
    segs = segs.filter(s => selectedStopIds.has(String(s.stop_id1)) && selectedStopIds.has(String(s.stop_id2)))
  }
  if (segs.length === 0) return { naive: 0, weighted: 0, totalKm: 0, nStops: 0 }
  const stopSet = new Set()
  segs.forEach(s => { stopSet.add(String(s.stop_id1)); stopSet.add(String(s.stop_id2)) })
  const totalDist = segs.reduce((s, x) => s + x.distance_m, 0)
  const naive = totalDist / segs.length
  const totalTrav = segs.reduce((s, x) => s + (x.traversals ?? 1), 0)
  const weighted = totalTrav === 0 ? naive : segs.reduce((s, x) => s + x.distance_m * (x.traversals ?? 1), 0) / totalTrav
  return { naive, weighted, totalKm: totalDist / 1000, nStops: stopSet.size }
}

export default function MetricsPanel({ metrics, scenarioId, scenarioName, baselineSegments, projectedSegments, selectedStopIds, lineFilterActive }) {
  const [maxSegmentKm, setMaxSegmentKm] = useState(null)
  const [activeTab, setActiveTab] = useState('network')

  // Switch to network tab when selection is fully cleared
  useEffect(() => {
    if (!lineFilterActive && !selectedStopIds) setActiveTab('network')
  }, [lineFilterActive, selectedStopIds])

  function handleMaxKmInput(e) {
    const val = e.target.value
    if (val === '') { setMaxSegmentKm(null); return }
    const n = parseFloat(val)
    if (!isNaN(n) && n > 0) setMaxSegmentKm(n)
  }

  let m = metrics

  if (m && maxSegmentKm != null) {
    const maxM = maxSegmentKm * 1000
    const b = spacingStats(baselineSegments, maxM)
    const p = spacingStats(projectedSegments, maxM)
    m = {
      ...m,
      naive_mean_spacing_m: { baseline: round2(b.naive), projected: round2(p.naive), delta: round2(p.naive - b.naive) },
      traversal_weighted_mean_spacing_m: { baseline: round2(b.weighted), projected: round2(p.weighted), delta: round2(p.weighted - b.weighted) },
      total_network_km: { baseline: round3(b.totalKm), projected: round3(p.totalKm), delta: round3(p.totalKm - b.totalKm) },
    }
  }

  function handleExport() {
    if (!scenarioId) return
    window.open(exportUrl(scenarioId), '_blank')
  }

  function handleCopyLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('scenario', scenarioId)
    navigator.clipboard.writeText(url.toString())
  }

  const hasSelection = lineFilterActive || selectedStopIds?.size > 0
  const selBase = hasSelection ? selectionSpacingStats(baselineSegments, selectedStopIds) : null
  const selProj = hasSelection ? selectionSpacingStats(projectedSegments ?? baselineSegments, selectedStopIds) : null

  return (
    <div className="metrics-panel">
      <div className="metrics-header">
        {hasSelection ? (
          <div className="metrics-tabs">
            <button className={`metrics-tab ${activeTab === 'network' ? 'active' : ''}`} onClick={() => setActiveTab('network')}>Network</button>
            <button className={`metrics-tab ${activeTab === 'selection' ? 'active' : ''}`} onClick={() => setActiveTab('selection')}>Selection</button>
          </div>
        ) : 'Metrics'}
      </div>

      {activeTab === 'network' && (
        <>
          <div className="metric-controls">
            <div className="metric-controls-label">Metric Controls</div>
            <div className="metric-controls-row">
              <label className="metric-controls-field-label">Exclude from metrics above</label>
              <div className="metric-controls-input-row">
                <input
                  className="metric-controls-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={maxSegmentKm ?? ''}
                  onChange={handleMaxKmInput}
                  placeholder="none"
                  aria-label="Exclude segments above (km)"
                />
                <span className="metric-controls-unit">km</span>
              </div>
            </div>
          </div>

          {m && (
            <>
              <MetricRow label="Stops" baseline={m.n_stops.baseline} projected={m.n_stops.projected} delta={m.n_stops.delta} unit="" />
              <MetricRow label="Mean spacing" baseline={m.naive_mean_spacing_m.baseline} projected={m.naive_mean_spacing_m.projected} delta={m.naive_mean_spacing_m.delta} unit=" m" invert />
              <MetricRow label="Weighted mean spacing" baseline={m.traversal_weighted_mean_spacing_m.baseline} projected={m.traversal_weighted_mean_spacing_m.projected} delta={m.traversal_weighted_mean_spacing_m.delta} unit=" m" invert footnote />
              <MetricRow label="Total network" baseline={m.total_network_km.baseline} projected={m.total_network_km.projected} delta={m.total_network_km.delta} unit=" km" />
              {m.affected_routes.length > 0 && (
                <div className="affected-routes">Affected routes: {m.affected_routes.join(', ')}</div>
              )}
              <p className="metrics-footnote">†Weighted by daily traversals per segment (Devunuri &amp; Lehe 2024)</p>
            </>
          )}
        </>
      )}

      {activeTab === 'selection' && hasSelection && selBase && (
        <>
          <div className="metrics-selection-label">
            {lineFilterActive && selectedStopIds?.size > 0
              ? `Intersection · ${selBase?.nStops?.toLocaleString() ?? 0} stops`
              : selectedStopIds?.size > 0
                ? `${selectedStopIds.size.toLocaleString()} stops selected`
                : 'Route-filtered network'}
          </div>
          <MetricRow label="Stops (with segments)" baseline={selBase.nStops} projected={selProj?.nStops} delta={(selProj?.nStops ?? selBase.nStops) - selBase.nStops} unit="" />
          <MetricRow label="Mean spacing" baseline={round2(selBase.naive)} projected={round2(selProj?.naive ?? selBase.naive)} delta={round2((selProj?.naive ?? selBase.naive) - selBase.naive)} unit=" m" invert />
          <MetricRow label="Weighted mean spacing" baseline={round2(selBase.weighted)} projected={round2(selProj?.weighted ?? selBase.weighted)} delta={round2((selProj?.weighted ?? selBase.weighted) - selBase.weighted)} unit=" m" invert footnote />
          <MetricRow label="Total network" baseline={round3(selBase.totalKm)} projected={round3(selProj?.totalKm ?? selBase.totalKm)} delta={round3((selProj?.totalKm ?? selBase.totalKm) - selBase.totalKm)} unit=" km" />
          <p className="metrics-footnote">†Weighted by daily traversals per segment (Devunuri &amp; Lehe 2024)</p>
        </>
      )}

      <div className="metrics-actions">
        <button onClick={handleExport} disabled={!scenarioId}>Export GeoJSON</button>
        <button onClick={handleCopyLink} disabled={!scenarioId}>Copy share link</button>
      </div>
    </div>
  )
}
