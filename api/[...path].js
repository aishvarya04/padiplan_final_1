const crypto = require("crypto");

const COOKIE = "padi_session";
const TEXT_MODEL = process.env.TEXT_MODEL || "openai/gpt-oss-120b";
const VISION_MODEL = process.env.VISION_MODEL || "qwen/qwen3.8-27b";

function send(res, status, data, headers={}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [k,v] of Object.entries(headers)) res.setHeader(k,v);
  res.end(JSON.stringify(data));
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
function b64(v) { return Buffer.from(v).toString("base64url"); }
function sign(payload) {
  const p = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("base64url");
  return p + "." + sig;
}
function verify(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [p,s] = token.split(".");
  if (!p || !s) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(p).digest();
  let actual;
  try { actual = Buffer.from(s, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function cookie(req) {
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp("(?:^|;\\\\s*)" + COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function setSession(res, user) {
  const token = sign({u:user.username,n:user.name,exp:Date.now()+7*24*3600*1000});
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}
async function redis(command, ...args) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Database not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN.");
  const r = await fetch(url, {
    method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify([command,...args])
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || "Database request failed");
  return j.result;
}
function pwHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
async function groq({messages,image}) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing in Vercel Environment Variables.");
  if (!Array.isArray(messages) || !messages.length) throw new Error("No messages supplied.");
  const msgs = messages.map(m => ({role:m.role,content:m.content}));
  if (image) {
    const last = msgs[msgs.length-1];
    last.content = [{type:"text",text:String(last.content || "")},
      {type:"image_url",image_url:{url:`data:${image.media_type};base64,${image.data}`}}];
  }
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.GROQ_API_KEY},
    body:JSON.stringify({model:image?VISION_MODEL:TEXT_MODEL,messages:msgs,max_tokens:700,temperature:0.5})
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Groq API error ${r.status}`);
  const answer = (j.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("Groq returned an empty answer.");
  return answer;
}

module.exports = async (req,res) => {
  const route = (req.query.path || []).join("/");
  try {
    if (route === "signup" && req.method === "POST") {
      const b=body(req), username=String(b.username||"").trim().toLowerCase(), password=String(b.password||"");
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return send(res,400,{error:"Username must be 3 to 24 letters, numbers, dot, dash or underscore."});
      if (password.length<6 || password.length>100) return send(res,400,{error:"Password must be at least 6 characters."});
      const key="padi:user:"+username;
      if (await redis("GET",key)) return send(res,409,{error:"That username is already taken."});
      const salt=crypto.randomBytes(16).toString("hex");
      const user={username,name:String(b.name||"").trim().slice(0,40)||username,salt,hash:pwHash(password,salt)};
      await redis("SET",key,JSON.stringify(user));
      setSession(res,user);
      return send(res,200,{ok:true,name:user.name});
    }
    if (route === "login" && req.method === "POST") {
      const b=body(req), username=String(b.username||"").trim().toLowerCase(), password=String(b.password||"");
      const raw=await redis("GET","padi:user:"+username);
      const user=raw?JSON.parse(raw):null;
      const salt=user?user.salt:"00000000000000000000000000000000";
      const given=Buffer.from(pwHash(password,salt),"hex");
      const real=Buffer.from(user?user.hash:"0".repeat(128),"hex");
      if (!user || given.length!==real.length || !crypto.timingSafeEqual(given,real)) return send(res,401,{error:"Wrong username or password."});
      setSession(res,user);
      return send(res,200,{ok:true,name:user.name});
    }
    if (route === "logout" && req.method === "POST") { clearSession(res); return send(res,200,{ok:true}); }
    if (route === "me" && req.method === "GET") {
      const u=verify(cookie(req));
      if (!u) return send(res,401,{error:"Not logged in"});
      return send(res,200,{username:u.u,name:u.n});
    }
    if (route === "ask" && req.method === "POST") {
      const u=verify(cookie(req));
      if (!u) return send(res,401,{error:"Please log in"});
      try { return send(res,200,{text:await groq(body(req))}); }
      catch(e) { console.error("PadiPlan teacher:",e.message); return send(res,500,{error:e.message}); }
    }
    return send(res,404,{error:"API route not found"});
  } catch(e) {
    console.error("PadiPlan API:",e.message);
    return send(res,500,{error:e.message || "Server error"});
  }
};
