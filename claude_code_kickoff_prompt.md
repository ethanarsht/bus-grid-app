# Claude Code Kickoff Prompt — Bus Network Editor MVP

Paste this entire prompt as your first message in a Claude Code session.

---

## Project overview

I'm building a web app that lets users edit a city's bus network and see the impact in real time — think Dave's Redistricting App but for transit. The v1 MVP is scoped tightly:

- **One hardcoded city: Chicago (CTA)**
- **One edit type: stops only** (add, move, remove)
- **Export: GeoJSON snapshot** of the proposed network
- **Metrics: live delta panel** showing how edits change stop count, total network length, and two spacing statistics vs. the baseline: naive mean spacing and traversal-weighted mean spacing (per Devunuri & Lehe 2024)

## Tech stack — do not deviate without asking

- **Backend:** Python 3.11, FastAPI, SQLite (not Postgres — simpler for local dev, we'll migrate later)
- **Data processing:** `gtfs-segments` Python library
- **Frontend:** React 18, MapLibre GL JS, plain CSS (no Tailwind)
- **Deployment target:** Render (single web service serving both API and static frontend build)

## Project structure to create

```
bus-network-editor/
├── backend/
│   ├── main.py               # FastAPI app
│   ├── database.py           # SQLite setup, SQLAlchemy models
│   ├── models.py             # Pydantic schemas
│   ├── routes/
│   │   ├── network.py        # GET /network — serve baseline GeoJSON
│   │   └── scenarios.py      # CRUD for scenarios + edits
│   ├── services/
│   │   └── projection.py     # Core logic: apply edits → projected network
│   └── data/
│       └── (Chicago GTFS will be processed and stored here as GeoJSON)
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── Map.jsx       # MapLibre GL map, stop/segment layers
│   │   │   ├── EditToolbar.jsx
│   │   │   └── MetricsPanel.jsx
│   │   └── api.js            # fetch wrappers
│   ├── index.html
│   └── package.json
├── scripts/
│   └── prepare_chicago.py    # One-time: GTFS → GeoJSON preprocessing
├── Dockerfile
├── render.yaml
└── README.md
```

## Data model

### SQLite tables (create these via SQLAlchemy)

**scenarios**
- `scenario_id` TEXT PRIMARY KEY (uuid)
- `name` TEXT NOT NULL
- `city_id` TEXT NOT NULL DEFAULT 'chicago_cta'
- `created_at` TIMESTAMP DEFAULT now
- `description` TEXT

**stop_edits**
- `edit_id` TEXT PRIMARY KEY (uuid)
- `scenario_id` TEXT REFERENCES scenarios
- `seq` INTEGER NOT NULL  ← ordering for undo/redo
- `stop_id` TEXT  ← null for ADD operations
- `op` TEXT NOT NULL  ← 'ADD' | 'MOVE' | 'REMOVE'
- `new_lat` REAL  ← required for ADD and MOVE
- `new_lon` REAL  ← required for ADD and MOVE
- `new_name` TEXT  ← optional, for ADD only
- `is_undone` BOOLEAN DEFAULT FALSE  ← soft delete for redo support

### Immutable baseline data (files on disk, not in DB)

After running `scripts/prepare_chicago.py`, these files exist in `backend/data/`:
- `chicago_stops.geojson` — GeoJSON FeatureCollection, each feature is a stop point with properties: `stop_id`, `stop_name`, `routes` (array of route_ids)
- `chicago_segments.geojson` — GeoJSON FeatureCollection, each feature is a LineString segment with properties: `segment_id`, `stop_id1`, `stop_id2`, `route_id`, `direction_id`, `distance_m`, `traversals` (integer — number of times this segment is traversed on the busiest day, taken directly from the `gtfs-segments` output)
- `chicago_routes.json` — array of `{route_id, short_name, color}`

These files are loaded into memory at startup and never modified.

## API endpoints to implement

```
GET  /api/network/baseline
     → returns chicago_stops.geojson + chicago_segments.geojson merged

POST /api/scenarios
     body: {name, description?}
     → creates scenario, returns scenario_id

GET  /api/scenarios/{scenario_id}
     → returns scenario metadata + all active (non-undone) edits

POST /api/scenarios/{scenario_id}/edits
     body: {stop_id?, op, new_lat?, new_lon?, new_name?}
     → appends StopEdit with next seq value, returns updated projected network + delta metrics

DELETE /api/scenarios/{scenario_id}/edits/last
     → sets is_undone=TRUE on highest active seq, returns updated projected network + delta metrics

GET  /api/scenarios/{scenario_id}/projection
     → returns projected network GeoJSON + delta metrics

GET  /api/scenarios/{scenario_id}/export
     → returns GeoJSON file download of projected network
```

## Projection logic (implement in services/projection.py)

This is the most important piece. Given a list of active StopEdits, produce a projected network:

1. Start with a copy of baseline stops dict (`stop_id → {lat, lon, name, routes}`)
2. Apply edits in seq order:
   - `REMOVE`: delete the stop from the dict
   - `MOVE`: update lat/lon for that stop_id
   - `ADD`: insert a new entry with a generated stop_id like `new_<edit_id[:8]>`
3. Find affected segments: any segment in baseline where `stop_id1` or `stop_id2` was touched
4. For affected segments:
   - If either endpoint was REMOVED: drop the segment from the projection
   - If either endpoint was MOVED or ADDed: recalculate segment geometry as a straight LineString between the two stop coordinates, recalculate `distance_m` using the Haversine formula
5. Unaffected segments pass through unchanged from baseline
6. Return as two GeoJSON FeatureCollections (stops + segments)

## Delta metrics (compute alongside projection)

Compare projected network vs. baseline:

```python
{
  "n_stops": {"baseline": int, "projected": int, "delta": int},
  "naive_mean_spacing_m": {"baseline": float, "projected": float, "delta": float},
  "traversal_weighted_mean_spacing_m": {"baseline": float, "projected": float, "delta": float},
  "total_network_km": {"baseline": float, "projected": float, "delta": float},
  "affected_routes": [route_id, ...]  # routes that had at least one edit
}
```

**Naive mean spacing** = simple mean of all segment `distance_m` values across the
network (every segment counts equally regardless of frequency):
```python
naive_mean = sum(s.distance_m for s in segments) / len(segments)
```

**Traversal-weighted mean spacing** = mean weighted by the number of times each
segment is traversed on the busiest day (per Devunuri & Lehe 2024). Segments on
high-frequency routes count proportionally more, reflecting the spacing that a
typical bus trip actually experiences:
```python
traversal_weighted_mean = (
    sum(s.distance_m * s.traversals for s in segments)
    / sum(s.traversals for s in segments)
)
```

When a segment is dropped (REMOVE edit) or recomputed (MOVE/ADD), carry its
`traversals` value forward from the baseline unchanged — traversal counts come
from the schedule, not the geometry, so they are unaffected by stop position edits.
For newly ADDed stops that create a brand-new segment with no baseline counterpart,
set `traversals = 1` as a conservative default and leave a `# TODO:` comment.

**Total network km** = sum of all segment `distance_m` / 1000.

## Frontend components

### Map.jsx
- MapLibre GL map centered on Chicago (lng: -87.6298, lat: 41.8781, zoom: 11)
- Use a free base map: `https://demotiles.maplibre.org/style.json` for now (swap for Stadia or Maptiler later)
- Two layers:
  - `segments-layer`: LineString features, colored by route_id, width 2px, opacity 0.7
  - `stops-layer`: Circle features, radius 5px, color white, stroke 2px colored by first route
- In "projected" mode, show a second set of layers (`projected-segments`, `projected-stops`) with dashed/highlighted styling to show the diff
- Click on a stop → show popup with stop name, routes, and action buttons (Remove, Move)

### EditToolbar.jsx
- Three buttons: "Remove stop" (active when stop is selected), "Add stop" (click-to-place mode), "Undo"
- Current edit mode indicator
- Scenario name (editable inline)

### MetricsPanel.jsx
- Fixed panel, bottom-right
- Shows four delta metrics with colored +/- indicators:
  - Stop count (Δ)
  - Naive mean spacing in meters (Δ) — labeled "Mean spacing"
  - Traversal-weighted mean spacing in meters (Δ) — labeled "Weighted mean spacing†" with a footnote: "†Weighted by daily traversals per segment (Devunuri & Lehe 2024)"
  - Total network length in km (Δ)
- Green = more coverage/shorter spacing, red = less coverage/longer spacing
- "Export GeoJSON" button
- "Copy share link" button (copies `?scenario=<uuid>` URL to clipboard)

## Preprocessing script (scripts/prepare_chicago.py)

This script runs once before the app starts. It should:

1. Download the latest Chicago CTA GTFS from Mobility Data using `gtfs_segments.fetch_gtfs_source(place='Chicago')` then `gtfs_segments.download_latest_data()`
2. Run `gtfs_segments.get_gtfs_segments()` on the downloaded zip
3. Export stops to `chicago_stops.geojson` and segments to `chicago_segments.geojson` in the format described above
4. Print summary stats when done (n stops, n segments, n routes)

## Dockerfile

Single-stage build that:
1. Installs Python deps + runs `pip install gtfs-segments fastapi uvicorn sqlalchemy`
2. Builds the React frontend (`npm ci && npm run build`)
3. FastAPI serves the React build from `/` and the API from `/api`
4. `CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "10000"]`

## render.yaml

```yaml
services:
  - type: web
    name: bus-network-editor
    runtime: docker
    plan: free
    envVars:
      - key: PORT
        value: 10000
```

## What to build in this session

Please build the complete project in this order:

1. Create the full directory structure and all config files (package.json, pyproject.toml or requirements.txt, Dockerfile, render.yaml)
2. Write `scripts/prepare_chicago.py` and run it to generate the GeoJSON data files
3. Implement the full backend (database.py, models.py, projection.py, all API routes)
4. Implement the frontend (App.jsx, Map.jsx, EditToolbar.jsx, MetricsPanel.jsx, api.js)
5. Verify the backend starts with `uvicorn backend.main:app --reload` and the key endpoints return sensible data
6. Verify the frontend builds with `npm run build`

Do not add features beyond what's specified. If you hit an ambiguity, make the simpler choice and leave a `# TODO:` comment.

## Known gotchas to watch for

- `gtfs-segments` requires `geopandas`, which can be slow to install — pin to a known-good version in requirements
- MapLibre GL requires the map container div to have an explicit height — don't leave this implicit or the map won't render
- SQLite doesn't support `RETURNING` in older versions — use `lastrowid` or re-query after insert
- The baseline GeoJSON files can be large (Chicago has ~11,000 stops) — load them once at startup into module-level variables, not on each request
- CORS: FastAPI needs `CORSMiddleware` configured during local development since React dev server runs on a different port
