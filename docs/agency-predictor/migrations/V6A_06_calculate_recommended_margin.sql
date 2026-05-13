-- V6-A Migration 06: std 기반 권장 마진
-- spec §4.2 (근거: ZERO_MARGIN_SIMULATION §8.2)

CREATE OR REPLACE FUNCTION calculate_recommended_margin(p_std NUMERIC, p_n INTEGER)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5            THEN 0.30
    WHEN p_std IS NULL                     THEN 0.30
    WHEN p_std < 0.3                       THEN 0.10
    WHEN p_std < 0.6                       THEN 0.20
    WHEN p_std < 1.0                       THEN 0.30
    ELSE                                        0.40
  END;
$$;
