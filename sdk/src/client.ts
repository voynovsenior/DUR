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
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
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
