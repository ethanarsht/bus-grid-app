from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class CreateScenarioRequest(BaseModel):
    name: str
    description: Optional[str] = None


class CreateEditRequest(BaseModel):
    stop_id: Optional[str] = None
    op: str  # ADD | MOVE | REMOVE
    new_lat: Optional[float] = None
    new_lon: Optional[float] = None
    new_name: Optional[str] = None
    routes: Optional[list[str]] = None
    direction_id: Optional[int] = None
    is_terminus: bool = False


class BatchEditItem(BaseModel):
    op: str
    stop_id: Optional[str] = None
    new_lat: Optional[float] = None
    new_lon: Optional[float] = None
    new_name: Optional[str] = None


class BatchEditRequest(BaseModel):
    edits: list[BatchEditItem]


# ---------------------------------------------------------------------------
# Response shapes
# ---------------------------------------------------------------------------

class ScenarioResponse(BaseModel):
    scenario_id: str
    name: str
    city_id: str
    description: Optional[str]
    edits: list[EditResponse]


class EditResponse(BaseModel):
    edit_id: str
    scenario_id: str
    seq: int
    stop_id: Optional[str]
    op: str
    new_lat: Optional[float]
    new_lon: Optional[float]
    new_name: Optional[str]
    is_undone: bool


class MetricValue(BaseModel):
    baseline: float
    projected: float
    delta: float


class MetricValueInt(BaseModel):
    baseline: int
    projected: int
    delta: int


class DeltaMetrics(BaseModel):
    n_stops: MetricValueInt
    naive_mean_spacing_m: MetricValue
    traversal_weighted_mean_spacing_m: MetricValue
    total_network_km: MetricValue
    affected_routes: list[str]


class ProjectionResponse(BaseModel):
    stops: dict[str, Any]       # GeoJSON FeatureCollection
    segments: dict[str, Any]    # GeoJSON FeatureCollection
    metrics: DeltaMetrics
    changed_stop_ids: list[str] = []  # stop_ids that were added, moved, or removed
