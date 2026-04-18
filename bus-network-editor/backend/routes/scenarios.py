import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.database import StopEdit, Scenario, get_db
from backend.models import (
    BatchEditRequest,
    CreateEditRequest,
    CreateScenarioRequest,
    EditResponse,
    ProjectionResponse,
    ScenarioResponse,
)
from backend.services.projection import apply_edits
from backend.data_store import baseline_segments_fc, baseline_stops_fc

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_scenario_or_404(scenario_id: str, db: Session) -> Scenario:
    scenario = db.query(Scenario).filter(Scenario.scenario_id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


def _active_edits(scenario_id: str, db: Session) -> list[StopEdit]:
    return (
        db.query(StopEdit)
        .filter(StopEdit.scenario_id == scenario_id, StopEdit.is_undone == False)
        .order_by(StopEdit.seq)
        .all()
    )


def _edit_to_dict(e: StopEdit) -> dict:
    return {
        "edit_id": e.edit_id,
        "op": e.op,
        "stop_id": e.stop_id,
        "new_lat": e.new_lat,
        "new_lon": e.new_lon,
        "new_name": e.new_name,
        "routes": json.loads(e.routes) if e.routes else [],
        "direction_id": e.direction_id,
        "is_terminus": bool(e.is_terminus),
    }


def _build_projection(scenario_id: str, db: Session) -> ProjectionResponse:
    edits = _active_edits(scenario_id, db)
    edit_dicts = [_edit_to_dict(e) for e in edits]
    proj_stops, proj_segs, metrics, changed_stop_ids = apply_edits(
        baseline_stops_fc, baseline_segments_fc, edit_dicts
    )
    return ProjectionResponse(stops=proj_stops, segments=proj_segs, metrics=metrics, changed_stop_ids=changed_stop_ids)


def _edit_response(e: StopEdit) -> EditResponse:
    return EditResponse(
        edit_id=e.edit_id,
        scenario_id=e.scenario_id,
        seq=e.seq,
        stop_id=e.stop_id,
        op=e.op,
        new_lat=e.new_lat,
        new_lon=e.new_lon,
        new_name=e.new_name,
        is_undone=e.is_undone,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/scenarios", status_code=201)
def create_scenario(body: CreateScenarioRequest, db: Session = Depends(get_db)):
    scenario = Scenario(
        scenario_id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        city_id="chicago_cta",
        created_at=datetime.now(timezone.utc),
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return {"scenario_id": scenario.scenario_id}


@router.get("/scenarios/{scenario_id}", response_model=ScenarioResponse)
def get_scenario(scenario_id: str, db: Session = Depends(get_db)):
    scenario = _get_scenario_or_404(scenario_id, db)
    edits = _active_edits(scenario_id, db)
    return ScenarioResponse(
        scenario_id=scenario.scenario_id,
        name=scenario.name,
        city_id=scenario.city_id,
        description=scenario.description,
        edits=[_edit_response(e) for e in edits],
    )


@router.post("/scenarios/{scenario_id}/edits")
def add_edit(scenario_id: str, body: CreateEditRequest, db: Session = Depends(get_db)):
    _get_scenario_or_404(scenario_id, db)

    # Validate op
    if body.op not in ("ADD", "MOVE", "REMOVE"):
        raise HTTPException(status_code=400, detail="op must be ADD, MOVE, or REMOVE")
    if body.op in ("ADD", "MOVE") and (body.new_lat is None or body.new_lon is None):
        raise HTTPException(status_code=400, detail="new_lat and new_lon required for ADD/MOVE")
    if body.op in ("MOVE", "REMOVE") and not body.stop_id:
        raise HTTPException(status_code=400, detail="stop_id required for MOVE/REMOVE")

    # Next seq = max active seq + 1
    existing = _active_edits(scenario_id, db)
    next_seq = (max((e.seq for e in existing), default=0)) + 1

    edit = StopEdit(
        edit_id=str(uuid.uuid4()),
        scenario_id=scenario_id,
        seq=next_seq,
        stop_id=body.stop_id,
        op=body.op,
        new_lat=body.new_lat,
        new_lon=body.new_lon,
        new_name=body.new_name,
        routes=json.dumps(body.routes) if body.routes else None,
        direction_id=body.direction_id,
        is_terminus=body.is_terminus,
        is_undone=False,
    )
    db.add(edit)
    db.commit()

    return _build_projection(scenario_id, db)


@router.post("/scenarios/{scenario_id}/edits/batch")
def add_edits_batch(scenario_id: str, body: BatchEditRequest, db: Session = Depends(get_db)):
    _get_scenario_or_404(scenario_id, db)
    if not body.edits:
        raise HTTPException(status_code=400, detail="edits list is empty")

    existing = _active_edits(scenario_id, db)
    next_seq = (max((e.seq for e in existing), default=0)) + 1
    group_id = str(uuid.uuid4())

    for i, item in enumerate(body.edits):
        if item.op not in ("ADD", "MOVE", "REMOVE"):
            raise HTTPException(status_code=400, detail=f"Invalid op: {item.op}")
        db.add(StopEdit(
            edit_id=str(uuid.uuid4()),
            scenario_id=scenario_id,
            seq=next_seq + i,
            stop_id=item.stop_id,
            op=item.op,
            new_lat=item.new_lat,
            new_lon=item.new_lon,
            new_name=item.new_name,
            is_undone=False,
            group_id=group_id,
        ))

    db.commit()
    return _build_projection(scenario_id, db)


@router.delete("/scenarios/{scenario_id}/edits/last")
def undo_last_edit(scenario_id: str, db: Session = Depends(get_db)):
    _get_scenario_or_404(scenario_id, db)
    edits = _active_edits(scenario_id, db)
    if not edits:
        raise HTTPException(status_code=404, detail="No active edits to undo")

    last = edits[-1]
    if last.group_id:
        # Undo all edits in the same group atomically
        for e in edits:
            if e.group_id == last.group_id:
                e.is_undone = True
    else:
        last.is_undone = True
    db.commit()

    return _build_projection(scenario_id, db)


@router.get("/scenarios/{scenario_id}/projection")
def get_projection(scenario_id: str, db: Session = Depends(get_db)):
    _get_scenario_or_404(scenario_id, db)
    return _build_projection(scenario_id, db)


@router.get("/scenarios/{scenario_id}/export")
def export_scenario(scenario_id: str, db: Session = Depends(get_db)):
    _get_scenario_or_404(scenario_id, db)
    proj = _build_projection(scenario_id, db)
    payload = {
        "type": "FeatureCollection",
        "features": proj.stops["features"] + proj.segments["features"],
    }
    content = json.dumps(payload, indent=2)
    return Response(
        content=content,
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="scenario_{scenario_id[:8]}.geojson"'},
    )
