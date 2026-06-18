import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from backend.database import User, get_db
from backend.auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth")


class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _user_response(user: User, token: str) -> dict:
    return {
        "token": token,
        "user": {
            "user_id": user.user_id,
            "email": user.email,
            "username": user.username,
        }
    }


@router.post("/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = db.query(User).filter(User.email == body.email.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        user_id=str(uuid.uuid4()),
        email=body.email.lower(),
        username=body.username.strip() or body.email.split("@")[0],
        password_hash=hash_password(body.password),
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_response(user, create_access_token(user.user_id))


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _user_response(user, create_access_token(user.user_id))


@router.get("/me")
def me(current_user: User | None = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "user_id": current_user.user_id,
        "email": current_user.email,
        "username": current_user.username,
    }
