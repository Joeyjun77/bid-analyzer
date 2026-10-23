// 사본: 배포된 fn-collect-results v4의 _shared/g2b.ts (2026-10-23 get_edge_function으로 받음)
export const G2B_BASE = 'https://apis.data.go.kr/1230000';
export const SERVICE_PATH: Record<string, string> = {
  BidPublicInfoService: 'ad/BidPublicInfoService',
  ScsbidInfoService: 'as/ScsbidInfoService',
};

export function buildUrl(
  service: string, operation: string, key: string,
  params: Record<string, string | number | undefined>,
): string {
  const path = SERVICE_PATH[service] ?? service;
  const qs = new URLSearchParams();
  qs.set('serviceKey', key);
  qs.set('type', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  return `${G2B_BASE}/${path}/${operation}?${qs.toString()}`;
}

export async function fetchG2B<T = any>(url: string) {
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const status = res.status;
  let body: any = null;
  try { body = await res.json(); }
  catch {
    const txt = await res.text().catch(() => '');
    return { ok: false, status, items: [] as T[], totalCount: 0,
      error: `non-json [${status}]: ${txt.slice(0, 500)}`,
      resultCode: undefined as string | undefined,
      resultMsg: undefined as string | undefined, raw: null };
  }
  const envelope = body?.response ?? body?.['nkoneps.com.response.ResponseError'] ?? {};
  const header = envelope?.header ?? {};
  const bodyObj = envelope?.body ?? {};
  let items: T[] = [];
  if (Array.isArray(bodyObj.items)) items = bodyObj.items as T[];
  else if (bodyObj.items && typeof bodyObj.items === 'object') {
    const it = (bodyObj.items as any).item;
    if (Array.isArray(it)) items = it as T[]; else if (it) items = [it as T];
  }
  const totalCount = Number(bodyObj.totalCount ?? 0);
  const resultCode = header.resultCode ?? '';
  return { ok: res.ok && resultCode === '00', status, resultCode, resultMsg: header.resultMsg,
    items, totalCount, raw: body, error: undefined as string | undefined };
}

export function yyyymmddhhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear().toString() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes());
}

export function kstNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}
