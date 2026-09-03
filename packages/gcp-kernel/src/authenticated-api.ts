import { randomUUID } from "node:crypto";
import { RpcStub, RpcTarget } from "capnweb";
import type {
  AdminApi,
  AiChatAuthorInfo,
  AiGatewayInfo,
  AuthenticatedApi,
  GadgetMetadataWithTimestamps,
  GatekeeperVendorInfo,
  ListOutputsResult,
  Overseer,
  OutputFormatOffer,
  UiFeatureFlags,
} from "@gadgets/workshop-shared/api";
import { DEFAULT_UI_FEATURE_FLAGS } from "@gadgets/workshop-shared/feature-flags";
import { MemoryLedger, type UserRow } from "@gadgets/gcp-ledger";
import { GitStore, MemoryGitBackend } from "@gadgets/gcp-git";
import { OverseerImpl } from "./overseer.js";

/** Session API for a signed-in user. */
export class AuthenticatedApiImpl extends RpcTarget {
  constructor(
    private readonly ledger: MemoryLedger,
    private readonly userId: string,
    private readonly replicaId: string,
    private readonly git = new GitStore(new MemoryGitBackend()),
  ) {
    super();
  }

  #user(): UserRow {
    const user = this.ledger.users.get(this.userId);
    if (!user) throw new Error("user gone");
    return user;
  }

  async whoami(): Promise<AiChatAuthorInfo> {
    const user = this.#user();
    return { type: "user", id: user.id, name: user.displayName };
  }

  async setOwnDisplayName(name: string): Promise<void> {
    this.#user().displayName = name;
  }

  async changePassword(): Promise<void> {
    throw new Error("changePassword is not available");
  }

  async hasPasswordLogin(): Promise<boolean> {
    return this.#user().passwordHashHash !== null;
  }

  async listModels(): Promise<AiChatAuthorInfo[]> {
    return [];
  }

  async addModel(): Promise<void> {}
  async deleteModel(): Promise<void> {}
  async setQuickModel(): Promise<void> {}
  async getQuickModel(): Promise<null> {
    return null;
  }

  async getAiConfig(): Promise<AiGatewayInfo> {
    return { enabled: false };
  }

  async getUiFeatureFlags(): Promise<UiFeatureFlags> {
    return DEFAULT_UI_FEATURE_FLAGS;
  }

  async getPreferredModel(): Promise<string | null> {
    return this.#user().preferredModel;
  }

  async setPreferredModel(id: string | null): Promise<void> {
    this.#user().preferredModel = id;
  }

  async isOnboardingCompleted(): Promise<boolean> {
    return this.#user().onboardingCompleted;
  }

  async completeOnboarding(): Promise<void> {
    this.#user().onboardingCompleted = true;
  }

  async setAvatar(): Promise<void> {}
  async getAvatar(): Promise<null> {
    return null;
  }

  async newGadget(): Promise<RpcStub<Overseer>> {
    const id = randomUUID();
    this.ledger.workspaces.set(id, {
      id,
      ownerId: this.userId,
      title: "Untitled Workspace",
      pinned: false,
    });
    await this.ledger.acquireLease(id, this.replicaId, 60_000);
    return new OverseerImpl(this.ledger, this.git, id, this.userId, this.replicaId) as unknown as RpcStub<Overseer>;
  }

  async listGadgets(): Promise<GadgetMetadataWithTimestamps[]> {
    const now = new Date();
    const out: GadgetMetadataWithTimestamps[] = [];
    for (const ws of this.ledger.workspaces.values()) {
      if (ws.ownerId !== this.userId) continue;
      out.push({
        id: ws.id,
        title: ws.title,
        pinned: ws.pinned,
        created: now,
        lastActive: now,
      });
    }
    return out;
  }

  async openGadget(id: string): Promise<RpcStub<Overseer>> {
    const ws = this.ledger.workspaces.get(id);
    if (!ws || ws.ownerId !== this.userId) throw new Error("workspace not found");
    await this.ledger.acquireLease(id, this.replicaId, 60_000);
    return new OverseerImpl(this.ledger, this.git, id, this.userId, this.replicaId) as unknown as RpcStub<Overseer>;
  }

  async listOutputs(): Promise<ListOutputsResult> {
    return { outputs: [], catchingUp: false };
  }

  async listOutputFormats(): Promise<OutputFormatOffer[]> {
    return [];
  }

  async listGatekeeperVendors(): Promise<GatekeeperVendorInfo[]> {
    return [
      {
        id: "github",
        description: {
          displayName: "GitHub",
          url: "https://github.com",
        },
        supportedResources: [],
      },
    ];
  }

  async connectAccount(vendorId: string): Promise<{ url: string }> {
    const cap = this.ledger.putCapability({
      ownerId: this.userId,
      vendorId,
      accountLabel: vendorId,
      resourceUrl: null,
      accessToken: null,
    });
    const origin = process.env.PUBLIC_ORIGIN ?? "http://localhost:8080";
    return { url: `${origin}/gatekeeper/${vendorId}/connect?capabilityId=${cap.id}` };
  }

  async ensureAccountResources(): Promise<{ url?: string }> {
    return {};
  }

  async listAddableGatekeepers(): Promise<GatekeeperVendorInfo[]> {
    return this.listGatekeeperVendors();
  }

  async provisionAmbientAccount(): Promise<void> {}
  async disconnectAccount(): Promise<void> {}
  async dismissSharedGadget(): Promise<void> {}
  async listOwnBlueprints() {
    return [];
  }
  async getOwnBlueprint() {
    return null;
  }
  async listLibraryBlueprints() {
    return [];
  }
  async setBlueprintPinned(): Promise<void> {}
  async isBlueprintPinned(): Promise<boolean> {
    return false;
  }
  async listFeaturedBlueprints() {
    return [];
  }
  async addBlueprintToLibrary(): Promise<void> {}
  async removeBlueprintFromLibrary(): Promise<void> {}
  async isBlueprintInLibrary() {
    return null;
  }
  async deleteOrphanedBlueprint(): Promise<void> {}
  async importBlueprint(): Promise<string> {
    throw new Error("importBlueprint is not available");
  }
  async reconnectAccount(): Promise<{ url: string }> {
    return this.connectAccount("github");
  }
  async listGatekeeperApps() {
    return [];
  }
  async getGatekeeperApp() {
    return null;
  }
  async amIAdmin(): Promise<boolean> {
    return false;
  }
  async getAdminApi(): Promise<RpcStub<AdminApi> | null> {
    return null;
  }
}
