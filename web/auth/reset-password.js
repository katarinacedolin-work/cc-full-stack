(function () {
  const main = document.querySelector("#auth-main");
  const token = CCAuth.queryParam("t");
  const email = CCAuth.queryParam("e");

  if (!token || !email) {
    main.innerHTML = `<h1>Reset link missing</h1>
      <p class="muted">Open the link from your Campus Connect email, or request a new one from the sign-in page.</p>
      <p class="auth-links"><a href="/#/sign-in">Back to sign in</a></p>`;
    return;
  }

  main.innerHTML = `<h1>Choose a new password</h1>
    <p class="muted">For ${email}</p>
    <form id="reset-form">
      <div class="field">
        <label for="password">New password</label>
        <input id="password" name="password" type="password" minlength="8" required autocomplete="new-password" />
      </div>
      <button class="primary-button" type="submit">Save password</button>
      <p class="auth-error" id="reset-error" hidden></p>
    </form>`;

  const form = document.querySelector("#reset-form");
  const errorEl = document.querySelector("#reset-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const password = new FormData(form).get("password");
    try {
      await CCAuth.confirmPasswordReset({ email, token, password });
      main.innerHTML = `<h1>Password updated</h1>
        <p class="muted">You can sign in with your new password.</p>
        <p class="auth-links"><a class="primary-button" href="/#/sign-in">Sign in</a></p>`;
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
  });
})();
