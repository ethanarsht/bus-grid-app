import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Integer, String, DateTime, create_engine, text
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./bus_network.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, nullable=False, unique=True)
    username = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Scenario(Base):
    __tablename__ = "scenarios"

    scenario_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    city_id = Column(String, nullable=False, default="chicago_cta")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    description = Column(String)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=True)
    is_published = Column(Boolean, default=False)


class StopEdit(Base):
    __tablename__ = "stop_edits"

    edit_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scenario_id = Column(String, ForeignKey("scenarios.scenario_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    stop_id = Column(String)
    op = Column(String, nullable=False)
    new_lat = Column(Float)
    new_lon = Column(Float)
    new_name = Column(String)
    is_undone = Column(Boolean, default=False)
    group_id = Column(String, nullable=True)
    routes = Column(String, nullable=True)
    direction_id = Column(Integer, nullable=True)
    is_terminus = Column(Boolean, default=False)


def create_tables():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE stop_edits ADD COLUMN group_id TEXT",
            "ALTER TABLE stop_edits ADD COLUMN routes TEXT",
            "ALTER TABLE stop_edits ADD COLUMN direction_id INTEGER",
            "ALTER TABLE stop_edits ADD COLUMN is_terminus INTEGER DEFAULT 0",
            "ALTER TABLE scenarios ADD COLUMN user_id TEXT REFERENCES users(user_id)",
            "ALTER TABLE scenarios ADD COLUMN is_published INTEGER DEFAULT 0",
        ]
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
