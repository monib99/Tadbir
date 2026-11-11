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
  var s=n.toLocaleString("en-GB",{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});return(neg?"-":"")+"£"+s}
function fmtDate(s,withDay){var o={day:"numeric",month:"short"};if(withDay)o.weekday="short";
  if(parse(s).getFullYear()!==new Date().getFullYear())o.year="numeric";return parse(s).toLocaleDateString("en-GB",o)}
function monthLabel(d){return d.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}
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
function onWriteError(){toast("That change could not be saved. Check your connection, then make the change again.")}
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
  note(bad?bad+" saved entries could not be read on this device.":"");
}
function strip(o){var c={};Object.keys(o).forEach(function(k){if(k!=="id"&&k!=="_priv"&&o[k]!==undefined)c[k]=o[k]});return c}

/* ---------- derived ---------- */
function billStatus(b){
  if(b.paid)return{cls:"good",label:"Paid "+(b.paidOn?fmtDate(b.paidOn):""),order:9999};
  var n=daysBetween(today(),b.due);
  if(n<0)return{cls:"crit",label:"Overdue "+(-n)+(n===-1?" day":" days"),order:n};
  if(n===0)return{cls:"crit",label:"Due today",order:0};
  if(n<=7)return{cls:"warn",label:"Due in "+n+(n===1?" day":" days"),order:n};
  return{cls:"",label:"Due "+fmtDate(b.due),order:n};
}
function openBills(){return S.bills.filter(function(b){return!b.paid}).sort(function(a,b){return a.due<b.due?-1:a.due>b.due?1:0})}
function habits(){var c=S.priv.find(function(x){return x.id==="config"});return(c&&Array.isArray(c.habits)&&c.habits.length)?c.habits:DEFAULT_HABITS}
function settings(){return S.priv.find(function(x){return x.id==="settings"})}
function mods(){var st=settings();return st&&Array.isArray(st.modules)?st.modules:MODULES.map(function(m){return m[0]})}
function has(m){return mods().indexOf(m)>=0}
function secs(){return has("ibadah")?SECTIONS:SECTIONS.filter(function(x){return x!=="Faith"})}
function needsSetup(){return S.privLoaded&&!settings()}
function viewSetup(){
  if(!S.pick){S.pick={};(settings()?mods():["bills","money","diary"]).forEach(function(m){S.pick[m]=1})}
  return'<section class="sec"><h2>Choose what you want to use</h2><p class="lead">Pick only the parts you need. You can change this any time with the button at the top right.</p><div class="list">'+
    MODULES.map(function(m){var on=!!S.pick[m[0]];return'<div class="row"><button class="check" aria-pressed="'+on+'" aria-label="'+esc(m[1])+'" data-act="toggle-mod" data-id="'+m[0]+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button><div class="main"><span class="t">'+esc(m[1])+(m[0]==="ibadah"?'<span class="ar-s" lang="ar" dir="rtl">عبادة</span>':'')+'</span><span class="s">'+esc(m[2])+'</span></div></div>'}).join("")+
    '</div><div class="actions"><button class="btn" data-act="save-mods">Save</button></div></section>'+
    (S.unlocked?'<section class="sec"><h2>Your account</h2><div class="list"><div class="row"><div class="main"><span class="t">Download my data</span><span class="s">A readable copy of everything you have entered</span></div><button class="btn small ghost" data-act="export">Download</button></div>'+
    '<div class="row"><div class="main"><span class="t">Sign out</span><span class="s">Locks Tadbir on this device</span></div><button class="btn small ghost" data-act="sign-out">Sign out</button></div>'+
    '<div class="row"><div class="main"><span class="t">Delete my account</span><span class="s">Removes your account and all of your data. This cannot be undone</span></div><button class="btn small danger" data-act="delete-account">Delete</button></div></div></section>':'');
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
  if(left<=0)st={cls:"good",label:"Settled"};else if(l.due)st=billStatus({due:l.due});
  var pct=+l.amount?Math.min(100,Math.round(100*paid/l.amount)):0;
  return'<div class="row '+st.cls+'"><button class="main" data-act="edit-loan" data-id="'+esc(l.id)+'"><span class="t">'+esc(l.name)+'</span>'+
    '<span class="s">'+(l.direction==="owed"?"Owes me":"I owe")+' · '+money(paid)+' of '+money(l.amount)+' repaid</span>'+
    (st.label?'<span><span class="pill '+st.cls+'">'+esc(st.label)+'</span></span>':'')+
    '<div class="ltrack"><i style="width:'+pct+'%"></i></div></button>'+
    '<span class="amt">'+money(left)+'</span>'+(left>0?'<button class="btn small" data-act="pay-loan" data-id="'+esc(l.id)+'">Record payment</button>':'')+'</div>';
}
function viewLoans(){
  var ls=loans().sort(function(a,b){return(loanLeft(b)>0)-(loanLeft(a)>0)||((a.due||"9")<(b.due||"9")?-1:1)});
  var owe=0,owed=0;ls.forEach(function(l){if(l.direction==="owed")owed+=loanLeft(l);else owe+=loanLeft(l)});
  var h='<section class="sec"><div class="sec-head"><h2>Private loans</h2>'+'<button class="btn small" data-act="add-loan">Add loan</button>'+'</div>';
  h+='<div class="tiles two"><div class="tile"><span class="k">I still owe</span><span class="v">'+money(owe)+'</span></div><div class="tile"><span class="k">Still owed to me</span><span class="v">'+money(owed)+'</span></div></div>'+
    '<div class="list">'+(ls.length?ls.map(loanRow).join(""):'<div class="empty">No loans recorded. Add money you have borrowed or lent.</div>')+'</div>'+
    '<p style="color:var(--muted);font-size:13px;margin:0">Loans are encrypted on your device like everything else, and they are kept out of your Money totals.</p></section>';
  return h;
}
/* ---------- row builders ---------- */
function billRow(b){var st=billStatus(b);
  var sub=[esc(b.category||"Bill"),esc(b.scope||"Personal")];
  if(b.repeat&&b.repeat!=="none")sub.push(esc((REPEATS.find(function(r){return r[0]===b.repeat})||[0,""])[1]));
  if(b.lastPaid)sub.push("Last paid "+fmtDate(b.lastPaid));
  return'<div class="row '+st.cls+'">'+
    '<button class="main" data-act="edit-bill" data-id="'+esc(b.id)+'"><span class="t">'+esc(b.name)+'</span>'+
    '<span class="s">'+sub.join(" · ")+'</span><span><span class="pill '+st.cls+'">'+esc(st.label)+'</span></span></button>'+
    '<span class="amt">'+(b.amount?money(b.amount):'<span class="s">Amount not set</span>')+'</span>'+
    (b.paid?'':'<button class="btn small" data-act="pay" data-id="'+esc(b.id)+'">Mark paid</button>')+'</div>';
}
function entryRow(e,showDate){
  return'<div class="row e-'+esc(e.section)+(e.done?" done":"")+'">'+
    '<button class="check" aria-pressed="'+(e.done?"true":"false")+'" aria-label="Mark done" data-act="tick-entry" data-id="'+esc(e.id)+'" data-priv="'+(e._priv?1:0)+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>'+
    '<button class="main" data-act="edit-entry" data-id="'+esc(e.id)+'" data-priv="'+(e._priv?1:0)+'"><span class="t">'+esc(e.title)+'</span>'+
    '<span class="s"><span class="dot d-'+esc(e.section)+'"></span> '+esc(e.section)+(showDate?" · "+fmtDate(e.date,true):"")+(e.time?" · "+esc(e.time):"")+(e._priv?" · Only me":"")+(e.notes?" · "+esc(e.notes):"")+'</span></button></div>';
}

/* ---------- views ---------- */
function viewToday(){
  var t=today(),ob=has("bills")?openBills():[],h="";
  var overdue=ob.filter(function(b){return b.due<t});
  var soon=ob.filter(function(b){return b.due>=t&&daysBetween(t,b.due)<=7});
  var soonSum=soon.reduce(function(s,b){return s+(+b.amount||0)},0);
  var dueLoans=has("loans")?loans().filter(function(l){return l.due&&loanLeft(l)>0&&daysBetween(t,l.due)<=7}):[];
  var hr=new Date().getHours(),greet=hr<12?"Good morning":hr<18?"Good afternoon":"Good evening";
  h+='<section class="sec">';
  if(has("money")){
    var m=first(new Date()),inn=0,out=0;
    S.txns.forEach(function(x){if(inMonth(x.date,m)){if(x.type==="in")inn+=+x.amount||0;else out+=+x.amount||0}});
    var pct=inn?Math.min(100,Math.round(100*out/inn)):0;
    h+='<div class="hero"><span class="k">'+greet+' · '+esc(monthLabel(m))+'</span>'+
      '<span class="big">'+money(inn-out)+'</span><span class="cap">'+(inn||out?"left over this month":"Add your income and spending to see what you keep")+'</span>'+
      '<div class="meter"><i style="width:'+pct+'%"></i></div>'+
      '<div class="split"><div><b>'+money(inn)+'</b><span>In</span></div><div><b>'+money(out)+'</b><span>Out</span></div>'+(inn?'<div><b>'+pct+'%</b><span>of income spent</span></div>':'')+'</div></div>';
  }else h+='<p class="lead">'+greet+'</p>';
  if(has("bills"))h+='<div class="tiles two"><div class="tile'+(overdue.length?" crit":"")+'"><span class="k">Overdue</span><span class="v">'+overdue.length+'</span><span class="n">'+(overdue.length?"Pay these first":"Nothing late")+'</span></div>'+
    '<div class="tile"><span class="k">Due in 7 days</span><span class="v">'+money(soonSum)+'</span><span class="n">'+soon.length+(soon.length===1?" payment":" payments")+'</span></div></div>';
  h+='</section>';
  var attention=overdue.concat(soon);
  if(has("bills")||dueLoans.length)h+='<section class="sec"><div class="sec-head"><h2>Payments needing attention</h2>'+(has("bills")?'<button class="btn small ghost" data-act="add-bill">Add bill</button>':'')+'</div><div class="list">'+
    (attention.length||dueLoans.length?attention.map(billRow).join("")+dueLoans.map(loanRow).join(""):'<div class="empty">No payments due in the next 7 days.'+(ob[0]?" Next: "+esc(ob[0].name)+" on "+fmtDate(ob[0].due)+".":"")+'</div>')+'</div></section>';
  if(has("diary")){
    var es=entriesOn(t);
    h+='<section class="sec"><div class="sec-head"><h2>Today\'s diary</h2><button class="btn small ghost" data-act="add-entry" data-date="'+t+'">Add entry</button></div><div class="list">'+
      (es.length?es.map(function(e){return entryRow(e)}).join(""):'<div class="empty">Nothing planned for today yet.</div>')+'</div></section>';
    var late=entries().filter(function(e){return e.date<t&&!e.done}).sort(function(a,b){return a.date<b.date?-1:1}).slice(0,15);
    if(late.length)h+='<section class="sec"><div class="sec-head"><h2>Outstanding tasks</h2><span class="pill warn">'+late.length+' not done</span></div><div class="list">'+late.map(function(e){return entryRow(e,true)}).join("")+'</div></section>';
    var tm=entriesOn(addDays(t,1));
    if(tm.length)h+='<section class="sec"><h2>Tomorrow</h2><div class="list">'+tm.map(function(e){return entryRow(e)}).join("")+'</div></section>';
  }
  if(has("ibadah"))h+=checklist(t);
  return h;
}
function checklist(d){
  var hs=habitsFor(d),doc=dayDoc(d),done=doc.done||{};
  var count=hs.filter(function(x){return done[x.id]}).length;
  var week="";for(var i=6;i>=0;i--){var dd=addDays(d,-i),dn=dayDoc(dd).done||{},hd=habitsFor(dd);
    var f=hd.length?Math.round(100*hd.filter(function(x){return dn[x.id]}).length/hd.length):0;
    week+='<div><i style="--f:'+f+'%" title="'+f+'%"></i>'+parse(dd).toLocaleDateString("en-GB",{weekday:"narrow"})+'</div>'}
  var h='<section class="sec"><div class="sec-head"><h2>Ibadah<span class="ar-s" lang="ar" dir="rtl">عبادة</span></h2><div class="week" aria-label="Last 7 days">'+week+'</div></div>';
  h+='<div class="list">'+hs.map(function(x){var on=!!done[x.id];
    return'<div class="row'+(on?" done":"")+'"><button class="check" aria-pressed="'+on+'" aria-label="'+esc(x.name)+'" data-act="tick-habit" data-id="'+esc(x.id)+'" data-date="'+d+'"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button><div class="main"><span class="t">'+esc(x.name)+'</span>'+(x.days?'<span class="s">Every Friday</span>':'')+'</div></div>'}).join("")+
    '<div class="row foot"><svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="'+(hs.length?100.5*count/hs.length:0).toFixed(1)+' 100.5"/></svg><div class="main"><span class="t">'+count+' of '+hs.length+' done</span><span class="s">Encrypted on your device</span></div>'+'<!--'+'-->'+
    '<button class="btn small ghost" data-act="edit-habits">Edit list</button><button class="btn small ghost" data-act="day-note" data-date="'+d+'">'+(doc.note?"Edit note":"Add note")+'</button></div>'+
    (doc.note?'<div class="row"><div class="main"><span class="s">'+esc(doc.note)+'</span></div></div>':'')+'</div></section>';
  return h;
}
function viewBills(){
  var list=S.billFilter==="paid"?S.bills.filter(function(b){return b.paid}).sort(function(a,b){return(b.paidOn||"")<(a.paidOn||"")?-1:1}):openBills();
  var total=openBills().reduce(function(s,b){return s+(+b.amount||0)},0);
  return'<section class="sec"><div class="sec-head"><h2>Bills and deadlines</h2><button class="btn small" data-act="add-bill">Add bill</button></div>'+
    '<div class="chips"><button class="chip" aria-pressed="'+(S.billFilter==="open")+'" data-act="bill-filter" data-f="open">To pay · '+money(total)+'</button>'+
    '<button class="chip" aria-pressed="'+(S.billFilter==="paid")+'" data-act="bill-filter" data-f="paid">Paid one-offs</button></div>'+
    '<div class="list">'+(list.length?list.map(billRow).join(""):'<div class="empty">'+(S.billFilter==="paid"?"No paid one-off bills yet.":"No bills yet. Add rent, insurance, road tax, PCNs and anything else with a deadline.")+'</div>')+'</div>'+
    '<p class="s" style="color:var(--muted);font-size:13px;margin:0">Marking a repeating bill as paid moves it to its next due date and records the payment under Money, so you can see it has been paid once.</p></section>';
}
function viewMoney(){
  var m=S.moneyMonth,sc=scopes();
  var tx=S.txns.filter(function(x){return inMonth(x.date,m)&&(S.scope==="All"||(x.scope||"Personal")===S.scope)}).sort(function(a,b){return a.date<b.date?1:-1});
  var inn=0,out=0,cats={};
  tx.forEach(function(x){var a=+x.amount||0;if(x.type==="in")inn+=a;else{out+=a;cats[x.category||"Other"]=(cats[x.category||"Other"]||0)+a}});
  var cl=Object.keys(cats).map(function(k){return[k,cats[k]]}).sort(function(a,b){return b[1]-a[1]}),max=cl.length?cl[0][1]:1;
  var h='<section class="sec"><div class="sec-head"><h2>Money</h2><div class="monthnav"><button class="iconbtn" data-act="money-prev" aria-label="Previous month">‹</button><b>'+esc(monthLabel(m))+'</b><button class="iconbtn" data-act="money-next" aria-label="Next month">›</button></div></div>'+
    '<div class="chips">'+["All"].concat(sc).map(function(s){return'<button class="chip" aria-pressed="'+(S.scope===s)+'" data-act="scope" data-s="'+esc(s)+'">'+esc(s)+'</button>'}).join("")+'</div>'+
    '<div class="tiles"><div class="tile"><span class="k">In</span><span class="v">'+money(inn)+'</span></div><div class="tile"><span class="k">Out</span><span class="v">'+money(out)+'</span></div>'+
    '<div class="tile wide'+(inn-out<0?" crit":"")+'"><span class="k">Left over</span><span class="v">'+money(inn-out)+'</span><span class="n">'+(inn?Math.round(100*(inn-out)/inn)+"% of income":"Add your income to see what you keep")+'</span></div></div>'+
    '<div class="actions"><button class="btn" data-act="add-txn" data-type="in">Add income</button><button class="btn ghost" data-act="add-txn" data-type="out">Add spending</button></div></section>';
  h+='<section class="sec"><h2>Where it went</h2><div class="list">'+(cl.length?'<div class="bars">'+cl.map(function(c){return'<div class="bar"><span>'+esc(c[0])+'</span><b>'+money(c[1])+'</b><div class="track"><div class="fill" style="width:'+Math.max(2,Math.round(100*c[1]/max))+'%"></div></div></div>'}).join("")+'</div>':'<div class="empty">No spending recorded this month.</div>')+'</div></section>';
  h+='<section class="sec"><h2>Entries</h2><div class="list">'+(tx.length?tx.map(function(x){
    return'<div class="row"><button class="main" data-act="edit-txn" data-id="'+esc(x.id)+'"><span class="t">'+esc(x.note||x.category||"Entry")+'</span><span class="s">'+fmtDate(x.date)+" · "+esc(x.category||"Other")+" · "+esc(x.scope||"Personal")+'</span></button><span class="amt '+(x.type==="in"?"in":"")+'">'+(x.type==="in"?"+":"-")+money(x.amount)+'</span></div>'}).join(""):'<div class="empty">Nothing recorded for this month.</div>')+'</div></section>';
  return h;
}
function viewDiary(){
  var m=S.calMonth,y=m.getFullYear(),mo=m.getMonth(),days=new Date(y,mo+1,0).getDate(),lead=(m.getDay()+6)%7,t=today();
  var byDay={};entries().forEach(function(e){if(inMonth(e.date,m))(byDay[e.date]=byDay[e.date]||[]).push(e.section)});
  var billDay={};S.bills.forEach(function(b){if(!b.paid&&inMonth(b.due,m))billDay[b.due]=1});
  var h='<section class="sec"><div class="sec-head"><h2>Diary</h2><div class="monthnav"><button class="iconbtn" data-act="cal-prev" aria-label="Previous month">‹</button><b>'+esc(monthLabel(m))+'</b><button class="iconbtn" data-act="cal-next" aria-label="Next month">›</button></div></div><div class="cal">';
  ["M","T","W","T","F","S","S"].forEach(function(w){h+='<div class="wd">'+w+'</div>'});
  for(var i=0;i<lead;i++)h+='<div></div>';
  for(var d=1;d<=days;d++){var ds=y+"-"+pad(mo+1)+"-"+pad(d),dots="";
    if(billDay[ds])dots+='<span class="dot d-bill"></span>';
    var seen={};(byDay[ds]||[]).forEach(function(s){if(!seen[s]){seen[s]=1;dots+='<span class="dot d-'+esc(s)+'"></span>'}});
    h+='<button class="'+(ds===t?"today ":"")+(ds===S.selDay?"sel":"")+'" data-act="pick-day" data-date="'+ds+'" aria-label="'+esc(fmtDate(ds,true))+'"><span class="num">'+d+'</span><span class="dots">'+dots+'</span></button>'}
  h+='</div><div class="legend">'+secs().map(function(s){return'<span><span class="dot d-'+s+'"></span>'+s+'</span>'}).join("")+'<span><span class="dot d-bill"></span>Payment due</span></div></section>';
  var es=entriesOn(S.selDay),bs=S.bills.filter(function(b){return!b.paid&&b.due===S.selDay});
  h+='<section class="sec"><div class="sec-head"><h2>'+esc(fmtDate(S.selDay,true))+'</h2><button class="btn small" data-act="add-entry" data-date="'+S.selDay+'">Add entry</button></div><div class="list">'+
    bs.map(billRow).join("")+es.map(entryRow).join("")+((bs.length||es.length)?"":'<div class="empty">Nothing on this day. Add an appointment, a job, or a note.</div>')+'</div></section>';
  if(S.selDay<=t&&has("ibadah"))h+=checklist(S.selDay);
  return h;
}
function render(){
  $("dateline").textContent=new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  $("gear").style.display=S.screen?"none":"";
  if(S.screen){document.querySelector("nav.tabs").style.display="none";$("view").style.cssText="display:flex;flex-direction:column;gap:22px";$("view").innerHTML=viewAuth();return}
  var setup=needsSetup()||S.editMods;
  document.querySelector("nav.tabs").style.display=setup?"none":"";
  $("view").style.cssText="display:flex;flex-direction:column;gap:22px";
  if(setup){$("view").innerHTML=viewSetup();return}
  var v=S.view;if(v!=="today"&&!has(v))v="today";
  document.querySelectorAll("nav.tabs a").forEach(function(a){a.style.display=(a.dataset.v==="today"||has(a.dataset.v))?"":"none"});
  $("view").innerHTML=v==="bills"?viewBills():v==="money"?viewMoney():v==="diary"?viewDiary():v==="loans"?viewLoans():viewToday();
  $("view").style.cssText="display:flex;flex-direction:column;gap:22px";
  document.querySelectorAll("nav.tabs a").forEach(function(a){a.classList.toggle("on",a.dataset.v===v)});
}

/* ---------- sheet (forms) ---------- */
var sheetCtx=null;
function field(f,val){
  var id="f-"+f.id,v=val==null?"":val;
  if(f.type==="select")return'<label class="field" for="'+id+'">'+esc(f.label)+'<select id="'+id+'">'+f.options.map(function(o){var k=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;return'<option value="'+esc(k)+'"'+(k===v?" selected":"")+'>'+esc(l)+'</option>'}).join("")+'</select></label>';
  if(f.type==="textarea")return'<label class="field" for="'+id+'">'+esc(f.label)+'<textarea id="'+id+'">'+esc(v)+'</textarea></label>';
  if(f.type==="checkbox")return'<label class="field inline" for="'+id+'"><input type="checkbox" id="'+id+'"'+(v?" checked":"")+'>'+esc(f.label)+'</label>';
  var extra=f.type==="number"?' inputmode="decimal" step="0.01" min="0"':"";
  if(f.list)extra+=' list="'+id+'-l"';
  return'<label class="field" for="'+id+'">'+esc(f.label)+'<input type="'+f.type+'" id="'+id+'" value="'+esc(v)+'"'+extra+'>'+
    (f.list?'<datalist id="'+id+'-l">'+f.list.map(function(o){return'<option value="'+esc(o)+'">'}).join("")+'</datalist>':'')+'</label>';
}
function openSheet(title,fields,init,onSave,onDelete){
  sheetCtx={fields:fields,onSave:onSave,onDelete:onDelete};
  $("sheettitle").textContent=title;
  $("sheetform").innerHTML=fields.map(function(f){return field(f,init[f.id])}).join("")+
    '<div class="actions"><button type="submit" class="btn">Save</button><button type="button" class="btn ghost" data-act="close-sheet">Cancel</button>'+
    (onDelete?'<button type="button" class="btn danger" data-act="delete-sheet">Delete</button>':'')+'</div>';
  $("sheetbg").classList.add("open");
  var firstInput=$("sheetform").querySelector("input,select,textarea");if(firstInput)firstInput.focus();
}
function closeSheet(){$("sheetbg").classList.remove("open");sheetCtx=null}
$("sheetform").addEventListener("submit",function(e){
  e.preventDefault();if(!sheetCtx)return;var out={},bad=null;
  sheetCtx.fields.forEach(function(f){var el=$("f-"+f.id);
    out[f.id]=f.type==="checkbox"?el.checked:f.type==="number"?(el.value===""?0:Math.abs(parseFloat(el.value))||0):el.value.trim();
    if(f.required&&!out[f.id]&&!bad)bad=f});
  if(bad){toast("Fill in: "+bad.label);$("f-"+bad.id).focus();return}
  var fn=sheetCtx.onSave;closeSheet();fn(out);
});
$("sheetbg").addEventListener("click",function(e){
  if(e.target===$("sheetbg"))return closeSheet();
  var b=e.target.closest("[data-act]");if(!b)return;
  if(b.dataset.act==="close-sheet")closeSheet();
  if(b.dataset.act==="delete-sheet"&&sheetCtx){
    if(b.dataset.sure){var fn=sheetCtx.onDelete;closeSheet();fn()}else{b.dataset.sure="1";b.textContent="Tap again to delete"}}
});
$("sheetform").addEventListener("change",function(e){
  if(e.target.id==="f-section"&&$("f-priv"))$("f-priv").checked=!!PRIVATE_BY_DEFAULT[e.target.value];
  if(e.target.id==="f-type"&&$("f-category")){var cats=e.target.value==="in"?IN_CATS:OUT_CATS;
    $("f-category").innerHTML=cats.map(function(c){return'<option>'+esc(c)+'</option>'}).join("")}
});

function billForm(b){
  var isNew=!b;b=b||{name:"",amount:"",due:today(),repeat:"monthly",category:"Rent",scope:"Personal",notes:""};
  openSheet(isNew?"Add a bill":"Edit bill",[
    {id:"name",label:"What is it for",type:"text",required:true},
    {id:"amount",label:"Amount (£), leave empty if not known yet",type:"number"},
    {id:"due",label:"Due date",type:"date",required:true},
    {id:"repeat",label:"How often",type:"select",options:REPEATS},
    {id:"category",label:"Type",type:"select",options:BILL_CATS},
    {id:"scope",label:"Personal or which business",type:"text",list:scopes()},
    {id:"notes",label:"Notes (reference number, vehicle reg, how to pay)",type:"textarea"}
  ],b,function(o){
    var rec=Object.assign(strip(b),o);if(!rec.scope)rec.scope="Personal";
    save("bills",isNew?newId():b.id,rec);
  },isNew?null:function(){remove("bills",b.id)});
}
function payBill(b){
  var t=today();
  if(b.lastPaid&&daysBetween(b.lastPaid,t)<5&&!payBill.confirm){payBill.confirm=b.id;toast(b.name+" was marked paid on "+fmtDate(b.lastPaid)+". Tap Mark paid again if this is a new payment.");return}
  if(payBill.confirm&&payBill.confirm!==b.id&&b.lastPaid&&daysBetween(b.lastPaid,t)<5){payBill.confirm=b.id;toast(b.name+" was marked paid on "+fmtDate(b.lastPaid)+". Tap again to confirm.");return}
  payBill.confirm=null;
  var rec=strip(b);rec.lastPaid=t;
  if(b.repeat&&b.repeat!=="none")rec.due=nextDue(b.due,b.repeat);else{rec.paid=true;rec.paidOn=t}
  save("bills",b.id,rec);
  if(+b.amount)save("txns",newId(),{date:t,type:"out",amount:+b.amount,category:b.category||"Other",scope:b.scope||"Personal",note:b.name,billId:b.id});
  toast(b.name+" marked paid"+(rec.paid?".":". Next due "+fmtDate(rec.due)+"."));
}
function txnForm(x,type){
  var isNew=!x;x=x||{type:type||"out",amount:"",date:today(),category:type==="in"?"Sales":"Other",scope:S.scope==="All"?"Personal":S.scope,note:""};
  openSheet(isNew?(x.type==="in"?"Add income":"Add spending"):"Edit entry",[
    {id:"type",label:"Money in or out",type:"select",options:[["in","Money in"],["out","Money out"]]},
    {id:"amount",label:"Amount (£)",type:"number",required:true},
    {id:"date",label:"Date",type:"date",required:true},
    {id:"category",label:"Category",type:"select",options:x.type==="in"?IN_CATS:OUT_CATS},
    {id:"scope",label:"Personal or which business",type:"text",list:scopes()},
    {id:"note",label:"What was it",type:"text"}
  ],x,function(o){var rec=Object.assign(strip(x),o);if(!rec.scope)rec.scope="Personal";save("txns",isNew?newId():x.id,rec)},
  isNew?null:function(){remove("txns",x.id)});
}
function entryForm(e,date){
  var isNew=!e;e=e||{title:"",date:date||today(),time:"",section:"Business",notes:"",_priv:false};
  var fields=[
    {id:"title",label:"What (appointment, job or task)",type:"text",required:true},
    {id:"section",label:"Area",type:"select",options:secs()},
    {id:"date",label:"Date",type:"date",required:true},
    {id:"time",label:"Time (optional)",type:"time"},
    {id:"notes",label:"Notes",type:"textarea"}];
  var init=Object.assign({},e,{priv:e._priv});
  openSheet(isNew?"Add diary entry":"Edit diary entry",fields,init,function(o){
    var toPriv=!!o.priv&&!!S.uid;delete o.priv;
    var rec=Object.assign(strip(e),o);var id=isNew?newId():e.id;
    if(toPriv){rec.kind="entry"}else{delete rec.kind}
    if(!isNew&&e._priv!==toPriv)remove(e._priv?"priv":"diary",e.id);
    save(toPriv?"priv":"diary",id,rec);
  },isNew?null:function(){remove(e._priv?"priv":"diary",e.id)});
}
function loanForm(l){
  var isNew=!l;l=l||{name:"",direction:"owe",amount:"",due:"",notes:"",payments:[]};
  openSheet(isNew?"Add a private loan":"Edit loan",[
    {id:"name",label:"Who is it with",type:"text",required:true},
    {id:"direction",label:"Direction",type:"select",options:[["owe","I owe them"],["owed","They owe me"]]},
    {id:"amount",label:"Total amount (£)",type:"number",required:true},
    {id:"due",label:"Repay by (optional)",type:"date"},
    {id:"notes",label:"Notes (terms, what was agreed)",type:"textarea"}
  ],l,function(o){var rec=Object.assign(strip(l),o);rec.kind="loan";rec.payments=(l.payments||[]).slice();save("priv",isNew?"loan_"+newId():l.id,rec)},
  isNew?null:function(){remove("priv",l.id)});
}
function loanPayForm(l){
  openSheet("Record a repayment",[
    {id:"amount",label:"Amount repaid (£), "+money(loanLeft(l))+" left",type:"number",required:true},
    {id:"date",label:"Date",type:"date",required:true}
  ],{amount:"",date:today()},function(o){var rec=strip(l);rec.payments=(l.payments||[]).concat([{date:o.date,amount:o.amount}]);save("priv",l.id,rec)});
}
function habitsForm(){
  openSheet("Edit daily checklist",[{id:"list",label:"One item per line. End a line with (Fridays) to show it on Fridays only.",type:"textarea",required:true}],
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
  openSheet("Note for "+fmtDate(d),[{id:"note",label:"For example how much you read today",type:"textarea"}],{note:doc.note||""},function(o){
    save("priv","h_"+d,{kind:"day",date:d,done:Object.assign({},doc.done||{}),note:o.note});
  });
}

/* ---------- actions ---------- */
$("view").addEventListener("click",function(e){
  var b=e.target.closest("[data-act]");if(!b)return;var a=b.dataset.act,id=b.dataset.id;
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
  else if(a==="toggle-mod"){S.pick[id]=S.pick[id]?0:1;render()}
  else if(a==="save-mods"){var list=MODULES.map(function(m){return m[0]}).filter(function(k){return S.pick[k]});
    var rec={kind:"settings",modules:list};S.priv=S.priv.filter(function(x){return x.id!=="settings"}).concat([Object.assign({id:"settings"},rec)]);
    S.editMods=false;S.pick=null;save("priv","settings",rec);render();window.scrollTo(0,0)}
  else if(a==="edit-habits")habitsForm();
  else if(a==="add-loan")loanForm();
  else if(a==="edit-loan"||a==="pay-loan"){var ln=loans().find(function(x){return x.id===id});if(!ln)return;if(a==="edit-loan")loanForm(ln);else loanPayForm(ln)}
  else if(a==="day-note")noteForm(b.dataset.date);
});
$("gear").addEventListener("click",function(){S.editMods=!S.editMods;S.pick=null;render();window.scrollTo(0,0)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&sheetCtx)closeSheet()});

/* ---------- routing ---------- */
function route(){var h=(location.hash||"").replace("#","");S.view=["today","bills","money","diary","loans"].indexOf(h)>=0?h:"today";render();window.scrollTo(0,0);var v=$("view");v.classList.remove("enter");void v.offsetWidth;v.classList.add("enter")}
window.addEventListener("hashchange",route);

/* ---------- accounts ---------- */
function note(msg){var n=$("notice");if(msg){n.textContent=msg;n.hidden=false}else n.hidden=true}
function here(){return location.origin+location.pathname}
function authField(id,label,type,auto){return'<label class="field" for="f-'+id+'">'+esc(label)+'<input type="'+type+'" id="f-'+id+'" autocomplete="'+auto+'" value="'+(id==="email"?esc(S.authEmail||""):"")+'"></label>'}
function viewAuth(){
  var sc=S.screen,msg=S.authMsg?'<div class="notice">'+esc(S.authMsg)+'</div>':'';
  if(sc==="code")return'<section class="sec"><h2>Save your recovery code</h2><p class="lead">Your data is encrypted with your password before it leaves this device, so nobody at Tadbir can read it or reset your password for you. If you forget your password, this code is the only way to get your data back. Write it down or keep it in a password manager.</p>'+
    '<div class="list"><div class="row"><div class="main"><span class="t code">'+esc(S.recoveryCode)+'</span></div><button class="btn small ghost" data-act="copy-code">Copy</button></div></div>'+
    '<div class="actions"><button class="btn" data-act="code-saved">I have saved it</button></div></section>';
  var h='<section class="sec auth">';
  if(sc==="signup")h+='<h2>Create your account</h2><p class="lead">Everything you enter is encrypted on your device. Only you can read it.</p>'+msg+'<form data-form="signup" class="auth" novalidate>'+
    authField("email","Email","email","email")+authField("password","Password (10 characters or more)","password","new-password")+authField("password2","Password again","password","new-password")+
    '<button type="submit" class="btn">Create account</button></form><button class="linkbtn" data-act="go" data-s="signin">I already have an account</button>';
  else if(sc==="forgot")h+='<h2>Forgot your password</h2><p class="lead">We will email you a link. To open your data again you will also need the recovery code you saved when you signed up.</p>'+msg+'<form data-form="forgot" class="auth" novalidate>'+
    authField("email","Email","email","email")+'<button type="submit" class="btn">Email me a link</button></form><button class="linkbtn" data-act="go" data-s="signin">Back to sign in</button>';
  else if(sc==="reset")h+='<h2>Choose a new password</h2><p class="lead">Enter the recovery code you saved when you signed up, then a new password.</p>'+msg+'<form data-form="reset" class="auth" novalidate>'+
    authField("code","Recovery code","text","off")+authField("password","New password (10 characters or more)","password","new-password")+authField("password2","New password again","password","new-password")+
    '<button type="submit" class="btn">Save new password</button></form>';
  else h+='<h2>Sign in</h2><p class="lead">Your bills, money, diary and daily practice, encrypted so only you can read them.</p>'+msg+'<form data-form="signin" class="auth" novalidate>'+
    authField("email","Email","email","email")+authField("password","Password","password","current-password")+
    '<button type="submit" class="btn">Sign in</button></form><button class="linkbtn" data-act="go" data-s="signup">Create an account</button><button class="linkbtn" data-act="go" data-s="forgot">Forgot your password?</button>';
  return h+'</section>';
}
async function afterAuth(user,kek,email){
  S.uid=user.id;
  var p=await sb.from("profiles").select("wrapped_key").eq("user_id",user.id).maybeSingle();
  if(p.error)throw p.error;
  var raw,first=false;
  if(!p.data){
    raw=TC.newDataKey();var code=TC.newRecoveryCode();
    var ins=await sb.from("profiles").insert({user_id:user.id,wrapped_key:await TC.wrap(kek,raw),wrapped_key_recovery:await TC.wrap(await TC.recoveryKek(code,email),raw)});
    if(ins.error)throw ins.error;
    S.recoveryCode=code;first=true;
  }else{
    try{raw=await TC.unwrap(kek,p.data.wrapped_key)}catch(e){throw new Error("This password does not open your data. Use Forgot your password and enter your recovery code.")}
  }
  K=await TC.importDataKey(raw);
  await loadAll();
  S.unlocked=true;S.privLoaded=true;S.authMsg="";S.screen=first?"code":null;render();
}
function lock(){K=null;S.uid=null;S.unlocked=false;S.privLoaded=false;S.bills=[];S.txns=[];S.diary=[];S.priv=[];S.editMods=false;S.pick=null;S.screen="signin";note("");render()}
$("view").addEventListener("submit",async function(e){
  var f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
  var kind=f.dataset.form,btn=f.querySelector("button[type=submit]");
  var val=function(id){var el=$("f-"+id);return el?el.value:""};
  var label=btn.textContent;btn.disabled=true;btn.textContent="Working…";
  try{
    var email=val("email").trim(),pw=val("password");if(email)S.authEmail=email;
    if(kind==="forgot"){
      if(!email)throw new Error("Enter your email address.");
      var fr=await sb.auth.resetPasswordForEmail(email,{redirectTo:here()});if(fr.error)throw fr.error;
      S.authMsg="If that address has an account, a link is on its way. Open it on this device.";render();return;
    }
    if(kind!=="signin"){
      if(pw.length<10)throw new Error("Use a password of 10 characters or more.");
      if(pw!==val("password2"))throw new Error("The two passwords do not match.");
    }
    if(kind==="reset"){
      var u=(await sb.auth.getUser()).data.user;if(!u)throw new Error("The link has expired. Ask for a new one.");
      var p=await sb.from("profiles").select("wrapped_key_recovery").eq("user_id",u.id).maybeSingle();if(p.error)throw p.error;
      var m2=await TC.master(pw,u.email),raw=null;
      if(p.data){try{raw=await TC.unwrap(await TC.recoveryKek(val("code"),u.email),p.data.wrapped_key_recovery)}catch(x){throw new Error("That recovery code is not right.")}}
      var up=await sb.auth.updateUser({password:m2.authPw});if(up.error)throw up.error;
      if(raw){var pr=await sb.from("profiles").update({wrapped_key:await TC.wrap(m2.kek,raw),updated_at:new Date().toISOString()}).eq("user_id",u.id);if(pr.error)throw pr.error}
      await afterAuth(u,m2.kek,u.email);return;
    }
    if(!email||!pw)throw new Error("Enter your email and password.");
    var m=await TC.master(pw,email);
    var r=kind==="signup"?await sb.auth.signUp({email:email,password:m.authPw,options:{emailRedirectTo:here()}}):await sb.auth.signInWithPassword({email:email,password:m.authPw});
    if(r.error)throw r.error;
    if(!r.data.session){S.screen="signin";S.authMsg="Check your email and confirm your address, then sign in here.";render();return}
    await afterAuth(r.data.user,m.kek,email);
  }catch(err){
    S.authMsg=(err&&err.message)||"Something went wrong. Try again.";
    if($("f-email"))S.authEmail=$("f-email").value.trim();
    render();
  }finally{if(btn.isConnected){btn.disabled=false;btn.textContent=label}}
});
$("view").addEventListener("click",async function(e){
  var b=e.target.closest("[data-act]");if(!b)return;var a=b.dataset.act;
  if(a==="go"){S.screen=b.dataset.s;S.authMsg="";render()}
  else if(a==="copy-code"){try{await navigator.clipboard.writeText(S.recoveryCode);toast("Recovery code copied.")}catch(x){toast("Could not copy. Write the code down instead.")}}
  else if(a==="code-saved"){S.recoveryCode=null;S.screen=null;render()}
  else if(a==="sign-out"){if(sb)await sb.auth.signOut();lock()}
  else if(a==="export"){
    var blob=new Blob([JSON.stringify({exported:new Date().toISOString(),bills:S.bills,money:S.txns,diary:S.diary,private:S.priv},null,2)],{type:"application/json"});
    var link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="tadbir-export-"+today()+".json";document.body.appendChild(link);link.click();link.remove();
  }
  else if(a==="delete-account"){
    if(!b.dataset.sure){b.dataset.sure="1";b.textContent="Tap again to delete everything for good";return}
    var d=await sb.rpc("delete_my_account");if(d.error){toast("Your account could not be deleted. Try again.");return}
    await sb.auth.signOut();lock();S.authMsg="Your account and all of its data have been deleted.";render();
  }
});
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible"&&sb&&K&&!pending&&!sheetCtx)loadAll().then(render).catch(function(){});
});

/* ---------- start ---------- */
var cfg=window.TADBIR_CONFIG||{};
if(cfg.url&&cfg.key&&window.supabase&&window.TC){
  sb=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:true}});
  sb.auth.onAuthStateChange(function(ev){if(ev==="PASSWORD_RECOVERY"){S.screen="reset";S.authMsg="";render()}});
  S.screen="signin";
}else{
  S.privLoaded=true;
  note("Demo mode: this copy is not connected to a database, so nothing you enter is saved.");
}
route();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});
})();
