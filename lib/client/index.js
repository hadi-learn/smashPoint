'use client';
/**
 * Client helpers: device identity, socket singleton, small storage utils.
 */
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';

let socket = null;

export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    socket.on('connect', () => socket.emit('hello', { device_id: getDeviceId() }));
  }
  return socket;
}

/** UUID v4 that works on plain http LAN origins (crypto.randomUUID needs a secure context). */
export function uuidv4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getDeviceId() {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('sp_device_id');
  if (!id) {
    id = uuidv4();
    localStorage.setItem('sp_device_id', id);
  }
  return id;
}

export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function lsSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

/** Emit with ack + timeout -> Promise. */
export function emitAck(event, data, timeout = 6000) {
  const s = getSocket();
  return new Promise((resolve) => {
    if (!s || !s.connected) return resolve({ ok: false, error: 'Tidak terhubung ke server', offline: true });
    s.timeout(timeout).emit(event, data, (err, res) => {
      if (err) resolve({ ok: false, error: 'Server tidak merespons', timeout: true });
      else resolve(res || { ok: false, error: 'Respons kosong' });
    });
  });
}

export async function api(path, { method = 'GET', body, pin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (pin) headers['x-admin-pin'] = pin;
  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.ok === undefined) data.ok = false;
    if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
    return data;
  } catch (e) {
    return { ok: false, error: `Jaringan: ${e.message}` };
  }
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
