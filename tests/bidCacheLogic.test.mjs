import { decideSyncAction, needsReconcile, sortByOdDesc } from "../src/lib/bidCacheLogic.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// decideSyncAction(server, meta, cols)
const COLS = "id,ag,od,ar1";
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, null, COLS), "full", "no-meta→full");
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: "id,ag" }, COLS), "full", "cols-changed→full");
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "hit", "unchanged→hit");
eq(decideSyncAction({ count: 10, maxUpdated: "T2" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "delta", "max-changed→delta");
eq(decideSyncAction({ count: 11, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "delta", "count-changed→delta");

// needsReconcile(idbCount, serverCount)
eq(needsReconcile(10, 10), false, "count-match→no-reconcile");
eq(needsReconcile(9, 10), true, "count-mismatch→reconcile");

// sortByOdDesc: od 내림차순, null od는 끝
const sorted = sortByOdDesc([{ id: 1, od: "2026-01-01" }, { id: 2, od: null }, { id: 3, od: "2026-05-01" }]);
eq(sorted.map(r => r.id).join(","), "3,1,2", "sortByOdDesc order");

console.log(bad === 0 ? "OK bidCacheLogic all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
