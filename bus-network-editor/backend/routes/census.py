import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()
_DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/census/{city_id}")
def get_census(city_id: str):
    path = _DATA_DIR / f"{city_id}_population.geojson"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Census data not available for '{city_id}'. "
                "Run: python scripts/download_census.py {city_id}"
            ),
        )
    return json.loads(path.read_text())
