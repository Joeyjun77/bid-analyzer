-- m4: INSERT/UPDATE 정책 명시 (B0a — 코덱스 라운드 1 결함 #2 정정)
-- 근거: 코덱스 검증 — anon/authenticated SELECT만으로는 INSERT 경로 비가시
-- service_role은 RLS bypass되지만, 정책에 명시해 운용 주체 문서화
-- 적용: apply_migration (Supabase MCP), 2026-05-19

-- agency_mode_lookup INSERT 정책 (일배치 갱신용)
CREATE POLICY agency_mode_lookup_service_insert
  ON agency_mode_lookup FOR INSERT TO service_role
  WITH CHECK (true);

-- agency_mode_lookup UPDATE 정책 (정적 캐시 갱신용)
CREATE POLICY agency_mode_lookup_service_update
  ON agency_mode_lookup FOR UPDATE TO service_role
  USING (true) WITH CHECK (true);

-- floor_pass_daily INSERT 정책 (UPDATE 정책 의도적 미생성 — A안 INSERT-only)
CREATE POLICY floor_pass_daily_service_insert
  ON floor_pass_daily FOR INSERT TO service_role
  WITH CHECK (true);

-- COMMENT 갱신 — 운용 주체 명시
COMMENT ON TABLE agency_mode_lookup IS
  'V2 영역별 모드 판정 (정적 캐시, 일배치 갱신). 운용 주체: service_role (cron/edge function). Mode A/B 선택 + gap median/p90 분포. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §3, V2_DDL_SPEC §1, V2_MEASUREMENT_SPEC §7. confidence: high(n>=50)/medium(20<=n<50)/low(n<20). fallback: (at, NULL, NULL) row, UNIQUE NULLS NOT DISTINCT 강제.';

COMMENT ON TABLE floor_pass_daily IS
  'V2 Mode B 1차 KPI — bid_rate 공간 하한 통과율 + calibration_gap. 일배치 INSERT-only (UPDATE 금지). 운용 주체: service_role. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §6 Step2, V2_DDL_SPEC §3, V2_MEASUREMENT_SPEC §7. calibration_gap = abs(pred_floor_pass_prob_avg - actual_floor_pass_rate).';
