-- V6-A Migration 08: bid_history.canonical_ag 자동 채움
-- spec §5.1

CREATE OR REPLACE FUNCTION fn_normalize_bh()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_ag IS NULL AND NEW.ag IS NOT NULL THEN
    NEW.canonical_ag := normalize_agency_name(NEW.ag);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_normalize_bh
  BEFORE INSERT OR UPDATE OF ag ON bid_history
  FOR EACH ROW EXECUTE FUNCTION fn_normalize_bh();
