(async function () {
  const main = document.querySelector("#auth-main");
  const token = CCAuth.queryParam("t");

  if (!token) {
    main.innerHTML = `<h1>Verification link missing</h1>
      <p class="muted">Open the link from your Campus Connect email, or request a new one after signing in.</p>
      <p class="auth-links"><a href="/">Back to Campus Connect</a></p>`;
    return;
  }

  try {
    await CCAuth.verifyEmail(token);
    main.innerHTML = `<h1>Email verified</h1>
      <p class="muted">Thanks. If your account still says it's finishing setup, give it a minute — we approve verified SDSU emails automatically.</p>
      <p class="auth-links"><a class="primary-button" href="/">Continue</a></p>`;
  } catch (error) {
    main.innerHTML = `<h1>Could not verify</h1>
      <p class="auth-error">${error.message}</p>
      <p class="auth-links"><a href="/">Back to Campus Connect</a></p>`;
  }
})();
