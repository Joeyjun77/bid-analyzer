// fn-collect-g2b-sheet v3 (2026-10-23)
// G2B 양식 자동 수집 1차 — 나라장터 경기 전기공사업 개찰 공고를 g2b_auto_sheet에만 계산·저장한다.
// bid_records·bid_predictions에는 쓰지 않는다(예측 엔진 격리). 스펙: docs/superpowers/specs/2026-10-23-g2b-auto-collect-design.md
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { buildUrl, fetchG2B, kstNow } from './_shared/g2b.ts';
import { getApiKey, incrementApiCall, rpc, supaEnv } from './_shared/db.ts';
import { sumAValue, computeSheet, classifyTrade, parseOpengCorpInfo } from './calc.js';

const PUB = { key: 'prod_bid_public', service: 'BidPublicInfoService' };
const SCS = { key: 'prod_scsbid_info', service: 'ScsbidInfoService' };
const GIVE_UP_DAYS = 7; // 개찰 후 7일 지나도 재료가 안 모이면 포기

interface Body { mode?: 'daily' | 'backfill'; max_calls?: number; dry_run?: boolean }
type Cand = Record<string, any>;

const ymd = (d: Date) => d.toISOString().slice(0, 10); // kstNow()는 +9h 이동된 Date라 KST 날짜가 나온다
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 86400000));

class Budget {
  calls = 0;
  keys: Record<string, { secret: string; left: number }> = {};
  constructor(public max: number, public dry: boolean) {}
  async open(k: { key: string }) {
    const row = await getApiKey(k.key);
    this.keys[k.key] = { secret: row.decrypted_secret, left: row.daily_limit - row.calls_today };
  }
  can(k: { key: string }) { return this.calls < this.max && (this.keys[k.key]?.left ?? 0) > 0; }
  // 한 번 호출하고 공고번호가 맞는 항목들을 돌려준다. 예산이 없으면 undefined.
  async items(k: { key: string; service: string }, op: string, params: Record<string, string>, no: string): Promise<any[] | undefined> {
    if (!this.can(k)) return undefined;
    this.calls++; this.keys[k.key].left--;
    await incrementApiCall(k.key, 1).catch(() => 0);
    const resp = await fetchG2B(buildUrl(k.service, op, this.keys[k.key].secret, params));
    if (!resp.ok) throw new Error(`${op} ${no} rc=${resp.resultCode ?? resp.status} ${resp.resultMsg ?? resp.error ?? ''}`.slice(0, 160));
    return (resp.items as any[]).filter((it) => it?.bidNtceNo === no);
  }
  // 첫 항목. 예산이 없으면 undefined, 응답이 비면 null.
  async one(k: { key: string; service: string }, op: string, params: Record<string, string>, no: string) {
    const its = await this.items(k, op, params, no);
    return its === undefined ? undefined : (its[0] ?? null);
  }
}

// PostgREST 일괄 upsert는 모든 행의 키가 같아야 한다(PGRST102) — 없는 값은 null로 채운다.
const COLS = ['bid_ntce_no', 'bid_ntce_ord', 'status', 'missing', 'purpose', 'excel_record_id', 'api_record_id', 'od', 'pn', 'ag', 'canonical_ag', 'at', 'reg',
  'trade_elec', 'trade_source', 'ba', 'av', 'a_applies', 'a_items', 'xp', 'fr', 'bp', 'co', 'co_no', 'pc', 'ar1', 'br1', 'floor_price', 'attempts', 'computed_at', 'updated_at'];

async function upsertRows(raw: Record<string, unknown>[]) {
  if (!raw.length) return;
  const rows = raw.map((r) => Object.fromEntries(COLS.map((k) => [k, r[k] ?? null])));
  const { url, key } = supaEnv();
  const res = await fetch(`${url}/rest/v1/g2b_auto_sheet?on_conflict=bid_ntce_no`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// 공고 하나 처리 → 저장할 행(또는 예산 소진 시 null). 과거분의 주공종·하한율·면허는 후보 함수가 메타 테이블에서 채워 준다.
async function processOne(c: Cand, b: Budget, today: string) {
  const no = c.bid_ntce_no as string;
  let mainCnstty = c.main_cnstty || null; // 원본의 빈 문자열은 값 없음으로
  let fr = c.fr || null;
  const ord = (c.bid_ntce_ord as string) ?? '000';
  if (fr == null) { // 하한율만 공고 단건 조회(inqryDiv=2·날짜 없음). 주공종도 같이 채운다.
    const it = await b.one(PUB, 'getBidPblancListInfoCnstwk', { inqryDiv: '2', bidNtceNo: no, pageNo: '1', numOfRows: '5' }, no);
    if (it === undefined) return null;
    if (it) { mainCnstty = mainCnstty || it.mainCnsttyNm || null; fr = it.sucsfbidLwltRate || null; }
  }
  let trade = classifyTrade({ cat: c.cat, mainCnsttyNm: mainCnstty });
  if (trade.elec === null) { // 소액수의견적 등 주공종이 빈 공고는 면허 제한 목록에만 업종이 있다(차수 필수, 2026-10-23 실측)
    let lic: string[] | undefined = Array.isArray(c.licenses) ? c.licenses : undefined; // 과거분은 메타 테이블에 미리 모아 둠
    if (lic === undefined) {
      const its = await b.items(PUB, 'getBidPblancListInfoLicenseLimit', { inqryDiv: '2', bidNtceNo: no, bidNtceOrd: ord, pageNo: '1', numOfRows: '20' }, no);
      if (its === undefined) return null;
      lic = its.map((x) => x.lcnsLmtNm);
    }
    trade = lic.length
      ? classifyTrade({ cat: c.cat, mainCnsttyNm: mainCnstty, licenseNames: lic })
      : { elec: false, source: 'no_license_limit' }; // 업종 제한이 없는 공고는 전기공사업 공고가 아니다 — 매일 재조회 방지
  }
  const base = {
    bid_ntce_no: no, bid_ntce_ord: c.bid_ntce_ord ?? '000', od: c.od, pn: c.pn, ag: c.ag, canonical_ag: c.canonical_ag, at: c.at, reg: c.reg,
    excel_record_id: c.excel_record_id ?? null, api_record_id: c.api_record_id ?? null,
    purpose: c.excel_record_id != null ? 'compare' : 'display',
    trade_elec: trade.elec, trade_source: trade.source, attempts: Number(c.attempts ?? 0) + 1, updated_at: new Date().toISOString(),
  };
  const expired = c.od && addDays(c.od, GIVE_UP_DAYS) < today;
  if (trade.elec === false && !c.mine) return { ...base, status: 'not_target', missing: null };
  if (trade.elec === null && !c.mine) return { ...base, status: expired ? 'gave_up' : 'pending', missing: ['trade'] };

  let { co, co_no, bp, pc } = c;
  if (bp == null && b.can(SCS)) { // 1순위 금액은 개찰결과 단건 조회(inqryDiv=4)의 opengCorpInfo 4번째 값. 최종 낙찰자 목록은 적격심사 전엔 비어 있다(2026-10-23 실측)
    try {
      const it = await b.one(SCS, 'getOpengResultListInfoCnstwk', { inqryDiv: '4', bidNtceNo: no, pageNo: '1', numOfRows: '5' }, no);
      if (it) {
        const o = parseOpengCorpInfo(it.opengCorpInfo);
        co = co ?? o.co; co_no = co_no ?? o.co_no; bp = o.bp; pc = Number(pc) > 0 ? pc : (Number(it.prtcptCnum) || null);
      }
    } catch (_) { /* 1순위 없음 → pending 유지 */ }
  }
  const aItem = await b.one(PUB, 'getBidPblancListInfoCnstwkBsisAmount', { inqryDiv: '2', bidNtceNo: no, pageNo: '1', numOfRows: '5' }, no);
  if (aItem === undefined) return null;
  const a = aItem ? sumAValue(aItem) : null;
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const s = computeSheet({ ba: num(c.ba), av: a ? a.av : null, xp: num(c.xp), fr: num(fr), bp: num(bp) });
  return {
    ...base, co: co ?? null, co_no: co_no ?? null, bp: num(bp), pc: pc ?? null,
    ba: num(c.ba), xp: num(c.xp), fr: num(fr), av: a ? a.av : null, a_applies: a ? a.aApplies : null, a_items: a ? a.items : null,
    ar1: s.ar1, br1: s.br1, floor_price: s.floor_price, missing: s.missing.length ? s.missing : null,
    status: s.missing.length ? (expired ? 'gave_up' : 'pending') : 'complete',
    computed_at: s.missing.length ? null : new Date().toISOString(),
  };
}

async function runCandidates(cands: Cand[], b: Budget, today: string, out: Record<string, any>) {
  const rows: Record<string, unknown>[] = [];
  for (const c of cands) {
    if (!b.can(PUB)) { out.stopped = 'budget'; break; }
    try {
      const row = await processOne(c, b, today);
      if (!row) { out.stopped = 'budget'; break; }
      rows.push(row); out.processed++; out[row.status as string] = (out[row.status as string] ?? 0) + 1;
    } catch (e) {
      out.errors.push(String(e).slice(0, 160));
      rows.push({ bid_ntce_no: c.bid_ntce_no, bid_ntce_ord: c.bid_ntce_ord ?? '000', od: c.od, status: 'pending', missing: ['api_error'],
        attempts: Number(c.attempts ?? 0) + 1, updated_at: new Date().toISOString() });
    }
  }
  if (!b.dry) await upsertRows(rows);
}

// ── 과거분(backfill) ── 단계: notice(공고 목록) → license(면허 목록) → compute(next_page 1=대조용, 2=표시용, 주 단위) → done
const BACKFILL_FROM = '2026-04-01';
const LIST_FROM = '2026-03-01'; // 공고 게시일 시작 — 개찰보다 최대 한 달 앞서 게시

async function rest(path: string, init: RequestInit = {}) {
  const { url, key } = supaEnv();
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`rest ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// 대상 공고번호(나라장터·경기·과거분 기간) — 메타는 이 공고만 저장해 DB를 키우지 않는다
async function targetNos(): Promise<Set<string>> {
  const set = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const rows = await rest(`bid_notices?select=bid_ntce_no&bid_ntce_no=like.R*&reg=ilike.*${encodeURIComponent('경기')}*&od=gte.${BACKFILL_FROM}&order=id.asc&limit=1000&offset=${off}`) as any[];
    rows.forEach((r) => set.add(r.bid_ntce_no));
    if (rows.length < 1000) return set;
  }
}

async function listPage(b: Budget, op: string, day: string, page: number) {
  if (!b.can(PUB)) return undefined;
  b.calls++; b.keys[PUB.key].left--;
  await incrementApiCall(PUB.key, 1).catch(() => 0);
  const d = day.replaceAll('-', '');
  const resp = await fetchG2B(buildUrl(PUB.service, op, b.keys[PUB.key].secret, { inqryDiv: '1', inqryBgnDt: `${d}0000`, inqryEndDt: `${d}2359`, pageNo: page, numOfRows: 999 }));
  if (!resp.ok) throw new Error(`${op} ${day} p${page} rc=${resp.resultCode ?? resp.status} ${resp.resultMsg ?? resp.error ?? ''}`.slice(0, 160));
  return { items: resp.items as any[], total: resp.totalCount };
}

async function backfill(b: Budget, today: string, out: Record<string, any>) {
  const st = (await rest('g2b_auto_backfill_state?id=eq.1&select=*') as any[])[0];
  let { phase, next_dt: dt, next_page: page } = st;
  const lastList = addDays(today, -1), lastOd = addDays(today, -8);
  const save = async () => { if (!b.dry) await rest('g2b_auto_backfill_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ phase, next_dt: dt, next_page: page, updated_at: new Date().toISOString() }) }); };
  try {
  if (phase === 'notice' || phase === 'license') {
    const nos = await targetNos(); out.targets = nos.size;
    const op = phase === 'notice' ? 'getBidPblancListInfoCnstwk' : 'getBidPblancListInfoLicenseLimit';
    while (phase === 'notice' || phase === 'license') {
      const r = await listPage(b, op, dt, page);
      if (!r) break;
      const meta = new Map<string, Record<string, unknown>>();
      for (const it of r.items) {
        if (!nos.has(it?.bidNtceNo)) continue;
        if (phase === 'notice') meta.set(it.bidNtceNo, { bid_ntce_no: it.bidNtceNo, main_cnstty: it.mainCnsttyNm || null, fr: it.sucsfbidLwltRate || null });
        else { const m = meta.get(it.bidNtceNo) ?? { bid_ntce_no: it.bidNtceNo, licenses: [] as string[] }; (m.licenses as string[]).push(it.lcnsLmtNm); meta.set(it.bidNtceNo, m); }
      }
      // 면허는 여러 페이지에 걸칠 수 있어 기존 값과 합친다
      if (phase === 'license' && meta.size && !b.dry) {
        const prev = await rest(`g2b_auto_notice_meta?select=bid_ntce_no,licenses&bid_ntce_no=in.(${[...meta.keys()].join(',')})`) as any[];
        for (const p of prev) if (Array.isArray(p.licenses)) { const m = meta.get(p.bid_ntce_no)!; m.licenses = [...new Set([...(p.licenses as string[]), ...(m.licenses as string[])])]; }
      }
      if (meta.size && !b.dry) await rest('g2b_auto_notice_meta?on_conflict=bid_ntce_no', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([...meta.values()]) });
      out.meta = (out.meta ?? 0) + meta.size;
      if (page * 999 < r.total) page++;
      else { page = 1; dt = addDays(dt, 1); }
      if (dt > lastList) {
        if (phase === 'notice') { phase = 'license'; dt = LIST_FROM; }
        else { phase = 'compute'; dt = BACKFILL_FROM; page = 1; }
        break; // 단계가 바뀌면 다음 실행에서 이어간다(대상 목록 재조회)
      }
    }
    // 면허 단계가 끝나면, 메타는 있는데 면허 행이 하나도 없던 공고는 '제한 없음'([])으로 정리
    if (phase === 'compute' && !b.dry) await rest(`g2b_auto_notice_meta?licenses=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ licenses: [] }) });
  }
  while (phase === 'compute' && b.can(PUB)) {
    if (dt > lastOd) {
      if (page === 1) { page = 2; dt = BACKFILL_FROM; continue; }
      phase = 'done'; break;
    }
    const to = addDays(dt, 6) > lastOd ? lastOd : addDays(dt, 6);
    const cands = await rpc<Cand[]>('g2b_auto_candidates', { p_mode: page === 1 ? 'compare' : 'fill', p_from: dt, p_to: to, p_limit: 500 });
    out.candidates = (out.candidates ?? 0) + cands.length;
    await runCandidates(cands, b, today, out);
    if (out.stopped === 'budget') break;
    dt = addDays(dt, 7);
  }
  } finally { // 예외가 나도 진행 위치는 남긴다
    await save();
    Object.assign(out, { phase, next_dt: dt, next_page: page });
  }
}

Deno.serve(async (req: Request) => {
  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { body = {}; }
  const mode = body.mode ?? 'daily';
  const b = new Budget(Math.max(Number(body.max_calls ?? 300), 0), Boolean(body.dry_run));
  const today = ymd(kstNow());
  const out: Record<string, any> = { ok: true, mode, dry_run: b.dry, processed: 0, errors: [] as string[] };
  try {
    await b.open(PUB); await b.open(SCS);
    if (b.max > 0 && mode === 'daily') {
      const cands = await rpc<Cand[]>('g2b_auto_candidates', { p_mode: 'daily', p_from: addDays(today, -7), p_to: today, p_limit: 500 });
      out.candidates = cands.length;
      await runCandidates(cands, b, today, out);
    }
    if (b.max > 0 && mode === 'backfill') await backfill(b, today, out);
  } catch (e) { out.ok = false; out.errors.push(String(e).slice(0, 200)); }
  out.calls = b.calls;
  return new Response(JSON.stringify(out), { status: out.ok ? 200 : 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
});
