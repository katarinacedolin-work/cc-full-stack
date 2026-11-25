/**
 * Sign-in and sign-up screens. Registered into VIEWS / ACTIONS / FORMS like the rest of the app.
 */

function authShell(title, body, { links = "" } = {}) {
  return `<section class="auth-body"><div class="auth-card">
    <div class="eyebrow">Campus Connect · SDSU</div>
    <h1>${title}</h1>
    ${body}
    ${links ? `<div class="auth-links">${links}</div>` : ""}
  </div></section>`;
}

function authError() {
  return state.authError
    ? `<p class="auth-error">${escapeHtml(state.authError)}</p>`
    : "";
}

Object.assign(VIEWS, {
  "sign-in": () =>
    authShell(
      "Sign in",
      `<p class="muted">Use your SDSU email. Google works when that address is on a personal Google account.</p>
      <form data-form="sign-in">
        <div class="field"><label for="sign-in-email">SDSU email</label><input id="sign-in-email" name="email" type="email" required autocomplete="username" value="${escapeHtml(state.authEmail || "")}" /></div>
        <div class="field"><label for="sign-in-password">Password</label><input id="sign-in-password" name="password" type="password" required autocomplete="current-password" /></div>
        ${authError()}
        <button class="primary-button" type="submit">Sign in</button>
      </form>
      <div class="auth-divider">or</div>
      <button type="button" class="ghost-button" data-action="google-sign-in">Continue with Google</button>`,
      {
        links: `<button type="button" class="text-button" data-view="sign-up">Create an account</button>
          <button type="button" class="text-button" data-view="forgot-password">Forgot password</button>`
      }
    ),

  "sign-up": () =>
    authShell(
      "Create your account",
      `<p class="muted">Campus Connect is for current SDSU students. You'll confirm your @sdsu.edu email next.</p>
      <form data-form="sign-up">
        <div class="field"><label for="sign-up-first">First name</label><input id="sign-up-first" name="firstName" type="text" required autocomplete="given-name" /></div>
        <div class="field"><label for="sign-up-last">Last name</label><input id="sign-up-last" name="lastName" type="text" required autocomplete="family-name" /></div>
        <div class="field"><label for="sign-up-email">SDSU email</label><input id="sign-up-email" name="email" type="email" required autocomplete="username" placeholder="you@sdsu.edu" value="${escapeHtml(state.authEmail || "")}" /></div>
        <div class="field"><label for="sign-up-password">Password</label><input id="sign-up-password" name="password" type="password" required minlength="8" autocomplete="new-password" /></div>
        <label class="checkbox-row"><input type="checkbox" name="acceptTerms" value="true" required /><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>, and I'm 18 or older.</span></label>
        ${authError()}
        <button class="primary-button" type="submit">Create account</button>
      </form>
      <div class="auth-divider">or</div>
      <button type="button" class="ghost-button" data-action="google-sign-in">Continue with Google</button>`,
      { links: `<button type="button" class="text-button" data-view="sign-in">Already have an account?</button>` }
    ),

  "forgot-password": () =>
    authShell(
      "Reset your password",
      state.authNotice
        ? `<p class="muted">${escapeHtml(state.authNotice)}</p>`
        : `<p class="muted">We'll email a reset link to your SDSU address.</p>
      <form data-form="forgot-password">
        <div class="field"><label for="forgot-email">SDSU email</label><input id="forgot-email" name="email" type="email" required value="${escapeHtml(state.authEmail || "")}" /></div>
        ${authError()}
        <button class="primary-button" type="submit">Email me a link</button>
      </form>`,
      { links: `<button type="button" class="text-button" data-view="sign-in">Back to sign in</button>` }
    ),

  "check-inbox": () =>
    authShell(
      "Check your inbox",
      `<p class="muted">We sent a verification link to <strong>${escapeHtml(data.session.email || state.authEmail || "your SDSU email")}</strong>. Open it to finish joining Campus Connect.</p>
      ${authError()}
      <button type="button" class="ghost-button" data-action="resend-verification">Resend email</button>`,
      { links: `<button type="button" class="text-button" data-action="sign-out">Sign out</button>` }
    ),

  "pending-approval": () =>
    authShell(
      "Finishing setup",
      `<p class="muted">Your SDSU email is verified. We're activating your account — this usually takes under a minute. Refresh in a moment.</p>
      <button type="button" class="primary-button" data-action="reload">Check again</button>`,
      { links: `<button type="button" class="text-button" data-action="sign-out">Sign out</button>` }
    ),

  "auth-google-confirm": () =>
    authShell(
      "Finish signing up with Google",
      `<p class="muted">Confirm your name and agree to the Terms. Your Google account must use a verified @sdsu.edu email.</p>
      <form data-form="google-confirm">
        <div class="field"><label for="google-first">First name</label><input id="google-first" name="firstName" type="text" required value="${escapeHtml(state.googleFirstName || "")}" /></div>
        <div class="field"><label for="google-last">Last name</label><input id="google-last" name="lastName" type="text" required value="${escapeHtml(state.googleLastName || "")}" /></div>
        <label class="checkbox-row"><input type="checkbox" name="acceptTerms" value="true" required /><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>, and I'm 18 or older.</span></label>
        ${authError()}
        <button class="primary-button" type="submit">Create account</button>
      </form>`,
      { links: `<button type="button" class="text-button" data-view="sign-in">Cancel</button>` }
    )
});

Object.assign(ACTIONS, {
  "google-sign-in": () => {
    const returnTo = IS_SELLER ? "/sell" : "/";
    location.href = `/api/auth/google?${new URLSearchParams({
      from: returnTo,
      defaultReturn: returnTo,
      defaultConfirm: "/#/auth/google-confirm"
    })}`;
  },
  "resend-verification": async () => {
    state.authError = "";
    try {
      await api.resendVerification();
      showToast("Verification email sent.");
    } catch (error) {
      state.authError = error.message;
      render();
    }
  }
});

Object.assign(FORMS, {
  "sign-in": async (fields) => {
    state.authError = "";
    state.authEmail = fields.email;
    try {
      await api.login({ email: fields.email, password: fields.password });
      await afterAuth();
    } catch (error) {
      state.authError = error.message;
      render();
    }
  },
  "sign-up": async (fields) => {
    state.authError = "";
    state.authEmail = fields.email;
    try {
      await api.signup({
        email: fields.email,
        password: fields.password,
        firstName: fields.firstName,
        lastName: fields.lastName,
        acceptTerms: fields.acceptTerms === "true"
      });
      await afterAuth();
    } catch (error) {
      state.authError = error.message;
      render();
    }
  },
  "forgot-password": async (fields) => {
    state.authError = "";
    state.authEmail = fields.email;
    try {
      await api.requestPasswordReset(fields.email);
      state.authNotice = "If that address is on Campus Connect, we sent a reset link. Check your inbox.";
      render();
    } catch (error) {
      state.authError = error.message;
      render();
    }
  },
  "google-confirm": async (fields) => {
    state.authError = "";
    if (fields.acceptTerms !== "true") {
      state.authError = "Agree to the Terms and Privacy Policy to continue.";
      render();
      return;
    }
    try {
      await api.signupWithGoogle({
        firstName: fields.firstName,
        lastName: fields.lastName,
        privateData: {
          termsAcceptedAt: new Date().toISOString(),
          termsVersion: "2026-01"
        }
      });
      location.href = IS_SELLER ? "/sell" : "/";
    } catch (error) {
      state.authError = error.message;
      render();
    }
  }
});

async function afterAuth() {
  await load("session");
  if (!data.session.emailVerified) {
    setView("check-inbox");
    return;
  }
  if (!data.session.approved) {
    setView("pending-approval");
    return;
  }
  location.reload();
}

function readGooglePendingCookie() {
  const match = document.cookie.match(/(?:^|; )st-authinfo=([^;]*)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function openAuthDeepLink() {
  if (location.hash === "#/auth/google-confirm") {
    const pending = readGooglePendingCookie();
    state.googleFirstName = pending?.firstName || "";
    state.googleLastName = pending?.lastName || "";
    state.authEmail = pending?.email || "";
    history.replaceState(null, "", location.pathname);
    setView("auth-google-confirm");
    return true;
  }
  if (location.hash === "#/sign-in") {
    history.replaceState(null, "", location.pathname);
    setView("sign-in");
    return true;
  }
  if (location.hash === "#/sign-up") {
    history.replaceState(null, "", location.pathname);
    setView("sign-up");
    return true;
  }
  return false;
}

/**
 * Picks the right screen after loading the session. Returns true when the rest of the app
 * should not load mock catalog data yet.
 */
async function gateAuth() {
  if (new URLSearchParams(location.search).get("authError")) {
    state.authError = "Google sign-in did not work. Use a Google account registered with your verified @sdsu.edu email.";
    history.replaceState(null, "", location.pathname);
  }

  if (openAuthDeepLink()) {
    return true;
  }

  const session = data.session || {};
  if (!session.userId) {
    setView("sign-in");
    return true;
  }
  if (!session.emailVerified) {
    setView("check-inbox");
    return true;
  }
  if (!session.approved) {
    setView("pending-approval");
    return true;
  }
  return false;
}
