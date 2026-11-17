import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DurDatabase } from './database';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type PublicUser = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
};

function digest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  constructor(private readonly db: DurDatabase) {}

  createForTelegram(user: { id: number; first_name: string; username?: string }) {
    const now = Math.floor(Date.now() / 1000);
    const telegramId = String(user.id);
    let account = this.db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId) as { id: string } | undefined;

    if (!account) {
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO users (id, telegram_id, telegram_username, first_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, telegramId, user.username ?? null, user.first_name, now, now);
      account = { id };
    } else {
      this.db.prepare(`
        UPDATE users SET telegram_username = ?, first_name = ?, updated_at = ? WHERE id = ?
      `).run(user.username ?? null, user.first_name, now, account.id);
    }

    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), account.id, now + SESSION_TTL_SECONDS, now);
    return { token, userId: account.id, expiresAt: now + SESSION_TTL_SECONDS };
  }

  getUser(token: string | undefined): PublicUser | null {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    const row = this.db.prepare(`
      SELECT u.id, u.telegram_id AS telegramId, u.telegram_username AS username, u.first_name AS firstName
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(digest(token), now) as PublicUser | undefined;
    return row ?? null;
  }

  revoke(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  }
}
