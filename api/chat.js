const SB_URL = "https://sadunejfkstxbxogzutl.supabase.co";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 미설정" });
  if (!sbKey) return res.status(500).json({ error: "SUPABASE_SERVICE_KEY 미설정" });

  const { messages, systemBase } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: "messages 필요" });

  const lastMsg = messages[messages.length - 1]?.content || "";

  try {
    // ─── 키워드 추출 및 DB 조회 ───
    const dbContext = await queryDB(lastMsg, sbKey);

    // ─── 시스템 프롬프트 조합 ───
    let system = systemBase || "";
    if (dbContext) {
      system += `\n\n■ 실시간 DB 조회 결과 (사용자 질문 기반 자동 조회)\n${dbContext}\n\n위 데이터를 답변에 적극 활용하세요. 수치를 인용할 때는 구체적으로 제시하세요.`;
    }

    // ─── Claude 호출 ───
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 2000,
        system,
        messages: messages.slice(-20)
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    // dbQueries 메타 정보도 함께 반환
    return res.status(200).json({ ...data, _dbContext: dbContext ? true : false });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Supabase REST 쿼리 헬퍼 ───
async function sbQuery(path, sbKey) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
  });
  if (!r.ok) return [];
  return await r.json();
}

// ─── 사용자 질문에서 키워드 추출 → DB 조회 ───
async function queryDB(msg, sbKey) {
  const parts = [];

  // 패턴 1: 특정 기관명 감지 → 기관 통계 + 최근 건
  const agKeyword = extractAgency(msg);
  if (agKeyword) {
    // 기관 통계
    const stats = await sbQuery(
      `rpc/fn_agency_stats?ag_keyword=${encodeURIComponent(agKeyword)}`,
      sbKey
    ).catch(() => null);

    // RPC 없으면 REST로 직접 조회
    if (!stats || stats.length === 0) {
      const rows = await sbQuery(
        `bid_records?ag=ilike.*${encodeURIComponent(agKeyword)}*&br1=gte.95&br1=lte.105&select=ag,od,br1,pc,co,ba,pn&order=od.desc&limit=20`,
        sbKey
      );
      if (rows.length > 0) {
        // 기관별 그룹핑
        const agGroups = {};
        rows.forEach(r => {
          if (!agGroups[r.ag]) agGroups[r.ag] = [];
          agGroups[r.ag].push(r);
        });
        
        for (const [ag, records] of Object.entries(agGroups)) {
          const adjs = records.map(r => Math.round((r.br1 - 100) * 10000) / 10000);
          const avg = adjs.reduce((a, b) => a + b, 0) / adjs.length;
          const std = Math.sqrt(adjs.reduce((a, b) => a + (b - avg) ** 2, 0) / adjs.length);

          parts.push(`\n[${ag}] 최근 ${records.length}건 분석: 평균 사정률 ${avg.toFixed(4)}%, 표준편차 ${std.toFixed(4)}%`);
          
          const recent5 = records.slice(0, 5);
          parts.push(`\n최근 낙찰 건:`);
          parts.push(`| 개찰일 | 공고명 | 사정률 | 참여 | 1순위 |`);
          parts.push(`|--------|--------|--------|------|-------|`);
          recent5.forEach(r => {
            const adj = Math.round((r.br1 - 100) * 10000) / 10000;
            parts.push(`| ${r.od} | ${(r.pn || "").slice(0, 25)} | ${adj>0?"+":""}${adj}% | ${r.pc}개사 | ${(r.co || "—").slice(0,12)} |`);
          });
        }
      }
    } else if (stats.length > 0) {
      stats.forEach(s => {
        parts.push(`[${s.ag}] ${s.cnt}건, 평균 ${s.avg_adj}%, std ${s.std_adj}%, 최근 ${s.last_date}`);
      });
    }
  }

  // 패턴 2: 기관유형 비교 ("교육청 vs 지자체", "기관별", "유형별")
  if (/기관유형|기관별|유형별|vs|비교/.test(msg)) {
    const typeStats = await sbQuery(
      `bid_records?br1=gte.95&br1=lte.105&select=at,br1,od&order=od.desc&limit=5000`,
      sbKey
    );
    if (typeStats.length > 0) {
      const byType = {};
      typeStats.forEach(r => {
        if (!byType[r.at]) byType[r.at] = [];
        byType[r.at].push(r.br1 - 100);
      });
      parts.push(`\n기관유형별 사정률 비교 (최근 5,000건 기준):`);
      parts.push(`| 기관유형 | 건수 | 평균 사정률 | 표준편차 |`);
      parts.push(`|---------|------|-----------|---------|`);
      for (const [t, vals] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
        parts.push(`| ${t} | ${vals.length} | ${avg.toFixed(4)}% | ${std.toFixed(4)}% |`);
      }
    }
  }

  // 패턴 3: 예측/MAE/정확도 관련
  if (/예측|MAE|정확도|오차|매칭|성능/.test(msg)) {
    const preds = await sbQuery(
      `bid_predictions?match_status=eq.matched&select=ag,at,pred_adj_rate,actual_adj_rate,adj_rate_error,open_date,pn&order=open_date.desc&limit=50`,
      sbKey
    );
    if (preds.length > 0) {
      const errors = preds.filter(p => p.adj_rate_error != null).map(p => Math.abs(Number(p.adj_rate_error)));
      const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
      const biasVals = preds.filter(p => p.adj_rate_error != null).map(p => Number(p.adj_rate_error));
      const bias = biasVals.reduce((a, b) => a + b, 0) / biasVals.length;
      const within05 = errors.filter(e => e <= 0.5).length;

      parts.push(`\n예측 성능 (${preds.length}건 매칭):`);
      parts.push(`  MAE: ${mae.toFixed(4)}%, Bias: ${bias.toFixed(4)}%, ±0.5% 적중: ${within05}/${errors.length} (${Math.round(within05 / errors.length * 100)}%)`);

      // 기관유형별 MAE
      const byType = {};
      preds.forEach(p => {
        if (p.adj_rate_error == null) return;
        if (!byType[p.at]) byType[p.at] = [];
        byType[p.at].push(Math.abs(Number(p.adj_rate_error)));
      });
      parts.push(`  기관유형별 MAE:`);
      for (const [t, errs] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
        const m = errs.reduce((a, b) => a + b, 0) / errs.length;
        parts.push(`    ${t}: ${errs.length}건, MAE ${m.toFixed(4)}%`);
      }

      // 최근 매칭 건 상세
      parts.push(`  최근 매칭 건:`);
      preds.slice(0, 5).forEach(p => {
        parts.push(`    · ${p.open_date} | ${(p.pn || "").slice(0, 25)} | 예측 ${Number(p.pred_adj_rate).toFixed(4)}% → 실제 ${Number(p.actual_adj_rate).toFixed(4)}% (오차 ${Number(p.adj_rate_error).toFixed(4)}%)`);
      });
    }
  }

  // 패턴 4: 최근/추이 관련
  if (/최근|추이|트렌드|변화|동향/.test(msg) && !agKeyword) {
    const recent = await sbQuery(
      `bid_records?br1=gte.95&br1=lte.105&select=at,od,br1,ag,pc,pn,co&order=od.desc&limit=30`,
      sbKey
    );
    if (recent.length > 0) {
      parts.push(`\n최근 낙찰 동향 (최신 ${Math.min(recent.length, 10)}건):`);
      parts.push(`| 개찰일 | 기관유형 | 발주기관 | 사정률 | 참여업체 | 1순위 |`);
      parts.push(`|--------|---------|---------|--------|---------|-------|`);
      recent.slice(0, 10).forEach(r => {
        const adj = Math.round((r.br1 - 100) * 10000) / 10000;
        parts.push(`| ${r.od} | ${r.at} | ${(r.ag||"").slice(0,15)} | ${adj>0?"+":""}${adj}% | ${r.pc}개사 | ${(r.co||"—").slice(0,10)} |`);
      });

      // 기관유형별 요약 추가
      const byType = {};
      recent.forEach(r => {
        if (!byType[r.at]) byType[r.at] = { count: 0, sum: 0 };
        byType[r.at].count++;
        byType[r.at].sum += r.br1 - 100;
      });
      parts.push(`\n기관유형별 최근 30건 요약:`);
      for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
        parts.push(`  ${t}: ${v.count}건, 평균 사정률 ${(v.sum / v.count).toFixed(4)}%`);
      }
    }
  }

  // 패턴 5: 투찰/낙찰하한율/전략
  if (/투찰|낙찰하한|전략|마진|하한율/.test(msg) && agKeyword) {
    const recent = await sbQuery(
      `bid_records?ag=ilike.*${encodeURIComponent(agKeyword)}*&br1=gte.95&br1=lte.105&bp=gt.0&xp=gt.0&fr=gt.0&select=ag,od,br1,bp,xp,fr,pc,ba&order=od.desc&limit=20`,
      sbKey
    );
    if (recent.length > 0) {
      const margins = recent.map(r => Math.abs(Number(r.bp) / Number(r.xp) * 100 - Number(r.fr)));
      const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
      const medMargin = margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)];
      parts.push(`\n[${agKeyword}] 1순위 투찰 마진 분석 (${recent.length}건):`);
      parts.push(`  낙찰하한율 대비 평균 마진: ${avgMargin.toFixed(4)}%, 중앙값: ${medMargin.toFixed(4)}%`);
      parts.push(`  최근 투찰 패턴:`);
      recent.slice(0, 5).forEach(r => {
        const bidRate = (Number(r.bp) / Number(r.xp) * 100);
        const margin = bidRate - Number(r.fr);
        parts.push(`    · ${r.od} | 투찰율 ${bidRate.toFixed(4)}% | 하한율 ${r.fr}% | 마진 ${margin.toFixed(4)}% | ${r.pc}개사`);
      });
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

// ─── 기관명 추출 (한국 행정구역 패턴) ───
function extractAgency(msg) {
  // 특정 기관명 패턴 매칭
  const patterns = [
    /(?:경기도|서울|부산|대구|인천|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)\s*(?:도\s*)?[\w가-힣]+(?:시|군|구|청|공사|공단|센터|원|소|단)/,
    /(?:조달청|한국전력|한전|LH|수자원공사|교육청|국방부|해군|공군|육군|해병)/,
    /[\w가-힣]{2,}(?:시|군|구|청|공사|공단)/
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}
