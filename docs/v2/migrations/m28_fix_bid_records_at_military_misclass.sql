-- m28: bid_records.at 정합 회복 — 군 발주사의 '지자체' 오분류 정정
-- 결함:
--   - bid_records.at='지자체'인데 canonical_ag가 명백한 군 발주사 패턴
--     ('사령부' 또는 '제XXXX부대' 형식) 인 row가 current era 145건 / 27개 발주사
--   - JIJACHE_MODE_A_REVIEW_2026-05-21.md §2.3에서 outlier 추적 중 발견
--   - 이로 인해 win_zone_daily / floor_pass_daily / agency_gap_distribution
--     지자체 측정값에 군 데이터 혼입
-- 정정 (사용자 옵션 A 채택 + predict-architect 권고):
--   - canonical_ag ILIKE '%사령부%' OR canonical_ag ~ '^제\s?[0-9]+부대' OR ~ '^[0-9]+부대'
--   - 단 거짓 양성 차단: canonical_ag NOT ILIKE '%대학교%' (중부대학교 1건 제외)
--   - 시간 윈도우: era_v2='current' 한정 (legacy 보존, 단계적 롤아웃)
--   - 영향 row: 145건, 27개 발주사 (사전 SELECT 검증 완료)
-- 영향 분류 (predict-architect):
--   - Evaluator (예측 산출 함수 무수정)
--   - 핵심 영역 MAE 영향: PASS (bid_predictions.at 무변경, baseline 직접 영향 0)
--   - /evaluate 면제 가능 (조건부: 정정 직후 refresh_win_zone_daily 재실행 + 카운트 스냅샷)
-- 후속 검토:
--   - 육군교육사령부 7건(at='교육청')은 m28 범위 제외 (군시설/교육청 도메인 판단 필요)
--   - legacy era 3,857건은 별도 m29 후속 검토 (1주 모니터링 후)
-- 적용: apply_migration, 2026-05-21

-- 적용 전 카운트 스냅샷 (참고용)
-- SELECT COUNT(*) FROM bid_records WHERE at='지자체' AND era_v2='current'
--   AND (canonical_ag ILIKE '%사령부%' OR canonical_ag ~ '^제\s?[0-9]+부대' OR canonical_ag ~ '^[0-9]+부대')
--   AND canonical_ag NOT ILIKE '%대학교%';
-- 예상: 145

UPDATE bid_records
SET at = '군시설'
WHERE at = '지자체'
  AND COALESCE(era_v2, 'current') = 'current'
  AND (
    canonical_ag ILIKE '%사령부%'
    OR canonical_ag ~ '^제\s?[0-9]+부대'
    OR canonical_ag ~ '^[0-9]+부대'
  )
  AND canonical_ag NOT ILIKE '%대학교%';

-- 적용 후 검증: 동일 조건 row가 0건이어야 함
SELECT
  '잔여 정정 후보' AS check_label,
  COUNT(*) AS remaining_n
FROM bid_records
WHERE at = '지자체'
  AND COALESCE(era_v2, 'current') = 'current'
  AND (
    canonical_ag ILIKE '%사령부%'
    OR canonical_ag ~ '^제\s?[0-9]+부대'
    OR canonical_ag ~ '^[0-9]+부대'
  )
  AND canonical_ag NOT ILIKE '%대학교%';

-- 후속: win_zone_daily 재측정으로 정합 회복 확인
SELECT refresh_win_zone_daily() AS rows_updated;
