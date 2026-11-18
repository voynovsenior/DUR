import { DurIssuerClient, type AttestationInput } from '../src/client';

/**
 * Minimal server-side integration example.
 *
 * Run this only in a trusted backend. DUR_ISSUER_API_KEY is a secret and must
 * never be bundled into a browser or Telegram Mini App.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

const dur = new DurIssuerClient({
  baseUrl: requiredEnv('DUR_API_URL'),
  apiKey: requiredEnv('DUR_ISSUER_API_KEY'),
});

export async function publishDeliveryAttestation(input: {
  subjectId: string;
  orderReference: string;
  evidenceRefs: string[];
}) {
  const payload: AttestationInput = {
    schemaId: 'dur.delivery.completed',
    schemaVersion: 1,
    subjectId: input.subjectId,
    claim: {
      completed: true,
      orderReference: input.orderReference,
    },
    evidenceRefs: input.evidenceRefs,
  };

  return dur.createAttestation(payload);
}

// Discovery calls are public, but using the authenticated client keeps the
// example focused on one configured API endpoint and one typed response.
export async function inspectProtocolCatalog() {
  const [issuers, schemas] = await Promise.all([
    dur.listIssuers(),
    dur.listSchemas(),
  ]);
  return { issuers: issuers.issuers, schemas: schemas.schemas };
}
