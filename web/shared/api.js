/**
 * The data layer. This is the only file that knows where data comes from.
 *
 * Every function on `api` is async and takes and returns plain JSON, so each one maps onto one request.
 * Today they run against an in-memory mock database (mock-data.js). To connect a real service, replace
 * the function bodies with requests and keep the names, arguments and return shapes.
 *
 * What the rest of the app relies on:
 *  - Results are copies. Nothing the app holds changes until it asks again.
 *  - A failure is a thrown Error whose message can be shown to the user as it is.
 *  - Anything a server would decide is decided here: ids, timestamps, stock, order status, who is notified.
 *  - "Me" is whoever is signed in. In the mock that is the buyer account on index.html and the seller
 *    account on seller.html.
 */
const api = (() => {
  const HANDOFF_KEY = "campus-connect-mock-db";
  const asSeller = document.body.dataset.mode === "seller";
  const db = restoreHandoff() || createMockDb();

  /* ---------- Mock plumbing ---------- */

  let sequence = 0;
  const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${sequence++}`;
  const now = () => new Date().toISOString();
  const fail = (message) => { throw new Error(message); };
  const find = (list, id, what) => list.find((item) => item.id === id) || fail(`That ${what} is no longer here.`);
  const pick = (source, keys) => Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
  const requireAll = (fields, keys, message) => keys.every((key) => String(fields[key] ?? "").trim()) || fail(message);

  const me = () => (asSeller ? db.seller : db.buyer);
  const mySellerProfile = () => find(db.sellers, me().id, "profile");
  const myName = () => (asSeller ? mySellerProfile().name : db.buyer.account.displayName);
  const listingOf = (order) => db.listings.find((listing) => listing.id === order.listingId);
  const myListing = (id) => {
    const listing = find(db.listings, id, "listing");
    return listing.sellerId === me().id ? listing : fail("Only the seller can change that listing.");
  };
  const statsFor = (listingId) => (db.seller.listingStats[listingId] ||= { views: 0, saves: 0, messages: 0, orders: 0 });

  function restoreHandoff() {
    const saved = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  const listeners = new Set();
  const emit = (event) => listeners.forEach((listener) => listener(event));

  /** Adds a notification, unless that person turned the category off in their settings. */
  function notify(account, settingKey, notification) {
    const settings = account.settings || account.account;
    if (settings[settingKey]) account.notifications.unshift({ id: newId("note"), unread: true, at: now(), ...notification });
  }

  function startConversation(account, conversation) {
    account.conversations.unshift({ unread: false, messages: [], ...conversation });
    return account.conversations[0];
  }

  /** The demo buyer and the demo seller share one thread. A message sent on one page shows up on the other. */
  function mirrorOf(conversation) {
    return asSeller
      ? db.buyer.conversations.find((entry) => entry.id === conversation.buyerThreadId)
      : db.seller.conversations.find((entry) => entry.buyerThreadId === conversation.id);
  }

  /** Keeps the seller's name on their profile and on every listing card that shows it. */
  function renameSeller(sellerId, name) {
    const seller = find(db.sellers, sellerId, "profile");
    Object.assign(seller, { name, initials: initialsOf(name) });
    db.listings.filter((listing) => listing.sellerId === sellerId).forEach((listing) => Object.assign(listing, { seller: name, initials: seller.initials }));
  }

  /* ---------- Availability ---------- */

  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const BOOKING_WINDOW_DAYS = 60;
  const SLOT_STEP_MINUTES = 30;
  const OPEN_STATUSES = ["requested", "confirmed"];

  /** The demo seller's services are booked from her weekly hours. Every other seller lists fixed openings. */
  const usesWeeklyHours = (listing) => listing.kind === "service" && listing.sellerId === db.seller.id;

  /** When the seller is already taken on a day: open bookings, plus calendar events once a calendar is connected. */
  function busyBlocks(date) {
    const bookings = db.seller.orders
      .filter((order) => order.kind === "service" && order.date === date && OPEN_STATUSES.includes(order.status))
      .map((order) => ({ start: clockMinutes(order.time), length: durationMinutes(listingOf(order)) }));
    const events = db.seller.calendar.connected
      ? db.seller.calendar.events.filter((event) => event.date === date).map((event) => ({ start: clockMinutes(event.time), length: 60 }))
      : [];
    return [...bookings, ...events];
  }

  function weeklySlots(listing) {
    const duration = durationMinutes(listing);
    const clock = new Date();
    const minutesNow = clock.getHours() * 60 + clock.getMinutes();
    const slots = [];
    for (let offset = 0; offset < BOOKING_WINDOW_DAYS; offset += 1) {
      const date = addDays(todayKey(), offset);
      const busy = busyBlocks(date);
      db.seller.schedule.days[WEEKDAYS[parseDateKey(date).getDay()]].forEach((range) => {
        for (let start = range.start; start + duration <= range.end; start += SLOT_STEP_MINUTES) {
          const past = offset === 0 && start <= minutesNow;
          const taken = busy.some((block) => start < block.start + block.length && start + duration > block.start);
          if (!past && !taken) slots.push({ date, time: clockLabel(start) });
        }
      });
    }
    return slots;
  }

  /** Seed listings describe openings as labels such as "Sat · 2:00 PM". Each becomes the next date that matches. */
  function dateForLabel(day) {
    const today = todayKey();
    if (day === "Today") return today;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
    if (day === "Tomorrow" || weekday >= 0) {
      for (let offset = 1; offset <= 7; offset += 1) {
        const date = addDays(today, offset);
        if (day === "Tomorrow" || parseDateKey(date).getDay() === weekday) return date;
      }
    }
    const dated = new Date(`${day}, ${new Date().getFullYear()}`);
    if (Number.isNaN(dated.getTime())) return null;
    if (dateKey(dated) < today) dated.setFullYear(dated.getFullYear() + 1);
    return dateKey(dated);
  }

  function fixedSlots(listing) {
    return (listing.slots || [])
      .map((label) => {
        const [day, time = ""] = label.split(" · ");
        return { date: dateForLabel(day), time };
      })
      .filter((slot) => slot.date)
      .sort((a, b) => a.date.localeCompare(b.date) || (clockMinutes(a.time) ?? 0) - (clockMinutes(b.time) ?? 0));
  }

  /* ---------- Orders ---------- */

  function makeTicketCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return `CC${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
  }

  /** An order the demo buyer placed with the demo seller shows up in her Seller Hub. */
  function deliverToSeller(order, listing) {
    const buyerName = db.buyer.account.displayName;
    const pickupNote = { product: "Pickup once you accept", ticket: [listing.availability, listing.meeting].filter(Boolean).join(" · ") }[order.kind];
    const sellerOrder = {
      id: newId("so"), listingId: listing.id, kind: order.kind, buyer: buyerName, initials: initialsOf(buyerName), accent: "lilac",
      status: order.status, date: order.date, time: order.time, qty: order.quantity, amount: order.total, when: pickupNote,
      placedAt: order.placedAt, updatedAt: order.placedAt, note: "", ticketCode: order.ticketCode, buyerOrderId: order.id,
      conversationId: db.seller.conversations.find((conversation) => conversation.buyerThreadId)?.id || null
    };
    order.sellerOrderId = sellerOrder.id;
    db.seller.orders.unshift(sellerOrder);
    const title = order.kind === "ticket" ? "Ticket sold" : order.kind === "product" ? "New order" : order.status === "confirmed" ? "New booking" : "New booking request";
    notify(db.seller, "notifyRequests", { category: "orders", title, body: `${buyerName} · ${listing.title}`, emoji: listing.emoji, accent: listing.accent, action: "order", orderId: sellerOrder.id });
  }

  /** Copies a change the seller made onto the buyer's side of the same order, and tells the buyer. */
  function syncBuyerOrder(sellerOrder, title) {
    const order = db.buyer.orders.find((entry) => entry.id === sellerOrder.buyerOrderId);
    if (!order) return;
    Object.assign(order, pick(sellerOrder, ["status", "date", "time", "cancelReason"]));
    const listing = listingOf(order);
    const when = order.date && OPEN_STATUSES.includes(order.status) ? ` · ${slotLabel(order)}` : "";
    notify(db.buyer, "notifyOrders", { title, body: `${listing?.title || "Your order"}${when}`, emoji: listing?.emoji || "✦", accent: listing?.accent || "lilac", action: "order", orderId: order.id });
  }

  function completeSellerOrder(order) {
    Object.assign(order, { status: "completed", updatedAt: now() });
    db.seller.payouts.available += order.amount;
    statsFor(order.listingId).orders += 1;
  }

  const NEXT_STATUSES = { requested: ["confirmed", "cancelled"], confirmed: ["ready", "completed", "cancelled"], ready: ["completed", "cancelled"] };

  /* ---------- Chores ---------- */

  const CHORE_APPROVAL_DELAY = 1600;

  function recordChorePayment(chore) {
    chore.status = "paid";
    const order = {
      id: newId("order"), kind: "chore", choreId: chore.id, title: chore.title, emoji: chore.emoji, accent: chore.accent, status: "paid",
      note: chore.meta, total: amountValue(chore.amount), payer: chore.poster, payee: chore.offerName, placedAt: now()
    };
    db.buyer.orders.unshift(order);
    return order;
  }

  /** Nobody is on the other end of a seed chore, so the poster "approves and pays" a moment after an offer. */
  function scheduleChoreApproval(chore) {
    window.setTimeout(() => {
      if (chore.status !== "requested") return;
      const order = recordChorePayment(chore);
      const thread = db.buyer.conversations.find((conversation) => conversation.id === `chore-${chore.id}`);
      thread?.messages.push({ from: "them", text: `Approved. I paid ${chore.amount} through Campus Connect.`, at: now() });
      emit({ type: "chore-paid", choreId: chore.id, orderId: order.id, poster: chore.poster });
    }, CHORE_APPROVAL_DELAY);
  }

  db.chores.filter((chore) => chore.offeredByMe && chore.status === "requested").forEach(scheduleChoreApproval);

  /** A post on the job, housing or chore board, built from the short form the poster fills in. */
  function boardPost(prefix, fields, { emoji, accent, kicker, facts }) {
    const [first, second, price] = facts.map(([, key]) => fields[key]);
    return {
      id: newId(prefix), title: fields.title, kicker, meta: `${first} · ${second}`, price, accent, emoji, summary: fields.summary,
      poster: myName(), initials: initialsOf(myName()), mine: true, facts: facts.map(([label, key]) => [label, fields[key]])
    };
  }

  /* ---------- Listings ---------- */

  const CERTIFICATION_BY_CATEGORY = { Learn: "tutor", Create: "creator", Beauty: "nail tech", Tech: "editor", Help: "campus helper", Events: "event photographer" };
  const LISTING_FIELDS = ["title", "category", "price", "unit", "description", "meeting", "emoji", "accent", "status", "quantityAvailable", "condition", "availability"];

  function cardBrand(digits) {
    if (/^3[47]/.test(digits)) return "Amex";
    return { 4: "Visa", 5: "Mastercard", 6: "Discover" }[digits[0]] || "Card";
  }

  /* ---------- Endpoints ---------- */

  async function ccFetch(path, options = {}) {
    const response = await fetch(`/api/cc${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
      body: options.body != null ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* Which half of the site this page is. Each has its own inbox and its own bell. */
  const side = asSeller ? "seller" : "buyer";
  const threadPath = (id, rest = "") => `/conversations/${encodeURIComponent(id)}${rest}`;

  /* The last session the server returned, for the name and email on the account page. */
  let lastSession = null;

  const NOTIFY_KEYS = ["notifyMessages", "notifyOrders", "notifyRequests", "notifyReviews"];

  /** Which kinds of notification reach the bell. Everything is on when the server can't be asked. */
  async function getNotifySettings() {
    try {
      const { settings } = await ccFetch("/settings");
      return settings;
    } catch {
      return {};
    }
  }

  /** Saves the notification switches among `changes`, and answers whether there were any. */
  async function saveNotifySettings(changes) {
    const switches = pick(changes, NOTIFY_KEYS);
    if (!Object.keys(switches).length) return false;
    await ccFetch("/settings", { method: "PATCH", body: switches });
    return true;
  }

  /* ---------- Changes that arrive on their own ---------- */

  const CHANGES_EVERY_MS = 20000;
  let changes = { user: "", key: "", at: null, known: false };
  let changesTimer = null;

  /** Asks whether a message, notification or order changed since the last time, and tells the listeners if so. */
  async function checkForChanges() {
    if (document.visibilityState !== "visible") return;
    try {
      const query = changes.key ? `?user=${encodeURIComponent(changes.user)}&key=${encodeURIComponent(changes.key)}` : "";
      const next = await ccFetch(`/changes${query}`);
      const changed = changes.known && next.at !== changes.at;
      changes = { ...next, known: true };
      if (changed) emit({ type: "changed" });
    } catch (error) {
      /* Signed out: there is nothing to watch until the page loads again. Anything else is tried again next round. */
      if (error.status === 401) window.clearInterval(changesTimer);
    }
  }

  function watchForChanges() {
    if (changesTimer) return;
    changesTimer = window.setInterval(checkForChanges, CHANGES_EVERY_MS);
    document.addEventListener("visibilitychange", checkForChanges);
    checkForChanges();
  }

  const endpoints = {
    /* Session — these hit the real /api/cc auth routes. Everything else is still mock for now. */

    getSession: async () => {
      const { session } = await ccFetch("/session");
      lastSession = session || null;
      return session || { userId: "" };
    },
    signOut: async () => {
      sessionStorage.removeItem(HANDOFF_KEY);
      try {
        await ccFetch("/logout", { method: "POST", body: {} });
      } catch {
        // Already signed out is fine.
      }
    },
    signup: async (fields) => {
      const { session } = await ccFetch("/signup", { method: "POST", body: fields });
      return session;
    },
    login: async (fields) => {
      const { session } = await ccFetch("/login", { method: "POST", body: fields });
      return session;
    },
    signupWithGoogle: async (fields) => {
      const { session } = await ccFetch("/signup-with-google", { method: "POST", body: fields });
      return session;
    },
    requestPasswordReset: (email) => ccFetch("/password-reset/request", { method: "POST", body: { email } }),
    resendVerification: () => ccFetch("/resend-verification", { method: "POST", body: {} }),

    /* Catalog */

    getCategories: () => db.categories,
    getSchoolServices: () => db.schoolServices,
    getAgents: () => db.agents,
    getApartments: () => db.apartments,
    getSellers: () => db.sellers,
    getStores: async () => {
      try {
        const { stores } = await ccFetch("/stores");
        return stores.length ? stores : db.stores;
      } catch {
        return db.stores;
      }
    },
    /** Services booked from weekly hours also carry `nextOpening` ({ date, time } or null). */
    getListings: async () => {
      try {
        const mine = document.body.dataset.mode === "seller";
        const { listings } = await ccFetch(`/listings${mine ? "?mine=1" : ""}`);
        return listings.map((listing) =>
          usesWeeklyHours(listing) ? { ...listing, nextOpening: weeklySlots(listing)[0] || null } : listing
        );
      } catch {
        return db.listings.map((listing) =>
          usesWeeklyHours(listing) ? { ...listing, nextOpening: weeklySlots(listing)[0] || null } : listing
        );
      }
    },
    /** Open times for a service. `duration` is set when times come from weekly hours, so the picker shows a full calendar. */
    getAvailability: (listingId) => {
      const listing = find(db.listings, listingId, "listing");
      return usesWeeklyHours(listing) ? { duration: durationMinutes(listing), slots: weeklySlots(listing) } : { duration: null, slots: fixedSlots(listing) };
    },

    createListing: async (fields) => {
      requireAll(fields, ["title", "description"], "Add a title and a description.");
      if (!(Number(fields.price) > 0)) fail("Add a price.");
      const { listing } = await ccFetch("/listings", { method: "POST", body: fields });
      return listing;
    },

    /** `changes` may hold any editable listing field, plus `collection` (the name of the store collection it belongs in). */
    updateListing: async (id, changes) => {
      const { listing } = await ccFetch(`/listings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: changes
      });
      return listing;
    },

    duplicateListing: async (id) => {
      const { listing } = await ccFetch(`/listings/${encodeURIComponent(id)}/duplicate`, {
        method: "POST",
        body: {}
      });
      return listing;
    },

    deleteListing: async (id) => {
      await ccFetch(`/listings/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    uploadListingImage: async (file) => {
      const response = await fetch(
        `/api/cc/images?filename=${encodeURIComponent(file.name || "photo.jpg")}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) fail(payload?.error?.message || "Could not upload that photo.");
      return payload.image;
    },

    /* Boards */

    getJobs: () => db.jobs,
    getHousing: () => db.housing,
    getChores: () => db.chores,
    getTicketPosts: () => db.ticketPosts,

    postJob: (fields) => {
      requireAll(fields, ["title", "where", "schedule", "pay", "summary"], "Fill in the title, where, schedule, pay, and description.");
      db.jobs.unshift(boardPost("job", fields, { emoji: "📌", accent: "coral", kicker: "Posted by you", facts: [["Schedule", "schedule"], ["Where", "where"], ["Pay", "pay"]] }));
      return db.jobs[0];
    },

    postHousing: (fields) => {
      requireAll(fields, ["title", "place", "dates", "rent", "summary"], "Fill in the place, neighborhood, dates, rent, and details.");
      db.housing.unshift(boardPost("home", fields, { emoji: "🏠", accent: "butter", kicker: "Posted by you", facts: [["Dates", "dates"], ["Place", "place"], ["Rent", "rent"]] }));
      return db.housing[0];
    },

    postChore: (fields) => {
      requireAll(fields, ["title", "when", "where", "pay", "summary"], "Fill in the chore, when, where, pay, and details.");
      const amount = fields.pay.match(/\$\d+(?:\.\d+)?/)?.[0] || fields.pay;
      db.chores.unshift({ ...boardPost("chore", fields, { emoji: "📌", accent: "coral", facts: [["When", "when"], ["Where", "where"], ["Pay", "pay"]] }), amount, status: "open" });
      return db.chores[0];
    },

    /** Tells the poster you can take their chore. They approve and pay later, which arrives through `subscribe`. */
    offerOnChore: (id) => {
      const chore = find(db.chores, id, "chore");
      if (chore.mine || chore.status !== "open") fail("That chore is not open any more.");
      Object.assign(chore, { status: "requested", offeredByMe: true, offerName: myName() });
      const threadId = `chore-${chore.id}`;
      const thread = db.buyer.conversations.find((conversation) => conversation.id === threadId)
        || startConversation(db.buyer, { id: threadId, name: chore.poster, initials: chore.initials, accent: chore.accent, context: chore.title });
      thread.messages.push({ from: "me", text: "I can take this chore.", at: now() });
      scheduleChoreApproval(chore);
      return chore;
    },

    approveChore: (id) => {
      const chore = find(db.chores, id, "chore");
      if (!chore.mine || !["requested", "approved"].includes(chore.status)) fail("There is no offer to approve on that chore.");
      chore.status = "approved";
      return chore;
    },

    /** Pays the student you approved. Returns the order that records the payment. */
    payForChore: (id) => {
      const chore = find(db.chores, id, "chore");
      if (!chore.mine || chore.status !== "approved") fail("Approve a student before you pay.");
      return recordChorePayment(chore);
    },

    postTicket: ({ kind, event, price }) => {
      const resell = kind === "resell";
      const amount = Number(String(price ?? "").replace(/[^0-9.]/g, ""));
      if (!event || (resell && !(amount > 0))) fail(resell ? "Add the event and a price." : "Add the event.");
      const post = { id: newId("tpost"), kind: resell ? "resell" : "request", event, name: myName(), initials: initialsOf(myName()), accent: "sky", mine: true, messages: [] };
      if (resell) post.price = String(Math.round(amount * 100) / 100);
      db.ticketPosts.push(post);
      return post;
    },

    sendTicketMessage: (postId, text) => {
      const post = find(db.ticketPosts, postId, "post");
      if (!text) fail("Write a message first.");
      post.messages.push({ from: "me", text, at: now() });
      return post;
    },

    /* Account */

    /** The name and email come from the session, and the notification switches from the server. The privacy switches are still mock. */
    getAccount: async () => {
      if (!lastSession) await endpoints.getSession();
      return {
        ...db.buyer.account,
        ...(lastSession ? { displayName: lastSession.displayName, email: lastSession.email } : {}),
        ...(await getNotifySettings())
      };
    },

    updateAccount: async (changes) => {
      if ("displayName" in changes) {
        if (!String(changes.displayName).trim()) fail("Add a display name.");
        const { session } = await ccFetch("/account", { method: "PATCH", body: { displayName: changes.displayName } });
        lastSession = session;
      }
      await saveNotifySettings(changes);
      Object.assign(db.buyer.account, pick(changes, ["profileVisible", "showCampus"]));
      return endpoints.getAccount();
    },

    getPaymentMethods: () => db.buyer.paymentMethods,

    /** Takes the card form as typed. Only the brand, last four digits and expiry are kept. */
    addPaymentMethod: ({ name, number, exp }) => {
      const digits = String(number ?? "").replace(/\D/g, "");
      const expiry = String(exp ?? "").match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
      if (!name || digits.length < 13 || digits.length > 19 || !expiry) fail("Check the name, card number, and expiration.");
      const today = new Date();
      if (new Date(2000 + Number(expiry[2]), Number(expiry[1]), 1) <= today) fail("That card is expired.");
      const methods = db.buyer.paymentMethods;
      methods.push({ id: newId("card"), brand: cardBrand(digits), last4: digits.slice(-4), exp: `${expiry[1]}/${expiry[2]}`, name, isDefault: methods.length === 0 });
      return methods.at(-1);
    },

    removePaymentMethod: (id) => {
      const removed = find(db.buyer.paymentMethods, id, "card");
      db.buyer.paymentMethods = db.buyer.paymentMethods.filter((method) => method.id !== id);
      if (removed.isDefault && db.buyer.paymentMethods[0]) db.buyer.paymentMethods[0].isDefault = true;
    },

    setDefaultPaymentMethod: (id) => {
      find(db.buyer.paymentMethods, id, "card");
      db.buyer.paymentMethods.forEach((method) => { method.isDefault = method.id === id; });
    },

    /* Buying */

    getConfig: async () => {
      const payload = await ccFetch("/config");
      return payload;
    },

    getOrders: async () => {
      try {
        const { orders } = await ccFetch("/orders?role=buyer");
        return orders;
      } catch {
        return db.buyer.orders;
      }
    },

    estimateOrder: async ({ listingId, date, time, quantity }) => {
      const payload = await ccFetch("/orders/line-items", {
        method: "POST",
        body: { listingId, date, time, quantity }
      });
      return payload;
    },

    /**
     * Starts checkout with a Stripe payment method id, then the client confirms the PaymentIntent
     * and calls confirmOrderPayment.
     */
    placeOrder: async ({ listingId, date, time, quantity, paymentMethodId, note }) => {
      const payload = await ccFetch("/orders", {
        method: "POST",
        body: { listingId, date, time, quantity, paymentMethodId, note }
      });
      return payload;
    },

    confirmOrderPayment: async (orderId) => {
      const { order } = await ccFetch(`/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
        method: "POST",
        body: {}
      });
      return order;
    },

    orderAction: async (orderId, action, body = {}) => {
      const { order } = await ccFetch(
        `/orders/${encodeURIComponent(orderId)}/actions/${encodeURIComponent(action)}`,
        { method: "POST", body }
      );
      return order;
    },

    /** Buyer confirms pickup ("Got it"). */
    confirmOrderReceived: (orderId) => api.orderAction(orderId, "mark-received"),

    /** Buyer opens a dispute after the seller marked the order ready / delivered. */
    reportOrderProblem: (orderId, { reason, message } = {}) =>
      api.orderAction(orderId, "dispute", { reason, message }),

    /** Leave a review after the order is complete. */
    submitOrderReview: (orderId, { rating, content } = {}) =>
      api.orderAction(orderId, "review-customer", { rating, content }),

    /* Messages and notifications, for whoever is signed in */

    /**
     * This page's inbox, newest first. Each conversation is
     * { id, kind, name, initials, accent, personId, context, unread, done, messages: [{ from: "me" | "them", text, at }] },
     * plus sellerId, listingId and orderId where there is one.
     * The inbox is empty, rather than the page failing, when it can't be loaded.
     */
    getConversations: async () => {
      try {
        const { conversations } = await ccFetch(`/conversations?side=${side}`);
        return conversations;
      } catch (error) {
        console.error(error);
        return [];
      }
    },

    /**
     * Finds or starts the conversation about an order ({ orderId }), about a listing ({ listingId }) or with a
     * seller ({ sellerId }). The other person hears nothing until the first message is sent.
     */
    openConversation: async ({ orderId, listingId, sellerId, agentId, jobId, housingId }) => {
      if (agentId || jobId || housingId) fail("Messages about board posts open when the boards go live.");
      const about = orderId ? { orderId } : listingId ? { listingId } : { sellerId };
      const { conversation } = await ccFetch("/conversations", { method: "POST", body: about });
      return conversation;
    },

    sendMessage: async (conversationId, text) => {
      if (!text) fail("Write a message first.");
      const { conversation } = await ccFetch(threadPath(conversationId, "/messages"), { method: "POST", body: { text } });
      return conversation;
    },

    markConversationRead: async (id) => { await ccFetch(threadPath(id, "/read"), { method: "POST", body: {} }); },

    /**
     * This page's bell, newest first. Each is { id, unread, category, title, body, at, emoji, accent, action },
     * plus orderId, conversationId or listingId for where a click leads.
     */
    getNotifications: async () => {
      try {
        const { notifications } = await ccFetch(`/notifications?side=${side}`);
        return notifications;
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    markNotificationRead: async (id) => { await ccFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: {} }); },
    markAllNotificationsRead: async () => { await ccFetch(`/notifications/read-all?side=${side}`, { method: "POST", body: {} }); },

    /* Support */

    createSupportCase: ({ topic, message }) => {
      if (!message) fail("Tell us a little about what happened.");
      db.supportCases.push({ id: newId("case"), topic, message, from: me().id, at: now() });
    },

    submitReport: ({ reason, message }) => {
      if (!message) fail("Describe what happened.");
      db.reports.push({ id: newId("report"), reason, message, from: me().id, at: now() });
    },

    /* Selling: orders */

    /** Newest activity first. */
    getSellerOrders: async () => {
      try {
        const { orders } = await ccFetch("/orders?role=seller");
        return orders;
      } catch {
        return [...db.seller.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    },

    /**
     * Seller Hub buttons. Products never accept (purchase has no accept step). Reschedule and
     * request-review are removed. Cancel/complete for paid orders go through the operator API.
     */
    updateOrderStatus: async (id, status, { reason, message } = {}) => {
      if (status === "confirmed") return api.orderAction(id, "accept");
      if (status === "ready") {
        const { order } = await ccFetch(`/orders/${encodeURIComponent(id)}/ready-for-pickup`, {
          method: "POST",
          body: {}
        });
        return order;
      }
      if (status === "completed") {
        const { order } = await ccFetch(`/orders/${encodeURIComponent(id)}/operator/complete`, {
          method: "POST",
          body: {}
        });
        return order;
      }
      if (status === "cancelled") {
        // Declining a booking request uses the provider decline transition.
        try {
          return await api.orderAction(id, "decline", { reason, message });
        } catch {
          const { order } = await ccFetch(`/orders/${encodeURIComponent(id)}/operator/cancel`, {
            method: "POST",
            body: { reason, message }
          });
          return order;
        }
      }
      fail("That order can't move to that step.");
    },

    rescheduleOrder: () => fail("Reschedule is not available. Message the buyer and cancel if you need a new time."),

    requestReview: () => fail("Campus Connect sends review reminders automatically."),

    /* Selling: tickets at the door */

    /** Checks a ticket code at the door. Returns { ok, title, message } and marks a valid ticket used. */
    scanTicket: (code) => ccFetch("/tickets/scan", { method: "POST", body: { code } }),

    /**
     * The events the signed-in student can scan tickets for:
     * [{ listingId, title, when, role: "host" | "helper", sold, used, helpers: [{ userId, name, email }] }].
     */
    getDoor: async () => {
      try {
        const { events } = await ccFetch("/tickets/door");
        return events;
      } catch {
        return [];
      }
    },

    /** Lets another student scan tickets for one of the host's events. */
    addDoorHelper: (listingId, email) =>
      ccFetch("/tickets/door-helpers", { method: "POST", body: { listingId, email } }),

    removeDoorHelper: (listingId, userId) =>
      ccFetch(`/tickets/door-helpers/${encodeURIComponent(listingId)}/${encodeURIComponent(userId)}`, { method: "DELETE" }),

    /* Selling: messages */

    setConversationDone: async (id, done) => { await ccFetch(threadPath(id, "/done"), { method: "POST", body: { done: Boolean(done) } }); },

    /** Finds or starts the seller's thread with the buyer of an order. */
    openOrderConversation: (orderId) => endpoints.openConversation({ orderId }),

    /* Selling: performance */

    /** { [listingId]: { views, saves, messages, orders } } */
    getListingStats: () => db.seller.listingStats,
    /** { days: [{ views, orders, earnings }] oldest first and ending today, sources: [{ label, share }], ratings: { 5: n, … } } */
    getAnalytics: () => db.seller.analytics,
    getReviews: () => db.seller.reviews,

    replyToReview: (id, reply) => {
      const review = find(db.seller.reviews, id, "review");
      if (!reply) fail("Write a reply first.");
      review.reply = reply;
      return review;
    },

    /* Selling: settings, hours and calendar */

    /** The notification switches come from the server. The rest is still mock. */
    getSellerSettings: async () => ({ ...db.seller.settings, ...(await getNotifySettings()) }),

    /** Turning `awayMode` on pauses every active listing. Turning it off brings those same listings back. */
    updateSellerSettings: async (changes) => {
      const settings = db.seller.settings;
      const wasAway = settings.awayMode;
      await saveNotifySettings(changes);
      Object.assign(settings, pick(changes, Object.keys(settings).filter((key) => !NOTIFY_KEYS.includes(key))));
      if ("awayMode" in changes && settings.awayMode !== wasAway) {
        try {
          await ccFetch("/listings/away", { method: "POST", body: { away: settings.awayMode } });
        } catch {
          // Fall back to the in-memory pause when Sharetribe is not configured.
          db.listings.filter((listing) => listing.sellerId === db.seller.id).forEach((listing) => {
            if (settings.awayMode && (listing.status || "active") === "active") {
              Object.assign(listing, { status: "paused", awayPaused: true });
            } else if (!settings.awayMode && listing.awayPaused) {
              Object.assign(listing, { status: "active", awayPaused: undefined });
            }
          });
        }
      }
      return endpoints.getSellerSettings();
    },

    /** { timezone, days: { sun: [{ start, end }], … } } with times as minutes after midnight. */
    getSchedule: () => db.seller.schedule,

    updateSchedule: (days) => {
      WEEKDAYS.forEach((day) => {
        const ranges = (days[day] || []).map((range) => ({ start: Number(range.start), end: Number(range.end) }));
        if (ranges.some((range) => !(range.end > range.start))) fail("The end time has to be after the start.");
        db.seller.schedule.days[day] = ranges.sort((a, b) => a.start - b.start);
      });
      return db.seller.schedule;
    },

    /** { connected, email, events: [{ date, time, title }] }. Events are empty until a calendar is connected. */
    getCalendar: () => (db.seller.calendar.connected ? db.seller.calendar : { connected: false, email: "", events: [] }),
    connectCalendar: () => { db.seller.calendar.connected = true; },
    disconnectCalendar: () => { db.seller.calendar.connected = false; },

    updateSellerProfile: ({ name, handle, campus, bio, response }) => {
      if (!name || !handle) fail("Add a name and a handle.");
      Object.assign(mySellerProfile(), { handle: handle.replace(/^@?/, "@"), campus, bio, response });
      renameSeller(me().id, name);
      return mySellerProfile();
    },

    /** `changes`: name, handle, tagline, emoji, accent, announcement, about, policies, collections. */
    updateStore: (id, changes) => {
      const store = find(db.stores, id, "store");
      if (store.sellerId !== me().id) fail("Only the owner can change that store.");
      const fields = pick(changes, ["name", "handle", "tagline", "emoji", "accent", "announcement", "about", "policies", "collections"]);
      if ("name" in fields && !String(fields.name).trim()) fail("Give the store a name.");
      if (fields.handle) fields.handle = fields.handle.replace(/^@?/, "@");
      if (fields.collections) fields.collections = fields.collections.filter((collection) => collection.name.trim()).map((collection) => ({ name: collection.name.trim(), listingIds: collection.listingIds }));
      return Object.assign(store, fields);
    },

    /* Selling: payouts */

    /** { available, pending, method, schedule, history: [{ id, at, amount, status }] } */
    getPayouts: async () => {
      try {
        const { payouts } = await ccFetch("/payouts");
        return payouts;
      } catch {
        return {
          ...db.seller.payouts,
          pending: db.seller.orders
            .filter((order) => ["confirmed", "ready"].includes(order.status))
            .reduce((sum, order) => sum + order.amount, 0)
        };
      }
    },

    withdraw: () => fail("Payouts go to your Stripe account on a schedule. There is no manual withdraw."),

    updatePayoutMethod: () =>
      fail("Connect or update payouts through Stripe Connect from the Payouts page.")
  };

  /* Every endpoint is async and copies what goes in and what comes out, the way a request would. */
  const copy = (value) => (value === undefined ? undefined : structuredClone(value));
  const remote = Object.fromEntries(
    Object.entries(endpoints).map(([name, endpoint]) => [
      name,
      async (...args) => copy(await endpoint(...copy(args)))
    ])
  );

  return {
    ...remote,

    /**
     * Calls `listener(event)` when something changes without the user doing it.
     * Events:
     *   { type: "changed" }  a message, a notification or an order of the signed-in student changed. The page
     *                        asks the server every few seconds while it is in front, and reloads what it shows.
     *   { type: "chore-paid", choreId, orderId, poster }  mock only.
     */
    subscribe: (listener) => {
      listeners.add(listener);
      watchForChanges();
    },

    /** Mock only. Carries the demo data to the other page, so switching between buying and selling keeps what you did. */
    keepDemoData: () => sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(db))
  };
})();
