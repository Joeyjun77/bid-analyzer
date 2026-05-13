-- V6-A Migration 02: 핫 경로 인덱스
-- spec §9

CREATE INDEX bh_canonical_industry_amount
  ON bid_history (canonical_ag, industry, base_amount DESC)
  WHERE expected_price IS NOT NULL;
CREATE INDEX bh_opened_desc ON bid_history (opened_at DESC NULLS LAST);
CREATE INDEX bh_rank1_company ON bid_history (rank1_company text_pattern_ops);
CREATE INDEX bh_legacy_id ON bid_history (legacy_record_id) WHERE legacy_record_id IS NOT NULL;
CREATE INDEX bh_canonical_only ON bid_history (canonical_ag);

CREATE INDEX ap_canonical ON agency_profile (canonical_ag);
CREATE INDEX ap_confidence ON agency_profile (confidence_tier);

CREATE INDEX bpv3_match_status ON bid_predictions_v3 (match_status, created_at DESC);
CREATE INDEX bpv3_bid_no ON bid_predictions_v3 (bid_no);
CREATE INDEX bpv3_canonical ON bid_predictions_v3 (canonical_ag);

CREATE INDEX bnt_batch_pending ON bid_notices_temp (batch_id) WHERE predicted = FALSE;
