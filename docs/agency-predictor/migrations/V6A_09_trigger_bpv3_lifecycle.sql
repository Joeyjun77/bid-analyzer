-- V6-A Migration 09: bid_predictions_v3 불변성 + 라이프사이클
-- spec §5.2

CREATE OR REPLACE FUNCTION fn_bpv3_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := COALESCE(NEW.created_at, now()) + INTERVAL '30 days';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.predicted_ratio          IS DISTINCT FROM OLD.predicted_ratio          OR
     NEW.predicted_floor_amount   IS DISTINCT FROM OLD.predicted_floor_amount   OR
     NEW.aggressive_margin        IS DISTINCT FROM OLD.aggressive_margin        OR
     NEW.balanced_margin          IS DISTINCT FROM OLD.balanced_margin          OR
     NEW.safe_margin              IS DISTINCT FROM OLD.safe_margin              OR
     NEW.strategy_aggressive_bid  IS DISTINCT FROM OLD.strategy_aggressive_bid  OR
     NEW.strategy_balanced_bid    IS DISTINCT FROM OLD.strategy_balanced_bid    OR
     NEW.strategy_safe_bid        IS DISTINCT FROM OLD.strategy_safe_bid        OR
     NEW.disq_risk_aggressive     IS DISTINCT FROM OLD.disq_risk_aggressive     OR
     NEW.disq_risk_balanced       IS DISTINCT FROM OLD.disq_risk_balanced       OR
     NEW.disq_risk_safe           IS DISTINCT FROM OLD.disq_risk_safe           OR
     NEW.confidence_tier          IS DISTINCT FROM OLD.confidence_tier          OR
     NEW.signal_stage             IS DISTINCT FROM OLD.signal_stage             OR
     NEW.sample_size_used         IS DISTINCT FROM OLD.sample_size_used         OR
     NEW.model_version            IS DISTINCT FROM OLD.model_version            THEN
    RAISE EXCEPTION 'bid_predictions_v3 immutable columns cannot be updated (id=%)', OLD.id;
  END IF;

  IF OLD.match_status = 'pending' AND NEW.match_status = 'matched'
     AND NEW.matched_at IS NULL THEN
    NEW.matched_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bpv3_lifecycle
  BEFORE INSERT OR UPDATE ON bid_predictions_v3
  FOR EACH ROW EXECUTE FUNCTION fn_bpv3_lifecycle();
