# Public server

Company OS is a Cloud Run origin. Humans authenticate with Identity Platform / IAP, or with
optional password login. GitHub is the v1 Gatekeeper for connected accounts.

There is no vendor billing top-up flow. Models go through Agent Gateway + Model Armor.

```
IAP_AUDIENCE=...
AUTH_GATEKEEPERS=github
PUBLIC_ORIGIN=https://example.com
```
