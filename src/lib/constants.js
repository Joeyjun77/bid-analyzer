// ─── Supabase ──────────────────────────────────────────────
import { getSession } from "../auth.js";
export const SB_URL=import.meta.env.VITE_SUPABASE_URL||"https://sadunejfkstxbxogzutl.supabase.co";
export const SB_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||"";
// 정적 hdrs/hdrsSel는 레거시 호환용으로 유지 (anon key만 사용)
export const hdrs={"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
export const hdrsSel={"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
// 로그인 사용자 JWT를 우선 사용하는 동적 헤더 함수
export function getHdrs(){const t=getSession()?.access_token||SB_KEY;return{"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+t}}
export function getHdrsSel(){const t=getSession()?.access_token||SB_KEY;return{"apikey":SB_KEY,"Authorization":"Bearer "+t}}
export const C={bg:"#0c0c1a",bg2:"#12122a",bg3:"#1a1a30",txt:"#e8e8f0",txm:"#a0a0b8",txd:"#666680",bdr:"#252540",gold:"#d4a834"};
export const PAGE=50;
export const inpS={width:"100%",padding:"8px 10px",background:"#0c0c1a",border:"1px solid #252540",borderRadius:6,color:"#e8e8f0",fontSize:13,outline:"none"};
export const CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
