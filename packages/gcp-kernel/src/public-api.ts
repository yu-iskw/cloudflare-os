import { randomBytes, randomUUID } from "node:crypto";
import { RpcTarget } from "capnweb";
import type { PublicApi, ServerConfig, AuthenticatedApi } from "@gadgets/workshop-shared/api";
import { DEFAULT_SITE_NAME } from "@gadgets/workshop-shared/api";
import { MemoryLedger, type UserRow } from "@gadgets/gcp-ledger";
import { verifyIapAssertion } from "./iap.js";
import { AuthenticatedApiImpl } from "./authenticated-api.js";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Cap'n Web root. WebSocket `/api`. */
export class PublicApiImpl extends RpcTarget {
  constructor(
    private readonly ledger: MemoryLedger,
    private readonly replicaId: string,
    private readonly iapAssertion?: string,
  ) {
    super();
  }

  async ping(): Promise<void> {}

  async getServerConfig(): Promise<ServerConfig> {
    const admin = this.ledger.admin;
    return {
      authVendors: [{ vendorId: "github", displayName: "GitHub" }],
      passwordAuthEnabled: true,
      signupsEnabled: admin.signupsEnabled,
      siteName: admin.siteName || DEFAULT_SITE_NAME,
      announcement: admin.announcement,
      banner: admin.banner,
      bannerColor: admin.bannerColor as ServerConfig["bannerColor"],
      accentColor: admin.accentColor,
    };
  }

  async startGatekeeperLogin(vendorId: string): Promise<{ url: string; attempt: never }> {
    throw new Error(`OAuth login for ${vendorId} is not wired on this kernel yet`);
  }

  async authenticate(token: string): Promise<AuthenticatedApi> {
    const key = typeof token === "string" ? token : String(token);
    const userId = this.ledger.usersByToken.get(key);
    if (!userId) throw new Error("invalid session");
    return new AuthenticatedApiImpl(this.ledger, userId, this.replicaId) as unknown as AuthenticatedApi;
  }

  async authenticateFromIap(): Promise<AuthenticatedApi> {
    const identity = await verifyIapAssertion(this.iapAssertion, process.env.IAP_AUDIENCE);
    if (!identity) throw new Error("IAP authentication failed");
    const existing = this.ledger.usersByName.get(identity.email);
    let user: UserRow;
    if (existing) {
      user = this.ledger.users.get(existing)!;
    } else {
      if (!this.ledger.admin.signupsEnabled) throw new Error("signups disabled");
      user = {
        id: randomUUID(),
        username: identity.email,
        displayName: identity.email,
        passwordHashHash: null,
        sessionToken: newToken(),
        preferredModel: null,
        onboardingCompleted: true,
      };
      this.ledger.putUser(user);
    }
    return new AuthenticatedApiImpl(this.ledger, user.id, this.replicaId) as unknown as AuthenticatedApi;
  }

  async login(username: string, passwordHash: Uint8Array): Promise<string | null> {
    const id = this.ledger.usersByName.get(username.toLowerCase());
    if (!id) return null;
    const user = this.ledger.users.get(id)!;
    if (!user.passwordHashHash) return null;
    const hashHash = await sha256(passwordHash);
    if (!bytesEqual(hashHash, user.passwordHashHash)) return null;
    const session = `${username.toLowerCase()}:${newToken()}`;
    user.sessionToken = session;
    this.ledger.putUser(user);
    return session;
  }

  async createAccount(
    username: string,
    displayName: string,
    passwordHash: Uint8Array,
  ): Promise<string | null> {
    const name = username.toLowerCase();
    if (this.ledger.usersByName.has(name)) return null;
    if (!this.ledger.admin.signupsEnabled) throw new Error("signups disabled");
    const session = `${name}:${newToken()}`;
    const user: UserRow = {
      id: randomUUID(),
      username: name,
      displayName,
      passwordHashHash: await sha256(passwordHash),
      sessionToken: session,
      preferredModel: null,
      onboardingCompleted: true,
    };
    this.ledger.putUser(user);
    return session;
  }

  async getBlueprint(): Promise<null> {
    return null;
  }
}

export type { PublicApi };
