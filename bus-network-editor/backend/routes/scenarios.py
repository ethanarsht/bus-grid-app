import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.database import StopEdit, Scenario, User, get_db
from backend.auth import get_current_user, require_user
from backend.models import (
    BatchEditRequest,
    CreateEditRequest,
    CreateScenarioRequest,
    EditResponse,
    ProjectionResponse,
    ScenarioResponse,
)
from backend.services.projection import apply_edits
from backend.data_store import get_city_baseline

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_scenario_or_404(scenario_id: str, db: Session) -> Scenario:
    scenario = db.query(Scenario).filter(Scenario.scenario_id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


def _require_owner(scenario: Scenario, current_user: User | None):
    if scenario.user_id and (not current_user or current_user.user_id != scenario.user_id):
        raise HTTPException(status_code=403, detail="Not your scenario")


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
    scenario = db.query(Scenario).filter(Scenario.scenario_id == scenario_id).first()
    city_id = scenario.city_id if scenario else "chicago_cta"
    city_data = get_city_baseline(city_id) or get_city_baseline("chicago_cta") or {}
    stops_fc = city_data.get("stops", {"type": "FeatureCollection", "features": []})
    segs_fc = city_data.get("segments", {"type": "FeatureCollection", "features": []})
    edits = _active_edits(scenario_id, db)
    edit_dicts = [_edit_to_dict(e) for e in edits]
    proj_stops, proj_segs, metrics, changed_stop_ids = apply_edits(
        stops_fc, segs_fc, edit_dicts
    )
    return ProjectionResponse(
        stops=proj_stops, segments=proj_segs, metrics=metrics,
        changed_stop_ids=changed_stop_ids,
        name=scenario.name if scenario else None,
        is_published=bool(scenario.is_published) if scenario else False,
    )


def _scenario_summary(s: Scenario, db: Session) -> dict:
    author = None
    if s.user_id:
        user = db.query(User).filter(User.user_id == s.user_id).first()
        author = user.username if user else None
    return {
        "scenario_id": s.scenario_id,
        "name": s.name,
        "city_id": s.city_id,
        "description": s.description,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "is_published": bool(s.is_published),
        "author": author,
    }


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

@router.get("/scenarios")
def list_scenarios(
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return []
    scenarios = (
        db.query(Scenario)
        .filter(Scenario.user_id == current_user.user_id)
        .order_by(Scenario.created_at.desc())
        .all()
    )
    return [_scenario_summary(s, db) for s in scenarios]


@router.get("/scenarios/published")
def list_published_scenarios(db: Session = Depends(get_db)):
    scenarios = (
        db.query(Scenario)
        .filter(Scenario.is_published == True)
        .order_by(Scenario.created_at.desc())
        .all()
    )
    return [_scenario_summary(s, db) for s in scenarios]


@router.post("/scenarios", status_code=201)
def create_scenario(
    body: CreateScenarioRequest,
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scenario = Scenario(
        scenario_id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        city_id=body.city_id or "chicago_cta",
        user_id=current_user.user_id if current_user else None,
        is_published=False,
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
def add_edit(
    scenario_id: str,
    body: CreateEditRequest,
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scenario = _get_scenario_or_404(scenario_id, db)
    _require_owner(scenario, current_user)

    if body.op not in ("ADD", "MOVE", "REMOVE"):
        raise HTTPException(status_code=400, detail="op must be ADD, MOVE, or REMOVE")
    if body.op in ("ADD", "MOVE") and (body.new_lat is None or body.new_lon is None):
        raise HTTPException(status_code=400, detail="new_lat and new_lon required for ADD/MOVE")
    if body.op in ("MOVE", "REMOVE") and not body.stop_id:
        raise HTTPException(status_code=400, detail="stop_id required for MOVE/REMOVE")

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
def add_edits_batch(
    scenario_id: str,
    body: BatchEditRequest,
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scenario = _get_scenario_or_404(scenario_id, db)
    _require_owner(scenario, current_user)
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
def undo_last_edit(
    scenario_id: str,
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scenario = _get_scenario_or_404(scenario_id, db)
    _require_owner(scenario, current_user)
    edits = _active_edits(scenario_id, db)
    if not edits:
        raise HTTPException(status_code=404, detail="No active edits to undo")

    last = edits[-1]
    if last.group_id:
        for e in edits:
            if e.group_id == last.group_id:
                e.is_undone = True
    else:
        last.is_undone = True
    db.commit()

    return _build_projection(scenario_id, db)


@router.patch("/scenarios/{scenario_id}")
def update_scenario(
    scenario_id: str,
    body: dict,
    current_user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scenario = _get_scenario_or_404(scenario_id, db)
    _require_owner(scenario, current_user)
    if "name" in body:
        scenario.name = body["name"]
    db.commit()
    return {"scenario_id": scenario.scenario_id, "name": scenario.name}


@router.post("/scenarios/{scenario_id}/publish")
def publish_scenario(
    scenario_id: str,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    scenario = _get_scenario_or_404(scenario_id, db)
    _require_owner(scenario, current_user)
    scenario.is_published = not scenario.is_published
    db.commit()
    return {"scenario_id": scenario.scenario_id, "is_published": scenario.is_published}


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
