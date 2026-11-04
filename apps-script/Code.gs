/** NYC Krungthai Campus readiness survey (independent college workflow)
 *  Backend is private, called only by a Cloudflare Worker sharing a secret.
 *  DO NOT commit apps-script/Config.gs or the bound spreadsheet to GitHub.
 */
const NYC_VERSION = '3.0.0';
const S_USERS = 'Users_A_W';
const S_CODES = 'InviteCodes';
const S_RESPONSES = 'SurveyResponses';
const S_SETTINGS = 'Settings';
// BANK_HEADERS is generated from the user-supplied XLSX; do not reorder.
const BANK_HEADERS = ["ID(เลขอ้างอิงของสถาบันการศึกษา) ต้องระบุ", "Code(รหัสประจำตัว) ต้องระบุ", "Campus id(รหัสวิทยาเขต) ไม่มีให้ใส่ 001", "Email(อีเมล) ต้องระบุ", "Prefix(TH)(คำนำหน้าภาษาไทย) ต้องระบุ", "Prefix(EN)(คำนำหน้าภาษาอังกฤษ) ต้องระบุ", "First name(TH)(ชื่อภาษาไทย) ต้องระบุ", "Last name(TH)(นามสกุลภาษาไทย) ต้องระบุ", "First name(EN)(ชื่อภาษาอังกฤษ) ต้องระบุ", "Last name(EN)(นามสกุลภาษาอังกฤษ) ต้องระบุ", "Birth date(วันเกิด ปี ค.ศ.) ex.2015-01-31 ต้องระบุ", "Gender(เพศ)MALE/ FEMALE ต้องระบุ", "Type(ประเภทผู้ใช้ระบุได้มากกว่า 1 type) ต้องระบุ STUDENT/TEACHER/STAFF/ALUMNI/GUARDIAN/MERCHANT/GUEST", "Associated Student ID (รหัสประจำตัวนักเรียนที่เชื่อมโยง - เฉพาะผู้ปกครอง) ระบุได้มากกว่า 1 คน เช่น 690103/680298", "Degree(ระดับการศึกษา) ต้องระบุ BACHELOR/MASTER/DOCTORAL/OTHER/DIPLOMA/CERTIFICATE/HIGH_SCHOOL/ELEMENTARY/KINDERGARTEN/HONORARY/MIDDLE_SCHOOL/ASSOCIATE_DEGREE", "Study year(ชั้นปี) ไม่มีให้ใส่ 0", "Faculty id(รหัสคณะ) ต้องระบุ", "Department id(รหัสสาขา) ไม่มีไม่ต้องใส่", "Curriculum id(รหัสหลักสูตร) ไม่มีไม่ต้องใส่", "Nationality(THAI/OTHER) ต้องระบุ", "Citizen id(รหัสบัตรประชาชน) ต้องระบุ", "Passport id(เลขพาสปอร์ตเฉพาะต่างชาติ) ระบุเฉพาะคนต่างชาติ", "Status(สถานะผู้ใช้งาน) ต้องระบุ Active/Inactive"];
const R_HEADERS = ['response_id','created_at','user_id','type','interest','features','priority','notes','privacy_ack','bank_permission','policy_version'];
const C_HEADERS = ['user_id','code_sha256','issued_at','used_at','status'];
const FEATURES = ['ข่าวสารและประกาศ','ปฏิทินและแจ้งเตือน','บัตรนักเรียน/บุคลากรดิจิทัล','เช็กชื่อกิจกรรมด้วย QR Code','จองห้องหรืออุปกรณ์','แบบสอบถาม/โหวต','บริการชำระค่าธรรมเนียม (ขึ้นกับธนาคาร)','ข้อมูลและบริการอื่น ๆ'];
const INTEREST = ['ต้องการใช้งาน','ยังไม่แน่ใจ','ไม่ต้องการใช้งาน'];

function doGet() {
  return reply_({ok:true, service:'NYC Krungthai Campus Survey', version:NYC_VERSION, transport:'POST only'});
}
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 300000) return reply_({ok:false,error:'Invalid request'});
    const p = JSON.parse(e.postData.contents);
    if (typeof getSharedSecret_ !== 'function' || !p.secret || !safeSame_(p.secret, getSharedSecret_())) return reply_({ok:false,error:'Forbidden'});
    const action = String(p.action||'');
    if (action === 'ping') { init_(); return reply_({ok:true,version:NYC_VERSION,ready:true}); }
    if (action === 'config') { init_(); return reply_({ok:true,config:publicSettings_()}); }
    if (action === 'submit') return reply_(submit_(p.data || {}));
    if (action === 'stats') return reply_(stats_());
    if (action === 'import') return reply_(importUsers_(p.rows||[],p.defaults||{}));
    if (action === 'people') return reply_(people_(Number(p.offset||0)));
    if (action === 'update') return reply_(updatePeople_(p.updates||[]));
    if (action === 'regenerate') return reply_(regenerate_(p.ids||[]));
    if (action === 'settings') return reply_(changeSettings_(p.settings||{}));
    if (action === 'export') return reply_(exportBank_(Number(p.offset||0)));
    return reply_({ok:false,error:'Unknown action'});
  } catch(err) { console.error('NYC backend error: '+String(err&&err.message||'unknown').slice(0,150)); return reply_({ok:false,error:'Backend request failed'}); }
}
function reply_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function safeSame_(a,b){a=String(a);b=String(b);let n=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++) n|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return n===0;}
function db_(){const ss=SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error('No bound spreadsheet; open script from spreadsheet');return ss;}
function sh_(name, headers){const ss=db_();let s=ss.getSheetByName(name);if(!s){s=ss.insertSheet(name);s.getRange(1,1,1,headers.length).setValues([headers]);s.getRange(1,1,1,headers.length).setBackground('#dcecf3').setFontWeight('bold');s.setFrozenRows(1);if(name===S_USERS)s.getRange(1,1,s.getMaxRows(),23).setNumberFormat('@');}return s;}
function init_(){sh_(S_USERS,BANK_HEADERS);sh_(S_CODES,C_HEADERS);sh_(S_RESPONSES,R_HEADERS);const s=sh_(S_SETTINGS,['key','value']);if(s.getLastRow()<2){s.getRange(2,1,6,2).setValues([['isOpen','true'],['title','แบบสำรวจความประสงค์ใช้งาน Krungthai Campus'],['privacyContact','เจ้าหน้าที่ผู้รับผิดชอบของวิทยาลัย'],['privacyNotice','คำตอบใช้สำหรับประเมินความต้องการของสถานศึกษาเท่านั้น การเตรียมข้อมูลส่งธนาคารเป็นขั้นตอนแยกต่างหาก'],['bankExportEnabled','false'],['policyVersion','2026-11']]);}return true;}
function lock_(f){const l=LockService.getScriptLock();l.waitLock(12000);try{return f();}finally{l.releaseLock();}}
function settings_(){init_();const vals=sh_(S_SETTINGS,['key','value']).getDataRange().getDisplayValues();const out={};for(const r of vals.slice(1))if(r[0])out[r[0]]=r[1];return out;}
function publicSettings_(){const s=settings_();return {isOpen:s.isOpen==='true',title:s.title,privacyNotice:s.privacyNotice,privacyContact:s.privacyContact,policyVersion:s.policyVersion,features:FEATURES};}
function t_(v, max=240){let s=String(v===null||v===undefined?'':v).trim().slice(0,max);return s;}
function safeCell_(v,max=250){let s=t_(v,max);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return s;}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(x=>(x&255).toString(16).padStart(2,'0')).join('');}
function issueCode_(){return (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').slice(0,28).toUpperCase();}
function ensureCapacity_(s,target){const n=s.getMaxRows();if(target>n)s.insertRowsAfter(n,target-n);}
function allRows_(s){const n=s.getLastRow();return n<2?[]:s.getRange(2,1,n-1,s.getLastColumn()).getDisplayValues();}
function indexUsers_(){const rows=allRows_(sh_(S_USERS,BANK_HEADERS));const map={};rows.forEach((r,i)=>{if(r[0])map[String(r[0])]={row:i+2,data:r};});return map;}
function importUsers_(rows, defaults){return lock_(()=>{init_();if(!Array.isArray(rows)||rows.length<1||rows.length>75)return {ok:false,error:'Import 1–75 rows per batch'};
 const users=sh_(S_USERS,BANK_HEADERS),codes=sh_(S_CODES,C_HEADERS),index=indexUsers_(),pending=[],cRows=[],invites=[],errors=[];const priorCodes=new Set(Object.values(index).map(o=>String(o.data[1])));
 const faculty=t_(defaults.faculty,40),department=t_(defaults.department,40),curriculum=t_(defaults.curriculum,40),status=t_(defaults.status,12);
 if(status && !['Active','Inactive'].includes(status))return {ok:false,error:'Invalid default status'};
 rows.forEach((row,i)=>{if(!Array.isArray(row)||row.length!==23){errors.push({line:i+1,error:'ต้องมี 23 คอลัมน์ A-W'});return;}
 let r=row.map((v,j)=>safeCell_(v, j===10?40:250));
 const id=t_(r[0],100),code=t_(r[1],100),email=t_(r[3],120);
 if(!id||!code||!email||!email.includes('@')){errors.push({line:i+1,error:'ขาด ID / Code / Email'});return;}
 if(index[id]||pending.some(x=>x[0]===id)){errors.push({line:i+1,error:'ID ซ้ำ: '+id.slice(-5)});return;}
 if(priorCodes.has(code)||pending.some(x=>x[1]===code)){errors.push({line:i+1,error:'Code ซ้ำ: '+code.slice(-5)});return;}
 if(!r[16]&&faculty)r[16]=safeCell_(faculty,40);if(!r[17]&&department)r[17]=safeCell_(department,40);if(!r[18]&&curriculum)r[18]=safeCell_(curriculum,40);if(!r[22]&&status)r[22]=status;
 if(r[22]&&!['Active','Inactive'].includes(r[22])){errors.push({line:i+1,error:'Status ต้องเป็น Active/Inactive'});return;}
 pending.push(r);const one=issueCode_();cRows.push([id,hash_(one),new Date().toISOString(),'','issued']);invites.push({id,email,code:one});
 });
 if(pending.length){ensureCapacity_(users,users.getLastRow()+pending.length);ensureCapacity_(codes,codes.getLastRow()+cRows.length);users.getRange(users.getLastRow()+1,1,pending.length,23).setNumberFormat('@').setValues(pending);codes.getRange(codes.getLastRow()+1,1,cRows.length,5).setValues(cRows);}
 return {ok:true,inserted:pending.length,rejected:errors.length,errors,invites};
 });}
function submit_(d){return lock_(()=>{init_();const s=publicSettings_();if(!s.isOpen)return {ok:false,error:'ระบบปิดรับคำตอบแล้ว'};
 const code=t_(d.code,64).replace(/[\s-]/g,'').toUpperCase();if(!/^[A-F0-9]{28}$/.test(code))return {ok:false,error:'รหัสเชิญไม่ถูกต้อง'};
 const choice=t_(d.interest,40);if(!INTEREST.includes(choice))return {ok:false,error:'กรุณาระบุความประสงค์'};
 if(d.privacyAck!==true)return {ok:false,error:'กรุณาอ่านและรับทราบประกาศการใช้ข้อมูล'};
 const selected=Array.isArray(d.features)?d.features.filter(x=>FEATURES.includes(x)).slice(0,8):[];
 const priority=t_(d.priority,100);if(priority&&!FEATURES.includes(priority))return {ok:false,error:'บริการที่ให้ความสำคัญไม่ถูกต้อง'};
 const cs=sh_(S_CODES,C_HEADERS),cr=allRows_(cs),wanted=hash_(code);let match=-1;for(let i=0;i<cr.length;i++)if(safeSame_(cr[i][1],wanted)){match=i;break;}
 if(match<0)return {ok:false,error:'ไม่พบรหัสเชิญ กรุณาติดต่อผู้ประสานงาน'};
 if(cr[match][3]||cr[match][4]==='revoked')return {ok:false,error:'รหัสนี้เคยใช้แล้วหรือถูกยกเลิก'};
 const id=cr[match][0],user=indexUsers_()[id];if(!user)return {ok:false,error:'ไม่พบข้อมูลผู้รับเชิญ'};
 const permission=choice==='ต้องการใช้งาน' && d.bankPermission===true;
 const ss=sh_(S_RESPONSES,R_HEADERS),answer=[Utilities.getUuid(),new Date().toISOString(),id,t_(user.data[12],80),choice,selected.join(' | '),priority,safeCell_(d.notes,600),'yes',permission?'yes':'no',s.policyVersion];
 ss.appendRow(answer);cs.getRange(match+2,4,1,2).setValues([[new Date().toISOString(),'used']]);return {ok:true,reference:answer[0].slice(0,8)};
 });}
function stats_(){init_();const u=allRows_(sh_(S_USERS,BANK_HEADERS)),rs=allRows_(sh_(S_RESPONSES,R_HEADERS));const interests={'ต้องการใช้งาน':0,'ยังไม่แน่ใจ':0,'ไม่ต้องการใช้งาน':0};const types={},features={};for(const r of rs){interests[r[4]]=(interests[r[4]]||0)+1;for(const typ of r[3].split('/'))types[typ]=(types[typ]||0)+1;for(const f of r[5].split(' | ').filter(Boolean))features[f]=(features[f]||0)+1;}const st=settings_();return {ok:true,stats:{totalUsers:u.length,responded:rs.length,pending:Math.max(0,u.length-rs.length),interests,types,features,eligiblePermission:rs.filter(r=>r[4]==='ต้องการใช้งาน'&&r[9]==='yes').length},settings:{isOpen:st.isOpen==='true',title:st.title,privacyContact:st.privacyContact,privacyNotice:st.privacyNotice,bankExportEnabled:st.bankExportEnabled==='true'},recent:rs.slice(-15).reverse().map(r=>({time:r[1],type:r[3],interest:r[4]}))};}
function people_(offset){init_();const users=allRows_(sh_(S_USERS,BANK_HEADERS));offset=Math.max(0,Math.min(offset,Math.max(0,users.length)));return {ok:true,total:users.length,offset,rows:users.slice(offset,offset+100).map(r=>({id:r[0],code:r[1],type:r[12],faculty:r[16],department:r[17],curriculum:r[18],status:r[22]}))};}
function updatePeople_(items){return lock_(()=>{init_();if(!Array.isArray(items)||items.length>100)return {ok:false,error:'Invalid count'};const s=sh_(S_USERS,BANK_HEADERS),idx=indexUsers_();let count=0;const errors=[];for(const p of items){const id=t_(p.id,100);const obj=idx[id];if(!obj){errors.push('ID ไม่พบ '+id.slice(-5));continue;}const status=t_(p.status,12);if(!['Active','Inactive'].includes(status)){errors.push('สถานะไม่ถูกต้อง '+id.slice(-5));continue;}s.getRange(obj.row,17,1,3).setNumberFormat('@').setValues([[safeCell_(p.faculty,40),safeCell_(p.department,40),safeCell_(p.curriculum,40)]]);s.getRange(obj.row,23).setValue(status);count++;}return {ok:true,updated:count,errors};});}
function regenerate_(ids){return lock_(()=>{init_();if(!Array.isArray(ids)||ids.length<1||ids.length>60)return {ok:false,error:'เลือก 1–60 รายการ'};const u=indexUsers_(),codes=sh_(S_CODES,C_HEADERS),data=allRows_(codes),invites=[];for(const idIn of ids){const id=t_(idIn,100);if(!u[id])continue;const prev=data.findIndex(r=>r[0]===id);if(prev>=0 && data[prev][3])continue;const one=issueCode_();const val=[id,hash_(one),new Date().toISOString(),'','issued'];if(prev>=0)codes.getRange(prev+2,1,1,5).setValues([val]);else codes.appendRow(val);invites.push({id,email:u[id].data[3],code:one});}return {ok:true,invites};});}
function changeSettings_(o){return lock_(()=>{init_();const s=sh_(S_SETTINGS,['key','value']),rows=allRows_(s),allowed=['isOpen','title','privacyContact','privacyNotice','bankExportEnabled'];let changed=0;for(const [key,val] of Object.entries(o)){if(!allowed.includes(key))continue;let v=t_(val,key==='privacyNotice'?900:250);if(['isOpen','bankExportEnabled'].includes(key))v=(val===true||val==='true')?'true':'false';let i=rows.findIndex(r=>r[0]===key);if(i<0)s.appendRow([key,safeCell_(v,900)]);else s.getRange(i+2,2).setValue(safeCell_(v,900));changed++;}return {ok:true,changed};});}
function exportBank_(offset){init_();const st=settings_();if(st.bankExportEnabled!=='true')return {ok:false,error:'ผู้ดูแลยังไม่ได้เปิดการเตรียมไฟล์สำหรับธนาคาร'};
 const people=indexUsers_(),rs=allRows_(sh_(S_RESPONSES,R_HEADERS));const uniq={};for(const r of rs)if(r[4]==='ต้องการใช้งาน'&&r[9]==='yes')uniq[r[2]]=true;
 const ids=Object.keys(uniq),accepted=[],rejected=[];
 for(const id of ids){const p=people[id];if(!p){rejected.push({id:id.slice(-5),reason:'ไม่พบผู้ใช้งาน'});continue;}const r=p.data;
 if(!r[16]){rejected.push({id:id.slice(-5),reason:'Q Faculty ID ยังว่าง'});continue;}
 if(r[22]!=='Active'){rejected.push({id:id.slice(-5),reason:'W Status ไม่ใช่ Active'});continue;}
 const missing=[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15,19].filter(i=>!r[i]);if(missing.length){rejected.push({id:id.slice(-5),reason:'ข้อมูลจำเป็น A–P/T ไม่ครบ'});continue;}
 if(!['MALE','FEMALE'].includes(r[11])){rejected.push({id:id.slice(-5),reason:'L Gender ไม่ใช่ MALE/FEMALE'});continue;}
 if(!r[12].split('/').every(x=>['STUDENT','TEACHER','STAFF','ALUMNI','GUARDIAN','MERCHANT','GUEST'].includes(x))){rejected.push({id:id.slice(-5),reason:'M Type ไม่ตรงแม่แบบธนาคาร'});continue;}
 if(!['THAI','OTHER'].includes(r[19])){rejected.push({id:id.slice(-5),reason:'T Nationality ไม่ใช่ THAI/OTHER'});continue;}
 if(r[19]==='THAI'&&!r[20]){rejected.push({id:id.slice(-5),reason:'U Citizen ID ยังว่าง'});continue;}
 if(r[19]==='OTHER'&&!r[21]){rejected.push({id:id.slice(-5),reason:'V Passport ID ยังว่าง'});continue;}
 accepted.push(r.slice(0,23));}
 offset=Math.max(0,offset);return {ok:true,headers:BANK_HEADERS,rows:accepted.slice(offset,offset+250),total:accepted.length,offset,hasMore:offset+250<accepted.length,excluded:rejected.length,warnings:offset===0?rejected.slice(0,50):[]};}
