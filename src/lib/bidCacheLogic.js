// IndexedDB 증분 캐시 순수 결정 로직 (의존성 0 — node 단위 테스트 대상)
// 설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md

// 동기화 액션 결정.
// server: {count, maxUpdated}  meta: {lastSyncUpdatedAt, cachedCount, cols} | null  cols: 현재 BID_RECORDS_COLS
// 반환: 'full'(최초·스키마변경) | 'hit'(무변경) | 'delta'(변경)
export function decideSyncAction(server, meta, cols) {
  if (!meta || meta.cols !== cols) return "full";
  if (server.maxUpdated === meta.lastSyncUpdatedAt && server.count === meta.cachedCount) return "hit";
  return "delta";
}

// 델타 후 IDB 행수가 서버 count와 다르면 삭제/발산 → 전체 reconcile 필요.
export function needsReconcile(idbCount, serverCount) {
  return idbCount !== serverCount;
}

// od 내림차순 정렬 (sbFetchAll의 order=od.desc 계약과 동일). null od는 맨 뒤.
export function sortByOdDesc(rows) {
  return rows.slice().sort((a, b) => {
    const ao = a.od || "", bo = b.od || "";
    if (ao === bo) return 0;
    if (!ao) return 1;
    if (!bo) return -1;
    return ao < bo ? 1 : -1;
  });
}
