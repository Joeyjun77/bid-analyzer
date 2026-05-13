-- V6-A Migration 05: 신뢰도 등급 분류
-- spec §4.1

CREATE OR REPLACE FUNCTION classify_confidence_tier(p_n INTEGER, p_std NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5 THEN 'insufficient'
    WHEN p_n >= 30 AND p_std IS NOT NULL AND p_std < 0.5 THEN 'high'
    WHEN p_n >= 10 AND p_std IS NOT NULL AND p_std < 1.0 THEN 'medium'
    ELSE 'low'
  END;
$$;
