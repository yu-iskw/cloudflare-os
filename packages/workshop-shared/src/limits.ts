// Optional usage-limit helpers shared between the Workshop client and server.
// The Cloud Run kernel does not enforce a vendor billing flow; these remain for
// deployments that want a simple free-tier gate of their own.

/** Default minimum prepaid balance (USD) required after the free daily allowance. */
export const MINIMUM_BALANCE = 2.0;

/** Default number of LLM calls a user may make per (calendar) day on the free tier. */
export const DEFAULT_DAILY_LLM_CALL_LIMIT = 100;

/** User-facing message for an insufficient connected-account balance. */
export function insufficientBalanceMessage(minimum: number = MINIMUM_BALANCE): string {
  return `Prepaid balance is below $${minimum}. Add credits or use your own API keys.`;
}

/** User-facing messages for limit violations. */
export const LIMIT_ERROR_MESSAGES = {
  USAGE_LIMIT_EXCEEDED:
    "Free usage limit reached. Connect a billed account or use your own API keys to continue.",
  NO_TOKEN: "Free usage limit reached. Connect an account to continue.",
} as const;

/** The window over which the free-tier limit is measured. */
export type LimitWindowKind = "daily" | "rolling";

/** Returns true if the given balance meets the minimum required to proceed. */
export function hasMinimumBalance(
  balance: number | null | undefined,
  minimum: number = MINIMUM_BALANCE,
): boolean {
  if (balance === null || balance === undefined) return false;
  return balance >= minimum;
}

/** Result of deciding whether a request may proceed. */
export interface CanProceedResult {
  /** Whether the request is allowed to proceed at all. */
  allowed: boolean;
  /** Human-readable reason when not allowed (or guidance when BYOK is required). */
  reason?: string;
  /**
   * Whether the request should be served using the user's own keys rather than the
   * platform's. True once the user has exhausted the free tier but can still proceed via BYOK.
   */
  shouldUseByok: boolean;
}

/**
 * Pure decision function: given whether the user is within their free-tier limit, whether they
 * have connected an account (token), and their balance, decide whether the request may proceed
 * and whose credentials to use.
 */
export function canProceedWithRequest(data: {
  withinLimits: boolean;
  hasUserToken: boolean;
  balance?: number | null;
  /** Minimum required balance (USD). Defaults to MINIMUM_BALANCE. */
  minimumBalance?: number;
}): CanProceedResult {
  const { withinLimits, hasUserToken, balance } = data;
  const minimumBalance = data.minimumBalance ?? MINIMUM_BALANCE;

  if (hasUserToken && hasMinimumBalance(balance, minimumBalance)) {
    return { allowed: true, shouldUseByok: true };
  }

  if (withinLimits) {
    return { allowed: true, shouldUseByok: false };
  }

  if (!hasUserToken) {
    return {
      allowed: false,
      reason: LIMIT_ERROR_MESSAGES.NO_TOKEN,
      shouldUseByok: true,
    };
  }

  return {
    allowed: false,
    reason: insufficientBalanceMessage(minimumBalance),
    shouldUseByok: true,
  };
}
