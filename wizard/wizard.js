/**
 * Trellis Setup Wizard
 *
 * Static web app that walks therapists through GCP/Firebase setup
 * and generates a deployment script at the end.
 *
 * No backend required — hostable on GitHub Pages.
 */

// ── Collected configuration values ──
const config = {
    projectId: '',
    region: 'us-central1',
    saEmail: '',
    domain: '',
    senderEmail: '',
    dbPassword: '',
    cronSecret: '',
    firebaseApiKey: '',
    firebaseAuthDomain: '',
    firebaseProjectId: '',
    firebaseStorageBucket: '',
    firebaseMessagingSenderId: '',
    firebaseAppId: '',
};

// ── Step definitions ──
const TOTAL_STEPS = 9;
let currentStep = 0;

const steps = [
    { title: 'Welcome', render: renderWelcome, validate: () => true },
    { title: 'GCP Project', render: renderGcpProject, validate: validateGcpProject },
    { title: 'Workspace BAA', render: renderBaa, validate: validateBaa },
    { title: 'Enable APIs', render: renderApis, validate: validateApis },
    { title: 'Service Account', render: renderServiceAccount, validate: validateServiceAccount },
    { title: 'Domain Delegation', render: renderDelegation, validate: validateDelegation },
    { title: 'Firebase Auth', render: renderFirebase, validate: validateFirebase },
    { title: 'Domain + DNS', render: renderDomain, validate: validateDomain },
    { title: 'Review + Deploy', render: renderDeploy, validate: () => true },
];

// ── Navigation ──

function renderStep() {
    const step = steps[currentStep];
    const container = document.getElementById('stepContent');
    container.innerHTML = '';
    step.render(container);

    // Progress
    const pct = ((currentStep) / (TOTAL_STEPS - 1)) * 100;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('stepCounter').textContent =
        `Step ${currentStep + 1} of ${TOTAL_STEPS}`;

    // Dots
    const dots = document.getElementById('stepIndicators');
    dots.innerHTML = '';
    for (let i = 0; i < TOTAL_STEPS; i++) {
        const dot = document.createElement('div');
        dot.className = 'step-dot' +
            (i === currentStep ? ' active' : '') +
            (i < currentStep ? ' completed' : '');
        dots.appendChild(dot);
    }

    // Buttons
    document.getElementById('prevBtn').style.display =
        currentStep === 0 ? 'none' : '';
    const nextBtn = document.getElementById('nextBtn');
    if (currentStep === TOTAL_STEPS - 1) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = '';
        nextBtn.textContent = 'Continue';
    }
}

function nextStep() {
    const step = steps[currentStep];
    if (!step.validate()) return;

    if (currentStep < TOTAL_STEPS - 1) {
        currentStep++;
        renderStep();
        window.scrollTo(0, 0);
    }
}

function prevStep() {
    if (currentStep > 0) {
        currentStep--;
        renderStep();
        window.scrollTo(0, 0);
    }
}

// ── Utility ──

function codeBlock(text, id) {
    const idAttr = id ? ` id="${id}"` : '';
    return `<div class="code-block"${idAttr}><button class="copy-btn" onclick="copyCode(this)">Copy</button>${escapeHtml(text)}</div>`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function copyCode(btn) {
    const block = btn.parentElement;
    const text = block.textContent.replace('Copy', '').replace('Copied!', '').trim();
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
    });
}

function showError(inputId, msg) {
    const input = document.getElementById(inputId);
    if (input) {
        input.classList.add('error');
        let errEl = input.parentElement.querySelector('.error-text');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'error-text';
            input.parentElement.appendChild(errEl);
        }
        errEl.textContent = msg;
    }
}

function clearErrors() {
    document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.error-text').forEach(el => el.remove());
}

function generatePassword(length = 24) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => chars[b % chars.length]).join('');
}

// ── Step Renderers ──

function renderWelcome(container) {
    container.innerHTML = `
        <h2 class="step-title">Welcome to Trellis</h2>
        <p class="step-subtitle">
            This wizard will guide you through setting up Trellis in your own Google Cloud
            project and Google Workspace. It takes about 30 minutes.
        </p>

        <div class="features-grid">
            <div class="feature-card">
                <h4>Your Data, Your Control</h4>
                <p>Everything runs in your own GCP project. Patient data never leaves your infrastructure.</p>
            </div>
            <div class="feature-card">
                <h4>HIPAA Compliant</h4>
                <p>Google Cloud BAA, encrypted at rest, audit logging, session timeouts, and more.</p>
            </div>
            <div class="feature-card">
                <h4>AI-Powered Workflow</h4>
                <p>Voice intake, auto-transcription, AI note generation, and billing document creation.</p>
            </div>
            <div class="feature-card">
                <h4>Google Workspace Integration</h4>
                <p>Calendar, Meet, Gmail, and Drive work together for a seamless experience.</p>
            </div>
        </div>

        <div class="info-box info">
            <strong>What you will need:</strong>
            <ul style="margin: 0.5rem 0 0 1.25rem; line-height: 1.8">
                <li>A Google Workspace account (Business Standard or higher for Meet recording)</li>
                <li>A Google Cloud account with billing enabled</li>
                <li>A custom domain (for your practice's Trellis URL)</li>
                <li>About 30 minutes to complete the setup</li>
            </ul>
        </div>

        <div class="info-box warning">
            <strong>HIPAA Requirement</strong>
            You must sign Google's Business Associate Agreement (BAA) as part of this setup.
            Google Workspace Business Standard or higher is required.
        </div>
    `;
}

function renderGcpProject(container) {
    container.innerHTML = `
        <h2 class="step-title">Create a GCP Project</h2>
        <p class="step-subtitle">
            Create a new Google Cloud project dedicated to your Trellis installation.
            This keeps your practice data isolated in its own project.
        </p>

        <ol class="instruction-list">
            <li>
                Go to the
                <a href="https://console.cloud.google.com/projectcreate" target="_blank" class="external-link">
                    Google Cloud Console &rarr; Create Project
                </a>
            </li>
            <li>
                Enter a project name (e.g., <strong>trellis-yourpractice</strong>). Note the
                <strong>Project ID</strong> shown below the name field.
            </li>
            <li>
                Select your organization (your Google Workspace domain) as the parent.
            </li>
            <li>
                Click <strong>Create</strong> and wait for the project to be ready.
            </li>
            <li>
                Ensure billing is enabled:
                <a href="https://console.cloud.google.com/billing" target="_blank" class="external-link">
                    Billing Console
                </a>
                &mdash; link a billing account to your new project.
            </li>
        </ol>

        <div class="form-group">
            <label for="projectId">GCP Project ID</label>
            <input type="text" id="projectId" placeholder="e.g., trellis-yourpractice"
                   value="${config.projectId}" oninput="config.projectId = this.value.trim()">
            <div class="help-text">
                The Project ID (not name). Lowercase letters, numbers, and hyphens. 6-30 characters.
            </div>
        </div>

        <div class="form-group">
            <label for="region">Preferred Region</label>
            <select id="region" onchange="config.region = this.value">
                <option value="us-central1" ${config.region === 'us-central1' ? 'selected' : ''}>us-central1 (Iowa)</option>
                <option value="us-east1" ${config.region === 'us-east1' ? 'selected' : ''}>us-east1 (South Carolina)</option>
                <option value="us-east4" ${config.region === 'us-east4' ? 'selected' : ''}>us-east4 (Virginia)</option>
                <option value="us-west1" ${config.region === 'us-west1' ? 'selected' : ''}>us-west1 (Oregon)</option>
                <option value="us-west2" ${config.region === 'us-west2' ? 'selected' : ''}>us-west2 (Los Angeles)</option>
            </select>
            <div class="help-text">Choose a region close to your practice for best performance.</div>
        </div>
    `;
}

function validateGcpProject() {
    clearErrors();
    const id = config.projectId;
    if (!id) {
        showError('projectId', 'Project ID is required');
        return false;
    }
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) {
        showError('projectId', 'Must be 6-30 characters: lowercase letters, numbers, hyphens. Must start with a letter.');
        return false;
    }
    config.firebaseProjectId = id;
    return true;
}

function renderBaa(container) {
    container.innerHTML = `
        <h2 class="step-title">Sign Google Workspace BAA</h2>
        <p class="step-subtitle">
            HIPAA requires a Business Associate Agreement (BAA) with any vendor that handles
            Protected Health Information (PHI). Google provides this for Workspace and Cloud.
        </p>

        <ol class="instruction-list">
            <li>
                Sign the <strong>Google Workspace BAA</strong>:
                <a href="https://admin.google.com/ac/compliancecontrols" target="_blank" class="external-link">
                    Admin Console &rarr; Account &rarr; Compliance
                </a>
                <br>Look for "Google Workspace/Cloud Identity HIPAA BAA" and accept it.
            </li>
            <li>
                Sign the <strong>Google Cloud BAA</strong>:
                Go to your GCP project, then
                <a href="https://console.cloud.google.com/iam-admin/settings" target="_blank" class="external-link">
                    IAM & Admin &rarr; Settings
                </a>
                and look for the "Google Cloud BAA" acceptance option.
                Alternatively, visit the
                <a href="https://cloud.google.com/terms/baa" target="_blank" class="external-link">
                    Cloud BAA page
                </a>.
            </li>
        </ol>

        <div class="info-box warning">
            <strong>Important</strong>
            Both BAAs must be signed before storing any patient data. Without the BAA,
            Google is not considered a HIPAA-covered business associate and your setup
            would not be compliant.
        </div>

        <label class="confirm-box">
            <input type="checkbox" id="baaConfirm"
                   ${config._baaConfirmed ? 'checked' : ''}
                   onchange="config._baaConfirmed = this.checked">
            <span>I have signed both the Google Workspace BAA and the Google Cloud BAA for my organization.</span>
        </label>
    `;
}

function validateBaa() {
    clearErrors();
    if (!config._baaConfirmed) {
        const box = document.querySelector('.confirm-box');
        if (box) box.style.borderColor = 'var(--red-500)';
        return false;
    }
    return true;
}

function renderApis(container) {
    const apis = [
        'sqladmin.googleapis.com',
        'run.googleapis.com',
        'cloudbuild.googleapis.com',
        'firebase.googleapis.com',
        'calendar-json.googleapis.com',
        'drive.googleapis.com',
        'gmail.googleapis.com',
        'docs.googleapis.com',
        'speech.googleapis.com',
        'aiplatform.googleapis.com',
        'cloudscheduler.googleapis.com',
        'secretmanager.googleapis.com',
    ];

    const gcloudCmd = `gcloud services enable \\\n  ${apis.join(' \\\n  ')} \\\n  --project=${config.projectId || 'YOUR_PROJECT_ID'}`;

    container.innerHTML = `
        <h2 class="step-title">Enable Required APIs</h2>
        <p class="step-subtitle">
            Enable the Google Cloud APIs that Trellis needs. You can do this with a single
            gcloud command or through the Console.
        </p>

        <div class="info-box info">
            <strong>Quick method: Run this command</strong>
            Open <a href="https://console.cloud.google.com/cloudshell" target="_blank" class="external-link">Cloud Shell</a>
            and paste the command below.
        </div>

        ${codeBlock(gcloudCmd)}

        <p style="margin: 1rem 0; font-weight: 500;">APIs being enabled:</p>
        <div class="api-list">
            ${apis.map(api => `
                <div class="api-item">
                    <span class="check">&#10003;</span>
                    <span>${api.replace('.googleapis.com', '')}</span>
                </div>
            `).join('')}
        </div>

        <label class="confirm-box">
            <input type="checkbox" id="apisConfirm"
                   ${config._apisConfirmed ? 'checked' : ''}
                   onchange="config._apisConfirmed = this.checked">
            <span>I have enabled all required APIs for my project.</span>
        </label>
    `;
}

function validateApis() {
    clearErrors();
    if (!config._apisConfirmed) {
        const box = document.querySelector('.confirm-box');
        if (box) box.style.borderColor = 'var(--red-500)';
        return false;
    }
    return true;
}

function renderServiceAccount(container) {
    const projectId = config.projectId || 'YOUR_PROJECT_ID';
    const saName = 'trellis-backend';
    const saEmail = `${saName}@${projectId}.iam.gserviceaccount.com`;

    const createCmd = `# Create the service account
gcloud iam service-accounts create ${saName} \\
  --display-name="Trellis Backend" \\
  --project=${projectId}

# Grant required roles
gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${saEmail}" \\
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${saEmail}" \\
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${saEmail}" \\
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${saEmail}" \\
  --role="roles/iam.serviceAccountTokenCreator"

gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${saEmail}" \\
  --role="roles/speech.client"

# Download the key file (keep this secure!)
gcloud iam service-accounts keys create sa-key.json \\
  --iam-account=${saEmail}`;

    container.innerHTML = `
        <h2 class="step-title">Create Service Account</h2>
        <p class="step-subtitle">
            Create a service account that Trellis uses to access Google APIs (Calendar, Gmail, Drive, etc.)
            and download its key file.
        </p>

        <ol class="instruction-list">
            <li>Run the commands below in <a href="https://console.cloud.google.com/cloudshell" target="_blank" class="external-link">Cloud Shell</a>.</li>
            <li>The <code>sa-key.json</code> file will be downloaded. Keep it secure &mdash; it grants access to your project's APIs.</li>
            <li>Enter the service account email below.</li>
        </ol>

        ${codeBlock(createCmd)}

        <div class="form-group">
            <label for="saEmail">Service Account Email</label>
            <input type="email" id="saEmail"
                   placeholder="${saEmail}"
                   value="${config.saEmail}"
                   oninput="config.saEmail = this.value.trim()">
            <div class="help-text">Format: name@project-id.iam.gserviceaccount.com</div>
        </div>

        <div class="info-box warning">
            <strong>Security</strong>
            The <code>sa-key.json</code> file should never be committed to git or shared publicly.
            It will be uploaded as a Cloud Run secret during deployment.
        </div>
    `;
}

function validateServiceAccount() {
    clearErrors();
    const email = config.saEmail;
    if (!email) {
        showError('saEmail', 'Service account email is required');
        return false;
    }
    if (!email.endsWith('.iam.gserviceaccount.com')) {
        showError('saEmail', 'Must end with .iam.gserviceaccount.com');
        return false;
    }
    if (!email.includes('@')) {
        showError('saEmail', 'Invalid email format');
        return false;
    }
    return true;
}

function renderDelegation(container) {
    const saEmail = config.saEmail || 'trellis-backend@YOUR_PROJECT.iam.gserviceaccount.com';

    container.innerHTML = `
        <h2 class="step-title">Enable Domain-Wide Delegation</h2>
        <p class="step-subtitle">
            Domain-wide delegation allows the service account to send emails, manage calendar events,
            and access Drive on behalf of a Workspace user (e.g., your admin account).
        </p>

        <ol class="instruction-list">
            <li>
                Go to
                <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" class="external-link">
                    IAM &rarr; Service Accounts
                </a>,
                click on the service account (<code>${escapeHtml(saEmail)}</code>).
            </li>
            <li>
                Under the <strong>Details</strong> tab, expand <strong>Advanced settings</strong>.
                Note the <strong>Client ID</strong> (a numeric string).
            </li>
            <li>
                Check <strong>"Enable Google Workspace Domain-wide Delegation"</strong> and save.
            </li>
            <li>
                Go to
                <a href="https://admin.google.com/ac/owl/domainwidedelegation" target="_blank" class="external-link">
                    Google Admin Console &rarr; Security &rarr; API controls &rarr; Domain-wide delegation
                </a>.
            </li>
            <li>
                Click <strong>Add new</strong>. Enter the Client ID and add these OAuth scopes:
            </li>
        </ol>

        <div class="scope-list">
            <div class="scope-item">https://www.googleapis.com/auth/gmail.send</div>
            <div class="scope-item">https://www.googleapis.com/auth/calendar</div>
            <div class="scope-item">https://www.googleapis.com/auth/drive</div>
            <div class="scope-item">https://www.googleapis.com/auth/documents</div>
        </div>

        <div class="info-box info">
            <strong>Copy all scopes at once:</strong>
        </div>
        ${codeBlock('https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents')}

        <div class="form-group" style="margin-top: 1.5rem;">
            <label for="senderEmail">Workspace Sender Email</label>
            <input type="email" id="senderEmail"
                   placeholder="e.g., admin@yourpractice.com"
                   value="${config.senderEmail}"
                   oninput="config.senderEmail = this.value.trim()">
            <div class="help-text">
                The Workspace user email that Trellis will send emails as and manage calendars for.
                Must be a user on your Workspace domain.
            </div>
        </div>

        <label class="confirm-box">
            <input type="checkbox" id="delegationConfirm"
                   ${config._delegationConfirmed ? 'checked' : ''}
                   onchange="config._delegationConfirmed = this.checked">
            <span>I have enabled domain-wide delegation and added all four OAuth scopes in the Admin Console.</span>
        </label>
    `;
}

function validateDelegation() {
    clearErrors();
    if (!config.senderEmail) {
        showError('senderEmail', 'Sender email is required');
        return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.senderEmail)) {
        showError('senderEmail', 'Invalid email format');
        return false;
    }
    if (!config._delegationConfirmed) {
        const box = document.querySelector('.confirm-box');
        if (box) box.style.borderColor = 'var(--red-500)';
        return false;
    }
    return true;
}

function renderFirebase(container) {
    const projectId = config.projectId || 'YOUR_PROJECT_ID';

    container.innerHTML = `
        <h2 class="step-title">Configure Firebase Auth</h2>
        <p class="step-subtitle">
            Firebase handles user authentication (login/signup) for Trellis.
            You need to enable it and configure sign-in providers.
        </p>

        <ol class="instruction-list">
            <li>
                Go to
                <a href="https://console.firebase.google.com/project/${projectId}/authentication/providers" target="_blank" class="external-link">
                    Firebase Console &rarr; Authentication &rarr; Sign-in method
                </a>.
                If Firebase is not yet added to this project, click "Add Firebase" first.
            </li>
            <li>
                Enable <strong>Google</strong> as a sign-in provider. Set the public-facing name
                to your practice name.
            </li>
            <li>
                Enable <strong>Email/Password</strong> as a sign-in provider.
            </li>
            <li>
                Go to
                <a href="https://console.firebase.google.com/project/${projectId}/settings/general" target="_blank" class="external-link">
                    Project Settings &rarr; General
                </a>.
                Scroll to "Your apps" &rarr; click the Web icon (<strong>&lt;/&gt;</strong>) to register a web app.
            </li>
            <li>
                Copy the Firebase config values from the code snippet shown.
            </li>
        </ol>

        <div class="form-group">
            <label for="firebaseApiKey">API Key</label>
            <input type="text" id="firebaseApiKey" placeholder="AIza..."
                   value="${config.firebaseApiKey}"
                   oninput="config.firebaseApiKey = this.value.trim()">
        </div>

        <div class="form-group">
            <label for="firebaseAuthDomain">Auth Domain</label>
            <input type="text" id="firebaseAuthDomain" placeholder="${projectId}.firebaseapp.com"
                   value="${config.firebaseAuthDomain}"
                   oninput="config.firebaseAuthDomain = this.value.trim()">
        </div>

        <div class="form-group">
            <label for="firebaseStorageBucket">Storage Bucket</label>
            <input type="text" id="firebaseStorageBucket" placeholder="${projectId}.firebasestorage.app"
                   value="${config.firebaseStorageBucket}"
                   oninput="config.firebaseStorageBucket = this.value.trim()">
        </div>

        <div class="form-group">
            <label for="firebaseMessagingSenderId">Messaging Sender ID</label>
            <input type="text" id="firebaseMessagingSenderId" placeholder="123456789012"
                   value="${config.firebaseMessagingSenderId}"
                   oninput="config.firebaseMessagingSenderId = this.value.trim()">
        </div>

        <div class="form-group">
            <label for="firebaseAppId">App ID</label>
            <input type="text" id="firebaseAppId" placeholder="1:123456789012:web:abc123..."
                   value="${config.firebaseAppId}"
                   oninput="config.firebaseAppId = this.value.trim()">
        </div>
    `;
}

function validateFirebase() {
    clearErrors();
    let valid = true;

    if (!config.firebaseApiKey) {
        showError('firebaseApiKey', 'API key is required');
        valid = false;
    } else if (!config.firebaseApiKey.startsWith('AIza')) {
        showError('firebaseApiKey', 'Firebase API keys typically start with "AIza"');
        valid = false;
    }

    if (!config.firebaseAuthDomain) {
        showError('firebaseAuthDomain', 'Auth domain is required');
        valid = false;
    }

    if (!config.firebaseStorageBucket) {
        showError('firebaseStorageBucket', 'Storage bucket is required');
        valid = false;
    }

    if (!config.firebaseMessagingSenderId) {
        showError('firebaseMessagingSenderId', 'Messaging Sender ID is required');
        valid = false;
    } else if (!/^\d+$/.test(config.firebaseMessagingSenderId)) {
        showError('firebaseMessagingSenderId', 'Sender ID should be numeric');
        valid = false;
    }

    if (!config.firebaseAppId) {
        showError('firebaseAppId', 'App ID is required');
        valid = false;
    }

    // Auto-fill auth domain and project ID if not set
    if (valid) {
        config.firebaseProjectId = config.projectId;
    }

    return valid;
}

function renderDomain(container) {
    const projectId = config.projectId || 'YOUR_PROJECT_ID';

    container.innerHTML = `
        <h2 class="step-title">Custom Domain + DNS</h2>
        <p class="step-subtitle">
            Set up your custom domain for the Trellis platform. Cloud Run will provide
            automatic HTTPS certificates.
        </p>

        <ol class="instruction-list">
            <li>
                Decide on your domain. For example: <strong>app.yourpractice.com</strong>
                or <strong>ehr.yourpractice.com</strong>.
            </li>
            <li>
                After deployment, you will map this domain to your Cloud Run frontend service.
                The deployment script handles this automatically.
            </li>
            <li>
                You will need to add a DNS record (CNAME) pointing your subdomain to
                <code>ghs.googlehosted.com</code>. Instructions will be in the deployment script output.
            </li>
        </ol>

        <div class="form-group">
            <label for="domain">Practice Domain</label>
            <input type="text" id="domain" placeholder="e.g., app.yourpractice.com"
                   value="${config.domain}"
                   oninput="config.domain = this.value.trim()">
            <div class="help-text">
                The domain where Trellis will be accessible. Must be a domain you control.
            </div>
        </div>

        <div class="form-group">
            <label for="dbPassword">Database Password</label>
            <input type="text" id="dbPassword"
                   placeholder="Auto-generated if left empty"
                   value="${config.dbPassword}"
                   oninput="config.dbPassword = this.value">
            <div class="help-text">
                Password for the Cloud SQL database user. Leave empty to auto-generate a secure password.
            </div>
        </div>

        <div class="form-group">
            <label for="cronSecret">Cron Job Secret</label>
            <input type="text" id="cronSecret"
                   placeholder="Auto-generated if left empty"
                   value="${config.cronSecret}"
                   oninput="config.cronSecret = this.value">
            <div class="help-text">
                Shared secret for authenticating Cloud Scheduler cron jobs. Leave empty to auto-generate.
            </div>
        </div>

        <div class="info-box info">
            <strong>Meet Recording Setup</strong>
            After deployment, enable auto-recording in Google Workspace Admin Console:
            <br>Admin Console &rarr; Apps &rarr; Google Workspace &rarr; Google Meet &rarr; Recording settings &rarr;
            "Record all meetings automatically"
        </div>
    `;
}

function validateDomain() {
    clearErrors();
    if (!config.domain) {
        showError('domain', 'Domain is required');
        return false;
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(config.domain.toLowerCase())) {
        showError('domain', 'Enter a valid domain (e.g., app.yourpractice.com)');
        return false;
    }

    // Auto-generate passwords if not provided
    if (!config.dbPassword) {
        config.dbPassword = generatePassword(24);
    }
    if (!config.cronSecret) {
        config.cronSecret = generatePassword(32);
    }

    return true;
}

function renderDeploy(container) {
    const script = generateDeployScript();

    container.innerHTML = `
        <h2 class="step-title">Review & Deploy</h2>
        <p class="step-subtitle">
            Review your configuration and download the deployment script.
            The script will set up everything in your GCP project.
        </p>

        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem;">Configuration Summary</h3>
        <table class="summary-table">
            <tr><td>GCP Project</td><td>${escapeHtml(config.projectId)}</td></tr>
            <tr><td>Region</td><td>${escapeHtml(config.region)}</td></tr>
            <tr><td>Service Account</td><td>${escapeHtml(config.saEmail)}</td></tr>
            <tr><td>Sender Email</td><td>${escapeHtml(config.senderEmail)}</td></tr>
            <tr><td>Domain</td><td>${escapeHtml(config.domain)}</td></tr>
            <tr><td>Firebase Project</td><td>${escapeHtml(config.firebaseProjectId)}</td></tr>
        </table>

        <div class="info-box info">
            <strong>How to deploy</strong>
            <ol style="margin: 0.5rem 0 0 1.25rem; line-height: 1.8">
                <li>Download the deployment script below.</li>
                <li>Place your <code>sa-key.json</code> file in the same directory.</li>
                <li>Clone the Trellis repository: <code>git clone https://github.com/your-org/trellis.git</code></li>
                <li>Run the script from the repository root: <code>chmod +x deploy.sh && ./deploy.sh</code></li>
                <li>Follow the DNS instructions printed at the end.</li>
                <li>Visit your domain and log in as the first clinician!</li>
            </ol>
        </div>

        <div style="margin: 1.5rem 0;">
            <button class="btn-download" onclick="downloadScript()">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 12l-4-4h2.5V2h3v6H12L8 12zM2 14h12v-1.5H2V14z"/>
                </svg>
                Download deploy.sh
            </button>
            <button class="btn-copy" onclick="copyScript()">
                Copy to Clipboard
            </button>
        </div>

        <details>
            <summary style="cursor: pointer; font-weight: 500; margin-bottom: 0.5rem; color: var(--warm-600);">
                Preview deployment script
            </summary>
            <div class="script-preview" id="scriptPreview">${escapeHtml(script)}</div>
        </details>

        <div class="info-box success" style="margin-top: 1.5rem;">
            <strong>After deployment</strong>
            <ol style="margin: 0.5rem 0 0 1.25rem; line-height: 1.8">
                <li>Visit <code>https://${escapeHtml(config.domain)}</code></li>
                <li>Click "Clinician Login" and sign in with your Google Workspace account.</li>
                <li>Select "Clinician" role when prompted.</li>
                <li>Complete the practice profile setup wizard.</li>
                <li>You are ready to accept clients!</li>
            </ol>
        </div>
    `;
}

function downloadScript() {
    const script = generateDeployScript();
    const blob = new Blob([script], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deploy.sh';
    a.click();
    URL.revokeObjectURL(url);
}

function copyScript() {
    const script = generateDeployScript();
    navigator.clipboard.writeText(script).then(() => {
        const btn = document.querySelector('.btn-copy');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
}

// ── Deployment Script Generator ──

function generateDeployScript() {
    const p = config.projectId;
    const r = config.region;
    const sa = config.saEmail;
    const sender = config.senderEmail;
    const domain = config.domain;
    const dbPass = config.dbPassword;
    const cronSecret = config.cronSecret;

    return `#!/usr/bin/env bash
# ============================================================================
# Trellis EHR — Deployment Script
# Generated by the Trellis Setup Wizard
#
# This script deploys Trellis into your GCP project. Prerequisites:
#   - gcloud CLI installed and authenticated
#   - sa-key.json in the current directory
#   - Trellis repository cloned (this should be run from the repo root)
#   - APIs enabled (done in wizard)
#   - Domain-wide delegation configured (done in wizard)
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ============================================================================

set -euo pipefail

# ── Configuration (from Setup Wizard) ──
PROJECT_ID="${p}"
REGION="${r}"
SA_EMAIL="${sa}"
SENDER_EMAIL="${sender}"
DOMAIN="${domain}"
DB_INSTANCE="trellis-db"
DB_NAME="trellis"
DB_USER="trellis"
DB_PASSWORD="${dbPass}"
CRON_SECRET="${cronSecret}"

# Firebase config (for frontend build)
FIREBASE_API_KEY="${config.firebaseApiKey}"
FIREBASE_AUTH_DOMAIN="${config.firebaseAuthDomain}"
FIREBASE_PROJECT_ID="${config.firebaseProjectId}"
FIREBASE_STORAGE_BUCKET="${config.firebaseStorageBucket}"
FIREBASE_MESSAGING_SENDER_ID="${config.firebaseMessagingSenderId}"
FIREBASE_APP_ID="${config.firebaseAppId}"

# ── Color output helpers ──
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

info()  { echo -e "\${BLUE}[INFO]\${NC}  $1"; }
ok()    { echo -e "\${GREEN}[OK]\${NC}    $1"; }
warn()  { echo -e "\${YELLOW}[WARN]\${NC}  $1"; }
error() { echo -e "\${RED}[ERROR]\${NC} $1"; exit 1; }

# ── Preflight checks ──
info "Running preflight checks..."

command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
command -v docker >/dev/null 2>&1 || error "Docker not found. Install: https://docs.docker.com/get-docker/"

if [ ! -f "sa-key.json" ]; then
    error "sa-key.json not found in current directory. Download it from GCP Console."
fi

if [ ! -f "backend/api/main.py" ]; then
    error "Run this script from the Trellis repository root directory."
fi

# Set the active project
gcloud config set project "\${PROJECT_ID}"
ok "GCP project set to \${PROJECT_ID}"

# ============================================================================
# 1. CLOUD SQL
# ============================================================================
info "Setting up Cloud SQL..."

# Check if instance already exists
if gcloud sql instances describe "\${DB_INSTANCE}" --project="\${PROJECT_ID}" >/dev/null 2>&1; then
    warn "Cloud SQL instance '\${DB_INSTANCE}' already exists. Skipping creation."
else
    info "Creating Cloud SQL instance (this takes 5-10 minutes)..."
    gcloud sql instances create "\${DB_INSTANCE}" \\
        --project="\${PROJECT_ID}" \\
        --database-version=POSTGRES_15 \\
        --tier=db-f1-micro \\
        --region="\${REGION}" \\
        --storage-type=SSD \\
        --storage-size=10GB \\
        --storage-auto-increase \\
        --backup \\
        --backup-start-time=04:00 \\
        --enable-point-in-time-recovery \\
        --maintenance-window-day=SUN \\
        --maintenance-window-hour=5 \\
        --availability-type=zonal \\
        --no-assign-ip \\
        --network=default

    ok "Cloud SQL instance created"
fi

# Get the connection name
DB_CONNECTION_NAME=\$(gcloud sql instances describe "\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" --format="value(connectionName)")
info "DB connection name: \${DB_CONNECTION_NAME}"

# Create database if not exists
if gcloud sql databases describe "\${DB_NAME}" --instance="\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" >/dev/null 2>&1; then
    warn "Database '\${DB_NAME}' already exists."
else
    gcloud sql databases create "\${DB_NAME}" --instance="\${DB_INSTANCE}" --project="\${PROJECT_ID}"
    ok "Database '\${DB_NAME}' created"
fi

# Set database user password
gcloud sql users set-password "\${DB_USER}" \\
    --instance="\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" \\
    --password="\${DB_PASSWORD}" 2>/dev/null || \\
gcloud sql users create "\${DB_USER}" \\
    --instance="\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" \\
    --password="\${DB_PASSWORD}"
ok "Database user configured"

# ── Run migrations ──
info "Running database migrations..."
DB_IP=\$(gcloud sql instances describe "\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" --format="value(ipAddresses[0].ipAddress)")

# Temporarily authorize current IP for migration
MY_IP=\$(curl -s https://api.ipify.org)
gcloud sql instances patch "\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" \\
    --authorized-networks="\${MY_IP}/32" \\
    --quiet

export PGPASSWORD="\${DB_PASSWORD}"
for migration in db/migrations/*.sql; do
    info "  Applying \$(basename \${migration})..."
    psql -h "\${DB_IP}" -U "\${DB_USER}" -d "\${DB_NAME}" -f "\${migration}" 2>&1 | \\
        grep -v "already exists" || true
done
unset PGPASSWORD
ok "All migrations applied"

# Remove temporary network authorization
gcloud sql instances patch "\${DB_INSTANCE}" \\
    --project="\${PROJECT_ID}" \\
    --clear-authorized-networks \\
    --quiet

# ============================================================================
# 2. SECRETS
# ============================================================================
info "Configuring secrets..."

# Store SA key as a secret
gcloud secrets create sa-key \\
    --project="\${PROJECT_ID}" \\
    --replication-policy=automatic 2>/dev/null || true
gcloud secrets versions add sa-key \\
    --project="\${PROJECT_ID}" \\
    --data-file=sa-key.json
ok "Service account key stored as secret"

# Grant SA access to the secret
gcloud secrets add-iam-policy-binding sa-key \\
    --project="\${PROJECT_ID}" \\
    --member="serviceAccount:\${SA_EMAIL}" \\
    --role="roles/secretmanager.secretAccessor"

# ============================================================================
# 3. BUILD AND DEPLOY CLOUD RUN SERVICES
# ============================================================================
info "Building and deploying services..."

# ── API Service ──
info "Building API service..."
gcloud builds submit \\
    --project="\${PROJECT_ID}" \\
    --tag="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/api:latest" \\
    --gcs-log-dir="gs://\${PROJECT_ID}_cloudbuild/logs" \\
    -f backend/api/Dockerfile \\
    backend/

info "Deploying API service to Cloud Run..."
gcloud run deploy trellis-api \\
    --project="\${PROJECT_ID}" \\
    --region="\${REGION}" \\
    --image="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/api:latest" \\
    --platform=managed \\
    --allow-unauthenticated \\
    --port=8080 \\
    --memory=512Mi \\
    --cpu=1 \\
    --min-instances=0 \\
    --max-instances=10 \\
    --service-account="\${SA_EMAIL}" \\
    --set-secrets="/app/sa-key.json=sa-key:latest" \\
    --set-env-vars="\\
GCP_PROJECT_ID=\${PROJECT_ID},\\
GCP_REGION=\${REGION},\\
DB_CONNECTION_NAME=\${DB_CONNECTION_NAME},\\
DB_NAME=\${DB_NAME},\\
DB_USER=\${DB_USER},\\
DB_PASSWORD=\${DB_PASSWORD},\\
DATABASE_URL=postgresql://\${DB_USER}:\${DB_PASSWORD}@/\${DB_NAME}?host=/cloudsql/\${DB_CONNECTION_NAME},\\
SENDER_EMAIL=\${SENDER_EMAIL},\\
GOOGLE_APPLICATION_CREDENTIALS=/app/sa-key.json,\\
CRON_SECRET=\${CRON_SECRET},\\
ALLOWED_ORIGINS=https://\${DOMAIN}" \\
    --add-cloudsql-instances="\${DB_CONNECTION_NAME}"
ok "API service deployed"

API_URL=\$(gcloud run services describe trellis-api \\
    --project="\${PROJECT_ID}" --region="\${REGION}" \\
    --format="value(status.url)")
info "API URL: \${API_URL}"

# ── Relay Service ──
info "Building relay service..."
gcloud builds submit \\
    --project="\${PROJECT_ID}" \\
    --tag="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/relay:latest" \\
    --gcs-log-dir="gs://\${PROJECT_ID}_cloudbuild/logs" \\
    -f backend/relay/Dockerfile \\
    backend/

info "Deploying relay service to Cloud Run..."
gcloud run deploy trellis-relay \\
    --project="\${PROJECT_ID}" \\
    --region="\${REGION}" \\
    --image="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/relay:latest" \\
    --platform=managed \\
    --allow-unauthenticated \\
    --port=8080 \\
    --memory=512Mi \\
    --cpu=1 \\
    --min-instances=0 \\
    --max-instances=5 \\
    --timeout=3600 \\
    --service-account="\${SA_EMAIL}" \\
    --set-secrets="/app/sa-key.json=sa-key:latest" \\
    --set-env-vars="\\
GCP_PROJECT_ID=\${PROJECT_ID},\\
GCP_REGION=\${REGION},\\
DB_CONNECTION_NAME=\${DB_CONNECTION_NAME},\\
DB_NAME=\${DB_NAME},\\
DB_USER=\${DB_USER},\\
DB_PASSWORD=\${DB_PASSWORD},\\
DATABASE_URL=postgresql://\${DB_USER}:\${DB_PASSWORD}@/\${DB_NAME}?host=/cloudsql/\${DB_CONNECTION_NAME},\\
SENDER_EMAIL=\${SENDER_EMAIL},\\
GOOGLE_APPLICATION_CREDENTIALS=/app/sa-key.json,\\
API_BASE_URL=\${API_URL},\\
ALLOWED_ORIGINS=https://\${DOMAIN}" \\
    --add-cloudsql-instances="\${DB_CONNECTION_NAME}"
ok "Relay service deployed"

RELAY_URL=\$(gcloud run services describe trellis-relay \\
    --project="\${PROJECT_ID}" --region="\${REGION}" \\
    --format="value(status.url)")
info "Relay URL: \${RELAY_URL}"

# ── Frontend Service ──
info "Building frontend..."
gcloud builds submit \\
    --project="\${PROJECT_ID}" \\
    --tag="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/frontend:latest" \\
    --gcs-log-dir="gs://\${PROJECT_ID}_cloudbuild/logs" \\
    -f frontend/Dockerfile \\
    frontend/ \\
    --build-arg="VITE_FIREBASE_API_KEY=\${FIREBASE_API_KEY}" \\
    --build-arg="VITE_FIREBASE_AUTH_DOMAIN=\${FIREBASE_AUTH_DOMAIN}" \\
    --build-arg="VITE_FIREBASE_PROJECT_ID=\${FIREBASE_PROJECT_ID}" \\
    --build-arg="VITE_FIREBASE_STORAGE_BUCKET=\${FIREBASE_STORAGE_BUCKET}" \\
    --build-arg="VITE_FIREBASE_MESSAGING_SENDER_ID=\${FIREBASE_MESSAGING_SENDER_ID}" \\
    --build-arg="VITE_FIREBASE_APP_ID=\${FIREBASE_APP_ID}" \\
    --build-arg="VITE_API_URL=\${API_URL}" \\
    --build-arg="VITE_WS_URL=\${RELAY_URL}"

info "Deploying frontend to Cloud Run..."
gcloud run deploy trellis-frontend \\
    --project="\${PROJECT_ID}" \\
    --region="\${REGION}" \\
    --image="\${REGION}-docker.pkg.dev/\${PROJECT_ID}/trellis/frontend:latest" \\
    --platform=managed \\
    --allow-unauthenticated \\
    --port=8080 \\
    --memory=256Mi \\
    --cpu=1 \\
    --min-instances=0 \\
    --max-instances=5
ok "Frontend deployed"

FRONTEND_URL=\$(gcloud run services describe trellis-frontend \\
    --project="\${PROJECT_ID}" --region="\${REGION}" \\
    --format="value(status.url)")
info "Frontend URL: \${FRONTEND_URL}"

# ============================================================================
# 4. ARTIFACT REGISTRY (create repo if not exists)
# ============================================================================
gcloud artifacts repositories describe trellis \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" >/dev/null 2>&1 || \\
gcloud artifacts repositories create trellis \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --repository-format=docker
ok "Artifact Registry repository ready"

# ============================================================================
# 5. CLOUD SCHEDULER (cron jobs)
# ============================================================================
info "Setting up Cloud Scheduler cron jobs..."

# Process recordings — every 5 minutes
gcloud scheduler jobs create http trellis-process-recordings \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="*/5 * * * *" \\
    --uri="\${API_URL}/api/cron/process-recordings" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=300s \\
    --description="Process Meet recordings and generate transcripts" 2>/dev/null || \\
gcloud scheduler jobs update http trellis-process-recordings \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="*/5 * * * *" \\
    --uri="\${API_URL}/api/cron/process-recordings" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=300s
ok "process-recordings cron job configured"

# Send reminders — every hour
gcloud scheduler jobs create http trellis-send-reminders \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 * * * *" \\
    --uri="\${API_URL}/api/cron/send-reminders" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s \\
    --description="Send 24-hour appointment reminder emails" 2>/dev/null || \\
gcloud scheduler jobs update http trellis-send-reminders \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 * * * *" \\
    --uri="\${API_URL}/api/cron/send-reminders" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s
ok "send-reminders cron job configured"

# Check reconfirmations — every hour
gcloud scheduler jobs create http trellis-check-reconfirmations \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 * * * *" \\
    --uri="\${API_URL}/api/cron/check-reconfirmations" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s \\
    --description="Check for expired reconfirmation windows and release slots" 2>/dev/null || \\
gcloud scheduler jobs update http trellis-check-reconfirmations \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 * * * *" \\
    --uri="\${API_URL}/api/cron/check-reconfirmations" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s
ok "check-reconfirmations cron job configured"

# Check no-shows — every 15 minutes
gcloud scheduler jobs create http trellis-check-no-shows \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="*/15 * * * *" \\
    --uri="\${API_URL}/api/cron/check-no-shows" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s \\
    --description="Mark past-due appointments as no-show" 2>/dev/null || \\
gcloud scheduler jobs update http trellis-check-no-shows \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="*/15 * * * *" \\
    --uri="\${API_URL}/api/cron/check-no-shows" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s
ok "check-no-shows cron job configured"

# Check unsigned docs — daily at 6 AM
gcloud scheduler jobs create http trellis-check-unsigned-docs \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 6 * * *" \\
    --uri="\${API_URL}/api/cron/check-unsigned-docs" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s \\
    --description="Send reminders for unsigned consent documents" 2>/dev/null || \\
gcloud scheduler jobs update http trellis-check-unsigned-docs \\
    --project="\${PROJECT_ID}" \\
    --location="\${REGION}" \\
    --schedule="0 6 * * *" \\
    --uri="\${API_URL}/api/cron/check-unsigned-docs" \\
    --http-method=POST \\
    --headers="X-Cron-Secret=\${CRON_SECRET}" \\
    --attempt-deadline=120s
ok "check-unsigned-docs cron job configured"

# ============================================================================
# 6. CUSTOM DOMAIN MAPPING
# ============================================================================
info "Mapping custom domain..."
gcloud run domain-mappings create \\
    --project="\${PROJECT_ID}" \\
    --region="\${REGION}" \\
    --service=trellis-frontend \\
    --domain="\${DOMAIN}" 2>/dev/null || \\
    warn "Domain mapping may already exist or require verification."

# ============================================================================
# 7. VERIFY DEPLOYMENT
# ============================================================================
info "Running health check..."
sleep 10  # Wait for services to stabilize

HEALTH_RESPONSE=\$(curl -s -X POST "\${API_URL}/api/health" || echo '{"status":"error"}')
echo ""
echo "\${HEALTH_RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "\${HEALTH_RESPONSE}"
echo ""

# ============================================================================
# DEPLOYMENT COMPLETE
# ============================================================================
echo ""
echo -e "\${GREEN}============================================================\${NC}"
echo -e "\${GREEN}  Trellis deployment complete!\${NC}"
echo -e "\${GREEN}============================================================\${NC}"
echo ""
echo "  Services:"
echo "    Frontend:  \${FRONTEND_URL}"
echo "    API:       \${API_URL}"
echo "    Relay:     \${RELAY_URL}"
echo ""
echo "  Custom domain: https://\${DOMAIN}"
echo ""
echo -e "  \${YELLOW}DNS Setup Required:\${NC}"
echo "    Add a CNAME record for '\${DOMAIN}' pointing to 'ghs.googlehosted.com'"
echo "    (This may take up to 24 hours to propagate)"
echo ""
echo "  Next steps:"
echo "    1. Add the DNS record above"
echo "    2. Enable Meet auto-recording in Workspace Admin Console"
echo "    3. Visit https://\${DOMAIN} and sign in as the clinician"
echo "    4. Select 'Clinician' role and complete practice profile setup"
echo "    5. Share your Trellis URL with clients!"
echo ""
echo -e "  \${YELLOW}Important:\${NC}"
echo "    - Keep sa-key.json secure (do not commit to git)"
echo "    - Database password: stored in Cloud Run env vars"
echo "    - Cron secret: stored in Cloud Run env vars"
echo ""
`;
}

// ── Initialize ──
renderStep();
