export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AttestationInput = {
  schemaId: string;
  schemaVersion: number;
  subjectId: string;
  claim: { [key: string]: JsonValue };
  evidenceRefs: string[];
  expiresAt?: number;
};

export type Attestation = AttestationInput & {
  id: string;
  issuerId: string;
  claimDigest: string;
  issuedAt: number;
  status: 'active' | 'revoked' | 'expired';
  revokedAt?: number | null;
  revocationReason?: string | null;
};

export type AttestationEvent = {
  eventType: 'issued' | 'revoked' | 'expired';
  actorIssuerId: string | null;
  occurredAt: number;
  reason: string | null;
};

export class DurApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DurApiError';
  }
}

export type DurIssuerClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export class DurIssuerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DurIssuerClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('invalid_base_url');
    if (!options.apiKey || options.apiKey.length > 256) throw new Error('invalid_api_key');
    this.baseUrl = baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.apiKey}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof body.error === 'string' ? body.error : 'request_failed';
      throw new DurApiError(code, response.status, code);
    }
    return body as T;
  }

  createAttestation(input: AttestationInput) {
    return this.request<Attestation>('/v1/attestations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getAttestation(id: string) {
    return this.request<{ attestation: Attestation; events: AttestationEvent[] }>(
      `/v1/attestations/${encodeURIComponent(id)}`,
    );
  }

  revokeAttestation(id: string, reason: string) {
    return this.request<{ revoked: true }>(
      `/v1/attestations/${encodeURIComponent(id)}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  revokeApiKey() {
    return this.request<{ revoked: true }>('/v1/issuers/me/revoke-key', { method: 'POST' });
  }
}

export type ReputationDimensionResult = {
  value: number | null;
  evidenceCount: number;
  issuerCount: number;
};

export type ReputationProfile = {
  subjectId: string;
  reputation: {
    methodologyVersion: string;
    computedAt: number;
    dimensions: {
      reliability: ReputationDimensionResult;
      delivery: ReputationDimensionResult;
      communication: ReputationDimensionResult;
      disputeResolution: ReputationDimensionResult;
    };
    eligibleEvidenceCount: number;
    eligibleIssuerCount: number;
    limitations: string[];
  };
};

export type AttestationDispute = {
  id: string;
  attestationId: string;
  subjectId: string;
  reason: string;
  evidenceRefs: string[];
  status: "open" | "upheld" | "rejected";
  resolutionReason: string | null;
  openedAt: number;
  resolvedAt: number | null;
};

export type ReputationTrustTier = "unverified" | "verified" | "trusted" | "official";

export class DurSubjectClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch }) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseUrl)) throw new Error("invalid_base_url");
    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof body.error === "string" ? body.error : "request_failed";
      throw new DurApiError(code, response.status, code);
    }
    return body as T;
  }

  getReputation(subjectId: string) {
    return this.request<ReputationProfile>(
      `/v1/profiles/${encodeURIComponent(subjectId)}/reputation`,
    );
  }

  listDisputes() {
    return this.request<{ disputes: AttestationDispute[] }>("/v1/auth/disputes");
  }

  openDispute(attestationId: string, reason: string, evidenceRefs: string[] = []) {
    return this.request<{ dispute: AttestationDispute }>(
      `/v1/attestations/${encodeURIComponent(attestationId)}/disputes`,
      { method: "POST", body: JSON.stringify({ reason, evidenceRefs }) },
    );
  }
}

/**
 * Server-side administrative client. Never instantiate this in browser code
 * or expose the admin token through VITE_ environment variables.
 */
export class DurAdminClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; adminToken: string; fetchImpl?: typeof fetch }) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseUrl)) throw new Error("invalid_base_url");
    if (!options.adminToken || options.adminToken.length > 512) throw new Error("invalid_admin_token");
    this.baseUrl = baseUrl;
    this.adminToken = options.adminToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.adminToken}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof body.error === "string" ? body.error : "request_failed";
      throw new DurApiError(code, response.status, code);
    }
    return body as T;
  }

  setIssuerTrustTier(issuerId: string, trustTier: ReputationTrustTier, reason: string) {
    return this.request<{ issuerId: string; trustTier: ReputationTrustTier }>(
      `/v1/admin/issuers/${encodeURIComponent(issuerId)}/trust-tier`,
      { method: "POST", body: JSON.stringify({ trustTier, reason }) },
    );
  }

  resolveDispute(disputeId: string, status: "upheld" | "rejected", reason: string) {
    return this.request<{ dispute: AttestationDispute }>(
      `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
      { method: "POST", body: JSON.stringify({ status, reason }) },
    );
  }

  verifyTransaction(eventId: string, maxScan = 500) {
    return this.request<{
      transactionProof: Record<string, JsonValue>;
      eventVerification: "transaction_verified";
      semanticVerification: "pending";
    }>(
      `/v1/admin/indexer/events/${encodeURIComponent(eventId)}/verify-transaction`,
      { method: "POST", body: JSON.stringify({ maxScan }) },
    );
  }
}
