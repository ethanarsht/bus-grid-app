"""
Generic city prepare script.

Usage:
  python scripts/prepare_city.py --city-id madison_metro --place Madison --country US
  python scripts/prepare_city.py --city-id new_york_mta --place "New York City" --country US --provider-filter MTA --merge-all

Outputs (written to backend/data/):
  {city_id}_stops.geojson
  {city_id}_segments.geojson
  {city_id}_routes.json
"""

import argparse
import csv
import io
import json
import os
import ssl
import sys
import tempfile
import zipfile
from pathlib import Path

import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

_orig = ssl.create_default_context
ssl.create_default_context = lambda *a, cafile=None, **kw: _orig(*a, cafile=cafile or certifi.where(), **kw)  # type: ignore

import requests
import gtfs_segments
from gtfs_segments.mobility import fetch_gtfs_source

DATA_DIR = Path(__file__).parent.parent / "backend" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def process_feed(zip_path: Path) -> tuple[dict[str, str], set[str], object]:
    """Returns (stop_names, bus_route_ids, seg_gdf) for one GTFS zip."""
    stop_names: dict[str, str] = {}
    bus_route_ids: set[str] = set()
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open("stops.txt") as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                stop_names[row["stop_id"]] = row["stop_name"]
        with zf.open("routes.txt") as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                if str(row.get("route_type", "")).strip() == "3":
                    bus_route_ids.add(row["route_id"])
    print(f"  {len(stop_names):,} stops, {len(bus_route_ids)} bus routes")
    print("  Processing segments ...")
    seg_gdf = gtfs_segments.get_gtfs_segments(str(zip_path))
    seg_gdf = seg_gdf[seg_gdf["route_id"].astype(str).isin(bus_route_ids)].reset_index(drop=True)
    return stop_names, bus_route_ids, seg_gdf


def download_zip(url: str, tmpdir: str) -> Path:
    zip_path = Path(tmpdir) / "gtfs.zip"
    print(f"  Downloading ...")
    resp = requests.get(url, allow_redirects=True, timeout=300, verify=certifi.where())
    resp.raise_for_status()
    zip_path.write_bytes(resp.content)
    print(f"  Downloaded {len(resp.content) / 1e6:.1f} MB")
    return zip_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--city-id", required=True)
    parser.add_argument("--place", required=True)
    parser.add_argument("--country", default="US")
    parser.add_argument("--provider-filter", default="")
    parser.add_argument("--merge-all", action="store_true",
                        help="Download and merge ALL providers matching the filter")
    args = parser.parse_args()

    city_id = args.city_id
    stops_out = DATA_DIR / f"{city_id}_stops.geojson"
    segments_out = DATA_DIR / f"{city_id}_segments.geojson"
    routes_out = DATA_DIR / f"{city_id}_routes.json"

    print(f"Fetching GTFS source list for '{args.place}' ({args.country}) ...")
    sources_df = fetch_gtfs_source(place=args.place, country_code=args.country)

    if sources_df is None or sources_df.empty:
        sys.exit(f"No sources found for place='{args.place}'.")

    print(f"  Found {len(sources_df)} source(s):")
    try:
        print(sources_df[["provider", "url"]].to_string())
    except UnicodeEncodeError:
        print(sources_df[["provider"]].to_string().encode("ascii", errors="replace").decode())

    if args.provider_filter:
        mask = sources_df["provider"].str.contains(args.provider_filter, case=False, na=False)
        matched = sources_df[mask] if mask.any() else sources_df.iloc[[0]]
    else:
        matched = sources_df.iloc[[0]]

    if not args.merge_all:
        matched = matched.iloc[[0]]

    print(f"\n  Using {len(matched)} provider(s):")
    for _, r in matched.iterrows():
        print(f"    {r['provider']}")

    # Accumulate across all feeds
    all_stop_names: dict[str, str] = {}
    all_seg_gdfs = []

    for _, feed_row in matched.iterrows():
        url = feed_row["url"]
        print(f"\n--- {feed_row['provider']} ---")
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                zip_path = download_zip(url, tmpdir)
                stop_names, _, seg_gdf = process_feed(zip_path)
                all_stop_names.update(stop_names)
                all_seg_gdfs.append(seg_gdf)
                print(f"  Bus-only segments: {len(seg_gdf):,}")
            except Exception as e:
                print(f"  SKIPPING: {e}")

    if not all_seg_gdfs:
        sys.exit("No segments produced.")

    import pandas as pd
    seg_gdf = pd.concat(all_seg_gdfs, ignore_index=True) if len(all_seg_gdfs) > 1 else all_seg_gdfs[0]
    # Deduplicate segments by (stop_id1, stop_id2, route_id, direction_id)
    if len(all_seg_gdfs) > 1:
        seg_gdf = seg_gdf.drop_duplicates(
            subset=["stop_id1", "stop_id2", "route_id", "direction_id"]
        ).reset_index(drop=True)

    print(f"\nTotal bus-only segments after merge: {len(seg_gdf):,}")

    stops: dict[str, dict] = {}
    for _, row in seg_gdf.iterrows():
        coords = list(row.geometry.coords)
        lon1, lat1 = coords[0][0], coords[0][1]
        lon2, lat2 = coords[-1][0], coords[-1][1]
        for sid, slat, slon in [(str(row["stop_id1"]), lat1, lon1), (str(row["stop_id2"]), lat2, lon2)]:
            if sid not in stops:
                stops[sid] = {"lat": slat, "lon": slon, "name": all_stop_names.get(sid, sid), "routes": []}
            rid = str(row["route_id"])
            if rid not in stops[sid]["routes"]:
                stops[sid]["routes"].append(rid)

    stop_features = [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [v["lon"], v["lat"]]},
         "properties": {"stop_id": sid, "stop_name": v["name"], "routes": v["routes"]}}
        for sid, v in stops.items()
    ]
    with open(stops_out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": stop_features}, f)
    print(f"  Wrote {len(stop_features):,} stops -> {stops_out}")

    dist_col = "distance" if "distance" in seg_gdf.columns else "distance_m"
    segment_features = []
    for i, row in seg_gdf.iterrows():
        coords = list(row.geometry.coords)
        segment_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]},
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
    with open(segments_out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": segment_features}, f)
    print(f"  Wrote {len(segment_features):,} segments -> {segments_out}")

    all_routes = sorted({f["properties"]["route_id"] for f in segment_features})
    with open(routes_out, "w", encoding="utf-8") as f:
        json.dump([{"route_id": r, "short_name": r, "color": "#888888"} for r in all_routes], f, indent=2)
    print(f"  Wrote {len(all_routes)} routes -> {routes_out}")

    print(f"\n=== {city_id} ===")
    print(f"  Stops: {len(stop_features):,} | Segments: {len(segment_features):,} | Routes: {len(all_routes)}")
    print("Done.")


if __name__ == "__main__":
    main()
