(function () {
  const main = document.querySelector("#auth-main");
  const token = CCAuth.queryParam("t");

  function showMissing() {
    main.innerHTML = `<h1>Verification link missing</h1>
      <p class="muted">Open the link from your Campus Connect email, or request a new one after signing in.</p>
      <p class="auth-links"><a href="/">Back to Campus Connect</a></p>`;
  }

  function showSuccess() {
    main.innerHTML = `<h1>Email verified</h1>
      <p class="muted">Thanks. If your account still says it's finishing setup, give it a minute — we approve verified SDSU emails automatically.</p>
      <p class="auth-links"><a class="primary-button" href="/">Continue</a></p>`;
  }

  function showFailure(message) {
    main.innerHTML = `<h1>Could not verify</h1>
      <p class="auth-error" id="verify-fail"></p>
      <p class="auth-links"><a href="/">Back to Campus Connect</a> <button type="button" class="text-button" id="verify-switch">Sign in with a different account</button></p>`;
    document.querySelector("#verify-fail").textContent = message;
    document.querySelector("#verify-switch").addEventListener("click", () => showSignIn());
  }

  // The token stays in this closure. It is never written into the page HTML.
  function showSignIn(message) {
    main.innerHTML = `<h1>Sign in to verify</h1>
      <p class="muted">Sign in with the account this email was sent to. That works on another device or in a mail app, and then we verify the link.</p>
      <form id="verify-sign-in">
        <div class="field">
          <label for="email">SDSU email</label>
          <input id="email" name="email" type="email" required autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required autocomplete="current-password" />
        </div>
        <p class="auth-error" id="verify-error" hidden></p>
        <button class="primary-button" type="submit">Sign in and verify</button>
      </form>
      <div class="auth-divider">or</div>
      <button type="button" class="ghost-button" id="verify-google">Continue with Google</button>
      <p class="auth-links"><a href="/#/forgot-password">Forgot password</a></p>`;

    const form = document.querySelector("#verify-sign-in");
    const errorEl = document.querySelector("#verify-error");
    const submit = form.querySelector('button[type="submit"]');

    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      submit.disabled = true;
      const fields = new FormData(form);
      try {
        await CCAuth.login({
          email: fields.get("email"),
          password: fields.get("password")
        });
        await CCAuth.verifyEmail(token);
        showSuccess();
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        submit.disabled = false;
      }
    });

    document.querySelector("#verify-google").addEventListener("click", () => {
      const returnTo = `/verify-email?${new URLSearchParams({ t: token })}`;
      CCAuth.startGoogle({
        from: returnTo,
        defaultReturn: returnTo,
        defaultConfirm: "/#/auth/google-confirm"
      });
    });
  }

  if (!token) {
    showMissing();
    return;
  }

  (async function start() {
    try {
      const { session } = await CCAuth.getSession();
      if (!session) {
        showSignIn();
        return;
      }
      await CCAuth.verifyEmail(token);
      showSuccess();
    } catch (error) {
      if (error.code === "auth-required") {
        showSignIn();
        return;
      }
      showFailure(error.message);
    }
  })();
})();
