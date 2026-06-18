"""
Retry script for cities that failed or got wrong providers in the first run.
"""
import subprocess
import sys
from pathlib import Path

# (city_id, place, provider_filter)
# Fixes:
#   NYC:         place "New York City" + filter "NYC Bus Company" (combined bus feed)
#   San Antonio: place "Texas" + filter "VIA Metropolitan"
#   Jacksonville:place "Florida" + filter "Jacksonville"
#   Denver:      keep place "Denver" but fix filter to "Regional Transportation District"
#   Las Vegas:   place "Nevada" + filter "RTC"
#   Indianapolis:place "Indiana" + filter "IndyGo"
#   Washington:  keep place "Washington" + filter "WMATA" (Unicode fix applied to script)
#   Memphis:     place "Tennessee" + filter "Memphis"
#   Baltimore:   place "Maryland" + filter "Maryland Transit"

CITIES = [
    ("new_york_mta",         "New York City",  "NYC Bus Company"),
    ("san_antonio_via",      "Texas",          "VIA Metropolitan"),
    ("jacksonville_jta",     "Florida",        "Jacksonville"),
    ("denver_rtd",           "Denver",         "Regional Transportation District"),
    ("las_vegas_rtc",        "Nevada",         "RTC"),
    ("indianapolis_indygo",  "Indiana",        "IndyGo"),
    ("washington_dc_wmata",  "Washington",     "WMATA"),
    ("memphis_mata",         "Tennessee",      "Memphis"),
    ("baltimore_mta",        "Maryland",       "Maryland Transit"),
]

ROOT = Path(__file__).parent.parent
results = []

for city_id, place, provider_filter in CITIES:
    print(f"\n{'='*60}")
    print(f"Preparing {place} / {city_id} ...")
    cmd = [sys.executable, "scripts/prepare_city.py",
           "--city-id", city_id,
           "--place", place,
           "--country", "US",
           "--provider-filter", provider_filter]
    env = {"PYTHONIOENCODING": "utf-8", "PATH": __import__("os").environ.get("PATH", "")}
    try:
        result = subprocess.run(cmd, cwd=str(ROOT), timeout=600,
                                env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        success = result.returncode == 0
    except subprocess.TimeoutExpired:
        print("  TIMEOUT")
        success = False
    results.append((city_id, place, success))

print(f"\n{'='*60}\nSUMMARY\n{'='*60}")
for city_id, place, success in results:
    print(f"  {'OK    ' if success else 'FAILED'} {place:25s} ({city_id})")
