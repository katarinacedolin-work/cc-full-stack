/**
 * Stripe Elements helpers for Campus Connect checkout.
 * Loads Stripe.js once, mounts a Card Element on #stripe-card-element, and
 * creates a PaymentMethod + confirms the PaymentIntent returned by /orders.
 */

const STRIPE_JS_URL = "https://js.stripe.com/v3/";

let stripePromise = null;
let stripeInstance = null;
let cardElement = null;
let cardComplete = false;

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripePromise) return stripePromise;
  stripePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Stripe));
      existing.addEventListener("error", () => reject(new Error("Stripe.js failed to load.")));
      if (window.Stripe) resolve(window.Stripe);
      return;
    }
    const script = document.createElement("script");
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error("Stripe.js failed to load."));
    document.head.appendChild(script);
  });
  return stripePromise;
}

async function getStripe(publishableKey) {
  if (!publishableKey) throw new Error("Checkout is not configured yet. Add a Stripe publishable key.");
  const StripeCtor = await loadStripeJs();
  if (!stripeInstance || stripeInstance._ccKey !== publishableKey) {
    stripeInstance = StripeCtor(publishableKey);
    stripeInstance._ccKey = publishableKey;
  }
  return stripeInstance;
}

function unmountCardElement() {
  if (cardElement) {
    try {
      cardElement.destroy();
    } catch {
      // Already unmounted.
    }
    cardElement = null;
  }
  cardComplete = false;
}

/**
 * Mounts the Card Element into #stripe-card-element when present.
 * Call after every render while the checkout view is open.
 */
function mountCheckoutCard(publishableKey) {
  const mount = document.querySelector("#stripe-card-element");
  // Concurrent calls for the same mount node share one in-flight mount so only one Card Element is created.
  if (mount && pendingMount && pendingMount.mount === mount) return pendingMount.promise;

  const promise = mountCheckoutCardNow(publishableKey, mount);
  if (!mount) return promise;
  const entry = { mount, promise };
  pendingMount = entry;
  const clear = () => {
    if (pendingMount === entry) pendingMount = null;
  };
  promise.then(clear, clear);
  return promise;
}

let pendingMount = null;

async function mountCheckoutCardNow(publishableKey, mount) {
  if (!mount) {
    unmountCardElement();
    return null;
  }
  // After a full re-render the mount node is new; remount whenever the live node changed.
  if (cardElement && cardElement._ccMount === mount) return cardElement;

  unmountCardElement();
  if (!publishableKey) {
    const errors = document.querySelector("#stripe-card-errors");
    if (errors) errors.textContent = "Add REACT_APP_STRIPE_PUBLISHABLE_KEY to enable card checkout.";
    return null;
  }
  const stripe = await getStripe(publishableKey);
  // A re-render may have replaced the node while Stripe loaded; the newer call mounts onto the live one.
  if (!mount.isConnected) return cardElement;
  const elements = stripe.elements();
  cardElement = elements.create("card", {
    style: {
      base: {
        color: "#111827",
        fontFamily: "inherit",
        fontSize: "16px",
        "::placeholder": { color: "#9ca3af" }
      },
      invalid: { color: "#b91c1c" }
    }
  });
  cardElement.mount(mount);
  cardElement._ccMount = mount;
  cardElement.on("change", (event) => {
    cardComplete = Boolean(event.complete);
    const errors = document.querySelector("#stripe-card-errors");
    if (errors) errors.textContent = event.error ? event.error.message : "";
  });
  return cardElement;
}

/**
 * Creates a PaymentMethod from the mounted card.
 * @returns {Promise<string>} payment method id (pm_…)
 */
async function createCardPaymentMethod(publishableKey, billingDetails = {}) {
  if (!cardElement) await mountCheckoutCard(publishableKey);
  if (!cardElement) throw new Error("Card form is not ready yet.");
  if (!cardComplete) throw new Error("Enter your card details to continue.");

  const stripe = await getStripe(publishableKey);
  const result = await stripe.createPaymentMethod({
    type: "card",
    card: cardElement,
    billing_details: billingDetails
  });
  if (result.error) throw new Error(result.error.message || "That card could not be used.");
  return result.paymentMethod.id;
}

/**
 * Confirms the PaymentIntent after initiate. Handles 3D Secure when Stripe requires it.
 * When `retryWithCard` is set, the PaymentIntent is being confirmed again after a failure, which
 * detaches its card, so the card currently typed into the Card Element is used instead.
 */
async function confirmCardPayment(
  publishableKey,
  clientSecret,
  { retryWithCard = false, billingDetails = {} } = {}
) {
  if (!clientSecret) return null;
  const stripe = await getStripe(publishableKey);
  let paymentMethod;
  if (retryWithCard) {
    if (!cardElement) await mountCheckoutCard(publishableKey);
    if (!cardElement || !cardComplete) throw new Error("Enter your card details to try again.");
    paymentMethod = { payment_method: { card: cardElement, billing_details: billingDetails } };
  }
  const result = await stripe.confirmCardPayment(clientSecret, paymentMethod);
  if (result.error) {
    throw new Error(result.error.message || "Payment could not be confirmed. Try again.");
  }
  return result.paymentIntent;
}

/**
 * Reads where a PaymentIntent stands, so a resumed checkout knows whether the card was already
 * charged (`requires_capture` or `succeeded`) or still has to be entered.
 * @returns {Promise<string>} the PaymentIntent status
 */
async function getPaymentIntentStatus(publishableKey, clientSecret) {
  const stripe = await getStripe(publishableKey);
  const result = await stripe.retrievePaymentIntent(clientSecret);
  if (result.error) throw new Error(result.error.message || "Could not check that payment. Try again.");
  return result.paymentIntent.status;
}

document.addEventListener("app:render", () => {
  if (state.view !== "checkout") {
    unmountCardElement();
    const mount = document.querySelector("#stripe-card-element");
    if (mount) delete mount.dataset.stripeMounted;
    // Leaving checkout abandons an unpaid order, so the next visit enters a card again instead of
    // silently reusing the one from before. A charged order is kept until it is confirmed.
    const pending = state.pendingCheckout;
    if (pending && !pending.paid && !pending.busy) state.pendingCheckout = null;
  }
});
