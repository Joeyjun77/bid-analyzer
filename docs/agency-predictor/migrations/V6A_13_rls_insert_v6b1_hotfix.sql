-- V6-A Migration 13 (V6-B1 hotfix): authenticated INSERT 정책 추가
-- spec: V6-A spec §8 보강 — 원래는 "INSERT/UPDATE/DELETE는 service_role 만 가능"으로 설계했으나
--       V6-B1 클라이언트(authenticated)가 직접 bid_history/bid_predictions_v3에 INSERT해야 하므로
--       RLS INSERT 정책을 추가한다. 보안: bid_history는 source='file_upload' 만 허용
--       (legacy_bid_records/external_award 등은 여전히 service_role 전용),
--       bid_predictions_v3는 모두 허용하되 bpv3_lifecycle 트리거가 불변성/expires_at 자동 처리.
-- 운영 배경: 2026-05-14 사용자 첫 일괄 예측 시 403 5건 발생 (bid_history 2건 + bpv3 3건).
-- 적용: 2026-05-14, Supabase MCP apply_migration 'v6b1_rls_insert_policies'

CREATE POLICY "authenticated_insert_upload" ON bid_history
  FOR INSERT TO authenticated
  WITH CHECK (source = 'file_upload');

CREATE POLICY "authenticated_insert" ON bid_predictions_v3
  FOR INSERT TO authenticated
  WITH CHECK (true);
