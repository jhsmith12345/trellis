"""Business development alerts for new client intake."""
import logging
import os
from datetime import datetime, timezone

from mailer import send_email

logger = logging.getLogger(__name__)

BD_EMAIL = os.getenv("BD_ALERT_EMAIL", "dummy_bd@stagesofrecovery.net")


def notify_bd_new_intake(
    client_name: str,
    source: str,
    transcript: str,
    data: dict | None = None,
    encounter_id: str | None = None,
):
    """Send a BD alert email when a new intake is completed.

    Args:
        client_name: Client's name
        source: "voice" or "form"
        transcript: The full intake transcript/text
        data: Optional structured intake data (from form submissions)
        encounter_id: Optional encounter ID for reference
    """
    now = datetime.now(timezone.utc).strftime("%B %d, %Y at %I:%M %p UTC")
    source_label = "Voice Intake" if source == "voice" else "Written Form"

    # Build structured info section from data if available
    info_rows = ""
    if data:
        demo = data.get("demographics", {})
        history = data.get("history", {})

        fields = [
            ("Preferred Name", demo.get("preferredName")),
            ("Pronouns", demo.get("pronouns")),
            ("Date of Birth", demo.get("dateOfBirth")),
        ]

        ec = demo.get("emergencyContact", {})
        if ec.get("name"):
            fields.append(("Emergency Contact", f"{ec['name']} ({ec.get('relationship', 'N/A')}) — {ec.get('phone', 'N/A')}"))

        fields.extend([
            ("Presenting Concerns", data.get("presentingConcerns")),
            ("Prior Therapy", "Yes" if history.get("priorTherapy") else "No" if history.get("priorTherapy") is False else None),
            ("Prior Therapy Details", history.get("priorTherapyDetails")),
            ("Medications", history.get("medications")),
            ("Medical Conditions", history.get("medicalConditions")),
            ("Goals", data.get("goals")),
            ("Additional Notes", data.get("additionalNotes")),
        ])

        for label, value in fields:
            if value:
                info_rows += f"""
                <tr>
                    <td style="padding: 8px 12px; font-weight: 600; color: #57534e; vertical-align: top; width: 160px;">{label}</td>
                    <td style="padding: 8px 12px; color: #1c1917;">{value}</td>
                </tr>"""

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf9; padding: 24px;">
        <div style="background: #0f766e; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">New Client Intake</h1>
            <p style="color: #99f6e4; margin: 4px 0 0; font-size: 14px;">{now}</p>
        </div>

        <div style="background: white; padding: 24px; border: 1px solid #e7e5e4; border-top: none;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                <tr>
                    <td style="padding: 8px 12px; font-weight: 600; color: #57534e;">Client Name</td>
                    <td style="padding: 8px 12px; color: #1c1917; font-size: 16px; font-weight: 600;">{client_name}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 12px; font-weight: 600; color: #57534e;">Source</td>
                    <td style="padding: 8px 12px;">
                        <span style="background: {'#ccfbf1' if source == 'voice' else '#e8ebe3'}; color: {'#0f766e' if source == 'voice' else '#4a5440'}; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 500;">{source_label}</span>
                    </td>
                </tr>
                {info_rows}
            </table>

            <div style="margin-top: 20px; padding: 16px; background: #f6f7f4; border-radius: 8px; border: 1px solid #e8ebe3;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #57534e; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                    {'Transcript' if source == 'voice' else 'Intake Summary'}
                </p>
                <p style="margin: 0; color: #44403c; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{transcript[:3000]}{'...' if len(transcript) > 3000 else ''}</p>
            </div>

            {f'<p style="margin: 16px 0 0; font-size: 12px; color: #a8a29e;">Encounter ID: {encounter_id}</p>' if encounter_id else ''}
        </div>

        <div style="padding: 16px; text-align: center; border-radius: 0 0 12px 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-top: none;">
            <p style="margin: 0; font-size: 13px; color: #78716c;">Trellis — AI-Native Behavioral Health</p>
        </div>
    </div>
    """

    text = f"""New Client Intake — {now}

Client: {client_name}
Source: {source_label}

{transcript[:3000]}

{'Encounter ID: ' + encounter_id if encounter_id else ''}
---
Trellis — AI-Native Behavioral Health
"""

    try:
        send_email(
            to=BD_EMAIL,
            subject=f"New Intake: {client_name} ({source_label})",
            html_body=html,
            text_body=text,
        )
    except Exception:
        # PHI-safe: do not log client_name
        logger.error("BD alert failed (encounter %s)", encounter_id)
