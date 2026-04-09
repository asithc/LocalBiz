import bcrypt from 'bcryptjs';
import type { Database } from 'better-sqlite3';
import type { AuthLoginPayload, Session } from '../../../src/shared/types';
import { nowIso } from '../db/helpers';
import { setSession } from './session';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'Admin' | 'Staff';
  must_change_password: number;
  failed_login_attempts: number;
  locked_until: string | null;
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const validatePasswordStrength = (password: string) => {
  const strongPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!strongPattern.test(password)) {
    throw new Error('Password must be 8+ characters with upper, lower, and number.');
  }
};

export const login = (db: Database, payload: AuthLoginPayload) => {
  const username = payload.username?.trim();
  const password = payload.password ?? '';

  if (!username || !password) {
    throw new Error('Username and password are required.');
  }

  const user = db
    .prepare(
      `SELECT id, username, password_hash, role, must_change_password, failed_login_attempts, locked_until
       FROM users WHERE username = ?`
    )
    .get(username) as UserRow | undefined;

  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new Error('Account temporarily locked. Please try again later.');
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    if (user) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      const shouldLock = attempts >= MAX_LOGIN_ATTEMPTS;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;

      db.prepare(
        `UPDATE users
         SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
         WHERE id = ?`
      ).run(shouldLock ? 0 : attempts, lockedUntil, nowIso(), user.id);

      db.prepare(
        `INSERT INTO activity_logs (action, entity_type, entity_id, description, performed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        'LOGIN_FAILED',
        'USER',
        String(user.id),
        shouldLock ? `${user.username} account locked after failed logins` : `Failed login attempt for ${user.username}`,
        user.id,
        nowIso()
      );
    }
    throw new Error('Invalid username or password.');
  }

  db.prepare(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(nowIso(), nowIso(), user.id);

  const session: Session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password)
  };

  setSession(session);

  db.prepare(
    `INSERT INTO activity_logs (action, entity_type, entity_id, description, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('LOGIN', 'USER', String(user.id), `${user.username} logged in`, user.id, nowIso());

  return session;
};

export const logout = () => {
  setSession(null);
  return { ok: true };
};

export const changePassword = (
  db: Database,
  payload: { userId: number; currentPassword?: string; newPassword: string; force?: boolean }
) => {
  const { userId, currentPassword = '', newPassword, force = false } = payload;
  validatePasswordStrength(newPassword || '');

  const user = db
    .prepare('SELECT id, password_hash FROM users WHERE id = ?')
    .get(userId) as { id: number; password_hash: string } | undefined;

  if (!user) {
    throw new Error('User not found.');
  }

  if (!force && !bcrypt.compareSync(currentPassword, user.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(
    hash,
    nowIso(),
    userId
  );

  return { ok: true };
};
