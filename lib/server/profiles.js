/**
 * Tournament Profile Manager (`lib/server/profiles.js`).
 *
 * Allows a single SmashPoint instance (laptop/server) to host multiple independent
 * tournaments across the same day or multi-day events (e.g. Tournament A in the morning,
 * Tournament B in the afternoon, Tournament C at night) and switch between them at any
 * time without losing any match progress, score history, undo stacks, or Google Sheets
 * sync/webhook settings.
 *
 * Directory layout:
 *  - `data/profiles.json`                -> registry of profiles + `active_id`
 *  - `data/profiles/<id>/db.json`        -> isolated Store database (matches, logs, undo)
 *  - `data/profiles/<id>/sheets-sync.json` -> isolated Google Sheets URL & webhook config
 *  - `data/profiles/<id>/export-queue.json` -> isolated webhook retry queue
 *  - `exports/<id>/results.csv` & `logs/` -> isolated local CSV exports
 */
import fs from 'node:fs';
import path from 'node:path';
import { StoreError } from './store.js';

function slugifyId(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'turnamen';
}

export class ProfileManager {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
    this.dataRoot = path.join(rootDir, 'data');
    this.exportsRoot = path.join(rootDir, 'exports');
    this.profilesDir = path.join(this.dataRoot, 'profiles');
    this.registryFile = path.join(this.dataRoot, 'profiles.json');
    this.activeId = 'default';
    this.profiles = {};
    this.load();
  }

  load() {
    fs.mkdirSync(this.profilesDir, { recursive: true });
    fs.mkdirSync(this.exportsRoot, { recursive: true });

    if (fs.existsSync(this.registryFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
        if (raw && typeof raw.profiles === 'object') {
          this.profiles = raw.profiles;
          if (raw.active_id && this.profiles[raw.active_id]) {
            this.activeId = raw.active_id;
          }
        }
      } catch (e) {
        console.error('[profiles] gagal memuat profiles.json:', e.message);
      }
    }

    // Bootstrap default profile & migrate legacy root `data/db.json` if present
    if (!Object.keys(this.profiles).length) {
      const defId = 'default';
      const defDataDir = this.dataDirFor(defId);
      const defExportDir = this.exportDirFor(defId);
      fs.mkdirSync(defDataDir, { recursive: true });
      fs.mkdirSync(path.join(defExportDir, 'logs'), { recursive: true });

      // Migrate existing root files (`data/db.json`, `data/sheets-sync.json`, `data/export-queue.json`) so current progress is preserved
      let inferredName = 'Turnamen Utama (Default)';
      const legacyDb = path.join(this.dataRoot, 'db.json');
      const targetDb = path.join(defDataDir, 'db.json');
      if (fs.existsSync(legacyDb) && !fs.existsSync(targetDb)) {
        try {
          fs.copyFileSync(legacyDb, targetDb);
          const parsed = JSON.parse(fs.readFileSync(targetDb, 'utf8'));
          const firstMatch = Object.values(parsed.matches || {})[0];
          if (firstMatch?.tournament_name) {
            inferredName = firstMatch.tournament_name;
          }
        } catch { /* ignore */ }
      }
      for (const fname of ['sheets-sync.json', 'export-queue.json']) {
        const src = path.join(this.dataRoot, fname);
        const dst = path.join(defDataDir, fname);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          try {
            fs.copyFileSync(src, dst);
          } catch { /* ignore */ }
        }
      }

      const now = new Date().toISOString();
      this.profiles[defId] = {
        id: defId,
        name: inferredName,
        description: 'Profil turnamen bawaan',
        created_by: 'system',
        created_at: now,
        updated_at: now,
      };
      this.activeId = defId;
      this.save();
    }

    if (!this.profiles[this.activeId]) {
      this.activeId = Object.keys(this.profiles)[0];
      this.save();
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dataRoot, { recursive: true });
      const tmp = `${this.registryFile}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          {
            active_id: this.activeId,
            profiles: this.profiles,
          },
          null,
          2
        )
      );
      fs.renameSync(tmp, this.registryFile);
    } catch (e) {
      console.error('[profiles] gagal menyimpan profiles.json:', e.message);
    }
  }

  dataDirFor(id = this.activeId) {
    return path.join(this.profilesDir, id);
  }

  exportDirFor(id = this.activeId) {
    return path.join(this.exportsRoot, id);
  }

  syncFileFor(id = this.activeId) {
    return path.join(this.dataDirFor(id), 'sheets-sync.json');
  }

  readSyncConfig(id = this.activeId) {
    const f = this.syncFileFor(id);
    try {
      if (fs.existsSync(f)) {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      }
    } catch { /* ignore */ }
    return {
      url: '',
      sheetName: 'Jadwal',
      intervalSec: 0,
      webhookUrl: '',
      webhookSecret: '',
    };
  }

  writeSyncConfig(id, cfg) {
    const dir = this.dataDirFor(id);
    fs.mkdirSync(dir, { recursive: true });
    const f = this.syncFileFor(id);
    try {
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
    } catch { /* ignore */ }
  }

  /**
   * Compute live summary stats for a profile by inspecting either the active in-memory store
   * or the saved `db.json` on disk for inactive profiles.
   */
  profileSummary(p, activeStore = null) {
    let matchesMap = {};
    if (p.id === this.activeId && activeStore) {
      matchesMap = activeStore.matches || {};
    } else {
      const dbFile = path.join(this.dataDirFor(p.id), 'db.json');
      if (fs.existsSync(dbFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
          matchesMap = raw.matches || {};
        } catch { /* ignore */ }
      }
    }
    const list = Object.values(matchesMap);
    const total = list.length;
    const live = list.filter((m) => m.session_management?.status === 'in_progress').length;
    const setup = list.filter((m) => m.session_management?.status === 'locked').length;
    const finished = list.filter((m) => m.session_management?.status === 'finished').length;
    const scheduled = list.filter((m) => m.session_management?.status === 'scheduled').length;

    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      created_by: p.created_by || 'admin',
      created_at: p.created_at,
      updated_at: p.updated_at,
      active: p.id === this.activeId,
      stats: { total, live, setup, finished, scheduled },
    };
  }

  list(activeStore = null) {
    return Object.values(this.profiles)
      .map((p) => this.profileSummary(p, activeStore))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  activeProfile(activeStore = null) {
    const p = this.profiles[this.activeId];
    return p ? this.profileSummary(p, activeStore) : null;
  }

  /**
   * Create a new tournament profile (available to ALL admin levels: Super Admin & Operational Admin).
   */
  create({ name, description = '', createdBy = 'admin' }) {
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) {
      throw new StoreError('Nama profil turnamen wajib diisi', 'bad_profile_name', 400);
    }
    let id = slugifyId(cleanName);
    if (this.profiles[id]) {
      let suffix = 2;
      while (this.profiles[`${id}-${suffix}`]) suffix += 1;
      id = `${id}-${suffix}`;
    }

    const dataDir = this.dataDirFor(id);
    const exportDir = this.exportDirFor(id);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(exportDir, 'logs'), { recursive: true });

    const now = new Date().toISOString();
    this.profiles[id] = {
      id,
      name: cleanName,
      description: String(description || '').trim().slice(0, 160),
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    };
    this.save();
    return this.profiles[id];
  }

  /**
   * Rename / update description of a tournament profile.
   */
  update(id, { name, description }) {
    const p = this.profiles[id];
    if (!p) throw new StoreError(`Profil turnamen "${id}" tidak ditemukan`, 'not_found', 404);
    if (name !== undefined) {
      const cleanName = String(name || '').trim().slice(0, 80);
      if (!cleanName) throw new StoreError('Nama profil turnamen tidak boleh kosong', 'bad_profile_name', 400);
      p.name = cleanName;
    }
    if (description !== undefined) {
      p.description = String(description || '').trim().slice(0, 160);
    }
    p.updated_at = new Date().toISOString();
    this.save();
    return p;
  }

  /**
   * Activate / load a tournament profile by ID.
   */
  setActive(id) {
    const p = this.profiles[id];
    if (!p) throw new StoreError(`Profil turnamen "${id}" tidak ditemukan`, 'not_found', 404);
    if (this.profiles[this.activeId]) {
      this.profiles[this.activeId].updated_at = new Date().toISOString();
    }
    this.activeId = id;
    p.updated_at = new Date().toISOString();
    fs.mkdirSync(this.dataDirFor(id), { recursive: true });
    fs.mkdirSync(path.join(this.exportDirFor(id), 'logs'), { recursive: true });
    this.save();
    return p;
  }

  /**
   * Delete an inactive tournament profile. Cannot delete the currently active profile.
   */
  delete(id) {
    const p = this.profiles[id];
    if (!p) throw new StoreError(`Profil turnamen "${id}" tidak ditemukan`, 'not_found', 404);
    if (id === this.activeId) {
      throw new StoreError('Tidak dapat menghapus profil turnamen yang sedang aktif. Pindahkan ke profil lain terlebih dahulu.', 'cannot_delete_active', 400);
    }
    if (Object.keys(this.profiles).length <= 1) {
      throw new StoreError('Minimal harus ada 1 profil turnamen.', 'last_profile', 400);
    }
    delete this.profiles[id];
    this.save();
    try {
      fs.rmSync(this.dataDirFor(id), { recursive: true, force: true });
    } catch { /* ignore */ }
    return true;
  }
}
