import { useState } from 'react'
import './EditToolbar.css'

function bearingLabel(deg) {
  const labels = ['Northbound','Northeastbound','Eastbound','Southeastbound',
                  'Southbound','Southwestbound','Westbound','Northwestbound']
  return labels[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
}

function getRouteDirections(baselineSegments, routeId) {
  if (!baselineSegments || !routeId) return []
  const dirs = {}
  for (const f of baselineSegments.features) {
    const p = f.properties
    if (String(p.route_id) !== String(routeId)) continue
    const did = p.direction_id
    if (!dirs[did]) dirs[did] = []
    const [[lon1, lat1], [lon2, lat2]] = f.geometry.coordinates
    dirs[did].push(Math.atan2(lon2 - lon1, lat2 - lat1) * 180 / Math.PI)
  }
  return Object.entries(dirs)
    .map(([did, bearings]) => ({
      direction_id: Number(did),
      label: bearingLabel(bearings.reduce((a, b) => a + b, 0) / bearings.length),
    }))
    .sort((a, b) => a.direction_id - b.direction_id)
}

export default function EditToolbar({
  scenarioName,
  onScenarioNameChange,
  onUndo,
  canUndo,
  projectedStopCount,
  onBulkRandomRemove,
  onSpacingAlgorithm,
  availableRoutes,
  selectedRoutes,
  onToggleRoute,
  onSelectAllRoutes,
  onSelectNoRoutes,
  baselineSegments,
  editMode,
  onBeginAddStop,
  onCancelAdd,
  onSetEditMode,
  isPublished,
  onPublish,
  selectedStopIds,
  onClearSelection,
}) {
  const [removeFraction, setRemoveFraction] = useState(0.1)
  const [routeSearch, setRouteSearch] = useState('')
  const [linesExpanded, setLinesExpanded] = useState(true)
  const [applying, setApplying] = useState(false)
  const [spacingMin, setSpacingMin] = useState(350)
  const [spacingMax, setSpacingMax] = useState(400)
  const [spacingApplying, setSpacingApplying] = useState(false)

  const [addRouteType, setAddRouteType] = useState('existing')
  const [addRouteId, setAddRouteId] = useState('')
  const [addDirection, setAddDirection] = useState(null)
  const [addIsTerminus, setAddIsTerminus] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)

  const directions = addRouteType === 'existing'
    ? getRouteDirections(baselineSegments, addRouteId)
    : []

  function handleStartAddFlow() {
    setShowAddPanel(true)
    setAddRouteType('existing')
    setAddRouteId(availableRoutes[0] ?? '')
    setAddDirection(null)
  }

  function handleRouteTypeChange(type) {
    setAddRouteType(type)
    setAddRouteId(type === 'existing' ? (availableRoutes[0] ?? '') : '')
    setAddDirection(null)
    setAddIsTerminus(false)
  }

  function handleRouteChange(routeId) {
    setAddRouteId(routeId)
    setAddDirection(null)
  }

  function handlePlaceOnMap() {
    setShowAddPanel(false)
    onBeginAddStop(addRouteId || null, addDirection, addIsTerminus)
  }

  function handleCancelAddFlow() {
    setShowAddPanel(false)
    if (editMode === 'add') onCancelAdd()
  }

  const canPlace = addRouteId.trim() !== '' &&
    (addRouteType === 'new' || addDirection !== null)

  const removeCount = Math.round(removeFraction * projectedStopCount)

  async function handleApplyRandomRemove() {
    setApplying(true)
    try {
      await onBulkRandomRemove(removeFraction)
    } finally {
      setApplying(false)
    }
  }

  async function handleApplySpacing() {
    setSpacingApplying(true)
    try {
      await onSpacingAlgorithm(spacingMin, spacingMax)
    } finally {
      setSpacingApplying(false)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <label className="sidebar-label">Scenario</label>
        <input
          className="scenario-name"
          value={scenarioName}
          onChange={(e) => onScenarioNameChange(e.target.value)}
          placeholder="Scenario name…"
          aria-label="Scenario name"
        />
        {onPublish && (
          <button
            className={`sidebar-btn publish-btn ${isPublished ? 'published' : ''}`}
            onClick={onPublish}
            style={{ marginTop: 8 }}
          >
            {isPublished ? 'Unpublish' : 'Publish'}
          </button>
        )}
      </div>

      <div className="sidebar-section">
        <button className="sidebar-btn" onClick={onUndo} disabled={!canUndo} title="Undo last edit">
          Undo
        </button>
      </div>

      <div className="sidebar-section">
        <label className="sidebar-label">Selection</label>
        <div className="sidebar-selection-row">
          <button
            className={`sidebar-btn sidebar-btn-select ${editMode === 'box-select' ? 'active' : ''}`}
            onClick={() => onSetEditMode(editMode === 'box-select' ? 'select' : 'box-select')}
            title="Box select stops"
          >⬚ Box</button>
          <button
            className={`sidebar-btn sidebar-btn-select ${editMode === 'lasso-select' ? 'active' : ''}`}
            onClick={() => onSetEditMode(editMode === 'lasso-select' ? 'select' : 'lasso-select')}
            title="Lasso select stops"
          >⌖ Lasso</button>
        </div>
        {selectedStopIds?.size > 0 && (
          <div className="sidebar-selection-info">
            <span className="sidebar-selection-count">{selectedStopIds.size.toLocaleString()} stops selected</span>
            <button className="sidebar-selection-clear" onClick={onClearSelection}>✕</button>
          </div>
        )}
      </div>

      <div className="sidebar-section">
        {editMode === 'add' ? (
          <>
            <div className="sidebar-placing-hint">Click the map to place the stop</div>
            <button className="sidebar-btn" onClick={handleCancelAddFlow}>Cancel</button>
          </>
        ) : !showAddPanel ? (
          <button className="sidebar-btn sidebar-btn-add" onClick={handleStartAddFlow}>
            + Add Stop
          </button>
        ) : (
          <div className="sidebar-add-panel">
            <div className="sidebar-add-panel-title">Add Stop</div>

            <div className="sidebar-add-type-row">
              <button
                className={`sidebar-type-btn ${addRouteType === 'existing' ? 'active' : ''}`}
                onClick={() => handleRouteTypeChange('existing')}
              >Existing line</button>
              <button
                className={`sidebar-type-btn ${addRouteType === 'new' ? 'active' : ''}`}
                onClick={() => handleRouteTypeChange('new')}
              >New line</button>
            </div>

            {addRouteType === 'existing' ? (
              <select
                className="sidebar-route-select"
                value={addRouteId}
                onChange={e => handleRouteChange(e.target.value)}
              >
                {availableRoutes.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            ) : (
              <input
                className="sidebar-route-input"
                type="text"
                placeholder="Route name…"
                value={addRouteId}
                onChange={e => setAddRouteId(e.target.value)}
                autoFocus
              />
            )}

            {addRouteType === 'existing' && directions.length > 0 && (
              <>
                <div className="sidebar-add-sublabel">Direction</div>
                <div className="sidebar-add-type-row">
                  {directions.map(d => (
                    <button
                      key={d.direction_id}
                      className={`sidebar-type-btn ${addDirection === d.direction_id ? 'active' : ''}`}
                      onClick={() => setAddDirection(d.direction_id)}
                    >{d.label}</button>
                  ))}
                </div>
                <label className="sidebar-terminus-row">
                  <input
                    type="checkbox"
                    checked={addIsTerminus}
                    onChange={e => setAddIsTerminus(e.target.checked)}
                  />
                  <span>End stop (connect one side only)</span>
                </label>
              </>
            )}

            <div className="sidebar-add-actions">
              <button
                className="sidebar-btn sidebar-btn-add"
                onClick={handlePlaceOnMap}
                disabled={!canPlace}
              >Place on map</button>
              <button className="sidebar-btn" onClick={handleCancelAddFlow}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section sidebar-lines-section">
        <button className="sidebar-lines-toggle" onClick={() => setLinesExpanded(e => !e)}>
          <span className="sidebar-label">Lines</span>
        </button>
        {linesExpanded && (
          <>
            <div className="sidebar-lines-actions">
              <button className="sidebar-lines-toggle-btn" onClick={onSelectAllRoutes}>All</button>
              <button className="sidebar-lines-toggle-btn" onClick={onSelectNoRoutes}>None</button>
            </div>
            <input
              className="sidebar-route-search"
              type="text"
              placeholder="Search…"
              value={routeSearch}
              onChange={e => setRouteSearch(e.target.value)}
            />
            <div className="sidebar-route-list">
              {availableRoutes
                .filter(r => !routeSearch || r.toLowerCase().includes(routeSearch.toLowerCase()))
                .map(r => (
                  <label key={r} className="sidebar-route-item">
                    <input
                      type="checkbox"
                      checked={selectedRoutes?.has(r) ?? true}
                      onChange={() => onToggleRoute(r)}
                    />
                    <span>{r}</span>
                  </label>
                ))}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <label className="sidebar-label">Bulk Edits</label>
        <div className="sidebar-control-label">Randomly remove stops</div>
        <div className="sidebar-slider-row">
          <input
            type="range"
            className="sidebar-slider"
            min="0"
            max="1"
            step="0.01"
            value={removeFraction}
            onChange={e => setRemoveFraction(parseFloat(e.target.value))}
          />
          <span className="sidebar-slider-value">{Math.round(removeFraction * 100)}%</span>
        </div>
        <div className="sidebar-slider-count">{removeCount.toLocaleString()} stops</div>
        <button
          className="sidebar-btn"
          onClick={handleApplyRandomRemove}
          disabled={applying || removeCount === 0}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>

      <div className="sidebar-bulk-divider" />

      <div className="sidebar-section">
        <div className="sidebar-control-label">Stop spacing algorithm</div>
        <div className="sidebar-control-sublabel">Remove stops where skipping them creates a gap in range:</div>
        <div className="sidebar-threshold-row">
          <input
            type="number"
            className="sidebar-threshold-input"
            min="0"
            step="1"
            value={spacingMin}
            onChange={e => setSpacingMin(Number(e.target.value))}
            aria-label="Min gap m"
          />
          <span className="sidebar-threshold-dash">–</span>
          <input
            type="number"
            className="sidebar-threshold-input"
            min="0"
            step="1"
            value={spacingMax}
            onChange={e => setSpacingMax(Number(e.target.value))}
            aria-label="Max gap m"
          />
          <span className="sidebar-input-unit">m</span>
        </div>
        <button
          className="sidebar-btn"
          onClick={handleApplySpacing}
          disabled={spacingApplying || spacingMin >= spacingMax}
        >
          {spacingApplying ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}
