-- V6-A Migration 03: RLS enable + authenticated SELECT 정책
-- spec §8

ALTER TABLE bid_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_profile     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_predictions_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_notices_temp   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON bid_history
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON agency_profile
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_predictions_v3
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON upload_batches
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_notices_temp
  FOR SELECT TO authenticated USING (TRUE);
-- INSERT/UPDATE/DELETE 정책 미선언 → service_role 만 가능
