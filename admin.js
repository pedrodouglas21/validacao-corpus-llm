import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm";
import { CONFIG } from "./config.js";
const $ = id => document.getElementById(id);

if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("SEU-PROJETO")) throw new Error("Configure config.js");
const supabase=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:true}});

let rows=[];

function esc(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));}
function badge(status){const safe=["PENDENTE","APTO","APTO_CVI_COM_ALERTA","REVISAR"].includes(status)?status:"PENDENTE";return `<span class="status ${safe}">${safe.replaceAll("_"," ")}</span>`}
function fmt(x,d=3){return x===null||x===undefined?"—":Number(x).toFixed(d)}
function csvEscape(v){const s=v==null?"":String(v);return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
function downloadCsv(data){
  const cols=["case_code","proposed_role","backup_rank","n_ratings","i_cvi","mean_pertinence","mean_complexity","mean_representativeness","mean_global_adequacy","blocking_flags","status","source_candidate_id","original_case_id"];
  const csv=[cols.join(","),...data.map(r=>cols.map(c=>csvEscape(r[c])).join(","))].join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="validacao_corpus_resultados.csv";a.click();URL.revokeObjectURL(a.href);
}
async function isAdmin(){
  const {data,error}=await supabase.rpc("is_admin"); if(error)return false; return !!data;
}
async function load(){
  const ok=await isAdmin();
  if(!ok){$("adminLogin").classList.remove("hidden");$("adminView").classList.add("hidden");return;}
  $("adminLogin").classList.add("hidden");$("adminView").classList.remove("hidden");
  const [{data:caseRows,error:e1},{data:profiles,error:e2},{data:evals,error:e3}] = await Promise.all([
    supabase.from("v_admin_case_status").select("*").order("case_code"),
    supabase.from("evaluator_profiles").select("user_id,professional_area,highest_degree,years_experience,consented_at"),
    supabase.from("evaluations").select("evaluator_id,is_complete")
  ]);
  if(e1||e2||e3) throw e1||e2||e3;
  rows=caseRows||[];
  const complete=(evals||[]).filter(x=>x.is_complete);
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
  $("evaluatorGrid").innerHTML=(profiles||[]).map((p,i)=>`<div class="evaluator-card">
    <strong>Especialista ${i+1}</strong>
    <span>${esc(p.professional_area||"Área não informada")}</span>
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
$("exportBtn").addEventListener("click",()=>downloadCsv(rows));
supabase.auth.onAuthStateChange(()=>setTimeout(load,50));
load().catch(err=>{console.error(err);alert("Erro ao carregar o painel administrativo.");});
