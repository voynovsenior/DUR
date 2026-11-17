import { createHash, randomBytes } from 'node:crypto';
import type { DurDatabase } from './database';

const CHALLENGE_TTL_SECONDS = 10 * 60;

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export class TonProofChallengeStore {
  constructor(private readonly db: DurDatabase) {}

  issue(userId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const payload = randomBytes(32).toString('base64url');
    const attemptToken = randomBytes(32).toString('base64url');
    const expiresAt = nowSeconds + CHALLENGE_TTL_SECONDS;

    this.db.prepare('DELETE FROM ton_proof_challenges WHERE expires_at <= ?').run(nowSeconds);
    this.db.prepare(`
      INSERT INTO ton_proof_challenges (payload_hash, attempt_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(digest(payload), digest(attemptToken), userId, expiresAt, nowSeconds);

    return { payload, attemptToken, expiresAt };
  }

  matches(payload: string, attemptToken: string | undefined, userId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!attemptToken || !payload) return false;
    const row = this.db.prepare(`
      SELECT 1 AS valid FROM ton_proof_challenges
      WHERE payload_hash = ? AND attempt_hash = ? AND user_id = ? AND expires_at > ?
    `).get(digest(payload), digest(attemptToken), userId, nowSeconds);
    return Boolean(row);
  }

  consume(payload: string, attemptToken: string | undefined, userId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!attemptToken || !payload) return false;
    // A single DELETE statement makes challenge consumption atomic across concurrent requests.
    const row = this.db.prepare(`
      DELETE FROM ton_proof_challenges
      WHERE payload_hash = ? AND attempt_hash = ? AND user_id = ? AND expires_at > ?
      RETURNING payload_hash
    `).get(digest(payload), digest(attemptToken), userId, nowSeconds);
    return Boolean(row);
  }
}
