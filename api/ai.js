const SB_URL = "https://sadunejfkstxbxogzutl.supabase.co";

async function verifySupabaseToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbKey) return false;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${token}` }
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const authed = await verifySupabaseToken(req);
  if (!authed) return res.status(401).json({ error: "인증이 필요합니다" });

  // API 키는 Vercel 환경변수에서 읽음 (클라이언트 노출 없음)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
