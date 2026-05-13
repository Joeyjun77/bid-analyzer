-- V6-A Migration 07: 부적격 위험 (정규분포 1 - Φ(margin/std))
-- spec §4.3

CREATE OR REPLACE FUNCTION calculate_disq_risk(p_margin NUMERIC, p_std NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_z   NUMERIC;
  v_az  NUMERIC;
  v_t   NUMERIC;
  v_phi NUMERIC;
  v_cdf NUMERIC;
BEGIN
  IF p_margin IS NULL THEN
    RETURN 0.5;
  END IF;

  IF p_std IS NULL OR p_std <= 0 THEN
    RETURN CASE WHEN p_margin > 0 THEN 0 ELSE 0.5 END;
  END IF;

  v_z  := p_margin / p_std;
  v_az := ABS(v_z);

  v_t   := 1.0 / (1.0 + 0.2316419 * v_az);
  v_phi := EXP(- v_az * v_az / 2.0) / SQRT(2 * PI());
  v_cdf := 1.0 - v_phi * (
              0.319381530   * v_t
           + (-0.356563782) * v_t * v_t
           +  1.781477937   * v_t * v_t * v_t
           + (-1.821255978) * v_t * v_t * v_t * v_t
           +  1.330274429   * v_t * v_t * v_t * v_t * v_t
          );

  IF v_z < 0 THEN v_cdf := 1.0 - v_cdf; END IF;

  RETURN GREATEST(0, LEAST(1, 1 - v_cdf));
END;
$$;
