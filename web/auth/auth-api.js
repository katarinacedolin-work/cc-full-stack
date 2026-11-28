/**
 * Small fetch helpers for the standalone auth pages and for shared/api.js.
 */
(function (global) {
  async function ccFetch(path, options = {}) {
    const response = await fetch(`/api/cc${path}`, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options,
      body: options.body != null ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || "Something went wrong. Please try again.");
      error.code = data?.error?.code || "request-failed";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function queryParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  global.CCAuth = {
    ccFetch,
    queryParam,
    getSession: () => ccFetch("/session"),
    signup: (body) => ccFetch("/signup", { method: "POST", body }),
    login: (body) => ccFetch("/login", { method: "POST", body }),
    logout: () => ccFetch("/logout", { method: "POST", body: {} }),
    requestPasswordReset: (email) =>
      ccFetch("/password-reset/request", { method: "POST", body: { email } }),
    confirmPasswordReset: (body) =>
      ccFetch("/password-reset/confirm", { method: "POST", body }),
    verifyEmail: (token) => ccFetch("/verify-email", { method: "POST", body: { token } }),
    resendVerification: () => ccFetch("/resend-verification", { method: "POST", body: {} }),
    startGoogle: ({ from = "/", defaultReturn = "/", defaultConfirm = "/#/auth/google-confirm" } = {}) => {
      const params = new URLSearchParams({
        from,
        defaultReturn,
        defaultConfirm
      });
      location.href = `/api/auth/google?${params}`;
    }
  };
})(window);
