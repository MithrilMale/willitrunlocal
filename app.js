(function(){
"use strict";
const D=window.MACFORAI_DATA, CFG=window.MACFORAI_CONFIG, A=D.assumptions, GiB=Math.pow(2,30);
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const macsById=Object.fromEntries(D.macs.map(m=>[m.id,m])), modelsById=Object.fromEntries(D.models.map(m=>[m.id,m]));
const money=n=>n==null?null:"$"+n.toLocaleString("en-US");

/* ---------- deterministic fit logic (mirrors scripts/build_data.py) ---------- */
function kvBytes(m,ctx){ctx=Math.min(ctx,m.max_context);return m.kv_full_bytes_per_token*ctx+m.kv_swa_bytes_per_token*Math.min(ctx,m.kv_swa_window||0)+m.kv_fixed_state_bytes;}
function needGiB(m,q,ctx){const w=q==="Q4"?m.q4_bytes:m.q8_bytes;return (w+kvBytes(m,ctx))/GiB+A.runtime_overhead_gib;}
function gpuLimit(mem){return mem*(mem<=32?A.default_gpu_limit_fraction_le32gb:A.default_gpu_limit_fraction_gt32gb);}
function status(mem,need){const lim=gpuLimit(mem);if(need<=lim*A.tight_fraction)return"fits";if(need<=lim)return"tight";if(need<=mem-A.macos_headroom_gib)return"tuned";return"no";}
function ceiling(mac,m,q){const gb=q==="Q4"?m.q4_gb:m.q8_gb;return mac.bandwidth_gb_s/(gb*(m.active_params_b/m.params_b));}
const LABEL={fits:"Fits",tight:"Tight fit",tuned:"Only with GPU-limit tweak",no:"Doesn't fit"};
const badge=s=>`<span class="badge b-${s}">${LABEL[s]}</span>`;

/* ---------- speeds ---------- */
const speedsBy={};D.speeds.forEach(s=>{(speedsBy[s.perf_key+"|"+s.model_id]=speedsBy[s.perf_key+"|"+s.model_id]||[]).push(s);});
function speedHtml(mac,model){
  const rows=speedsBy[mac.perf_key+"|"+model.id]||[];
  if(!rows.length)return'<span class="mute">no public measurement</span>';
  return rows.map(s=>`<span class="sp"><span class="v">${s.tokens_per_sec} tok/s</span> <span class="mute">${esc(s.quant)} · ${esc(s.engine)} · ctx ${esc(s.context)} · ${esc(s.source_type)}</span> <span class="src"><a href="${esc(s.source_url)}" target="_blank" rel="noopener">source</a></span></span>`).join("");
}
function refSpeedHtml(mac){
  const rows=speedsBy[mac.perf_key+"|ref_llama2_7b"]||[];
  if(!rows.length)return'<span class="mute">No public llama.cpp reference result found for this exact chip/GPU-core variant.</span>';
  const q4=rows.find(r=>r.quant==="Q4_0"),q8=rows.find(r=>r.quant==="Q8_0");
  return `Llama 2 7B (llama.cpp tg128): <b>${q4.tokens_per_sec}</b> tok/s Q4_0 · <b>${q8.tokens_per_sec}</b> tok/s Q8_0 <span class="mute small">(build ${esc(q4.build_or_version)}${q4.build_or_version==="8e672ef"?", older build - not comparable with M5/M6 rows":""})</span> <a class="small" href="${esc(q4.source_url)}" target="_blank" rel="noopener">source</a>`;
}

/* ---------- affiliate placeholders ---------- */
function affHtml(mac){
  const live=CFG.AMAZON_ASSOCIATE_TAG&&CFG.AMAZON_ASSOCIATE_TAG!=="REPLACE_WITH_ASSOCIATE_TAG";
  if(mac.status==="previous")return"";
  const q=encodeURIComponent(mac.name.replace(/ \[.*\]/,"")+" Apple");
  if(live)return`<a class="aff live" rel="sponsored noopener" target="_blank" href="https://www.amazon.com/s?k=${q}&tag=${encodeURIComponent(CFG.AMAZON_ASSOCIATE_TAG)}">Amazon (affiliate link)</a>`;
  return`<span class="aff" title="Placeholder. Not a live link. Set AMAZON_ASSOCIATE_TAG in config.js after Associates approval.">Amazon [AFFILIATE LINK PLACEHOLDER]</span>`;
}
function priceHtml(mac){
  if(mac.price_usd==null)return`<span class="mute">price not captured</span>`;
  return`${money(mac.price_usd)} <span class="mute small" title="${esc(mac.price_basis)}">(<a href="${esc(mac.price_source_url)}" target="_blank" rel="noopener">basis</a>)</span>`;
}

/* ---------- state / controls ---------- */
const state={tab:"mac",mac:null,model:null,quant:"Q4",ctx:8192,showTuned:true,showNo:false,ceil:false};
function fillSelect(sel,items,groupFn,labelFn){
  const groups={};items.forEach(i=>{const g=groupFn(i);(groups[g]=groups[g]||[]).push(i);});
  sel.innerHTML=Object.entries(groups).map(([g,list])=>`<optgroup label="${esc(g)}">${list.map(i=>`<option value="${esc(i.id)}">${esc(labelFn(i))}</option>`).join("")}</optgroup>`).join("");
}
function init(){
  fillSelect($("#macSel"),D.macs,m=>m.status==="previous"?"Previous generation (not sold by Apple now)":m.family,m=>`${m.name.replace(/ \[previous gen\]/,"")} - ${m.price_usd!=null?money(m.price_usd):"price n/a"}`);
  fillSelect($("#modelSel"),D.models,m=>m.family,m=>`${m.name} (${m.params_b}B${m.arch==="MoE"?", MoE, "+m.active_params_b+"B active":""})`);
  state.mac=D.macs.find(m=>m.id==="mini_m6_32")?"mini_m6_32":D.macs[0].id;state.model="gptoss_120b";
  const qp=new URLSearchParams(location.search);   // deep links: ?tab=model&model=llama33_70b&mac=...&q=Q8&ctx=32768
  if(qp.get("tab"))state.tab=qp.get("tab");if(macsById[qp.get("mac")])state.mac=qp.get("mac");if(modelsById[qp.get("model")])state.model=qp.get("model");
  if(qp.get("q"))state.quant=qp.get("q")==="Q8"?"Q8":"Q4";if(qp.get("ctx"))state.ctx=+qp.get("ctx");
  $("#quantSel").value=state.quant;$("#ctxSel").value=String(state.ctx);
  $("#macSel").value=state.mac;$("#modelSel").value=state.model;
  $("#macSel").onchange=e=>{state.mac=e.target.value;render();};
  $("#modelSel").onchange=e=>{state.model=e.target.value;render();};
  $("#quantSel").onchange=e=>{state.quant=e.target.value;render();};
  $("#ctxSel").onchange=e=>{state.ctx=+e.target.value;render();};
  $("#showTuned").onchange=e=>{state.showTuned=e.target.checked;render();};
  $("#showNo").onchange=e=>{state.showNo=e.target.checked;render();};
  $("#ceil").onchange=e=>{state.ceil=e.target.checked;render();};
  document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render();});
  $("#assumptions").textContent=`Fit = model file size (Hugging Face GGUF) + fp16 KV cache for the chosen context (from model config.json) + ${A.runtime_overhead_gib} GiB runtime overhead, compared against macOS's default GPU memory limit (about 2/3 of unified memory up to 32GB, 3/4 above) or, with a tweak, memory minus ${A.macos_headroom_gib} GiB. "Tight" = over ${A.tight_fraction*100}% of the default limit. These margins are assumptions, not measurements.`;
  render();
}
function render(){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on",b.dataset.tab===state.tab));
  $("#tabMac").classList.toggle("hide",state.tab!=="mac");$("#tabModel").classList.toggle("hide",state.tab!=="model");
  $("#ceilNote").classList.toggle("hide",!state.ceil);
  state.tab==="mac"?renderMac():renderModel();
}
function renderMac(){
  const mac=macsById[state.mac];
  const lim=gpuLimit(mac.memory_gb);
  $("#macInfo").innerHTML=`<div class="kpi"><div><span class="mute small">Chip</span><b>${esc(mac.chip)}</b><span class="small mute">${mac.cpu_cores}-core CPU / ${mac.gpu_cores}-core GPU</span></div>
  <div><span class="mute small">Unified memory</span><b>${mac.memory_gb} GB</b><span class="small mute">default GPU limit ~${lim.toFixed(1)} GiB</span></div>
  <div><span class="mute small">Memory bandwidth</span><b>${mac.bandwidth_gb_s} GB/s</b><a class="small" href="${esc(mac.bandwidth_source_url)}" target="_blank" rel="noopener">Apple spec</a></div>
  <div><span class="mute small">US price (apple.com)</span><b>${mac.price_usd!=null?money(mac.price_usd):"n/a"}</b><span class="small mute">${esc(mac.price_basis)}</span></div></div>
  <p class="small" style="margin:10px 0 4px">${refSpeedHtml(mac)}</p><p>${affHtml(mac)}</p>`;
  const rows=D.models.map(m=>{const need=needGiB(m,state.quant,state.ctx);return{m,need,st:status(mac.memory_gb,need),eff:Math.min(state.ctx,m.max_context)};})
   .filter(r=>(r.st!=="no"||state.showNo)&&(r.st!=="tuned"||state.showTuned||state.showNo));
  const ord={fits:0,tight:1,tuned:2,no:3};rows.sort((a,b)=>ord[a.st]-ord[b.st]||b.m.params_b-a.m.params_b);
  $("#macTable tbody").innerHTML=rows.map(r=>{const m=r.m,w=(state.quant==="Q4"?m.q4_bytes:m.q8_bytes)/GiB,kv=kvBytes(m,state.ctx)/GiB;
   return`<tr><td><b>${esc(m.name)}</b><br><span class="mute small">${m.params_b}B ${m.arch}${m.arch==="MoE"?" ("+m.active_params_b+"B active)":""} · ${esc(m.license)}</span></td>
   <td>${badge(r.st)}${r.eff<state.ctx?`<br><span class="small mute">model max ctx ${m.max_context.toLocaleString()}</span>`:""}</td>
   <td class="num">${w.toFixed(1)}</td><td class="num">${kv.toFixed(2)}</td><td class="num">${r.need.toFixed(1)}</td>
   <td>${speedHtml(mac,m)}${state.ceil?`<span class="sp mute">calc. bandwidth ceiling ≈ ${Math.round(ceiling(mac,m,state.quant))} tok/s (not measured)</span>`:""}</td></tr>`;}).join("")||`<tr><td colspan="6" class="mute">Nothing fits with these settings.</td></tr>`;
}
function renderModel(){
  const m=modelsById[state.model];const need=needGiB(m,state.quant,state.ctx);
  const w=(state.quant==="Q4"?m.q4_bytes:m.q8_bytes)/GiB,kv=kvBytes(m,state.ctx)/GiB;
  const all=D.macs.map(mc=>({mc,st:status(mc.memory_gb,need)}));
  const cur=all.filter(r=>r.mc.status!=="previous");
  const cheap=(sts)=>cur.filter(r=>r.mc.price_usd!=null&&sts.includes(r.st)).sort((a,b)=>a.mc.price_usd-b.mc.price_usd)[0];
  const c1=cheap(["fits","tight"]),c2=cheap(["tuned"]);
  const unpr=cur.filter(r=>r.mc.price_usd==null&&["fits","tight"].includes(r.st)).sort((a,b)=>a.mc.memory_gb-b.mc.memory_gb)[0];
  $("#modelInfo").innerHTML=`<div class="kpi"><div><span class="mute small">Parameters</span><b>${m.params_b}B</b><span class="small mute">${m.arch}${m.arch==="MoE"?", "+m.active_params_b+"B active":""}</span></div>
  <div><span class="mute small">${state.quant==="Q4"?"Q4_K_M":"Q8_0"} weights</span><b>${w.toFixed(1)} GiB</b><a class="small" href="${esc(m.gguf_url)}" target="_blank" rel="noopener">GGUF file</a></div>
  <div><span class="mute small">KV cache @ ${Math.min(state.ctx,m.max_context).toLocaleString()} ctx</span><b>${kv.toFixed(2)} GiB</b><a class="small" href="${esc(m.config_url)}" target="_blank" rel="noopener">config.json</a></div>
  <div><span class="mute small">Total needed</span><b>${need.toFixed(1)} GiB</b><span class="small mute">incl. ${A.runtime_overhead_gib} GiB overhead</span></div></div>
  <h3>Cheapest Mac that runs it</h3>
  <p>${c1?`<b>${esc(c1.mc.name)}</b> - ${money(c1.mc.price_usd)} ${badge(c1.st)} ${affHtml(c1.mc)}`:`<span class="mute">No current Mac with a captured price runs this model within the default GPU limit.</span>`}</p>
  ${c2&&(!c1||c2.mc.price_usd<c1.mc.price_usd)?`<p class="small">Cheaper if you raise the GPU memory limit: <b>${esc(c2.mc.name)}</b> - ${money(c2.mc.price_usd)} ${badge("tuned")}</p>`:""}
  ${unpr&&(!c1||unpr.mc.memory_gb<c1.mc.memory_gb)?`<p class="small mute">Note: <b>${esc(unpr.mc.name)}</b> also fits but its upgrade price was not captured, so it is excluded from "cheapest".</p>`:""}`;
  const ord={fits:0,tight:0,tuned:2,no:3};
  const rows=all.filter(r=>(r.st!=="no"||state.showNo)&&(r.st!=="tuned"||state.showTuned||state.showNo))
    .sort((a,b)=>ord[a.st]-ord[b.st]||((a.mc.price_usd??1e9)-(b.mc.price_usd??1e9))||a.mc.memory_gb-b.mc.memory_gb);
  $("#modelTable tbody").innerHTML=rows.map(r=>{const mc=r.mc;
   return`<tr><td><b>${esc(mc.name)}</b><br><span class="mute small">${mc.memory_gb}GB · ${mc.bandwidth_gb_s} GB/s</span></td><td>${badge(r.st)}</td>
   <td class="num">${priceHtml(mc)}</td><td class="num">${(need/(mc.memory_gb)*100).toFixed(0)}%</td>
   <td>${speedHtml(mc,m)}${state.ceil?`<span class="sp mute">calc. ceiling ≈ ${Math.round(ceiling(mc,m,state.quant))} tok/s (not measured)</span>`:""}</td><td>${affHtml(mc)}</td></tr>`;}).join("")||`<tr><td colspan="6" class="mute">No Mac fits.</td></tr>`;
}
window.MACFORAI_LOGIC={needGiB,status,kvBytes,ceiling,gpuLimit};
document.addEventListener("DOMContentLoaded",init);
})();
