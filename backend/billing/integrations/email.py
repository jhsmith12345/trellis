"""Billing email client — stubbed for now, swappable to SendGrid/SES/Gmail later.

Provides a clean interface for sending templated billing communications.
In stub mode, logs email content and returns True without actually sending.
"""
import logging
from string import Template

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HTML email templates (HIPAA-aware — no clinical details)
# ---------------------------------------------------------------------------

_BASE_WRAPPER = Template("""\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #333; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
  .header { background: #2563eb; color: #ffffff; padding: 24px 32px; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .body { padding: 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; }
  .amount-box { background: #f0f4ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
  .amount-box .amount { font-size: 32px; font-weight: 700; color: #1e40af; }
  .amount-box .label { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .btn { display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px; }
  .btn:hover { background: #1d4ed8; }
  .btn-container { text-align: center; margin: 24px 0; }
  .summary-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  .summary-table td { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .summary-table td:last-child { text-align: right; font-weight: 600; }
  .footer { padding: 24px 32px; background: #f9fafb; font-size: 13px; color: #9ca3af; text-align: center; }
  .urgent { color: #dc2626; font-weight: 600; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>${practice_name}</h1></div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>${practice_name}</p>
    <p>This is an automated message regarding your account balance. Please do not reply to this email.</p>
    <p>If you have questions, contact your provider's office directly.</p>
  </div>
</div>
</body>
</html>
""")

TEMPLATES: dict[str, Template] = {}

# --- Patient Statement ---
TEMPLATES["patient_statement"] = Template("""\
<p>Dear ${patient_name},</p>
<p>Here is a summary of your account with ${practice_name}.</p>

<table class="summary-table">
  <tr><td>Date of Service</td><td>${service_date}</td></tr>
  <tr><td>Total Charges</td><td>$$${total_charges}</td></tr>
  <tr><td>Insurance Paid</td><td>$$${insurance_paid}</td></tr>
  <tr><td>Adjustments</td><td>$$${adjustments}</td></tr>
  <tr><td><strong>Your Responsibility</strong></td><td><strong>$$${patient_responsibility}</strong></td></tr>
</table>

<div class="amount-box">
  <div class="amount">$$${patient_responsibility}</div>
  <div class="label">Balance Due</div>
</div>

${payment_link_section}

<p>If you have questions about this statement or need to discuss payment options, please contact our office.</p>
<p>Thank you for choosing ${practice_name}.</p>
""")

# --- Payment Link ---
TEMPLATES["payment_link"] = Template("""\
<p>Dear ${patient_name},</p>
<p>You have an outstanding balance with ${practice_name}.</p>

<div class="amount-box">
  <div class="amount">$$${amount_due}</div>
  <div class="label">Amount Due</div>
</div>

<div class="btn-container">
  <a href="${payment_link}" class="btn">Pay Now</a>
</div>

<p>You can make a secure payment at any time using the link above. If you have questions or need to arrange a payment plan, please contact our office.</p>
<p>Thank you,<br>${practice_name}</p>
""")

# --- Payment Reminder Level 1 (7 days) ---
TEMPLATES["payment_reminder_1"] = Template("""\
<p>Dear ${patient_name},</p>
<p>This is a friendly reminder that you have an outstanding balance with ${practice_name}.</p>

<div class="amount-box">
  <div class="amount">$$${amount_due}</div>
  <div class="label">Balance Due</div>
</div>

<div class="btn-container">
  <a href="${payment_link}" class="btn">Pay Now</a>
</div>

<p>If you have already submitted payment, please disregard this message. Otherwise, we would appreciate your prompt attention to this balance.</p>
<p>If you have questions or need to discuss payment arrangements, please don't hesitate to contact our office. We're happy to help.</p>
<p>Warm regards,<br>${practice_name}</p>
""")

# --- Payment Reminder Level 2 (30 days) ---
TEMPLATES["payment_reminder_2"] = Template("""\
<p>Dear ${patient_name},</p>
<p>Our records show that your balance of <strong>$$${amount_due}</strong> with ${practice_name} is now 30 days past due.</p>

<div class="amount-box">
  <div class="amount">$$${amount_due}</div>
  <div class="label">30 Days Past Due</div>
</div>

<div class="btn-container">
  <a href="${payment_link}" class="btn">Pay Now</a>
</div>

<p>We understand that circumstances may arise. If you need to set up a payment plan or discuss your options, please contact our office at your earliest convenience.</p>
<p>Thank you for your attention to this matter.</p>
<p>Sincerely,<br>${practice_name}</p>
""")

# --- Payment Reminder Level 3 (60 days) ---
TEMPLATES["payment_reminder_3"] = Template("""\
<p>Dear ${patient_name},</p>
<p><span class="urgent">Final Notice:</span> Your balance of <strong>$$${amount_due}</strong> with ${practice_name} is now 60 days past due.</p>

<div class="amount-box">
  <div class="amount">$$${amount_due}</div>
  <div class="label">60 Days Past Due — Final Notice</div>
</div>

<div class="btn-container">
  <a href="${payment_link}" class="btn">Pay Now</a>
</div>

<p>Please contact our office as soon as possible to arrange payment. We would like to resolve this balance and are open to discussing payment plan options.</p>
<p>If you have already submitted payment, please disregard this notice.</p>
<p>Sincerely,<br>${practice_name}</p>
""")

# --- Payment Confirmation ---
TEMPLATES["payment_confirmation"] = Template("""\
<p>Dear ${patient_name},</p>
<p>Thank you for your payment! We have received your payment of <strong>$$${amount_paid}</strong>.</p>

<div class="amount-box">
  <div class="amount">$$${amount_paid}</div>
  <div class="label">Payment Received</div>
</div>

<table class="summary-table">
  <tr><td>Payment Date</td><td>${payment_date}</td></tr>
  <tr><td>Amount Paid</td><td>$$${amount_paid}</td></tr>
  <tr><td>Remaining Balance</td><td>$$${remaining_balance}</td></tr>
</table>

<p>If you have any questions about your account, please contact our office.</p>
<p>Thank you for choosing ${practice_name}. We appreciate your trust in our care.</p>
""")

# Payment link section snippet (inserted into statement when applicable)
_PAYMENT_LINK_SECTION = Template("""\
<div class="btn-container">
  <a href="${payment_link}" class="btn">Pay Now</a>
</div>
<p style="text-align:center; font-size:13px; color:#6b7280;">Secure online payment</p>
""")

_NO_PAYMENT_LINK_SECTION = (
    '<p>Please contact our office to arrange payment.</p>'
)


# ---------------------------------------------------------------------------
# Email subjects
# ---------------------------------------------------------------------------

SUBJECTS: dict[str, Template] = {
    "patient_statement": Template("Statement from ${practice_name}"),
    "payment_link": Template("Payment Due — ${practice_name}"),
    "payment_reminder_1": Template("Friendly Reminder: Balance Due — ${practice_name}"),
    "payment_reminder_2": Template("Past Due Balance — ${practice_name}"),
    "payment_reminder_3": Template("Final Notice: Past Due Balance — ${practice_name}"),
    "payment_confirmation": Template("Payment Received — Thank You — ${practice_name}"),
}


# ---------------------------------------------------------------------------
# BillingEmailClient
# ---------------------------------------------------------------------------

class BillingEmailClient:
    """Email client for billing communications.

    Currently operates in stub mode (logs emails, does not send).
    Swap in a real backend (SendGrid, SES, Gmail API) by overriding
    ``_do_send`` or replacing this class.
    """

    def __init__(self, *, live_mode: bool = False):
        self.live_mode = live_mode

    async def send_email(
        self,
        to: str,
        subject: str,
        html_body: str,
        attachments: list[dict] | None = None,
    ) -> bool:
        """Send a raw email.

        Args:
            to: Recipient email address.
            subject: Email subject line.
            html_body: Full HTML body.
            attachments: Optional list of dicts with keys
                ``filename``, ``content`` (bytes), ``mime_type``.

        Returns:
            True if sent (or logged in stub mode), False on failure.
        """
        if not self.live_mode:
            logger.info(
                "STUB EMAIL — to=<redacted> subject=%s body_len=%d attachments=%d",
                subject,
                len(html_body),
                len(attachments) if attachments else 0,
            )
            return True

        return await self._do_send(to, subject, html_body, attachments)

    async def send_template(
        self,
        to: str,
        template_name: str,
        context: dict,
    ) -> bool:
        """Render a named template and send.

        Args:
            to: Recipient email address.
            template_name: One of the keys in ``TEMPLATES``.
            context: Dict of template variables. Must include ``practice_name``.

        Returns:
            True if sent successfully, False otherwise.
        """
        template = TEMPLATES.get(template_name)
        if not template:
            logger.error("Unknown email template: %s", template_name)
            return False

        # Build payment link section for statement template
        if template_name == "patient_statement":
            if context.get("payment_link"):
                context["payment_link_section"] = _PAYMENT_LINK_SECTION.safe_substitute(context)
            else:
                context["payment_link_section"] = _NO_PAYMENT_LINK_SECTION

        # Render inner content, then wrap
        try:
            inner_html = template.safe_substitute(context)
            full_html = _BASE_WRAPPER.safe_substitute(
                practice_name=context.get("practice_name", "Your Provider"),
                content=inner_html,
            )
        except (KeyError, ValueError) as exc:
            logger.error("Template rendering failed for %s: %s", template_name, exc)
            return False

        # Resolve subject
        subject_tmpl = SUBJECTS.get(template_name)
        subject = subject_tmpl.safe_substitute(context) if subject_tmpl else template_name

        return await self.send_email(to, subject, full_html)

    # ------------------------------------------------------------------
    # Override this method to plug in a real email provider
    # ------------------------------------------------------------------

    async def _do_send(
        self,
        to: str,
        subject: str,
        html_body: str,
        attachments: list[dict] | None = None,
    ) -> bool:
        """Actually send an email. Override for SendGrid / SES / Gmail API.

        Default implementation raises NotImplementedError — set live_mode=False
        (stub mode) unless you provide a real implementation.
        """
        raise NotImplementedError(
            "Live email sending not configured. "
            "Override BillingEmailClient._do_send or use stub mode."
        )


# Module-level singleton (stub mode by default)
email_client = BillingEmailClient(live_mode=False)
