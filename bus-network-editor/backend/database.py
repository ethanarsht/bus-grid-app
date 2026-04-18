import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Integer, String, DateTime, create_engine, text
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = "sqlite:///./bus_network.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class Scenario(Base):
    __tablename__ = "scenarios"

    scenario_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    city_id = Column(String, nullable=False, default="chicago_cta")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    description = Column(String)


class StopEdit(Base):
    __tablename__ = "stop_edits"

    edit_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scenario_id = Column(String, ForeignKey("scenarios.scenario_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    stop_id = Column(String)           # null for ADD
    op = Column(String, nullable=False)  # ADD | MOVE | REMOVE
    new_lat = Column(Float)
    new_lon = Column(Float)
    new_name = Column(String)
    is_undone = Column(Boolean, default=False)
    group_id = Column(String, nullable=True)
    routes = Column(String, nullable=True)  # JSON-encoded list for ADD edits
    direction_id = Column(Integer, nullable=True)
    is_terminus = Column(Boolean, default=False)


def create_tables():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for col in ("group_id TEXT", "routes TEXT", "direction_id INTEGER", "is_terminus INTEGER DEFAULT 0"):
            try:
                conn.execute(text(f"ALTER TABLE stop_edits ADD COLUMN {col}"))
                conn.commit()
            except Exception:
                pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
