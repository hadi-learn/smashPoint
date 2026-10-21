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
import { teamLabel } from '../engine.js';

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
  'started_at',
  'finished_at',
  'duration_min',
];
export const LOG_HEADER = ['log_id', 'match_number', 'timestamp', 'event_type', 'details', 'actor_id', 'score_a', 'score_b', 'set'];

export function resultRow(m) {
  const st = m.live_state;
  const w = st.winner;
  const started = st.started_at ? new Date(st.started_at).getTime() : null;
  const ended = m.finished_at ? new Date(m.finished_at).getTime() : st.ended_at ? new Date(st.ended_at).getTime() : null;
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
    started_at: st.started_at || '',
    finished_at: m.finished_at || '',
    duration_min: started && ended ? Math.round((ended - started) / 60000) : '',
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

  status() {
    return {
      webhook_configured: Boolean(this.webhookUrl),
      queue_length: this.queue.length,
      last_error: this.lastError,
      last_success: this.lastSuccess,
    };
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
    const resultsFile = path.join(this.exportDir, 'results.csv');
    if (!fs.existsSync(resultsFile)) fs.writeFileSync(resultsFile, `\uFEFF${RESULT_HEADER.join(',')}\r\n`);
    fs.appendFileSync(resultsFile, `${RESULT_HEADER.map((h) => csvEscape(row[h])).join(',')}\r\n`);
    const safe = match.match_number.replace(/[^A-Z0-9._-]/gi, '_');
    fs.writeFileSync(path.join(this.exportDir, 'logs', `${safe}.csv`), `\uFEFF${toCsv(LOG_HEADER, logs)}`);
    return row;
  }

  /** Main entry - called by the store 'finished' event listener. */
  async pushResults(match, logs) {
    let row;
    try {
      row = this.writeLocal(match, logs);
    } catch (e) {
      this.log.error('[exporter] gagal menulis ekspor lokal:', e.message);
      row = resultRow(match);
    }
    if (!this.webhookUrl) {
      this.onStatus(match.match_number, { state: 'local', message: 'Tersimpan di exports/ (webhook Google Sheets belum dikonfigurasi)' });
      return;
    }
    this.queue = this.queue.filter((j) => j.match_number !== match.match_number);
    this.queue.push({ match_number: match.match_number, payload: { type: 'match_result', secret: this.webhookSecret, result: row, logs }, attempts: 0 });
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
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          const res = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job.payload),
            signal: ctrl.signal,
            redirect: 'follow',
          });
          clearTimeout(t);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
          break; // offline - retry on next tick
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
