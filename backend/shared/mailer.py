"""Email sending via Gmail API with service account domain-wide delegation."""
import base64
import logging
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

from google.oauth2 import service_account
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

SA_KEY_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "sa-key.json")
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "ai.agent@stagesofrecovery.net")
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

# SA key JSON can be provided as env var (base64-encoded) for Cloud Run
SA_KEY_JSON = os.getenv("SA_KEY_JSON", "")


def _get_gmail_service():
    """Build Gmail API service with delegated credentials.

    Loads SA credentials from: SA_KEY_JSON env var (Cloud Run),
    or sa-key.json file (local dev).
    """
    if SA_KEY_JSON:
        import json
        import base64
        key_data = json.loads(base64.b64decode(SA_KEY_JSON))
        creds = service_account.Credentials.from_service_account_info(
            key_data, scopes=SCOPES
        )
    else:
        creds = service_account.Credentials.from_service_account_file(
            SA_KEY_PATH, scopes=SCOPES
        )
    delegated = creds.with_subject(SENDER_EMAIL)
    return build("gmail", "v1", credentials=delegated, cache_discovery=False)


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None):
    """Send an email via Gmail API.

    Args:
        to: Recipient email address
        subject: Email subject line
        html_body: HTML body content
        text_body: Optional plain-text fallback
    """
    msg = MIMEMultipart("alternative")
    msg["To"] = to
    msg["From"] = SENDER_EMAIL
    msg["Subject"] = subject

    if text_body:
        msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    try:
        service = _get_gmail_service()
        service.users().messages().send(
            userId="me",
            body={"raw": raw},
        ).execute()
        # PHI-safe: do not log recipient email addresses
        logger.info("Email sent successfully")
    except Exception as e:
        logger.error("Failed to send email: %s", type(e).__name__)
        raise


def send_email_with_attachment(
    to: str,
    subject: str,
    html_body: str,
    text_body: str | None = None,
    attachment_data: bytes | None = None,
    attachment_filename: str = "attachment.pdf",
    attachment_mime_type: str = "application/pdf",
):
    """Send an email with a file attachment via Gmail API.

    Args:
        to: Recipient email address
        subject: Email subject line
        html_body: HTML body content
        text_body: Optional plain-text fallback
        attachment_data: File content as bytes
        attachment_filename: Filename for the attachment
        attachment_mime_type: MIME type of the attachment
    """
    msg = MIMEMultipart("mixed")
    msg["To"] = to
    msg["From"] = SENDER_EMAIL
    msg["Subject"] = subject

    # Body part (alternative: text + html)
    body_part = MIMEMultipart("alternative")
    if text_body:
        body_part.attach(MIMEText(text_body, "plain"))
    body_part.attach(MIMEText(html_body, "html"))
    msg.attach(body_part)

    # Attachment
    if attachment_data:
        maintype, subtype = attachment_mime_type.split("/", 1)
        attachment = MIMEBase(maintype, subtype)
        attachment.set_payload(attachment_data)
        encoders.encode_base64(attachment)
        attachment.add_header(
            "Content-Disposition",
            "attachment",
            filename=attachment_filename,
        )
        msg.attach(attachment)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    try:
        service = _get_gmail_service()
        service.users().messages().send(
            userId="me",
            body={"raw": raw},
        ).execute()
        # PHI-safe: do not log recipient email addresses
        logger.info("Email with attachment sent successfully")
    except Exception as e:
        logger.error("Failed to send email with attachment: %s", type(e).__name__)
        raise
