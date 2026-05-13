-- V6-A Migration 10: bid_records 62,365건 → bid_history 백필
-- spec §6

INSERT INTO bid_history (
  bid_no, legacy_record_id, source,
  ag, canonical_ag,
  industry, work_cat, contract_method,
  opened_at, notice_title,
  base_amount, a_value, expected_price, floor_amount, floor_rate,
  rank1_company, rank1_biz_no, rank1_amount, rank1_ratio,
  competitor_count, is_excluded, excl_reason
)
SELECT
  COALESCE(pn_no, 'legacy_' || id::TEXT)        AS bid_no,
  id                                            AS legacy_record_id,
  'legacy_bid_records'                          AS source,
  ag,
  COALESCE(canonical_ag, normalize_agency_name(ag)) AS canonical_ag,
  cat AS industry, work_cat, contract_method,
  od AS opened_at, pn AS notice_title,
  ba, av, ep, floor_price, fr,
  co, co_no, bp, br1,
  pc, COALESCE(is_excluded, FALSE), excl_reason
FROM bid_records
ON CONFLICT (bid_no, source) DO NOTHING;
