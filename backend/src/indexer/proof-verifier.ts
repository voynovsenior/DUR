import { spawn } from "node:child_process";

export type TonTransactionProofRequest = {
  network: "ton-testnet";
  address: string;
  lt: string;
  txHash: string;
  maxScan?: number;
};

export type EscrowLifecycleEventObservation = {
  schemaVersion: 1;
  dealId: string;
  eventSequence: number;
  eventType: string;
  previousState: string;
  newState: string;
  actor: string;
  counterparty: string;
  termsHash: string;
  decision: string;
};

export type TonTransactionProofResult = {
  verified: boolean;
  network: "testnet";
  address: string;
  transactionLt: string;
  transactionHash: string;
  masterchainSeqno?: number;
  masterchainRootHash?: string;
  accountLastTxLt?: string;
  scannedTransactions: number;
  proofPolicy: "secure";
  verifierVersion: string;
  currentAccountCodeHash?: string;
  escrowEvents?: EscrowLifecycleEventObservation[];
  eventDecodeErrors?: string[];
  reason?: string;
};

export async function verifyTonTestnetTransaction(
  input: TonTransactionProofRequest,
  options: { binary?: string; timeoutMs?: number } = {},
): Promise<TonTransactionProofResult> {
  const binary = options.binary ?? process.env.DUR_PROOF_VERIFIER_BIN;
  if (!binary) throw new Error("proof_verifier_not_configured");
  if (input.network !== "ton-testnet") throw new Error("unsupported_proof_network");
  if (!/^(?:-1|0):[a-fA-F0-9]{64}$/.test(input.address)) throw new Error("invalid_proof_address");
  if (!/^[0-9]{1,20}$/.test(input.lt) || !/^[a-fA-F0-9]{64}$/.test(input.txHash)) {
    throw new Error("invalid_proof_transaction_reference");
  }

  return await new Promise<TonTransactionProofResult>((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 90_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (error?: Error, result?: TonTransactionProofResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 64_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on("error", error => finish(new Error(`proof_verifier_spawn_failed: ${error.message}`)));
    child.on("close", code => {
      if (timedOut) {
        finish(new Error("proof_verifier_timeout"));
        return;
      }
      let result: TonTransactionProofResult;
      try {
        result = JSON.parse(stdout) as TonTransactionProofResult;
      } catch {
        finish(new Error(`proof_verifier_invalid_output: ${stderr.slice(-1000)}`));
        return;
      }
      if (code !== 0) {
        finish(new Error(`proof_verification_failed: ${result.reason ?? stderr.slice(-1000) ?? "unknown"}`));
        return;
      }
      if (result.proofPolicy !== "secure" || result.network !== "testnet" ||
          result.address.toLowerCase() !== input.address.toLowerCase() || result.transactionLt !== input.lt ||
          result.transactionHash.toLowerCase() !== input.txHash.toLowerCase()) {
        finish(new Error("proof_verifier_result_mismatch"));
        return;
      }
      if (result.currentAccountCodeHash !== undefined &&
          !/^[a-fA-F0-9]{64}$/.test(result.currentAccountCodeHash)) {
        finish(new Error("proof_verifier_invalid_code_hash"));
        return;
      }
      if (result.escrowEvents !== undefined && (!Array.isArray(result.escrowEvents) ||
          result.escrowEvents.length > 32 || result.escrowEvents.some(event =>
            event.schemaVersion !== 1 || !/^[0-9]{1,20}$/.test(event.dealId) ||
            !Number.isInteger(event.eventSequence) || event.eventSequence < 1 ||
            !/^[a-fA-F0-9]{64}$/.test(event.termsHash) ||
            !/^(?:-1|0):[a-fA-F0-9]{64}$/.test(event.actor) ||
            !/^(?:-1|0):[a-fA-F0-9]{64}$/.test(event.counterparty)))) {
        finish(new Error("proof_verifier_invalid_escrow_events"));
        return;
      }
      if (result.eventDecodeErrors !== undefined && (!Array.isArray(result.eventDecodeErrors) ||
          result.eventDecodeErrors.length > 32 || result.eventDecodeErrors.some(error =>
            typeof error !== "string" || error.length > 512))) {
        finish(new Error("proof_verifier_invalid_event_errors"));
        return;
      }
      finish(undefined, result);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({
      network: "testnet",
      address: input.address,
      lt: input.lt,
      hash: input.txHash,
      maxScan: input.maxScan,
    }));
  });
}
