"""
Module-level cache for the baseline GeoJSON data.
Loaded once at startup, never modified.
"""

import json
import math
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"

_stops_path = _DATA_DIR / "chicago_stops.geojson"
_segments_path = _DATA_DIR / "chicago_segments.geojson"
_routes_path = _DATA_DIR / "chicago_routes.json"


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise RuntimeError(
            f"Data file not found: {path}\n"
            "Run scripts/prepare_chicago.py first to generate the baseline data."
        )
    with open(path) as f:
        return json.load(f)


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Forward bearing in degrees (0 = N, 90 = E, 180 = S, 270 = W)."""
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    return (math.degrees(math.atan2(dlon, dlat)) + 360) % 360


def _bearing_label(b: float) -> str:
    labels = ["Northbound", "Northeastbound", "Eastbound", "Southeastbound",
              "Southbound", "Southwestbound", "Westbound", "Northwestbound"]
    return labels[round(b / 45) % 8]


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _compute_stop_pairs(stops_fc: dict, segs_fc: dict) -> tuple[list[dict], dict[str, str]]:
    """
    Find pairs of stops with the same name that serve the same route in
    opposite directions and are within 300 m of each other.
    Returns (pairs, stop_headings) where stop_headings maps stop_id → heading label.
    """
    # Collect stop metadata
    stop_coords: dict[str, tuple[float, float]] = {}
    stop_names: dict[str, str] = {}
    stop_routes: dict[str, list] = {}
    for feat in stops_fc["features"]:
        p = feat["properties"]
        coords = feat["geometry"]["coordinates"]
        sid = p["stop_id"]
        stop_coords[sid] = (coords[1], coords[0])   # (lat, lon)
        stop_names[sid] = p["stop_name"]
        stop_routes[sid] = list(p.get("routes", []))

    # Per-stop: which (route, direction) combos does it serve?
    # Per-stop outgoing segment bearings for each (route, direction)
    stop_dir_routes: dict[str, set] = {}
    outgoing_bearings: dict[tuple, list[float]] = {}

    for feat in segs_fc["features"]:
        p = feat["properties"]
        sid1, sid2 = p["stop_id1"], p["stop_id2"]
        rid, did = p["route_id"], p["direction_id"]

        stop_dir_routes.setdefault(sid1, set()).add((rid, did))
        stop_dir_routes.setdefault(sid2, set()).add((rid, did))

        if sid1 in stop_coords and sid2 in stop_coords:
            lat1, lon1 = stop_coords[sid1]
            lat2, lon2 = stop_coords[sid2]
            outgoing_bearings.setdefault((sid1, rid, did), []).append(
                _bearing(lat1, lon1, lat2, lon2)
            )

    def get_heading(sid: str, rid: str, did: int) -> str:
        bs = outgoing_bearings.get((sid, rid, did), [])
        if bs:
            return _bearing_label(sum(bs) / len(bs))
        # Terminus: reverse the incoming bearing
        bs_rev = outgoing_bearings.get((sid, rid, 1 - did), [])
        if bs_rev:
            return _bearing_label((sum(bs_rev) / len(bs_rev) + 180) % 360)
        return "Unknown"

    # Group stops by name
    name_groups: dict[str, list[str]] = {}
    for sid, name in stop_names.items():
        name_groups.setdefault(name, []).append(sid)

    MAX_DIST_M = 300
    pairs: list[dict] = []
    seen: set[frozenset] = set()

    for name, sids in name_groups.items():
        if len(sids) < 2:
            continue
        for i in range(len(sids)):
            for j in range(i + 1, len(sids)):
                sid_a, sid_b = sids[i], sids[j]

                la, loa = stop_coords[sid_a]
                lb, lob = stop_coords[sid_b]
                if _haversine_m(la, loa, lb, lob) > MAX_DIST_M:
                    continue

                dirs_a = stop_dir_routes.get(sid_a, set())
                dirs_b = stop_dir_routes.get(sid_b, set())

                shared_routes = {
                    rid for rid, did in dirs_a
                    if (rid, 1 - did) in dirs_b
                }
                if not shared_routes:
                    continue

                fkey = frozenset([sid_a, sid_b])
                if fkey in seen:
                    continue
                seen.add(fkey)

                first_route = sorted(shared_routes)[0]
                if (first_route, 0) in dirs_a:
                    sid_0, sid_1 = sid_a, sid_b
                else:
                    sid_0, sid_1 = sid_b, sid_a

                lat0, lon0 = stop_coords[sid_0]
                lat1, lon1 = stop_coords[sid_1]

                pairs.append({
                    "pair_id": f"{sid_0}-{sid_1}",
                    "stop_name": name,
                    "stop_id_0": sid_0,
                    "stop_id_1": sid_1,
                    "lon_0": lon0, "lat_0": lat0,
                    "lon_1": lon1, "lat_1": lat1,
                    "heading_0": get_heading(sid_0, first_route, 0),
                    "heading_1": get_heading(sid_1, first_route, 1),
                    "routes_0": stop_routes.get(sid_0, []),
                    "routes_1": stop_routes.get(sid_1, []),
                    "shared_routes": sorted(shared_routes),
                    "lon": (lon0 + lon1) / 2,
                    "lat": (lat0 + lat1) / 2,
                })

    # Compute a dominant heading for every stop (used for single-stop popups).
    # Aggregate all outgoing bearings per stop across routes/directions.
    stop_bearings: dict[str, list[float]] = {}
    for (sid, rid, did), bs_list in outgoing_bearings.items():
        stop_bearings.setdefault(sid, []).extend(bs_list)

    all_stop_headings: dict[str, str] = {}
    for sid in stop_coords:
        if sid in stop_bearings:
            all_stop_headings[sid] = _bearing_label(
                sum(stop_bearings[sid]) / len(stop_bearings[sid])
            )
        else:
            # Terminus: reverse any incoming bearing we can find
            for (rid, did) in stop_dir_routes.get(sid, set()):
                bs_rev = outgoing_bearings.get((sid, rid, 1 - did), [])
                if bs_rev:
                    all_stop_headings[sid] = _bearing_label(
                        (sum(bs_rev) / len(bs_rev) + 180) % 360
                    )
                    break

    return pairs, all_stop_headings


def _compute_merged_segments(segs_fc: dict, stop_pairs: list[dict]) -> dict:
    """
    Find bidirectional corridors between adjacent stop pairs.
    A corridor exists when segments run A1→B1 AND B2→A2 (opposite directions)
    where A1/A2 are one pair and B1/B2 are another.

    Side-effect: annotates individual segment features in segs_fc with
    {'merged': True} so the frontend can hide them in favour of the merged line.

    Returns a GeoJSON FeatureCollection of merged segment lines (pair-midpoint
    to pair-midpoint).
    """
    # stop_id → pair dict
    stop_to_pair: dict[str, dict] = {}
    for pair in stop_pairs:
        stop_to_pair[str(pair["stop_id_0"])] = pair
        stop_to_pair[str(pair["stop_id_1"])] = pair

    # Accumulate traversals for each canonical pair-pair corridor
    # canonical key: (min_pair_id, max_pair_id)
    corridors: dict[tuple, dict] = {}

    for feat in segs_fc["features"]:
        p = feat["properties"]
        s1, s2 = str(p["stop_id1"]), str(p["stop_id2"])
        pair1 = stop_to_pair.get(s1)
        pair2 = stop_to_pair.get(s2)
        if pair1 is None or pair2 is None:
            continue
        pid1, pid2 = pair1["pair_id"], pair2["pair_id"]
        if pid1 == pid2:
            continue
        key = (min(pid1, pid2), max(pid1, pid2))
        if key not in corridors:
            corridors[key] = {
                "pair_a": pair1 if pid1 == key[0] else pair2,
                "pair_b": pair2 if pid2 == key[1] else pair1,
                "ab": 0,  # traversals going pair_a → pair_b
                "ba": 0,  # traversals going pair_b → pair_a
            }
        if pid1 == key[0]:
            corridors[key]["ab"] += p.get("traversals", 1)
        else:
            corridors[key]["ba"] += p.get("traversals", 1)

    # Only corridors with traffic in BOTH directions are truly merged
    bidirectional = {k for k, v in corridors.items() if v["ab"] > 0 and v["ba"] > 0}

    # Annotate individual segments that belong to a bidirectional corridor
    for feat in segs_fc["features"]:
        p = feat["properties"]
        s1, s2 = str(p["stop_id1"]), str(p["stop_id2"])
        pair1 = stop_to_pair.get(s1)
        pair2 = stop_to_pair.get(s2)
        if pair1 and pair2 and pair1["pair_id"] != pair2["pair_id"]:
            key = (min(pair1["pair_id"], pair2["pair_id"]),
                   max(pair1["pair_id"], pair2["pair_id"]))
            if key in bidirectional:
                p["merged"] = True

    # Build merged-segment GeoJSON (pair-midpoint → pair-midpoint)
    features = []
    for key in bidirectional:
        c = corridors[key]
        pa, pb = c["pair_a"], c["pair_b"]
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [pa["lon"], pa["lat"]],
                    [pb["lon"], pb["lat"]],
                ],
            },
            "properties": {
                "pair_a_id": key[0],
                "pair_b_id": key[1],
                "traversals": c["ab"] + c["ba"],
            },
        })

    return {"type": "FeatureCollection", "features": features}


baseline_stops_fc: dict = _load_json(_stops_path)
baseline_segments_fc: dict = _load_json(_segments_path)
routes_list: list = _load_json(_routes_path)
baseline_stop_pairs, _stop_headings = _compute_stop_pairs(baseline_stops_fc, baseline_segments_fc)

# Annotate each stop feature with its dominant heading direction
for _feat in baseline_stops_fc["features"]:
    _sid = _feat["properties"]["stop_id"]
    _feat["properties"]["heading"] = _stop_headings.get(str(_sid), "")

# Compute merged bidirectional corridor segments (also annotates baseline_segments_fc)
baseline_merged_segments_fc: dict = _compute_merged_segments(baseline_segments_fc, baseline_stop_pairs)
