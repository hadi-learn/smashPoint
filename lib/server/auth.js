/**
 * Admin Authentication & Role-Based Access Control (RBAC) Manager.
 *
 * Roles:
 *  - 'super_admin': Full application control + can create/edit/reset/delete other admin accounts.
 *  - 'admin': Full application control (schedule import, match edits, session locks, exports),
 *             can change own password, but CANNOT create/modify/delete other users.
 *
 * Persisted in `data/admin-users.json` with PBKDF2-HMAC-SHA256 salted password hashes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StoreError } from './store.js';

export const ROLES = ['super_admin', 'admin'];
export const ROLE_LABELS = {
  super_admin: 'Super Admin (Penuh + Kelola User)',
  admin: 'Admin Operasional (Kelola Pertandingan)',
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 10000, 64, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}

export class AdminAuth {
  constructor({ dataDir, defaultUsername = 'admin', defaultPassword = '1234' }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'admin-users.json');
    this.defaultUsername = normalizeUsername(defaultUsername) || 'admin';
    this.defaultPassword = String(defaultPassword || '1234');
    this.users = {};
    this.sessions = new Map(); // token -> { username, created_at, expires_at }
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (raw && typeof raw.users === 'object') {
          this.users = raw.users;
        }
      }
    } catch (e) {
      console.error('[auth] gagal memuat admin-users.json:', e.message);
    }

    // Ensure at least one super_admin exists (bootstrap default super_admin)
    const hasSuper = Object.values(this.users).some((u) => u.role === 'super_admin' && u.active !== false);
    if (!hasSuper) {
      const uname = this.defaultUsername;
      const { salt, hash } = hashPassword(this.defaultPassword);
      const now = new Date().toISOString();
      this.users[uname] = {
        username: uname,
        display_name: 'Administrator Utama',
        role: 'super_admin',
        salt,
        hash,
        active: true,
        created_at: now,
        updated_at: now,
        last_login: null,
      };
      this.save();
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ users: this.users }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[auth] gagal menyimpan admin-users.json:', e.message);
    }
  }

  toPublicUser(u) {
    if (!u) return null;
    return {
      username: u.username,
      display_name: u.display_name || u.username,
      role: u.role,
      role_label: ROLE_LABELS[u.role] || u.role,
      active: u.active !== false,
      created_at: u.created_at || null,
      updated_at: u.updated_at || null,
      last_login: u.last_login || null,
    };
  }

  listUsers() {
    return Object.values(this.users)
      .map((u) => this.toPublicUser(u))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1;
        return a.username.localeCompare(b.username);
      });
  }

  login(username, password) {
    const uname = normalizeUsername(username);
    const pwd = String(password || '');
    if (!uname || !pwd) {
      throw new StoreError('Username dan password wajib diisi', 'bad_credentials', 401);
    }
    const u = this.users[uname];
    if (!u || u.active === false || !verifyPassword(pwd, u.salt, u.hash)) {
      throw new StoreError('Username atau password salah', 'bad_credentials', 401);
    }
    u.last_login = new Date().toISOString();
    this.save();

    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    this.sessions.set(token, {
      username: u.username,
      created_at: now,
      expires_at: now + SESSION_TTL_MS,
    });

    return {
      token,
      user: this.toPublicUser(u),
    };
  }

  logout(token) {
    if (token) this.sessions.delete(String(token));
  }

  /**
   * Resolve session token or legacy PIN header into a public user object, or null if unauthorized.
   */
  verifyToken(token) {
    if (!token) return null;
    const t = String(token).trim();
    const sess = this.sessions.get(t);
    if (sess) {
      if (Date.now() > sess.expires_at) {
        this.sessions.delete(t);
        return null;
      }
      const u = this.users[sess.username];
      if (!u || u.active === false) {
        this.sessions.delete(t);
        return null;
      }
      return this.toPublicUser(u);
    }
    // Backwards-compatible fallback for automated scripts passing default ADMIN_PIN
    if (t === this.defaultPassword) {
      const def = this.users[this.defaultUsername] || Object.values(this.users).find((x) => x.role === 'super_admin');
      if (def && def.active !== false) return this.toPublicUser(def);
    }
    return null;
  }

  verifyRequest(req) {
    const token = req.headers['x-admin-token'] || req.headers['x-admin-pin'] || '';
    return this.verifyToken(token);
  }

  mustVerifyRequest(req, { requireSuper = false } = {}) {
    const user = this.verifyRequest(req);
    if (!user) {
      throw new StoreError('Sesi berakhir atau belum login. Silakan masuk kembali.', 'unauthorized', 401);
    }
    if (requireSuper && user.role !== 'super_admin') {
      throw new StoreError('Akses ditolak: Hanya Super Admin yang dapat mengelola akun pengguna.', 'forbidden', 403);
    }
    return user;
  }

  /**
   * Any logged-in admin can change their own password & display name.
   */
  changeOwnPassword(username, { currentPassword, newPassword, displayName }) {
    const uname = normalizeUsername(username);
    const u = this.users[uname];
    if (!u) throw new StoreError('User tidak ditemukan', 'not_found', 404);
    if (!verifyPassword(String(currentPassword || ''), u.salt, u.hash)) {
      throw new StoreError('Password saat ini salah', 'bad_password', 400);
    }
    const np = String(newPassword || '');
    if (np.length < 4) {
      throw new StoreError('Password baru minimal 4 karakter', 'bad_password', 400);
    }
    const { salt, hash } = hashPassword(np);
    u.salt = salt;
    u.hash = hash;
    if (displayName !== undefined && String(displayName).trim()) {
      u.display_name = String(displayName).trim().slice(0, 60);
    }
    u.updated_at = new Date().toISOString();
    this.save();
    return this.toPublicUser(u);
  }

  /**
   * Super Admin only: create a new admin user ('super_admin' or 'admin').
   */
  createUser(actor, { username, display_name, password, role = 'admin' }) {
    if (!actor || actor.role !== 'super_admin') {
      throw new StoreError('Hanya Super Admin yang dapat membuat user baru', 'forbidden', 403);
    }
    const uname = normalizeUsername(username);
    if (!/^[a-z0-9._-]{3,32}$/.test(uname)) {
      throw new StoreError('Username harus 3–32 karakter (huruf, angka, titik, garis bawah, atau strip)', 'bad_username', 400);
    }
    if (this.users[uname]) {
      throw new StoreError(`Username "${uname}" sudah terdaftar`, 'duplicate_username', 409);
    }
    const pwd = String(password || '');
    if (pwd.length < 4) {
      throw new StoreError('Password minimal 4 karakter', 'bad_password', 400);
    }
    const cleanRole = ROLES.includes(role) ? role : 'admin';
    const { salt, hash } = hashPassword(pwd);
    const now = new Date().toISOString();
    this.users[uname] = {
      username: uname,
      display_name: String(display_name || uname).trim().slice(0, 60),
      role: cleanRole,
      salt,
      hash,
      active: true,
      created_at: now,
      updated_at: now,
      last_login: null,
    };
    this.save();
    return this.toPublicUser(this.users[uname]);
  }

  /**
   * Super Admin only: update user role, display_name, active status, or reset password.
   */
  updateUser(actor, targetUsername, { display_name, role, password, active }) {
    if (!actor || actor.role !== 'super_admin') {
      throw new StoreError('Hanya Super Admin yang dapat mengubah data user lain', 'forbidden', 403);
    }
    const uname = normalizeUsername(targetUsername);
    const u = this.users[uname];
    if (!u) throw new StoreError(`User "${uname}" tidak ditemukan`, 'not_found', 404);

    // Prevent demoting or deactivating the last active super_admin
    const nextRole = role && ROLES.includes(role) ? role : u.role;
    const nextActive = active !== undefined ? Boolean(active) : u.active !== false;
    if (u.role === 'super_admin' && (nextRole !== 'super_admin' || !nextActive)) {
      const otherSupers = Object.values(this.users).filter(
        (x) => x.username !== uname && x.role === 'super_admin' && x.active !== false
      );
      if (otherSupers.length === 0) {
        throw new StoreError('Tidak dapat menurunkan level atau menonaktifkan satu-satunya Super Admin aktif', 'last_super_admin', 400);
      }
    }

    if (display_name !== undefined && String(display_name).trim()) {
      u.display_name = String(display_name).trim().slice(0, 60);
    }
    u.role = nextRole;
    u.active = nextActive;

    if (password !== undefined && String(password) !== '') {
      const pwd = String(password);
      if (pwd.length < 4) throw new StoreError('Password baru minimal 4 karakter', 'bad_password', 400);
      const { salt, hash } = hashPassword(pwd);
      u.salt = salt;
      u.hash = hash;
    }

    u.updated_at = new Date().toISOString();
    this.save();

    if (!u.active) {
      for (const [tok, sess] of this.sessions.entries()) {
        if (sess.username === uname) this.sessions.delete(tok);
      }
    }

    return this.toPublicUser(u);
  }

  /**
   * Super Admin only: delete a user (cannot delete self or the last super_admin).
   */
  deleteUser(actor, targetUsername) {
    if (!actor || actor.role !== 'super_admin') {
      throw new StoreError('Hanya Super Admin yang dapat menghapus user', 'forbidden', 403);
    }
    const uname = normalizeUsername(targetUsername);
    const u = this.users[uname];
    if (!u) throw new StoreError(`User "${uname}" tidak ditemukan`, 'not_found', 404);
    if (uname === actor.username) {
      throw new StoreError('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif', 'self_delete', 400);
    }
    if (u.role === 'super_admin') {
      const otherSupers = Object.values(this.users).filter(
        (x) => x.username !== uname && x.role === 'super_admin' && x.active !== false
      );
      if (otherSupers.length === 0) {
        throw new StoreError('Tidak dapat menghapus satu-satunya Super Admin aktif', 'last_super_admin', 400);
      }
    }
    delete this.users[uname];
    for (const [tok, sess] of this.sessions.entries()) {
      if (sess.username === uname) this.sessions.delete(tok);
    }
    this.save();
    return true;
  }
}
