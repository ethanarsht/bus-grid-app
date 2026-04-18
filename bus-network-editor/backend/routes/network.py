from fastapi import APIRouter
from backend.data_store import (
    baseline_segments_fc,
    baseline_stops_fc,
    baseline_stop_pairs,
    baseline_merged_segments_fc,
)

router = APIRouter()


@router.get("/network/baseline")
def get_baseline():
    """Return the baseline stops, segments, directional stop pairs, and merged corridors."""
    return {
        "stops": baseline_stops_fc,
        "segments": baseline_segments_fc,
        "stop_pairs": baseline_stop_pairs,
        "merged_segments": baseline_merged_segments_fc,
    }
