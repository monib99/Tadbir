(function(){
"use strict";
var SECTIONS=["Business","Personal","Volunteering","Development","Faith"];
var PRIVATE_BY_DEFAULT={Personal:1,Faith:1};
var BILL_CATS=["Rent","Utilities","Insurance","Road tax","MOT","PCN / fine","HMRC","Council tax","Loan / finance","Subscription","Other"];
var OUT_CATS=BILL_CATS.concat(["Stock","Fuel","Food","Household","Wages paid"]);
var IN_CATS=["Sales","Wages","Other income"];
var REPEATS=[["none","One-off"],["weekly","Every week"],["monthly","Every month"],["quarterly","Every 3 months"],["yearly","Every year"]];
var MODULES=[["bills","Bills and deadlines","Rent, insurance, road tax, fines and anything with a due date"],["money","Money","Income, spending and what is left each month"],["diary","Diary","Appointments, jobs, tasks and notes"],["loans","Private loans","Money you have borrowed or lent. Only you can see it"],["ibadah","Ibadah","Daily prayers, Quran, a good deed, and Friday reminders"]];
var DEFAULT_HABITS=[{id:"fajr",name:"Fajr"},{id:"dhuhr",name:"Dhuhr"},{id:"asr",name:"Asr"},{id:"maghrib",name:"Maghrib"},{id:"isha",name:"Isha"},{id:"quran",name:"Quran recitation"},{id:"good-deed",name:"A good deed"},{id:"kahf",name:"Surah Al-Kahf",days:[5]},{id:"sadaqah",name:"Sadaqah",days:[5]}];

var S={bills:[],txns:[],diary:[],priv:[],db:null,uid:null,view:"today",
  moneyMonth:first(new Date()),calMonth:first(new Date()),selDay:iso(new Date()),scope:"All",billFilter:"open"};
var queues={};

/* ---------- language and country ---------- */
var LANGS=[["en","English"],["ps","پښتو"],["fa","دری"],["ar","العربية"],["ur","اردو"]];
var RTL={ps:1,fa:1,ar:1,ur:1};
var COUNTRIES=[["GB","United Kingdom","£"],["AF","Afghanistan","؋"],["PK","Pakistan","Rs "],["IR","Iran","IRR "],["AE","United Arab Emirates","AED "],["SA","Saudi Arabia","SAR "],["QA","Qatar","QAR "],["TR","Türkiye","₺"],["DE","Germany","€"],["FR","France","€"],["NL","Netherlands","€"],["SE","Sweden","kr "],["US","United States","$"],["CA","Canada","$"],["AU","Australia","$"],["IN","India","₹"],["XX","Another country",""]];
var GENERIC_BILL_CATS=["Rent","Utilities","Insurance","Vehicle tax","Vehicle test","Fine","Tax","Loan / finance","Subscription","Other"];
var LANG="en";
function pickLang(){var l=null;try{l=localStorage.getItem("tadbir-lang")}catch(e){}
  if(!l){var n=(navigator.language||"en").slice(0,2).toLowerCase();l=LANGS.some(function(x){return x[0]===n})?n:"en"}
  return LANGS.some(function(x){return x[0]===l})?l:"en"}
function T(str,vars){var d=window.TADBIR_I18N&&window.TADBIR_I18N[LANG],out=(d&&d[str])||str;
  if(vars)Object.keys(vars).forEach(function(k){out=out.split("{"+k+"}").join(vars[k])});return out}
function LOC(){return LANG==="en"?"en-GB":(LANG==="fa"?"fa-AF":LANG)+"-u-ca-gregory-nu-latn"}
function applyLang(){LANG=pickLang();var el=document.documentElement;el.lang=LANG;el.dir=RTL[LANG]?"rtl":"ltr";
  document.querySelectorAll("[data-t]").forEach(function(n){n.textContent=T(n.getAttribute("data-t"))});
  document.querySelectorAll("[data-t-label]").forEach(function(n){n.setAttribute("aria-label",T(n.getAttribute("data-t-label")))})}
function country(){var st=S.priv.find(function(x){return x.id==="settings"}),c=st&&st.country;return COUNTRIES.find(function(x){return x[0]===c})||COUNTRIES[0]}
function cur(){return country()[2]}
function billCats(){return country()[0]==="GB"?BILL_CATS:GENERIC_BILL_CATS}
function outCats(){return billCats().concat(["Stock","Fuel","Food","Household","Wages paid"])}

/* ---------- helpers ---------- */
function pad(n){return n<10?"0"+n:""+n}
function iso(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function parse(s){var p=String(s||"").split("-");return new Date(+p[0],(+p[1]||1)-1,+p[2]||1)}
function first(d){return new Date(d.getFullYear(),d.getMonth(),1)}
function today(){return iso(new Date())}
function daysBetween(a,b){return Math.round((parse(b)-parse(a))/864e5)}
function addDays(s,n){var d=parse(s);d.setDate(d.getDate()+n);return iso(d)}
function addMonths(s,n){var d=parse(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);
  var last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d)}
function nextDue(due,rep){return rep==="weekly"?addDays(due,7):rep==="monthly"?addMonths(due,1):rep==="quarterly"?addMonths(due,3):rep==="yearly"?addMonths(due,12):due}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function money(n){n=Number(n)||0;var neg=n<0;n=Math.abs(n);
  var s=n.toLocaleString("en-GB",{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});return(neg?"-":"")+cur()+s}
function fmtDate(s,withDay){var o={day:"numeric",month:"short"};if(withDay)o.weekday="short";
  if(parse(s).getFullYear()!==new Date().getFullYear())o.year="numeric";return parse(s).toLocaleDateString(LOC(),o)}
function monthLabel(d){return d.toLocaleDateString(LOC(),{month:"long",year:"numeric"})}
function inMonth(s,m){var d=parse(s);return d.getFullYear()===m.getFullYear()&&d.getMonth()===m.getMonth()}
function $(id){return document.getElementById(id)}
function toast(msg){var t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("show")},3200)}
function newId(){return"m"+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}

/* ---------- storage: encrypt on this device, then upload ---------- */
var sb=null,K=null,pending=0;
function localPut(c,id,data){var a=S[c],i=a.findIndex(function(x){return x.id===id}),rec=Object.assign({id:id},data);if(i>=0)a[i]=rec;else a.push(rec)}
function save(c,id,data){
  localPut(c,id,data);render();
  if(!sb||!K)return Promise.resolve();
  var name=c+"/"+id;pending++;
  queues[name]=(queues[name]||Promise.resolve()).then(async function(){
    var row={user_id:S.uid,key:await TC.rowKey(K,name),blob:await TC.seal(K,{c:c,id:id,d:data}),updated_at:new Date().toISOString()};
    var r=await sb.from("items").upsert(row,{onConflict:"user_id,key"});if(r.error)throw r.error;
  }).catch(onWriteError).then(function(){pending--});
  return queues[name];
}
function remove(c,id){
  S[c]=S[c].filter(function(x){return x.id!==id});render();
  if(!sb||!K)return Promise.resolve();
  var name=c+"/"+id;pending++;
  queues[name]=(queues[name]||Promise.resolve()).then(async function(){
    var r=await sb.from("items").delete().eq("user_id",S.uid).eq("key",await TC.rowKey(K,name));if(r.error)throw r.error;
  }).catch(onWriteError).then(function(){pending--});
  return queues[name];
}
function onWriteError(){toast(T("That change could not be saved. Check your connection, then make the change again."))}
async function loadAll(){
  var fresh={bills:[],txns:[],diary:[],priv:[]},from=0,bad=0;
  for(;;){
    var r=await sb.from("items").select("blob").eq("user_id",S.uid).order("key").range(from,from+999);
    if(r.error)throw r.error;
    for(var i=0;i<r.data.length;i++){
      try{var o=await TC.open(K,r.data[i].blob);if(fresh[o.c])fresh[o.c].push(Object.assign({id:o.id},o.d))}catch(e){bad++}
    }
    if(r.data.length<1000)break;from+=1000;
  }
  S.bills=fresh.bills;S.txns=fresh.txns;S.diary=fresh.diary;S.priv=fresh.priv;
  note(bad?T("{n} saved entries could not be read on this device.",{n:bad}):"");
}
function strip(o){var c={};Object.keys(o).forEach(function(k){if(k!=="id"&&k!=="_priv"&&o[k]!==undefined)c[k]=o[k]});return c}

/* ---------- derived ---------- */
function billStatus(b){
  if(b.paid)return{cls:"good",label:T("Paid {d}",{d:b.paidOn?fmtDate(b.paidOn):""}),order:9999};
  var n=daysBetween(today(),b.due);
  if(n<0)return{cls:"crit",label:T("Overdue {n} days",{n:-n}),order:n};
  if(n===0)return{cls:"crit",label:T("Due today"),order:0};
  if(n<=7)return{cls:"warn",label:T("Due in {n} days",{n:n}),order:n};
  return{cls:"",label:T("Due {d}",{d:fmtDate(b.due)}),order:n};
}
function openBills(){return S.bills.filter(function(b){return!b.paid}).sort(function(a,b){return a.due<b.due?-1:a.due>b.due?1:0})}
function habits(){var c=S.priv.find(function(x){return x.id==="config"});return(c&&Array.isArray(c.habits)&&c.habits.length)?c.habits:DEFAULT_HABITS}
function settings(){return S.priv.find(function(x){return x.id==="settings"})}
function mods(){var st=settings();return st&&Array.isArray(st.modules)?st.modules:MODULES.map(function(m){return m[0]})}
function has(m){return mods().indexOf(m)>=0}
function secs(){return has("ibadah")?SECTIONS:SECTIONS.filter(function(x){return x!=="Faith"})}
function needsSetup(){return S.privLoaded&&!settings()}
function langChips(){return'<div class="chips">'+LANGS.map(function(l){return'<button class="chip" aria-pressed="'+(LANG===l[0])+'" data-act="lang" data-l="'+l[0]+'" lang="'+l[0]+'">'+l[1]+'</button>'}).join("")+'</div>'}
function viewSetup(){
  if(!S.pick){S.pick={};(settings()?mods():["bills","money","diary"]).forEach(function(m){S.pick[m]=1})}
  return'<section class="sec"><h2>'+T("Choose what you want to use")+'</h2><p class="lead">'+T("Pick only the parts you need. You can change this any time with the button at the top right.")+'</p><div class="list">'+
    MODULES.map(function(m){var on=!!S.pick[m[0]];return'<div class="row"><button class="check" aria-pressed="'+on+'" aria-label="'+esc(T(m[1]))+'" data-act="toggle-mod" data-id="'+m[0]+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>'+badge(MOD_ICON[m[0]])+'<div class="main"><span class="t">'+esc(T(m[1]))+(m[0]==="ibadah"&&LANG==="en"?'<span class="ar-s" lang="ar" dir="rtl">عبادة</span>':'')+'</span><span class="s">'+esc(T(m[2]))+'</span></div></div>'}).join("")+
    '</div><label class="field" for="set-country">'+T("Country")+'<select id="set-country">'+COUNTRIES.map(function(c){return'<option value="'+c[0]+'"'+(c[0]===(S.pickCountry||country()[0])?" selected":"")+'>'+esc(T(c[1]))+(c[2]?" ("+esc(c[2].trim())+")":"")+'</option>'}).join("")+'</select></label>'+
    '<div class="actions"><button class="btn" data-act="save-mods">'+T("Save")+'</button></div></section>'+
    '<section class="sec"><h2>'+T("Language")+'</h2>'+langChips()+'</section>'+
    '<section class="sec"><h2>'+T("Appearance")+'</h2><div class="chips">'+[["auto",T("Match my phone")],["light","Light"],["dark","Dark"]].map(function(t){return'<button class="chip" aria-pressed="'+(theme()===t[0])+'" data-act="theme" data-th="'+t[0]+'">'+esc(T(t[1]))+'</button>'}).join("")+'</div></section>'+
    (S.unlocked?'<section class="sec"><h2>'+T("Your account")+'</h2><div class="list"><div class="row"><div class="main"><span class="t">'+T("Download my data")+'</span><span class="s">'+T("A readable copy of everything you have entered")+'</span></div><button class="btn small ghost" data-act="export">'+T("Download")+'</button></div>'+
    '<div class="row"><div class="main"><span class="t">'+T("Sign out")+'</span><span class="s">'+T("Locks Tadbir on this device")+'</span></div><button class="btn small ghost" data-act="sign-out">'+T("Sign out")+'</button></div>'+
    '<div class="row"><div class="main"><span class="t">'+T("Delete my account")+'</span><span class="s">'+T("Removes your account and all of your data. This cannot be undone")+'</span></div><button class="btn small danger" data-act="delete-account">'+T("Delete")+'</button></div></div></section>':'');
}
function habitsFor(d){var wd=parse(d).getDay();return habits().filter(function(h){return!Array.isArray(h.days)||h.days.indexOf(wd)>=0})}
function dayDoc(d){return S.priv.find(function(x){return x.id==="h_"+d})||{done:{}}}
function entries(){
  var a=S.diary.map(function(e){return Object.assign({},e,{_priv:false})});
  S.priv.forEach(function(e){if(e.kind==="entry")a.push(Object.assign({},e,{_priv:true}))});
  return a;
}
function entriesOn(d){return entries().filter(function(e){return e.date===d}).sort(function(a,b){return(a.time||"99")<(b.time||"99")?-1:1})}
function scopes(){var s={Personal:1,Business:1};S.bills.concat(S.txns).forEach(function(x){if(x.scope)s[x.scope]=1});return Object.keys(s)}

function loans(){return S.priv.filter(function(x){return x.kind==="loan"})}
function loanPaid(l){return(l.payments||[]).reduce(function(s,p){return s+(+p.amount||0)},0)}
function loanLeft(l){return Math.max(0,(+l.amount||0)-loanPaid(l))}
function loanRow(l){
  var left=loanLeft(l),paid=loanPaid(l),st={cls:"",label:""};
  if(left<=0)st={cls:"good",label:T("Settled")};else if(l.due)st=billStatus({due:l.due});
  var pct=+l.amount?Math.min(100,Math.round(100*paid/l.amount)):0;
  return'<div class="row '+st.cls+'">'+badge("coins")+'<button class="main" data-act="edit-loan" data-id="'+esc(l.id)+'"><span class="t">'+esc(l.name)+'</span>'+
    '<span class="s">'+(l.direction==="owed"?T("Owes me"):T("I owe"))+' · '+T("{a} of {b} repaid",{a:money(paid),b:money(l.amount)})+'</span>'+
    (st.label?'<span><span class="pill '+st.cls+'">'+esc(st.label)+'</span></span>':'')+
    '<div class="ltrack"><i style="width:'+pct+'%"></i></div></button>'+
    '<div class="rcol"><span class="amt">'+money(left)+'</span>'+(left>0?'<button class="btn small" data-act="pay-loan" data-id="'+esc(l.id)+'">'+T("Repaid")+'</button>':'')+'</div></div>';
}
function viewLoans(){
  var ls=loans().sort(function(a,b){return(loanLeft(b)>0)-(loanLeft(a)>0)||((a.due||"9")<(b.due||"9")?-1:1)});
  var owe=0,owed=0;ls.forEach(function(l){if(l.direction==="owed")owed+=loanLeft(l);else owe+=loanLeft(l)});
  var h='<section class="sec"><div class="sec-head"><h2>'+T("Private loans")+'</h2>'+'<button class="btn small" data-act="add-loan">'+T("Add loan")+'</button>'+'</div>';
  h+='<div class="tiles two"><div class="tile"><span class="k">'+T("I still owe")+'</span><span class="v">'+money(owe)+'</span></div><div class="tile"><span class="k">'+T("Still owed to me")+'</span><span class="v">'+money(owed)+'</span></div></div>'+
    '<div class="list">'+(ls.length?ls.map(loanRow).join(""):emptyState("coins",T("No loans yet"),T("Keep track of money you have borrowed or lent, and what is left to repay."),"add-loan",T("Add a loan")))+'</div>'+
    '<p style="color:var(--muted);font-size:13px;margin:0">'+T("Loans are encrypted on your device like everything else, and they are kept out of your Money totals.")+'</p></section>';
  return h;
}
/* ---------- icons, empty states, charts ---------- */
var ICONS={home:"M4 11l8-7 8 7v9H4z M10 20v-6h4v6",bolt:"M13 3L5 14h6l-1 7 8-11h-6z",shield:"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  car:"M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4z M7.5 19v1.5M16.5 19v1.5",wrench:"M15 6a4 4 0 0 0-5 5l-6 6 2 2 6-6a4 4 0 0 0 5-5l-2.5 2.5-2-2z",
  alert:"M12 4l9 16H3z M12 10v4 M12 17v.5",bank:"M4 10l8-5 8 5z M6 10v8M10 10v8M14 10v8M18 10v8 M4 20h16",building:"M6 20V5h9v15 M15 10h4v10 M4 20h17 M9 9h3M9 13h3",
  coins:"M4 9a5 5 0 1 0 10 0a5 5 0 1 0-10 0 M14.5 10.5a5 5 0 1 1-4 8",repeat:"M5 9a7 7 0 0 1 12-3l2 2M19 4v4h-4 M19 15a7 7 0 0 1-12 3l-2-2M5 20v-4h4",
  dot:"M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",box:"M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8",drop:"M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z",
  food:"M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10 M16 3c-2 2-2 7 0 9v9",basket:"M4 10h16l-2 9H6z M8 10l4-6 4 6",
  users:"M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3 3-5 6-5s6 2 6 5 M17 11a3 3 0 1 0-1-5.8 M18 15c2 .6 3 2.2 3 5",tag:"M4 12V4h8l8 8-8 8z M8.5 8.5v.01",
  wallet:"M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z M4 7V6a2 2 0 0 1 2-2h10 M16 13.5v.01",plus:"M12 5v14M5 12h14",
  receipt:"M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6M9 12h6",chart:"M4 19V9M10 19V5M16 19v-7M21 19H3",calendar:"M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18M8 3v4M16 3v4",
  lock:"M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M8 11V8a4 4 0 0 1 8 0v3",moon:"M19 14a8 8 0 1 1-9-10 6.5 6.5 0 0 0 9 10z",
  sliders:"M4 7h10M18 7h2M4 17h2M10 17h10 M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0",bell:"M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0"};
var CAT_ICON={"Rent":"home","Utilities":"bolt","Insurance":"shield","Road tax":"car","MOT":"wrench","PCN / fine":"alert","HMRC":"bank","Council tax":"building","Loan / finance":"coins","Subscription":"repeat","Other":"dot","Stock":"box","Fuel":"drop","Food":"food","Household":"basket","Wages paid":"users","Sales":"tag","Wages":"wallet","Other income":"plus","Vehicle tax":"car","Vehicle test":"wrench","Fine":"alert","Tax":"bank"};
var MOD_ICON={bills:"receipt",money:"chart",diary:"calendar",loans:"lock",ibadah:"moon"};
function icon(n){return'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="'+(ICONS[n]||ICONS.dot)+'"/></svg>'}
function badge(n,cls){return'<span class="badge '+(cls||"")+'">'+icon(n)+'</span>'}
function emptyState(ic,title,text,act,label,attrs){return'<div class="estate">'+badge(ic,"big")+'<b>'+esc(title)+'</b><span>'+esc(text)+'</span>'+(act?'<button class="btn small" data-act="'+act+'"'+(attrs||"")+'>'+esc(label)+'</button>':'')+'</div>'}
var CHART_COLORS=["var(--s-business)","var(--s-faith)","var(--s-personal)","var(--s-volunteering)","var(--s-development)","var(--muted)"];
function donut(cl,total){
  var top=cl.slice(0,5),rest=cl.slice(5).reduce(function(s,c){return s+c[1]},0);if(rest>0)top.push([T("Everything else"),rest]);
  var C=2*Math.PI*40,off=0,segs="";
  top.forEach(function(c,i){var len=C*c[1]/total;segs+='<circle cx="60" cy="60" r="40" fill="none" stroke="'+CHART_COLORS[i]+'" stroke-width="18" stroke-dasharray="'+Math.max(0,len-1.5).toFixed(2)+' '+(C-Math.max(0,len-1.5)).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 60 60)"/>';off+=len});
  return'<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="'+T("Spending by category")+'"><circle cx="60" cy="60" r="40" fill="none" stroke="var(--line)" stroke-width="18"/>'+segs+
    '<text x="60" y="57" text-anchor="middle" class="dn-k">'+T("Spent")+'</text><text x="60" y="72" text-anchor="middle" class="dn-v">'+esc(money(Math.round(total)))+'</text></svg>'+
    '<ul>'+top.map(function(c,i){return'<li><i style="background:'+CHART_COLORS[i]+'"></i><span>'+esc(T(c[0]))+'</span><b>'+money(c[1])+'</b><em>'+Math.round(100*c[1]/total)+'%</em></li>'}).join("")+'</ul></div>';
}
function trend(m,scope){
  var ms=[],max=0;for(var i=5;i>=0;i--){var d=new Date(m.getFullYear(),m.getMonth()-i,1),inn=0,out=0;
    S.txns.forEach(function(x){if(inMonth(x.date,d)&&(scope==="All"||(x.scope||"Personal")===scope)){if(x.type==="in")inn+=+x.amount||0;else out+=+x.amount||0}});
    ms.push({l:d.toLocaleDateString(LOC(),{month:"short"}),inn:inn,out:out});max=Math.max(max,inn,out)}
  if(!max)return"";
  var W=320,H=150,base=118,top=18,gw=W/6,bw=16,bars="";
  ms.forEach(function(x,i){var cx=gw*i+gw/2,hi=(base-top)*x.inn/max,ho=(base-top)*x.out/max;
    bars+='<rect x="'+(cx-bw-2)+'" y="'+(base-hi).toFixed(1)+'" width="'+bw+'" height="'+Math.max(hi,x.inn?2:0).toFixed(1)+'" rx="4" fill="var(--accent)"><title>'+esc(x.l+" in "+money(x.inn))+'</title></rect>'+
      '<rect x="'+(cx+2)+'" y="'+(base-ho).toFixed(1)+'" width="'+bw+'" height="'+Math.max(ho,x.out?2:0).toFixed(1)+'" rx="4" fill="var(--s-volunteering)"><title>'+esc(x.l+" out "+money(x.out))+'</title></rect>'+
      '<text x="'+cx+'" y="'+(base+16)+'" text-anchor="middle" class="tr-l">'+esc(x.l)+'</text>'});
  return'<section class="sec"><div class="sec-head"><h2>'+T("Last 6 months")+'</h2><div class="legend"><span><span class="dot" style="background:var(--accent)"></span>'+T("In")+'</span><span><span class="dot" style="background:var(--s-volunteering)"></span>'+T("Out")+'</span></div></div>'+
    '<div class="list" style="padding:10px 8px 4px"><svg viewBox="0 0 '+W+' '+H+'" class="trend" role="img" aria-label="'+T("Money in and out for the last six months")+'">'+
    '<line x1="0" x2="'+W+'" y1="'+top+'" y2="'+top+'" class="tr-g"/><line x1="0" x2="'+W+'" y1="'+((base+top)/2)+'" y2="'+((base+top)/2)+'" class="tr-g"/><line x1="0" x2="'+W+'" y1="'+base+'" y2="'+base+'" class="tr-b"/>'+
    '<text x="2" y="'+(top-5)+'" class="tr-l">'+esc(money(Math.round(max)))+'</text>'+bars+'</svg></div></section>';
}

/* ---------- row builders ---------- */
function billRow(b){var st=billStatus(b);
  var sub=[esc(T(b.category||"Bill")),esc(T(b.scope||"Personal"))];
  if(b.repeat&&b.repeat!=="none")sub.push(esc(T((REPEATS.find(function(r){return r[0]===b.repeat})||[0,""])[1])));
  if(b.lastPaid)sub.push(T("Last paid {d}",{d:fmtDate(b.lastPaid)}));
  return'<div class="row '+st.cls+'">'+badge(CAT_ICON[b.category]||"receipt")+
    '<button class="main" data-act="edit-bill" data-id="'+esc(b.id)+'"><span class="t">'+esc(b.name)+'</span>'+
    '<span class="s">'+sub.join(" · ")+'</span><span><span class="pill '+st.cls+'">'+esc(st.label)+'</span></span></button>'+
    '<div class="rcol"><span class="amt">'+(b.amount?money(b.amount):'<span class="s">'+T("No amount")+'</span>')+'</span>'+
    (b.paid?'':'<button class="btn small" data-act="pay" data-id="'+esc(b.id)+'">'+T("Mark paid")+'</button>')+'</div></div>';
}
function entryRow(e,showDate){
  return'<div class="row e-'+esc(e.section)+(e.done?" done":"")+'">'+
    '<button class="check" aria-pressed="'+(e.done?"true":"false")+'" aria-label="'+T("Mark done")+'" data-act="tick-entry" data-id="'+esc(e.id)+'" data-priv="'+(e._priv?1:0)+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>'+
    '<button class="main" data-act="edit-entry" data-id="'+esc(e.id)+'" data-priv="'+(e._priv?1:0)+'"><span class="t">'+esc(e.title)+'</span>'+
    '<span class="s"><span class="dot d-'+esc(e.section)+'"></span> '+esc(T(e.section))+(showDate?" · "+fmtDate(e.date,true):"")+(e.time?" · "+esc(e.time):"")+(e.notes?" · "+esc(e.notes):"")+'</span></button></div>';
}

/* ---------- views ---------- */
function viewToday(){
  var t=today(),ob=has("bills")?openBills():[],h="";
  var overdue=ob.filter(function(b){return b.due<t});
  var soon=ob.filter(function(b){return b.due>=t&&daysBetween(t,b.due)<=7});
  var soonSum=soon.reduce(function(s,b){return s+(+b.amount||0)},0);
  var dueLoans=has("loans")?loans().filter(function(l){return l.due&&loanLeft(l)>0&&daysBetween(t,l.due)<=7}):[];
  var hr=new Date().getHours(),greet=hr<12?T("Good morning"):hr<18?T("Good afternoon"):T("Good evening");
  h+='<section class="sec">';
  if(has("money")){
    var m=first(new Date()),inn=0,out=0;
    S.txns.forEach(function(x){if(inMonth(x.date,m)){if(x.type==="in")inn+=+x.amount||0;else out+=+x.amount||0}});
    var pct=inn?Math.min(100,Math.round(100*out/inn)):0;
    h+='<div class="hero"><span class="k">'+greet+' · '+esc(monthLabel(m))+'</span>'+
      '<span class="big">'+money(inn-out)+'</span><span class="cap">'+(inn||out?T("left over this month"):T("Add your income and spending to see what you keep"))+'</span>'+
      '<div class="meter"><i style="width:'+pct+'%"></i></div>'+
      '<div class="split"><div><b>'+money(inn)+'</b><span>'+T("In")+'</span></div><div><b>'+money(out)+'</b><span>'+T("Out")+'</span></div>'+(inn?'<div><b>'+pct+'%</b><span>'+T("of income spent")+'</span></div>':'')+'</div></div>';
  }else h+='<p class="lead">'+greet+'</p>';
  if(has("bills"))h+='<div class="tiles two"><div class="tile'+(overdue.length?" crit":"")+'"><span class="k">'+T("Overdue")+'</span><span class="v">'+overdue.length+'</span><span class="n">'+(overdue.length?T("Pay these first"):T("Nothing late"))+'</span></div>'+
    '<div class="tile"><span class="k">'+T("Due in 7 days")+'</span><span class="v">'+money(soonSum)+'</span><span class="n">'+T("{n} payments",{n:soon.length})+'</span></div></div>';
  h+='</section>';
  var attention=overdue.concat(soon);
  if(has("bills")||dueLoans.length)h+='<section class="sec"><div class="sec-head"><h2>'+T("Payments needing attention")+'</h2>'+(has("bills")?'<button class="btn small ghost" data-act="add-bill">'+T("Add bill")+'</button>':'')+'</div><div class="list">'+
    (attention.length||dueLoans.length?attention.map(billRow).join("")+dueLoans.map(loanRow).join(""):'<div class="empty">'+T("No payments due in the next 7 days.")+(ob[0]?" "+T("Next: {name} on {date}.",{name:esc(ob[0].name),date:fmtDate(ob[0].due)}):"")+'</div>')+'</div></section>';
  if(has("diary")){
    var es=entriesOn(t);
    h+='<section class="sec"><div class="sec-head"><h2>'+T("Today's diary")+'</h2><button class="btn small ghost" data-act="add-entry" data-date="'+t+'">'+T("Add entry")+'</button></div><div class="list">'+
      (es.length?es.map(function(e){return entryRow(e)}).join(""):emptyState("calendar",T("A clear day"),T("Add an appointment, a job or a task for today."),"add-entry",T("Add entry"),' data-date="'+t+'"'))+'</div></section>';
    var late=entries().filter(function(e){return e.date<t&&!e.done}).sort(function(a,b){return a.date<b.date?-1:1}).slice(0,15);
    if(late.length)h+='<section class="sec"><div class="sec-head"><h2>'+T("Outstanding tasks")+'</h2><span class="pill warn">'+T("{n} not done",{n:late.length})+'</span></div><div class="list">'+late.map(function(e){return entryRow(e,true)}).join("")+'</div></section>';
    var tm=entriesOn(addDays(t,1));
    if(tm.length)h+='<section class="sec"><h2>'+T("Tomorrow")+'</h2><div class="list">'+tm.map(function(e){return entryRow(e)}).join("")+'</div></section>';
  }
  if(has("ibadah"))h+=checklist(t);
  return h;
}
function checklist(d){
  var hs=habitsFor(d),doc=dayDoc(d),done=doc.done||{};
  var count=hs.filter(function(x){return done[x.id]}).length;
  var week="";for(var i=6;i>=0;i--){var dd=addDays(d,-i),dn=dayDoc(dd).done||{},hd=habitsFor(dd);
    var f=hd.length?Math.round(100*hd.filter(function(x){return dn[x.id]}).length/hd.length):0;
    week+='<div><i style="--f:'+f+'%" title="'+f+'%"></i>'+parse(dd).toLocaleDateString(LOC(),{weekday:"narrow"})+'</div>'}
  var h='<section class="sec"><div class="sec-head"><h2>'+T("Ibadah")+(LANG==="en"?'<span class="ar-s" lang="ar" dir="rtl">عبادة</span>':'')+'</h2><div class="week" aria-label="'+T("Last 7 days")+'">'+week+'</div></div>';
  h+='<div class="list">'+hs.map(function(x){var on=!!done[x.id];
    return'<div class="row'+(on?" done":"")+'"><button class="check" aria-pressed="'+on+'" aria-label="'+esc(x.name)+'" data-act="tick-habit" data-id="'+esc(x.id)+'" data-date="'+d+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button><div class="main"><span class="t">'+esc(T(x.name))+'</span>'+(x.days?'<span class="s">'+T("Every Friday")+'</span>':'')+'</div></div>'}).join("")+
    '<div class="row foot"><svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="'+(hs.length?100.5*count/hs.length:0).toFixed(1)+' 100.5"/></svg><div class="main"><span class="t">'+T("{a} of {b} done",{a:count,b:hs.length})+'</span><span class="s">'+T("Encrypted on your device")+'</span></div>'+'<!--'+'-->'+
    '<button class="btn small ghost" data-act="edit-habits">'+T("Edit list")+'</button><button class="btn small ghost" data-act="day-note" data-date="'+d+'">'+(doc.note?T("Edit note"):T("Add note"))+'</button></div>'+
    (doc.note?'<div class="row"><div class="main"><span class="s">'+esc(doc.note)+'</span></div></div>':'')+'</div></section>';
  return h;
}
function viewBills(){
  var list=S.billFilter==="paid"?S.bills.filter(function(b){return b.paid}).sort(function(a,b){return(b.paidOn||"")<(a.paidOn||"")?-1:1}):openBills();
  var total=openBills().reduce(function(s,b){return s+(+b.amount||0)},0);
  return'<section class="sec"><div class="sec-head"><h2>'+T("Bills and deadlines")+'</h2><button class="btn small" data-act="add-bill">'+T("Add bill")+'</button></div>'+
    '<div class="chips"><button class="chip" aria-pressed="'+(S.billFilter==="open")+'" data-act="bill-filter" data-f="open">To pay · '+money(total)+'</button>'+
    '<button class="chip" aria-pressed="'+(S.billFilter==="paid")+'" data-act="bill-filter" data-f="paid">'+T("Paid one-offs")+'</button></div>'+
    '<div class="list">'+(list.length?list.map(billRow).join(""):(S.billFilter==="paid"?emptyState("receipt",T("Nothing here yet"),T("One-off bills you have paid will be listed here.")):emptyState("receipt",T("Add your first bill"),T("Rent, insurance, road tax, a PCN: anything with a date you must not miss."),"add-bill",T("Add a bill"))))+'</div>'+
    '<p class="s" style="color:var(--muted);font-size:13px;margin:0">'+T("Marking a repeating bill as paid moves it to its next due date and records the payment under Money, so you can see it has been paid once.")+'</p></section>';
}
function viewMoney(){
  var m=S.moneyMonth,sc=scopes();
  var tx=S.txns.filter(function(x){return inMonth(x.date,m)&&(S.scope==="All"||(x.scope||"Personal")===S.scope)}).sort(function(a,b){return a.date<b.date?1:-1});
  var inn=0,out=0,cats={};
  tx.forEach(function(x){var a=+x.amount||0;if(x.type==="in")inn+=a;else{out+=a;cats[x.category||"Other"]=(cats[x.category||"Other"]||0)+a}});
  var cl=Object.keys(cats).map(function(k){return[k,cats[k]]}).sort(function(a,b){return b[1]-a[1]}),max=cl.length?cl[0][1]:1;
  var h='<section class="sec"><div class="sec-head"><h2>'+T("Money")+'</h2><div class="monthnav"><button class="iconbtn" data-act="money-prev" aria-label="'+T("Previous month")+'">‹</button><b>'+esc(monthLabel(m))+'</b><button class="iconbtn" data-act="money-next" aria-label="'+T("Next month")+'">›</button></div></div>'+
    '<div class="chips">'+["All"].concat(sc).map(function(s){return'<button class="chip" aria-pressed="'+(S.scope===s)+'" data-act="scope" data-s="'+esc(s)+'">'+esc(T(s))+'</button>'}).join("")+'</div>'+
    '<div class="tiles"><div class="tile"><span class="k">'+T("In")+'</span><span class="v">'+money(inn)+'</span></div><div class="tile"><span class="k">'+T("Out")+'</span><span class="v">'+money(out)+'</span></div>'+
    '<div class="tile wide'+(inn-out<0?" crit":"")+'"><span class="k">'+T("Left over")+'</span><span class="v">'+money(inn-out)+'</span><span class="n">'+(inn?T("{n}% of income",{n:Math.round(100*(inn-out)/inn)}):T("Add your income to see what you keep"))+'</span></div></div>'+
    '<div class="actions"><button class="btn" data-act="add-txn" data-type="in">'+T("Add income")+'</button><button class="btn ghost" data-act="add-txn" data-type="out">'+T("Add spending")+'</button></div></section>';
  h+=trend(m,S.scope);
  h+='<section class="sec"><h2>'+T("Where it went")+'</h2><div class="list">'+(cl.length?donut(cl,out):emptyState("chart",T("No spending this month"),T("Add what you spend and you will see where it goes."),"add-txn",T("Add spending"),' data-type="out"'))+'</div></section>';
  h+='<section class="sec"><h2>'+T("Entries")+'</h2><div class="list">'+(tx.length?tx.map(function(x){
    return'<div class="row">'+badge(CAT_ICON[x.category]||(x.type==="in"?"plus":"dot"))+'<button class="main" data-act="edit-txn" data-id="'+esc(x.id)+'"><span class="t">'+esc(x.note||T(x.category||"Entry"))+'</span><span class="s">'+fmtDate(x.date)+" · "+esc(T(x.scope||"Personal"))+'</span></button><span class="amt '+(x.type==="in"?"in":"")+'">'+(x.type==="in"?"+":"-")+money(x.amount)+'</span></div>'}).join(""):'<div class="empty">'+T("Nothing recorded for this month.")+'</div>')+'</div></section>';
  return h;
}
function viewDiary(){
  var m=S.calMonth,y=m.getFullYear(),mo=m.getMonth(),days=new Date(y,mo+1,0).getDate(),lead=(m.getDay()+6)%7,t=today();
  var byDay={};entries().forEach(function(e){if(inMonth(e.date,m))(byDay[e.date]=byDay[e.date]||[]).push(e.section)});
  var billDay={};S.bills.forEach(function(b){if(!b.paid&&inMonth(b.due,m))billDay[b.due]=1});
  var h='<section class="sec"><div class="sec-head"><h2>'+T("Diary")+'</h2><div class="monthnav"><button class="iconbtn" data-act="cal-prev" aria-label="'+T("Previous month")+'">‹</button><b>'+esc(monthLabel(m))+'</b><button class="iconbtn" data-act="cal-next" aria-label="'+T("Next month")+'">›</button></div></div><div class="cal">';
  for(var wi=1;wi<=7;wi++)h+='<div class="wd">'+esc(new Date(2024,0,wi).toLocaleDateString(LOC(),{weekday:"narrow"}))+'</div>';
  for(var i=0;i<lead;i++)h+='<div></div>';
  for(var d=1;d<=days;d++){var ds=y+"-"+pad(mo+1)+"-"+pad(d),dots="";
    if(billDay[ds])dots+='<span class="dot d-bill"></span>';
    var seen={};(byDay[ds]||[]).forEach(function(s){if(!seen[s]){seen[s]=1;dots+='<span class="dot d-'+esc(s)+'"></span>'}});
    h+='<button class="'+(ds===t?"today ":"")+(ds===S.selDay?"sel":"")+'" data-act="pick-day" data-date="'+ds+'" aria-label="'+esc(fmtDate(ds,true))+'"><span class="num">'+d+'</span><span class="dots">'+dots+'</span></button>'}
  h+='</div><div class="legend">'+secs().map(function(s){return'<span><span class="dot d-'+s+'"></span>'+esc(T(s))+'</span>'}).join("")+'<span><span class="dot d-bill"></span>'+T("Payment due")+'</span></div></section>';
  var es=entriesOn(S.selDay),bs=S.bills.filter(function(b){return!b.paid&&b.due===S.selDay});
  h+='<section class="sec"><div class="sec-head"><h2>'+esc(fmtDate(S.selDay,true))+'</h2><button class="btn small" data-act="add-entry" data-date="'+S.selDay+'">'+T("Add entry")+'</button></div><div class="list">'+
    bs.map(billRow).join("")+es.map(entryRow).join("")+((bs.length||es.length)?"":emptyState("calendar",T("Nothing on this day"),T("Add an appointment, a job or a note."),"add-entry",T("Add entry"),' data-date="'+S.selDay+'"'))+'</div></section>';
  if(S.selDay<=t&&has("ibadah"))h+=checklist(S.selDay);
  return h;
}
function render(){
  $("dateline").textContent=new Date().toLocaleDateString(LOC(),{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  $("gear").style.display=S.screen?"none":"";
  if(S.screen){document.querySelector("nav.tabs").style.display="none";$("view").style.cssText="display:flex;flex-direction:column;gap:22px";$("view").innerHTML=viewAuth();return}
  var setup=needsSetup()||S.editMods;
  document.querySelector("nav.tabs").style.display=setup?"none":"";
  $("view").style.cssText="display:flex;flex-direction:column;gap:22px";
  if(setup){$("view").innerHTML=viewSetup();return}
  var v=S.view;if(v!=="today"&&!has(v))v="today";
  document.querySelectorAll("nav.tabs a").forEach(function(a){a.style.display=(a.dataset.v==="today"||has(a.dataset.v))?"":"none"});
  $("view").innerHTML=v==="bills"?viewBills():v==="money"?viewMoney():v==="diary"?viewDiary():v==="loans"?viewLoans():viewToday();
  if(S.pop){var pe=$("view").querySelector('[data-act="'+S.pop.a+'"][data-id="'+CSS.escape(S.pop.id)+'"][aria-pressed="true"]');if(pe)pe.classList.add("pop");S.pop=null}
  $("view").style.cssText="display:flex;flex-direction:column;gap:22px";
  document.querySelectorAll("nav.tabs a").forEach(function(a){a.classList.toggle("on",a.dataset.v===v)});
}

/* ---------- sheet (forms) ---------- */
var sheetCtx=null;
function field(f,val){
  var id="f-"+f.id,v=val==null?"":val;
  if(f.type==="select")return'<label class="field" for="'+id+'">'+esc(T(f.label))+'<select id="'+id+'">'+f.options.map(function(o){var k=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;return'<option value="'+esc(k)+'"'+(k===v?" selected":"")+'>'+esc(T(l))+'</option>'}).join("")+'</select></label>';
  if(f.type==="textarea")return'<label class="field" for="'+id+'">'+esc(T(f.label))+'<textarea id="'+id+'">'+esc(v)+'</textarea></label>';
  if(f.type==="checkbox")return'<label class="field inline" for="'+id+'"><input type="checkbox" id="'+id+'"'+(v?" checked":"")+'>'+esc(T(f.label))+'</label>';
  var extra=f.type==="number"?' inputmode="decimal" step="0.01" min="0"':"";
  if(f.list)extra+=' list="'+id+'-l"';
  return'<label class="field" for="'+id+'">'+esc(T(f.label))+'<input type="'+f.type+'" id="'+id+'" value="'+esc(v)+'"'+extra+'>'+
    (f.list?'<datalist id="'+id+'-l">'+f.list.map(function(o){return'<option value="'+esc(o)+'">'}).join("")+'</datalist>':'')+'</label>';
}
function openSheet(title,fields,init,onSave,onDelete){
  sheetCtx={fields:fields,onSave:onSave,onDelete:onDelete};
  $("sheettitle").textContent=T(title);
  $("sheetform").innerHTML=fields.map(function(f){return field(f,init[f.id])}).join("")+
    '<div class="actions"><button type="submit" class="btn">'+T("Save")+'</button><button type="button" class="btn ghost" data-act="close-sheet">'+T("Cancel")+'</button>'+
    (onDelete?'<button type="button" class="btn danger" data-act="delete-sheet">'+T("Delete")+'</button>':'')+'</div>';
  $("sheetbg").classList.add("open");
  var firstInput=$("sheetform").querySelector("input,select,textarea");if(firstInput)firstInput.focus();
}
function closeSheet(){$("sheetbg").classList.remove("open");sheetCtx=null}
$("sheetform").addEventListener("submit",function(e){
  e.preventDefault();if(!sheetCtx)return;var out={},bad=null;
  sheetCtx.fields.forEach(function(f){var el=$("f-"+f.id);
    out[f.id]=f.type==="checkbox"?el.checked:f.type==="number"?(el.value===""?0:Math.abs(parseFloat(el.value))||0):el.value.trim();
    if(f.required&&!out[f.id]&&!bad)bad=f});
  if(bad){toast(T("Fill in: ")+T(bad.label));$("f-"+bad.id).focus();return}
  var fn=sheetCtx.onSave;closeSheet();fn(out);
});
$("sheetbg").addEventListener("click",function(e){
  if(e.target===$("sheetbg"))return closeSheet();
  var b=e.target.closest("[data-act]");if(!b)return;
  if(b.dataset.act==="close-sheet")closeSheet();
  if(b.dataset.act==="delete-sheet"&&sheetCtx){
    if(b.dataset.sure){var fn=sheetCtx.onDelete;closeSheet();fn()}else{b.dataset.sure="1";b.textContent=T("Tap again to delete")}}
});
$("sheetform").addEventListener("change",function(e){
  if(e.target.id==="f-section"&&$("f-priv"))$("f-priv").checked=!!PRIVATE_BY_DEFAULT[e.target.value];
  if(e.target.id==="f-category"&&$("f-repeat")&&(e.target.value==="PCN / fine"||e.target.value==="Fine"))$("f-repeat").value="none";
  if(e.target.id==="f-type"&&$("f-category")){var cats=e.target.value==="in"?IN_CATS:outCats();
    $("f-category").innerHTML=cats.map(function(c){return'<option value="'+esc(c)+'">'+esc(T(c))+'</option>'}).join("")}
});

function billForm(b){
  var isNew=!b;b=b||{name:"",amount:"",due:today(),repeat:"monthly",category:"Rent",scope:"Personal",notes:""};
  openSheet(isNew?T("Add a bill"):T("Edit bill"),[
    {id:"name",label:T("What is it for"),type:"text",required:true},
    {id:"amount",label:T("Amount, leave empty if not known yet"),type:"number"},
    {id:"due",label:T("Due date"),type:"date",required:true},
    {id:"repeat",label:T("How often"),type:"select",options:REPEATS},
    {id:"category",label:"Type",type:"select",options:billCats()},
    {id:"scope",label:T("Personal or which business"),type:"text",list:scopes()},
    {id:"notes",label:T("Notes (reference number, vehicle reg, how to pay)"),type:"textarea"}
  ],b,function(o){
    var rec=Object.assign(strip(b),o);if(!rec.scope)rec.scope="Personal";
    save("bills",isNew?newId():b.id,rec);
  },isNew?null:function(){remove("bills",b.id)});
}
function payBill(b){
  var t=today();
  if(b.lastPaid&&daysBetween(b.lastPaid,t)<5&&!payBill.confirm){payBill.confirm=b.id;toast(T("{name} was marked paid on {date}. Tap Mark paid again if this is a new payment.",{name:b.name,date:fmtDate(b.lastPaid)}));return}
  if(payBill.confirm&&payBill.confirm!==b.id&&b.lastPaid&&daysBetween(b.lastPaid,t)<5){payBill.confirm=b.id;toast(T("{name} was marked paid on {date}. Tap Mark paid again if this is a new payment.",{name:b.name,date:fmtDate(b.lastPaid)}));return}
  payBill.confirm=null;
  var rec=strip(b);rec.lastPaid=t;
  if(b.repeat&&b.repeat!=="none")rec.due=nextDue(b.due,b.repeat);else{rec.paid=true;rec.paidOn=t}
  save("bills",b.id,rec);
  if(+b.amount)save("txns",newId(),{date:t,type:"out",amount:+b.amount,category:b.category||"Other",scope:b.scope||"Personal",note:b.name,billId:b.id});
  toast(rec.paid?T("{name} marked paid.",{name:b.name}):T("{name} marked paid. Next due {date}.",{name:b.name,date:fmtDate(rec.due)}));
}
function txnForm(x,type){
  var isNew=!x;x=x||{type:type||"out",amount:"",date:today(),category:type==="in"?"Sales":"Other",scope:S.scope==="All"?"Personal":S.scope,note:""};
  openSheet(isNew?(x.type==="in"?T("Add income"):T("Add spending")):T("Edit entry"),[
    {id:"type",label:T("Money in or out"),type:"select",options:[["in",T("Money in")],["out",T("Money out")]]},
    {id:"amount",label:T("Amount"),type:"number",required:true},
    {id:"date",label:"Date",type:"date",required:true},
    {id:"category",label:"Category",type:"select",options:x.type==="in"?IN_CATS:outCats()},
    {id:"scope",label:T("Personal or which business"),type:"text",list:scopes()},
    {id:"note",label:T("What was it"),type:"text"}
  ],x,function(o){var rec=Object.assign(strip(x),o);if(!rec.scope)rec.scope="Personal";save("txns",isNew?newId():x.id,rec)},
  isNew?null:function(){remove("txns",x.id)});
}
function entryForm(e,date){
  var isNew=!e;e=e||{title:"",date:date||today(),time:"",section:"Business",notes:"",_priv:false};
  var fields=[
    {id:"title",label:T("What (appointment, job or task)"),type:"text",required:true},
    {id:"section",label:"Area",type:"select",options:secs()},
    {id:"date",label:"Date",type:"date",required:true},
    {id:"time",label:T("Time (optional)"),type:"time"},
    {id:"notes",label:"Notes",type:"textarea"}];
  var init=Object.assign({},e,{priv:e._priv});
  openSheet(isNew?T("Add diary entry"):T("Edit diary entry"),fields,init,function(o){
    var toPriv=!!o.priv&&!!S.uid;delete o.priv;
    var rec=Object.assign(strip(e),o);var id=isNew?newId():e.id;
    if(toPriv){rec.kind="entry"}else{delete rec.kind}
    if(!isNew&&e._priv!==toPriv)remove(e._priv?"priv":"diary",e.id);
    save(toPriv?"priv":"diary",id,rec);
  },isNew?null:function(){remove(e._priv?"priv":"diary",e.id)});
}
function loanForm(l){
  var isNew=!l;l=l||{name:"",direction:"owe",amount:"",due:"",notes:"",payments:[]};
  openSheet(isNew?T("Add a private loan"):T("Edit loan"),[
    {id:"name",label:T("Who is it with"),type:"text",required:true},
    {id:"direction",label:"Direction",type:"select",options:[["owe",T("I owe them")],["owed",T("They owe me")]]},
    {id:"amount",label:T("Total amount"),type:"number",required:true},
    {id:"due",label:T("Repay by (optional)"),type:"date"},
    {id:"notes",label:T("Notes (terms, what was agreed)"),type:"textarea"}
  ],l,function(o){var rec=Object.assign(strip(l),o);rec.kind="loan";rec.payments=(l.payments||[]).slice();save("priv",isNew?"loan_"+newId():l.id,rec)},
  isNew?null:function(){remove("priv",l.id)});
}
function loanPayForm(l){
  openSheet(T("Record a repayment"),[
    {id:"amount",label:T("Amount repaid, ")+money(loanLeft(l))+" left",type:"number",required:true},
    {id:"date",label:"Date",type:"date",required:true}
  ],{amount:"",date:today()},function(o){var rec=strip(l);rec.payments=(l.payments||[]).concat([{date:o.date,amount:o.amount}]);save("priv",l.id,rec)});
}
function habitsForm(){
  openSheet(T("Edit daily checklist"),[{id:"list",label:T("One item per line. End a line with (Fridays) to show it on Fridays only."),type:"textarea",required:true}],
    {list:habits().map(function(h){return h.name+(h.days?" (Fridays)":"")}).join("\n")},function(o){
      var old=habits(),seen={};
      var list=o.list.split("\n").map(function(s){return s.trim()}).filter(Boolean).slice(0,20).map(function(name){
        var fri=/\(fridays?\)\s*$/i.test(name);name=name.replace(/\s*\(fridays?\)\s*$/i,"")||"Item";
        var ex=old.find(function(h){return h.name.toLowerCase()===name.toLowerCase()});
        var id=ex?ex.id:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||newId();
        while(seen[id])id+="x";seen[id]=1;var o={id:id,name:name};if(fri)o.days=[5];return o});
      if(list.length)save("priv","config",{kind:"config",habits:list});
    });
  $("f-list").style.minHeight="180px";
}
function noteForm(d){
  var doc=dayDoc(d);
  openSheet(T("Note for ")+fmtDate(d),[{id:"note",label:T("For example how much you read today"),type:"textarea"}],{note:doc.note||""},function(o){
    save("priv","h_"+d,{kind:"day",date:d,done:Object.assign({},doc.done||{}),note:o.note});
  });
}

/* ---------- actions ---------- */
$("view").addEventListener("click",function(e){
  var b=e.target.closest("[data-act]");if(!b)return;var a=b.dataset.act,id=b.dataset.id;
  if(a==="tick-habit"||a==="tick-entry")S.pop={a:a,id:id};
  if(a==="add-bill")billForm();
  else if(a==="edit-bill"){var bl=S.bills.find(function(x){return x.id===id});if(bl)billForm(bl)}
  else if(a==="pay"){var pb=S.bills.find(function(x){return x.id===id});if(pb)payBill(pb)}
  else if(a==="bill-filter"){S.billFilter=b.dataset.f;render()}
  else if(a==="add-txn")txnForm(null,b.dataset.type);
  else if(a==="edit-txn"){var tx=S.txns.find(function(x){return x.id===id});if(tx)txnForm(tx)}
  else if(a==="scope"){S.scope=b.dataset.s;render()}
  else if(a==="money-prev"||a==="money-next"){S.moneyMonth=new Date(S.moneyMonth.getFullYear(),S.moneyMonth.getMonth()+(a==="money-next"?1:-1),1);render()}
  else if(a==="cal-prev"||a==="cal-next"){S.calMonth=new Date(S.calMonth.getFullYear(),S.calMonth.getMonth()+(a==="cal-next"?1:-1),1);render()}
  else if(a==="pick-day"){S.selDay=b.dataset.date;render()}
  else if(a==="add-entry")entryForm(null,b.dataset.date);
  else if(a==="edit-entry"||a==="tick-entry"){
    var en=entries().find(function(x){return x.id===id&&x._priv===(b.dataset.priv==="1")});if(!en)return;
    if(a==="edit-entry")entryForm(en);
    else{var rec=strip(en);rec.done=!en.done;save(en._priv?"priv":"diary",en.id,rec)}}
  else if(a==="tick-habit"){var d=b.dataset.date,doc=dayDoc(d),done=Object.assign({},doc.done||{});
    if(done[id])delete done[id];else done[id]=true;
    save("priv","h_"+d,{kind:"day",date:d,done:done,note:doc.note||""})}
  else if(a==="toggle-mod"){if($("set-country"))S.pickCountry=$("set-country").value;S.pick[id]=S.pick[id]?0:1;render()}
  else if(a==="save-mods"){var list=MODULES.map(function(m){return m[0]}).filter(function(k){return S.pick[k]});
    var rec={kind:"settings",modules:list,country:$("set-country")?$("set-country").value:country()[0]};S.pickCountry=null;S.priv=S.priv.filter(function(x){return x.id!=="settings"}).concat([Object.assign({id:"settings"},rec)]);
    S.editMods=false;S.pick=null;save("priv","settings",rec);render();window.scrollTo(0,0)}
  else if(a==="edit-habits")habitsForm();
  else if(a==="add-loan")loanForm();
  else if(a==="edit-loan"||a==="pay-loan"){var ln=loans().find(function(x){return x.id===id});if(!ln)return;if(a==="edit-loan")loanForm(ln);else loanPayForm(ln)}
  else if(a==="day-note")noteForm(b.dataset.date);
});
$("gear").addEventListener("click",function(){S.editMods=!S.editMods;S.pick=null;render();window.scrollTo(0,0)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&sheetCtx)closeSheet()});

/* ---------- touch feedback ---------- */
document.addEventListener("pointerdown",function(e){
  var t=e.target.closest("button,nav.tabs a");if(!t||t.disabled)return;
  if(window.matchMedia("(prefers-reduced-motion:reduce)").matches)return;
  var r=document.createElement("span");r.className="ripple";r.style.left=e.clientX+"px";r.style.top=e.clientY+"px";
  document.body.appendChild(r);r.addEventListener("animationend",function(){r.remove()});
  if(navigator.vibrate)try{navigator.vibrate(8)}catch(x){}
});

/* ---------- routing ---------- */
function route(){var h=(location.hash||"").replace("#","");S.view=["today","bills","money","diary","loans"].indexOf(h)>=0?h:"today";render();window.scrollTo(0,0);var v=$("view");v.classList.remove("enter");void v.offsetWidth;v.classList.add("enter")}
window.addEventListener("hashchange",route);

/* ---------- accounts ---------- */
function note(msg){var n=$("notice");if(msg){n.textContent=msg;n.hidden=false}else n.hidden=true}
function here(){return location.origin+location.pathname}
function authField(id,label,type,auto){return'<label class="field" for="f-'+id+'">'+esc(T(label))+'<input type="'+type+'" id="f-'+id+'" autocomplete="'+auto+'" value="'+(id==="email"?esc(S.authEmail||""):"")+'"></label>'}
function viewAuth(){
  var sc=S.screen,msg=S.authMsg?'<div class="notice">'+esc(S.authMsg)+'</div>':'';
  if(sc==="code")return'<section class="sec"><h2>'+T("Save your recovery code")+'</h2><p class="lead">'+T("Your data is encrypted with your password before it leaves this device, so nobody at Tadbir can read it or reset your password for you. If you forget your password, this code is the only way to get your data back. Write it down or keep it in a password manager.")+'</p>'+
    '<div class="list"><div class="row"><div class="main"><span class="t code">'+esc(S.recoveryCode)+'</span></div><button class="btn small ghost" data-act="copy-code">'+T("Copy")+'</button></div></div>'+
    '<div class="actions"><button class="btn" data-act="code-saved">'+T("I have saved it")+'</button></div></section>';
  var h=(sc==="signin"||sc==="signup"||!sc?langChips()+'<div class="welcome"><img class="w-logo" src="icons/logo.jpg" alt="Tadbir تدبیر" width="148" height="148"><p class="w-tag">'+T("Bills, money, diary and daily practice, kept in order in one calm place.")+'</p>'+
    '<ul><li>'+icon("lock")+'<span>'+T("Encrypted on your phone before anything is saved")+'</span></li><li>'+icon("sliders")+'<span>'+T("Use only the sections you need")+'</span></li><li>'+icon("bell")+'<span>'+T("See what is due before it is late")+'</span></li></ul></div>':'')+'<section class="sec auth card">';
  if(sc==="signup")h+='<h2>'+T("Create your account")+'</h2><p class="lead">'+T("Everything you enter is encrypted on your device. Only you can read it.")+'</p>'+msg+'<form data-form="signup" class="auth" novalidate>'+
    authField("email","Email","email","email")+authField("password",T("Password (10 characters or more)"),"password","new-password")+authField("password2",T("Password again"),"password","new-password")+
    '<label class="field" for="f-recovery">'+T("If I forget my password")+'<select id="f-recovery"><option value="easy">'+T("Reset it by email (easier)")+'</option><option value="code">'+T("Use a recovery code (most private)")+'</option></select></label>'+
    '<p class="lead" style="font-size:13px">'+T("Reset by email: Tadbir keeps a locked backup of your key so a reset link can reopen your data. Recovery code: nobody but you can ever open your data, and if you lose both the password and the code it is gone for good.")+'</p>'+
    '<button type="submit" class="btn">'+T("Create account")+'</button></form><button class="linkbtn" data-act="go" data-s="signin">'+T("I already have an account")+'</button>';
  else if(sc==="forgot")h+='<h2>'+T("Forgot your password")+'</h2><p class="lead">'+T("We will email you a link to choose a new password. If you chose a recovery code at sign-up, have it ready.")+'</p>'+msg+'<form data-form="forgot" class="auth" novalidate>'+
    authField("email","Email","email","email")+'<button type="submit" class="btn">'+T("Email me a link")+'</button></form><button class="linkbtn" data-act="go" data-s="signin">'+T("Back to sign in")+'</button>';
  else if(sc==="reset"){
    var md=S.resetMode||"code";
    h+='<h2>'+T("Choose a new password")+'</h2><p class="lead">'+(md==="code"?T("Enter the recovery code you saved when you signed up, then a new password."):md==="wipe"?T("Your saved data will be erased and you will start again with an empty account."):T("Enter a new password. Your data will open with it."))+'</p>'+msg+'<form data-form="reset" class="auth" novalidate>'+
    (md==="code"?authField("code",T("Recovery code"),"text","off"):"")+authField("password",T("New password (10 characters or more)"),"password","new-password")+authField("password2",T("New password again"),"password","new-password")+
    '<button type="submit" class="btn">'+(md==="wipe"?T("Erase my data and save new password"):T("Save new password"))+'</button></form>'+
    (md==="code"?'<button class="linkbtn" data-act="reset-wipe">'+T("I have lost my recovery code")+'</button>':"");
  }
  else h+='<h2>'+T("Sign in")+'</h2><p class="lead">'+T("Your bills, money, diary and daily practice, encrypted so only you can read them.")+'</p>'+msg+'<form data-form="signin" class="auth" novalidate>'+
    authField("email","Email","email","email")+authField("password","Password","password","current-password")+
    '<button type="submit" class="btn">'+T("Sign in")+'</button></form><button class="btn ghost" data-act="go" data-s="signup">'+T("Create an account")+'</button><button class="linkbtn" data-act="go" data-s="forgot">'+T("Forgot your password?")+'</button>';
  return h+'</section>';
}
async function afterAuth(user,kek,email){
  S.uid=user.id;
  var p=await sb.from("profiles").select("wrapped_key").eq("user_id",user.id).maybeSingle();
  if(p.error)throw p.error;
  var raw,first=false;
  if(!p.data){
    raw=TC.newDataKey();
    var choice=S.recoveryChoice||remembered("tadbir-rc")||"easy",row={user_id:user.id,wrapped_key:await TC.wrap(kek,raw)},code=null;
    if(choice==="easy"){
      var er=null;try{er=await sb.functions.invoke("key-escrow",{body:{action:"wrap",key:TC.b64(raw)}})}catch(x){}
      if(er&&!er.error&&er.data&&er.data.blob)row.escrow_key=er.data.blob;else choice="code";
    }
    if(choice==="code"){code=TC.newRecoveryCode();row.wrapped_key_recovery=await TC.wrap(await TC.recoveryKek(code,email),raw)}
    var ins=await sb.from("profiles").insert(row);
    if(ins.error)throw ins.error;
    S.recoveryCode=code;first=!!code;
  }else{
    try{raw=await TC.unwrap(kek,p.data.wrapped_key)}catch(e){throw new Error(T("This password does not open your data. Use Forgot your password and enter your recovery code."))}
  }
  K=await TC.importDataKey(raw);
  await loadAll();
  S.unlocked=true;S.privLoaded=true;S.authMsg="";S.screen=first?"code":null;render();
}
function theme(){var t=remembered("tadbir-theme");return t==="light"||t==="dark"?t:"auto"}
function applyTheme(){var t=theme(),el=document.documentElement;if(t==="auto")el.removeAttribute("data-theme");else el.setAttribute("data-theme",t);
  var dark=t==="dark"||(t==="auto"&&window.matchMedia("(prefers-color-scheme:dark)").matches),m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",dark?"#0e1513":"#0e4a3c")}
function remembered(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lock(){K=null;S.uid=null;S.unlocked=false;S.privLoaded=false;S.bills=[];S.txns=[];S.diary=[];S.priv=[];S.editMods=false;S.pick=null;S.screen="signin";note("");render()}
$("view").addEventListener("submit",async function(e){
  var f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
  var kind=f.dataset.form,btn=f.querySelector("button[type=submit]");
  var val=function(id){var el=$("f-"+id);return el?el.value:""};
  var label=btn.textContent;btn.disabled=true;btn.textContent="Working…";
  try{
    var email=val("email").trim(),pw=val("password");if(email)S.authEmail=email;
    if(kind==="forgot"){
      if(!email)throw new Error(T("Enter your email address."));
      var fr=await sb.auth.resetPasswordForEmail(email,{redirectTo:here()});if(fr.error)throw fr.error;
      S.authMsg=T("If that address has an account, a link is on its way. Open it on this device.");render();return;
    }
    if(kind!=="signin"){
      if(pw.length<10)throw new Error(T("Use a password of 10 characters or more."));
      if(pw!==val("password2"))throw new Error(T("The two passwords do not match."));
    }
    if(kind==="reset"){
      var u=(await sb.auth.getUser()).data.user;if(!u)throw new Error(T("The link has expired. Ask for a new one."));
      var md=S.resetMode||"code",m2=await TC.master(pw,u.email),raw=null;
      if(md==="code"){
        var p=await sb.from("profiles").select("wrapped_key_recovery").eq("user_id",u.id).maybeSingle();if(p.error)throw p.error;
        if(p.data){try{raw=await TC.unwrap(await TC.recoveryKek(val("code"),u.email),p.data.wrapped_key_recovery)}catch(x){throw new Error(T("That recovery code is not right."))}}
      }else if(md==="easy"){
        var er=await sb.functions.invoke("key-escrow",{body:{action:"unwrap"}});
        if(er.error||!er.data||!er.data.key)throw new Error(T("Your data could not be reopened right now. Try again in a few minutes."));
        raw=TC.unb64(er.data.key);
      }else if(md==="wipe"){
        var d1=await sb.from("items").delete().eq("user_id",u.id);if(d1.error)throw d1.error;
        var d2=await sb.from("profiles").delete().eq("user_id",u.id);if(d2.error)throw d2.error;
      }
      var up=await sb.auth.updateUser({password:m2.authPw});if(up.error)throw up.error;
      if(raw){var pr=await sb.from("profiles").update({wrapped_key:await TC.wrap(m2.kek,raw),updated_at:new Date().toISOString()}).eq("user_id",u.id);if(pr.error)throw pr.error}
      await afterAuth(u,m2.kek,u.email);return;
    }
    if(!email||!pw)throw new Error(T("Enter your email and password."));
    if(kind==="signup"&&$("f-recovery")){S.recoveryChoice=$("f-recovery").value;try{localStorage.setItem("tadbir-rc",S.recoveryChoice)}catch(x){}}
    var m=await TC.master(pw,email);
    var r=kind==="signup"?await sb.auth.signUp({email:email,password:m.authPw,options:{emailRedirectTo:here()}}):await sb.auth.signInWithPassword({email:email,password:m.authPw});
    if(r.error)throw r.error;
    if(!r.data.session){S.screen="signin";S.authMsg=T("Check your email and confirm your address, then sign in here.");render();return}
    await afterAuth(r.data.user,m.kek,email);
  }catch(err){
    S.authMsg=(err&&err.message&&T(err.message))||T("Something went wrong. Try again.");
    if($("f-email"))S.authEmail=$("f-email").value.trim();
    render();
  }finally{if(btn.isConnected){btn.disabled=false;btn.textContent=label}}
});
$("view").addEventListener("click",async function(e){
  var b=e.target.closest("[data-act]");if(!b)return;var a=b.dataset.act;
  if(a==="go"){S.screen=b.dataset.s;S.authMsg="";render()}
  else if(a==="theme"){try{localStorage.setItem("tadbir-theme",b.dataset.th)}catch(x){toast(T("This browser cannot remember the theme."))}applyTheme();render()}
  else if(a==="lang"){try{localStorage.setItem("tadbir-lang",b.dataset.l)}catch(x){}if($("set-country"))S.pickCountry=$("set-country").value;applyLang();render()}
  else if(a==="reset-wipe"){
    if(!b.dataset.sure){b.dataset.sure="1";b.textContent=T("Tap again: without the code your saved data cannot be recovered and will be erased");return}
    S.resetMode="wipe";S.authMsg="";render()}
  else if(a==="copy-code"){try{await navigator.clipboard.writeText(S.recoveryCode);toast(T("Recovery code copied."))}catch(x){toast(T("Could not copy. Write the code down instead."))}}
  else if(a==="code-saved"){S.recoveryCode=null;S.screen=null;render()}
  else if(a==="sign-out"){if(sb)await sb.auth.signOut();lock()}
  else if(a==="export"){
    var blob=new Blob([JSON.stringify({exported:new Date().toISOString(),bills:S.bills,money:S.txns,diary:S.diary,private:S.priv},null,2)],{type:"application/json"});
    var link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="tadbir-export-"+today()+".json";document.body.appendChild(link);link.click();link.remove();
  }
  else if(a==="delete-account"){
    if(!b.dataset.sure){b.dataset.sure="1";b.textContent=T("Tap again to delete everything for good");return}
    var d=await sb.rpc("delete_my_account");if(d.error){toast(T("Your account could not be deleted. Try again."));return}
    await sb.auth.signOut();lock();S.authMsg=T("Your account and all of its data have been deleted.");render();
  }
});
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible"&&sb&&K&&!pending&&!sheetCtx)loadAll().then(render).catch(function(){});
});

/* ---------- start ---------- */
applyTheme();applyLang();
var cfg=window.TADBIR_CONFIG||{};
if(cfg.url&&cfg.key&&window.supabase&&window.TC){
  sb=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:true}});
  sb.auth.onAuthStateChange(function(ev,session){
    if(ev!=="PASSWORD_RECOVERY")return;
    S.screen="reset";S.resetMode="code";S.authMsg="";render();
    setTimeout(async function(){
      if(!session||!session.user)return;
      var p=await sb.from("profiles").select("escrow_key").eq("user_id",session.user.id).maybeSingle();
      if(p.error)return;
      S.resetMode=!p.data?"new":p.data.escrow_key?"easy":"code";render();
    },0);
  });
  S.screen="signin";
}else{
  S.privLoaded=true;
  note(T("Demo mode: this copy is not connected to a database, so nothing you enter is saved."));
}
route();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});
})();
