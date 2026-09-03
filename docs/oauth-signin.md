# OAuth sign-in

The Workshop can offer GitHub (and later other vendors) as a sign-in method. Identity Platform /
IAP is the default for Cloud Run; password login remains env-gated.

`AUTH_GATEKEEPERS` lists which connected gatekeepers may mint a session from a verified email.
An empty allowlist leaves password (and IAP) as the only paths.

Each vendor must return a provider-verified email from `getAuthenticatedEmail()` (for example a
GitHub primary+verified email). Otherwise it cannot be used to sign in.

Redirect URI for the GitHub Gatekeeper:

- `${PUBLIC_ORIGIN}/gatekeeper/github/oauth`
