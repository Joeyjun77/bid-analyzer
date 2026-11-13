// fn-collect-notices v5 (2026-11-13)
// v4 배포본을 저장소로 가져옴. v5: 수집 끝의 auto_predict_from_notices() 호출 제거 —
//   같은 일을 cron 4(auto-predict-every-30min, :03/:33)가 3분 뒤 제한 없이 하고, 이 호출은 8초 제한에 자주 걸려
//   rpc 500(statement timeout)을 남겼다(11/10 24시간 13건). 공고 저장 동작은 그대로.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { buildUrl, fetchG2B, kstNow, yyyymmddhhmm } from './_shared/g2b.ts';
import { getApiKey, incrementApiCall, upsertBidNotice, logApiIngestion } from './_shared/db.ts';

const SERVICE = 'BidPublicInfoService';
const KEY_NAME = 'prod_bid_public';

function pickOperation(op?: string): string {
  const v = (op ?? '공사').toString();
  if (v === '용역' || v === 'servc') return 'getBidPblancListInfoServc';
  if (v === '물품' || v === 'thng') return 'getBidPblancListInfoThng';
  if (v === '외자' || v === 'frgcpt') return 'getBidPblancListInfoFrgcpt';
  return 'getBidPblancListInfoCnstwk';
}

interface Body {
  hours?: number; minutes?: number; dry_run?: boolean;
  operation?: string;
  max_pages?: number; page_size?: number;
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method !== 'POST' && req.method !== 'GET')
    return json({ ok: false, error: 'method not allowed' }, 405);

  let body: Body = {};
  if (req.method === 'POST') {
    try { body = (await req.json()) as Body; } catch { body = {}; }
  }

  const hours = Number(body.hours ?? 0);
  const minutes = Number(body.minutes ?? (hours > 0 ? 0 : 30));
  const windowMin = hours > 0 ? hours * 60 : minutes;
  const dryRun = Boolean(body.dry_run);
  const operation = pickOperation(body.operation);
  const pageSize = Math.min(Math.max(Number(body.page_size ?? 100), 1), 100);
  const maxPages = Math.min(Math.max(Number(body.max_pages ?? 5), 1), 20);

  const now = kstNow();
  const from = new Date(now.getTime() - windowMin * 60 * 1000);
  const inqryBgnDt = yyyymmddhhmm(from);
  const inqryEndDt = yyyymmddhhmm(now);

  let key: Awaited<ReturnType<typeof getApiKey>>;
  try { key = await getApiKey(KEY_NAME); }
  catch (e) { return json({ ok: false, stage: 'key', error: String(e) }, 500); }

  if (!dryRun && key.calls_today >= key.daily_limit) {
    return json({ ok: false, stage: 'rate_limit', error: `daily limit reached ${key.calls_today}/${key.daily_limit}` }, 429);
  }

  const stats = { pages: 0, rows_received: 0, rows_saved: 0, targets: 0, inserts: 0, updates: 0, errors: [] as string[] };
  let totalCount = 0;
  let firstUrl = '';

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = buildUrl(SERVICE, operation, key.decrypted_secret, {
        inqryDiv: 1, inqryBgnDt, inqryEndDt, pageNo: page, numOfRows: pageSize,
      });
      if (page === 1) firstUrl = url.replace(key.decrypted_secret, '***REDACTED***');

      const t0 = Date.now();
      const resp = await fetchG2B(url);
      const dur = Date.now() - t0;

      if (!dryRun) await incrementApiCall(KEY_NAME, 1).catch(() => 0);

      if (!resp.ok) {
        const errStr = `page ${page} [${resp.status}] rc=${resp.resultCode ?? ''} msg=${resp.resultMsg ?? ''} ${resp.error ?? ''}`;
        stats.errors.push(errStr);
        await logApiIngestion({
          operation, service: SERVICE,
          params: { inqryBgnDt, inqryEndDt, pageNo: page, numOfRows: pageSize },
          page_no: page, rows_requested: pageSize, rows_received: resp.items.length,
          total_count: resp.totalCount ?? null, rows_saved: 0, status: 'error',
          result_code: resp.resultCode ?? null, result_msg: resp.resultMsg ?? null,
          error_detail: errStr, duration_ms: dur,
        }).catch(() => {});
        break;
      }

      totalCount = resp.totalCount || totalCount;
      stats.pages++;
      stats.rows_received += resp.items.length;

      if (!dryRun) {
        let saved = 0;
        for (const it of resp.items) {
          try {
            const res = await upsertBidNotice(it as Record<string, unknown>);
            if (Array.isArray(res) && res[0]) {
              saved++;
              if (res[0].is_target) stats.targets++;
              if (res[0].action === 'insert') stats.inserts++; else stats.updates++;
            }
          } catch (e) { stats.errors.push(`upsert: ${(e as Error).message}`); }
        }
        stats.rows_saved += saved;

        await logApiIngestion({
          operation, service: SERVICE,
          params: { inqryBgnDt, inqryEndDt, pageNo: page, numOfRows: pageSize },
          page_no: page, rows_requested: pageSize, rows_received: resp.items.length,
          total_count: resp.totalCount ?? null, rows_saved: saved,
          status: stats.errors.length ? 'partial' : 'ok',
          result_code: resp.resultCode ?? null, result_msg: resp.resultMsg ?? null,
          error_detail: null, duration_ms: dur,
        }).catch(() => {});
      }

      if (resp.items.length < pageSize) break;
      if (page * pageSize >= totalCount && totalCount > 0) break;
    }
  } catch (e) { stats.errors.push(String(e)); }

  return json({
    ok: stats.errors.length === 0,
    dry_run: dryRun, operation,
    window: { from: inqryBgnDt, to: inqryEndDt, minutes: windowMin },
    first_url_redacted: firstUrl,
    total_count: totalCount, stats,
    duration_ms: Date.now() - started,
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
