#!/usr/bin/env bash
# NYC Krungthai Campus collector — resume-safe installer.
# Never push source rosters, private/ or .local/ to GitHub.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
mkdir -p .local private/gas-work docs
chmod 700 .local private 2>/dev/null || true
STATE="$ROOT/.local/setup.env"
info(){ printf '\n\033[36m%s\033[0m\n' "$*"; }
fail(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "ต้องติดตั้ง $1 ก่อน แล้วเปิด Git Bash ใหม่"; }
need node; need git; need gh; need clasp; need npx; need curl
info '=== NYC · Krungthai Campus Survey | ติดตั้งและตรวจสอบ ==='
if ! gh auth status >/dev/null 2>&1; then fail 'กรุณารัน gh auth login ก่อน'; fi
if ! clasp list >/dev/null 2>&1; then fail 'กรุณารัน clasp login และเปิด Google Apps Script API ก่อน'; fi
OWNER="$(gh api user --jq .login)"
if [ -z "$OWNER" ];then fail 'อ่านบัญชี GitHub ไม่ได้';fi
if [ -f "$STATE" ];then
  # file created exclusively by this installer under chmod 600
  # shellcheck disable=SC1090
  source "$STATE"
  info "พบค่าติดตั้งเดิม: $REPO / $WORKER_NAME — จะใช้ค่าลับเดิม ไม่สร้างใหม่"
else
  read -rp "ชื่อ GitHub Repository [nyc-krungthai-campus-survey]: " REPO
  REPO="${REPO:-nyc-krungthai-campus-survey}"
  [[ "$REPO" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{2,90}$ ]] || fail 'ชื่อ Repository ไม่ถูกต้อง'
  read -rp "ชื่อ Cloudflare Worker [nyc-krungthai-campus-api]: " WORKER_NAME
  WORKER_NAME="${WORKER_NAME:-nyc-krungthai-campus-api}"
  [[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{2,55}$ ]] || fail 'ชื่อ Worker ต้องเป็น a-z 0-9 หรือ - เท่านั้น'
  printf 'ตั้งรหัสผ่านผู้ดูแลอย่างน้อย 12 อักขระ: '; IFS= read -rs ADMIN_PASSWORD; printf '\n'
  if [ "${#ADMIN_PASSWORD}" -lt 12 ];then fail 'รหัสผ่านต้องมีอย่างน้อย 12 อักขระ';fi
  SHARED_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  ADMIN_PASSWORD_SHA256="$(ADMIN_PASSWORD_INPUT="$ADMIN_PASSWORD" node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.env.ADMIN_PASSWORD_INPUT).digest('hex'))")"
  unset ADMIN_PASSWORD
  printf 'REPO=%q\nWORKER_NAME=%q\nSHARED_SECRET=%q\nADMIN_PASSWORD_SHA256=%q\n' "$REPO" "$WORKER_NAME" "$SHARED_SECRET" "$ADMIN_PASSWORD_SHA256" > "$STATE"
  chmod 600 "$STATE"
fi
FRONTEND_ORIGIN="https://${OWNER}.github.io"

info '[1/5] สร้างหรือใช้ Google Sheet + Apps Script เดิม'
GAS_DIR="$ROOT/private/gas-work"
if [ ! -f "$GAS_DIR/.clasp.json" ];then
  (cd "$GAS_DIR" && clasp create --type sheets --title 'NYC Krungthai Campus Survey Database') || fail 'ไม่สามารถสร้าง Google Sheets/Apps Script ได้'
fi
cp "$ROOT/apps-script/Code.gs" "$GAS_DIR/Code.gs"
cp "$ROOT/apps-script/appsscript.json" "$GAS_DIR/appsscript.json"
# Generate only within git-ignored directory. Never print the secret.
SHARED_SECRET="$SHARED_SECRET" node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],"function getSharedSecret_(){ return "+JSON.stringify(process.env.SHARED_SECRET)+"; }\n",{mode:0o600})' "$GAS_DIR/Config.gs"
(cd "$GAS_DIR" && clasp push --force) || fail 'clasp push ไม่สำเร็จ ตรวจบัญชี Google / สิทธิ์ Apps Script'
SCRIPT_ID="$(node -e 'const o=require(process.argv[1]);process.stdout.write(o.scriptId||"")' "$GAS_DIR/.clasp.json")"
printf 'Apps Script Editor: https://script.google.com/d/%s/edit\n' "$SCRIPT_ID"

info '[2/5] ยืนยัน URL Web App สำหรับเรียกจาก Cloudflare'
printf 'ใน Google Apps Script เลือก Deploy > New deployment > Web app\nExecute as: Me | Who has access: Anyone (including anonymous users)\nกด Deploy และ Authorize (หากถาม) จากนั้นคัดลอก URL /exec\n'
GAS_FILE="$ROOT/.local/gas_url"
GAS_URL=""; [ -f "$GAS_FILE" ] && GAS_URL="$(cat "$GAS_FILE")"
while :;do
  read -rp "Web App URL [/exec]${GAS_URL:+ (Enter ใช้ URL เดิม)}: " ans
  GAS_URL="${ans:-$GAS_URL}"
  [[ "$GAS_URL" =~ ^https://script\.google\.com/macros/s/.+/exec$ ]] || { printf 'URL ไม่ใช่ Web App /exec กรุณาลองใหม่\n'; continue; }
  printf '%s' "$GAS_URL" > "$GAS_FILE"; chmod 600 "$GAS_FILE"
  PING_BODY="$(SHARED_SECRET="$SHARED_SECRET" node -e 'process.stdout.write(JSON.stringify({secret:process.env.SHARED_SECRET,action:"ping"}))')"
  reply="$(curl -sSL --max-time 35 -H 'Content-Type: application/json' --data "$PING_BODY" "$GAS_URL" || true)"
  if printf '%s' "$reply" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.ok&&j.ready?0:1)}catch{process.exit(1)}})' ;then
    printf '✓ Google Apps Script: ready\n'; break
  fi
  printf '\nGoogle Web App ยังตอบไม่สำเร็จ (หรือรหัสใน deployment ยังเป็นรุ่นก่อน)\n'
  printf 'เปิด Apps Script > Deploy > Manage deployments > Edit > Version: New version\n'
  printf 'ตรวจว่า Execute as Me, Access Anyone และกด Authorize\n'
  printf 'ระบบไม่เปลี่ยน SHARED_SECRET ระหว่างรันซ้ำ\n'
  read -rp 'กด Enter เพื่อวาง URL อีกครั้ง หรือพิมพ์ q เพื่อหยุดและกลับมารันใหม่: ' decision
  [ "$decision" = 'q' ] && fail 'หยุดติดตั้งอย่างปลอดภัย ใช้ bash install.sh เพื่อทำต่อ'
done

info '[3/5] ติดตั้ง Cloudflare Worker + Secrets'
# Adjust name but avoid using a bash variable in a sed replacement string.
WORKER_NAME="$WORKER_NAME" node -e 'const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");s=s.replace(/^name\s*=\s*".*"/m,`name = "${process.env.WORKER_NAME}"`);fs.writeFileSync(p,s)' "$ROOT/worker/wrangler.toml"
DEPLOY_OUT="$(cd "$ROOT/worker" && npx --yes wrangler deploy 2>&1)" || { printf '%s\n' "$DEPLOY_OUT"; fail 'Cloudflare deploy ไม่สำเร็จ กรุณาตรวจ npx wrangler login'; }
printf '%s\n' "$DEPLOY_OUT" | tail -7
WORKER_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)"
if [ -z "$WORKER_URL" ];then read -rp 'วาง URL ของ Worker ที่แสดงใน Cloudflare (https://...workers.dev): ' WORKER_URL;fi
[[ "$WORKER_URL" =~ ^https://[a-z0-9.-]+\.workers\.dev$ ]] || fail 'Cloudflare Worker URL ไม่ถูกต้อง'
printf '%s' "$WORKER_URL" > "$ROOT/.local/worker_url"
for item in GAS_URL SHARED_SECRET ALLOWED_ORIGIN ADMIN_PASSWORD_SHA256;do
  case "$item" in GAS_URL) value="$GAS_URL";; SHARED_SECRET)value="$SHARED_SECRET";; ALLOWED_ORIGIN)value="$FRONTEND_ORIGIN";; ADMIN_PASSWORD_SHA256)value="$ADMIN_PASSWORD_SHA256";; esac
  printf '%s' "$value" | (cd "$ROOT/worker" && npx --yes wrangler secret put "$item" --name "$WORKER_NAME" >/dev/null) || fail "อัปโหลด secret $item ไม่สำเร็จ"
  printf '✓ อัปโหลด %s\n' "$item"
done
sleep 3
health="$(curl -sS --max-time 20 "$WORKER_URL/health" || true)"
printf '%s' "$health" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.ok&&j.configured?0:1)}catch{process.exit(1)}})' || fail 'Cloudflare /health ยังไม่พร้อม โปรดรันใหม่โดยใช้ค่าเดิม'
resp="$(curl -sSL --max-time 25 -H "Origin: $FRONTEND_ORIGIN" "$WORKER_URL/api/config" || true)"
printf '%s' "$resp" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.ok&&j.config?0:1)}catch{process.exit(1)}})' || fail 'Cloudflare → Apps Script → Sheets ยังไม่พร้อม โปรดตรวจ Cloudflare Secrets'
printf '✓ Worker /health และ /api/config ตอบสำเร็จ\n'

info '[4/5] เตรียมไฟล์เว็บไซต์และเผยแพร่บน GitHub Pages'
WORKER_URL="$WORKER_URL" node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,"window.NYC_API_URL = "+JSON.stringify(process.env.WORKER_URL)+";\n")' "$ROOT/site/config.js"
cp -f "$ROOT/site/"* "$ROOT/docs/"
if [ ! -d "$ROOT/.git" ];then git init -b main >/dev/null;fi
if ! git config user.name >/dev/null;then git config user.name "$OWNER";fi
if ! git config user.email >/dev/null;then
  GH_ID="$(gh api user --jq .id)"; git config user.email "$GH_ID+$OWNER@users.noreply.github.com"
fi
git branch -M main
git add .gitignore README.md schema.json install.sh site docs worker apps-script/Code.gs apps-script/appsscript.json
if ! git diff --cached --quiet;then git commit -m 'NYC Krungthai Campus survey system' >/dev/null;fi
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1;then
  [ -n "$(git remote get-url origin 2>/dev/null || true)" ] || git remote add origin "https://github.com/$OWNER/$REPO.git"
else
  gh repo create "$REPO" --public --source=. --remote=origin --push || fail 'สร้าง GitHub repo ไม่สำเร็จ'
fi
REMOTE="$(git remote get-url origin)"
[[ "$REMOTE" == *"$OWNER/$REPO"* ]] || fail "Remote repository ไม่ตรง ($REMOTE) — จะไม่ push ทับโครงการอื่น"
git push --set-upstream origin main || fail 'Git push ไม่สำเร็จ'
if ! gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1;then
  gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null || fail 'ไม่สามารถเปิด GitHub Pages ได้'
fi

info '[5/5] สรุปผล'
printf '\n✓ Google Apps Script / Google Sheets: API พร้อมใช้งาน\n✓ Cloudflare Worker: %s\n✓ GitHub: https://github.com/%s/%s\n✓ เว็บไซต์: https://%s.github.io/%s/\n✓ ผู้ดูแล: https://%s.github.io/%s/admin.html\n' "$WORKER_URL" "$OWNER" "$REPO" "$OWNER" "$REPO" "$OWNER" "$REPO"
printf '\nหมายเหตุ: GitHub Pages อาจยังแสดง 404 ชั่วคราวก่อน Build/Deploy สำเร็จ\nขั้นตอนต่อไป: Admin > นำเข้า Excel > ดาวน์โหลดรหัสเชิญแบบส่วนตัว > ส่งให้แต่ละคน > ทดสอบคำตอบ 1 รายการ\nห้ามนำไฟล์รายชื่อที่มีข้อมูลส่วนบุคคลขึ้น GitHub\n'
