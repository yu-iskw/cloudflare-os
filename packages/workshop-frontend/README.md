# Gadgets Workshop Frontend

Single-page app for the Gadgets Workshop UI. Built with React, `@gadgets/kumo`, and Vite.

## Development

Kernel on 8080, SPA on 3000 (Vite proxies `/api` WebSocket):

```sh
pnpm --filter @gadgets/gcp-kernel start
pnpm --filter @gadgets/workshop-frontend dev
```

```sh
pnpm exec vp run build  # type-check and build for production
pnpm preview            # preview production build locally
```

## Authentication modes

### Password mode (default)

Users log in with a username and password. Account creation is available via `/signup`.

### IAP mode

Set `VITE_IAP_MODE=true`. Password login is hidden and the app calls `authenticateFromIap()`.
The kernel reads `x-goog-iap-jwt-assertion` (or `IAP_DEV_EMAIL` locally).
