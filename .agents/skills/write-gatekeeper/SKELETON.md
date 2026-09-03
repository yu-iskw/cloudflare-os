# Gatekeeper skeleton

A Gatekeeper Cloud Run service exposes HTTP + Cap'n Web. The kernel holds a capability record:

```ts
type CapabilityRecord = {
  vendorId: string;
  accountLabel: string;
  resourceUrl: string;
  accessToken: string;
};
```

Observations run on the host. Side-effecting calls go on the SQL approval queue.
