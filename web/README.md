# Campus Connect frontend

The buyer marketplace and Seller Hub. Views, actions, and CSS stay as they were in the
prototype. `shared/api.js` keeps its method names and return shapes; later PRs point each
method at `/api/cc`.

## Run it

From the repo root, with a `.env` that has Sharetribe and Postgres credentials:

```bash
yarn run dev-cc-migrate
yarn run dev-cc
```

Then open `http://localhost:4000` for the buyer marketplace or `http://localhost:4000/sell`
for the Seller Hub.

## Architecture

```
api.js  →  store.js (data cache + UI state)  →  views  →  actions  →  app.js shell
```

- **`shared/api.js`** — the only place that knows where data comes from. Every method is async
  and returns plain JSON copies. Swap the bodies for `fetch` when the middleware is ready;
  keep the names, arguments and return shapes.
- **`shared/mock-data.js`** — seed for the mock. Delete once the API talks to a real service.
- **`shared/store.js`** — `data` (API cache) and `state` (UI). Views read `data`; writes go
  through `api` then `load`/`refresh`.
- **`shared/ui.js`** — registries (`VIEWS`, `ACTIONS`, `FORMS`, `NAV_PARENTS`,
  `NOTIFICATION_TARGETS`) plus toasts, modals and booking UI.
- **`shared/app.js`** — shell: render, header chrome, click/submit routing, page start.
- **`buyer/`** — marketplace views and actions (`/` via `index.html`).
- **`seller/`** — Seller Hub views and actions (`/sell` via `seller.html`). Reuses buyer
  views for “preview as buyer”.
