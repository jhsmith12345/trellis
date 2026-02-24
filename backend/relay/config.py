"""Configuration for the relay service."""
import os

from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "trellis-mvp")
REGION = os.getenv("GCP_REGION", "us-central1")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-live-2.5-flash-native-audio")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

# API service URL for relay -> API HTTP calls (scheduling, practice profile)
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")

# Firebase auth — DEV_MODE bypasses JWT verification (same as API service)
DEV_MODE = os.getenv("DEV_MODE", "").lower() in ("1", "true", "yes")
