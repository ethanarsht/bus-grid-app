"""
One-time script: Download Chicago CTA GTFS and convert to GeoJSON data files
for the bus-network-editor backend.

Outputs (written to ../backend/data/):
  chicago_stops.geojson    -- stop points
  chicago_segments.geojson -- route segments as LineStrings (bus only)
  chicago_routes.json      -- route metadata
"""

import csv
import io
import json
import os
import ssl
import sys
import tempfile
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# SSL fix for Windows -- must happen before any network library imports
# ---------------------------------------------------------------------------
import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

_orig_ssl_ctx = ssl.create_default_context

def _patched_ssl_ctx(*args, cafile=None, **kwargs):
    return _orig_ssl_ctx(*args, cafile=cafile or certifi.where(), **kwargs)

ssl.create_default_context = _patched_ssl_ctx  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Now safe to import everything else
# ---------------------------------------------------------------------------
import requests
import gtfs_segments
from gtfs_segments.mobility import fetch_gtfs_source

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "backend" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

STOPS_OUT = DATA_DIR / "chicago_stops.geojson"
SEGMENTS_OUT = DATA_DIR / "chicago_segments.geojson"
ROUTES_OUT = DATA_DIR / "chicago_routes.json"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Fetching Chicago CTA GTFS source list ...")
    sources_df = fetch_gtfs_source(place="Chicago", country_code="US")

    if sources_df.empty:
        sys.exit("No Chicago sources found.")

    print(f"  Found {len(sources_df)} Chicago source(s):")
    print(sources_df[["provider", "url"]].to_string())

    cta_mask = sources_df["provider"].str.contains("CTA|Chicago Transit", case=False, na=False)
    row = sources_df[cta_mask].iloc[0] if cta_mask.any() else sources_df.iloc[0]
    url = row["url"]
    provider = row["provider"]
    print(f"\n  Using: {provider}")
    print(f"  URL:   {url}")

    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = Path(tmpdir) / "gtfs.zip"
        print("\nDownloading GTFS zip ...")
        resp = requests.get(url, allow_redirects=True, timeout=300, verify=certifi.where())
        resp.raise_for_status()
        zip_path.write_bytes(resp.content)
        print(f"  Downloaded {len(resp.content) / 1e6:.1f} MB")

        # Read stop names and bus-only route IDs directly from the zip
        stop_names: dict[str, str] = {}
        bus_route_ids: set[str] = set()
        with zipfile.ZipFile(zip_path) as zf:
            with zf.open("stops.txt") as f:
                for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                    stop_names[row["stop_id"]] = row["stop_name"]
            with zf.open("routes.txt") as f:
                for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                    if str(row.get("route_type", "")).strip() == "3":  # 3 = bus
                        bus_route_ids.add(row["route_id"])
        print(f"  Loaded {len(stop_names):,} stop names, {len(bus_route_ids)} bus routes")

        print("Processing segments with gtfs_segments ...")
        seg_gdf = gtfs_segments.get_gtfs_segments(str(zip_path))

    # Filter to bus routes only (drop L train and any other non-bus)
    seg_gdf = seg_gdf[seg_gdf["route_id"].astype(str).isin(bus_route_ids)].reset_index(drop=True)
    print(f"  Bus-only segment rows: {len(seg_gdf):,}")

    # ------------------------------------------------------------------
    # Build stops dict from segment geometries
    # geometry is a LINESTRING; first coord = stop1, last coord = stop2
    # ------------------------------------------------------------------
    stops: dict[str, dict] = {}

    for _, row in seg_gdf.iterrows():
        coords = list(row.geometry.coords)
        lon1, lat1 = coords[0][0], coords[0][1]
        lon2, lat2 = coords[-1][0], coords[-1][1]
        sid1, sid2 = str(row["stop_id1"]), str(row["stop_id2"])
        rid = str(row["route_id"])

        for sid, slat, slon in [(sid1, lat1, lon1), (sid2, lat2, lon2)]:
            if sid not in stops:
                stops[sid] = {
                    "lat": slat,
                    "lon": slon,
                    "name": stop_names.get(sid, sid),
                    "routes": [],
                }
            if rid not in stops[sid]["routes"]:
                stops[sid]["routes"].append(rid)

    # ------------------------------------------------------------------
    # Write stops GeoJSON
    # ------------------------------------------------------------------
    stop_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [v["lon"], v["lat"]]},
            "properties": {"stop_id": sid, "stop_name": v["name"], "routes": v["routes"]},
        }
        for sid, v in stops.items()
    ]
    with open(STOPS_OUT, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": stop_features}, f)
    print(f"  Wrote {len(stop_features):,} stops -> {STOPS_OUT}")

    # ------------------------------------------------------------------
    # Write segments GeoJSON
    # ------------------------------------------------------------------
    dist_col = "distance" if "distance" in seg_gdf.columns else "distance_m"

    segment_features = []
    for i, row in seg_gdf.iterrows():
        coords = list(row.geometry.coords)
        lon1, lat1 = coords[0][0], coords[0][1]
        lon2, lat2 = coords[-1][0], coords[-1][1]
        segment_features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[lon1, lat1], [lon2, lat2]],
            },
            "properties": {
                "segment_id": str(row.get("segment_id", f"seg_{i}")),
                "stop_id1": str(row["stop_id1"]),
                "stop_id2": str(row["stop_id2"]),
                "route_id": str(row["route_id"]),
                "direction_id": int(row.get("direction_id", 0)),
                "distance_m": float(row[dist_col]),
                "traversals": int(row.get("traversals", 1)),
            },
        })

    with open(SEGMENTS_OUT, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": segment_features}, f)
    print(f"  Wrote {len(segment_features):,} segments -> {SEGMENTS_OUT}")

    # ------------------------------------------------------------------
    # Write routes JSON
    # ------------------------------------------------------------------
    all_routes = sorted({f["properties"]["route_id"] for f in segment_features})
    routes_out = [
        {"route_id": rid, "short_name": rid, "color": "#888888"}
        for rid in all_routes
    ]
    with open(ROUTES_OUT, "w", encoding="utf-8") as f:
        json.dump(routes_out, f, indent=2)
    print(f"  Wrote {len(routes_out):,} routes -> {ROUTES_OUT}")

    print("\n=== Summary ===")
    print(f"  Stops:    {len(stop_features):,}")
    print(f"  Segments: {len(segment_features):,}")
    print(f"  Routes:   {len(routes_out):,}")
    print("Done.")


if __name__ == "__main__":
    main()
