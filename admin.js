import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm";
import { CONFIG } from "./config.js";
import {
  SUMMARY_COLUMNS, COMPLETE_COLUMNS, CASE_EXPORT_FIELDS, EVALUATION_EXPORT_FIELDS,
  PROFILE_EXPORT_FIELDS, buildCompleteRows, fetchExportRows, isTechnicalCode, makeCsv
} from "./admin-export.js";
const $ = id => document.getElementById(id);

if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("SEU-PROJETO")) throw new Error("Configure config.js");
const supabase=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:true}});

let rows=[];

function esc(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));}
function badge(status){const safe=["PENDENTE","APTO","APTO_CVI_COM_ALERTA","REVISAR"].includes(status)?status:"PENDENTE";return `<span class="status ${safe}">${safe.replaceAll("_"," ")}</span>`}
function fmt(x,d=3){return x===null||x===undefined?"—":Number(x).toFixed(d)}
function downloadCsv(data, columns, filename){
  const href=URL.createObjectURL(new Blob([makeCsv(data, columns)],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");
  a.href=href;
  a.download=filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function isAdmin(){
  const {data,error}=await supabase.rpc("is_admin"); if(error)return false; return !!data;
}
async function exportComplete(){
  const button=$("exportBtn"), message=$("exportMessage");
  button.disabled=true;
  message.className="message export-message";
  message.textContent="Preparando o CSV completo…";
  try{
    if(!await isAdmin()) throw new Error("Acesso administrativo necessário.");
    const [cases,profiles,evaluations,codes]=await Promise.all([
      fetchExportRows(supabase,"v_admin_case_status",CASE_EXPORT_FIELDS,"case_code"),
      fetchExportRows(supabase,"evaluator_profiles",PROFILE_EXPORT_FIELDS,"user_id"),
      fetchExportRows(supabase,"evaluations",EVALUATION_EXPORT_FIELDS,"id"),
      fetchExportRows(supabase,"evaluator_codes","id,label,active","id")
    ]);
    const detail=buildCompleteRows(cases,profiles,codes,evaluations,new Date().toISOString());
    downloadCsv(detail,COMPLETE_COLUMNS,"validacao_corpus_completo.csv");
    message.classList.add("ok");
    message.textContent=`CSV completo gerado: ${detail.length} linhas de dados.`;
  }catch(error){
    message.classList.add("error");
    message.textContent="Não foi possível exportar o CSV completo. Atualize a página e tente novamente.";
    console.error("Falha na exportação completa:",error.message);
  }finally{
    button.disabled=false;
  }
}
async function load(){
  const ok=await isAdmin();
  if(!ok){rows=[];$("exportSummaryBtn").disabled=true;$("adminLogin").classList.remove("hidden");$("adminView").classList.add("hidden");return;}
  $("adminLogin").classList.add("hidden");$("adminView").classList.remove("hidden");
  const [{data:caseRows,error:e1},{data:profiles,error:e2},{data:evals,error:e3},{data:codes,error:e4}] = await Promise.all([
    supabase.from("v_admin_case_status").select("*").order("case_code"),
    supabase.from("evaluator_profiles").select("user_id,code_id,professional_area,highest_degree,years_experience,consented_at"),
    supabase.from("evaluations").select("evaluator_id,is_complete"),
    supabase.from("evaluator_codes").select("id,label")
  ]);
  if(e1||e2||e3||e4) throw e1||e2||e3||e4;
  rows=caseRows||[];
  $("exportSummaryBtn").disabled=!rows.length;
  // Chaves técnicas ficam preservadas para auditoria, mas não entram nos indicadores oficiais.
  const technicalCodeIds=new Set((codes||[])
    .filter(isTechnicalCode)
    .map(c=>c.id));
  const technicalUserIds=new Set((profiles||[])
    .filter(p=>technicalCodeIds.has(p.code_id))
    .map(p=>p.user_id));
  const codeById=new Map((codes||[]).map(c=>[c.id,c]));
  // A identificação deve vir do código; a ordem de retorno das linhas pode mudar.
  const labelFor=p=>codeById.get(p.code_id)?.label || "Especialista sem código";
  const officialProfiles=(profiles||[])
    .filter(p=>!technicalUserIds.has(p.user_id))
    .sort((a,b)=>labelFor(a).localeCompare(labelFor(b),"pt-BR",{numeric:true}));
  const complete=(evals||[]).filter(x=>x.is_complete&&!technicalUserIds.has(x.evaluator_id));
  const primary=rows.filter(x=>x.proposed_role==="primary");
  const fully=primary.filter(x=>Number(x.n_ratings)===CONFIG.REQUIRED_RATERS);
  // Só divulga o índice final com os 80 casos principais completos; usa frações sem arredondar.
  const scvi=primary.length===80 && fully.length===80
    ? primary.reduce((s,r)=>s+Number(r.n_valid)/Number(r.n_ratings),0)/80 : null;
  $("mEvaluations").textContent=complete.length;
  $("mReady").textContent=`${fully.length} / ${primary.length}`;
  $("mSCVI").textContent=scvi==null?"—":scvi.toFixed(3);
  $("mReview").textContent=primary.filter(r=>Number(r.n_ratings)===CONFIG.REQUIRED_RATERS && Number(r.n_valid)/Number(r.n_ratings)<CONFIG.I_CVI_THRESHOLD).length;

  $("caseTable").innerHTML=rows.map(r=>`<tr>
    <td><strong>${esc(r.case_code)}</strong></td>
    <td>${esc(r.proposed_role)}${r.backup_rank?` #${Number(r.backup_rank)}`:""}</td>
    <td>${Number(r.n_ratings)}</td><td>${fmt(r.i_cvi)}</td>
    <td>${fmt(r.mean_pertinence,2)}</td><td>${fmt(r.mean_complexity,2)}</td>
    <td>${fmt(r.mean_representativeness,2)}</td><td>${fmt(r.mean_global_adequacy,2)}</td>
    <td>${Number(r.blocking_flags)}</td><td>${badge(r.status)}</td></tr>`).join("");

  const counts=new Map();
  complete.forEach(e=>counts.set(e.evaluator_id,(counts.get(e.evaluator_id)||0)+1));
  $("evaluatorGrid").innerHTML=officialProfiles.map(p=>`<div class="evaluator-card">
    <strong>${esc(labelFor(p))}</strong>
    <span>${esc(p.professional_area||"Área não informada")}</span>
    <span>${esc(p.highest_degree||"Titulação não informada")}${p.years_experience==null?"":` • ${Number(p.years_experience)} anos de experiência`}</span>
    <div class="progress-track"><div class="progress-bar" style="width:${100*(counts.get(p.user_id)||0)/rows.length}%"></div></div>
    <span>${counts.get(p.user_id)||0} / ${rows.length} casos completos</span>
  </div>`).join("");
}
$("adminLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("adminEmail").value.trim();
  $("adminLoginMessage").textContent="Enviando link…";
  const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.href}});
  $("adminLoginMessage").textContent=error?error.message:"Confira seu e-mail e abra o link de acesso.";
  $("adminLoginMessage").className=error?"message error span-2":"message ok span-2";
});
$("logoutBtn").addEventListener("click",async()=>{await supabase.auth.signOut();location.reload();});
$("exportBtn").addEventListener("click",exportComplete);
$("exportSummaryBtn").addEventListener("click",()=>downloadCsv(rows,SUMMARY_COLUMNS,"validacao_corpus_resultados.csv"));
supabase.auth.onAuthStateChange(()=>setTimeout(load,50));
load().catch(err=>{console.error(err);alert("Erro ao carregar o painel administrativo.");});
