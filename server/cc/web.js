/**
 * The Campus Connect web service.
 *
 * Serves the static frontend in web/ (buyers at /, the Seller Hub at /sell), the template's
 * API at /api and the Campus Connect API at /api/cc. It doesn't use the React app or its
 * server in server/index.js; the middleware below is the part of that server this one needs.
 */

// Configure process.env with .env.* files
require('../env').configureEnv();

// This sets up Sentry, which needs to happen before Express is required.
const log = require('../log');

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const enforceSsl = require('express-enforces-ssl');
const passport = require('passport');

const auth = require('../auth');
const apiRouter = require('../apiRouter');
const { generateCSPNonce, csp } = require('../csp');
const ccApiRouter = require('./api');
const db = require('./db');
const { requireEnv } = require('./env');

requireEnv([
  'REACT_APP_SHARETRIBE_SDK_CLIENT_ID',
  'SHARETRIBE_SDK_CLIENT_SECRET',
  'REACT_APP_MARKETPLACE_ROOT_URL',
  'DATABASE_URL',
]);

const webDir = path.resolve(__dirname, '..', '..', 'web');
const dev = process.env.REACT_APP_ENV === 'development';
const PORT = parseInt(process.env.PORT, 10) || 4000;
const redirectSSL =
  process.env.SERVER_SHARETRIBE_REDIRECT_SSL != null
    ? process.env.SERVER_SHARETRIBE_REDIRECT_SSL
    : process.env.REACT_APP_SHARETRIBE_USING_SSL;
const TRUST_PROXY = process.env.SERVER_SHARETRIBE_TRUST_PROXY || null;
const CSP = process.env.REACT_APP_CSP;
const cspReportUrl = '/csp-report';
const cspEnabled = CSP === 'block' || CSP === 'report';

const app = express();

// ================ Security and transport ================ //

// CSP is added separately below, when it is turned on.
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: 'origin' } }));

if (cspEnabled) {
  app.use(generateCSPNonce);
  // The browser reports a policy violation by posting JSON to the report URL.
  app.use(bodyParser.json({ type: ['json', 'application/csp-report'] }));
  // In 'report' mode violations are only reported; in 'block' mode they are also blocked.
  app.use((req, res, next) => csp(cspReportUrl, CSP === 'report')(req, res, next));

  const reportValue = (req, key) => req.body?.['csp-report']?.[key] || key;
  app.post(cspReportUrl, (req, res) => {
    const directive = reportValue(req, 'effective-directive');
    const blockedUri = reportValue(req, 'blocked-uri');
    log.error(new Error(`CSP: ${directive} doesn't allow ${blockedUri}`), 'csp-violation');
    res.status(204).end();
  });
}

if (redirectSSL === 'true') {
  app.use(enforceSsl());
}

// Behind a reverse proxy such as Render's, set SERVER_SHARETRIBE_TRUST_PROXY to 'true'.
// https://expressjs.com/en/guide/behind-proxies.html
if (TRUST_PROXY === 'true') {
  app.enable('trust proxy');
} else if (TRUST_PROXY === 'false') {
  app.disable('trust proxy');
} else if (TRUST_PROXY !== null) {
  app.set('trust proxy', TRUST_PROXY);
}

app.use(compression());
app.use(cookieParser());

// For the hosting platform's health check, so it comes before the password below. The site
// still mostly works without Postgres, so a database outage is reported but isn't a failure.
app.get('/healthz', async (req, res) => {
  const database = await db
    .query('select 1')
    .then(() => 'up')
    .catch(() => 'down');
  res.json({ ok: true, database });
});

// A staging site can be put behind a password with BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD.
if (!dev && process.env.BASIC_AUTH_USERNAME && process.env.BASIC_AUTH_PASSWORD) {
  app.use(auth.basicAuth(process.env.BASIC_AUTH_USERNAME, process.env.BASIC_AUTH_PASSWORD));
}

// ================ API ================ //

// Passport handles signing in with an identity provider, which the template's API uses.
app.use(passport.initialize());

// The more specific path has to come first.
app.use('/api/cc', ccApiRouter);
app.use('/api', apiRouter);

// ================ Frontend ================ //

// Pages are never cached, so a deploy shows up on the next load.
const page = file => (req, res) =>
  res.set('Cache-Control', 'no-cache').sendFile(path.join(webDir, file));

app.get('/', page('index.html'));
app.get('/sell', page('seller.html'));
// The pages' relative links still use these file names. Send them to the real paths.
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/seller.html', (req, res) => res.redirect(301, '/sell'));

// Only the pages' own files are public. Anything else in web/, like its README, is not.
const ASSET_FILE = /\.(css|js|png|jpe?g|svg)$/i;
const assets = express.static(webDir, { index: false });
app.use((req, res, next) => (ASSET_FILE.test(req.path) ? assets(req, res, next) : next()));

app.use((req, res) => {
  res
    .status(404)
    .type('text')
    .send('Page not found.');
});

// If Sentry is set up, errors are sent there.
log.setupExpressErrorHandler(app);

// ================ Start ================ //

const server = app.listen(PORT, () => {
  console.log(`Campus Connect is listening on port ${PORT}`); // eslint-disable-line no-console
});

// Finish open requests, then close the database connections.
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    server.close(() => db.close());
  });
});
