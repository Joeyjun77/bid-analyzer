// fn-collect-ranks v2 (2026-11-08) — 개찰 전체 순위 수집 (goyang-focus P3)
// v2: 페이지 로그를 저장 뒤에 남겨 마지막 페이지 rows_saved에 실제 저장 건수 기록(v_collect_health ranks 줄)
// 대상은 rank_targets RPC(m76): 고양 include × 대상 업종 × 개찰 완료 × 미수집. 저장은 save_bid_ranks(m76) → api_bid_ranks.
// dry_run이 기본 — 조회·로그만, 저장은 dry_run:false를 명시할 때만. nos를 주면 대상 RPC 대신 그 공고만 본다(dry_run 전용).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { buildUrl, fetchG2B } from '../fn-collect-g2b-sheet/_shared/g2b.ts';
import { getApiKey, incrementApiCall, logApiIngestion, rpc } from '../fn-collect-g2b-sheet/_shared/db.ts';

const SERVICE = 'ScsbidInfoService';
const KEY_NAME = 'prod_scsbid_info';
const OP = 'getOpengResultListInfoOpengCompt';
const PAGE = 999;
const MAX_PAGES = 10;            // 공고당 상한(최대 9,990명)
const MAX_LIMIT = 30;
const TIME_BUDGET_MS = 100_000;  // 함수 한도(150초) 전에 멈춘다
const FETCH_TIMEOUT_MS = 40_000;

Deno.serve(async (req: Request) => {
  const started = Date.now();
  let body: { dry_run?: boolean; limit?: number; since?: string; nos?: string[] } = {};
  try { body = await req.json(); } catch { body = {}; }
  const dryRun = body.dry_run !== false;
  const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), MAX_LIMIT);
  if (!dryRun && body.nos?.length) return json({ ok: false, error: 'nos is dry_run only' }, 400);

  let key: Awaited<ReturnType<typeof getApiKey>>;
  try { key = await getApiKey(KEY_NAME); } catch (e) { return json({ ok: false, stage: 'key', error: String(e) }, 500); }

  let targets: string[];
  try {
    targets = body.nos?.length
      ? body.nos.slice(0, limit)
      : (await rpc<Array<{ bid_ntce_no: string }>>('rank_targets', { p_since: body.since ?? '2026-04-01', p_limit: limit })).map((t) => t.bid_ntce_no);
  } catch (e) { return json({ ok: false, stage: 'targets', error: String(e) }, 500); }

  const stats = { dry_run: dryRun, targets: targets.length, calls: 0, done: 0, not_opened: 0, incomplete: 0, errors: 0,
    rows_received: 0, rows_saved: 0, json_bytes: 0, stopped_by: null as string | null };
  const per: Record<string, unknown>[] = [];

  for (const no of targets) {
    if (Date.now() - started > TIME_BUDGET_MS) { stats.stopped_by = 'time_budget'; break; }
    const items: unknown[] = [];
    const logs: Record<string, unknown>[] = [];
    let total = 0, pages = 0, err: string | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (key.calls_today + stats.calls >= key.daily_limit) { err = 'daily_limit'; stats.stopped_by = 'daily_limit'; break; }
      const params = { bidNtceNo: no, pageNo: page, numOfRows: PAGE };
      const t0 = Date.now();
      let resp: Awaited<ReturnType<typeof fetchG2B>>;
      try { resp = await fetchG2B(buildUrl(SERVICE, OP, key.decrypted_secret, params), FETCH_TIMEOUT_MS); }
      catch (e) { resp = { ok: false, status: 0, items: [], totalCount: 0, error: String(e).slice(0, 200), resultCode: undefined, resultMsg: undefined, raw: null }; }
      stats.calls++;
      await incrementApiCall(KEY_NAME, 1).catch(() => 0);
      logs.push({ operation: OP, service: SERVICE, params, page_no: page, rows_requested: PAGE,
        rows_received: resp.items.length, total_count: resp.totalCount ?? null, rows_saved: 0,
        status: resp.ok ? 'ok' : 'error', result_code: resp.resultCode ?? null, result_msg: resp.resultMsg ?? null,
        error_detail: resp.ok ? null : (resp.error ?? null), duration_ms: Date.now() - t0 });
      if (!resp.ok) { err = `p${page} [${resp.status}] ${resp.resultCode ?? ''} ${resp.error ?? resp.resultMsg ?? ''}`.slice(0, 200); break; }
      pages++;
      total = resp.totalCount || total;
      items.push(...resp.items);
      if (resp.items.length < PAGE || items.length >= total) break;
    }
    stats.rows_received += items.length;
    let state: string, saved = 0;
    if (err) { state = 'error'; stats.errors++; }
    else if (total === 0) { state = 'not_opened'; stats.not_opened++; }        // 미개찰·유찰 — 다음 실행에서 다시 본다
    else if (items.length < total) { state = 'incomplete'; stats.incomplete++; } // 표시 안 함 → 다시 수집
    else {
      state = 'done'; stats.done++;
      const payload = JSON.stringify(items);
      stats.json_bytes += payload.length;
      if (!dryRun) {
        try { saved = (await rpc<Array<{ saved: number }>>('save_bid_ranks', { p_bid_ntce_no: no, p_total: total, p_items: items }))?.[0]?.saved ?? 0; }
        catch (e) { state = 'save_error'; err = String(e).slice(0, 200); stats.errors++; }
        stats.rows_saved += saved;
      }
    }
    if (logs.length) logs[logs.length - 1].rows_saved = saved;
    for (const l of logs) await logApiIngestion(l).catch(() => {});
    per.push({ no, state, total, received: items.length, pages, saved, err });
    if (stats.stopped_by === 'daily_limit') break;
  }

  return json({ ok: stats.errors === 0, stats, per, duration_ms: Date.now() - started });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
