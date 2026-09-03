/** One chat completion against Model Garden through Agent Gateway. */
export type CompletionRequest = {
  model: string;
  prompt: string;
  agentIdentity?: string;
};

export type CompletionResponse = {
  text: string;
  blocked: boolean;
};

export type AgentGatewayClient = {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
};

export type ArmorFloor = {
  /** Return true to block the prompt or completion. */
  inspect(text: string): boolean;
};

const JAILBREAK = /ignore (all|previous) instructions/i;

/** Default Model Armor floor used when the managed service is not wired. */
export const defaultArmorFloor: ArmorFloor = {
  inspect(text: string) {
    return JAILBREAK.test(text);
  },
};

/**
 * Call Model Garden via Agent Gateway. Code Mode still runs in `sandbox do`, not here.
 */
export async function completeThroughGateway(
  client: AgentGatewayClient,
  armor: ArmorFloor,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  if (armor.inspect(req.prompt)) {
    return { text: "", blocked: true };
  }
  const result = await client.complete(req);
  if (armor.inspect(result.text)) {
    return { text: "", blocked: true };
  }
  return result;
}
