/**
 * omikuji (おみくじ) — fortune platform, local domain (AWAI-3079).
 *
 * Designed from the former Worker's method list and bpmn/omikuji.bpmn
 * (drawFortune / listFortunes / getFortune / resetFortune / createShrine /
 * updateShrine / listShrines / getShrine); the original logic ran on a remote
 * LangServer and was not in this repository.
 *
 *   shrine  : a named shrine with a fortune table (non-negative integer weight
 *             per rank). Default table follows a common distribution.
 *   draw    : picks a rank with probability weight/total, using the platform's
 *             cryptographic random source. One draw per person per shrine per
 *             day (local date).
 *   reset   : tying the slip at the shrine (結ぶ) — the fortune is released and
 *             that person may draw again the same day.
 */
import type { LocalStore } from "../local-store.js";
import { getOne, idSlug, isNonEmpty, listAll, nowISO, put } from "./records.js";

export const SHRINE = "cloud.itonami.apps.omikuji.shrine";
export const FORTUNE = "cloud.itonami.apps.omikuji.fortune";
export const RANKS = ["大吉", "吉", "中吉", "小吉", "末吉", "凶", "大凶"] as const;
export type Rank = (typeof RANKS)[number];
export const DEFAULT_WEIGHTS: Record<Rank, number> = { "大吉": 16, "吉": 35, "中吉": 5, "小吉": 4, "末吉": 6, "凶": 30, "大凶": 4 };
const MESSAGES: Record<Rank, string> = {
  "大吉": "思うことは叶います。おごらず続けましょう。", "吉": "穏やかに進みます。", "中吉": "少しずつ良くなります。",
  "小吉": "小さな良いことがあります。", "末吉": "後になって良くなります。", "凶": "慎重に。焦らず待ちましょう。", "大凶": "今は控えめに。これ以上悪くはなりません。",
};

export interface Shrine { shrineId: string; name: string; weights: Record<Rank, number>; createdAt: string; updatedAt: string }
export interface Fortune { drawId: string; shrineId: string; person: string; rank: Rank; message: string; day: string; drawnAt: string; tied: boolean; tiedAt?: string }

export interface CreateShrineInput { shrineId: string; name: string; weights?: Partial<Record<Rank, number>> }
export interface UpdateShrineInput { shrineId: string; name?: string; weights?: Partial<Record<Rank, number>> }
export interface GetShrineInput { shrineId: string }
export interface DrawFortuneInput { drawId: string; shrineId: string; person: string }
export interface ListFortunesInput { shrineId?: string; person?: string }
export interface GetFortuneInput { drawId: string }
export interface ResetFortuneInput { drawId: string }

const sKey = (id: string) => `shrine-${idSlug(id)}`;
const fKey = (id: string) => `fortune-${idSlug(id)}`;

function normalizeWeights(w: Partial<Record<Rank, number>> | undefined, base: Record<Rank, number>): Record<Rank, number> | null {
  const out = { ...base };
  for (const [k, v] of Object.entries(w ?? {})) {
    if (!RANKS.includes(k as Rank)) return null;
    if (!Number.isInteger(v) || (v as number) < 0) return null;
    out[k as Rank] = v as number;
  }
  return RANKS.some((r) => out[r] > 0) ? out : null;
}

/** Pick a rank given a uniform integer in [0, total). */
export function pickRank(weights: Record<Rank, number>, roll: number): Rank {
  let acc = 0;
  for (const r of RANKS) { acc += weights[r]; if (roll < acc) return r; }
  throw new Error("roll out of range");
}

function uniformBelow(n: number): number {
  const max = Math.floor(0xffffffff / n) * n; // reject the biased tail
  const buf = new Uint32Array(1);
  for (;;) { globalThis.crypto.getRandomValues(buf); if (buf[0] < max) return buf[0] % n; }
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function createShrine(e: LocalStore, input: CreateShrineInput) {
  if (!isNonEmpty(input.shrineId) || !isNonEmpty(input.name)) return { status: "rejected", error: "missingRequiredFields" };
  if (await getOne(e, SHRINE, sKey(input.shrineId))) return { status: "alreadyExists" };
  const weights = normalizeWeights(input.weights, DEFAULT_WEIGHTS);
  if (!weights) return { status: "rejected", error: "invalidWeights" };
  const now = nowISO();
  return { status: "created", shrineUri: await put(e, SHRINE, sKey(input.shrineId), { shrineId: input.shrineId, name: input.name, weights, createdAt: now, updatedAt: now }) };
}

export async function updateShrine(e: LocalStore, input: UpdateShrineInput) {
  const s = isNonEmpty(input.shrineId) ? await getOne<Shrine>(e, SHRINE, sKey(input.shrineId)) : null;
  if (!s) return { status: "rejected", error: "shrineNotFound" };
  const weights = normalizeWeights(input.weights, s.value.weights);
  if (!weights) return { status: "rejected", error: "invalidWeights" };
  if (input.name !== undefined && !isNonEmpty(input.name)) return { status: "rejected", error: "nameEmpty" };
  await put(e, SHRINE, sKey(input.shrineId), { ...s.value, name: input.name ?? s.value.name, weights, updatedAt: nowISO() });
  return { status: "updated", weights };
}

export async function listShrines(e: LocalStore) {
  const items = (await listAll<Shrine>(e, SHRINE)).map((r) => r.value);
  return { items, total: items.length };
}

export async function getShrine(e: LocalStore, input: GetShrineInput) {
  const s = isNonEmpty(input.shrineId) ? await getOne<Shrine>(e, SHRINE, sKey(input.shrineId)) : null;
  if (!s) return { status: "notFound" };
  const total = RANKS.reduce((a, r) => a + s.value.weights[r], 0);
  return { status: "ok", shrine: s.value, odds: Object.fromEntries(RANKS.map((r) => [r, Math.round((s.value.weights[r] / total) * 1000) / 1000])) };
}

export async function drawFortune(e: LocalStore, input: DrawFortuneInput, now: Date = new Date(), roll?: number) {
  if (![input.drawId, input.shrineId, input.person].every(isNonEmpty)) return { status: "rejected", error: "missingRequiredFields" };
  const s = await getOne<Shrine>(e, SHRINE, sKey(input.shrineId));
  if (!s) return { status: "rejected", error: "shrineNotFound" };
  if (await getOne(e, FORTUNE, fKey(input.drawId))) return { status: "rejected", error: "drawIdExists" };
  const day = localDay(now);
  const today = (await listAll<Fortune>(e, FORTUNE)).map((r) => r.value)
    .find((f) => f.shrineId === input.shrineId && f.person === input.person && f.day === day && !f.tied);
  if (today) return { status: "alreadyDrawnToday", drawId: today.drawId, rank: today.rank };
  const total = RANKS.reduce((a, r) => a + s.value.weights[r], 0);
  const rank = pickRank(s.value.weights, roll ?? uniformBelow(total));
  const fortune: Fortune = { drawId: input.drawId, shrineId: input.shrineId, person: input.person, rank, message: MESSAGES[rank], day, drawnAt: now.toISOString(), tied: false };
  await put(e, FORTUNE, fKey(input.drawId), fortune);
  return { status: "drawn", rank, message: fortune.message };
}

export async function listFortunes(e: LocalStore, input: ListFortunesInput = {}) {
  const items = (await listAll<Fortune>(e, FORTUNE)).map((r) => r.value)
    .filter((f) => (!input.shrineId || f.shrineId === input.shrineId) && (!input.person || f.person === input.person));
  const byRank = Object.fromEntries(RANKS.map((r) => [r, items.filter((f) => f.rank === r).length]));
  return { items, total: items.length, byRank };
}

export async function getFortune(e: LocalStore, input: GetFortuneInput) {
  const f = isNonEmpty(input.drawId) ? await getOne<Fortune>(e, FORTUNE, fKey(input.drawId)) : null;
  return f ? { status: "ok", fortune: f.value } : { status: "notFound" };
}

export async function resetFortune(e: LocalStore, input: ResetFortuneInput) {
  const f = isNonEmpty(input.drawId) ? await getOne<Fortune>(e, FORTUNE, fKey(input.drawId)) : null;
  if (!f) return { status: "rejected", error: "fortuneNotFound" };
  if (f.value.tied) return { status: "alreadyTied" };
  await put(e, FORTUNE, fKey(input.drawId), { ...f.value, tied: true, tiedAt: nowISO() });
  return { status: "tied", drawId: input.drawId };
}
