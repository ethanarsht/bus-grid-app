"""
Core projection logic: apply a list of StopEdits to the baseline network
and compute delta metrics.
"""

from __future__ import annotations

import copy
import math
from typing import Any

from backend.models import DeltaMetrics, MetricValue, MetricValueInt


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Segment insertion for ADD edits
# ---------------------------------------------------------------------------

def _active_pred(s: str, prev_map: dict, active: set) -> str | None:
    cur = prev_map.get(s)
    while cur and cur not in active:
        cur = prev_map.get(cur)
    return cur

def _active_succ(s: str, next_map: dict, active: set) -> str | None:
    cur = next_map.get(s)
    while cur and cur not in active:
        cur = next_map.get(cur)
    return cur

def _make_seg(s1: str, s2: str, lat1: float, lon1: float,
              lat2: float, lon2: float,
              route_id: str, direction_id: int, traversals: int) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon1, lat1], [lon2, lat2]]},
        "properties": {
            "segment_id": f"{s1}-{s2}-{route_id}",
            "stop_id1": s1,
            "stop_id2": s2,
            "route_id": route_id,
            "direction_id": direction_id,
            "distance_m": haversine_m(lat1, lon1, lat2, lon2),
            "traversals": traversals,
            "added": True,
        },
    }

def _insertion_segments(
    new_id: str, new_lat: float, new_lon: float,
    route_id: str, direction_id: int, is_terminus: bool,
    stops: dict,
    baseline_segments_fc: dict,
) -> tuple[list[dict], set[tuple]]:
    """
    Returns (new_segments, suppressed_keys) where suppressed_keys is a set of
    (route_id, direction_id, stop_id1, stop_id2) tuples for baseline segments
    that should be dropped because the new stop is inserted between them.
    """
    nxt: dict[str, str] = {}
    prv: dict[str, str] = {}
    seg_traversals: dict[tuple, int] = {}

    for feat in baseline_segments_fc["features"]:
        p = feat["properties"]
        if str(p["route_id"]) != str(route_id) or p["direction_id"] != direction_id:
            continue
        s1, s2 = str(p["stop_id1"]), str(p["stop_id2"])
        nxt[s1] = s2
        prv[s2] = s1
        seg_traversals[(s1, s2)] = p.get("traversals", 1)

    if not nxt:
        return [], set()

    chain_stops = set(nxt.keys()) | set(nxt.values())
    active = {s for s in chain_stops if s in stops and s != new_id}
    if not active:
        return [], set()

    nearest = min(active, key=lambda s: haversine_m(
        new_lat, new_lon, stops[s]["lat"], stops[s]["lon"]
    ))
    n = stops[nearest]

    def t(a: str, b: str) -> int:
        return seg_traversals.get((a, b), seg_traversals.get((b, a), 1))

    if is_terminus:
        seg = _make_seg(nearest, new_id, n["lat"], n["lon"], new_lat, new_lon,
                        route_id, direction_id, t(nearest, new_id))
        return [seg], set()

    pred = _active_pred(nearest, prv, active)
    succ = _active_succ(nearest, nxt, active)

    # Only one neighbor — connect and done (no baseline segment to suppress)
    if pred is None and succ is None:
        seg = _make_seg(nearest, new_id, n["lat"], n["lon"], new_lat, new_lon,
                        route_id, direction_id, t(nearest, new_id))
        return [seg], set()

    if pred is None:
        # new stop extends before chain start
        seg = _make_seg(new_id, nearest, new_lat, new_lon, n["lat"], n["lon"],
                        route_id, direction_id, t(new_id, nearest))
        return [seg], set()

    if succ is None:
        # new stop extends after chain end
        seg = _make_seg(nearest, new_id, n["lat"], n["lon"], new_lat, new_lon,
                        route_id, direction_id, t(nearest, new_id))
        return [seg], set()

    # Both neighbors exist — find which consecutive pair to split
    p_stop = stops[pred]
    s_stop = stops[succ]

    cost_pred_side = (haversine_m(new_lat, new_lon, p_stop["lat"], p_stop["lon"]) +
                      haversine_m(new_lat, new_lon, n["lat"], n["lon"]))
    cost_succ_side = (haversine_m(new_lat, new_lon, n["lat"], n["lon"]) +
                      haversine_m(new_lat, new_lon, s_stop["lat"], s_stop["lon"]))

    if cost_pred_side <= cost_succ_side:
        a, b, a_stop, b_stop = pred, nearest, p_stop, n
    else:
        a, b, a_stop, b_stop = nearest, succ, n, s_stop

    traversals = t(a, b)
    segs = [
        _make_seg(a, new_id, a_stop["lat"], a_stop["lon"], new_lat, new_lon,
                  route_id, direction_id, traversals),
        _make_seg(new_id, b, new_lat, new_lon, b_stop["lat"], b_stop["lon"],
                  route_id, direction_id, traversals),
    ]
    suppress = {(str(route_id), direction_id, a, b)}
    return segs, suppress


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _bridge_coords(
    pred: str, succ: str,
    route_id: str, dir_id: int,
    next_stop: dict,
    removed_stop_ids: set,
    seg_coords: dict,
) -> list | None:
    """Walk GTFS coordinates from pred → ... → succ through removed stops."""
    nxt_map = next_stop.get((route_id, dir_id), {})
    coords: list = []
    current = pred
    while True:
        nxt = nxt_map.get(current)
        if nxt is None:
            return None
        sc = seg_coords.get((str(current), str(nxt), str(route_id), dir_id))
        if sc is None:
            return None
        coords = coords + (list(sc) if not coords else list(sc[1:]))
        current = nxt
        if current == succ:
            return coords
        if current not in removed_stop_ids:
            return None


def apply_edits(
    baseline_stops_fc: dict[str, Any],
    baseline_segments_fc: dict[str, Any],
    edits: list[dict],  # each dict has keys: edit_id, op, stop_id, new_lat, new_lon, new_name
) -> tuple[dict[str, Any], dict[str, Any], DeltaMetrics]:
    """
    Returns (projected_stops_fc, projected_segments_fc, delta_metrics).
    """

    # ------------------------------------------------------------------
    # Step 1: Build mutable stops dict from baseline
    # ------------------------------------------------------------------
    stops: dict[str, dict] = {}
    for feat in baseline_stops_fc["features"]:
        p = feat["properties"]
        coords = feat["geometry"]["coordinates"]
        stops[p["stop_id"]] = {
            "lat": coords[1],
            "lon": coords[0],
            "name": p["stop_name"],
            "routes": list(p.get("routes", [])),
        }

    # Track which stop_ids were touched and how
    touched: dict[str, str] = {}  # stop_id → op
    affected_routes: set[str] = set()
    insertion_segments: list[dict] = []
    suppressed_segs: set[tuple] = set()  # (route_id, direction_id, stop_id1, stop_id2)

    # ------------------------------------------------------------------
    # Step 2: Apply edits in seq order (already sorted by caller)
    # ------------------------------------------------------------------
    for edit in edits:
        op = edit["op"]
        sid = edit.get("stop_id")
        if op == "REMOVE":
            if sid and sid in stops:
                for r in stops[sid].get("routes", []):
                    affected_routes.add(r)
                del stops[sid]
                touched[sid] = "REMOVE"
        elif op == "MOVE":
            if sid and sid in stops:
                stops[sid]["lat"] = edit["new_lat"]
                stops[sid]["lon"] = edit["new_lon"]
                for r in stops[sid].get("routes", []):
                    affected_routes.add(r)
                touched[sid] = "MOVE"
        elif op == "ADD":
            new_id = f"new_{edit['edit_id'][:8]}"
            new_routes = edit.get("routes") or []
            direction_id = edit.get("direction_id")
            is_terminus = edit.get("is_terminus", False)
            stops[new_id] = {
                "lat": edit["new_lat"],
                "lon": edit["new_lon"],
                "name": edit.get("new_name") or "New Stop",
                "routes": new_routes,
            }
            touched[new_id] = "ADD"
            for r in new_routes:
                affected_routes.add(r)
            if new_routes and direction_id is not None:
                segs, suppress = _insertion_segments(
                    new_id, edit["new_lat"], edit["new_lon"],
                    new_routes[0], direction_id, is_terminus,
                    stops, baseline_segments_fc,
                )
                insertion_segments.extend(segs)
                suppressed_segs |= suppress

    # ------------------------------------------------------------------
    # Step 3: Build projected segments
    # ------------------------------------------------------------------

    # Pre-compute bridge segments for removed stops.
    #
    # Build per-route forward/backward chains so we can walk past *consecutive*
    # removed stops to find the nearest surviving stop on each side.
    #
    # Algorithm:
    #   For each removed stop that is the FIRST in its gap on a given route
    #   (i.e. its immediate predecessor on that route is not also removed):
    #     - The predecessor is the bridge's start.
    #     - Walk forward until a non-removed stop is found → bridge's end.
    #   If either side is a terminus, no bridge is needed there.
    removed_stop_ids = {sid for sid, op in touched.items() if op == "REMOVE"}

    # Build coordinate lookup early so bridge builder can use it too
    seg_coords: dict[tuple, list] = {}
    for feat in baseline_segments_fc["features"]:
        p = feat["properties"]
        seg_coords[(str(p["stop_id1"]), str(p["stop_id2"]), str(p["route_id"]), p["direction_id"])] = feat["geometry"]["coordinates"]

    bridge_segments: list[dict] = []

    if removed_stop_ids:
        # next_stop[(route,dir)][sid] = next stop on that route
        # prev_stop[(route,dir)][sid] = previous stop on that route
        # in_seg[(route,dir)][sid]    = representative incoming segment feature for sid
        # out_seg[(route,dir)][sid]   = representative outgoing segment feature from sid
        next_stop: dict[tuple, dict[str, str]] = {}
        prev_stop: dict[tuple, dict[str, str]] = {}
        in_seg: dict[tuple, dict[str, dict]] = {}
        out_seg: dict[tuple, dict[str, dict]] = {}

        for feat in baseline_segments_fc["features"]:
            p = feat["properties"]
            key = (p["route_id"], p["direction_id"])
            s1, s2 = p["stop_id1"], p["stop_id2"]
            if key not in next_stop:
                next_stop[key] = {}
                prev_stop[key] = {}
                in_seg[key] = {}
                out_seg[key] = {}
            next_stop[key][s1] = s2
            prev_stop[key][s2] = s1
            if s2 not in in_seg[key]:
                in_seg[key][s2] = feat
            if s1 not in out_seg[key]:
                out_seg[key][s1] = feat

        seen_bridges: set[tuple] = set()

        for removed_sid in removed_stop_ids:
            for key in next_stop:
                nxt = next_stop[key]
                prv = prev_stop[key]

                # Skip routes that don't include this stop at all
                if removed_sid not in nxt and removed_sid not in prv:
                    continue

                # Only handle the gap from its first removed stop
                # (predecessor is non-removed or absent)
                immediate_pred = prv.get(removed_sid)
                if immediate_pred is not None and immediate_pred in removed_stop_ids:
                    continue

                # Walk forward past all consecutive removed stops to find bridge end
                succ = nxt.get(removed_sid)
                while succ is not None and succ in removed_stop_ids:
                    succ = nxt.get(succ)

                # If either side is a terminus, neighbour simply becomes new end — no bridge
                if immediate_pred is None or succ is None:
                    continue

                pred_stop_data = stops.get(immediate_pred)
                succ_stop_data = stops.get(succ)
                if pred_stop_data is None or succ_stop_data is None:
                    continue

                bridge_key = (immediate_pred, succ, key)
                if bridge_key in seen_bridges:
                    continue
                seen_bridges.add(bridge_key)

                dist_m = haversine_m(
                    pred_stop_data["lat"], pred_stop_data["lon"],
                    succ_stop_data["lat"], succ_stop_data["lon"],
                )
                t_in  = in_seg[key].get(removed_sid,  {}).get("properties", {}).get("traversals", 1)
                t_out = out_seg[key].get(removed_sid, {}).get("properties", {}).get("traversals", 1)
                route_id, dir_id = key
                b_coords = _bridge_coords(
                    immediate_pred, succ, route_id, dir_id,
                    next_stop, removed_stop_ids, seg_coords,
                ) or [
                    [pred_stop_data["lon"], pred_stop_data["lat"]],
                    [succ_stop_data["lon"],  succ_stop_data["lat"]],
                ]
                bridge_segments.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": b_coords},
                    "properties": {
                        "segment_id": f"{immediate_pred}-{succ}-{route_id}",
                        "stop_id1": immediate_pred,
                        "stop_id2": succ,
                        "route_id": route_id,
                        "direction_id": dir_id,
                        "distance_m": dist_m,
                        "traversals": (t_in + t_out) // 2,
                        "bridge": True,
                    },
                })

    projected_segments: list[dict] = []

    for feat in baseline_segments_fc["features"]:
        p = feat["properties"]
        sid1, sid2 = str(p["stop_id1"]), str(p["stop_id2"])
        op1 = touched.get(sid1)
        op2 = touched.get(sid2)

        # Drop if either endpoint was removed (bridge_segments covers the gap)
        if op1 == "REMOVE" or op2 == "REMOVE":
            continue

        # Drop if this segment was split by a new stop insertion
        suppress_key = (str(p["route_id"]), p["direction_id"], sid1, sid2)
        if suppress_key in suppressed_segs:
            continue

        # Pass through unchanged if neither endpoint was touched
        if op1 is None and op2 is None:
            projected_segments.append(feat)
            continue

        # Recompute geometry for moved endpoints, preserving intermediate GTFS coords
        stop1 = stops.get(sid1)
        stop2 = stops.get(sid2)
        if stop1 is None or stop2 is None:
            continue

        lat1, lon1 = stop1["lat"], stop1["lon"]
        lat2, lon2 = stop2["lat"], stop2["lon"]
        dist_m = haversine_m(lat1, lon1, lat2, lon2)

        orig_coords = feat["geometry"]["coordinates"]
        if op1 == "MOVE" and op2 == "MOVE":
            coords = [[lon1, lat1]] + orig_coords[1:-1] + [[lon2, lat2]]
        elif op1 == "MOVE":
            coords = [[lon1, lat1]] + orig_coords[1:]
        elif op2 == "MOVE":
            coords = orig_coords[:-1] + [[lon2, lat2]]
        else:
            coords = [[lon1, lat1], [lon2, lat2]]

        projected_segments.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {**p, "distance_m": dist_m},
        })

    projected_segments.extend(bridge_segments)
    projected_segments.extend(insertion_segments)

    # ------------------------------------------------------------------
    # Step 4: Build projected stops FeatureCollection
    # ------------------------------------------------------------------
    projected_stop_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [v["lon"], v["lat"]]},
            "properties": {
                "stop_id": sid,
                "stop_name": v["name"],
                "routes": v["routes"],
            },
        }
        for sid, v in stops.items()
    ]

    projected_stops_fc = {"type": "FeatureCollection", "features": projected_stop_features}
    projected_segments_fc = {"type": "FeatureCollection", "features": projected_segments}

    # ------------------------------------------------------------------
    # Step 5: Compute delta metrics
    # ------------------------------------------------------------------
    metrics = compute_metrics(
        baseline_stops_fc,
        baseline_segments_fc,
        projected_stops_fc,
        projected_segments_fc,
        list(affected_routes),
    )

    return projected_stops_fc, projected_segments_fc, metrics, list(touched.keys())


def compute_metrics(
    baseline_stops_fc: dict,
    baseline_segments_fc: dict,
    projected_stops_fc: dict,
    projected_segments_fc: dict,
    affected_routes: list[str],
) -> DeltaMetrics:
    def _spacing_stats(segments_fc: dict) -> tuple[float, float, float]:
        """Returns (naive_mean_m, traversal_weighted_mean_m, total_km)."""
        segs = [f["properties"] for f in segments_fc["features"]]
        if not segs:
            return 0.0, 0.0, 0.0
        total_dist = sum(s["distance_m"] for s in segs)
        naive_mean = total_dist / len(segs)
        total_traversals = sum(s.get("traversals", 1) for s in segs)
        if total_traversals == 0:
            traversal_weighted = naive_mean
        else:
            traversal_weighted = (
                sum(s["distance_m"] * s.get("traversals", 1) for s in segs)
                / total_traversals
            )
        total_km = total_dist / 1000
        return naive_mean, traversal_weighted, total_km

    b_naive, b_tw, b_km = _spacing_stats(baseline_segments_fc)
    p_naive, p_tw, p_km = _spacing_stats(projected_segments_fc)

    b_stops = len(baseline_stops_fc["features"])
    p_stops = len(projected_stops_fc["features"])

    return DeltaMetrics(
        n_stops=MetricValueInt(baseline=b_stops, projected=p_stops, delta=p_stops - b_stops),
        naive_mean_spacing_m=MetricValue(baseline=round(b_naive, 2), projected=round(p_naive, 2), delta=round(p_naive - b_naive, 2)),
        traversal_weighted_mean_spacing_m=MetricValue(baseline=round(b_tw, 2), projected=round(p_tw, 2), delta=round(p_tw - b_tw, 2)),
        total_network_km=MetricValue(baseline=round(b_km, 3), projected=round(p_km, 3), delta=round(p_km - b_km, 3)),
        affected_routes=affected_routes,
    )
