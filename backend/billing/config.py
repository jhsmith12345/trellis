"""Environment-based configuration for the billing service."""
import os

from dotenv import load_dotenv

load_dotenv()

# Cloud SQL
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "trellis")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
)

# CORS: EHR installations that can call the billing service
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

# Stedi (claim submission, ERA, eligibility)
STEDI_API_KEY = os.getenv("STEDI_API_KEY", "")

# Stripe Connect (patient payments)
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# Platform fee charged on patient payments (percentage)
PLATFORM_FEE_PERCENT = float(os.getenv("PLATFORM_FEE_PERCENT", "2.9"))

# Telnyx SMS (centralized — therapists never touch this)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "")

# Cron secret for scheduled endpoints (same pattern as EHR API)
CRON_SECRET = os.getenv("CRON_SECRET", "")
