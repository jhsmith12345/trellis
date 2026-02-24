"""Generate test insurance card images using Nano Banana (Gemini 2.5 Flash Image)."""
import os
from io import BytesIO
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "automations-486317")
REGION = os.getenv("GCP_REGION", "us-central1")
MODEL = "gemini-2.5-flash-image"
ASSETS_DIR = Path(__file__).parent / "assets"

client = genai.Client(vertexai=True, project=PROJECT_ID, location=REGION)

config = types.GenerateContentConfig(
    response_modalities=["IMAGE"],
    image_config=types.ImageConfig(aspect_ratio="3:2"),
)


def generate(prompt: str, filename: str):
    print(f"Generating {filename}...")
    response = client.models.generate_content(model=MODEL, contents=prompt, config=config)
    for part in response.candidates[0].content.parts:
        if part.inline_data is not None:
            img = Image.open(BytesIO(part.inline_data.data))
            out = ASSETS_DIR / filename
            img.save(out)
            print(f"  Saved {out} ({img.size[0]}x{img.size[1]})")
            return
    print(f"  ERROR: No image returned for {filename}")


generate(
    "A photorealistic front of a US health insurance card for BlueCross BlueShield PPO. "
    "Member: Han Smith, Member ID: XYZ123456789, Group: GRP-88421, Effective: 01/01/2026. "
    "Plan name 'Blue PPO Plus', member services phone 1-800-555-0100, "
    "copay info ($25 office visit / $50 specialist / $100 ER). "
    "Clean white card with blue logo and branding. Looks like a real card.",
    "insurance-card-front.png",
)

generate(
    "A photorealistic back of a US health insurance card for BlueCross BlueShield. "
    "Include: Pharmacy Rx BIN 610014, Rx PCN BCBSRX, Rx Group RX4421, "
    "mental health/substance abuse helpline 1-800-555-0200, "
    "claims mailing address PO Box 105187 Atlanta GA 30348, "
    "pre-authorization phone 1-800-555-0300. Standard insurance card back layout.",
    "insurance-card-back.png",
)

print("Done.")
