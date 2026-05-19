import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./tenders.css";

/* ─── Constantes ─────────────────────────────────────────────────────── */
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
  jurisdiction:"",
  institution:"",
  process_type:"",
  process_number:"",
  tender_type:"Original",
  process_name:"",
  expedient_number:"",
  requesting_sector:"",
  contract_term:"",
  purchase_order_number:"",
  purchase_order_date:"",
  purchase_order_amount:"",
  start_date:"",
  end_date:"",
  validity_status:"En análisis",
  execution_policy:"",
  bridge_ot:"",
  internal_owner:"",
  product_line:"",
  operational_status:"En análisis",
  next_action:"",
  next_action_date:"",
  documentation_status:"Pendiente",
  documentation_pending_detail:"",
  billing_status:"Pendiente",
  delivery_status:"Pendiente",
  priority:"Media",
  portal_link:"",
  notes:"",
};

/* ─── Helpers ────────────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d+"T00:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"});
}

function compactMoney(v) {
  const n = Number(v||0);
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(1).replace(".",",")} MM`;
  if (n >= 1_000_000)     return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
  if (n >= 1_000)         return `$${Math.round(n/1_000)} K`;
  return `$${n.toLocaleString("es-AR")}`;
}

function fmtMoney(v) {
  if (!v) return "—";
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:0}).format(Number(v));
}

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d+"T00:00:00") - new Date()) / 86400000);
}

function endColor(d) {
  const days = daysUntil(d);
  if (days === null) return "gray";
  if (days < 0)  return "red";
  if (days < 7)  return "red";
  if (days < 15) return "orange";
  if (days < 30) return "yellow";
  return "green";
}

function actionColor(t) {
  if (!t.next_action) return "red";
  if (!t.next_action_date) return "yellow";
  const days = daysUntil(t.next_action_date);
  if (days < 0)  return "red";
  if (days <= 3) return "yellow";
  return "green";
}

function statusBadge(s) {
  const m = {
    "En análisis":"blue","Cotizada":"blue","Presentada":"yellow",
    "Adjudicada":"green","Orden de compra recibida":"green",
    "En ejecución":"green","Entrega parcial":"orange",
    "Entregada":"green","Facturada":"purple","Cobrada":"green",
    "Finalizada":"gray","Perdida / No adjudicada":"red","Vencida":"red",
  };
  return m[s] || "gray";
}

function pClass(p) { return {Alta:"alta",Crítica:"critica",Media:"media",Baja:"baja"}[p]||"baja"; }
function pIcon(p)  { return {Alta:"▲",Crítica:"⬆",Media:"→",Baja:"▼"}[p]||"→"; }

function fileIcon(name) {
  const ext = (name||"").split(".").pop().toLowerCase();
  if (ext === "pdf")              return "📄";
  if (ext === "xlsx"||ext==="xls") return "📊";
  if (ext === "docx"||ext==="doc") return "📝";
  return "📎";
}

/* ─── Columnas ───────────────────────────────────────────────────────── */
const COLS = [
  { key:"_check",               label:"☑",             w:36,  fixed:true },
  { key:"_alert",               label:"⚡",             w:48,  fixed:true },
  { key:"jurisdiction",         label:"Jurisdicción",   w:120 },
  { key:"institution",          label:"Hospital / Inst.",w:210 },
  { key:"process_number",       label:"N° Proceso",     w:130 },
  { key:"process_name",         label:"Nombre proceso", w:230 },
  { key:"expedient_number",     label:"Expediente",     w:150 },
  { key:"process_type",         label:"Tipo proceso",   w:160 },
  { key:"tender_type",          label:"Tipo",           w:100 },
  { key:"purchase_order_number",label:"N° OC",          w:120 },
  { key:"purchase_order_date",  label:"Fecha OC",       w:100 },
  { key:"purchase_order_amount",label:"Monto OC",       w:130 },
  { key:"start_date",           label:"Inicio",         w:90  },
  { key:"end_date",             label:"Fin",            w:90  },
  { key:"operational_status",   label:"Estado",         w:190 },
  { key:"priority",             label:"Prioridad",      w:95  },
  { key:"internal_owner",       label:"Responsable",    w:130 },
  { key:"product_line",         label:"Línea prod.",    w:130 },
  { key:"next_action",          label:"Próxima acción", w:190 },
  { key:"next_action_date",     label:"Fecha acción",   w:105 },
  { key:"documentation_status", label:"Doc.",           w:110 },
  { key:"billing_status",       label:"Facturación",    w:110 },
  { key:"delivery_status",      label:"Entrega",        w:100 },
  { key:"execution_policy",     label:"Póliza",         w:110 },
  { key:"bridge_ot",            label:"OT Bridge",      w:110 },
  { key:"contract_term",        label:"Plazo",          w:90  },
  { key:"requesting_sector",    label:"Sector",         w:130 },
  { key:"_attachments",         label:"📎",             w:65  },
  { key:"notes",                label:"Observaciones",  w:220 },
  { key:"_actions",             label:"",               w:80,  fixed:true },
];

/* ─── Adjuntos inline ────────────────────────────────────────────────── */
function InlineAttachments({ tenderId }) {
  const [files,     setFiles]     = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadingF,  setLoadingF]  = useState(true);
  const inputRef = useRef(null);
  const folder   = `tender_${tenderId}`;

  useEffect(() => { if (tenderId) loadFiles(); }, [tenderId]);

  async function loadFiles() {
    setLoadingF(true);
    const { data } = await supabase.storage.from(BUCKET).list(folder);
    setFiles(data || []);
    setLoadingF(false);
  }

  async function handleUpload(e) {
    const list = Array.from(e.target.files||[]);
    if (!list.length) return;
    setUploading(true);
    for (const file of list) {
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .replace(/[^a-zA-Z0-9._-]/g,"_");
      const path = `${folder}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl:"3600", upsert:false, contentType:file.type,
      });
      if (error) console.error("Upload:", error.message);
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
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <button
          type="button"
          className="tn-btn tn-btn--ghost tn-btn--sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "⏳ Subiendo…" : "📎 Adjuntar archivos"}
        </button>
        <span style={{fontSize:11,color:"#94a3b8"}}>PDF · Word · Excel · Múltiples archivos</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx"
          style={{display:"none"}}
          onChange={handleUpload}
        />
      </div>

      {loadingF ? (
        <p style={{fontSize:12,color:"#94a3b8",margin:0}}>Cargando…</p>
      ) : files.length === 0 ? (
        <p style={{fontSize:12,color:"#94a3b8",margin:0}}>Sin archivos adjuntos todavía.</p>
      ) : (
        <div className="tn-file-list">
          {files.map(f => (
            <div key={f.name} className="tn-file-row">
              <span className="tn-file-icon">{fileIcon(f.name)}</span>
              <span className="tn-file-name" title={f.name.replace(/^\d+_/,"")}>
                {f.name.replace(/^\d+_/,"")}
              </span>
              <span className="tn-file-size">
                {f.metadata?.size ? `${Math.round(f.metadata.size/1024)} KB` : ""}
              </span>
              <div className="tn-file-actions">
                <a href={getUrl(f.name)} target="_blank" rel="noreferrer"
                  className="tn-btn tn-btn--ghost tn-btn--sm">⬇ Ver</a>
                <button type="button" className="tn-btn tn-btn--danger tn-btn--sm"
                  onClick={() => handleDelete(f.name)}>✕</button>
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
  const [tenders,      setTenders]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [editData,     setEditData]     = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [selected,     setSelected]     = useState(new Set());
  const [form,         setForm]         = useState({ ...EMPTY_FORM });
  const [sortCol,      setSortCol]      = useState("created_at");
  const [sortDir,      setSortDir]      = useState("desc");
  const [colFilters,   setColFilters]   = useState({});
  const [globalQ,      setGlobalQ]      = useState("");
  const [attachCounts, setAttachCounts] = useState({});

  useEffect(() => { loadTenders(); }, []);

  async function loadTenders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenders").select("*").order("created_at",{ascending:false});
    if (error) { console.error(error); setLoading(false); return; }
    const rows = data || [];
    setTenders(rows);
    setLoading(false);
    loadAttachCounts(rows);
  }

  async function loadAttachCounts(rows) {
    const counts = {};
    await Promise.all(rows.map(async t => {
      const { data } = await supabase.storage.from(BUCKET).list(`tender_${t.id}`);
      counts[t.id] = data?.length || 0;
    }));
    setAttachCounts(counts);
  }

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const activas    = tenders.filter(t => !["Finalizada","Perdida / No adjudicada","Vencida"].includes(t.operational_status));
    const montoTotal = activas.reduce((s,t) => s + Number(t.purchase_order_amount||0), 0);
    const adjMontos  = tenders
      .filter(t => ["Adjudicada","Orden de compra recibida","En ejecución","Entrega parcial","Entregada","Facturada","Cobrada"].includes(t.operational_status))
      .reduce((s,t) => s + Number(t.purchase_order_amount||0), 0);
    const proxVencer = tenders.filter(t => { const d=daysUntil(t.end_date); return d!==null&&d>=0&&d<=30; }).length;
    const vencidas   = tenders.filter(t => { const d=daysUntil(t.end_date); return d!==null&&d<0&&!["Finalizada","Cobrada"].includes(t.operational_status); }).length;
    const sinAccion  = tenders.filter(t => !t.next_action && !["Finalizada","Cobrada","Perdida / No adjudicada"].includes(t.operational_status)).length;
    const docPend    = tenders.filter(t => t.documentation_status==="Pendiente" && !["Finalizada","Cobrada"].includes(t.operational_status)).length;
    return { activas:activas.length, montoTotal, adjMontos, proxVencer, vencidas, sinAccion, docPend };
  }, [tenders]);

  /* ── Filtrado + sort ── */
  const filtered = useMemo(() => {
    let rows = [...tenders];
    if (globalQ) {
      const q = globalQ.toLowerCase();
      rows = rows.filter(t => Object.values(t).some(v => v && String(v).toLowerCase().includes(q)));
    }
    Object.entries(colFilters).forEach(([k,v]) => {
      if (!v) return;
      rows = rows.filter(t => String(t[k]||"").toLowerCase().includes(v.toLowerCase()));
    });
    rows.sort((a,b) => {
      const av = a[sortCol]||"", bv = b[sortCol]||"";
      return sortDir==="asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [tenders, globalQ, colFilters, sortCol, sortDir]);

  function setColFilter(k,v) { setColFilters(prev => ({...prev,[k]:v})); }
  function toggleSort(k) {
    if (sortCol===k) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortCol(k); setSortDir("asc"); }
  }
  function toggleSelect(id) {
    setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(prev => prev.size===filtered.length ? new Set() : new Set(filtered.map(t=>t.id)));
  }

  /* ── Abrir nuevo ── */
  function openNew() {
    setEditData(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  /* ── Abrir edición — cargar TODOS los campos desde Supabase ── */
  function openEdit(t, e) {
    e?.stopPropagation();
    setEditData(t);
    setForm({
      jurisdiction:                 t.jurisdiction                 || "",
      institution:                  t.institution                  || "",
      process_type:                 t.process_type                 || "",
      process_number:               t.process_number               || "",
      tender_type:                  t.tender_type                  || "Original",
      process_name:                 t.process_name                 || "",
      expedient_number:             t.expedient_number             || "",
      requesting_sector:            t.requesting_sector            || "",
      contract_term:                t.contract_term                || "",
      purchase_order_number:        t.purchase_order_number        || "",
      purchase_order_date:          t.purchase_order_date          || "",
      purchase_order_amount:        t.purchase_order_amount        != null ? String(t.purchase_order_amount) : "",
      start_date:                   t.start_date                   || "",
      end_date:                     t.end_date                     || "",
      validity_status:              t.validity_status              || "En análisis",
      execution_policy:             t.execution_policy             || "",
      bridge_ot:                    t.bridge_ot                    || "",
      internal_owner:               t.internal_owner               || "",
      product_line:                 t.product_line                 || "",
      operational_status:           t.operational_status           || "En análisis",
      next_action:                  t.next_action                  || "",
      next_action_date:             t.next_action_date             || "",
      documentation_status:         t.documentation_status         || "Pendiente",
      documentation_pending_detail: t.documentation_pending_detail || "",
      billing_status:               t.billing_status               || "Pendiente",
      delivery_status:              t.delivery_status              || "Pendiente",
      priority:                     t.priority                     || "Media",
      portal_link:                  t.portal_link                  || "",
      notes:                        t.notes                        || "",
    });
    setShowForm(true);
  }

  /* ── setF con uppercase para strings ── */
  function setF(k, v) {
    setForm(prev => ({
      ...prev,
      [k]: typeof v === "string" && !["portal_link"].includes(k) ? v.toUpperCase() : v,
    }));
  }

  /* ── Guardar — payload completo con todos los campos ── */
  async function saveTender() {
    setSaving(true);
    const payload = {
      jurisdiction:                 form.jurisdiction                 || null,
      institution:                  form.institution                  || null,
      process_type:                 form.process_type                 || null,
      process_number:               form.process_number               || null,
      tender_type:                  form.tender_type                  || null,
      process_name:                 form.process_name                 || null,
      expedient_number:             form.expedient_number             || null,
      requesting_sector:            form.requesting_sector            || null,
      contract_term:                form.contract_term                || null,
      purchase_order_number:        form.purchase_order_number        || null,
      purchase_order_date:          form.purchase_order_date          || null,
      purchase_order_amount:        form.purchase_order_amount !== "" ? Number(form.purchase_order_amount) : null,
      start_date:                   form.start_date                   || null,
      end_date:                     form.end_date                     || null,
      validity_status:              form.validity_status              || null,
      execution_policy:             form.execution_policy             || null,
      bridge_ot:                    form.bridge_ot                    || null,
      internal_owner:               form.internal_owner               || null,
      product_line:                 form.product_line                 || null,
      operational_status:           form.operational_status           || "En análisis",
      next_action:                  form.next_action                  || null,
      next_action_date:             form.next_action_date             || null,
      documentation_status:         form.documentation_status         || "Pendiente",
      documentation_pending_detail: form.documentation_pending_detail || null,
      billing_status:               form.billing_status               || "Pendiente",
      delivery_status:              form.delivery_status              || "Pendiente",
      priority:                     form.priority                     || "Media",
      portal_link:                  form.portal_link                  || null,
      notes:                        form.notes                        || null,
      owner_id:                     profile?.id,
      updated_at:                   new Date().toISOString(),
    };

    if (editData) {
      const { error } = await supabase.from("tenders").update(payload).eq("id", editData.id);
      if (error) { alert("Error al guardar: " + error.message); setSaving(false); return; }
      // Actualizar el registro en el estado local inmediatamente
      setTenders(prev => prev.map(t => t.id === editData.id ? { ...t, ...payload, id: t.id } : t));
    } else {
      const { data: newRow, error } = await supabase.from("tenders").insert([payload]).select().single();
      if (error) { alert("Error al crear: " + error.message); setSaving(false); return; }
      setTenders(prev => [newRow, ...prev]);
    }

    setSaving(false);
    setShowForm(false);
    // Recargar para asegurar consistencia
    await loadTenders();
  }

  async function deleteTender(id, e) {
    e?.stopPropagation();
    if (!confirm("¿Eliminar esta licitación y todos sus adjuntos?")) return;
    const { data: files } = await supabase.storage.from(BUCKET).list(`tender_${id}`);
    if (files?.length) {
      await supabase.storage.from(BUCKET).remove(files.map(f => `tender_${id}/${f.name}`));
    }
    await supabase.from("tenders").delete().eq("id", id);
    setTenders(prev => prev.filter(t => t.id !== id));
    if (editData?.id === id) setShowForm(false);
  }

  function exportToExcel() {
    const rows = filtered.filter(t => selected.size===0 || selected.has(t.id));
    if (!rows.length) { alert("No hay filas para exportar."); return; }
    const headers = ["Jurisdicción","Hospital/Institución","N° Proceso","Nombre Proceso","Expediente","Tipo Proceso","Tipo","N° OC","Fecha OC","Monto OC","Fecha Inicio","Fecha Fin","Estado Operativo","Prioridad","Responsable","Línea Producto","Próxima Acción","Fecha Próx. Acción","Documentación","Facturación","Entrega","Póliza","OT Bridge","Plazo Contrato","Sector Solicitante","Estado Vigencia","Portal","Observaciones"];
    const keys    = ["jurisdiction","institution","process_number","process_name","expedient_number","process_type","tender_type","purchase_order_number","purchase_order_date","purchase_order_amount","start_date","end_date","operational_status","priority","internal_owner","product_line","next_action","next_action_date","documentation_status","billing_status","delivery_status","execution_policy","bridge_ot","contract_term","requesting_sector","validity_status","portal_link","notes"];
    const csv = [headers.join(";"), ...rows.map(r => keys.map(k => `"${String(r[k]||"").replace(/"/g,'""')}"`).join(";"))].join("\n");
    const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `licitaciones_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  /* ── Render celda ── */
  function renderCell(col, t) {
    switch (col.key) {
      case "_check":
        return (
          <input type="checkbox" checked={selected.has(t.id)}
            onChange={() => toggleSelect(t.id)}
            onClick={e => e.stopPropagation()}
            style={{cursor:"pointer",width:14,height:14,accentColor:"#0f2444"}}
          />
        );
      case "_alert":
        return (
          <div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center"}}>
            <span className={`tn-alert-dot tn-alert-dot--${endColor(t.end_date)}`}
              title={`Vencimiento: ${fmtDate(t.end_date)}`}/>
            <span className={`tn-alert-dot tn-alert-dot--${actionColor(t)}`}
              title={`Acción: ${t.next_action||"Sin definir"}`}/>
          </div>
        );
      case "_attachments": {
        const cnt = attachCounts[t.id] || 0;
        return (
          <span className="tn-attach-btn" onClick={e => { e.stopPropagation(); openEdit(t,e); }}
            title={`${cnt} adjunto${cnt!==1?"s":""}`}>
            📎{cnt>0 && <span className="tn-attach-count">{cnt}</span>}
          </span>
        );
      }
      case "_actions":
        return (
          <div style={{display:"flex",gap:4}} onClick={e => e.stopPropagation()}>
            <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={e => openEdit(t,e)}>✎</button>
            <button className="tn-btn tn-btn--danger tn-btn--sm" onClick={e => deleteTender(t.id,e)}>✕</button>
          </div>
        );
      case "operational_status":
        return <span className={`tn-badge tn-badge--${statusBadge(t.operational_status)}`}
          style={{fontSize:10.5,padding:"2px 8px",whiteSpace:"nowrap"}}>{t.operational_status||"—"}</span>;
      case "priority":
        return <span className={`tn-priority tn-priority--${pClass(t.priority)}`}
          style={{fontSize:11,whiteSpace:"nowrap"}}>{pIcon(t.priority)} {t.priority||"—"}</span>;
      case "purchase_order_amount":
        return <span style={{fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>{compactMoney(t.purchase_order_amount)}</span>;
      case "purchase_order_date":
      case "start_date":
      case "end_date":
      case "next_action_date": {
        const c = col.key==="end_date" ? endColor(t[col.key]) : col.key==="next_action_date" ? actionColor(t) : "gray";
        const clr = c==="red"?"#ef4444":c==="orange"?"#f97316":c==="yellow"?"#d97706":"#334155";
        return <span style={{fontSize:11.5,color:clr,whiteSpace:"nowrap"}}>{fmtDate(t[col.key])}</span>;
      }
      case "documentation_status": {
        const bc = t.documentation_status==="Completa"?"green":t.documentation_status==="Incompleta"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.documentation_status||"—"}</span>;
      }
      case "billing_status": {
        const bc = t.billing_status==="Cobrada"?"green":t.billing_status==="Facturada"?"blue":t.billing_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.billing_status||"—"}</span>;
      }
      case "delivery_status": {
        const bc = t.delivery_status==="Completa"?"green":t.delivery_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 8px"}}>{t.delivery_status||"—"}</span>;
      }
      case "portal_link":
        return t.portal_link
          ? <a href={t.portal_link} target="_blank" rel="noreferrer"
              style={{color:"#3b82f6",fontSize:11.5,whiteSpace:"nowrap"}}
              onClick={e => e.stopPropagation()}>Ver ↗</a>
          : <span style={{color:"#94a3b8"}}>—</span>;
      case "notes":
        return <span style={{fontSize:11,color:"#64748b",display:"block",maxWidth:210,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
          title={t.notes||""}>{t.notes||"—"}</span>;
      default:
        return <span style={{fontSize:12,whiteSpace:"nowrap"}}>{t[col.key]||"—"}</span>;
    }
  }

  const hasFilters = globalQ || Object.values(colFilters).some(Boolean);

  /* ── Render ── */
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
            {hasFilters && (
              <button className="tn-btn tn-btn--ghost tn-btn--sm"
                onClick={() => { setGlobalQ(""); setColFilters({}); }}>✕ Limpiar</button>
            )}
            {selected.size > 0 && (
              <span style={{fontSize:12,fontWeight:700,color:"#0f2444"}}>{selected.size} selec.</span>
            )}
            <button className="tn-btn tn-btn--ghost" onClick={exportToExcel}>
              ⬇ {selected.size>0 ? `Exportar (${selected.size})` : "Exportar"}
            </button>
            <button className="tn-btn tn-btn--ghost" onClick={loadTenders}>↻</button>
            <button className="tn-btn tn-btn--primary" onClick={openNew}>+ Nueva licitación</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="tn-kpis">
          <div className="tn-kpi">
            <span className="tn-kpi__label">Activas</span>
            <span className="tn-kpi__val">{kpis.activas}</span>
            <span className="tn-kpi__sub">{compactMoney(kpis.montoTotal)} en curso</span>
          </div>
          <div className="tn-kpi tn-kpi--green">
            <span className="tn-kpi__label">Adjudicado</span>
            <span className="tn-kpi__val">{compactMoney(kpis.adjMontos)}</span>
            <span className="tn-kpi__sub">monto total OC</span>
          </div>
          <div className={`tn-kpi ${kpis.proxVencer>0?"tn-kpi--warn":""}`}>
            <span className="tn-kpi__label">Próx. vencer</span>
            <span className="tn-kpi__val">{kpis.proxVencer}</span>
            <span className="tn-kpi__sub">en 30 días</span>
          </div>
          <div className={`tn-kpi ${kpis.vencidas>0?"tn-kpi--danger":""}`}>
            <span className="tn-kpi__label">Vencidas</span>
            <span className="tn-kpi__val">{kpis.vencidas}</span>
            <span className="tn-kpi__sub">sin cerrar</span>
          </div>
          <div className={`tn-kpi ${kpis.sinAccion>0?"tn-kpi--danger":""}`}>
            <span className="tn-kpi__label">Sin acción</span>
            <span className="tn-kpi__val">{kpis.sinAccion}</span>
            <span className="tn-kpi__sub">requieren seguimiento</span>
          </div>
          <div className={`tn-kpi ${kpis.docPend>0?"tn-kpi--warn":"tn-kpi--green"}`}>
            <span className="tn-kpi__label">Doc. pendiente</span>
            <span className="tn-kpi__val">{kpis.docPend}</span>
            <span className="tn-kpi__sub">docs incompletos</span>
          </div>
        </div>

        {/* Búsqueda */}
        <div className="tn-search-bar">
          <input className="tn-search-input"
            placeholder="🔍  Buscar en todos los campos…"
            value={globalQ} onChange={e => setGlobalQ(e.target.value)}/>
          <span className="tn-search-count">
            {filtered.length} resultado{filtered.length!==1?"s":""}
          </span>
        </div>

        {/* Grilla */}
        <div className="tn-grid-wrap">
          {loading ? (
            <div className="tn-empty">
              <div className="tn-empty__icon">⏳</div>
              <h3>Cargando…</h3>
            </div>
          ) : (
            <div className="tn-grid-scroll">
              <table className="tn-grid">
                <thead>
                  <tr className="tn-grid__head-row">
                    {COLS.map(col => (
                      <th key={col.key}
                        className={`tn-grid__th ${col.fixed?"tn-grid__th--fixed":""}`}
                        style={{minWidth:col.w,maxWidth:col.w,width:col.w}}
                        onClick={() => {
                          if (col.key==="_check") toggleSelectAll();
                          else if (col.key[0]!=="_") toggleSort(col.key);
                        }}>
                        {col.key==="_check" ? (
                          <input type="checkbox"
                            checked={filtered.length>0 && selected.size===filtered.length}
                            onChange={toggleSelectAll}
                            style={{cursor:"pointer",width:14,height:14,accentColor:"#93c5fd"}}
                          />
                        ) : (
                          <span className="tn-grid__th-label">
                            {col.label}
                            {sortCol===col.key && (
                              <span style={{marginLeft:3,opacity:.6}}>{sortDir==="asc"?"↑":"↓"}</span>
                            )}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr className="tn-grid__filter-row">
                    {COLS.map(col => (
                      <th key={col.key} className="tn-grid__filter-cell"
                        style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>
                        {col.key[0]!=="_" ? (
                          <input className="tn-grid__filter-input"
                            placeholder="Filtrar…"
                            value={colFilters[col.key]||""}
                            onChange={e => setColFilter(col.key, e.target.value)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={COLS.length} className="tn-grid__empty">
                      {tenders.length===0
                        ? "Sin licitaciones. Creá la primera con + Nueva licitación."
                        : "Sin resultados con los filtros aplicados."}
                    </td></tr>
                  ) : filtered.map((t, idx) => (
                    <tr key={t.id}
                      className={`tn-grid__row ${idx%2===0?"":"tn-grid__row--alt"}`}
                      style={{cursor:"pointer"}}
                      onClick={() => openEdit(t)}>
                      {COLS.map(col => (
                        <td key={col.key}
                          className={`tn-grid__td ${col.fixed?"tn-grid__td--fixed":""}`}
                          style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>
                          {renderCell(col, t)}
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

      {/* ══ MODAL FORMULARIO ══ */}
      {showForm && (
        <div className="tn-overlay"
          onClick={e => { if (e.target.classList.contains("tn-overlay")) setShowForm(false); }}>
          <div className="tn-modal" style={{maxWidth:860}}>

            <div className="tn-modal__header">
              <div>
                <h3>{editData ? "Editar licitación" : "Nueva licitación"}</h3>
                {editData && (
                  <span style={{fontSize:11.5,color:"#94a3b8",fontWeight:500}}>
                    {editData.process_number||""} · {editData.institution||""}
                  </span>
                )}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {editData && (
                  <span className={`tn-badge tn-badge--${statusBadge(form.operational_status)}`}
                    style={{fontSize:11,padding:"3px 10px"}}>
                    {form.operational_status}
                  </span>
                )}
                {editData && (
                  <button type="button" className="tn-btn tn-btn--danger tn-btn--sm"
                    onClick={e => deleteTender(editData.id, e)}>
                    🗑 Eliminar
                  </button>
                )}
                <button className="tn-modal__close" onClick={() => setShowForm(false)}>✕</button>
              </div>
            </div>

            <div className="tn-modal__body">

              {/* ── SECCIÓN 1: Datos generales ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📋 Datos generales</p>
                <div className="tn-form-grid">
                  <div className="tn-field">
                    <label>Jurisdicción</label>
                    <input value={form.jurisdiction}
                      onChange={e => setF("jurisdiction", e.target.value)}
                      placeholder="EJ: CABA, PROVINCIA DE BUENOS AIRES"/>
                  </div>
                  <div className="tn-field">
                    <label>Hospital / Institución *</label>
                    <input value={form.institution}
                      onChange={e => setF("institution", e.target.value)}
                      placeholder="NOMBRE DEL HOSPITAL O ENTE"/>
                  </div>
                  <div className="tn-field">
                    <label>Responsable interno</label>
                    <input value={form.internal_owner}
                      onChange={e => setF("internal_owner", e.target.value)}
                      placeholder="NOMBRE DEL RESPONSABLE"/>
                  </div>
                  <div className="tn-field">
                    <label>Línea de producto</label>
                    <input value={form.product_line}
                      onChange={e => setF("product_line", e.target.value)}
                      placeholder="EJ: ELECTROCIRUGÍA, ORTOPEDIA"/>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 2: Datos del proceso ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📑 Datos del proceso</p>
                <div className="tn-form-grid">
                  <div className="tn-field">
                    <label>Número de proceso</label>
                    <input value={form.process_number}
                      onChange={e => setF("process_number", e.target.value)}
                      placeholder="EJ: LP 001/2026"/>
                  </div>
                  <div className="tn-field">
                    <label>Tipo de proceso</label>
                    <input value={form.process_type}
                      onChange={e => setF("process_type", e.target.value)}
                      placeholder="EJ: LICITACIÓN PÚBLICA"/>
                  </div>
                  <div className="tn-field">
                    <label>Tipo de licitación</label>
                    <select value={form.tender_type}
                      onChange={e => setF("tender_type", e.target.value)}>
                      {TENDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="tn-field">
                    <label>Número de expediente</label>
                    <input value={form.expedient_number}
                      onChange={e => setF("expedient_number", e.target.value)}
                      placeholder="EJ: EX-2026-12345"/>
                  </div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field">
                    <label>Nombre / Descripción del proceso</label>
                    <input value={form.process_name}
                      onChange={e => setF("process_name", e.target.value)}
                      placeholder="DESCRIPCIÓN COMPLETA DEL PROCESO LICITATORIO"/>
                  </div>
                </div>
                <div className="tn-form-grid">
                  <div className="tn-field">
                    <label>Sector solicitante</label>
                    <input value={form.requesting_sector}
                      onChange={e => setF("requesting_sector", e.target.value)}
                      placeholder="EJ: QUIRÓFANO, GUARDIA"/>
                  </div>
                  <div className="tn-field">
                    <label>Plazo de contrato</label>
                    <input value={form.contract_term}
                      onChange={e => setF("contract_term", e.target.value)}
                      placeholder="EJ: 12 MESES"/>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 3: Orden de compra ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">🧾 Orden de compra</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field">
                    <label>Número de OC</label>
                    <input value={form.purchase_order_number}
                      onChange={e => setF("purchase_order_number", e.target.value)}
                      placeholder="EJ: OC-2026-001"/>
                  </div>
                  <div className="tn-field">
                    <label>Fecha de OC</label>
                    <input type="date" value={form.purchase_order_date}
                      onChange={e => setF("purchase_order_date", e.target.value)}/>
                  </div>
                  <div className="tn-field">
                    <label>Monto de OC ($)</label>
                    <input type="number" value={form.purchase_order_amount}
                      onChange={e => setF("purchase_order_amount", e.target.value)}
                      placeholder="0" min="0"/>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 4: Fechas y vigencia ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📅 Fechas y vigencia</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field">
                    <label>Fecha de inicio</label>
                    <input type="date" value={form.start_date}
                      onChange={e => setF("start_date", e.target.value)}/>
                  </div>
                  <div className="tn-field">
                    <label>Fecha de finalización</label>
                    <input type="date" value={form.end_date}
                      onChange={e => setF("end_date", e.target.value)}/>
                  </div>
                  <div className="tn-field">
                    <label>Estado de vigencia</label>
                    <select value={form.validity_status}
                      onChange={e => setF("validity_status", e.target.value)}>
                      {ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 5: Estado y seguimiento ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">⚙️ Estado y seguimiento operativo</p>
                <div className="tn-form-grid">
                  <div className="tn-field">
                    <label>Estado operativo *</label>
                    <select value={form.operational_status}
                      onChange={e => setF("operational_status", e.target.value)}
                      style={{fontWeight:700,borderColor: statusBadge(form.operational_status)==="red"?"#fecaca":statusBadge(form.operational_status)==="green"?"#bbf7d0":"#e2e8f0"}}>
                      {ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field">
                    <label>Prioridad</label>
                    <select value={form.priority}
                      onChange={e => setF("priority", e.target.value)}>
                      {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="tn-field">
                    <label>Próxima acción</label>
                    <input value={form.next_action}
                      onChange={e => setF("next_action", e.target.value)}
                      placeholder="EJ: ENVIAR DOCUMENTACIÓN"/>
                  </div>
                  <div className="tn-field">
                    <label>Fecha próxima acción</label>
                    <input type="date" value={form.next_action_date}
                      onChange={e => setF("next_action_date", e.target.value)}/>
                  </div>
                </div>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field">
                    <label>Estado documentación</label>
                    <select value={form.documentation_status}
                      onChange={e => setF("documentation_status", e.target.value)}>
                      {DOC_ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field">
                    <label>Estado facturación</label>
                    <select value={form.billing_status}
                      onChange={e => setF("billing_status", e.target.value)}>
                      {BILL_ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field">
                    <label>Estado entrega</label>
                    <select value={form.delivery_status}
                      onChange={e => setF("delivery_status", e.target.value)}>
                      {DEL_ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 6: Documentación / Póliza / OT ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📁 Documentación · Póliza · OT Bridge</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field">
                    <label>Póliza de ejecución</label>
                    <input value={form.execution_policy}
                      onChange={e => setF("execution_policy", e.target.value)}
                      placeholder="NRO. O DESCRIPCIÓN"/>
                  </div>
                  <div className="tn-field">
                    <label>OT Sistema Bridge</label>
                    <input value={form.bridge_ot}
                      onChange={e => setF("bridge_ot", e.target.value)}
                      placeholder="NRO. DE OT"/>
                  </div>
                  <div className="tn-field">
                    <label>Link / Portal</label>
                    <input value={form.portal_link}
                      onChange={e => setForm(prev => ({...prev, portal_link: e.target.value}))}
                      placeholder="https://…"/>
                  </div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field">
                    <label>Detalle documentación pendiente</label>
                    <input value={form.documentation_pending_detail}
                      onChange={e => setF("documentation_pending_detail", e.target.value)}
                      placeholder="QUÉ FALTA, QUÉ ESTÁ INCOMPLETO"/>
                  </div>
                </div>
              </div>

              {/* ── SECCIÓN 7: Observaciones ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📝 Observaciones</p>
                <div className="tn-field">
                  <textarea value={form.notes}
                    onChange={e => setF("notes", e.target.value)}
                    rows={4}
                    placeholder="NOTAS, HISTORIAL DE SEGUIMIENTO, COMENTARIOS…"/>
                </div>
              </div>

              {/* ── SECCIÓN 8: Adjuntos ── */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">📎 Archivos adjuntos</p>
                {editData ? (
                  <InlineAttachments tenderId={editData.id} />
                ) : (
                  <div className="tn-inline-attach">
                    <p style={{margin:0,fontSize:12.5,color:"#94a3b8",textAlign:"center",padding:"8px 0"}}>
                      Guardá la licitación primero y luego podrás adjuntar archivos.
                    </p>
                  </div>
                )}
              </div>

            </div>

            <div className="tn-modal__footer">
              <span style={{fontSize:11,color:"#94a3b8"}}>
                {editData ? `Última actualización: ${new Date(editData.updated_at||editData.created_at).toLocaleDateString("es-AR")}` : "Nueva licitación"}
              </span>
              <div style={{display:"flex",gap:8}}>
                <button className="tn-btn tn-btn--ghost" onClick={() => setShowForm(false)}>Cerrar</button>
                <button className="tn-btn tn-btn--primary" onClick={saveTender} disabled={saving}>
                  {saving ? "Guardando…" : editData ? "💾 Guardar cambios" : "✓ Crear licitación"}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </Layout>
  );
}