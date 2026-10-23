// 사본: 배포된 fn-collect-results v4의 _shared/db.ts (2026-10-23). upsertBidRecord는 이 함수에서 쓰지 않는다(bid_records 불변).
export function supaEnv() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) throw new Error('SUPABASE env missing');
  return { url, key };
}
export async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { url, key } = supaEnv();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=representation' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
export async function getApiKey(keyName: string) {
  const rows = await rpc<any[]>('get_api_key', { p_key_name: keyName });
  if (!rows?.length) throw new Error(`key not found: ${keyName}`);
  const row = rows[0];
  if (!row.enabled) throw new Error(`key disabled: ${keyName}`);
  if (!row.decrypted_secret) throw new Error(`vault secret missing ${keyName}`);
  return row;
}
export async function incrementApiCall(keyName: string, n = 1) { return await rpc<number>('increment_api_call', { p_key_name: keyName, p_n: n }); }
export async function upsertBidRecord(p: Record<string, unknown>) { return await rpc<Array<{ id: number; action: string }>>('upsert_bid_record', { p }); }
export async function logApiIngestion(params: any) {
  return await rpc<number>('log_api_ingestion', {
    p_operation: params.operation, p_service: params.service, p_params: params.params,
    p_page_no: params.page_no, p_rows_requested: params.rows_requested,
    p_rows_received: params.rows_received, p_total_count: params.total_count,
    p_rows_saved: params.rows_saved, p_status: params.status,
    p_result_code: params.result_code ?? null, p_result_msg: params.result_msg ?? null,
    p_error_detail: params.error_detail ?? null, p_duration_ms: params.duration_ms,
  });
}
