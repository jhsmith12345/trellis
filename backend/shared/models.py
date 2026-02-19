"""Shared Pydantic models and enums for the EHR platform."""
from enum import Enum

from pydantic import BaseModel


class UserRole(str, Enum):
    CLINICIAN = "clinician"
    ADMIN = "admin"


class SessionType(str, Enum):
    INTAKE = "intake"
    NOTE = "note"
    RECORD = "record"


class NoteFormat(str, Enum):
    SOAP = "SOAP"
    DAP = "DAP"
    NARRATIVE = "narrative"


class SessionStatus(str, Enum):
    PROCESSING = "processing"
    DRAFT = "draft"
    APPROVED = "approved"
