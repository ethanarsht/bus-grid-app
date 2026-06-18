"""
Run prepare_city.py for the 30 largest US cities.
Usage: python scripts/prepare_all_cities.py
"""
import subprocess
import sys
from pathlib import Path

CITIES = [
    # (city_id, place, provider_filter)
    ("new_york_mta",         "New York",      "MTA New York City Transit"),
    ("los_angeles_metro",    "Los Angeles",   "Los Angeles County Metro"),
    ("houston_metro",        "Houston",       "Houston"),
    ("phoenix_valley",       "Phoenix",       "Valley Metro"),
    ("philadelphia_septa",   "Philadelphia",  "SEPTA"),
    ("san_antonio_via",      "San Antonio",   "VIA"),
    ("san_diego_mts",        "San Diego",     "San Diego"),
    ("dallas_dart",          "Dallas",        "DART"),
    ("san_jose_vta",         "San Jose",      "Santa Clara"),
    ("austin_capmetro",      "Austin",        "Capital Metro"),
    ("jacksonville_jta",     "Jacksonville",  "Jacksonville"),
    ("fort_worth_trinity",   "Fort Worth",    "Trinity Metro"),
    ("columbus_cota",        "Columbus",      "COTA"),
    ("charlotte_cats",       "Charlotte",     "Charlotte"),
    ("indianapolis_indygo",  "Indianapolis",  "IndyGo"),
    ("san_francisco_muni",   "San Francisco", "San Francisco Municipal"),
    ("seattle_kcm",          "Seattle",       "King County Metro"),
    ("denver_rtd",           "Denver",        "Denver"),
    ("nashville_wego",       "Nashville",     "Nashville"),
    ("oklahoma_city_embark", "Oklahoma City", "Oklahoma City"),
    ("el_paso_sunmetro",     "El Paso",       "El Paso"),
    ("washington_dc_wmata",  "Washington",    "WMATA"),
    ("las_vegas_rtc",        "Las Vegas",     "Las Vegas"),
    ("louisville_tarc",      "Louisville",    "Louisville"),
    ("memphis_mata",         "Memphis",       "Memphis"),
    ("portland_trimet",      "Portland",      "TriMet"),
    ("baltimore_mta",        "Baltimore",     "Maryland Transit"),
    ("milwaukee_mcts",       "Milwaukee",     "Milwaukee"),
    ("albuquerque_abqride",  "Albuquerque",   "Albuquerque"),
]

ROOT = Path(__file__).parent.parent
results = []

for city_id, place, provider_filter in CITIES:
    print(f"\n{'='*60}")
    print(f"Preparing {place} ({city_id}) ...")
    cmd = [sys.executable, "scripts/prepare_city.py",
           "--city-id", city_id,
           "--place", place,
           "--country", "US",
           "--provider-filter", provider_filter]
    try:
        result = subprocess.run(cmd, cwd=str(ROOT), timeout=600)
        success = result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT after 600s")
        success = False
    results.append((city_id, place, success))
    print(f"  {'OK' if success else 'FAILED'}: {place}")

print(f"\n{'='*60}")
print("SUMMARY")
print(f"{'='*60}")
ok  = [(c, p) for c, p, s in results if s]
err = [(c, p) for c, p, s in results if not s]
for city_id, place in ok:
    print(f"  OK      {place:25s} ({city_id})")
for city_id, place in err:
    print(f"  FAILED  {place:25s} ({city_id})")
print(f"\n{len(ok)} succeeded, {len(err)} failed.")
