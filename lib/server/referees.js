import fs from 'node:fs';
import path from 'node:path';
import { StoreError } from './store.js';

/**
 * Manages the standardized Referee / Umpire roster (`data/referees.json`)
 * so referee names stay consistent across all matches, logs, and reports.
 */
export class RefereeRoster {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'referees.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.referees = this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  _save() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.referees, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  list(activeOnly = false) {
    const items = activeOnly ? this.referees.filter((r) => r.active !== false) : this.referees;
    return [...items].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  }

  add({ name, license = '', phone = '' }) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean) throw new StoreError('Nama wasit tidak boleh kosong', 'bad_referee_name', 400);
    if (this.referees.some((r) => r.name.toLowerCase() === clean.toLowerCase())) {
      throw new StoreError(`Nama wasit "${clean}" sudah ada dalam daftar`, 'duplicate_referee', 409);
    }
    const now = new Date().toISOString();
    const item = {
      id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      license: String(license || '').trim().slice(0, 40),
      phone: String(phone || '').trim().slice(0, 30),
      active: true,
      created_at: now,
      updated_at: now,
    };
    this.referees.push(item);
    this._save();
    return item;
  }

  bulkAdd(text) {
    const lines = String(text || '')
      .split(/[\r\n,;]+/)
      .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean);
    if (!lines.length) throw new StoreError('Masukkan minimal 1 nama wasit', 'empty_bulk', 400);
    const added = [];
    const skipped = [];
    const now = new Date().toISOString();
    for (const clean of lines) {
      const exists = this.referees.some((r) => r.name.toLowerCase() === clean.toLowerCase());
      if (exists) {
        skipped.push(clean);
        continue;
      }
      const item = {
        id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${added.length}`,
        name: clean,
        license: '',
        phone: '',
        active: true,
        created_at: now,
        updated_at: now,
      };
      this.referees.push(item);
      added.push(item);
    }
    if (added.length > 0) this._save();
    return { added, skipped };
  }

  update(id, { name, license, phone, active }) {
    const idx = this.referees.findIndex((r) => r.id === id);
    if (idx === -1) throw new StoreError('Data wasit tidak ditemukan', 'not_found', 404);
    const cur = this.referees[idx];
    if (name !== undefined) {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!clean) throw new StoreError('Nama wasit tidak boleh kosong', 'bad_referee_name', 400);
      if (this.referees.some((r) => r.id !== id && r.name.toLowerCase() === clean.toLowerCase())) {
        throw new StoreError(`Nama wasit "${clean}" sudah digunakan`, 'duplicate_referee', 409);
      }
      cur.name = clean;
    }
    if (license !== undefined) cur.license = String(license || '').trim().slice(0, 40);
    if (phone !== undefined) cur.phone = String(phone || '').trim().slice(0, 30);
    if (active !== undefined) cur.active = Boolean(active);
    cur.updated_at = new Date().toISOString();
    this._save();
    return cur;
  }

  delete(id) {
    const idx = this.referees.findIndex((r) => r.id === id);
    if (idx === -1) throw new StoreError('Data wasit tidak ditemukan', 'not_found', 404);
    const [removed] = this.referees.splice(idx, 1);
    this._save();
    return removed;
  }

  mergeRemote(remoteList = []) {
    if (!Array.isArray(remoteList) || !remoteList.length) return { added: 0, updated: 0 };
    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (const r of remoteList) {
      const cleanName = String(r?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!cleanName) continue;
      const activeVal = r.active === false || String(r.active).toLowerCase() === 'false' ? false : true;
      const existing = this.referees.find((x) => x.name.toLowerCase() === cleanName.toLowerCase());
      if (existing) {
        let changed = false;
        if (r.license && !existing.license) {
          existing.license = String(r.license).trim().slice(0, 40);
          changed = true;
        }
        if (r.phone && !existing.phone) {
          existing.phone = String(r.phone).trim().slice(0, 30);
          changed = true;
        }
        if (r.updated_at && (!existing.updated_at || String(r.updated_at) > String(existing.updated_at))) {
          if (r.license !== undefined) existing.license = String(r.license || '').trim().slice(0, 40);
          if (r.phone !== undefined) existing.phone = String(r.phone || '').trim().slice(0, 30);
          existing.active = activeVal;
          existing.updated_at = String(r.updated_at);
          changed = true;
        }
        if (changed) updated += 1;
      } else {
        this.referees.push({
          id: String(r.id || `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
          name: cleanName,
          license: String(r.license || '').trim().slice(0, 40),
          phone: String(r.phone || '').trim().slice(0, 30),
          active: activeVal,
          created_at: r.created_at || now,
          updated_at: r.updated_at || now,
        });
        added += 1;
      }
    }
    if (added > 0 || updated > 0) this._save();
    return { added, updated };
  }
}
