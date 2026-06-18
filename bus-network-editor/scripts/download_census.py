#!/usr/bin/env python3
"""
Download US Census ACS 5-year population data for a city's bus network area.

Saves full census tract polygons with population + density to:
  backend/data/{city_id}_population.geojson

Each feature includes:
  - polygon geometry (for density choropleth overlay)
  - population: total residents (ACS 2022 B01003_001E)
  - area_km2: land area computed from polygon
  - density: people per km²
  - centroid_lng, centroid_lat: centroid for coverage computation

Usage:
  python scripts/download_census.py chicago_cta
  python scripts/download_census.py --all
"""

import json
import math
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import shape

DATA_DIR = Path(__file__).parent.parent / "backend" / "data"

TIGER_API = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services"
    "/TIGERweb/Tracts_Blocks/MapServer/4/query"
)
ACS_API = "https://api.census.gov/data/2022/acs/acs5"


def ring_area_km2(coords, clat: float) -> float:
    R = 6371.0
    lat_km = math.pi * R / 180.0
    lng_km = lat_km * math.cos(math.radians(clat))
    n = len(coords)
    area = 0.0
    for i in range(n - 1):
        x0, y0 = coords[i][0] * lng_km, coords[i][1] * lat_km
        x1, y1 = coords[i + 1][0] * lng_km, coords[i + 1][1] * lat_km
        area += x0 * y1 - x1 * y0
    return abs(area) / 2.0


def polygon_area_km2(geom) -> float:
    """Approximate area in km² — handles Polygon and MultiPolygon."""
    clat = geom.centroid.y
    from shapely.geometry import MultiPolygon, Polygon
    if isinstance(geom, Polygon):
        coords = list(geom.exterior.coords)
        return ring_area_km2(coords, clat) if len(coords) >= 3 else 0.0
    elif isinstance(geom, MultiPolygon):
        return sum(
            ring_area_km2(list(p.exterior.coords), clat)
            for p in geom.geoms
            if len(list(p.exterior.coords)) >= 3
        )
    return 0.0


def get_bbox(city_id: str) -> tuple[float, float, float, float]:
    stops_path = DATA_DIR / f"{city_id}_stops.geojson"
    if not stops_path.exists():
        raise FileNotFoundError(f"No stops file: {stops_path}")
    stops = json.loads(stops_path.read_text())
    lngs = [f["geometry"]["coordinates"][0] for f in stops["features"]]
    lats = [f["geometry"]["coordinates"][1] for f in stops["features"]]
    buf = 0.05
    return min(lngs) - buf, min(lats) - buf, max(lngs) + buf, max(lats) + buf


def get_tracts_in_bbox(west, south, east, north) -> list[dict]:
    params = {
        "geometry": f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "GEOID,STATE,COUNTY,TRACT",
        "returnGeometry": "true",
        "f": "geojson",
        "resultRecordCount": 10000,
    }
    r = requests.get(TIGER_API, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"TIGER API error: {data['error']}")
    return data.get("features", [])


def get_population_for_state_county(state: str, county: str) -> dict[str, int]:
    r = requests.get(
        ACS_API,
        params={
            "get": "B01003_001E",
            "for": "tract:*",
            "in": f"state:{state} county:{county}",
        },
        timeout=60,
    )
    r.raise_for_status()
    rows = r.json()
    h = rows[0]
    pop_i = h.index("B01003_001E")
    state_i = h.index("state")
    county_i = h.index("county")
    tract_i = h.index("tract")
    result: dict[str, int] = {}
    for row in rows[1:]:
        geoid = row[state_i] + row[county_i] + row[tract_i]
        try:
            pop = int(row[pop_i])
        except (TypeError, ValueError):
            pop = 0
        result[geoid] = max(0, pop)
    return result


def download_city(city_id: str) -> None:
    print(f"\n=== {city_id} ===")

    west, south, east, north = get_bbox(city_id)
    print(f"  Bbox: {west:.4f},{south:.4f},{east:.4f},{north:.4f}")

    print("  Fetching tract geometries from TIGER API (layer 4 = 2020 tracts)...")
    tracts = get_tracts_in_bbox(west, south, east, north)
    if not tracts:
        print("  ERROR: no tracts found")
        return
    print(f"  Found {len(tracts)} tracts")

    # Parse GEOIDs, compute centroids and areas
    by_state_county: dict[tuple[str, str], list[str]] = {}
    tract_data: dict[str, dict] = {}  # geoid -> {geometry, centroid_lng, centroid_lat, area_km2}

    for feat in tracts:
        p = feat["properties"]
        geoid = (
            p.get("GEOID")
            or p.get("geoid")
            or (p.get("STATE", "") + p.get("COUNTY", "") + p.get("TRACT", ""))
        )
        if not geoid or len(geoid) < 11:
            continue
        state, county = geoid[:2], geoid[2:5]
        by_state_county.setdefault((state, county), []).append(geoid)

        geom = shape(feat["geometry"])
        centroid = geom.centroid
        area = polygon_area_km2(geom)
        tract_data[geoid] = {
            "geometry": feat["geometry"],
            "centroid_lng": centroid.x,
            "centroid_lat": centroid.y,
            "area_km2": round(area, 4),
        }

    print(f"  State/county groups: {len(by_state_county)}")

    # Fetch population from ACS 2022 5-year estimates
    pop_by_geoid: dict[str, int] = {}
    for (state, county), geoids in by_state_county.items():
        print(f"  ACS: state={state} county={county} ({len(geoids)} tracts)...", end=" ", flush=True)
        try:
            pops = get_population_for_state_county(state, county)
            pop_by_geoid.update(pops)
            print(f"{len(pops)} rows")
        except Exception as e:
            print(f"FAILED: {e}")
        time.sleep(0.2)

    matched = sum(1 for g in tract_data if g in pop_by_geoid)
    print(f"  Population matched: {matched}/{len(tract_data)} tracts")
    if matched == 0:
        sample_tiger = list(tract_data.keys())[:3]
        sample_acs = list(pop_by_geoid.keys())[:3]
        print(f"  Sample TIGER GEOIDs: {sample_tiger}")
        print(f"  Sample ACS GEOIDs:   {sample_acs}")

    # Build output GeoJSON — polygon features with population + density
    features = []
    total_pop = 0
    max_density = 0.0

    for geoid, data in tract_data.items():
        pop = pop_by_geoid.get(geoid, 0)
        area_km2 = data["area_km2"]
        density = round(pop / area_km2, 1) if area_km2 > 0 else 0.0
        max_density = max(max_density, density)
        total_pop += pop
        features.append({
            "type": "Feature",
            "geometry": data["geometry"],
            "properties": {
                "geoid": geoid,
                "population": pop,
                "area_km2": area_km2,
                "density": density,
                "centroid_lng": data["centroid_lng"],
                "centroid_lat": data["centroid_lat"],
            },
        })

    out_fc = {"type": "FeatureCollection", "features": features}
    out_path = DATA_DIR / f"{city_id}_population.geojson"
    out_path.write_text(json.dumps(out_fc))

    print(f"  Saved {len(features)} tract polygons to: {out_path}")
    print(f"  Total population: {total_pop:,}  |  Max density: {max_density:.0f} p/km²")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        print("Available cities:")
        for p in sorted(DATA_DIR.glob("*_stops.geojson")):
            print(f"  {p.stem[: -len('_stops')]}")
        sys.exit(1)

    if sys.argv[1] == "--all":
        cities = [p.stem[: -len("_stops")] for p in sorted(DATA_DIR.glob("*_stops.geojson"))]
        print(f"Downloading census data for {len(cities)} cities...")
        for city_id in cities:
            try:
                download_city(city_id)
            except Exception as e:
                print(f"  SKIPPED {city_id}: {e}")
    else:
        download_city(sys.argv[1])


if __name__ == "__main__":
    main()
