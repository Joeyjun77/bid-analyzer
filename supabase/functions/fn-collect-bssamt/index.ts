// fn-collect-bssamt v3 (2026-11-07) — 대상은 bssamt_targets RPC(m70), 건별 예외·요청 타임아웃(리뷰 반영)
// 개찰 전 공고의 기초금액·A값을 나라장터 기초금액 API로 받아 자동 예측(g2b_auto) 재계산 재료로 쓴다.
// dry_run이면 조회·로그만 하고 저장하지 않는다. 스펙: .scratch/auto-pred-bssamt/spec.md
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { buildUrl, fetchG2B } from '../fn-collect-g2b-sheet/_shared/g2b.ts';
import { getApiKey, incrementApiCall, logApiIngestion, rpc } from '../fn-collect-g2b-sheet/_shared/db.ts';
import { readBssamt } from './bssamt.js';

const SERVICE = 'BidPublicInfoService';
const KEY_NAME = 'prod_bid_public';
const OP = 'getBidPblancListInfoCnstwkBsisAmount';
const TIME_BUDGET_MS = 100_000; // 함수 실행 한도(150초) 전에 멈춘다
const MAX_LIMIT = 100;          // 실행당 상한 — 하루 2회, 키 한도 1,000 중 공고 수집 48건/일
const FETCH_TIMEOUT_MS = 15_000; // 한 요청이 멈춰도 시간 예산 확인이 돌게

// baSegOf(utils.js)와 같은 금액대 경계 — 추정 기초금액과 실제값의 금액대가 바뀌는 건수 측정용
const seg = (ba: number) => (ba < 1e8 ? 'S1' : ba < 3e8 ? 'S2' : ba < 1e9 ? 'S3' : ba < 3e9 ? 'S4' : 'S5');

// 대상·재확인 규칙은 DB 함수 bssamt_targets(m70)에 있다
const fetchTargets = (limit: number) =>
  rpc<Array<{ id: number; pn_no: string; bid_ntce_ord: string | null; od: string; ep: number | null }>>('bssamt_targets', { p_limit: limit });

Deno.serve(async (req: Request) => {
  const started = Date.now();
  let body: { dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { body = {}; }
  const dryRun = body.dry_run !== false; // 기본은 시험 모드 — 저장은 dry_run:false를 명시할 때만
  const limit = Math.min(Math.max(Number(body.limit ?? MAX_LIMIT), 1), MAX_LIMIT);

  let key: Awaited<ReturnType<typeof getApiKey>>;
  try { key = await getApiKey(KEY_NAME); } catch (e) { return json({ ok: false, stage: 'key', error: String(e) }, 500); }

  let targets;
  try { targets = await fetchTargets(limit); } catch (e) { return json({ ok: false, stage: 'targets', error: String(e) }, 500); }

  const stats = { targets: targets.length, called: 0, found: 0, not_yet: 0, errors: 0, a_applies: 0, a_not_applies: 0,
    ba_eq_est: 0, ba_diff_gt1pct: 0, seg_changed: 0, open_days_before_od: [] as number[], stopped_by: null as string | null };
  const results: Record<string, unknown>[] = [];

  for (const t of targets) {
    if (Date.now() - started > TIME_BUDGET_MS) { stats.stopped_by = 'time_budget'; break; }
    if (key.calls_today + stats.called >= key.daily_limit) { stats.stopped_by = 'daily_limit'; break; }
    const no = String(t.pn_no).split('-')[0];
    const url = buildUrl(SERVICE, OP, key.decrypted_secret, { inqryDiv: 2, bidNtceNo: no, pageNo: 1, numOfRows: 5 });
    const t0 = Date.now();
    let resp: Awaited<ReturnType<typeof fetchG2B>>;
    // 네트워크 오류·타임아웃 한 건이 실행 전체(앞서 받은 결과·소진한 호출)를 버리지 않게 건별로 잡는다
    try { resp = await fetchG2B(url, FETCH_TIMEOUT_MS); }
    catch (e) {
      resp = { ok: false, status: 0, items: [], totalCount: 0, error: String(e).slice(0, 200), resultCode: undefined, resultMsg: undefined, raw: null };
    }
    stats.called++;
    await incrementApiCall(KEY_NAME, 1).catch(() => 0);
    const ok = resp.ok;
    const r = ok ? readBssamt(resp.items as any[], t.bid_ntce_ord ?? '000') : null;
    if (!ok) stats.errors++; else if (r!.found) stats.found++; else stats.not_yet++;
    if (r?.found) {
      if (r.aApplies) stats.a_applies++; else stats.a_not_applies++;
      const est = t.ep ? Math.round(Number(t.ep) * 1.1) : null;
      if (est != null) {
        if (Math.abs(r.ba! - est) <= 2) stats.ba_eq_est++;
        if (Math.abs(r.ba! / est - 1) > 0.01) stats.ba_diff_gt1pct++;
        if (seg(r.ba!) !== seg(est)) stats.seg_changed++;
      }
      if (r.openDt) stats.open_days_before_od.push(Math.round((Date.parse(t.od) - Date.parse(r.openDt.replace(' ', 'T') + '+09:00')) / 864e5 * 10) / 10);
      results.push({ notice_id: t.id, ba: r.ba, av: r.av, ba_open_dt: r.openDt });
    } else if (ok) {
      results.push({ notice_id: t.id, ba: null }); // 미공개도 확인 시각을 남긴다(저장 모드)
    }
    await logApiIngestion({
      operation: OP, service: SERVICE, params: { bidNtceNo: no, dry_run: dryRun },
      page_no: 1, rows_requested: 5, rows_received: resp.items.length, total_count: resp.totalCount ?? null,
      rows_saved: dryRun ? 0 : (r?.found ? 1 : 0), status: ok ? 'ok' : 'error',
      result_code: resp.resultCode ?? null, result_msg: resp.resultMsg ?? null,
      error_detail: ok ? null : `${resp.status} ${resp.error ?? ''}`.slice(0, 300), duration_ms: Date.now() - t0,
    }).catch(() => {});
  }

  let applied: unknown = null;
  if (!dryRun && results.length) {
    try { applied = await rpc('apply_bssamt_batch', { p: results }); }
    catch (e) { return json({ ok: false, stage: 'apply', error: String(e).slice(0, 300), stats }, 500); }
  }

  const days = stats.open_days_before_od.sort((a, b) => a - b);
  return json({
    ok: stats.errors === 0, dry_run: dryRun, stats: { ...stats, open_days_before_od: undefined,
      open_days_min: days[0] ?? null, open_days_median: days.length ? days[Math.floor(days.length / 2)] : null },
    applied, sample: results.slice(0, 3), duration_ms: Date.now() - started,
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
