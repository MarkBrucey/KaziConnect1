'use client';

// The applications this browser follows: kept in localStorage (the same key as the original page, so
// people keep what they were following), and kept up to date over the Endpoint 6 WebSocket.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageOf, websiteApiKey } from './clientApi';
import type { Application, ApplicationStatus, Job } from './contract';

const KEY = 'kazi-applications';

export interface FollowedApp {
  applicationId: string;
  status?: ApplicationStatus['status'];
  jobId?: string;
  studentId?: string;
  preferredDate?: string;
  note?: string;
  jobTitle?: string;
  county?: string;
  live?: boolean; // are updates arriving over the WebSocket right now
}

type Patch = Partial<FollowedApp> & { applicationId: string };

// localStorage can be switched off (private windows); then nothing is remembered but the page still works.
export const followed = {
  all(): Record<string, FollowedApp> {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, FollowedApp>; } catch { return {}; }
  },
  get(id: string): FollowedApp | null {
    return followed.all()[id] || null;
  },
  save(patch: Patch): void {
    try {
      const all = followed.all();
      all[patch.applicationId] = { ...(all[patch.applicationId] || {}), ...patch };
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage is off */ }
  },
  remove(id: string): void {
    try {
      const all = followed.all();
      delete all[id];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage is off */ }
  },
};

// Jobs are looked up once each, for the titles shown on the cards.
const jobCache: Record<string, Job | null> = {};
export async function jobFor(jobId: string): Promise<Job | null> {
  if (!(jobId in jobCache)) {
    const res = await api<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
    jobCache[jobId] = res.status === 200 ? res.body : null;
  }
  return jobCache[jobId];
}

export function useFollowedApplications() {
  const [apps, setApps] = useState<FollowedApp[]>([]);
  const [glowing, setGlowing] = useState<Record<string, boolean>>({});
  const sockets = useRef<Record<string, WebSocket>>({});

  const refresh = useCallback(() => setApps(Object.values(followed.all()).reverse()), []);

  // Save a change and, if it matters to the person, make the card glow for a moment.
  const save = useCallback((patch: Patch, glow = false) => {
    followed.save(patch);
    refresh();
    if (glow) {
      setGlowing((g) => ({ ...g, [patch.applicationId]: true }));
      setTimeout(() => setGlowing((g) => ({ ...g, [patch.applicationId]: false })), 1500);
    }
  }, [refresh]);

  const subscribe = useCallback((id: string) => {
    if (sockets.current[id]) return;
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/applications/${encodeURIComponent(id)}/subscribe`;
    let ws: WebSocket;
    // A browser cannot set headers on a WebSocket, so the website's key goes in as a subprotocol (see realtime.ts).
    const key = websiteApiKey();
    try { ws = key ? new WebSocket(url, `kazi-key.${key}`) : new WebSocket(url); } catch { return; }
    sockets.current[id] = ws;
    ws.onopen = () => { if (followed.get(id)) save({ applicationId: id, live: true }); };
    ws.onmessage = (event) => {
      const update = JSON.parse(String(event.data)) as ApplicationStatus;
      const before = followed.get(id);
      if (!before) return;
      save({ applicationId: id, status: update.status, live: update.status !== 'cancelled' }, before.status !== update.status);
    };
    ws.onclose = () => {
      delete sockets.current[id];
      const now = followed.get(id);
      if (now && now.live) save({ applicationId: id, live: false });
    };
  }, [save]);

  // Nothing is live until it reconnects; then every followed application is checked and followed again.
  const checkAll = useCallback(async () => {
    for (const app of Object.values(followed.all())) {
      if (app.status === 'cancelled') continue;
      const res = await api<ApplicationStatus>(`/api/applications/${encodeURIComponent(app.applicationId)}/status`);
      if (res.status === 404) { save({ applicationId: app.applicationId, status: 'cancelled', live: false }); continue; }
      if (res.status === 200 && res.body) { save({ applicationId: app.applicationId, status: res.body.status }); subscribe(app.applicationId); }
    }
  }, [save, subscribe]);

  useEffect(() => {
    Object.keys(followed.all()).forEach((id) => followed.save({ applicationId: id, live: false }));
    refresh();
    const open = sockets.current;
    return () => { Object.values(open).forEach((ws) => { ws.onclose = null; ws.close(); }); };
  }, [refresh]);

  // Follow an application by its ID. Returns the problem, or null.
  const track = useCallback(async (raw: string): Promise<string | null> => {
    const id = raw.trim();
    if (!id) return null;
    const res = await api<ApplicationStatus>(`/api/applications/${encodeURIComponent(id)}/status`);
    if (res.status === 404) return `There is no application with the ID ${id}.`;
    if (res.status !== 200 || !res.body) return 'The application could not be loaded. Check your connection and try again.';
    save({ applicationId: id, status: res.body.status, live: false });
    subscribe(id);
    return null;
  }, [save, subscribe]);

  const cancel = useCallback(async (id: string): Promise<string | null> => {
    const res = await api(`/api/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.status !== 204) return messageOf(res, 'The application was not cancelled. Try again.');
    const before = followed.get(id);
    save({ applicationId: id, status: 'cancelled', live: false }, Boolean(before && before.status !== 'cancelled'));
    return null;
  }, [save]);

  const reschedule = useCallback(async (id: string, preferredDate: string, note: string): Promise<string | null> => {
    const body: { preferredDate: string; note?: string } = { preferredDate };
    if (note.trim()) body.note = note.trim();
    const res = await api<Application>(`/api/applications/${encodeURIComponent(id)}`, { method: 'PUT', body });
    if (res.status !== 200 || !res.body) return messageOf(res, 'The date was not changed. Try again.');
    save({ ...res.body }, true);
    return null;
  }, [save]);

  const remove = useCallback((id: string) => { followed.remove(id); refresh(); }, [refresh]);

  return { apps, glowing, save, subscribe, checkAll, track, cancel, reschedule, remove };
}
