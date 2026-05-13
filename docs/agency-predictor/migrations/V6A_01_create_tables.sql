-- V6-A Migration 01: 5개 신규 테이블 (외부+자사 통합 이력, 발주처 캐시, 예측 결과, 업로드, 임시)
-- spec: docs/superpowers/specs/2026-05-13-agency-predictor-v6a-db-infra-design.md §3

CREATE TABLE bid_history (
  id              BIGSERIAL PRIMARY KEY,
  bid_no          TEXT NOT NULL,
  legacy_record_id BIGINT,
  source          TEXT NOT NULL DEFAULT 'legacy_bid_records'
                    CHECK (source IN ('legacy_bid_records','infona','external_award','file_upload')),
  ag              TEXT,
  canonical_ag    TEXT,
  industry        TEXT,
  work_cat        TEXT,
  region          TEXT,
  contract_method TEXT,
  opened_at       DATE,
  notice_title    TEXT,
  base_amount     NUMERIC,
  a_value         NUMERIC,
  expected_price  NUMERIC,
  floor_amount    NUMERIC,
  floor_rate      NUMERIC,
  price_ratio     NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND expected_price IS NOT NULL
                         THEN (expected_price / base_amount * 100)
                    END
                  ) STORED,
  price_ratio_dev NUMERIC,
  rank1_company   TEXT,
  rank1_biz_no    TEXT,
  rank1_amount    NUMERIC,
  rank1_ratio     NUMERIC,
  competitor_count INTEGER,
  win_window_pct  NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND rank1_amount IS NOT NULL AND floor_amount IS NOT NULL
                         THEN ((rank1_amount - floor_amount) / base_amount * 100)
                    END
                  ) STORED,
  self_bid_amount       NUMERIC,
  self_rank             INTEGER,
  self_was_disqualified BOOLEAN,
  is_excluded     BOOLEAN DEFAULT FALSE,
  excl_reason     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  imported_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (bid_no, source)
);
COMMENT ON TABLE bid_history IS
  'V6-A: 외부+자사 통합 입찰 이력. price_ratio = ep/ba×100. 자사 컬럼은 V6-D에서 채움.';

CREATE TABLE agency_profile (
  id                  BIGSERIAL PRIMARY KEY,
  canonical_ag        TEXT NOT NULL,
  industry            TEXT,
  amount_tier         TEXT,
  display_name        TEXT,
  sample_size         INTEGER NOT NULL DEFAULT 0,
  mean_ratio          NUMERIC,
  median_ratio        NUMERIC,
  std_dev             NUMERIC,
  p25                 NUMERIC,
  p75                 NUMERIC,
  min_ratio           NUMERIC,
  max_ratio           NUMERIC,
  recommended_margin  NUMERIC,
  confidence_tier     TEXT,
  avg_competitor      INTEGER,
  avg_win_window      NUMERIC,
  top_winner_company  TEXT,
  top_winner_share    NUMERIC,
  self_total_bids     INTEGER DEFAULT 0,
  self_wins           INTEGER DEFAULT 0,
  self_disq_rate      NUMERIC,
  last_bid_date       DATE,
  last_recalc_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (canonical_ag, industry, amount_tier)
);
COMMENT ON TABLE agency_profile IS
  'V6-A: (canonical_ag, industry, amount_tier) 통계 캐시. NULL = 전체 합계 의미.';

CREATE TABLE bid_predictions_v3 (
  id                       BIGSERIAL PRIMARY KEY,
  bid_no                   TEXT NOT NULL,
  canonical_ag             TEXT,
  industry                 TEXT,
  amount_tier              TEXT,
  base_amount              NUMERIC,
  a_value                  NUMERIC,
  floor_rate               NUMERIC,
  predicted_ratio          NUMERIC NOT NULL,
  predicted_floor_amount   NUMERIC,
  aggressive_margin        NUMERIC,
  balanced_margin          NUMERIC,
  safe_margin              NUMERIC,
  strategy_aggressive_bid  NUMERIC,
  strategy_balanced_bid    NUMERIC,
  strategy_safe_bid        NUMERIC,
  disq_risk_aggressive     NUMERIC,
  disq_risk_balanced       NUMERIC,
  disq_risk_safe           NUMERIC,
  confidence_tier          TEXT,
  signal_stage             INTEGER,
  sample_size_used         INTEGER,
  model_version            TEXT NOT NULL DEFAULT 'v3.0',
  match_status             TEXT NOT NULL DEFAULT 'pending'
                             CHECK (match_status IN ('pending','matched','no_match','expired')),
  matched_history_id       BIGINT REFERENCES bid_history(id),
  actual_ratio             NUMERIC,
  ratio_error              NUMERIC,
  result                   TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  expires_at               TIMESTAMPTZ,
  matched_at               TIMESTAMPTZ
);
COMMENT ON TABLE bid_predictions_v3 IS
  'V6-A: 발주처사정율 예측 결과. predicted_*, strategy_*, disq_risk_*, confidence_tier, signal_stage, sample_size_used, model_version은 트리거가 UPDATE 차단.';

CREATE TABLE upload_batches (
  id              BIGSERIAL PRIMARY KEY,
  batch_type      TEXT NOT NULL CHECK (batch_type IN ('notice','infona','award_list')),
  file_name       TEXT,
  file_size_bytes BIGINT,
  total_rows      INTEGER,
  inserted_rows   INTEGER DEFAULT 0,
  skipped_rows    INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  error_log       JSONB,
  uploaded_by     UUID REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE bid_notices_temp (
  id              BIGSERIAL PRIMARY KEY,
  batch_id        BIGINT REFERENCES upload_batches(id) ON DELETE CASCADE,
  bid_no          TEXT NOT NULL,
  ag              TEXT,
  canonical_ag    TEXT,
  industry        TEXT,
  base_amount     NUMERIC,
  a_value         NUMERIC,
  floor_rate      NUMERIC,
  opened_at       DATE,
  notice_title    TEXT,
  contract_method TEXT,
  predicted       BOOLEAN DEFAULT FALSE,
  prediction_id   BIGINT REFERENCES bid_predictions_v3(id),
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
