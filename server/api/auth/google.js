const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const loginWithIdp = require('./loginWithIdp');
const { isSdsuEmail } = require('../../cc/auth/sdsu');
const { authErrorCookieOptions } = require('../../api-util/cookieOptions');

const radix = 10;
const PORT = parseInt(process.env.REACT_APP_DEV_API_SERVER_PORT, radix);
const rootUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL;
const clientID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

let callbackURL = null;

const useDevApiServer = process.env.NODE_ENV === 'development' && !!PORT;

if (useDevApiServer) {
  callbackURL = `http://localhost:${PORT}/api/auth/google/callback`;
} else {
  callbackURL = `${rootUrl}/api/auth/google/callback`;
}

const strategyOptions = {
  clientID,
  clientSecret,
  callbackURL,
  passReqToCallback: true,
};

/**
 * Function Passport calls when a redirect returns the user from Google to the application.
 *
 * Normally with Passport, this function is used to validate the received user data, and possibly
 * create a new user and the `done` callback is a session management function provided by Passport.
 * In our case, the Sharetribe SDK handles user creation and session management. Therefore, we only
 * extract user data here and provide a custom session management function in
 * `authenticateGoogleCallback`, that servers as the `done` callback here.
 *
 * @param {Object} req Express request object
 * @param {String} accessToken Access token obtained from Google
 * @param {String} refreshToken Refres token obtained from Google
 * @param {Object} rawReturn Object containing authentication data
 * @param {Object} profile Object containing user information
 * @param {Function} done Session management function, introduced in `authenticateGoogleCallback`
 */
const verifyCallback = (req, accessToken, refreshToken, rawReturn, profile, done) => {
  // We need to add additional parameter `rawReturn` to the callback
  // so that we can access the id_token coming from Google
  // With Google we want to use that id_token instead of accessToken in Sharetribe
  const idpToken = rawReturn.id_token;

  const { email, email_verified, given_name, family_name } = profile._json;
  const state = req.query.state;
  const queryParams = JSON.parse(state);

  const { from, defaultReturn, defaultConfirm, userType } = queryParams;

  // SDSU email is on Microsoft 365; students use a personal Google account registered with
  // their @sdsu.edu address. Do not send Google's `hd` hosted-domain parameter — it only
  // matches Google Workspace domains and would hide those personal accounts.
  if (!email_verified || !isSdsuEmail(email)) {
    const err = new Error('Use a Google account registered with your verified @sdsu.edu email.');
    err.status = 403;
    err.code = 'sdsu-email-required';
    return done(err, null);
  }

  const userData = {
    email,
    firstName: given_name,
    lastName: family_name,
    idpToken,
    from,
    defaultReturn,
    defaultConfirm,
    userType,
  };

  done(null, userData);
};

const googleConfigured = Boolean(clientID && clientSecret);

// Client id and secret are required. Without them Passport has no "google" strategy,
// and authenticate() throws "Unknown authentication strategy".
if (googleConfigured) {
  passport.use(new GoogleStrategy(strategyOptions, verifyCallback));
}

const redirectGoogleNotConfigured = res => {
  const base = (rootUrl || '').replace(/\/$/, '');
  return res.redirect(`${base}/?authError=not-configured`);
};

/**
 * Initiate authentication with Google. When the funcion is called, Passport redirects the
 * user to Google to perform authentication.
 *
 * @param {Object} req Express request object
 * @param {Object} res Express response object
 * @param {Function} next Call the next middleware function in the stack
 */
exports.authenticateGoogle = (req, res, next) => {
  if (!googleConfigured) {
    return redirectGoogleNotConfigured(res);
  }

  const { from, defaultReturn, defaultConfirm, userType } = req.query || {};
  const params = {
    ...(from ? { from } : {}),
    ...(defaultReturn ? { defaultReturn } : {}),
    ...(defaultConfirm ? { defaultConfirm } : {}),
    ...(userType ? { userType } : {}),
  };

  const paramsAsString = JSON.stringify(params);

  // Do not pass `hd`: SDSU email is Microsoft-hosted; students sign in with a personal
  // Google account that uses their @sdsu.edu address.
  passport.authenticate('google', {
    scope: ['openid', 'email', 'profile'],
    state: paramsAsString,
  })(req, res, next);
};

/**
 * This function is called when user returns to this application after authenticating with
 * Google. Passport verifies the recieved tokens and calls a callback function that we've defined
 * for the authentication strategy and an additional session management function, that we introduce
 * in this function.
 *
 * @param {Object} req Express request object
 * @param {Object} res Express response object
 * @param {Function} next Call the next middleware function in the stack
 */
exports.authenticateGoogleCallback = (req, res, next) => {
  if (!googleConfigured) {
    return redirectGoogleNotConfigured(res);
  }

  // We've already defined the `verifyCallback` function for the Passport Google authentication
  // strategy. That function is normally used to verify the user information obtained from identity
  // provider, or alternatively create a new use while an internal Passport function is used to
  // store the user data into session. In our case however, we use the SDK to manage sessions.
  // Therefore, we provide an additional session management function here, that is called from the
  // `verifyCallback` fn.
  const sessionFn = (err, user) => loginWithIdp(err, user, req, res, clientID, 'google');

  passport.authenticate('google', sessionFn)(req, res, next);
};
