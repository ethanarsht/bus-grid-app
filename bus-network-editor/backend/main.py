from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database import create_tables
from backend.routes import network, scenarios, auth, census

app = FastAPI(title="Bus Network Editor API")

# CORS for local dev (React runs on a different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create DB tables on startup
create_tables()

# API routes
app.include_router(network.router, prefix="/api")
app.include_router(scenarios.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(census.router, prefix="/api")

# Serve the built React frontend (if it exists)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
