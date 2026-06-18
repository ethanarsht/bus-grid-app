from fastapi import APIRouter, HTTPException, Query
from backend.data_store import get_city_baseline, available_city_ids, get_city_counts

router = APIRouter()

_CITY_META = {
    "chicago_cta":          {"name": "Chicago",        "description": "Chicago Transit Authority (CTA)"},
    "madison_metro":        {"name": "Madison",         "description": "Metro Transit"},
    "new_york_mta":         {"name": "New York City",   "description": "MTA New York City Transit"},
    "los_angeles_metro":    {"name": "Los Angeles",     "description": "LA Metro"},
    "houston_metro":        {"name": "Houston",         "description": "METRO"},
    "phoenix_valley":       {"name": "Phoenix",         "description": "Valley Metro"},
    "philadelphia_septa":   {"name": "Philadelphia",    "description": "SEPTA"},
    "san_antonio_via":      {"name": "San Antonio",     "description": "VIA Metropolitan Transit"},
    "san_diego_mts":        {"name": "San Diego",       "description": "Metropolitan Transit System (MTS)"},
    "dallas_dart":          {"name": "Dallas",          "description": "Dallas Area Rapid Transit (DART)"},
    "san_jose_vta":         {"name": "San José",        "description": "Santa Clara VTA"},
    "austin_capmetro":      {"name": "Austin",          "description": "Capital Metro"},
    "jacksonville_jta":     {"name": "Jacksonville",    "description": "Jacksonville Transportation Authority"},
    "fort_worth_trinity":   {"name": "Fort Worth",      "description": "Trinity Metro"},
    "columbus_cota":        {"name": "Columbus",        "description": "Central Ohio Transit Authority (COTA)"},
    "charlotte_cats":       {"name": "Charlotte",       "description": "Charlotte Area Transit System (CATS)"},
    "indianapolis_indygo":  {"name": "Indianapolis",    "description": "IndyGo"},
    "san_francisco_muni":   {"name": "San Francisco",   "description": "SFMTA / Muni"},
    "seattle_kcm":          {"name": "Seattle",         "description": "King County Metro"},
    "denver_rtd":           {"name": "Denver",          "description": "Regional Transportation District (RTD)"},
    "nashville_wego":       {"name": "Nashville",       "description": "WeGo Public Transit"},
    "oklahoma_city_embark": {"name": "Oklahoma City",   "description": "EMBARK"},
    "el_paso_sunmetro":     {"name": "El Paso",         "description": "Sun Metro"},
    "washington_dc_wmata":  {"name": "Washington DC",   "description": "WMATA Metrobus"},
    "las_vegas_rtc":        {"name": "Las Vegas",       "description": "RTC Transit"},
    "louisville_tarc":      {"name": "Louisville",      "description": "Transit Authority of River City (TARC)"},
    "memphis_mata":         {"name": "Memphis",         "description": "Memphis Area Transit Authority (MATA)"},
    "portland_trimet":      {"name": "Portland",        "description": "TriMet"},
    "baltimore_mta":        {"name": "Baltimore",       "description": "Maryland Transit Administration (MTA)"},
    "milwaukee_mcts":       {"name": "Milwaukee",       "description": "Milwaukee County Transit System (MCTS)"},
    "albuquerque_abqride":  {"name": "Albuquerque",     "description": "ABQ Ride"},
}

def _city_display_name(city_id: str) -> str:
    return city_id.replace("_", " ").title()


@router.get("/cities")
def get_cities():
    cities = []
    for city_id in available_city_ids():
        meta = _CITY_META.get(city_id)
        counts = get_city_counts(city_id)
        cities.append({
            "city_id": city_id,
            "name": meta["name"] if meta else _city_display_name(city_id),
            "description": meta["description"] if meta else "",
            "type": "official",
            "stop_count": counts["stop_count"],
            "route_count": counts["route_count"],
        })
    return cities


@router.get("/network/baseline")
def get_baseline(city_id: str = Query(default="chicago_cta")):
    data = get_city_baseline(city_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No data found for city '{city_id}'. Run prepare_city.py first.")
    return {
        "stops": data["stops"],
        "segments": data["segments"],
        "stop_pairs": data["stop_pairs"],
        "merged_segments": data["merged_segments"],
    }
