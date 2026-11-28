/**
 * Sign-up, sign-in, password reset, and email verification for /api/cc.
 */

const sharetribeSdk = require('sharetribe-flex-sdk');
const { getSdk, typeHandlers } = require('../../api-util/sdk');
const {
  clearPendingSignupCookieOptions,
  clearPendingSignupTokenCookieOptions,
  parseJsonCookie,
} = require('../../api-util/cookieOptions');
const { httpError } = require('../auth/httpError');
const { createRateLimiter } = require('../auth/rateLimit');
const { isSdsuEmail, normalizeEmail } = require('../auth/sdsu');
const { toSession } = require('../auth/sessionUser');

const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const USING_SSL = process.env.REACT_APP_SHARETRIBE_USING_SSL === 'true';
const TRANSIT_VERBOSE = process.env.REACT_APP_SHARETRIBE_SDK_TRANSIT_VERBOSE === 'true';
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

const TERMS_VERSION = process.env.CC_TERMS_VERSION || '2026-01';

// A few tries per IP are enough; signup and reset are the ones that send email.
const signupLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const resetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

const clientKey = req => req.ip || req.socket.remoteAddress || 'unknown';

const enforceLimit = (limiter, req) => {
  const result = limiter.check(clientKey(req));
  if (!result.ok) {
    throw httpError(
      429,
      'rate-limited',
      `Too many attempts. Try again in ${result.retryAfterSec} seconds.`
    );
  }
};

const sharetribeMessage = (error, fallback) => {
  const first = error?.data?.errors?.[0];
  return first?.title || first?.detail || fallback;
};

/**
 * Loads the signed-in user, or null.
 * @param {Object} req
 * @param {Object} res
 */
const loadCurrentUser = async (req, res) => {
  const sdk = getSdk(req, res);
  try {
    const response = await sdk.currentUser.show();
    return response.data.data;
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      return null;
    }
    throw e;
  }
};

const hasRealSharetribeKeys = () =>
  CLIENT_ID &&
  CLIENT_ID !== 'change-me' &&
  process.env.SHARETRIBE_SDK_CLIENT_SECRET !== 'change-me';

/**
 * GET /api/cc/session
 */
exports.getSession = async (req, res) => {
  if (!hasRealSharetribeKeys()) {
    res.json({ session: null });
    return;
  }
  const user = await loadCurrentUser(req, res);
  res.json({ session: toSession(user) });
};

/**
 * POST /api/cc/signup
 * Body: { email, password, firstName, lastName, acceptTerms: true }
 */
exports.signup = async (req, res) => {
  if (!hasRealSharetribeKeys()) {
    throw httpError(503, 'sharetribe-not-configured', 'Sharetribe keys are not set in .env yet.');
  }
  enforceLimit(signupLimiter, req);
  const { email, password, firstName, lastName, acceptTerms } = req.body || {};
  const normalized = normalizeEmail(email);

  if (!isSdsuEmail(normalized)) {
    throw httpError(400, 'sdsu-email-required', 'Use your @sdsu.edu email to join Campus Connect.');
  }
  if (!password || String(password).length < 8) {
    throw httpError(400, 'weak-password', 'Choose a password with at least 8 characters.');
  }
  if (!String(firstName || '').trim() || !String(lastName || '').trim()) {
    throw httpError(400, 'name-required', 'Add your first and last name.');
  }
  if (acceptTerms !== true) {
    throw httpError(400, 'terms-required', 'Agree to the Terms and Privacy Policy to continue.');
  }

  const sdk = getSdk(req, res);
  try {
    await sdk.currentUser.create({
      email: normalized,
      password,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      privateData: {
        termsAcceptedAt: new Date().toISOString(),
        termsVersion: TERMS_VERSION,
      },
    });
    await sdk.login({ username: normalized, password });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'signup-failed',
      sharetribeMessage(e, 'Could not create your account.')
    );
  }

  const user = await loadCurrentUser(req, res);
  res.status(201).json({ session: toSession(user) });
};

/**
 * POST /api/cc/login
 * Body: { email, password }
 */
exports.login = async (req, res) => {
  if (!hasRealSharetribeKeys()) {
    throw httpError(503, 'sharetribe-not-configured', 'Sharetribe keys are not set in .env yet.');
  }
  enforceLimit(loginLimiter, req);
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!email || !password) {
    throw httpError(400, 'credentials-required', 'Enter your email and password.');
  }

  const sdk = getSdk(req, res);
  try {
    await sdk.login({ username: email, password });
  } catch (e) {
    throw httpError(401, 'login-failed', 'That email or password is not right.');
  }

  const user = await loadCurrentUser(req, res);
  res.json({ session: toSession(user) });
};

/**
 * POST /api/cc/logout
 */
exports.logout = async (req, res) => {
  const sdk = getSdk(req, res);
  try {
    await sdk.logout();
  } catch (e) {
    // Already signed out is fine.
    if (e.status !== 403 && e.status !== 401) {
      throw e;
    }
  }
  res.json({ session: null });
};

/**
 * POST /api/cc/password-reset/request
 * Body: { email }
 */
exports.requestPasswordReset = async (req, res) => {
  enforceLimit(resetLimiter, req);
  const email = normalizeEmail(req.body?.email);
  if (!isSdsuEmail(email)) {
    // Don't reveal whether the address exists.
    res.json({ ok: true });
    return;
  }
  const sdk = getSdk(req, res);
  try {
    await sdk.passwordReset.request({ email });
  } catch (e) {
    // Sharetribe may error when the email is unknown; still answer ok.
  }
  res.json({ ok: true });
};

/**
 * POST /api/cc/password-reset/confirm
 * Body: { email, token, password }
 * The token comes from Sharetribe's email link: /reset-password?t=…&e=…
 */
exports.confirmPasswordReset = async (req, res) => {
  enforceLimit(resetLimiter, req);
  const email = normalizeEmail(req.body?.email);
  const token = req.body?.token;
  const password = req.body?.password;

  if (!email || !token || !password) {
    throw httpError(
      400,
      'reset-incomplete',
      'Open the link from your email and choose a new password.'
    );
  }
  if (String(password).length < 8) {
    throw httpError(400, 'weak-password', 'Choose a password with at least 8 characters.');
  }

  const sdk = getSdk(req, res);
  try {
    await sdk.passwordReset.reset({
      email,
      passwordResetToken: token,
      newPassword: password,
    });
  } catch (e) {
    throw httpError(
      400,
      'reset-failed',
      sharetribeMessage(e, 'That reset link is invalid or has expired. Request a new one.')
    );
  }
  res.json({ ok: true });
};

/**
 * POST /api/cc/verify-email
 * Body: { token }
 * The token comes from Sharetribe's email link: /verify-email?t=…
 *
 * currentUser.verifyEmail only succeeds for the signed-in user the token was
 * issued to. A mail app or another device has no session, and Sharetribe then
 * answers 403, the same status as an invalid token. Ask for sign-in first.
 */
exports.verifyEmail = async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) {
    throw httpError(400, 'token-required', 'Open the verification link from your email.');
  }

  const user = await loadCurrentUser(req, res);
  if (!user) {
    throw httpError(
      401,
      'auth-required',
      'Sign in to verify this email. This link stays valid after you sign in.'
    );
  }

  const sdk = getSdk(req, res);
  try {
    await sdk.currentUser.verifyEmail({ verificationToken: token });
  } catch (e) {
    const reported = e?.data?.errors?.[0];
    const title = reported?.title;
    const genericStatus = !title || /^(forbidden|unauthorized)$/i.test(title);
    throw httpError(
      e.status || 400,
      'verify-failed',
      (!genericStatus && title) ||
        reported?.detail ||
        'That verification link is invalid, has expired, or belongs to a different account.'
    );
  }

  const verified = await loadCurrentUser(req, res);
  res.json({ session: toSession(verified) });
};

/**
 * POST /api/cc/resend-verification
 */
exports.resendVerification = async (req, res) => {
  enforceLimit(resetLimiter, req);
  const sdk = getSdk(req, res);
  try {
    await sdk.currentUser.sendVerificationEmail();
  } catch (e) {
    throw httpError(
      e.status || 400,
      'resend-failed',
      sharetribeMessage(e, 'Could not send a verification email. Sign in and try again.')
    );
  }
  res.json({ ok: true });
};

/**
 * POST /api/cc/signup-with-google
 * Body: { firstName, lastName, acceptTerms: true }
 * Uses the pending Google cookies set by /api/auth/google/callback.
 * Terms are recorded only after the caller agrees, and the timestamp comes from the server.
 */
exports.signupWithGoogle = async (req, res) => {
  enforceLimit(signupLimiter, req);
  const idpToken = req.cookies['st-idp-token'];
  const authInfo = parseJsonCookie(req.cookies['st-authinfo']);
  if (!idpToken || authInfo?.idpId !== 'google') {
    throw httpError(400, 'google-session-expired', 'Start again with Continue with Google.');
  }
  if (!isSdsuEmail(authInfo.email)) {
    throw httpError(
      400,
      'sdsu-email-required',
      'Use a Google account registered with your @sdsu.edu email.'
    );
  }
  if (!GOOGLE_CLIENT_ID) {
    throw httpError(500, 'google-not-configured', 'Google sign-in is not configured.');
  }

  const firstName = String(req.body?.firstName || authInfo.firstName || '').trim();
  const lastName = String(req.body?.lastName || authInfo.lastName || '').trim();
  if (!firstName || !lastName) {
    throw httpError(400, 'name-required', 'Add your first and last name.');
  }
  if (req.body?.acceptTerms !== true) {
    throw httpError(400, 'terms-required', 'Agree to the Terms and Privacy Policy to continue.');
  }

  const privateData = {
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: TERMS_VERSION,
  };

  const tokenStore = sharetribeSdk.tokenStore.expressCookieStore({
    clientId: CLIENT_ID,
    req,
    res,
    secure: USING_SSL,
  });
  const sdk = sharetribeSdk.createInstance({
    transitVerbose: TRANSIT_VERBOSE,
    clientId: CLIENT_ID,
    clientSecret: process.env.SHARETRIBE_SDK_CLIENT_SECRET,
    tokenStore,
    typeHandlers,
    ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
  });

  try {
    await sdk.currentUser.createWithIdp({
      idpId: 'google',
      idpClientId: GOOGLE_CLIENT_ID,
      idpToken,
      email: normalizeEmail(authInfo.email),
      firstName,
      lastName,
      privateData,
    });
    await sdk.loginWithIdp({
      idpId: 'google',
      idpClientId: GOOGLE_CLIENT_ID,
      idpToken,
    });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'google-signup-failed',
      sharetribeMessage(e, 'Could not create your account with Google.')
    );
  }

  res
    .clearCookie('st-authinfo', clearPendingSignupCookieOptions())
    .clearCookie('st-idp-token', clearPendingSignupTokenCookieOptions());

  const user = await loadCurrentUser(req, res);
  res.status(201).json({ session: toSession(user) });
};
