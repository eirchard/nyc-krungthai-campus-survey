/** Cloudflare Worker gateway. Never store roster data in KV/logs. */
const SERVICE = 'nyc-krungthai-campus-survey';
const POLICY = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store, private', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'x-frame-options':'DENY' };
const encoder = new TextEncoder();
function response(data,status=200,origin=''){const h=new Headers(POLICY);if(origin){h.set('Access-Control-Allow-Origin',origin);h.set('Vary','Origin');}return new Response(JSON.stringify(data),{status,headers:h});}
function originFor(req,env){const requested=req.headers.get('Origin')||'';const authorized=String(env.ALLOWED_ORIGIN||'').replace(/\/$/,'');return requested&&requested===authorized?authorized:'';}
async function sha256(str){const hash=await crypto.subtle.digest('SHA-256',encoder.encode(str));return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function timingEq(a,b){a=String(a);b=String(b);let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++) diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
async function isAdmin(req,env){const pass=req.headers.get('X-Admin-Password')||'';if(pass.length<12||pass.length>256)return false;const digest=await sha256(pass);return timingEq(digest,env.ADMIN_PASSWORD_SHA256||'');}
async function backend(env,action,data){if(!env.GAS_URL||!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(env.GAS_URL)||!env.SHARED_SECRET)throw Error('Backend not configured');
 const controller=new AbortController();const t=setTimeout(()=>controller.abort(),20000);
 try{const r=await fetch(env.GAS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.SHARED_SECRET,action,...data}),redirect:'follow',signal:controller.signal});
 const text=await r.text();if(!r.ok||!text.trim().startsWith('{'))throw Error('Google Apps Script response is unavailable or not JSON');const json=JSON.parse(text);if(!json||typeof json.ok!=='boolean')throw Error('Invalid backend response');return json;
 }finally{clearTimeout(t);}}
async function jsonBody(req){const n=Number(req.headers.get('content-length')||0);if(n>240000)throw Error('Payload exceeds 240 KB');const body=await req.text();if(body.length>240000)throw Error('Payload exceeds 240 KB');return JSON.parse(body||'{}');}
export default {
 async fetch(req,env){const u=new URL(req.url), origin=req.headers.get('Origin')||'',allowed=originFor(req,env),path=u.pathname.replace(/\/$/,'')||'/';
 if(path==='/health')return response({ok:true,service:SERVICE,configured:Boolean(env.GAS_URL&&env.SHARED_SECRET&&env.ADMIN_PASSWORD_SHA256&&env.ALLOWED_ORIGIN)});
 if(origin&&!allowed)return response({ok:false,error:'Origin not allowed'},403);
 if(req.method==='OPTIONS'){const h=new Headers({'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'Content-Type, X-Admin-Password','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Max-Age':'600','Vary':'Origin'});return new Response(null,{status:204,headers:h});}
 if(path==='/api/config'&&req.method==='GET'){try{const d=await backend(env,'config',{});return response(d,d.ok?200:502,allowed);}catch{return response({ok:false,error:'ไม่สามารถโหลดข้อมูลแบบสำรวจได้'},502,allowed);}}
 if(path==='/api/submit'&&req.method==='POST'){
 try{const input=await jsonBody(req);if(input.website)return response({ok:true},200,allowed);const result=await backend(env,'submit',{data:input});return response(result,result.ok?200:400,allowed);}catch{return response({ok:false,error:'ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่'},502,allowed);}}
 const map={'/api/admin/stats':'stats','/api/admin/import':'import','/api/admin/people':'people','/api/admin/update':'update','/api/admin/regenerate':'regenerate','/api/admin/settings':'settings','/api/admin/export':'export'};
 if(Object.prototype.hasOwnProperty.call(map,path)&&req.method==='POST'){
 if(!await isAdmin(req,env))return response({ok:false,error:'รหัสผ่านผู้ดูแลไม่ถูกต้อง'},401,allowed);
 try{const obj=await jsonBody(req);const result=await backend(env,map[path],obj);return response(result,result.ok?200:400,allowed);}catch{return response({ok:false,error:'เชื่อมต่อฐานข้อมูลไม่สำเร็จ'},502,allowed);}}
 return response({ok:false,error:'Not found'},404,allowed);
 }
};
