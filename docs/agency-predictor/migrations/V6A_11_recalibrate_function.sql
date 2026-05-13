-- V6-A Migration 11: recalibrate_agency_profiles 함수
-- spec §7

CREATE OR REPLACE FUNCTION recalibrate_agency_profiles()
RETURNS TABLE (rows_inserted INTEGER, agencies_distinct INTEGER, elapsed_ms INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_start    TIMESTAMPTZ := clock_timestamp();
  v_inserted INTEGER;
  v_agencies INTEGER;
BEGIN
  TRUNCATE agency_profile;

  WITH base AS (
    SELECT canonical_ag, industry,
           amount_tier_of(base_amount) AS amount_tier,
           price_ratio, competitor_count, win_window_pct, rank1_company,
           opened_at
    FROM bid_history
    WHERE expected_price IS NOT NULL
      AND is_excluded = FALSE
      AND canonical_ag IS NOT NULL
  ),
  grouped AS (
    SELECT canonical_ag, industry,                amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, industry,                NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
  ),
  agg AS (
    SELECT canonical_ag, industry, amount_tier,
           COUNT(*)                                                       AS sample_size,
           AVG(price_ratio)                                               AS mean_ratio,
           PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY price_ratio)      AS median_ratio,
           STDDEV_SAMP(price_ratio)                                       AS std_dev,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_ratio)      AS p25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_ratio)      AS p75,
           MIN(price_ratio)                                               AS min_ratio,
           MAX(price_ratio)                                               AS max_ratio,
           AVG(competitor_count)::INTEGER                                 AS avg_competitor,
           AVG(win_window_pct)                                            AS avg_win_window
    FROM grouped
    GROUP BY canonical_ag, industry, amount_tier
  ),
  top_winners AS (
    SELECT canonical_ag, industry, amount_tier, rank1_company,
           COUNT(*) AS wins,
           ROW_NUMBER() OVER (
             PARTITION BY canonical_ag, industry, amount_tier
             ORDER BY COUNT(*) DESC
           ) AS rk,
           SUM(COUNT(*)) OVER (PARTITION BY canonical_ag, industry, amount_tier) AS total
    FROM grouped
    WHERE rank1_company IS NOT NULL
    GROUP BY canonical_ag, industry, amount_tier, rank1_company
  ),
  last_dates AS (
    SELECT canonical_ag, MAX(opened_at) AS last_bid_date FROM base GROUP BY canonical_ag
  )
  INSERT INTO agency_profile (
    canonical_ag, industry, amount_tier, display_name,
    sample_size, mean_ratio, median_ratio, std_dev, p25, p75, min_ratio, max_ratio,
    recommended_margin, confidence_tier,
    avg_competitor, avg_win_window, top_winner_company, top_winner_share,
    last_bid_date, last_recalc_at
  )
  SELECT
    a.canonical_ag, a.industry, a.amount_tier, a.canonical_ag,
    a.sample_size, a.mean_ratio, a.median_ratio, a.std_dev, a.p25, a.p75, a.min_ratio, a.max_ratio,
    calculate_recommended_margin(a.std_dev, a.sample_size),
    classify_confidence_tier(a.sample_size, a.std_dev),
    a.avg_competitor, a.avg_win_window,
    tw.rank1_company,
    CASE WHEN tw.total > 0 THEN tw.wins::NUMERIC / tw.total END,
    ld.last_bid_date, now()
  FROM agg a
  LEFT JOIN top_winners tw
    ON tw.canonical_ag = a.canonical_ag
   AND tw.industry IS NOT DISTINCT FROM a.industry
   AND tw.amount_tier IS NOT DISTINCT FROM a.amount_tier
   AND tw.rk = 1
  LEFT JOIN last_dates ld ON ld.canonical_ag = a.canonical_ag;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT COUNT(DISTINCT canonical_ag) INTO v_agencies FROM agency_profile;

  RETURN QUERY SELECT v_inserted, v_agencies,
    EXTRACT(MILLISECOND FROM (clock_timestamp() - v_start))::INTEGER;
END;
$$;
