import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

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

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const labels = {
  1:["1","Inadequado"],
  2:["2","Pouco adequado"],
  3:["3","Adequado"],
  4:["4","Muito adequado"]
};
document.querySelectorAll(".scale").forEach(el => {
  const name = el.dataset.name;
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
  $("caseTitle").textContent = c.case_code;
  $("caseMeta").textContent = `Caso ${index+1} de ${order.length} • ordem individual randomizada`;
  $("caseText").textContent = c.snapshot;
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
    supabase.from("cases").select("id,case_code,snapshot").eq("active",true).order("case_code"),
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
  $("caseText").classList.toggle("large");
  $("fontToggle").textContent=$("caseText").classList.contains("large")?"Texto normal":"Texto maior";
});
$("reviewBtn").addEventListener("click",()=>{show("workspaceView");index=0;renderCase();});
bootstrap();
