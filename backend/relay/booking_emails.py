"""Confirmation emails sent after the voice agent books an appointment.

Two emails are sent:
1. To the clinician: client metadata (demographics, insurance, presenting concerns)
   so they can review and recommend a different level of care if needed.
2. To the client: appointment confirmation with date, time, and Meet link.

Uses the shared mailer.py module for Gmail API delivery.
"""
import logging
import sys
from datetime import datetime

from pathlib import Path as _Path
_here = _Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "shared"))  # local dev
sys.path.insert(0, str(_here / "shared"))          # Docker
from mailer import send_email

logger = logging.getLogger(__name__)


async def send_clinician_confirmation(
    clinician_email: str,
    clinician_name: str,
    practice_name: str,
    client_name: str,
    client_email: str,
    scheduled_at: str,
    meet_link: str | None,
    duration_minutes: int,
    transcript: str,
    appointment_id: str | None = None,
    clinician_uid: str | None = None,
) -> None:
    """Send the clinician a confirmation email with client intake metadata.

    This gives the clinician enough information to review the client's presenting
    concerns, insurance status, and demographics before the session — and to
    recommend a different level of care if needed.
    """
    try:
        appt_dt = datetime.fromisoformat(scheduled_at)
        display_date = appt_dt.strftime("%A, %B %d, %Y")
        display_time = appt_dt.strftime("%I:%M %p")
    except (ValueError, TypeError):
        display_date = scheduled_at
        display_time = ""

    # Truncate transcript for email (first 4000 chars should cover key info)
    transcript_preview = transcript[:4000]
    if len(transcript) > 4000:
        transcript_preview += "\n... [transcript truncated]"

    subject = f"New Intake Assessment Booked: {client_name} — {display_date}"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; background: #fafaf9;">
        <div style="background: #0f766e; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">New Intake Assessment Booked</h1>
            <p style="color: #99f6e4; margin: 4px 0 0; font-size: 14px;">{practice_name}</p>
        </div>

        <div style="background: white; padding: 24px; border: 1px solid #e7e5e4; border-top: none;">
            <p style="color: #44403c; margin: 0 0 16px; font-size: 15px;">
                Hi {clinician_name}, a new client has completed their voice intake and booked an initial assessment.
            </p>

            <div style="background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 12px; color: #0f766e; font-size: 15px;">Appointment Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600; width: 120px;">Client</td>
                        <td style="padding: 4px 0; color: #1c1917;">{client_name}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600;">Email</td>
                        <td style="padding: 4px 0; color: #1c1917;"><a href="mailto:{client_email}" style="color: #0f766e;">{client_email}</a></td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600;">Date</td>
                        <td style="padding: 4px 0; color: #1c1917;">{display_date}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600;">Time</td>
                        <td style="padding: 4px 0; color: #1c1917;">{display_time}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600;">Duration</td>
                        <td style="padding: 4px 0; color: #1c1917;">{duration_minutes} minutes</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #57534e; font-weight: 600;">Type</td>
                        <td style="padding: 4px 0; color: #1c1917;">Intake Assessment (90791)</td>
                    </tr>
                    {f'<tr><td style="padding: 4px 0; color: #57534e; font-weight: 600;">Meet Link</td><td style="padding: 4px 0;"><a href="{meet_link}" style="color: #0f766e;">{meet_link}</a></td></tr>' if meet_link else ''}
                </table>
            </div>

            <div style="margin-bottom: 20px;">
                <h3 style="margin: 0 0 8px; color: #44403c; font-size: 15px;">Intake Transcript</h3>
                <p style="color: #78716c; font-size: 13px; margin: 0 0 8px;">
                    Review the client's presenting concerns, insurance status, and demographics below.
                    If a different level of care is recommended, please reach out to the client before the session.
                </p>
                <div style="background: #f6f7f4; border: 1px solid #e8ebe3; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto;">
                    <pre style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #44403c; white-space: pre-wrap; line-height: 1.6;">{transcript_preview}</pre>
                </div>
            </div>

            {f'<p style="font-size: 12px; color: #a8a29e; margin: 16px 0 0;">Appointment ID: {appointment_id}</p>' if appointment_id else ''}
        </div>

        <div style="padding: 16px; text-align: center; border-radius: 0 0 12px 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-top: none;">
            <p style="margin: 0; font-size: 13px; color: #78716c;">Trellis EHR — AI-Powered Practice Management</p>
        </div>
    </div>
    """

    text = f"""New Intake Assessment Booked — {practice_name}

Hi {clinician_name},

A new client has completed their voice intake and booked an initial assessment.

APPOINTMENT DETAILS
Client: {client_name}
Email: {client_email}
Date: {display_date}
Time: {display_time}
Duration: {duration_minutes} minutes
Type: Intake Assessment (90791)
{f'Meet Link: {meet_link}' if meet_link else ''}
{f'Appointment ID: {appointment_id}' if appointment_id else ''}

INTAKE TRANSCRIPT
Review the client's presenting concerns, insurance, and demographics below.
If a different level of care is recommended, please reach out before the session.

{transcript_preview}

---
Trellis EHR — AI-Powered Practice Management
"""

    try:
        await send_email(
            to=clinician_email,
            subject=subject,
            html_body=html,
            text_body=text,
            clinician_uid=clinician_uid,
        )
        # PHI-safe: do not log email addresses or client names
        logger.info("Clinician confirmation email sent successfully")
    except Exception as e:
        logger.error("Failed to send clinician confirmation: %s", type(e).__name__)


async def send_client_confirmation(
    client_email: str,
    client_name: str,
    clinician_name: str,
    practice_name: str,
    scheduled_at: str,
    meet_link: str | None,
    duration_minutes: int,
    clinician_uid: str | None = None,
) -> None:
    """Send the client a confirmation email with appointment details.

    Includes date, time, duration, Meet link, and what to expect.
    """
    try:
        appt_dt = datetime.fromisoformat(scheduled_at)
        display_date = appt_dt.strftime("%A, %B %d, %Y")
        display_time = appt_dt.strftime("%I:%M %p")
    except (ValueError, TypeError):
        display_date = scheduled_at
        display_time = ""

    subject = f"Your Appointment is Confirmed — {display_date} at {display_time}"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; background: #fafaf9;">
        <div style="background: #0f766e; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">Appointment Confirmed</h1>
            <p style="color: #99f6e4; margin: 4px 0 0; font-size: 14px;">{practice_name}</p>
        </div>

        <div style="background: white; padding: 24px; border: 1px solid #e7e5e4; border-top: none;">
            <p style="color: #44403c; margin: 0 0 20px; font-size: 15px;">
                Hi {client_name}, your intake assessment has been scheduled. Here are the details:
            </p>

            <div style="background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 6px 0; color: #57534e; font-weight: 600; width: 120px;">Date</td>
                        <td style="padding: 6px 0; color: #1c1917; font-size: 16px; font-weight: 600;">{display_date}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #57534e; font-weight: 600;">Time</td>
                        <td style="padding: 6px 0; color: #1c1917; font-size: 16px; font-weight: 600;">{display_time}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #57534e; font-weight: 600;">Duration</td>
                        <td style="padding: 6px 0; color: #1c1917;">{duration_minutes} minutes</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #57534e; font-weight: 600;">Clinician</td>
                        <td style="padding: 6px 0; color: #1c1917;">{clinician_name}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #57534e; font-weight: 600;">Format</td>
                        <td style="padding: 6px 0; color: #1c1917;">Video session (Google Meet)</td>
                    </tr>
                </table>

                {f'''
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #ccfbf1;">
                    <a href="{meet_link}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                        Join Video Session
                    </a>
                    <p style="margin: 8px 0 0; font-size: 12px; color: #78716c;">
                        Or copy this link: {meet_link}
                    </p>
                </div>
                ''' if meet_link else ''}
            </div>

            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 8px; color: #92400e; font-size: 14px;">What to Expect</h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #78716c; font-size: 13px; line-height: 1.8;">
                    <li>This is an initial intake assessment ({duration_minutes} minutes)</li>
                    <li>You'll meet with {clinician_name} via video call</li>
                    <li>Please find a quiet, private space for the session</li>
                    <li>Have your insurance card handy if applicable</li>
                    <li>You may receive consent documents to review and sign before the session</li>
                </ul>
            </div>

            <p style="color: #78716c; font-size: 13px; margin: 0;">
                If you need to reschedule or cancel, please log in to your account or contact the practice directly.
            </p>
        </div>

        <div style="padding: 16px; text-align: center; border-radius: 0 0 12px 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-top: none;">
            <p style="margin: 0; font-size: 13px; color: #78716c;">Trellis EHR — AI-Powered Practice Management</p>
        </div>
    </div>
    """

    text = f"""Appointment Confirmed — {practice_name}

Hi {client_name},

Your intake assessment has been scheduled. Here are the details:

Date: {display_date}
Time: {display_time}
Duration: {duration_minutes} minutes
Clinician: {clinician_name}
Format: Video session (Google Meet)
{f'Meet Link: {meet_link}' if meet_link else ''}

WHAT TO EXPECT
- This is an initial intake assessment ({duration_minutes} minutes)
- You'll meet with {clinician_name} via video call
- Please find a quiet, private space for the session
- Have your insurance card handy if applicable
- You may receive consent documents to review and sign before the session

If you need to reschedule or cancel, please log in to your account or contact the practice directly.

---
Trellis EHR — AI-Powered Practice Management
"""

    try:
        await send_email(
            to=client_email,
            subject=subject,
            html_body=html,
            text_body=text,
            clinician_uid=clinician_uid,
        )
        # PHI-safe: do not log email addresses
        logger.info("Client confirmation email sent successfully")
    except Exception as e:
        logger.error("Failed to send client confirmation: %s", type(e).__name__)
