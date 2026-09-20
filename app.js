import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js?v=20260920-3";

const $ = (id) => document.getElementById(id);
const views = ["loadingView","accessView","workspaceView","doneView"];
const show = (id) => views.forEach(v => $(v).classList.toggle("hidden", v !== id));

if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("SEU-PROJETO") ||
    !CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes("SUA_CHAVE")) {
  show("accessView");
  $("accessMessage").textContent = "Configuração do Supabase ainda não aplicada. Preencha config.js antes de iniciar a coleta.";
  $("accessMessage").className = "message error span-2";
  throw new Error("Supabase not configured.");
}

const COLLECTION_ENABLED = CONFIG.COLLECTION_ENABLED === true;

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const ratingLabels = {
  pertinence: {
    1:["1","Não pertinente"],
    2:["2","Pouco pertinente"],
    3:["3","Pertinente"],
    4:["4","Muito pertinente"]
  },
  complexity: {
    1:["1","Muito baixa"],
    2:["2","Baixa"],
    3:["3","Moderada"],
    4:["4","Alta"]
  },
  representativeness: {
    1:["1","Não representativo"],
    2:["2","Pouco representativo"],
    3:["3","Representativo"],
    4:["4","Muito representativo"]
  },
  global_adequacy: {
    1:["1","Inadequado"],
    2:["2","Pouco adequado"],
    3:["3","Adequado"],
    4:["4","Muito adequado"]
  }
};
document.querySelectorAll(".scale").forEach(el => {
  const name = el.dataset.name;
  const labels = ratingLabels[name];
  Object.entries(labels).forEach(([value,[n,txt]]) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="${name}" value="${value}"><span>${n}<br>${txt}</span>`;
    el.appendChild(label);
  });
});

$("consentLink").href = CONFIG.CONSENT_URL || "#";
if (!CONFIG.CONSENT_URL || CONFIG.CONSENT_URL.includes("COLE_AQUI")) {
  $("consentLink").addEventListener("click", e => e.preventDefault());
}

let session = null, cases = [], evaluations = new Map(), order = [], index = 0, saveTimer = null;
let caseLanguage = localStorage.getItem("caseLanguage") === "en" ? "en" : "pt";

const SECTION_ICONS = {
  "DADOS DO PACIENTE":"👤","DEMOGRAPHICS":"👤",
  "CONDIÇÕES CLÍNICAS ATIVAS":"🩺","RELEVANT ACTIVE CONDITIONS":"🩺",
  "MEDICAMENTOS EM USO":"💊","CURRENT MEDICATIONS":"💊",
  "ALERGIAS E INTOLERÂNCIAS":"⚠️","ALLERGIES/INTOLERANCES":"⚠️",
  "EVENTOS CLÍNICOS RECENTES":"🗓️","RECENT CLINICAL COURSE":"🗓️",
  "EXAMES LABORATORIAIS E SINAIS VITAIS RELEVANTES":"🧪","RELEVANT LABORATORY AND VITAL DATA":"🧪",
  "TAREFA CLÍNICA":"🎯","TASK":"🎯"
};
const PT_HEADINGS = ["DADOS DO PACIENTE","CONDIÇÕES CLÍNICAS ATIVAS","MEDICAMENTOS EM USO","ALERGIAS E INTOLERÂNCIAS","EVENTOS CLÍNICOS RECENTES","EXAMES LABORATORIAIS E SINAIS VITAIS RELEVANTES","TAREFA CLÍNICA"];
const EN_HEADINGS = ["Demographics","Relevant active conditions","Current medications","Allergies/intolerances","Recent clinical course","Relevant laboratory and vital data","Task"];

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
}
function parseMeta(snapshot){
  const age = snapshot?.match(/Age:\s*(\d+)/i)?.[1] || snapshot?.match(/Idade:\s*(\d+)/i)?.[1] || null;
  const rawSex = snapshot?.match(/Sex:\s*([^\n]+)/i)?.[1] || snapshot?.match(/Sexo:\s*([^\n]+)/i)?.[1] || null;
  const sex = rawSex ? rawSex.trim() : null;
  return {age: age ? Number(age) : null, sex};
}
function avatarFor({age,sex}){
  const s=(sex||"").toLowerCase();
  const female=s.includes("female")||s.includes("femin");
  const male=s.includes("male")||s.includes("mascul");
  if(age!==null && age>=60) return female?"👵":male?"👴":"🧓";
  if(age!==null && age<18) return female?"👧":male?"👦":"🧒";
  return female?"👩":male?"👨":"🧑";
}
function renderPatientHero(c){
  const meta=parseMeta(c.snapshot);
  $("patientAvatar").textContent=avatarFor(meta);
  $("patientSummary").textContent=meta.age!==null ? `Paciente de ${meta.age} anos` : "Paciente em avaliação";
  const chips=[];
  if(meta.age!==null) chips.push(`<span class="patient-chip">${meta.age} anos</span>`);
  if(meta.sex){
    const sexpt=/female/i.test(meta.sex)?"Feminino":/male/i.test(meta.sex)?"Masculino":meta.sex;
    chips.push(`<span class="patient-chip">${esc(sexpt)}</span>`);
  }
  chips.push(`<span class="patient-chip">Caso sintético</span>`);
  $("patientDetails").innerHTML=chips.join("");
}
function renderStructuredSnapshot(text, lang){
  const headings = lang==="pt" ? PT_HEADINGS : EN_HEADINGS;
  const lines=(text||"").split(/\r?\n/);
  if(lines.length && /^VAL-\d+/.test(lines[0].trim())) lines.shift();
  const sections=[]; let current=null;
  for(const raw of lines){
    const s=raw.trim();
    if(!s) continue;
    const heading=headings.find(h=>h.toLowerCase()===s.toLowerCase());
    if(heading){current={title:heading,items:[]};sections.push(current);continue;}
    if(!current){current={title:lang==="pt"?"INFORMAÇÕES DO CASO":"CASE INFORMATION",items:[]};sections.push(current);}
    current.items.push(s);
  }
  $("caseContent").innerHTML=sections.map(sec=>{
    const key=sec.title.toUpperCase();
    const icon=SECTION_ICONS[key]||"•";
    const isDemo=/DADOS DO PACIENTE|DEMOGRAPHICS/i.test(sec.title);
    const isTask=/TAREFA CLÍNICA|TASK/i.test(sec.title);
    let body="";
    if(isDemo){
      body=`<div class="case-demographics">${sec.items.map(x=>{
        const i=x.indexOf(":"); const k=i>=0?x.slice(0,i):""; const v=i>=0?x.slice(i+1).trim():x;
        return `<div class="demo-item"><strong>${esc(k)}</strong>${esc(v)}</div>`;
      }).join("")}</div>`;
    }else if(isTask){
      body=`<div>${sec.items.map(x=>esc(x.replace(/^[-•]\s*/,""))).join(" ")}</div>`;
    }else{
      body=`<ul>${sec.items.map(x=>`<li>${esc(x.replace(/^[-•]\s*/,""))}</li>`).join("")}</ul>`;
    }
    return `<section class="case-section ${isTask?"case-task":""}"><h3 class="case-section-title"><span>${icon}</span>${esc(sec.title)}</h3><div class="case-section-body">${body}</div></section>`;
  }).join("");
}
function updateLanguageButton(){
  $("languageToggle").textContent = caseLanguage==="pt" ? "Ver EN original" : "Ver PT-BR";
}

function seededRank(uid, code) {
  let h = 2166136261;
  const s = uid + "|" + code;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
  return h >>> 0;
}
function buildOrder(uid){
  order = [...cases].sort((a,b)=>seededRank(uid,a.case_code)-seededRank(uid,b.case_code));
}
function getCurrent(){ return order[index]; }
function formValue(name){
  const x = document.querySelector(`input[name="${name}"]:checked`);
  return x ? Number(x.value) : null;
}
function isCompleteData(d){
  return [d.pertinence,d.complexity,d.representativeness,d.global_adequacy].every(v=>[1,2,3,4].includes(v))
    && typeof d.blocking_issue === "boolean";
}
function readForm(){
  const b = document.querySelector('input[name="blocking_issue"]:checked');
  const data = {
    pertinence: formValue("pertinence"),
    complexity: formValue("complexity"),
    representativeness: formValue("representativeness"),
    global_adequacy: formValue("global_adequacy"),
    blocking_issue: b ? b.value === "true" : null,
    blocker_reason: $("blockerReason").value || null,
    comment: $("comment").value.trim() || null
  };
  if (data.blocking_issue !== true) data.blocker_reason = null;
  data.is_complete = isCompleteData(data);
  return data;
}
function populateForm(ev){
  $("evaluationForm").reset();
  for (const k of ["pertinence","complexity","representativeness","global_adequacy"]) {
    if (ev?.[k]) {
      const x = document.querySelector(`input[name="${k}"][value="${ev[k]}"]`);
      if (x) x.checked = true;
    }
  }
  if (typeof ev?.blocking_issue === "boolean") {
    const x = document.querySelector(`input[name="blocking_issue"][value="${ev.blocking_issue}"]`);
    if (x) x.checked = true;
  }
  $("blockerReason").value = ev?.blocker_reason || "";
  $("comment").value = ev?.comment || "";
  syncBlocker();
}
function syncBlocker(){
  const yes = document.querySelector('input[name="blocking_issue"]:checked')?.value === "true";
  $("blockerReasonWrap").classList.toggle("hidden", !yes);
}
function progress(){
  const done = [...evaluations.values()].filter(e=>e.is_complete).length;
  $("progressText").textContent = `${done} / ${cases.length}`;
  $("progressBar").style.width = `${cases.length ? 100*done/cases.length : 0}%`;
  return done;
}
function renderCase(){
  const c = getCurrent();
  if (!c) return;
  $("caseTitle").textContent = "Caso clínico em avaliação";
  $("caseMeta").textContent = `Posição ${index+1} de ${order.length} na sua sequência de avaliação`;
  $("caseBlindId").textContent = `Código interno do caso: ${c.case_code} • não corresponde à ordem de apresentação`;
  renderPatientHero(c);
  const text = caseLanguage==="pt" && c.snapshot_ptbr ? c.snapshot_ptbr : c.snapshot;
  renderStructuredSnapshot(text, caseLanguage);
  updateLanguageButton();
  populateForm(evaluations.get(c.id));
  $("prevBtn").disabled = index === 0;
  $("nextBtn").textContent = index === order.length-1 ? "Concluir →" : "Próximo →";
  $("saveState").textContent = evaluations.get(c.id)?.is_complete ? "Resposta salva." : "As alterações serão salvas automaticamente.";
  $("saveState").className = "save-state";
  window.scrollTo({top:0,behavior:"smooth"});
}
async function saveCurrent({force=false}={}){
  const c = getCurrent(); if(!c || !session) return false;
  const d = readForm();
  if (!force && !Object.values(d).some(v=>v!==null && v!==false && v!=="")) return false;
  $("saveState").textContent = "Salvando…"; $("saveState").className = "save-state saving";
  const payload = {
    evaluator_id: session.user.id, case_id: c.id, ...d,
    saved_at: new Date().toISOString(),
    completed_at: d.is_complete ? new Date().toISOString() : null
  };
  const {data,error} = await supabase.from("evaluations").upsert(payload,{onConflict:"evaluator_id,case_id"}).select().single();
  if(error){
    $("saveState").textContent = "Não foi possível salvar. Verifique sua conexão."; $("saveState").className="save-state error";
    console.error(error); return false;
  }
  evaluations.set(c.id,data);
  $("saveState").textContent = d.is_complete ? "Resposta salva." : "Rascunho salvo — complete todos os campos.";
  $("saveState").className = "save-state saved";
  progress(); return true;
}
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>saveCurrent(),450);
}
async function loadWorkspace(){
  const [{data:caseData,error:caseError},{data:evalData,error:evalError}] = await Promise.all([
    supabase.from("cases").select("id,case_code,snapshot,snapshot_ptbr").eq("active",true).order("case_code"),
    supabase.from("evaluations").select("*").eq("evaluator_id",session.user.id)
  ]);
  if(caseError) throw caseError; if(evalError) throw evalError;
  cases = caseData || []; evaluations = new Map((evalData||[]).map(x=>[x.case_id,x]));
  buildOrder(session.user.id);
  const done = progress();
  if (done === cases.length && cases.length) { show("doneView"); return; }
  const firstOpen = order.findIndex(c=>!evaluations.get(c.id)?.is_complete);
  index = firstOpen >= 0 ? firstOpen : 0;
  show("workspaceView"); renderCase();
}
async function bootstrap(){
  try{
    if (!COLLECTION_ENABLED) {
      show("accessView");
      $("accessMessage").textContent = "TCLE disponível para leitura. A coleta ainda não foi habilitada.";
      $("accessMessage").className = "message error span-2";
    }
    const {data:{session:s}} = await supabase.auth.getSession();
    session = s;
    if (!session){
      show("accessView"); return;
    }
    const {data:ok,error} = await supabase.rpc("my_access_ok");
    if(error || !ok){ show("accessView"); return; }
    $("sessionBadge").textContent = "Sessão protegida";
    $("sessionBadge").classList.remove("hidden");
    await loadWorkspace();
  }catch(e){
    console.error(e); show("accessView");
    $("accessMessage").textContent="Não foi possível iniciar a sessão. Tente novamente.";
    $("accessMessage").className="message error span-2";
  }
}
$("accessForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if (!COLLECTION_ENABLED) {
    $("accessMessage").textContent="A coleta está temporariamente bloqueada até a confirmação ética desta versão do TCLE.";
    $("accessMessage").className="message error span-2";
    return;
  }
  if (!CONFIG.CONSENT_URL || CONFIG.CONSENT_URL.includes("COLE_AQUI")) {
    $("accessMessage").textContent="O link do TCLE precisa ser configurado antes da coleta.";
    $("accessMessage").className="message error span-2"; return;
  }
  const btn=e.submitter; btn.disabled=true; btn.textContent="Validando…";
  try{
    let {data:{session:s}} = await supabase.auth.getSession();
    if(!s){
      const {data,error}=await supabase.auth.signInAnonymously();
      if(error) throw error; s=data.session;
    }
    session=s;
    const years = Number($("yearsExperience").value);
    const {data,error} = await supabase.rpc("claim_evaluator_code",{
      p_code:$("accessCode").value,
      p_professional_area:$("professionalArea").value,
      p_highest_degree:$("highestDegree").value,
      p_years_experience:years,
      p_consent_version:CONFIG.CONSENT_VERSION
    });
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.message || "Código inválido.");
    $("accessMessage").textContent="Acesso validado."; $("accessMessage").className="message ok span-2";
    await loadWorkspace();
  }catch(err){
    console.error(err);
    $("accessMessage").textContent=err.message || "Não foi possível validar o código.";
    $("accessMessage").className="message error span-2";
  }finally{btn.disabled=false;btn.textContent="Entrar na validação";}
});
$("evaluationForm").addEventListener("change",()=>{syncBlocker();scheduleSave();});
$("comment").addEventListener("input",scheduleSave);
$("prevBtn").addEventListener("click",async()=>{await saveCurrent({force:true}); if(index>0){index--;renderCase();}});
$("nextBtn").addEventListener("click",async()=>{
  const d=readForm();
  if(!d.is_complete){
    $("saveState").textContent="Complete os quatro escores e a pergunta de impedimento antes de avançar.";
    $("saveState").className="save-state error"; return;
  }
  if(d.blocking_issue && !$("blockerReason").value){
    $("saveState").textContent="Selecione o motivo do impedimento.";
    $("saveState").className="save-state error"; return;
  }
  const ok=await saveCurrent({force:true}); if(!ok)return;
  if(index===order.length-1){
    if(progress()===cases.length) show("doneView");
    else { const n=order.findIndex(c=>!evaluations.get(c.id)?.is_complete); index=n>=0?n:0;renderCase(); }
  }else{index++;renderCase();}
});
$("fontToggle").addEventListener("click",()=>{
  $("caseContent").classList.toggle("large");
  $("fontToggle").textContent=$("caseContent").classList.contains("large")?"Texto normal":"Texto maior";
});
$("languageToggle").addEventListener("click",()=>{
  caseLanguage = caseLanguage==="pt" ? "en" : "pt";
  localStorage.setItem("caseLanguage", caseLanguage);
  renderCase();
});
$("reviewBtn").addEventListener("click",()=>{show("workspaceView");index=0;renderCase();});
bootstrap();
