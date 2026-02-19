"""Configuration for the relay service."""
import os

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "automations-486317")
REGION = os.getenv("GCP_REGION", "us-central1")
GCS_BUCKET = os.getenv("GCS_BUCKET", f"{PROJECT_ID}-audio")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-live-2.5-flash-native-audio")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
