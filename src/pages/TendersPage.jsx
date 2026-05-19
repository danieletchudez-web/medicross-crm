import { useEffect, useMemo, useState, useRef } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./tenders.css";

const ESTADOS = [
  "En análisis","Cotizada","Presentada","Adjudicada",
  "Orden de compra recibida","En ejecución","Entrega parcial",
  "Entregada","Facturada","Cobrada","Finalizada",
  "Perdida / No adjudicada","Vencida",
];
const PRIORIDADES  = ["Baja","Media","Alta","Crítica"];
const DOC_ESTADOS  = ["Completa","Incompleta","Pendiente"];
const BILL_ESTADOS = ["Pendiente","Parcial","Facturada","Cobrada"];
const DEL_ESTADOS  = ["Pendiente","Parcial","Completa"];
const TENDER_TYPES = ["Original","Ampliación","Prórroga","Otro"];
const BUCKET       = "tenders-docs";

const EMPTY_FORM = {
  jurisdiction:"", institution:"", process_type:"", process_number:"",
  tender_type:"Original", process_name:"", expedient_number:"",
  requesting_sector:"", contract_term:"", purchase_order_number:"",
  purchase_order_date:"", purchase_order_amount:"",
  start_date:"", end_date:"", validity_status:"En análisis",
  execution_policy:"", bridge_ot:"", internal_owner:"",
  product_line:"", operational_status:"En análisis",
  next_action:"", next_action_date:"",
  documentation_status:"Pendiente", documentation_pending_detail:"",
  billing_status:"Pendiente", delivery_status:"Pendiente",
  priority:"Media", portal_link:"", notes:"",
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d+"T00:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"});
}
function compactMoney(v) {
  const n=Number(v||0); if(!n) return "—";
  if(n>=1_000_000_000) return `$${(n/1_000_000_000).toFixed(1).replace(".",",")} MM`;
  if(n>=1_000_000)     return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
  if(n>=1_000)         return `$${Math.round(n/1_000)} K`;
  return `$${n}`;
}
function daysUntil(d) {
  if(!d) return null;
  return Math.ceil((new Date(d+"T00:00:00")-new Date())/86400000);
}
function endColor(d) {
  const days=daysUntil(d);
  if(days===null) return "gray";
  if(days<0||days<7) return "red";
  if(days<15) return "orange";
  if(days<30) return "yellow";
  return "green";
}
function actionColor(t) {
  if(!t.next_action) return "red";
  if(!t.next_action_date) return "yellow";
  const days=daysUntil(t.next_action_date);
  if(days<0) return "red";
  if(days<=3) return "yellow";
  return "green";
}
function statusBadge(s) {
  const m={"En análisis":"blue","Cotizada":"blue","Presentada":"yellow","Adjudicada":"green","Orden de compra recibida":"green","En ejecución":"green","Entrega parcial":"orange","Entregada":"green","Facturada":"purple","Cobrada":"green","Finalizada":"gray","Perdida / No adjudicada":"red","Vencida":"red"};
  return m[s]||"gray";
}
function pClass(p){ return {Alta:"alta",Crítica:"critica",Media:"media",Baja:"baja"}[p]||"baja"; }
function pIcon(p) { return {Alta:"▲",Crítica:"⬆",Media:"→",Baja:"▼"}[p]||"→"; }
function fileIcon(name) {
  const ext=name.split(".").pop().toLowerCase();
  if(ext==="pdf") return "📄";
  if(ext==="xlsx"||ext==="xls") return "📊";
  if(ext==="docx"||ext==="doc") return "📝";
  return "📎";
}

const COLS = [
  { key:"_check",               label:"☑",             w:36,  fixed:true },
  { key:"_alert",               label:"⚡",             w:44,  fixed:true },
  { key:"jurisdiction",         label:"Jurisdicción",   w:120 },
  { key:"institution",          label:"Hospital/Inst.", w:200 },
  { key:"process_number",       label:"N° Proceso",     w:130 },
  { key:"process_name",         label:"Nombre proceso", w:220 },
  { key:"expedient_number",     label:"Expediente",     w:140 },
  { key:"process_type",         label:"Tipo proceso",   w:160 },
  { key:"tender_type",          label:"Tipo",           w:100 },
  { key:"purchase_order_number",label:"N° OC",          w:120 },
  { key:"purchase_order_date",  label:"Fecha OC",       w:100 },
  { key:"purchase_order_amount",label:"Monto OC",       w:120 },
  { key:"start_date",           label:"Inicio",         w:90  },
  { key:"end_date",             label:"Fin",            w:90  },
  { key:"operational_status",   label:"Estado",         w:180 },
  { key:"priority",             label:"Prioridad",      w:90  },
  { key:"internal_owner",       label:"Responsable",    w:130 },
  { key:"product_line",         label:"Línea prod.",    w:130 },
  { key:"next_action",          label:"Próxima acción", w:180 },
  { key:"next_action_date",     label:"Fecha acción",   w:100 },
  { key:"documentation_status", label:"Doc.",           w:110 },
  { key:"billing_status",       label:"Facturación",    w:110 },
  { key:"delivery_status",      label:"Entrega",        w:100 },
  { key:"execution_policy",     label:"Póliza",         w:110 },
  { key:"bridge_ot",            label:"OT Bridge",      w:110 },
  { key:"contract_term",        label:"Plazo",          w:90  },
  { key:"requesting_sector",    label:"Sector",         w:130 },
  { key:"_attachments",         label:"📎",             w:70  },
  { key:"notes",                label:"Observaciones",  w:200 },
  { key:"_actions",             label:"",               w:80,  fixed:true },
];

/* ─── Componente inline de adjuntos (usado dentro del formulario) ────── */
function InlineAttachments({ tenderId }) {
  const [files,     setFiles]     = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const inputRef = useRef(null);
  const folder   = `tender_${tenderId}`;

  useEffect(() => { if(tenderId) loadFiles(); }, [tenderId]);

  async function loadFiles() {
    setLoading(true);
    const { data, error } = await supabase.storage.from(BUCKET).list(folder);
    if (!error) setFiles(data||[]);
    setLoading(false);
  }

  async function handleUpload(e) {
    const fileList = Array.from(e.target.files||[]);
    if (!fileList.length) return;
    setUploading(true);
    for (const file of fileList) {
      // Sanitizar nombre: reemplazar caracteres no permitidos
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .replace(/[^a-zA-Z0-9._-]/g,"_");
      const path = `${folder}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) console.error("Upload error:", error.message);
    }
    await loadFiles();
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete(name) {
    if (!confirm(`¿Eliminar "${name.replace(/^\d+_/,"")}"?`)) return;
    await supabase.storage.from(BUCKET).remove([`${folder}/${name}`]);
    setFiles(prev => prev.filter(f => f.name !== name));
  }

  function getUrl(name) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(`${folder}/${name}`);
    return data.publicUrl;
  }

  return (
    <div className="tn-inline-attach">
      {/* Upload button */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <button
          type="button"
          className="tn-btn tn-btn--ghost tn-btn--sm"
          onClick={()=>inputRef.current?.click()}
          disabled={uploading}
          style={{display:"flex",alignItems:"center",gap:6}}
        >
          📎 {uploading ? "Subiendo…" : "Adjuntar archivos"}
        </button>
        <span style={{fontSize:11,color:"#94a3b8"}}>PDF, Word, Excel</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx"
          style={{display:"none"}}
          onChange={handleUpload}
        />
      </div>

      {/* Lista */}
      {loading ? (
        <p style={{fontSize:12,color:"#94a3b8",margin:0}}>Cargando archivos…</p>
      ) : files.length === 0 ? (
        <p style={{fontSize:12,color:"#94a3b8",margin:0}}>Sin archivos adjuntos. Usá el botón para subir.</p>
      ) : (
        <div className="tn-file-list">
          {files.map(f=>(
            <div key={f.name} className="tn-file-row">
              <span className="tn-file-icon">{fileIcon(f.name)}</span>
              <span className="tn-file-name" title={f.name.replace(/^\d+_/,"")}>
                {f.name.replace(/^\d+_/,"")}
              </span>
              <span className="tn-file-size">
                {f.metadata?.size ? `${Math.round(f.metadata.size/1024)} KB` : ""}
              </span>
              <div className="tn-file-actions">
                <a
                  href={getUrl(f.name)}
                  target="_blank"
                  rel="noreferrer"
                  className="tn-btn tn-btn--ghost tn-btn--sm"
                  title="Ver / Descargar"
                >⬇</a>
                <button
                  type="button"
                  className="tn-btn tn-btn--danger tn-btn--sm"
                  onClick={()=>handleDelete(f.name)}
                  title="Eliminar"
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────── */
export default function TendersPage({ profile, onNavigate }) {
  const [tenders,    setTenders]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editData,   setEditData]   = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [selected,   setSelected]   = useState(new Set());
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [sortCol,    setSortCol]    = useState("created_at");
  const [sortDir,    setSortDir]    = useState("desc");
  const [colFilters, setColFilters] = useState({});
  const [globalQ,    setGlobalQ]    = useState("");
  const [attachCounts, setAttachCounts] = useState({});

  useEffect(() => { loadTenders(); }, []);

  async function loadTenders() {
    setLoading(true);
    const { data } = await supabase.from("tenders").select("*").order("created_at",{ascending:false});
    const rows = data||[];
    setTenders(rows);
    setLoading(false);
    loadAttachCounts(rows);
  }

  async function loadAttachCounts(rows) {
    const counts = {};
    await Promise.all(rows.map(async t => {
      const { data } = await supabase.storage.from(BUCKET).list(`tender_${t.id}`);
      counts[t.id] = data?.length||0;
    }));
    setAttachCounts(counts);
  }

  const kpis = useMemo(()=>{
    const activas    = tenders.filter(t=>!["Finalizada","Perdida / No adjudicada","Vencida"].includes(t.operational_status));
    const montoTotal = activas.reduce((s,t)=>s+Number(t.purchase_order_amount||0),0);
    const adjMontos  = tenders.filter(t=>["Adjudicada","Orden de compra recibida","En ejecución","Entrega parcial","Entregada","Facturada","Cobrada"].includes(t.operational_status)).reduce((s,t)=>s+Number(t.purchase_order_amount||0),0);
    const proxVencer = tenders.filter(t=>{ const d=daysUntil(t.end_date); return d!==null&&d>=0&&d<=30; }).length;
    const vencidas   = tenders.filter(t=>{ const d=daysUntil(t.end_date); return d!==null&&d<0&&!["Finalizada","Cobrada"].includes(t.operational_status); }).length;
    const sinAccion  = tenders.filter(t=>!t.next_action&&!["Finalizada","Cobrada","Perdida / No adjudicada"].includes(t.operational_status)).length;
    const docPend    = tenders.filter(t=>t.documentation_status==="Pendiente"&&!["Finalizada","Cobrada"].includes(t.operational_status)).length;
    return {activas:activas.length,montoTotal,adjMontos,proxVencer,vencidas,sinAccion,docPend};
  },[tenders]);

  const filtered = useMemo(()=>{
    let rows=[...tenders];
    if(globalQ){
      const q=globalQ.toLowerCase();
      rows=rows.filter(t=>Object.values(t).some(v=>v&&String(v).toLowerCase().includes(q)));
    }
    Object.entries(colFilters).forEach(([k,v])=>{
      if(!v) return;
      rows=rows.filter(t=>String(t[k]||"").toLowerCase().includes(v.toLowerCase()));
    });
    rows.sort((a,b)=>{
      const av=a[sortCol]||"",bv=b[sortCol]||"";
      return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
    });
    return rows;
  },[tenders,globalQ,colFilters,sortCol,sortDir]);

  function setColFilter(k,v){ setColFilters(prev=>({...prev,[k]:v})); }
  function toggleSort(k){ if(sortCol===k) setSortDir(d=>d==="asc"?"desc":"asc"); else{ setSortCol(k); setSortDir("asc"); } }
  function toggleSelect(id){ setSelected(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; }); }
  function toggleSelectAll(){ setSelected(prev=>prev.size===filtered.length?new Set():new Set(filtered.map(t=>t.id))); }

  function openNew(){
    setEditData(null);
    setForm({...EMPTY_FORM});
    setShowForm(true);
  }

  /* Click en fila → abre edición */
  function openEdit(t, e) {
    e?.stopPropagation();
    setEditData(t);
    setForm({
      jurisdiction:t.jurisdiction||"", institution:t.institution||"",
      process_type:t.process_type||"", process_number:t.process_number||"",
      tender_type:t.tender_type||"Original", process_name:t.process_name||"",
      expedient_number:t.expedient_number||"", requesting_sector:t.requesting_sector||"",
      contract_term:t.contract_term||"", purchase_order_number:t.purchase_order_number||"",
      purchase_order_date:t.purchase_order_date||"", purchase_order_amount:t.purchase_order_amount||"",
      start_date:t.start_date||"", end_date:t.end_date||"",
      validity_status:t.validity_status||"En análisis", execution_policy:t.execution_policy||"",
      bridge_ot:t.bridge_ot||"", internal_owner:t.internal_owner||"",
      product_line:t.product_line||"", operational_status:t.operational_status||"En análisis",
      next_action:t.next_action||"", next_action_date:t.next_action_date||"",
      documentation_status:t.documentation_status||"Pendiente",
      documentation_pending_detail:t.documentation_pending_detail||"",
      billing_status:t.billing_status||"Pendiente", delivery_status:t.delivery_status||"Pendiente",
      priority:t.priority||"Media", portal_link:t.portal_link||"", notes:t.notes||"",
    });
    setShowForm(true);
  }

  function setF(k,v){ setForm(prev=>({...prev,[k]:typeof v==="string"?v.toUpperCase():v})); }

  async function saveTender(){
    setSaving(true);
    const payload={
      ...form,
      purchase_order_amount:form.purchase_order_amount?Number(form.purchase_order_amount):null,
      purchase_order_date:form.purchase_order_date||null,
      start_date:form.start_date||null,
      end_date:form.end_date||null,
      next_action_date:form.next_action_date||null,
      owner_id:profile?.id,
      updated_at:new Date().toISOString(),
    };
    if(editData){
      const{error}=await supabase.from("tenders").update(payload).eq("id",editData.id);
      if(error){ alert("Error: "+error.message); setSaving(false); return; }
    } else {
      const{error}=await supabase.from("tenders").insert([payload]);
      if(error){ alert("Error: "+error.message); setSaving(false); return; }
    }
    await loadTenders();
    setSaving(false);
    setShowForm(false);
  }

  async function deleteTender(id,e){
    e?.stopPropagation();
    if(!confirm("¿Eliminar esta licitación y todos sus adjuntos?")) return;
    const { data: files } = await supabase.storage.from(BUCKET).list(`tender_${id}`);
    if(files?.length) await supabase.storage.from(BUCKET).remove(files.map(f=>`tender_${id}/${f.name}`));
    await supabase.from("tenders").delete().eq("id",id);
    setTenders(p=>p.filter(t=>t.id!==id));
    if(showForm && editData?.id===id) setShowForm(false);
  }

  function exportToExcel(){
    const rows=filtered.filter(t=>selected.size===0||selected.has(t.id));
    if(!rows.length){ alert("No hay filas para exportar."); return; }
    const headers=["Jurisdicción","Hospital/Institución","N° Proceso","Nombre Proceso","Expediente","Tipo Proceso","Tipo","N° OC","Fecha OC","Monto OC","Fecha Inicio","Fecha Fin","Estado Operativo","Prioridad","Responsable","Línea Producto","Próxima Acción","Fecha Próx. Acción","Documentación","Facturación","Entrega","Póliza","OT Bridge","Plazo Contrato","Sector Solicitante","Estado Vigencia","Portal","Observaciones"];
    const keys=["jurisdiction","institution","process_number","process_name","expedient_number","process_type","tender_type","purchase_order_number","purchase_order_date","purchase_order_amount","start_date","end_date","operational_status","priority","internal_owner","product_line","next_action","next_action_date","documentation_status","billing_status","delivery_status","execution_policy","bridge_ot","contract_term","requesting_sector","validity_status","portal_link","notes"];
    const csv=[headers.join(";"),...rows.map(r=>keys.map(k=>`"${String(r[k]||"").replace(/"/g,'""')}"`).join(";"))].join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`licitaciones_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function renderCell(col,t){
    switch(col.key){
      case "_check":
        return <input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} onClick={e=>e.stopPropagation()} style={{cursor:"pointer",width:14,height:14,accentColor:"#0f2444"}}/>;
      case "_alert":
        return (
          <div style={{display:"flex",gap:3,justifyContent:"center"}}>
            <span className={`tn-alert-dot tn-alert-dot--${endColor(t.end_date)}`} title={`Venc: ${fmtDate(t.end_date)}`}/>
            <span className={`tn-alert-dot tn-alert-dot--${actionColor(t)}`} title={`Acción: ${t.next_action||"Sin definir"}`}/>
          </div>
        );
      case "_attachments": {
        const cnt=attachCounts[t.id]||0;
        return (
          <span
            className="tn-attach-btn"
            onClick={e=>{ e.stopPropagation(); openEdit(t,e); }}
            title={`${cnt} adjunto${cnt!==1?"s":""} — click para abrir`}
          >
            📎 {cnt>0?<span className="tn-attach-count">{cnt}</span>:<span style={{color:"#94a3b8",fontSize:10}}>0</span>}
          </span>
        );
      }
      case "_actions":
        return (
          <div style={{display:"flex",gap:3}} onClick={e=>e.stopPropagation()}>
            <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={e=>openEdit(t,e)} title="Editar">✎</button>
            <button className="tn-btn tn-btn--danger tn-btn--sm" onClick={e=>deleteTender(t.id,e)} title="Eliminar">✕</button>
          </div>
        );
      case "operational_status":
        return <span className={`tn-badge tn-badge--${statusBadge(t.operational_status)}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.operational_status||"—"}</span>;
      case "priority":
        return <span className={`tn-priority tn-priority--${pClass(t.priority)}`} style={{fontSize:11}}>{pIcon(t.priority)} {t.priority||"—"}</span>;
      case "purchase_order_amount":
        return <span style={{fontWeight:700,fontSize:12}}>{compactMoney(t.purchase_order_amount)}</span>;
      case "purchase_order_date":case "start_date":case "end_date":case "next_action_date":{
        const c=col.key==="end_date"?endColor(t[col.key]):col.key==="next_action_date"?actionColor(t):"gray";
        const clr=c==="red"?"#ef4444":c==="orange"?"#f97316":c==="yellow"?"#d97706":"#334155";
        return <span style={{fontSize:11.5,color:clr,whiteSpace:"nowrap"}}>{fmtDate(t[col.key])}</span>;
      }
      case "documentation_status":{
        const bc=t.documentation_status==="Completa"?"green":t.documentation_status==="Incompleta"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.documentation_status||"—"}</span>;
      }
      case "billing_status":{
        const bc=t.billing_status==="Cobrada"?"green":t.billing_status==="Facturada"?"blue":t.billing_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.billing_status||"—"}</span>;
      }
      case "delivery_status":{
        const bc=t.delivery_status==="Completa"?"green":t.delivery_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.delivery_status||"—"}</span>;
      }
      case "portal_link":
        return t.portal_link?<a href={t.portal_link} target="_blank" rel="noreferrer" style={{color:"#3b82f6",fontSize:11.5}} onClick={e=>e.stopPropagation()}>Ver ↗</a>:<span style={{color:"#94a3b8"}}>—</span>;
      case "notes":
        return <span style={{fontSize:11,color:"#64748b",display:"block",maxWidth:190,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.notes||""}>{t.notes||"—"}</span>;
      default:
        return <span style={{fontSize:12,whiteSpace:"nowrap"}}>{t[col.key]||"—"}</span>;
    }
  }

  const hasFilters=globalQ||Object.values(colFilters).some(Boolean);

  return (
    <Layout title="Licitaciones" profile={profile} onNavigate={onNavigate}>
      <div className="tn-page">

        {/* Header */}
        <div className="tn-header">
          <div>
            <h2>Licitaciones y Órdenes de Compra</h2>
            <p>{filtered.length} registros{hasFilters?" (filtrados)":""} · {tenders.length} total</p>
          </div>
          <div className="tn-header__actions">
            {hasFilters&&<button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>{setGlobalQ("");setColFilters({});}}>✕ Limpiar</button>}
            {selected.size>0&&<span style={{fontSize:12,fontWeight:700,color:"#0f2444"}}>{selected.size} selec.</span>}
            <button className="tn-btn tn-btn--ghost" onClick={exportToExcel}>⬇ {selected.size>0?`Exportar (${selected.size})`:"Exportar"}</button>
            <button className="tn-btn tn-btn--ghost" onClick={loadTenders}>↻</button>
            <button className="tn-btn tn-btn--primary" onClick={openNew}>+ Nueva licitación</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="tn-kpis">
          <div className="tn-kpi"><span className="tn-kpi__label">Activas</span><span className="tn-kpi__val">{kpis.activas}</span><span className="tn-kpi__sub">{compactMoney(kpis.montoTotal)}</span></div>
          <div className="tn-kpi tn-kpi--green"><span className="tn-kpi__label">Adjudicado</span><span className="tn-kpi__val">{compactMoney(kpis.adjMontos)}</span><span className="tn-kpi__sub">monto total OC</span></div>
          <div className={`tn-kpi ${kpis.proxVencer>0?"tn-kpi--warn":""}`}><span className="tn-kpi__label">Próx. vencer</span><span className="tn-kpi__val">{kpis.proxVencer}</span><span className="tn-kpi__sub">en 30 días</span></div>
          <div className={`tn-kpi ${kpis.vencidas>0?"tn-kpi--danger":""}`}><span className="tn-kpi__label">Vencidas</span><span className="tn-kpi__val">{kpis.vencidas}</span><span className="tn-kpi__sub">sin cerrar</span></div>
          <div className={`tn-kpi ${kpis.sinAccion>0?"tn-kpi--danger":""}`}><span className="tn-kpi__label">Sin acción</span><span className="tn-kpi__val">{kpis.sinAccion}</span><span className="tn-kpi__sub">requieren seguimiento</span></div>
          <div className={`tn-kpi ${kpis.docPend>0?"tn-kpi--warn":"tn-kpi--green"}`}><span className="tn-kpi__label">Doc. pendiente</span><span className="tn-kpi__val">{kpis.docPend}</span><span className="tn-kpi__sub">docs incompletos</span></div>
        </div>

        {/* Búsqueda global */}
        <div className="tn-search-bar">
          <input className="tn-search-input" placeholder="🔍  Buscar en todos los campos…" value={globalQ} onChange={e=>setGlobalQ(e.target.value)}/>
          <span className="tn-search-count">{filtered.length} resultado{filtered.length!==1?"s":""}</span>
        </div>

        {/* Grilla */}
        <div className="tn-grid-wrap">
          {loading?(
            <div className="tn-empty"><div className="tn-empty__icon">⏳</div><h3>Cargando…</h3></div>
          ):(
            <div className="tn-grid-scroll">
              <table className="tn-grid">
                <thead>
                  <tr className="tn-grid__head-row">
                    {COLS.map(col=>(
                      <th key={col.key} className={`tn-grid__th ${col.fixed?"tn-grid__th--fixed":""}`} style={{minWidth:col.w,maxWidth:col.w,width:col.w}}
                        onClick={()=>{ if(col.key==="_check") toggleSelectAll(); else if(col.key[0]!=="_") toggleSort(col.key); }}>
                        {col.key==="_check"?(
                          <input type="checkbox" checked={filtered.length>0&&selected.size===filtered.length} onChange={toggleSelectAll} style={{cursor:"pointer",width:14,height:14,accentColor:"#93c5fd"}}/>
                        ):(
                          <span className="tn-grid__th-label">{col.label}{sortCol===col.key&&<span style={{marginLeft:3,opacity:.6}}>{sortDir==="asc"?"↑":"↓"}</span>}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr className="tn-grid__filter-row">
                    {COLS.map(col=>(
                      <th key={col.key} className="tn-grid__filter-cell" style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>
                        {col.key[0]!=="_"?(
                          <input className="tn-grid__filter-input" placeholder="Filtrar…" value={colFilters[col.key]||""} onChange={e=>setColFilter(col.key,e.target.value)}/>
                        ):null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0?(
                    <tr><td colSpan={COLS.length} className="tn-grid__empty">
                      {tenders.length===0?"Sin licitaciones. Creá la primera con + Nueva licitación.":"Sin resultados con los filtros aplicados."}
                    </td></tr>
                  ):filtered.map((t,idx)=>(
                    /* Click en fila → abre edición */
                    <tr
                      key={t.id}
                      className={`tn-grid__row ${idx%2===0?"":"tn-grid__row--alt"}`}
                      style={{cursor:"pointer"}}
                      onClick={()=>openEdit(t)}
                    >
                      {COLS.map(col=>(
                        <td key={col.key} className={`tn-grid__td ${col.fixed?"tn-grid__td--fixed":""}`} style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>
                          {renderCell(col,t)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal formulario + adjuntos integrados */}
      {showForm&&(
        <div className="tn-overlay" onClick={e=>{ if(e.target.classList.contains("tn-overlay")) setShowForm(false); }}>
          <div className="tn-modal" style={{maxWidth:820}}>
            <div className="tn-modal__header">
              <h3>{editData?"Editar licitación":"Nueva licitación"}</h3>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {editData&&(
                  <button
                    type="button"
                    className="tn-btn tn-btn--danger tn-btn--sm"
                    onClick={e=>deleteTender(editData.id,e)}
                  >
                    🗑 Eliminar
                  </button>
                )}
                <button className="tn-modal__close" onClick={()=>setShowForm(false)}>✕</button>
              </div>
            </div>
            <div className="tn-modal__body">

              <div className="tn-form-section">
                <p className="tn-form-section__title">Datos generales</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Jurisdicción</label><input value={form.jurisdiction} onChange={e=>setF("jurisdiction",e.target.value)} placeholder="EJ: CABA"/></div>
                  <div className="tn-field"><label>Hospital / Institución</label><input value={form.institution} onChange={e=>setF("institution",e.target.value)}/></div>
                  <div className="tn-field"><label>Responsable interno</label><input value={form.internal_owner} onChange={e=>setF("internal_owner",e.target.value)}/></div>
                  <div className="tn-field"><label>Línea de producto</label><input value={form.product_line} onChange={e=>setF("product_line",e.target.value)}/></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Datos del proceso</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Número de proceso</label><input value={form.process_number} onChange={e=>setF("process_number",e.target.value)} placeholder="EJ: LP 001/2026"/></div>
                  <div className="tn-field"><label>Tipo de proceso</label><input value={form.process_type} onChange={e=>setF("process_type",e.target.value)}/></div>
                  <div className="tn-field"><label>Tipo</label><select value={form.tender_type} onChange={e=>setF("tender_type",e.target.value)}>{TENDER_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
                  <div className="tn-field"><label>Número de expediente</label><input value={form.expedient_number} onChange={e=>setF("expedient_number",e.target.value)}/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field"><label>Nombre del proceso</label><input value={form.process_name} onChange={e=>setF("process_name",e.target.value)}/></div>
                </div>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Sector solicitante</label><input value={form.requesting_sector} onChange={e=>setF("requesting_sector",e.target.value)}/></div>
                  <div className="tn-field"><label>Plazo de contrato</label><input value={form.contract_term} onChange={e=>setF("contract_term",e.target.value)} placeholder="EJ: 12 MESES"/></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Orden de compra</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Número de OC</label><input value={form.purchase_order_number} onChange={e=>setF("purchase_order_number",e.target.value)}/></div>
                  <div className="tn-field"><label>Fecha de OC</label><input type="date" value={form.purchase_order_date} onChange={e=>setF("purchase_order_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Monto de OC ($)</label><input type="number" value={form.purchase_order_amount} onChange={e=>setF("purchase_order_amount",e.target.value)} placeholder="0"/></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Fechas y vigencia</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Fecha de inicio</label><input type="date" value={form.start_date} onChange={e=>setF("start_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Fecha de finalización</label><input type="date" value={form.end_date} onChange={e=>setF("end_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Estado de vigencia</label><select value={form.validity_status} onChange={e=>setF("validity_status",e.target.value)}>{ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Seguimiento operativo</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Estado operativo</label><select value={form.operational_status} onChange={e=>setF("operational_status",e.target.value)}>{ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                  <div className="tn-field"><label>Prioridad</label><select value={form.priority} onChange={e=>setF("priority",e.target.value)}>{PRIORIDADES.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
                  <div className="tn-field"><label>Próxima acción</label><input value={form.next_action} onChange={e=>setF("next_action",e.target.value)} placeholder="EJ: ENVIAR DOCUMENTACIÓN"/></div>
                  <div className="tn-field"><label>Fecha próxima acción</label><input type="date" value={form.next_action_date} onChange={e=>setF("next_action_date",e.target.value)}/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Documentación</label><select value={form.documentation_status} onChange={e=>setF("documentation_status",e.target.value)}>{DOC_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                  <div className="tn-field"><label>Facturación</label><select value={form.billing_status} onChange={e=>setF("billing_status",e.target.value)}>{BILL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                  <div className="tn-field"><label>Entrega</label><select value={form.delivery_status} onChange={e=>setF("delivery_status",e.target.value)}>{DEL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Documentación / Póliza / OT Bridge</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Póliza de ejecución</label><input value={form.execution_policy} onChange={e=>setF("execution_policy",e.target.value)}/></div>
                  <div className="tn-field"><label>OT Sistema Bridge</label><input value={form.bridge_ot} onChange={e=>setF("bridge_ot",e.target.value)}/></div>
                  <div className="tn-field"><label>Link / Portal</label><input value={form.portal_link} onChange={e=>setF("portal_link",e.target.value)} placeholder="https://…"/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field"><label>Detalle documentación pendiente</label><input value={form.documentation_pending_detail} onChange={e=>setF("documentation_pending_detail",e.target.value)}/></div>
                </div>
              </div>

              <div className="tn-form-section">
                <p className="tn-form-section__title">Observaciones</p>
                <div className="tn-field"><textarea value={form.notes} onChange={e=>setF("notes",e.target.value)} placeholder="NOTAS, HISTORIAL DE SEGUIMIENTO…"/></div>
              </div>

              {/* ADJUNTOS — solo visible cuando se está editando una licitación existente */}
              {editData && (
                <div className="tn-form-section">
                  <p className="tn-form-section__title">📎 Archivos adjuntos (pliegos, OC, pólizas…)</p>
                  <InlineAttachments tenderId={editData.id} />
                </div>
              )}

              {!editData && (
                <div className="tn-form-section">
                  <p className="tn-form-section__title">📎 Archivos adjuntos</p>
                  <p style={{fontSize:12,color:"#94a3b8",margin:0}}>Guardá la licitación primero y luego podrás adjuntar archivos.</p>
                </div>
              )}

            </div>
            <div className="tn-modal__footer">
              <button className="tn-btn tn-btn--ghost" onClick={()=>setShowForm(false)}>Cerrar</button>
              <button className="tn-btn tn-btn--primary" onClick={saveTender} disabled={saving}>
                {saving?"Guardando…":editData?"Guardar cambios":"Crear licitación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}