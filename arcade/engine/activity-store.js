// A dated, deduplicated journal. The PC owns results; the phone keeps a local copy.
export const JOURNAL_KEY = 'inmotion.sessions.v1';
export const numericFields = ['steps','metres','kcal','active','jumps','squats','seconds','coins'];
export function normalizeSession(row) {
  if (!row || typeof row.id !== 'string' || row.id.length > 100 || typeof row.userId !== 'string' || !['subway','track','redlight','jumprope'].includes(row.game) || !Number.isFinite(row.startedAt) || !Number.isFinite(row.updatedAt)) return null;
  const out = {id:row.id,userId:row.userId,game:row.game,startedAt:row.startedAt,updatedAt:row.updatedAt,complete:row.complete===true, outcome: String(row.outcome || '').slice(0,80)};
  for (const key of numericFields) out[key] = Number.isFinite(row[key]) ? Math.max(0,row[key]) : 0;
  return out;
}
export function mergeSessions(existing, incoming) {
  const map = new Map();
  for (const raw of [...existing,...incoming]) {
    const row=normalizeSession(raw); if (!row) continue;
    const old=map.get(row.id);
    if (!old || (row.updatedAt >= old.updatedAt && (!old.complete || row.complete))) map.set(row.id,row);
  }
  return [...map.values()].sort((a,b)=>a.startedAt-b.startedAt);
}
export function readSessions(storage) {
  try { const value=JSON.parse((storage||globalThis.localStorage).getItem(JOURNAL_KEY)||'[]'); return Array.isArray(value)?mergeSessions([],value):[]; } catch { return []; }
}
export function totals(rows) {
  const out=Object.fromEntries(numericFields.map(key=>[key,0])); out.runs=0;
  for(const row of rows){for(const key of numericFields)out[key]+=row[key]||0;if(row.complete)out.runs++;}
  return out;
}
export function periodRows(rows, period, now=new Date()) {
  const start=new Date(now); start.setHours(0,0,0,0);
  if(period==='W')start.setDate(start.getDate()-((start.getDay()+6)%7));
  if(period==='M')start.setDate(1);
  return rows.filter(row=>row.startedAt>=+start&&row.startedAt<=+now);
}
