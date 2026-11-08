/**
 * sheetsExporter - pushes finished match results & audit logs (PRD 8.3).
 *
 * Offline-first strategy:
 *  1. Always write locally to ./exports (results.csv + logs/<match>.csv). Never lost.
 *  2. If GOOGLE_SHEETS_WEBHOOK_URL is configured (Google Apps Script Web App, see
 *     docs/google-apps-script.gs), the payload is queued and POSTed. When the LAN has
 *     no internet the job stays in a persisted queue and is retried periodically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { csvEscape, toCsv } from './ingest.js';
import { formatDuration, formatLocalDateTime, matchDurationSec, teamLabel } from '../engine.js';

export const RESULT_HEADER = [
  'match_number',
  'tournament_name',
  'category_name',
  'discipline',
  'scheduled_date',
  'court_number',
  'scheduled_time',
  'team_a',
  'team_a_club',
  'team_b',
  'team_b_club',
  'scoring_method',
  'scoring_type',
  'sets_a',
  'sets_b',
  'set_scores',
  'winner',
  'winner_team',
  'referee_name',
  'shuttlecock_count',
  'started_at',
  'finished_at',
  'duration_min',
  'duration_text',
];
export const LOG_HEADER = [
  'log_id',
  'match_number',
  'timestamp',
  'event_type',
  'details',
  'actor_id',
  'referee_name',
  'shuttlecock_count',
  'score_a',
  'score_b',
  'set',
];

export function formatLogRow(l, match = null) {
  return {
    log_id: l.log_id,
    match_number: l.match_number,
    timestamp: formatLocalDateTime(l.timestamp),
    event_type: l.event_type,
    details: l.details,
    actor_id: l.actor_id,
    referee_name: l.referee_name || match?.session_management?.controller_label || '',
    shuttlecock_count: l.shuttlecock_count ?? match?.live_state?.shuttlecock_count ?? 0,
    score_a: l.score_a,
    score_b: l.score_b,
    set: l.set,
  };
}

export function resultRow(m) {
  const st = m.live_state;
  const w = st.winner;
  const sec = matchDurationSec(m);
  return {
    match_number: m.match_number,
    tournament_name: m.tournament_name,
    category_name: m.category_name,
    discipline: m.discipline,
    scheduled_date: m.scheduled_date || '',
    court_number: m.court_number,
    scheduled_time: m.scheduled_time,
    team_a: teamLabel(m, 'a'),
    team_a_club: m.teams.team_a.club,
    team_b: teamLabel(m, 'b'),
    team_b_club: m.teams.team_b.club,
    scoring_method: m.rules.scoring_method,
    scoring_type: m.rules.scoring_type,
    sets_a: st.sets.a,
    sets_b: st.sets.b,
    set_scores: st.set_history.map((s) => `${s.a}-${s.b}`).join(' | '),
    winner: w ? w.toUpperCase() : '',
    winner_team: w ? teamLabel(m, w) : '',
    referee_name: m.session_management?.controller_label || '',
    shuttlecock_count: st.shuttlecock_count ?? 0,
    started_at: formatLocalDateTime(st.started_at),
    finished_at: formatLocalDateTime(m.finished_at || st.ended_at),
    duration_min: sec !== null ? Math.round(sec / 60) : '',
    duration_text: sec !== null ? formatDuration(sec) : '',
  };
}

export class SheetsExporter {
  constructor({ exportDir, dataDir, webhookUrl, webhookSecret, onStatus, logger = console }) {
    this.exportDir = exportDir;
    this.queueFile = path.join(dataDir, 'export-queue.json');
    this.webhookUrl = webhookUrl || '';
    this.webhookSecret = webhookSecret || '';
    this.onStatus = onStatus || (() => {});
    this.log = logger;
    this.queue = [];
    this.lastError = null;
    this.lastSuccess = null;
    this.flushing = false;
    fs.mkdirSync(path.join(exportDir, 'logs'), { recursive: true });
    try {
      if (fs.existsSync(this.queueFile)) this.queue = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
    } catch {
      this.queue = [];
    }
    this.timer = setInterval(() => this.flush(), 60 * 1000);
    this.timer.unref?.();
  }

  /**
   * Switch exporter storage directory & webhook config to a different Tournament Profile.
   */
  switchProfile({ exportDir, dataDir, webhookUrl = '', webhookSecret = '' }) {
    this._saveQueue();
    this.exportDir = exportDir;
    this.queueFile = path.join(dataDir, 'export-queue.json');
    this.webhookUrl = String(webhookUrl || '').trim();
    this.webhookSecret = String(webhookSecret || '').trim();
    this.lastError = null;
    this.lastSuccess = null;
    fs.mkdirSync(path.join(exportDir, 'logs'), { recursive: true });
    try {
      if (fs.existsSync(this.queueFile)) this.queue = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
      else this.queue = [];
    } catch {
      this.queue = [];
    }
  }

  status() {
    return {
      webhook_configured: Boolean(this.webhookUrl),
      webhook_url: this.webhookUrl || '',
      has_secret: Boolean(this.webhookSecret),
      queue_length: this.queue.length,
      last_error: this.lastError,
      last_success: this.lastSuccess,
    };
  }

  setConfig({ webhookUrl, webhookSecret } = {}) {
    if (webhookUrl !== undefined) this.webhookUrl = String(webhookUrl || '').trim();
    if (webhookSecret !== undefined) this.webhookSecret = String(webhookSecret || '').trim();
    // Update secret inside any queued payloads
    for (const job of this.queue) {
      if (job.payload) job.payload.secret = this.webhookSecret;
    }
    this._saveQueue();
  }

  async _postToWebhook(payload) {
    if (!this.webhookUrl) throw new Error('URL Webhook Google Sheets belum diisi.');
    if (!/^https?:\/\//i.test(this.webhookUrl)) {
      throw new Error('URL Webhook harus diawali https:// (contoh: https://script.google.com/macros/s/.../exec)');
    }
    if (/docs\.google\.com\/spreadsheets/i.test(this.webhookUrl)) {
      throw new Error('URL yang dimasukkan adalah link Spreadsheet biasa, BUKAN URL Web App Google Apps Script (harus berakhiran /exec dari menu Deploy -> Manage deployments).');
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        // text/plain avoids CORS/redirect issues on Google Apps Script while still delivering JSON in e.postData.contents
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (/^\s*<(!doctype|html)/i.test(text)) {
        if (/accounts\.google\.com|ServiceLogin/i.test(text)) {
          throw new Error('Akses Web App ditolak Google (halaman login). Pastikan saat Deploy Web App di Apps Script, bagian "Who has access (Siapa yang memiliki akses)" diatur ke "Anyone (Siapa saja)".');
        }
        const m = text.match(/<title>([^<]+)<\/title>/i);
        throw new Error(`Google Apps Script mengembalikan halaman error HTML${m ? ` (${m[1]})` : ''}. Pastikan kode Apps Script sudah di-Deploy (New version) dan akses diset ke "Anyone".`);
      }
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON 200 response
      }
      if (data && data.ok === false) {
        if (data.error === 'bad secret') {
          throw new Error('SECRET tidak cocok antara aplikasi dan kode Google Apps Script (kosongkan SECRET di kedua sisi atau samakan nilainya).');
        }
        throw new Error(data.error || 'Ditolak oleh Google Apps Script');
      }
      return data || { ok: true };
    } finally {
      clearTimeout(t);
    }
  }

  async testConnection() {
    const res = await this._postToWebhook({
      type: 'ping',
      secret: this.webhookSecret,
      timestamp: new Date().toISOString(),
    });
    this.lastSuccess = new Date().toISOString();
    this.lastError = null;
    return res;
  }

  _saveQueue() {
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue));
    } catch (e) {
      this.log.error('[exporter] gagal menyimpan antrian:', e.message);
    }
  }

  writeLocal(match, logs) {
    const row = resultRow(match);
    const formattedLogs = (logs || []).map((l) => formatLogRow(l, match));
    const resultsFile = path.join(this.exportDir, 'results.csv');
    if (!fs.existsSync(resultsFile)) fs.writeFileSync(resultsFile, `\uFEFF${RESULT_HEADER.join(',')}\r\n`);
    fs.appendFileSync(resultsFile, `${RESULT_HEADER.map((h) => csvEscape(row[h])).join(',')}\r\n`);
    const safe = match.match_number.replace(/[^A-Z0-9._-]/gi, '_');
    fs.writeFileSync(path.join(this.exportDir, 'logs', `${safe}.csv`), `\uFEFF${toCsv(LOG_HEADER, formattedLogs)}`);
    return row;
  }

  /** Main entry - called by the store 'finished' event listener. */
  async pushResults(match, logs) {
    const formattedLogs = (logs || []).map((l) => formatLogRow(l, match));
    let row;
    try {
      row = this.writeLocal(match, formattedLogs);
    } catch (e) {
      this.log.error('[exporter] gagal menulis ekspor lokal:', e.message);
      row = resultRow(match);
    }
    if (!this.webhookUrl) {
      this.onStatus(match.match_number, { state: 'local', message: 'Tersimpan di exports/ (webhook Google Sheets belum dikonfigurasi)' });
      return;
    }
    this.queue = this.queue.filter((j) => j.match_number !== match.match_number);
    this.queue.push({ match_number: match.match_number, payload: { type: 'match_result', secret: this.webhookSecret, result: row, logs: formattedLogs }, attempts: 0 });
    this._saveQueue();
    this.onStatus(match.match_number, { state: 'pending', message: 'Menunggu sinkronisasi ke Google Sheets' });
    await this.flush();
  }

  async flush() {
    if (this.flushing || !this.webhookUrl || !this.queue.length) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const job = this.queue[0];
        try {
          await this._postToWebhook(job.payload);
          this.queue.shift();
          this._saveQueue();
          this.lastSuccess = new Date().toISOString();
          this.lastError = null;
          this.onStatus(job.match_number, { state: 'sent', message: 'Terkirim ke Google Sheets' });
        } catch (e) {
          job.attempts += 1;
          this.lastError = `${job.match_number}: ${e.message}`;
          this._saveQueue();
          this.onStatus(job.match_number, { state: 'pending', message: `Gagal kirim (percobaan ${job.attempts}): ${e.message}. Akan dicoba ulang.` });
          break; // offline or error - retry on next tick
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
