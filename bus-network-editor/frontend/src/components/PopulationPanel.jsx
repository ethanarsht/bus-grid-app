import { useState } from 'react'
import './PopulationPanel.css'

const fmt = n => n >= 1_000_000
  ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}k`
    : String(n)

export default function PopulationPanel({
  populationStats,
  catchmentRadiusM,
  onCatchmentRadiusChange,
  showCatchment,
  onToggleCatchment,
  hasCensusData,
}) {
  const [inputVal, setInputVal] = useState(String(catchmentRadiusM))

  function handleRadiusInput(e) {
    setInputVal(e.target.value)
    const n = parseInt(e.target.value, 10)
    if (!isNaN(n) && n > 0 && n <= 5000) onCatchmentRadiusChange(n)
  }

  const pct = populationStats ? (populationStats.fraction * 100).toFixed(1) : null
  const baselinePct = 100  // baseline always = full network coverage

  return (
    <div className="pop-panel">
      <div className="pop-panel-header">Population Coverage</div>

      {!hasCensusData ? (
        <div className="pop-panel-empty">
          No census data loaded.<br />
          Run <code>python scripts/download_census.py {'{city_id}'}</code>
        </div>
      ) : (
        <>
          <div className="pop-panel-radius-row">
            <span className="pop-panel-label">Catchment radius</span>
            <div className="pop-panel-radius-input-row">
              <input
                className="pop-panel-input"
                type="number"
                min="50"
                max="5000"
                step="50"
                value={inputVal}
                onChange={handleRadiusInput}
                aria-label="Catchment radius in meters"
              />
              <span className="pop-panel-unit">m</span>
            </div>
          </div>

          {populationStats ? (
            <>
              <div className="pop-gauge-wrap">
                <div className="pop-gauge-bar">
                  <div className="pop-gauge-fill" style={{ width: `${populationStats.fraction * 100}%` }} />
                </div>
                <div className="pop-gauge-label">
                  <span className="pop-gauge-pct">{pct}%</span>
                  <span className="pop-gauge-sub">of area population served</span>
                </div>
              </div>

              <div className="pop-stat-row">
                <span className="pop-stat-label">Served</span>
                <span className="pop-stat-value">{fmt(populationStats.served)}</span>
              </div>
              <div className="pop-stat-row">
                <span className="pop-stat-label">Total (census area)</span>
                <span className="pop-stat-value">{fmt(populationStats.total)}</span>
              </div>
              <div className="pop-stat-row">
                <span className="pop-stat-label">Unserved</span>
                <span className="pop-stat-value pop-stat-unserved">
                  {fmt(populationStats.total - populationStats.served)}
                </span>
              </div>
            </>
          ) : (
            <div className="pop-panel-empty">Computing…</div>
          )}
        </>
      )}

      <div className="pop-panel-actions">
        <button
          className={`pop-overlay-btn ${showCatchment ? 'active' : ''}`}
          onClick={onToggleCatchment}
          disabled={!hasCensusData}
        >
          {showCatchment ? '◉ Hide overlay' : '◎ Show overlay'}
        </button>
      </div>
    </div>
  )
}
