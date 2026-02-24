"""Shared Pydantic models and enums for the Trellis platform."""
from enum import Enum

from pydantic import BaseModel


class UserRole(str, Enum):
    CLINICIAN = "clinician"
    CLIENT = "client"


class EncounterType(str, Enum):
    INTAKE = "intake"
    PORTAL = "portal"
    CLINICAL = "clinical"


class EncounterSource(str, Enum):
    VOICE = "voice"
    FORM = "form"
    CHAT = "chat"
    CLINICIAN = "clinician"


class NoteFormat(str, Enum):
    SOAP = "SOAP"
    DAP = "DAP"
    NARRATIVE = "narrative"
    DISCHARGE = "discharge"


class NoteStatus(str, Enum):
    DRAFT = "draft"
    REVIEW = "review"
    SIGNED = "signed"
    AMENDED = "amended"


class TreatmentPlanStatus(str, Enum):
    DRAFT = "draft"
    REVIEW = "review"
    SIGNED = "signed"
    UPDATED = "updated"
    SUPERSEDED = "superseded"


class AppointmentType(str, Enum):
    ASSESSMENT = "assessment"
    INDIVIDUAL = "individual"
    INDIVIDUAL_EXTENDED = "individual_extended"


class AppointmentStatus(str, Enum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    RELEASED = "released"


class AppointmentCadence(str, Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"


class ReconfirmationResponse(str, Enum):
    CONFIRMED = "confirmed"
    CHANGED = "changed"
    CANCELLED = "cancelled"


class ClientStatus(str, Enum):
    ACTIVE = "active"
    DISCHARGED = "discharged"
    INACTIVE = "inactive"


class PracticeType(str, Enum):
    SOLO = "solo"
    GROUP = "group"


class PracticeRole(str, Enum):
    OWNER = "owner"
    CLINICIAN = "clinician"


class ClinicianStatus(str, Enum):
    ACTIVE = "active"
    INVITED = "invited"
    DEACTIVATED = "deactivated"
