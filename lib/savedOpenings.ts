// Week 11: the last list of open roles Sherehe gave us, kept so the Event work page still has something honest to
// show when Sherehe is slow or down.
//
// From best to worst, what an employer sees on Endpoint 22:
//   1. the live list                                   Kazi-Stale: false, Kazi-As-Of: when Kazi built it
//   2. the saved list, clearly marked                  Kazi-Stale: true,  Kazi-As-Of: when it was saved
//   3. 502 { message } "Event information is unavailable right now..." (nothing saved yet)
//
// One saved list per county (and one for all counties). Only real county names are kept, so a stream of made-up
// county names cannot fill memory. The copy lives in memory only: a restart clears it, which is fine for this
// course; a production system would keep it in a cache or the database.
//
// Every failure is still logged (logUpstream in the route), so a saved copy never hides, say, a wrong key.

import { COUNTIES } from '../sharedLists';
import { singleton } from './singleton';
import type { EventOpening } from './contract';

export interface SavedList {
  data: EventOpening[];
  asOf: string; // ISO time the list was built from Sherehe's answer
}

const state = singleton('savedOpenings', () => ({
  lists: new Map<string, SavedList>(),
  served: 0, // how many times a saved list was given out because Sherehe failed (shown in /api/stats)
}));

const KNOWN = new Set(COUNTIES.map((c) => c.toLowerCase()));
const keyOf = (county: string): string | null => {
  const k = county.trim().toLowerCase();
  if (k === '') return '(all)';
  return KNOWN.has(k) ? k : null;
};

// Keeps a live list. Returns its asOf.
export function remember(county: string, data: EventOpening[], now: Date = new Date()): string {
  const asOf = now.toISOString();
  const key = keyOf(county);
  if (key) state.lists.set(key, { data, asOf });
  return asOf;
}

// The saved list for this county, or null. Counts each time one is given out.
export function recall(county: string): SavedList | null {
  const key = keyOf(county);
  const found = key ? state.lists.get(key) ?? null : null;
  if (found) state.served += 1;
  return found;
}

export const servedCount = (): number => state.served;

// For tests: start with nothing saved, as after a restart.
export function forget(): void { state.lists.clear(); state.served = 0; }
