-- V6-A Migration 04: 보조 함수
-- spec §4.0

CREATE OR REPLACE FUNCTION amount_tier_of(p_amount NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_amount IS NULL              THEN NULL
    WHEN p_amount <  100000000         THEN '~1억'
    WHEN p_amount <  300000000         THEN '1억~3억'
    WHEN p_amount <  500000000         THEN '3억~5억'
    WHEN p_amount < 1000000000         THEN '5억~10억'
    WHEN p_amount < 3000000000         THEN '10억~30억'
    ELSE                                    '30억~'
  END;
$$;
