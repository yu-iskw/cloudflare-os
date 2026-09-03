export type IapIdentity = {
  email: string;
  subject: string;
};

/**
 * Google IAP JWT (`x-goog-iap-jwt-assertion`).
 * Local/dev: `IAP_DEV_EMAIL` skips the assertion.
 */
export async function verifyIapAssertion(
  token: string | undefined,
  _audience: string | undefined,
): Promise<IapIdentity | null> {
  const dev = process.env.IAP_DEV_EMAIL;
  if (dev) return { email: dev, subject: `dev:${dev}` };
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  let payload: { email?: string; sub?: string; aud?: string | string[] };
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      email?: string;
      sub?: string;
      aud?: string | string[];
    };
  } catch {
    return null;
  }
  if (!payload.email || !payload.sub) return null;
  if (_audience) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(_audience) : aud === _audience;
    if (!ok) return null;
  }
  return { email: payload.email, subject: payload.sub };
}

/** Read the IAP assertion from an incoming upgrade request. */
export function iapTokenFromHeaders(headers: { get(name: string): string | null }): string | undefined {
  return headers.get("x-goog-iap-jwt-assertion") ?? undefined;
}
