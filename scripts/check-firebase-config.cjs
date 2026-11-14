// Read-only check. Never prints keys, OAuth access tokens, client secrets or users.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { cert, initializeApp, deleteApp } = require('firebase-admin/app');
(async () => {
  const env = parseEnv(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'));
  const account = JSON.parse(fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  if (account.project_id !== env.FIREBASE_PROJECT_ID) throw Error('Firebase project mismatch.');
  const credential = cert(account);
  const app = initializeApp({ credential, projectId: env.FIREBASE_PROJECT_ID }, 'configuration-check');
  try {
    const token = await credential.getAccessToken();
    console.log('Service-account credentials accepted by Google.');
    const root = `https://identitytoolkit.googleapis.com/admin/v2/projects/${env.FIREBASE_PROJECT_ID}`;
    const headers = { Authorization: `Bearer ${token.access_token}` };
    for (const provider of ['google.com', 'github.com']) {
      const response = await fetch(`${root}/defaultSupportedIdpConfigs/${provider}`, { headers });
      const config = await response.json();
      console.log(JSON.stringify({ provider, status: response.status, enabled: response.ok ? config.enabled === true : null }));
    }
    const response = await fetch(`${root}/config`, { headers });
    if (response.ok) {
      const config = await response.json();
      console.log(JSON.stringify({ localhostAuthorized: (config.authorizedDomains || []).includes('localhost') }));
    } else console.log(`Authorized domains check: HTTP ${response.status}`);
  } finally { await deleteApp(app); }
})().catch(error => { console.error('Firebase configuration check failed:', error.code || error.name || 'Error'); process.exitCode = 1; });
