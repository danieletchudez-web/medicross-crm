import { useEffect, useMemo, useState, useRef } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import { bacTenderNotes, comparativaSignature, parseBacComparativaFile } from "../lib/bacComparativa";
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

/* ─── Helpers de inteligencia ──────────────────────────────────────── */
const OWN_INTEL_ALIASES = ["MEDI-CROSS","MEDICROSS","STORING INSUMOS MEDICOS"];
function normalizeIntel(v){return String(v||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();}
function isOwnIntel(row){return Boolean(row?.es_nuestra_oferta)||OWN_INTEL_ALIASES.some(a=>normalizeIntel(row?.empresa).includes(normalizeIntel(a)));}
function priceIntel(row){const n=Number(row?.precio_unitario);return Number.isFinite(n)&&n>=1?n:null;}
function moneyIntel(v){const n=Number(v||0);return n?"$"+n.toLocaleString("es-AR",{minimumFractionDigits:0,maximumFractionDigits:0}):"—";}
function pctIntel(values,pct){const s=[...values].filter(Number.isFinite).sort((a,b)=>a-b);if(!s.length)return null;const i=(s.length-1)*pct;const lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(i-lo);}

const CERRADAS = ["Finalizada","Perdida / No adjudicada","Vencida","Cobrada"];
const EN_CURSO = ["En análisis","Cotizada","Presentada","Adjudicada",
                  "Orden de compra recibida","En ejecución","Entrega parcial",
                  "Entregada","Facturada"];
const ESTADOS_GANADOS = ["Adjudicada","Orden de compra recibida","En ejecución",
                         "Entrega parcial","Entregada","Facturada","Cobrada","Finalizada"];

function isTenderLost(t) {
  return t?.resultado === "perdida" || t?.operational_status === "Perdida / No adjudicada";
}

function isTenderWon(t) {
  if (isTenderLost(t)) return false;
  return t?.resultado === "ganada" || ESTADOS_GANADOS.includes(t?.operational_status);
}

function operationalStatusFromResult(form) {
  const current = normalizeSelect(form?.operational_status, ESTADOS, "En análisis");
  if (form?.resultado === "perdida") return "Perdida / No adjudicada";
  if (form?.resultado === "ganada") return ESTADOS_GANADOS.includes(current) ? current : "Adjudicada";
  return current;
}

const EMPTY_FORM = {
  jurisdiction:"", institution:"", process_type:"", process_number:"",
  tender_type:"Original", process_name:"", expedient_number:"",
  requesting_sector:"", contract_term:"", purchase_order_number:"",
  purchase_order_date:"", purchase_order_amount:"",
  detection_date:"", start_date:"", end_date:"",
  validity_status:"En análisis", execution_policy:"", bridge_ot:"",
  internal_owner:"", product_line:"", operational_status:"En análisis",
  next_action:"", next_action_date:"",
  documentation_status:"Pendiente", documentation_pending_detail:"",
  billing_status:"Pendiente", delivery_status:"Pendiente",
  priority:"Media", portal_link:"", notes:"",
  resultado:"", monto_adjudicado:"", motivo_perdida:"", competitor_winner:"",
};

const EMPTY_COMPETITOR = { name:"", price:"", notes:"" };

const SOURCE_PRESETS = [
  { id:"bac", label:"BAC / cuadro comparativo", jurisdiction:"CABA", process_type:"Comparativa BAC", notes:"Fuente BAC. Completar sólo si se va a participar." },
  { id:"pba", label:"Provincia / PBA", jurisdiction:"PBA", process_type:"Licitación pública", notes:"Carga rápida desde portal provincial." },
  { id:"nacion", label:"Nación", jurisdiction:"NACIÓN", process_type:"Licitación pública", notes:"Carga rápida desde portal nacional." },
  { id:"privada", label:"Institución privada", jurisdiction:"", process_type:"Compra privada", notes:"Solicitud directa de institución privada." },
];

const EMPTY_QUICK_TENDER = {
  source:"bac", institution:"", process_number:"", end_date:"",
  process_name:"", portal_link:"", internal_owner:"", notes:"",
};

const today = () => new Date().toISOString().slice(0,10);

function fmtDate(d) {
  if (!d) return "—";
  const [y,m,dd] = String(d).slice(0,10).split("-");
  return `${dd}/${m}/${y.slice(2)}`;
}

function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})
    + " " + dt.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
}

function compactMoney(v) {
  const n = Number(v||0); if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(1).replace(".",",")} MM`;
  if (n >= 1_000_000)     return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
  if (n >= 1_000)         return `$${Math.round(n/1_000)} K`;
  return `$${n.toLocaleString("es-AR")}`;
}

function fullMoney(v) {
  const n = Number(v||0);
  if (!n) return "—";
  return "$" + n.toLocaleString("es-AR",{minimumFractionDigits:0,maximumFractionDigits:0});
}

function comparablePrice(rowOrValue) {
  const value = typeof rowOrValue === "object" ? rowOrValue?.precio_unitario : rowOrValue;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function comparableMoney(v) {
  const n = comparablePrice(v);
  return n === null ? "—" : fullMoney(n);
}

function pctVsMin(value, min) {
  const price = comparablePrice(value);
  if (price === null || !min || price === min) return null;
  return ((price - min) / min * 100).toFixed(1);
}

const OWN_COMPANY_ALIASES = ["MEDI-CROSS", "MEDICROSS", "STORING INSUMOS MEDICOS"];

function normalizeCompanyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function isOwnCompany(value) {
  const name = normalizeCompanyText(value);
  return OWN_COMPANY_ALIASES.some(alias => name.includes(normalizeCompanyText(alias)));
}

function isOwnOffer(row) {
  return Boolean(row?.es_nuestra_oferta) || isOwnCompany(row?.empresa);
}

function daysUntil(d) {
  if (!d) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((new Date(String(d).slice(0,10)+"T00:00:00") - now) / 86400000);
}

function progColor(days) {
  if (days === null) return "#94a3b8";
  if (days < 0)  return "#ef4444";
  if (days <= 1) return "#ef4444";
  if (days <= 3) return "#f97316";
  if (days <= 7) return "#eab308";
  return "#22c55e";
}

function dotColor(days) {
  if (days === null) return "gray";
  if (days < 0)  return "red";
  if (days <= 1) return "red";
  if (days <= 3) return "orange";
  if (days <= 7) return "yellow";
  return "green";
}

function actionDotColor(t) {
  if (!t.next_action) return "red";
  if (!t.next_action_date) return "yellow";
  const d = daysUntil(t.next_action_date);
  if (d < 0)  return "red";
  if (d <= 3) return "yellow";
  return "green";
}

function calcProgress(t) {
  if (!t.end_date) return null;
  const startStr = t.detection_date ? String(t.detection_date).slice(0,10)
    : t.created_at ? String(t.created_at).slice(0,10) : null;
  if (!startStr) return null;
  const start = new Date(startStr + "T00:00:00");
  const end   = new Date(String(t.end_date).slice(0,10) + "T00:00:00");
  const now   = new Date(); now.setHours(0,0,0,0);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const total = end - start;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(3, Math.round((now - start) / total * 100)));
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

function normalizeSelect(val, options, fallback) {
  if (!val) return fallback;
  if (options.includes(val)) return val;
  return options.find(o => o.toUpperCase() === val.toUpperCase()) || fallback;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function tenderDisplayTitle(t) {
  return t?.process_name || t?.process_number || t?.institution || "Licitación sin título";
}

function getTenderCompleteness(t) {
  const missing = [];
  if (!t?.institution) missing.push("institución");
  if (!t?.process_number && !t?.expedient_number) missing.push("proceso/expediente");
  if (!t?.process_name) missing.push("objeto");
  if (!t?.end_date) missing.push("vencimiento");
  if (!t?.internal_owner) missing.push("responsable");
  if (!t?.next_action) missing.push("próxima acción");
  if (t?.documentation_status !== "Completa") missing.push("documentación");
  const score = Math.max(0, Math.round(((7 - missing.length) / 7) * 100));
  const status = score >= 86 ? "Lista para cotizar" : score >= 58 ? "Completar datos clave" : "Borrador operativo";
  return { score, missing, status };
}

function suggestPriority(t) {
  const days = daysUntil(t?.end_date);
  const amount = Number(t?.purchase_order_amount || 0);
  if (days !== null && days <= 3) return "Crítica";
  if ((days !== null && days <= 7) || amount >= 25000000) return "Alta";
  return "Media";
}

function findTenderDuplicates(source, rows, excludeId = null) {
  const process = normalizeKey(source?.process_number);
  const expedient = normalizeKey(source?.expedient_number);
  const institution = normalizeKey(source?.institution);
  return rows.filter(row => {
    if (excludeId && row.id === excludeId) return false;
    const rowProcess = normalizeKey(row.process_number);
    const rowExpedient = normalizeKey(row.expedient_number);
    const rowInstitution = normalizeKey(row.institution);
    if (process && rowProcess && process === rowProcess) return true;
    if (expedient && rowExpedient && expedient === rowExpedient) return true;
    return institution && process && rowInstitution === institution && rowProcess === process;
  });
}

function fileIcon(name) {
  const ext = (name||"").split(".").pop().toLowerCase();
  if (ext==="pdf") return "📄";
  if (ext==="xlsx"||ext==="xls") return "📊";
  if (ext==="docx"||ext==="doc") return "📝";
  return "📎";
}

const COLS = [
  { key:"_check",               label:"☑",              w:36,  fixed:true },
  { key:"_alert",               label:"⚡",              w:52,  fixed:true },
  { key:"jurisdiction",         label:"Jurisdicción",    w:110 },
  { key:"institution",          label:"Hospital / Inst.", w:200 },
  { key:"process_number",       label:"N° Proceso",      w:130 },
  { key:"process_name",         label:"Nombre proceso",  w:220 },
  { key:"expedient_number",     label:"Expediente",      w:140 },
  { key:"process_type",         label:"Tipo proceso",    w:150 },
  { key:"tender_type",          label:"Tipo",            w:90  },
  { key:"end_date",             label:"Vencimiento",     w:100 },
  { key:"_progress",            label:"Tiempo restante", w:160 },
  { key:"operational_status",   label:"Estado",          w:185 },
  { key:"priority",             label:"Prioridad",       w:95  },
  { key:"purchase_order_amount",label:"Monto OC",        w:120 },
  { key:"monto_adjudicado",     label:"Adj. final",      w:120 },
  { key:"internal_owner",       label:"Responsable",     w:120 },
  { key:"product_line",         label:"Línea prod.",     w:120 },
  { key:"next_action",          label:"Próxima acción",  w:180 },
  { key:"next_action_date",     label:"Fecha acción",    w:100 },
  { key:"documentation_status", label:"Doc.",            w:100 },
  { key:"billing_status",       label:"Facturación",     w:100 },
  { key:"delivery_status",      label:"Entrega",         w:90  },
  { key:"purchase_order_number",label:"N° OC",           w:110 },
  { key:"purchase_order_date",  label:"Fecha OC",        w:95  },
  { key:"start_date",           label:"Inicio",          w:90  },
  { key:"execution_policy",     label:"Póliza",          w:100 },
  { key:"bridge_ot",            label:"OT Bridge",       w:100 },
  { key:"contract_term",        label:"Plazo",           w:85  },
  { key:"requesting_sector",    label:"Sector",          w:120 },
  { key:"_attachments",         label:"📎",              w:60  },
  { key:"notes",                label:"Observaciones",   w:210 },
  { key:"_actions",             label:"",                w:80,  fixed:true },
];

/* ─── ADJUNTOS INLINE ────────────────────────────────────────────────── */
function InlineAttachments({ tenderId }) {
  const [fileList, setFileList]   = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadingF, setLoadingF]   = useState(true);
  const inputRef = useRef(null);
  const folder   = `tender_${tenderId}`;

  useEffect(() => { if (tenderId) load(); }, [tenderId]);

  async function load() {
    setLoadingF(true);
    const { data } = await supabase.storage.from(BUCKET).list(folder);
    setFileList(data || []);
    setLoadingF(false);
  }

  async function handleUpload(e) {
    const list = Array.from(e.target.files||[]);
    if (!list.length) return;
    setUploading(true);
    for (const file of list) {
      const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_");
      await supabase.storage.from(BUCKET).upload(`${folder}/${Date.now()}_${safe}`, file, {
        cacheControl:"3600", upsert:false, contentType:file.type,
      });
    }
    await load();
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete(name) {
    if (!confirm(`¿Eliminar "${name.replace(/^\d+_/,"")}"?`)) return;
    await supabase.storage.from(BUCKET).remove([`${folder}/${name}`]);
    setFileList(prev => prev.filter(f => f.name !== name));
  }

  function getUrl(name) {
    return supabase.storage.from(BUCKET).getPublicUrl(`${folder}/${name}`).data.publicUrl;
  }

  return (
    <div className="tn-inline-attach">
      <div className="tn-attach-toolbar">
        <button type="button" className="tn-btn tn-btn--ghost tn-btn--sm"
          onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? "⏳ Subiendo…" : "📎 Adjuntar archivos"}
        </button>
        <span className="tn-attach-hint">PDF · Word · Excel · múltiples archivos</span>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx"
          style={{display:"none"}} onChange={handleUpload}/>
      </div>
      {loadingF ? <p className="tn-attach-empty">Cargando…</p>
      : fileList.length === 0 ? <p className="tn-attach-empty">Sin archivos adjuntos todavía.</p>
      : (
        <div className="tn-file-list">
          {fileList.map(f => (
            <div key={f.name} className="tn-file-row">
              <span className="tn-file-icon">{fileIcon(f.name)}</span>
              <span className="tn-file-name" title={f.name.replace(/^\d+_/,"")}>{f.name.replace(/^\d+_/,"")}</span>
              <span className="tn-file-size">{f.metadata?.size?`${Math.round(f.metadata.size/1024)} KB`:""}</span>
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

/* ─── HISTORIAL ──────────────────────────────────────────────────────── */
function TenderHistory({ tenderId }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [nota, setNota]       = useState("");
  const [saving, setSaving]   = useState(false);

  useEffect(() => { if (tenderId) loadLogs(); }, [tenderId]);

  async function loadLogs() {
    setLoading(true);
    const { data } = await supabase
      .from("tender_logs").select("*").eq("tender_id", tenderId)
      .order("created_at", { ascending: false });
    setLogs(data || []);
    setLoading(false);
  }

  async function addNote() {
    if (!nota.trim()) return;
    setSaving(true);
    await supabase.from("tender_logs").insert([{
      tender_id: tenderId, action: "nota",
      description: nota.trim(), created_at: new Date().toISOString(),
    }]);
    setNota("");
    await loadLogs();
    setSaving(false);
  }

  if (loading) return <div className="tn-history-empty">Cargando historial…</div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:8}}>
        <input
          style={{flex:1,padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12.5,fontFamily:"inherit",outline:"none"}}
          placeholder="Agregar nota o comentario de seguimiento…"
          value={nota} onChange={e=>setNota(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&addNote()}
        />
        <button className="tn-btn tn-btn--primary tn-btn--sm" onClick={addNote} disabled={saving||!nota.trim()}>
          {saving?"…":"+ Agregar"}
        </button>
      </div>
      {logs.length === 0
        ? <div className="tn-history-empty">Sin historial todavía.</div>
        : (
          <div className="tn-history">
            {logs.map((log,i) => (
              <div key={log.id||i} className="tn-history-item">
                <div className={`tn-history-dot ${log.action==="nota"?"tn-history-dot--gray":""}`}/>
                <div className="tn-history-line">
                  <div className="tn-history-action">
                    {log.action==="nota" ? "💬 Nota" :
                     log.action==="estado" ? `🔄 Estado → ${log.new_value}` :
                     log.action==="creacion" ? "✅ Licitación creada" :
                     log.action==="cotizador" ? "📊 Cotización iniciada" :
                     log.action}
                  </div>
                  {log.description && <div className="tn-history-note">{log.description}</div>}
                  {log.action==="estado" && log.old_value &&
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>antes: {log.old_value}</div>}
                  <div className="tn-history-meta">
                    {log.user_name||"Sistema"} · {fmtDateTime(log.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}

/* ─── COMPETIDORES ───────────────────────────────────────────────────── */
function Competitors({ tenderId }) {
  const [comps, setComps]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft]     = useState(null);

  useEffect(() => { if (tenderId) load(); }, [tenderId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("tender_competitors").select("*").eq("tender_id", tenderId)
      .order("created_at", { ascending: true });
    setComps(data || []);
    setLoading(false);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name?.trim()) { alert("Ingresá el nombre del competidor."); return; }
    if (draft.id) {
      await supabase.from("tender_competitors").update({
        name: draft.name, price: draft.price||null, notes: draft.notes||null
      }).eq("id", draft.id);
    } else {
      await supabase.from("tender_competitors").insert([{
        tender_id: tenderId, name: draft.name,
        price: draft.price||null, notes: draft.notes||null
      }]);
    }
    setDraft(null);
    await load();
  }

  async function remove(id) {
    if (!confirm("¿Eliminar este competidor?")) return;
    await supabase.from("tender_competitors").delete().eq("id", id);
    setComps(prev => prev.filter(c => c.id !== id));
  }

  if (loading) return <div style={{fontSize:12,color:"#94a3b8",padding:"12px 0"}}>Cargando…</div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div className="tn-comp-header">
        <span>Empresa / Competidor</span>
        <span>Precio ofertado ($)</span>
        <span>Observaciones</span>
        <span/>
      </div>
      <div className="tn-comp-list">
        {comps.map(c => (
          draft?.id === c.id ? (
            <div key={c.id} className="tn-comp-row" style={{background:"#eff6ff",borderColor:"#93c5fd"}}>
              <input value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} placeholder="Nombre empresa"/>
              <input value={draft.price||""} onChange={e=>setDraft(d=>({...d,price:e.target.value}))} placeholder="0" type="number" min="0"/>
              <input value={draft.notes||""} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} placeholder="Nota…"/>
              <div style={{display:"flex",gap:4}}>
                <button className="tn-btn tn-btn--primary tn-btn--sm" onClick={saveDraft}>✓</button>
                <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>setDraft(null)}>✕</button>
              </div>
            </div>
          ) : (
            <div key={c.id} className="tn-comp-row">
              <span style={{fontWeight:600,fontSize:12.5}}>{c.name}</span>
              <span style={{fontFamily:"DM Mono, monospace",fontSize:12}}>{c.price?fullMoney(c.price):"—"}</span>
              <span style={{fontSize:11.5,color:"#64748b"}}>{c.notes||"—"}</span>
              <div style={{display:"flex",gap:4}}>
                <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>setDraft({...c})}>✎</button>
                <button className="tn-btn tn-btn--danger tn-btn--sm" onClick={()=>remove(c.id)}>✕</button>
              </div>
            </div>
          )
        ))}
        {draft && !draft.id && (
          <div className="tn-comp-row" style={{background:"#eff6ff",borderColor:"#93c5fd"}}>
            <input autoFocus value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} placeholder="Nombre empresa"/>
            <input value={draft.price||""} onChange={e=>setDraft(d=>({...d,price:e.target.value}))} placeholder="0" type="number" min="0"/>
            <input value={draft.notes||""} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} placeholder="Observación…"/>
            <div style={{display:"flex",gap:4}}>
              <button className="tn-btn tn-btn--primary tn-btn--sm" onClick={saveDraft}>✓ Guardar</button>
              <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>setDraft(null)}>✕</button>
            </div>
          </div>
        )}
      </div>
      {!draft && (
        <button className="tn-comp-add" onClick={()=>setDraft({...EMPTY_COMPETITOR})}>
          + Agregar competidor
        </button>
      )}
    </div>
  );
}

/* ─── RESULTADO BOX ──────────────────────────────────────────────────── */
function ResultadoBox({ form, setForm }) {
  const estado = form.resultado;
  const cls    = estado==="ganada"?"ganada":estado==="perdida"?"perdida":"pendiente";
  const updateResultado = (resultado) => {
    setForm(p => {
      const next = { ...p, resultado };
      return { ...next, operational_status: operationalStatusFromResult(next) };
    });
  };
  return (
    <div className={`tn-resultado-box tn-resultado-box--${cls}`}>
      <div>
        <span className={`tn-resultado-label tn-resultado-label--${cls}`}>
          {cls==="ganada"?"✅ GANADA":cls==="perdida"?"❌ PERDIDA":"⏳ Resultado pendiente"}
        </span>
      </div>
      <div className="tn-form-grid">
        <div className="tn-field">
          <label>Resultado final</label>
          <select value={form.resultado} onChange={e=>updateResultado(e.target.value)}>
            <option value="">Pendiente</option>
            <option value="ganada">✅ Ganada / Adjudicada</option>
            <option value="perdida">❌ Perdida / No adjudicada</option>
          </select>
        </div>
        <div className="tn-field">
          <label>Monto adjudicado final ($)</label>
          <input type="number" value={form.monto_adjudicado}
            onChange={e=>setForm(p=>({...p,monto_adjudicado:e.target.value}))}
            placeholder="Monto real de la OC" min="0"/>
          {form.monto_adjudicado && <span className="tn-resultado-monto">{fullMoney(form.monto_adjudicado)}</span>}
        </div>
        {form.resultado==="perdida" && <>
          <div className="tn-field">
            <label>Motivo de pérdida</label>
            <input value={form.motivo_perdida}
              onChange={e=>setForm(p=>({...p,motivo_perdida:e.target.value}))}
              placeholder="Ej: Precio, marca, técnica, descalificado…"/>
          </div>
          <div className="tn-field">
            <label>Empresa que ganó</label>
            <input value={form.competitor_winner}
              onChange={e=>setForm(p=>({...p,competitor_winner:e.target.value}))}
              placeholder="Nombre del competidor adjudicado"/>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ─── COMPARATIVA ────────────────────────────────────────────────────── */
function Comparativa({ tenderId, tenderInfo }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft]         = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { if (tenderId) load(); }, [tenderId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("tender_comparativas").select("*").eq("tender_id", tenderId)
      .order("renglon").order("empresa");
    setRows(data || []);
    setLoading(false);
  }

  async function handleImportExcel(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      let headerRowIdx = -1;
      for (let i = 0; i < raw.length; i++) {
        const rowStr = raw[i].join("|").toLowerCase();
        if (rowStr.includes("renglón") && rowStr.includes("opción")) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx === -1) {
        alert("No se pudo detectar el formato. Verificá que sea el cuadro comparativo oficial del GCABA.");
        setImporting(false);
        return;
      }

      const empresaRowData = raw[headerRowIdx - 1];
      const headerRow      = raw[headerRowIdx];

      const empresas = [];
      let currentEmpresa = "";
      for (let c = 0; c < headerRow.length; c++) {
        if (empresaRowData[c] && String(empresaRowData[c]).trim()) {
          currentEmpresa = String(empresaRowData[c]).trim();
        }
        if (String(headerRow[c] || "").toLowerCase().includes("precio unitario")) {
          empresas.push({ nombre: currentEmpresa, colPrecio: c });
        }
      }

      const colRenglon = headerRow.findIndex(h => String(h).toLowerCase().trim() === "renglón");
      const colDesc    = headerRow.findIndex(h => String(h).toLowerCase().includes("descripci"));
      const colCant    = headerRow.findIndex(h => String(h).toLowerCase().includes("cantidad solicitada"));

      if (!empresas.length) {
        alert("No se detectaron empresas en el Excel.");
        setImporting(false);
        return;
      }

      const toInsert = [];
      for (let i = headerRowIdx + 1; i < raw.length; i++) {
        const row     = raw[i];
        const renglon = parseInt(row[colRenglon]);
        if (!renglon || isNaN(renglon)) continue;

        const descripcion = String(row[colDesc] || "").slice(0, 300).trim();
        const cantidad    = parseInt(row[colCant]) || 1;

        for (const emp of empresas) {
          const precioRaw = parseFloat(String(row[emp.colPrecio] || "").replace(/[^0-9.,]/g, "").replace(",", "."));
          if (!precioRaw || isNaN(precioRaw)) continue;

          const colTotalArs = emp.colPrecio + 4;
          const totalRaw    = parseFloat(String(row[colTotalArs] || "").replace(/[^0-9.,]/g, "").replace(",", "."));

          toInsert.push({
            tender_id:         tenderId,
            renglon,
            descripcion,
            empresa:           emp.nombre,
            es_nuestra_oferta: isOwnCompany(emp.nombre),
            moneda:            "ARS",
            precio_unitario:   precioRaw,
            cantidad,
            total_ars:         (totalRaw && !isNaN(totalRaw)) ? totalRaw : precioRaw * cantidad,
            adjudicado:        false,
          });
        }
      }

      if (!toInsert.length) {
        alert("No se encontraron datos de precios en el archivo.");
        setImporting(false);
        return;
      }

      await supabase.from("tender_comparativas").delete().eq("tender_id", tenderId);
      await supabase.from("tender_comparativas").insert(toInsert);
      await load();
      alert(`✅ Importados ${toInsert.length} registros de ${empresas.length} empresas.`);
    } catch (err) {
      console.error(err);
      alert("Error al procesar el archivo: " + err.message);
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.empresa?.trim()) { alert("Ingresá el nombre de la empresa."); return; }
    const precio = parseFloat(draft.precio_unitario) || 0;
    const cant   = parseInt(draft.cantidad) || 1;
    const payload = {
      tender_id:         tenderId,
      renglon:           parseInt(draft.renglon) || 1,
      descripcion:       draft.descripcion || "",
      empresa:           draft.empresa,
      es_nuestra_oferta: isOwnCompany(draft.empresa),
      moneda:            "ARS",
      precio_unitario:   precio,
      cantidad:          cant,
      total_ars:         precio * cant,
      adjudicado:        draft.adjudicado || false,
    };
    if (draft.id) {
      await supabase.from("tender_comparativas").update(payload).eq("id", draft.id);
    } else {
      await supabase.from("tender_comparativas").insert([payload]);
    }
    setDraft(null);
    await load();
  }

  async function toggleAdjudicado(row) {
    await supabase.from("tender_comparativas").update({ adjudicado: !row.adjudicado }).eq("id", row.id);
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, adjudicado: !r.adjudicado } : r));
  }

  async function removeRow(id) {
    if (!confirm("¿Eliminar esta fila?")) return;
    await supabase.from("tender_comparativas").delete().eq("id", id);
    setRows(prev => prev.filter(r => r.id !== id));
  }

  const renglones = useMemo(() => [...new Set(rows.map(r => r.renglon))].sort((a,b) => a-b), [rows]);
  const empresas  = useMemo(() => [...new Set(rows.map(r => r.empresa))].sort(), [rows]);
  const matriz    = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      if (!m[r.renglon]) m[r.renglon] = {};
      m[r.renglon][r.empresa] = r;
    });
    return m;
  }, [rows]);

  function precioMin(renglon) {
    const precios = Object.values(matriz[renglon] || {}).map(comparablePrice).filter(p => p !== null);
    return precios.length ? Math.min(...precios) : null;
  }

  async function exportarExcel() {
    if (!rows.length) return;
    setExporting(true);
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const wb   = XLSX.utils.book_new();

      const COLOR_NAVY    = "0F2444";
      const COLOR_HEADER  = "1A3A6B";
      const COLOR_NUESTRA = "DBEAFE";
      const COLOR_ADJ     = "D4EDDA";
      const COLOR_MIN     = "166534";
      const COLOR_ALT     = "F8FAFC";
      const COLOR_WHITE   = "FFFFFF";

      const fmtPct = (v, min) => {
        const price = comparablePrice(v);
        if (price === null || !min) return "";
        if (price === min)  return "PRECIO MÍNIMO";
        return "+" + pctVsMin(price, min) + "%";
      };

      const h1 = [
        "Renglón","Descripción","Empresa","Nuestra oferta",
        "Precio unitario ($)","Cantidad","Total ARS ($)",
        "Precio mínimo del renglón ($)","Diferencia vs mínimo","Adjudicado",
      ];
      const d1 = rows.map(r => {
        const min = precioMin(r.renglon);
        return [r.renglon,r.descripcion,r.empresa,isOwnOffer(r)?"Sí":"No",
          r.precio_unitario,r.cantidad,r.total_ars,min,fmtPct(r.precio_unitario,min),r.adjudicado?"Adjudicado":""];
      });
      const ws1 = XLSX.utils.aoa_to_sheet([h1,...d1]);
      ws1["!cols"] = [{wch:8},{wch:55},{wch:30},{wch:14},{wch:22},{wch:10},{wch:22},{wch:28},{wch:22},{wch:14}];
      ["A1","B1","C1","D1","E1","F1","G1","H1","I1","J1"].forEach(ref => {
        if (!ws1[ref]) return;
        ws1[ref].s = { font:{bold:true,color:{rgb:COLOR_WHITE},sz:11}, fill:{fgColor:{rgb:COLOR_NAVY}}, alignment:{horizontal:"center",vertical:"center",wrapText:true} };
      });
      d1.forEach((row,i) => {
        const xlRow = i+2;
        const esNuestra = row[3]==="Sí", esAdj = row[9]==="Adjudicado", esMenor = row[8]==="PRECIO MÍNIMO";
        const bgColor = esNuestra?COLOR_NUESTRA:esAdj?COLOR_ADJ:i%2===0?COLOR_WHITE:COLOR_ALT;
        ["A","B","C","D","E","F","G","H","I","J"].forEach((col,ci) => {
          const ref = `${col}${xlRow}`;
          if (!ws1[ref]) ws1[ref] = {v:"",t:"s"};
          ws1[ref].s = {
            fill:{fgColor:{rgb:bgColor}},
            font:{bold:ci===2&&esNuestra,color:{rgb:esMenor&&ci===8?COLOR_MIN:ci===8&&row[8].startsWith&&row[8].startsWith("+")?"DC2626":"0F172A"},sz:10},
            alignment:{horizontal:ci>=4?"right":"left",vertical:"center"},
            border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}},right:{style:"thin",color:{rgb:"E2E8F0"}}},
            numFmt:ci>=4&&ci<=7?"#,##0":undefined,
          };
        });
      });
      XLSX.utils.book_append_sheet(wb, ws1, "Detalle por empresa");

      const pivotHeader = ["Reng.","Descripción",...empresas];
      const pivotData = renglones.map(reng => {
        const descRow = Object.values(matriz[reng]||{})[0];
        return [reng,descRow?.descripcion||"",...empresas.map(emp => { const cell=matriz[reng]?.[emp]; return cell?cell.precio_unitario:null; })];
      });
      const ws2 = XLSX.utils.aoa_to_sheet([pivotHeader,...pivotData]);
      ws2["!cols"] = [{wch:8},{wch:55},...empresas.map(()=>({wch:24}))];
      pivotHeader.forEach((_,ci) => {
        const ref = XLSX.utils.encode_cell({r:0,c:ci});
        if (!ws2[ref]) return;
        const esNuestra = ci>=2&&isOwnCompany(empresas[ci-2]);
        ws2[ref].s = {font:{bold:true,color:{rgb:COLOR_WHITE},sz:11},fill:{fgColor:{rgb:esNuestra?COLOR_HEADER:COLOR_NAVY}},alignment:{horizontal:"center",vertical:"center",wrapText:true}};
      });
      pivotData.forEach((row,ri) => {
        const min = precioMin(renglones[ri]);
        row.forEach((val,ci) => {
          const ref = XLSX.utils.encode_cell({r:ri+1,c:ci});
          if (!ws2[ref]) ws2[ref]={v:val??"",t:val===null?"s":typeof val==="number"?"n":"s"};
          const esNuestra=ci>=2&&isOwnCompany(empresas[ci-2]);
          const esMenor=ci>=2&&comparablePrice(val)===min&&min!==null;
          const bgColor=esNuestra?COLOR_NUESTRA:ri%2===0?COLOR_WHITE:COLOR_ALT;
          ws2[ref].s={fill:{fgColor:{rgb:esMenor?COLOR_ADJ:bgColor}},font:{bold:esMenor,color:{rgb:esMenor?COLOR_MIN:"0F172A"},sz:10},alignment:{horizontal:ci>=2?"right":ci===0?"center":"left",vertical:"center"},numFmt:ci>=2?"#,##0":undefined,border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}},right:{style:"thin",color:{rgb:"E2E8F0"}}}};
        });
      });
      XLSX.utils.book_append_sheet(wb, ws2, "Comparativa pivot");

      const h3 = ["Renglón","Descripción","Nuestro precio ($)","Precio mínimo ($)","Diferencia vs mínimo","Empresa ganadora (precio)","Adjudicado a"];
      const d3 = renglones.map(reng => {
        const nuestra=rows.find(r=>r.renglon===reng&&isOwnOffer(r));
        const min=precioMin(reng);
        const ganador=rows.find(r=>r.renglon===reng&&r.adjudicado);
        const empMenor=rows.find(r=>r.renglon===reng&&comparablePrice(r)===min);
        const descRow=Object.values(matriz[reng]||{})[0];
        return [reng,descRow?.descripcion||"",nuestra?.precio_unitario||null,min||null,nuestra?fmtPct(nuestra.precio_unitario,min):"Sin oferta",empMenor?.empresa||"",ganador?.empresa||""];
      });
      const ws3 = XLSX.utils.aoa_to_sheet([h3,...d3]);
      ws3["!cols"] = [{wch:8},{wch:55},{wch:22},{wch:22},{wch:24},{wch:32},{wch:32}];
      ["A1","B1","C1","D1","E1","F1","G1"].forEach(ref => {
        if (!ws3[ref]) return;
        ws3[ref].s={font:{bold:true,color:{rgb:COLOR_WHITE},sz:11},fill:{fgColor:{rgb:COLOR_NAVY}},alignment:{horizontal:"center",vertical:"center",wrapText:true}};
      });
      d3.forEach((row,i) => {
        const xlRow=i+2, esMenor=row[4]==="PRECIO MÍNIMO", bgColor=esMenor?COLOR_ADJ:i%2===0?COLOR_WHITE:COLOR_ALT;
        ["A","B","C","D","E","F","G"].forEach((col,ci) => {
          const ref=`${col}${xlRow}`;
          if (!ws3[ref]) ws3[ref]={v:"",t:"s"};
          ws3[ref].s={fill:{fgColor:{rgb:bgColor}},font:{bold:esMenor&&ci===4,color:{rgb:esMenor&&ci===4?COLOR_MIN:row[4]?.startsWith&&row[4].startsWith("+")&&ci===4?"DC2626":"0F172A"},sz:10},alignment:{horizontal:ci>=2?"right":"left",vertical:"center"},numFmt:(ci===2||ci===3)?"#,##0":undefined,border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}},right:{style:"thin",color:{rgb:"E2E8F0"}}}};
        });
      });
      XLSX.utils.book_append_sheet(wb, ws3, "Resumen posicion");

      const fechaExport = new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"});
      const meta = [
        ["ANÁLISIS COMPARATIVO DE LICITACIÓN"],[""],
        ["Generado por","MediCross CRM"],["Fecha de exportación",fechaExport],
        ["Licitación",tenderInfo?.process_number||"—"],["Hospital / Institución",tenderInfo?.institution||"—"],
        ["Nombre del proceso",tenderInfo?.process_name||"—"],["Fecha de apertura",tenderInfo?.end_date?fmtDate(tenderInfo.end_date):"—"],
        [""],["CONTENIDO DEL ARCHIVO"],[""],
        ["Hoja 1","Detalle completo — una fila por empresa y renglón con todas las métricas"],
        ["Hoja 2","Vista pivot — renglones como filas y empresas como columnas"],
        ["Hoja 3","Resumen de posición — nuestra oferta vs precio mínimo por renglón"],
        [""],["TOTALES"],[""],
        ["Total de renglones",renglones.length],["Total de empresas",empresas.length],["Total de ofertas",rows.length],
        ["Renglones donde fuimos precio mínimo",renglones.filter(reng=>{const n=rows.find(r=>r.renglon===reng&&isOwnOffer(r));return n&&comparablePrice(n)===precioMin(reng);}).length],
      ];
      const ws4 = XLSX.utils.aoa_to_sheet(meta);
      ws4["!cols"] = [{wch:40},{wch:70}];
      if (ws4["A1"]) { ws4["A1"].s={font:{bold:true,sz:16,color:{rgb:COLOR_NAVY}},fill:{fgColor:{rgb:"EFF6FF"}}}; ws4["!merges"]=[{s:{r:0,c:0},e:{r:0,c:1}}]; }
      XLSX.utils.book_append_sheet(wb, ws4, "Portada");
      wb.SheetNames = ["Portada","Detalle por empresa","Comparativa pivot","Resumen posicion"];

      const nombre = `comparativa_${(tenderInfo?.process_number||tenderId).replace(/[^a-zA-Z0-9]/g,"_")}_${today()}.xlsx`;
      XLSX.writeFile(wb, nombre);
    } catch(err) {
      console.error(err);
      alert("Error al exportar: " + err.message);
    }
    setExporting(false);
  }

  if (loading) return <div style={{fontSize:12,color:"#94a3b8",padding:"16px 0"}}>Cargando comparativa…</div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <button className="tn-btn tn-btn--primary tn-btn--sm" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? "⏳ Importando…" : "📊 Importar Excel BAC"}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleImportExcel}/>
        <button className="tn-btn tn-btn--ghost tn-btn--sm"
          onClick={() => setDraft({renglon:"",descripcion:"",empresa:"",precio_unitario:"",cantidad:1,adjudicado:false})}>
          + Cargar otra fuente
        </button>
        {rows.length > 0 && (
          <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={exportarExcel} disabled={exporting} style={{marginLeft:"auto"}}>
            {exporting ? "⏳ Exportando…" : "⬇ Exportar análisis (.xlsx)"}
          </button>
        )}
        {rows.length > 0 && <span style={{fontSize:11,color:"#94a3b8"}}>{renglones.length} renglones · {empresas.length} empresas</span>}
      </div>

      {draft && !draft.id && (
        <div style={{background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:8,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:11,fontWeight:600,color:"#1e40af",marginBottom:2}}>Nueva fila manual</div>
          <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 120px 80px",gap:8}}>
            {[
              {label:"Renglón",key:"renglon",type:"number",placeholder:"1"},
              {label:"Descripción",key:"descripcion",type:"text",placeholder:"Producto…"},
              {label:"Empresa",key:"empresa",type:"text",placeholder:"Nombre proveedor…"},
              {label:"Precio unit.",key:"precio_unitario",type:"number",placeholder:"0"},
              {label:"Cant.",key:"cantidad",type:"number",placeholder:"1"},
            ].map(f => (
              <div key={f.key} style={{display:"flex",flexDirection:"column",gap:3}}>
                <label style={{fontSize:10.5,color:"#64748b",fontWeight:500}}>{f.label}</label>
                <input type={f.type} placeholder={f.placeholder} value={draft[f.key]}
                  onChange={e=>setDraft(d=>({...d,[f.key]:e.target.value}))}
                  style={{padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",width:"100%",boxSizing:"border-box"}}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
            <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>setDraft(null)}>Cancelar</button>
            <button className="tn-btn tn-btn--primary tn-btn--sm" onClick={saveDraft}>✓ Guardar fila</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{textAlign:"center",padding:"32px",color:"#94a3b8",fontSize:13,background:"#f8fafc",borderRadius:10,border:"1px dashed #e2e8f0"}}>
          <div style={{fontSize:28,marginBottom:8}}>📊</div>
          <div style={{fontWeight:500}}>Sin comparativa cargada</div>
          <div style={{fontSize:12,marginTop:4}}>Importá el Excel oficial de BAC o cargá manualmente datos recibidos por otra fuente.</div>
        </div>
      ) : (
        <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #e2e8f0"}}>
          <table style={{borderCollapse:"collapse",width:"100%",fontSize:11.5,fontFamily:"DM Sans,sans-serif"}}>
            <thead>
              <tr style={{background:"#0f2444"}}>
                <th style={{padding:"9px 12px",textAlign:"left",color:"rgba(255,255,255,.8)",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",minWidth:40}}>Reng.</th>
                <th style={{padding:"9px 12px",textAlign:"left",color:"rgba(255,255,255,.8)",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",minWidth:200}}>Descripción</th>
                {empresas.map(emp => (
                  <th key={emp} style={{padding:"9px 12px",textAlign:"right",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".4px",whiteSpace:"nowrap",minWidth:130,color:isOwnCompany(emp)?"#86efac":"rgba(255,255,255,.75)",borderLeft:"1px solid rgba(255,255,255,.08)"}}>
                    {isOwnCompany(emp)?"★ ":""}{emp}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renglones.map((reng,idx) => {
                const descRow=Object.values(matriz[reng]||{})[0];
                const minPrecio=precioMin(reng);
                return (
                  <tr key={reng} style={{background:idx%2===0?"#fff":"#fafbfc"}}>
                    <td style={{padding:"10px 12px",fontWeight:700,color:"#0f2444",fontFamily:"DM Mono,monospace"}}>{reng}</td>
                    <td style={{padding:"10px 12px",color:"#334155",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={descRow?.descripcion||""}>
                      {descRow?.descripcion?descRow.descripcion.slice(0,80)+(descRow.descripcion.length>80?"…":""):"—"}
                    </td>
                    {empresas.map(emp => {
                      const cell=matriz[reng]?.[emp];
                      const esNuestra=isOwnCompany(emp);
                      const price=cell ? comparablePrice(cell) : null;
                      const esMinimo=cell&&minPrecio&&price===minPrecio;
                      const diff=cell ? pctVsMin(cell,minPrecio) : null;
                      return (
                        <td key={emp} style={{padding:"10px 12px",textAlign:"right",borderLeft:"1px solid #f0f4f8",background:esNuestra?"#f0f7ff":cell?.adjudicado?"#f0fdf4":undefined}}>
                          {cell?(
                            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                              <div style={{fontFamily:"DM Mono,monospace",fontWeight:700,fontSize:12,color:esMinimo?"#166534":price === null ? "#94a3b8" : "#334155"}}>
                                {esMinimo&&<span style={{marginRight:4,fontSize:10}}>🏆</span>}
                                {comparableMoney(cell.precio_unitario)}
                              </div>
                              {diff&&<div style={{fontSize:9.5,color:"#f97316",fontWeight:600}}>+{diff}%</div>}
                              {cell.adjudicado&&<span style={{fontSize:9,background:"#d4edda",color:"#1a5c2f",borderRadius:4,padding:"1px 5px",fontWeight:700}}>ADJ</span>}
                              <div style={{display:"flex",gap:3,marginTop:2}}>
                                <button onClick={()=>toggleAdjudicado(cell)} title={cell.adjudicado?"Quitar adjudicación":"Marcar adjudicado"} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,opacity:.5,padding:"1px 3px"}}>🏅</button>
                                <button onClick={()=>removeRow(cell.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,opacity:.4,padding:"1px 3px",color:"#ef4444"}}>✕</button>
                              </div>
                            </div>
                          ):<span style={{color:"#e2e8f0"}}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{background:"#f8fafc",borderRadius:10,border:"1px solid #e8ecf2",padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",color:"#94a3b8",marginBottom:8}}>Nuestra posición por renglón</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {renglones.map(reng => {
              const nuestra=rows.find(r=>r.renglon===reng&&isOwnOffer(r));
              const minPrecio=precioMin(reng);
              const nuestraPrice=nuestra ? comparablePrice(nuestra) : null;
              const ganamos=nuestra&&minPrecio&&nuestraPrice===minPrecio;
              const diff=nuestra ? pctVsMin(nuestra,minPrecio) : null;
              const ganador=rows.find(r=>r.renglon===reng&&r.adjudicado);
              return (
                <div key={reng} style={{display:"flex",alignItems:"center",gap:10,fontSize:11.5}}>
                  <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:"#0f2444",minWidth:28}}>R{reng}</span>
                  {nuestra?(
                    <>
                      <span style={{color:ganamos?"#166534":nuestraPrice === null ? "#94a3b8" : "#334155",fontWeight:600,fontFamily:"DM Mono,monospace"}}>{comparableMoney(nuestra.precio_unitario)}</span>
                      {nuestraPrice === null || !minPrecio
                        ? <span style={{background:"#eef2f7",color:"#64748b",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:700}}>Sin precio comparable</span>
                        : ganamos
                        ?<span style={{background:"#d4edda",color:"#1a5c2f",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:700}}>✓ Precio mínimo</span>
                        :<span style={{background:"#fde8e8",color:"#7f1d1d",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:700}}>+{diff}% sobre mínimo</span>
                      }
                      {ganador&&!nuestra.adjudicado&&<span style={{fontSize:10,color:"#64748b"}}>Ganó: {ganador.empresa}</span>}
                    </>
                  ):<span style={{color:"#94a3b8",fontSize:11}}>Sin oferta nuestra registrada</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TenderOperationalSummary({ form }) {
  const readiness = getTenderCompleteness(form);
  const days = daysUntil(form.end_date);
  const tone = readiness.score >= 86 ? "ready" : readiness.score >= 58 ? "warn" : "draft";
  return (
    <div className={`tn-readiness tn-readiness--${tone}`}>
      <div className="tn-readiness__score">
        <strong>{readiness.score}%</strong>
        <span>{readiness.status}</span>
      </div>
      <div className="tn-readiness__body">
        <div className="tn-readiness__bar"><span style={{ width:`${readiness.score}%` }}/></div>
        <div className="tn-readiness__meta">
          <span>{form.end_date ? `Vence ${fmtDate(form.end_date)}${days !== null ? ` · ${days < 0 ? "vencida" : days === 0 ? "hoy" : `${days}d`}` : ""}` : "Sin vencimiento"}</span>
          <span>{form.internal_owner || "Sin responsable"}</span>
        </div>
        {readiness.missing.length > 0 ? (
          <div className="tn-readiness__chips">
            {readiness.missing.map(item => <span key={item} className="tn-readiness__chip">Falta {item}</span>)}
          </div>
        ) : (
          <div className="tn-readiness__chips"><span className="tn-readiness__chip tn-readiness__chip--ok">Ficha lista para avanzar</span></div>
        )}
      </div>
    </div>
  );
}

function QuickTenderModal({ show, value, setValue, duplicates, saving, onClose, onSave }) {
  if (!show) return null;
  const selectedPreset = SOURCE_PRESETS.find(p => p.id === value.source) || SOURCE_PRESETS[0];
  const setQ = (key, next) => setValue(prev => ({ ...prev, [key]: next }));

  return (
    <div className="tn-overlay" onClick={e=>{if(e.target.classList.contains("tn-overlay"))onClose();}}>
      <div className="tn-modal tn-modal--compact">
        <div className="tn-modal__header">
          <div>
            <h3>⚡ Carga rápida de licitación</h3>
            <span style={{fontSize:11.5,color:"#94a3b8"}}>Registrá lo mínimo para no perder la oportunidad. Después completás la ficha.</span>
          </div>
          <button className="tn-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="tn-modal__body">
          <div className="tn-source-pills">
            {SOURCE_PRESETS.map(preset => (
              <button
                key={preset.id}
                className={`tn-source-pill ${value.source === preset.id ? "tn-source-pill--active" : ""}`}
                onClick={() => setValue(prev => ({ ...prev, source:preset.id }))}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {duplicates.length > 0 && (
            <div className="tn-duplicate-box">
              <strong>Posible duplicado detectado</strong>
              {duplicates.slice(0,3).map(row => (
                <span key={row.id}>{row.institution || "—"} · {row.process_number || row.expedient_number || "sin proceso"} · {row.operational_status || "—"}</span>
              ))}
            </div>
          )}

          <div className="tn-form-grid">
            <div className="tn-field">
              <label>Hospital / institución *</label>
              <input value={value.institution} onChange={e=>setQ("institution",e.target.value.toUpperCase())} placeholder="EJ: HOSPITAL ITALIANO"/>
            </div>
            <div className="tn-field">
              <label>N° proceso</label>
              <input value={value.process_number} onChange={e=>setQ("process_number",e.target.value.toUpperCase())} placeholder="EJ: 431-0786-LPU26"/>
            </div>
            <div className="tn-field">
              <label>Vencimiento / apertura</label>
              <input type="date" value={value.end_date} onChange={e=>setQ("end_date",e.target.value)}/>
            </div>
            <div className="tn-field">
              <label>Responsable</label>
              <input value={value.internal_owner} onChange={e=>setQ("internal_owner",e.target.value)} placeholder="Nombre del responsable"/>
            </div>
          </div>
          <div className="tn-form-grid tn-form-grid--1">
            <div className="tn-field">
              <label>Objeto / producto buscado</label>
              <input value={value.process_name} onChange={e=>setQ("process_name",e.target.value)} placeholder="Ej: adquisición de agujas, filtros, stents..."/>
            </div>
            <div className="tn-field">
              <label>Link fuente</label>
              <input value={value.portal_link} onChange={e=>setQ("portal_link",e.target.value)} placeholder="https://..."/>
            </div>
            <div className="tn-field">
              <label>Nota rápida</label>
              <textarea rows={3} value={value.notes} onChange={e=>setQ("notes",e.target.value)} placeholder={selectedPreset.notes}/>
            </div>
          </div>
        </div>
        <div className="tn-modal__footer">
          <span style={{fontSize:11,color:"#94a3b8"}}>Queda como borrador operativo hasta completar datos clave.</span>
          <div style={{display:"flex",gap:8}}>
            <button className="tn-btn tn-btn--ghost" onClick={onClose}>Cancelar</button>
            <button className="tn-btn" onClick={() => onSave(false)} disabled={saving}>Guardar borrador</button>
            <button className="tn-btn tn-btn--primary" onClick={() => onSave(true)} disabled={saving}>{saving ? "Guardando..." : "Guardar y completar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BacImportModal({ preview, setPreview, saving, onClose, onConfirm }) {
  if (!preview) return null;
  const meta = preview.metadata || {};
  const setMeta = (key, next) => setPreview(prev => ({ ...prev, metadata:{ ...(prev.metadata || {}), [key]: next } }));
  const sample = preview.rows.slice(0, 5);

  return (
    <div className="tn-overlay" onClick={e=>{if(e.target.classList.contains("tn-overlay"))onClose();}}>
      <div className="tn-modal" style={{maxWidth:980}}>
        <div className="tn-modal__header">
          <div>
            <h3>⬆ Importar comparativa BAC</h3>
            <span style={{fontSize:11.5,color:"#94a3b8"}}>{preview.fileName}</span>
          </div>
          <button className="tn-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="tn-modal__body">
          <div className="tn-bac-metrics">
            <div className="tn-bac-metric"><span>Empresas</span><strong>{preview.companyCount}</strong></div>
            <div className="tn-bac-metric"><span>Renglones</span><strong>{preview.itemCount}</strong></div>
            <div className="tn-bac-metric"><span>Precios</span><strong>{preview.rows.length}</strong></div>
            <div className="tn-bac-metric"><span>Duplicados internos</span><strong>{preview.discardedDuplicates}</strong></div>
          </div>

          <div className="tn-form-grid">
            <div className="tn-field"><label>Institución *</label><input value={meta.institution || ""} onChange={e=>setMeta("institution", e.target.value.toUpperCase())}/></div>
            <div className="tn-field"><label>N° proceso</label><input value={meta.processNumber || ""} onChange={e=>setMeta("processNumber", e.target.value.toUpperCase())}/></div>
            <div className="tn-field"><label>Expediente</label><input value={meta.expedientNumber || ""} onChange={e=>setMeta("expedientNumber", e.target.value.toUpperCase())}/></div>
            <div className="tn-field"><label>Fecha referencia</label><input type="date" value={meta.referenceDate || ""} onChange={e=>setMeta("referenceDate", e.target.value)}/></div>
          </div>
          <div className="tn-field">
            <label>Nombre del proceso</label>
            <input value={meta.processName || ""} onChange={e=>setMeta("processName", e.target.value)}/>
          </div>

          <div className="tn-bac-sample">
            <div className="tn-bac-sample__head">
              <strong>Vista previa</strong>
              <span>{preview.rows.length} referencias detectadas</span>
            </div>
            {sample.map((row, index) => (
              <div className="tn-bac-sample__row" key={`${row.renglon}-${row.empresa}-${index}`}>
                <span>R{row.renglon}</span>
                <strong>{row.empresa}</strong>
                <em>{row.descripcion || "Sin descripción"}</em>
                <b>{comparableMoney(row.precio_unitario)}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="tn-modal__footer">
          <span style={{fontSize:11,color:"#94a3b8"}}>Se crea o actualiza una licitación de referencia y se agregan sólo renglones nuevos.</span>
          <div style={{display:"flex",gap:8}}>
            <button className="tn-btn tn-btn--ghost" onClick={onClose}>Cancelar</button>
            <button className="tn-btn tn-btn--primary" onClick={onConfirm} disabled={saving}>{saving ? "Importando..." : "Importar comparativa"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PANEL INTELIGENCIA COMERCIAL ─────────────────────────────────── */
function TenderIntelligencePanel({ form }) {
  const keyword = (form.product_line||form.requesting_sector||"").trim();
  const institution = (form.institution||"").trim();
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!keyword) { setIntel(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("tender_comparativas")
        .select("id,descripcion,empresa,es_nuestra_oferta,precio_unitario,adjudicado,tender_id,tenders:tender_id(id,institution,end_date,resultado)")
        .ilike("descripcion", `%${keyword}%`)
        .limit(500);
      if (cancelled) return;
      const rows = data || [];
      const tmap = {};
      rows.forEach(r => {
        const tid = r.tender_id;
        if (!tmap[tid]) tmap[tid] = { tender: r.tenders, hasOwn: false, ownPrices: [], inst: r.tenders?.institution||"" };
        if (isOwnIntel(r)) { tmap[tid].hasOwn=true; const p=priceIntel(r); if(p!==null) tmap[tid].ownPrices.push(p); }
      });
      const own = Object.values(tmap).filter(t=>t.hasOwn);
      const timesQuoted = own.length;
      const timesWon = own.filter(t=>t.tender?.resultado==="ganada").length;
      const winRate = timesQuoted>0?Math.round(timesWon/timesQuoted*100):null;
      const wonPrices = own.filter(t=>t.tender?.resultado==="ganada").flatMap(t=>t.ownPrices);
      const recommended = wonPrices.length>=2?Math.round(pctIntel(wonPrices,0.40)):wonPrices.length===1?wonPrices[0]:null;
      const normInst = institution.slice(0,12).toUpperCase();
      const instTenders = normInst?own.filter(t=>t.inst.toUpperCase().includes(normInst)):[];
      const instWon = instTenders.filter(t=>t.tender?.resultado==="ganada").length;
      const compCounts = {};
      rows.filter(r=>!isOwnIntel(r)).forEach(r=>{ const k=r.empresa||"Sin empresa"; compCounts[k]=(compCounts[k]||0)+1; });
      const topComp = Object.entries(compCounts).sort((a,b)=>b[1]-a[1])[0];
      setIntel({ total:rows.length, timesQuoted, timesWon, winRate, recommended, instQuoted:instTenders.length, instWon, topComp:topComp?{name:topComp[0],count:topComp[1]}:null });
      setLoading(false);
    })();
    return () => { cancelled=true; };
  }, [keyword, institution]);

  if (!keyword) return (
    <div style={{padding:"40px 0",textAlign:"center",color:"#94a3b8",fontSize:13}}>
      Ingresá la <strong>Línea de producto</strong> en el tab Datos para ver inteligencia comercial.
    </div>
  );
  if (loading) return <div style={{padding:"40px 0",textAlign:"center",color:"#94a3b8",fontSize:13}}>Analizando historial de <strong>{keyword}</strong>…</div>;
  if (!intel||!intel.total) return (
    <div style={{padding:"40px 0",textAlign:"center",color:"#94a3b8",fontSize:13}}>
      Sin historial en comparativas para <strong>{keyword}</strong>. Importá comparativas BAC para construir inteligencia.
    </div>
  );

  const wr = intel.winRate;
  const wrColor = wr===null?"#64748b":wr>=60?"#059669":wr>=35?"#d97706":"#dc2626";
  const wrBg = wr===null?"#f1f5f9":wr>=60?"#dcfce7":wr>=35?"#fef3c7":"#fee2e2";
  const kpis = [
    {label:"Win Rate", val:wr!==null?`${wr}%`:"—", color:wrColor, bg:wrBg},
    {label:"Cotizamos", val:intel.timesQuoted, color:"#334155", bg:"#f1f5f9"},
    {label:"Ganamos", val:intel.timesWon, color:"#059669", bg:"#dcfce7"},
    ...(intel.recommended?[{label:"Precio ganador", val:moneyIntel(intel.recommended), color:"#1d4ed8", bg:"#dbeafe"}]:[]),
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"#f8fafc",borderRadius:9,padding:"10px 14px",border:"1px solid #e2e8f0",fontSize:11.5,color:"#64748b"}}>
        <strong style={{color:"#334155"}}>{keyword}</strong> · {intel.total} referencias en comparativas BAC
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:9,padding:"12px",textAlign:"center"}}>
            <div style={{fontSize:k.val.toString().length>7?13:17,fontWeight:800,color:k.color,background:k.bg,borderRadius:7,padding:"3px 8px",display:"inline-block",marginBottom:4}}>{k.val}</div>
            <div style={{fontSize:10.5,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".4px"}}>{k.label}</div>
          </div>
        ))}
      </div>
      {intel.instQuoted>0&&(
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:9,padding:"12px 14px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0369a1",textTransform:"uppercase",marginBottom:4}}>🏥 {institution}</div>
          <div style={{fontSize:13,color:"#0c4a6e"}}>
            Cotizamos {intel.instQuoted} vez{intel.instQuoted!==1?"es":""} en esta institución.{" "}
            {intel.instWon>0?`Ganamos ${intel.instWon} (${Math.round(intel.instWon/intel.instQuoted*100)}%).`:"Nunca ganamos aquí."}
          </div>
        </div>
      )}
      {intel.topComp&&(
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:9,padding:"12px 14px"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>🔍 Competidor más frecuente</div>
          <div style={{fontSize:13.5,fontWeight:600,color:"#1e293b"}}>{intel.topComp.name} <span style={{fontWeight:400,color:"#64748b"}}>— {intel.topComp.count} aparición{intel.topComp.count!==1?"es":""}</span></div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {wr!==null&&wr<30&&intel.timesQuoted>=3&&(
          <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:12.5,color:"#7f1d1d"}}>
            ⚠️ Win rate bajo ({wr}%). Considerá bajar el precio o revisar la estrategia.
          </div>
        )}
        {wr!==null&&wr>=60&&intel.timesQuoted>=2&&(
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"10px 14px",fontSize:12.5,color:"#14532d"}}>
            ✅ Buen historial ({wr}% win rate). Podés mantener margen habitual.
          </div>
        )}
        {intel.instQuoted>0&&intel.instWon===0&&(
          <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:12.5,color:"#78350f"}}>
            🏥 Nunca ganamos en <strong>{institution}</strong> ({intel.instQuoted} intento{intel.instQuoted!==1?"s":""}). Estrategia agresiva recomendada.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── MODAL LICITACIÓN ─────────────────────────────────────────────── */
function TenderModal({ showForm, form, setForm, editData, activeTab, setActiveTab,
  saving, onClose, onSave, onDelete, onCotizador }) {

  if (!showForm) return null;

  function setF(k, v) {
    const NO_UPPER = [
      "tender_type","validity_status","operational_status","priority",
      "documentation_status","billing_status","delivery_status","portal_link",
      "detection_date","start_date","end_date","next_action_date","purchase_order_date",
      "resultado","motivo_perdida","competitor_winner","notes",
      "documentation_pending_detail","next_action","process_name",
    ];
    setForm(prev => ({...prev, [k]: typeof v==="string" && !NO_UPPER.includes(k) ? v.toUpperCase() : v}));
  }

  return (
    <div className="tn-overlay" onClick={e=>{if(e.target.classList.contains("tn-overlay"))onClose();}}>
      <div className="tn-modal" style={{maxWidth:900}}>
        <div className="tn-modal__header">
          <div>
            <h3>{editData?"Editar licitación":"Nueva licitación"}</h3>
            {editData && <span style={{fontSize:11.5,color:"#94a3b8"}}>{editData.process_number||""} · {editData.institution||""}</span>}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {editData && <span className={`tn-badge tn-badge--${statusBadge(form.operational_status)}`} style={{fontSize:11,padding:"3px 10px"}}>{form.operational_status}</span>}
            {editData && <button type="button" className="tn-btn tn-btn--success tn-btn--sm" onClick={e=>onCotizador(editData,e)}>📊 Crear cotización</button>}
            {editData && <button type="button" className="tn-btn tn-btn--danger tn-btn--sm" onClick={e=>onDelete(editData.id,e)}>🗑 Eliminar</button>}
            <button className="tn-modal__close" onClick={()=>onClose()}>✕</button>
          </div>
        </div>

        <div className="tn-modal-tabs">
          {[
            {key:"datos",         label:"📋 Datos"},
            {key:"inteligencia",  label:"💡 Inteligencia"},
            {key:"resultado",     label:"🏆 Resultado"},
            {key:"competidores",  label:"🔍 Competidores"},
            ...(editData?[
              {key:"comparativa", label:"📊 Comparativa"},
              {key:"historial",   label:"📜 Historial"},
              {key:"adjuntos",    label:"📎 Adjuntos"},
            ]:[]),
          ].map(tab => (
            <button key={tab.key} className={`tn-modal-tab ${activeTab===tab.key?"tn-modal-tab--active":""}`}
              onClick={()=>setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>

        <div className="tn-modal__body">
          <TenderOperationalSummary form={form} />

          {/* TAB DATOS */}
          <div style={{display:activeTab==="datos"?"":"none"}}>
            <div className="tn-form-section">
              <p className="tn-form-section__title">📋 Identificación</p>
              <div className="tn-form-grid">
                <div className="tn-field"><label>Jurisdicción</label><input value={form.jurisdiction} onChange={e=>setF("jurisdiction",e.target.value)} placeholder="EJ: CABA, PBA, CÓRDOBA"/></div>
                <div className="tn-field"><label>Hospital / Institución *</label><input value={form.institution} onChange={e=>setF("institution",e.target.value)} placeholder="NOMBRE DEL HOSPITAL O ENTE"/></div>
                <div className="tn-field"><label>Tipo de proceso</label><select value={form.process_type} onChange={e=>setForm(p=>({...p,process_type:e.target.value}))}><option value="">— Seleccioná —</option><option>Licitación Pública</option><option>Licitación Privada</option><option>Concurso Privado</option><option>Contratación Directa</option><option>Comparativa BAC</option></select></div>
                <div className="tn-field"><label>N° de proceso</label><input value={form.process_number} onChange={e=>setF("process_number",e.target.value)} placeholder="EJ: LP 001/2026"/></div>
                <div className="tn-field"><label>N° de expediente</label><input value={form.expedient_number} onChange={e=>setF("expedient_number",e.target.value)} placeholder="EJ: EX-2026-12345"/></div>
                <div className="tn-field"><label>Tipo</label><select value={form.tender_type} onChange={e=>setForm(p=>({...p,tender_type:e.target.value}))}>{TENDER_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div className="tn-form-grid tn-form-grid--1">
                <div className="tn-field"><label>Nombre / Descripción del proceso</label><input value={form.process_name} onChange={e=>setF("process_name",e.target.value)} placeholder="DESCRIPCIÓN DEL OBJETO DE LA LICITACIÓN"/></div>
              </div>
              <div className="tn-form-grid">
                <div className="tn-field"><label>Sector solicitante</label><input value={form.requesting_sector} onChange={e=>setF("requesting_sector",e.target.value)} placeholder="EJ: QUIRÓFANO, UTI"/></div>
                <div className="tn-field"><label>Línea de producto</label><input value={form.product_line} onChange={e=>setF("product_line",e.target.value)} placeholder="EJ: FILTROS, APHERESIS"/></div>
              </div>
            </div>
            <div className="tn-form-section">
              <p className="tn-form-section__title">📅 Fechas clave</p>
              <div className="tn-form-grid tn-form-grid--3">
                <div className="tn-field"><label>Fecha de detección</label><input type="date" value={form.detection_date} onChange={e=>setF("detection_date",e.target.value)}/><span className="tn-field__hint">Cuándo detectamos la oportunidad</span></div>
                <div className="tn-field"><label>Fecha de vencimiento / apertura</label><input type="date" value={form.end_date} onChange={e=>setF("end_date",e.target.value)}/><span className="tn-field__hint">Vencimiento para presentar oferta</span></div>
                <div className="tn-field"><label>Fecha de inicio estimada</label><input type="date" value={form.start_date} onChange={e=>setF("start_date",e.target.value)}/><span className="tn-field__hint">Si se adjudica, inicio del contrato</span></div>
              </div>
            </div>
            <div className="tn-form-section">
              <p className="tn-form-section__title">⚙️ Estado y seguimiento</p>
              <div className="tn-form-grid tn-form-grid--3">
                <div className="tn-field"><label>Estado operativo</label><select value={form.operational_status} onChange={e=>setForm(p=>({...p,operational_status:e.target.value}))} style={{fontWeight:700}}>{ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                <div className="tn-field"><label>Prioridad</label><select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}>{PRIORIDADES.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
                <div className="tn-field"><label>Responsable interno</label><input value={form.internal_owner} onChange={e=>setF("internal_owner",e.target.value)} placeholder="NOMBRE DEL RESPONSABLE"/></div>
                <div className="tn-field"><label>Próxima acción</label><input value={form.next_action} onChange={e=>setF("next_action",e.target.value)} placeholder="EJ: PREPARAR COTIZACIÓN, PEDIR PLIEGO"/></div>
                <div className="tn-field"><label>Fecha próxima acción</label><input type="date" value={form.next_action_date} onChange={e=>setF("next_action_date",e.target.value)}/></div>
                <div className="tn-field"><label>Estado documentación</label><select value={form.documentation_status} onChange={e=>setForm(p=>({...p,documentation_status:e.target.value}))}>{DOC_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              </div>
            </div>
            <div className="tn-form-section">
              <p className="tn-form-section__title">💰 Económico</p>
              <div className="tn-form-grid tn-form-grid--3">
                <div className="tn-field"><label>Monto estimado / OC ($)</label><input type="number" value={form.purchase_order_amount} onChange={e=>setF("purchase_order_amount",e.target.value)} placeholder="0" min="0"/></div>
                <div className="tn-field"><label>Link / Portal de licitación</label><input value={form.portal_link} onChange={e=>setForm(p=>({...p,portal_link:e.target.value}))} placeholder="https://…"/></div>
                <div className="tn-field"><label>Plazo de contrato</label><input value={form.contract_term} onChange={e=>setF("contract_term",e.target.value)} placeholder="EJ: 12 MESES"/></div>
              </div>
            </div>
            <div className="tn-form-section">
              <p className="tn-form-section__title">🧾 Orden de compra</p>
              <div className="tn-form-grid tn-form-grid--3">
                <div className="tn-field"><label>N° de OC</label><input value={form.purchase_order_number} onChange={e=>setF("purchase_order_number",e.target.value)} placeholder="EJ: OC-2026-001"/></div>
                <div className="tn-field"><label>Fecha de OC</label><input type="date" value={form.purchase_order_date} onChange={e=>setF("purchase_order_date",e.target.value)}/></div>
                <div className="tn-field"><label>Estado facturación</label><select value={form.billing_status} onChange={e=>setForm(p=>({...p,billing_status:e.target.value}))}>{BILL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                <div className="tn-field"><label>Estado entrega</label><select value={form.delivery_status} onChange={e=>setForm(p=>({...p,delivery_status:e.target.value}))}>{DEL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                <div className="tn-field"><label>Póliza de ejecución</label><input value={form.execution_policy} onChange={e=>setF("execution_policy",e.target.value)} placeholder="NRO. O DESCRIPCIÓN"/></div>
                <div className="tn-field"><label>OT Sistema Bridge</label><input value={form.bridge_ot} onChange={e=>setF("bridge_ot",e.target.value)} placeholder="NRO. DE OT"/></div>
              </div>
              <div className="tn-form-grid tn-form-grid--1">
                <div className="tn-field"><label>Detalle documentación pendiente</label><input value={form.documentation_pending_detail} onChange={e=>setF("documentation_pending_detail",e.target.value)} placeholder="QUÉ FALTA, QUÉ ESTÁ INCOMPLETO"/></div>
              </div>
            </div>
            <div className="tn-form-section">
              <p className="tn-form-section__title">📝 Observaciones</p>
              <div className="tn-field"><textarea value={form.notes} onChange={e=>setF("notes",e.target.value)} rows={3} placeholder="NOTAS, HISTORIAL DE SEGUIMIENTO, ESTRATEGIA, COMENTARIOS…"/></div>
            </div>
            {editData && (
              <div className="tn-cotizador-link">
                <span className="tn-cotizador-link__icon">📊</span>
                <div className="tn-cotizador-link__info">
                  <div className="tn-cotizador-link__title">Cotizador MediCross</div>
                  <div className="tn-cotizador-link__sub">{editData.linked_quote_id ? "Esta licitación ya tiene una cotización vinculada" : "Abre el cotizador con los datos de esta licitación pre-cargados"}</div>
                </div>
                <button className="tn-btn tn-btn--success" onClick={e=>onCotizador(editData,e)}>{editData.linked_quote_id ? "Abrir cotización →" : "Crear cotización →"}</button>
              </div>
            )}
          </div>

          {/* TAB INTELIGENCIA */}
          <div style={{display:activeTab==="inteligencia"?"":"none"}}>
            <div className="tn-form-section">
              <p className="tn-form-section__title">💡 Inteligencia Comercial</p>
              <p style={{fontSize:12,color:"#94a3b8",margin:"0 0 14px"}}>
                Análisis automático basado en comparativas BAC importadas para el tipo de producto y la institución de esta licitación.
              </p>
              <TenderIntelligencePanel form={form}/>
            </div>
          </div>

          {/* TAB RESULTADO */}
          <div style={{display:activeTab==="resultado"?"":"none"}}>
            <div className="tn-form-section">
              <p className="tn-form-section__title">🏆 Resultado de la licitación</p>
              <ResultadoBox form={form} setForm={setForm}/>
            </div>
          </div>

          {/* TAB COMPETIDORES */}
          <div style={{display:activeTab==="competidores"?"":"none"}}>
            <div className="tn-form-section">
              <p className="tn-form-section__title">🔍 Competidores registrados</p>
              {editData
                ? <Competitors tenderId={editData.id}/>
                : <div style={{fontSize:12.5,color:"#94a3b8",padding:"16px 0",textAlign:"center"}}>Guardá la licitación primero para agregar competidores.</div>
              }
            </div>
          </div>

          {/* TAB COMPARATIVA */}
          {editData && (
            <div style={{display:activeTab==="comparativa"?"":"none"}}>
              <div className="tn-form-section">
                <p className="tn-form-section__title">📊 Comparativa de precios — apertura de licitación</p>
                <Comparativa tenderId={editData.id} tenderInfo={editData}/>
              </div>
            </div>
          )}

          {/* TAB HISTORIAL */}
          {editData && (
            <div style={{display:activeTab==="historial"?"":"none"}}>
              <div className="tn-form-section">
                <p className="tn-form-section__title">📜 Historial y notas de seguimiento</p>
                <TenderHistory tenderId={editData.id}/>
              </div>
            </div>
          )}

          {/* TAB ADJUNTOS */}
          {editData && (
            <div style={{display:activeTab==="adjuntos"?"":"none"}}>
              <div className="tn-form-section">
                <p className="tn-form-section__title">📎 Archivos adjuntos (pliegos, OC, pólizas…)</p>
                <InlineAttachments tenderId={editData.id}/>
              </div>
            </div>
          )}
        </div>

        <div className="tn-modal__footer">
          <span style={{fontSize:11,color:"#94a3b8"}}>
            {editData?`Actualizado: ${fmtDateTime(editData.updated_at||editData.created_at)}`:"Nueva licitación"}
          </span>
          <div style={{display:"flex",gap:8}}>
            <button className="tn-btn tn-btn--ghost" onClick={()=>onClose()}>Cerrar</button>
            <button className="tn-btn tn-btn--primary" onClick={onSave} disabled={saving}>
              {saving?"Guardando…":editData?"💾 Guardar cambios":"✓ Crear licitación"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────── */
export default function TendersPage({ profile, onNavigate }) {
  const [tenders,      setTenders]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [activeTab,    setActiveTab]    = useState("datos");
  const [editData,     setEditData]     = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [selected,     setSelected]     = useState(new Set());
  const [form,         setForm]         = useState({...EMPTY_FORM});
  const [sortCol,      setSortCol]      = useState("end_date");
  const [sortDir,      setSortDir]      = useState("asc");
  const [colFilters,   setColFilters]   = useState({});
  const [globalQ,      setGlobalQ]      = useState("");
  const [attachCounts, setAttachCounts] = useState({});
  const [alerts,       setAlerts]       = useState([]);
  const [showQuick,    setShowQuick]    = useState(false);
  const [quickForm,    setQuickForm]    = useState({...EMPTY_QUICK_TENDER});
  const [viewMode,     setViewMode]     = useState("all");
  const [bacPreview,   setBacPreview]   = useState(null);
  const [bacSaving,    setBacSaving]    = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tn_dismissed_alerts") || "{}");
      const now = Date.now();
      const valid = new Set(Object.entries(saved).filter(([,exp])=>exp>now).map(([key])=>key));
      return valid;
    } catch { return new Set(); }
  });
  const prevStatusRef = useRef(null);
  const bacFileRef = useRef(null);

  useEffect(() => { loadTenders(); }, []);

  async function loadTenders() {
    setLoading(true);
    const { data, error } = await supabase.from("tenders").select("*").order("created_at",{ascending:false});
    if (error) { console.error(error); setLoading(false); return; }
    const rows = data || [];
    setTenders(rows);
    setLoading(false);
    loadAttachCounts(rows);
    buildAlerts(rows);
  }

  async function loadAttachCounts(rows) {
    const counts = {};
    await Promise.all(rows.map(async t => {
      const { data } = await supabase.storage.from(BUCKET).list(`tender_${t.id}`);
      counts[t.id] = data?.length || 0;
    }));
    setAttachCounts(counts);
  }

  function buildAlerts(rows) {
    const newAlerts = [];
    rows.forEach(t => {
      if (CERRADAS.includes(t.operational_status)) return;
      const days = daysUntil(t.end_date);
      if (days === null) return;
      [1,3].forEach(threshold => {
        if (days<=threshold&&days>=0||(threshold===1&&days<0&&days>=-1)) {
          const key=`${t.id}_${threshold}`;
          const urgent=threshold===1;
          const daysText=days===0?"HOY":days===1?"MAÑANA":`en ${days} días`;
          newAlerts.push({key,urgent,text:`${t.institution||"—"} — ${t.process_name||t.process_number||"—"} — Vencimiento ${daysText} (${fmtDate(t.end_date)})${t.next_action?` · Pendiente: ${t.next_action}`:""}`});
        }
      });
    });
    setAlerts(newAlerts);
  }

  async function logEvent(tenderId, action, description, oldVal, newVal) {
    await supabase.from("tender_logs").insert([{
      tender_id:tenderId, action,
      description:description||null, old_value:oldVal||null, new_value:newVal||null,
      user_name:profile?.full_name||profile?.email||"Usuario",
      created_at:new Date().toISOString(),
    }]);
  }

  const kpis = useMemo(() => {
    const activas    = tenders.filter(t => EN_CURSO.includes(t.operational_status) && !isTenderLost(t));
    const montoTotal = activas.reduce((s,t) => s+Number(t.purchase_order_amount||0), 0);
    const adjMontos  = tenders.filter(isTenderWon).reduce((s,t)=>s+Number(t.monto_adjudicado||t.purchase_order_amount||0),0);
    const proxVencer = activas.filter(t=>{const d=daysUntil(t.end_date);return d!==null&&d>=0&&d<=7;}).length;
    const sinAccion  = activas.filter(t=>!t.next_action).length;
    const pendientesCarga = activas.filter(t => getTenderCompleteness(t).score < 86).length;
    const listasCotizar = activas.filter(t => getTenderCompleteness(t).score >= 86).length;
    const ganadas    = tenders.filter(isTenderWon).length;
    const perdidas   = tenders.filter(isTenderLost).length;
    const cerradasConResultado = tenders.filter(t=>isTenderWon(t)||isTenderLost(t)).length;
    const tasaCierre = cerradasConResultado>0?Math.round(ganadas/cerradasConResultado*100):null;
    return {activas:activas.length,montoTotal,adjMontos,proxVencer,sinAccion,pendientesCarga,listasCotizar,ganadas,perdidas,total:tenders.length,tasaCierre};
  }, [tenders]);

  const tenderInsights = useMemo(() => tenders.map(t => ({ t, readiness:getTenderCompleteness(t) })), [tenders]);
  const pendingRows = useMemo(() => tenderInsights
    .filter(({t,readiness}) => EN_CURSO.includes(t.operational_status) && !isTenderLost(t) && readiness.score < 86)
    .sort((a,b) => a.readiness.score - b.readiness.score)
    .slice(0,4), [tenderInsights]);
  const readyRows = useMemo(() => tenderInsights
    .filter(({t,readiness}) => EN_CURSO.includes(t.operational_status) && !isTenderLost(t) && readiness.score >= 86)
    .sort((a,b) => (daysUntil(a.t.end_date) ?? 999) - (daysUntil(b.t.end_date) ?? 999))
    .slice(0,4), [tenderInsights]);
  const quickDuplicates = useMemo(() => findTenderDuplicates(quickForm, tenders), [quickForm, tenders]);

  const filtered = useMemo(() => {
    let rows = [...tenders];
    if (viewMode === "pending") rows = rows.filter(t => EN_CURSO.includes(t.operational_status) && !isTenderLost(t) && getTenderCompleteness(t).score < 86);
    if (viewMode === "ready") rows = rows.filter(t => EN_CURSO.includes(t.operational_status) && !isTenderLost(t) && getTenderCompleteness(t).score >= 86);
    if (viewMode === "urgent") rows = rows.filter(t => {
      if (CERRADAS.includes(t.operational_status) || isTenderLost(t)) return false;
      const d = daysUntil(t.end_date);
      return d !== null && d >= 0 && d <= 7;
    });
    if (globalQ) { const q=globalQ.toLowerCase(); rows=rows.filter(t=>Object.values(t).some(v=>v&&String(v).toLowerCase().includes(q))); }
    Object.entries(colFilters).forEach(([k,v])=>{if(!v)return;rows=rows.filter(t=>String(t[k]||"").toLowerCase().includes(v.toLowerCase()));});
    rows.sort((a,b)=>{const av=a[sortCol]||"",bv=b[sortCol]||"";return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));});
    return rows;
  }, [tenders,viewMode,globalQ,colFilters,sortCol,sortDir]);

  const setColFilter    = (k,v) => setColFilters(prev=>({...prev,[k]:v}));
  const toggleSort      = (k) => {if(sortCol===k)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(k);setSortDir("asc");}};
  const toggleSelect    = (id) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleSelectAll = () => setSelected(prev=>prev.size===filtered.length?new Set():new Set(filtered.map(t=>t.id)));
  const dismissAlert = (key) => {
    setDismissedAlerts(prev=>{
      const next=new Set([...prev,key]);
      try{const saved=JSON.parse(localStorage.getItem("tn_dismissed_alerts")||"{}");saved[key]=Date.now()+24*60*60*1000;const now=Date.now();Object.keys(saved).forEach(k=>{if(saved[k]<=now)delete saved[k];});localStorage.setItem("tn_dismissed_alerts",JSON.stringify(saved));}catch{ /* localStorage best effort */ }
      return next;
    });
  };

  function openNew() {
    setEditData(null);
    setForm({...EMPTY_FORM,detection_date:today()});
    setActiveTab("datos");
    prevStatusRef.current=null;
    setShowForm(true);
  }

  function openQuick() {
    setQuickForm({
      ...EMPTY_QUICK_TENDER,
      internal_owner: profile?.full_name || profile?.email || "",
    });
    setShowQuick(true);
  }

  async function saveQuickTender(openAfter = false) {
    if (!quickForm.institution?.trim()) { alert("Ingresá el hospital o institución."); return; }
    if (quickDuplicates.length > 0 && !confirm("Hay una licitación parecida ya cargada. ¿Querés guardar esta carga rápida igualmente?")) return;
    setSaving(true);
    const preset = SOURCE_PRESETS.find(p => p.id === quickForm.source) || SOURCE_PRESETS[0];
    const payload = {
      jurisdiction:preset.jurisdiction || null,
      institution:quickForm.institution.trim().toUpperCase(),
      process_type:preset.process_type,
      process_number:quickForm.process_number.trim() || null,
      tender_type:"Original",
      process_name:quickForm.process_name.trim() || null,
      expedient_number:null,
      detection_date:today(),
      end_date:quickForm.end_date || null,
      validity_status:"En análisis",
      operational_status:"En análisis",
      documentation_status:"Pendiente",
      billing_status:"Pendiente",
      delivery_status:"Pendiente",
      priority:suggestPriority(quickForm),
      portal_link:quickForm.portal_link || null,
      internal_owner:quickForm.internal_owner || profile?.full_name || profile?.email || null,
      next_action:"Completar ficha y definir estrategia",
      notes:[preset.notes, quickForm.notes].filter(Boolean).join("\n") || null,
      owner_id:profile?.id || null,
      updated_at:new Date().toISOString(),
    };
    const { data:newRow, error } = await supabase.from("tenders").insert([payload]).select().single();
    setSaving(false);
    if (error) { alert("Error: " + error.message); return; }
    await logEvent(newRow.id, "carga_rapida", `Carga rápida: ${newRow.institution} · ${newRow.process_number || "sin proceso"}`, null, null);
    setShowQuick(false);
    await loadTenders();
    if (openAfter) openEdit(newRow);
  }

  async function handleBacFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseBacComparativaFile(file, isOwnCompany);
      setBacPreview(parsed);
    } catch (err) {
      console.error(err);
      alert("No pude leer el archivo BAC: " + err.message);
    } finally {
      if (bacFileRef.current) bacFileRef.current.value = "";
    }
  }

  async function confirmBacImport() {
    if (!bacPreview) return;
    if (!bacPreview.metadata?.institution?.trim()) {
      alert("Completá la institución antes de importar.");
      return;
    }
    setBacSaving(true);
    try {
      const meta = bacPreview.metadata;
      let tender = null;
      const processNumber = meta.processNumber?.trim() || "";
      if (processNumber) {
        const { data } = await supabase.from("tenders").select("*").eq("process_number", processNumber).limit(1);
        tender = data?.[0] || null;
      }
      if (!tender) {
        tender = tenders.find(row => {
          const sameInstitution = normalizeKey(row.institution) === normalizeKey(meta.institution);
          const sameProcess = processNumber && normalizeKey(row.process_number) === normalizeKey(processNumber);
          const sameName = !processNumber && normalizeKey(row.process_name) === normalizeKey(meta.processName);
          return sameInstitution && (sameProcess || sameName);
        }) || null;
      }
      if (!tender) {
        const { data:newTender, error } = await supabase.from("tenders").insert([{
          jurisdiction:meta.jurisdiction || "CABA",
          institution:meta.institution.trim().toUpperCase(),
          process_type:"Comparativa BAC",
          process_number:processNumber || null,
          tender_type:"Original",
          process_name:meta.processName || `Comparativa BAC ${processNumber || bacPreview.fileName}`,
          expedient_number:meta.expedientNumber || null,
          detection_date:meta.referenceDate || today(),
          end_date:meta.referenceDate || null,
          validity_status:"Finalizada",
          operational_status:"Finalizada",
          documentation_status:"Pendiente",
          billing_status:"Pendiente",
          delivery_status:"Pendiente",
          priority:"Media",
          notes:bacTenderNotes(bacPreview.fileName),
          owner_id:profile?.id || null,
          updated_at:new Date().toISOString(),
        }]).select().single();
        if (error) throw error;
        tender = newTender;
        await logEvent(tender.id, "comparativa_bac", `Referencia BAC importada: ${bacPreview.fileName}`, null, null);
      }

      const { data:existingRows = [], error:rowsError } = await supabase
        .from("tender_comparativas")
        .select("renglon,descripcion,empresa,precio_unitario,cantidad")
        .eq("tender_id", tender.id);
      if (rowsError) throw rowsError;
      const signatures = new Set((existingRows || []).map(comparativaSignature));
      const toInsert = bacPreview.rows
        .filter(row => !signatures.has(comparativaSignature(row)))
        .map(row => ({ ...row, tender_id:tender.id }));

      for (let index = 0; index < toInsert.length; index += 500) {
        const batch = toInsert.slice(index, index + 500);
        const { error } = await supabase.from("tender_comparativas").insert(batch);
        if (error) throw error;
      }
      await logEvent(tender.id, "comparativa_bac", `${toInsert.length} precios BAC agregados desde ${bacPreview.fileName}`, null, null);
      setBacPreview(null);
      await loadTenders();
      alert(`Comparativa importada. ${toInsert.length} referencias nuevas agregadas.`);
    } catch (err) {
      console.error(err);
      alert("Error al importar comparativa BAC: " + err.message);
    } finally {
      setBacSaving(false);
    }
  }

  function openEdit(t, e) {
    e?.stopPropagation();
    setEditData(t);
    setForm({
      jurisdiction:t.jurisdiction||"",institution:t.institution||"",process_type:t.process_type||"",
      process_number:t.process_number||"",tender_type:normalizeSelect(t.tender_type,TENDER_TYPES,"Original"),
      process_name:t.process_name||"",expedient_number:t.expedient_number||"",
      requesting_sector:t.requesting_sector||"",contract_term:t.contract_term||"",
      purchase_order_number:t.purchase_order_number||"",purchase_order_date:t.purchase_order_date||"",
      purchase_order_amount:t.purchase_order_amount!=null?String(t.purchase_order_amount):"",
      detection_date:t.detection_date||"",start_date:t.start_date||"",end_date:t.end_date||"",
      validity_status:normalizeSelect(t.validity_status,ESTADOS,"En análisis"),
      execution_policy:t.execution_policy||"",bridge_ot:t.bridge_ot||"",
      internal_owner:t.internal_owner||"",product_line:t.product_line||"",
      operational_status:normalizeSelect(t.operational_status,ESTADOS,"En análisis"),
      next_action:t.next_action||"",next_action_date:t.next_action_date||"",
      documentation_status:normalizeSelect(t.documentation_status,DOC_ESTADOS,"Pendiente"),
      documentation_pending_detail:t.documentation_pending_detail||"",
      billing_status:normalizeSelect(t.billing_status,BILL_ESTADOS,"Pendiente"),
      delivery_status:normalizeSelect(t.delivery_status,DEL_ESTADOS,"Pendiente"),
      priority:normalizeSelect(t.priority,PRIORIDADES,"Media"),portal_link:t.portal_link||"",
      notes:t.notes||"",resultado:t.resultado||"",
      monto_adjudicado:t.monto_adjudicado!=null?String(t.monto_adjudicado):"",
      motivo_perdida:t.motivo_perdida||"",competitor_winner:t.competitor_winner||"",
    });
    prevStatusRef.current=t.operational_status;
    setActiveTab("datos");
    setShowForm(true);
  }

  async function saveTender() {
    if (!form.institution?.trim()) { alert("Ingresá el hospital o institución."); return; }
    const duplicates = findTenderDuplicates(form, tenders, editData?.id);
    if (duplicates.length > 0 && !confirm("Ya existe una licitación parecida cargada. ¿Querés guardar de todos modos?")) return;
    setSaving(true);
    const operationalStatus = operationalStatusFromResult(form);
    const payload = {
      jurisdiction:form.jurisdiction||null,institution:form.institution||null,
      process_type:form.process_type||null,process_number:form.process_number||null,
      tender_type:form.tender_type||null,process_name:form.process_name||null,
      expedient_number:form.expedient_number||null,requesting_sector:form.requesting_sector||null,
      contract_term:form.contract_term||null,purchase_order_number:form.purchase_order_number||null,
      purchase_order_date:form.purchase_order_date||null,
      purchase_order_amount:form.purchase_order_amount!==""?Number(form.purchase_order_amount):null,
      detection_date:form.detection_date||null,start_date:form.start_date||null,end_date:form.end_date||null,
      validity_status:form.validity_status||null,execution_policy:form.execution_policy||null,
      bridge_ot:form.bridge_ot||null,internal_owner:form.internal_owner||null,
      product_line:form.product_line||null,operational_status:operationalStatus,
      next_action:form.next_action||null,next_action_date:form.next_action_date||null,
      documentation_status:form.documentation_status||"Pendiente",
      documentation_pending_detail:form.documentation_pending_detail||null,
      billing_status:form.billing_status||"Pendiente",delivery_status:form.delivery_status||"Pendiente",
      priority:form.priority||"Media",portal_link:form.portal_link||null,notes:form.notes||null,
      resultado:form.resultado||null,
      monto_adjudicado:form.monto_adjudicado!==""?Number(form.monto_adjudicado):null,
      motivo_perdida:form.motivo_perdida||null,competitor_winner:form.competitor_winner||null,
      owner_id:profile?.id,updated_at:new Date().toISOString(),
    };
    if (editData) {
      const {error}=await supabase.from("tenders").update(payload).eq("id",editData.id);
      if (error){alert("Error: "+error.message);setSaving(false);return;}
      if (prevStatusRef.current&&prevStatusRef.current!==operationalStatus)
        await logEvent(editData.id,"estado","Cambio de estado",prevStatusRef.current,operationalStatus);
    } else {
      const {data:newRow,error}=await supabase.from("tenders").insert([payload]).select().single();
      if (error){alert("Error: "+error.message);setSaving(false);return;}
      await logEvent(newRow.id,"creacion",`Licitación creada: ${form.institution} · ${form.process_number||""}`,null,null);
    }
    setSaving(false);
    setShowForm(false);
    await loadTenders();
  }

  async function deleteTender(id, e) {
    e?.stopPropagation();
    if (!confirm("¿Eliminar esta licitación y todos sus adjuntos?")) return;
    const {data:files}=await supabase.storage.from(BUCKET).list(`tender_${id}`);
    if (files?.length) await supabase.storage.from(BUCKET).remove(files.map(f=>`tender_${id}/${f.name}`));
    await supabase.from("tender_competitors").delete().eq("tender_id",id);
    await supabase.from("tender_logs").delete().eq("tender_id",id);
    await supabase.from("tender_comparativas").delete().eq("tender_id",id);
    await supabase.from("tenders").delete().eq("id",id);
    setTenders(prev=>prev.filter(t=>t.id!==id));
    if (editData?.id===id) setShowForm(false);
  }

  async function exportToExcel() {
    const rows = filtered.filter(t => selected.size === 0 || selected.has(t.id));
    if (!rows.length) { alert("No hay filas para exportar."); return; }

    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");

    const COLS = [
      { h: "Jurisdicción",          k: "jurisdiction",                 w: 16 },
      { h: "Hospital / Inst.",       k: "institution",                  w: 32 },
      { h: "N° Proceso",             k: "process_number",               w: 20 },
      { h: "Nombre Proceso",         k: "process_name",                 w: 48 },
      { h: "Expediente",             k: "expedient_number",             w: 24 },
      { h: "Tipo Proceso",           k: "process_type",                 w: 18 },
      { h: "Tipo",                   k: "tender_type",                  w: 12 },
      { h: "Detección",              k: "detection_date",               w: 14 },
      { h: "Vencimiento",            k: "end_date",                     w: 14 },
      { h: "Estado Operativo",       k: "operational_status",           w: 22 },
      { h: "Prioridad",              k: "priority",                     w: 12 },
      { h: "Monto OC ($)",           k: "purchase_order_amount",        w: 16 },
      { h: "Monto Adjudicado ($)",   k: "monto_adjudicado",             w: 20 },
      { h: "Resultado",              k: "resultado",                    w: 14 },
      { h: "Motivo Pérdida",         k: "motivo_perdida",               w: 28 },
      { h: "Competidor Ganador",     k: "competitor_winner",            w: 24 },
      { h: "Responsable",            k: "internal_owner",               w: 20 },
      { h: "Línea Producto",         k: "product_line",                 w: 20 },
      { h: "Próxima Acción",         k: "next_action",                  w: 36 },
      { h: "Fecha Próx. Acción",     k: "next_action_date",             w: 18 },
      { h: "Documentación",          k: "documentation_status",         w: 18 },
      { h: "Doc. Pendiente",         k: "documentation_pending_detail", w: 32 },
      { h: "Facturación",            k: "billing_status",               w: 16 },
      { h: "Entrega",                k: "delivery_status",              w: 16 },
      { h: "N° OC",                  k: "purchase_order_number",        w: 16 },
      { h: "Fecha OC",               k: "purchase_order_date",          w: 14 },
      { h: "Sector Solicitante",     k: "requesting_sector",            w: 22 },
      { h: "Póliza",                 k: "execution_policy",             w: 14 },
      { h: "OT Bridge",              k: "bridge_ot",                    w: 14 },
      { h: "Plazo",                  k: "contract_term",                w: 12 },
      { h: "Observaciones",          k: "notes",                        w: 40 },
    ];

    const headerRow = COLS.map(c => c.h);
    const dataRows  = rows.map(r =>
      COLS.map(c => {
        const v = r[c.k];
        if (v === null || v === undefined || v === "") return "";
        if (c.k === "purchase_order_amount" || c.k === "monto_adjudicado") return Number(v) || "";
        return String(v).replace(/\n/g, " ").trim();
      })
    );

    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws["!cols"] = COLS.map(c => ({ wch: c.w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Licitaciones");

    const wsInfo = XLSX.utils.aoa_to_sheet([
      ["Exportación de Licitaciones — MediCross CRM"],
      [],
      ["Fecha", new Date().toLocaleDateString("es-AR")],
      ["Filas exportadas", rows.length],
      ["Filtro activo", hasFilters ? "Sí" : "No"],
      ["Selección", selected.size > 0 ? `${selected.size} seleccionadas` : "Todas las visibles"],
    ]);
    wsInfo["!cols"] = [{ wch: 28 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, "Info");

    XLSX.writeFile(wb, `licitaciones_${today()}.xlsx`);
  }
  async function abrirCotizador(t, e) {
    e?.stopPropagation();
    const src=t||{id:editData?.id,institution:form.institution,process_number:form.process_number,detection_date:form.detection_date,end_date:form.end_date,internal_owner:form.internal_owner};
    if (src?.id) await logEvent(src.id,"cotizador","Cotización iniciada desde Licitaciones",null,null);
    onNavigate("cotizador",{tenderId:src.id||null,quoteId:src.linked_quote_id||null,institucion:src.institution||"",nroLicit:src.process_number||"",fechaApert:src.detection_date||src.end_date||"",vendedor:src.internal_owner||""});
    setShowForm(false);
  }

  function renderCell(col, t) {
    const days=daysUntil(t.end_date);
    const color=progColor(days);
    switch(col.key){
      case "_check":
        return <input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleSelect(t.id)} onClick={e=>e.stopPropagation()} style={{cursor:"pointer",width:14,height:14,accentColor:"#0f2444"}}/>;
      case "_alert": {
        const venc  = dotColor(days);
        const acct  = actionDotColor(t);
        // Prioridad: vencimiento manda si es urgente
        const level = (venc==="red"||acct==="red") ? "red"
                    : (venc==="orange"||acct==="orange") ? "orange"
                    : (venc==="yellow"||acct==="yellow") ? "yellow"
                    : (venc==="green"&&acct==="green") ? "green" : "gray";
        const icon  = level==="red" ? "🔴" : level==="orange" ? "🟠" : level==="yellow" ? "🟡" : level==="green" ? "🟢" : "⚪";
        const tip   = `Vencimiento: ${fmtDate(t.end_date)} · Acción: ${t.next_action||"Sin definir"}`;
        return <div style={{display:"flex",justifyContent:"center"}}><span className={`tn-alert-indicator tn-alert-indicator--${level}`} title={tip}>{icon}</span></div>;
      }
      case "_progress":{
        const pct=calcProgress(t);
        const isClosed=CERRADAS.includes(t.operational_status);
        if (!t.end_date) return <span style={{color:"#94a3b8",fontSize:11}}>Sin fecha</span>;
        if (isClosed||pct===null) return <span style={{color:"#94a3b8",fontSize:11}}>—</span>;
        return <div className="tn-prog"><div className="tn-prog__labels"><span className="tn-prog__days" style={{color}}>{days===null?"—":days<0?`Vencida ${Math.abs(days)}d`:days===0?"HOY":days===1?"MAÑANA":`${days}d`}</span><span className="tn-prog__pct">{pct}%</span></div><div className="tn-prog__bar"><div className="tn-prog__fill" style={{width:`${pct}%`,background:color}}/></div></div>;
      }
      case "_attachments":{
        const cnt=attachCounts[t.id]||0;
        return <span className="tn-attach-btn" onClick={e=>{e.stopPropagation();openEdit(t,e);}}>📎{cnt>0&&<span className="tn-attach-count">{cnt}</span>}</span>;
      }
      case "_actions":
        return <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}><button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={e=>openEdit(t,e)} title="Editar">✎</button><button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={e=>abrirCotizador(t,e)} title="Crear cotización">📊</button><button className="tn-btn tn-btn--danger tn-btn--sm" onClick={e=>deleteTender(t.id,e)} title="Eliminar">✕</button></div>;
      case "operational_status":
        return <span className={`tn-badge tn-badge--${statusBadge(t.operational_status)}`} style={{fontSize:10.5,padding:"2px 8px",whiteSpace:"nowrap"}}>{t.operational_status||"—"}</span>;
      case "priority":
        return <span className={`tn-prio tn-prio--${pClass(t.priority)}`}>{pIcon(t.priority)} {t.priority||"—"}</span>;
      case "purchase_order_amount":
        return <span style={{fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>{compactMoney(t.purchase_order_amount)}</span>;
      case "monto_adjudicado":
        return t.monto_adjudicado?<span style={{fontWeight:700,fontSize:12,whiteSpace:"nowrap",color:"#166534"}}>{compactMoney(t.monto_adjudicado)}</span>:<span style={{color:"#94a3b8",fontSize:11}}>—</span>;
      case "end_date":{
        const clr=days!==null&&days<0?"#ef4444":days!==null&&days<=3?"#f97316":days!==null&&days<=7?"#d97706":"#334155";
        return <div><div style={{fontWeight:600,fontSize:12.5,color:clr,whiteSpace:"nowrap"}}>{fmtDate(t.end_date)}</div>{days!==null&&<div style={{fontSize:10.5,color:clr}}>{days<0?`Vencida ${Math.abs(days)}d`:days===0?"HOY":days===1?"MAÑANA":`${days}d restantes`}</div>}</div>;
      }
      case "start_date": case "purchase_order_date": case "detection_date":
        return <span style={{fontSize:11.5,color:"#64748b",whiteSpace:"nowrap"}}>{fmtDate(t[col.key])}</span>;
      case "next_action_date":{
        const ac=actionDotColor(t);
        const clr=ac==="red"?"#ef4444":ac==="yellow"?"#d97706":"#334155";
        return <span style={{fontSize:11.5,color:clr,whiteSpace:"nowrap"}}>{fmtDate(t.next_action_date)}</span>;
      }
      case "documentation_status":{
        const bc=t.documentation_status==="Completa"?"green":t.documentation_status==="Incompleta"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 6px"}}>{t.documentation_status||"—"}</span>;
      }
      case "billing_status":{
        const bc=t.billing_status==="Cobrada"?"green":t.billing_status==="Facturada"?"blue":t.billing_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 6px"}}>{t.billing_status||"—"}</span>;
      }
      case "delivery_status":{
        const bc=t.delivery_status==="Completa"?"green":t.delivery_status==="Parcial"?"yellow":"red";
        return <span className={`tn-badge tn-badge--${bc}`} style={{fontSize:10.5,padding:"2px 6px"}}>{t.delivery_status||"—"}</span>;
      }
      case "notes":
        return <span style={{fontSize:11,color:"#64748b",display:"block",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.notes||""}>{t.notes||"—"}</span>;
      default:
        return <span style={{fontSize:12,whiteSpace:"nowrap"}}>{t[col.key]||"—"}</span>;
    }
  }

  const hasFilters    = globalQ || Object.values(colFilters).some(Boolean);
  const visibleAlerts = alerts.filter(a => !dismissedAlerts.has(a.key));

  function MobileTenderCard({ tender }) {
    const days = daysUntil(tender.end_date);
    const color = progColor(days);
    const status = tender.operational_status || "—";
    const nextAction = tender.next_action || "Sin próxima acción";
    const urgency = days === null ? "Sin vencimiento"
      : days < 0 ? `Vencida ${Math.abs(days)}d`
      : days === 0 ? "Vence hoy"
      : days === 1 ? "Vence mañana"
      : `${days}d restantes`;

    return (
      <article className="tn-mobile-card" onClick={() => openEdit(tender)}>
        <div className="tn-mobile-card__top">
          <span className={`tn-alert-indicator tn-alert-indicator--${dotColor(days)}`}>●</span>
          <div className="tn-mobile-card__title">
            <strong>{tender.institution || "Sin institución"}</strong>
            <span>{tender.process_number || "Sin proceso"}{tender.jurisdiction ? ` · ${tender.jurisdiction}` : ""}</span>
          </div>
          <span className={`tn-prio tn-prio--${pClass(tender.priority)}`}>{pIcon(tender.priority)} {tender.priority || "—"}</span>
        </div>

        <p className="tn-mobile-card__process">{tender.process_name || "Sin nombre de proceso"}</p>

        <div className="tn-mobile-card__meta">
          <span style={{ color }}>{urgency}</span>
          <span>{compactMoney(tender.purchase_order_amount)} potencial</span>
          <span>{tender.internal_owner || "Sin responsable"}</span>
        </div>

        <div className="tn-mobile-card__footer">
          <span className={`tn-badge tn-badge--${statusBadge(status)}`}>{status}</span>
          <span className="tn-mobile-card__next">{nextAction}</span>
        </div>

        <div className="tn-mobile-card__actions" onClick={(e) => e.stopPropagation()}>
          <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={(e) => openEdit(tender, e)}>Editar</button>
          <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={(e) => abrirCotizador(tender, e)}>Cotizar</button>
        </div>
      </article>
    );
  }

  return (
    <Layout title="Cotizaciones" profile={profile} onNavigate={onNavigate}>
      <div className="tn-page">

        {visibleAlerts.length > 0 && (
          <div className="tn-alerts">
            {visibleAlerts.map(a => (
              <div key={a.key} className={`tn-alert ${a.urgent?"tn-alert--urgent":"tn-alert--warn"}`}>
                <span className="tn-alert__icon">{a.urgent?"🔴":"🟡"}</span>
                <span className="tn-alert__text">{a.text}</span>
                <button className="tn-alert__dismiss" onClick={() => dismissAlert(a.key)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="tn-header">
          <div className="tn-header__title">
            <h2>Pipeline de Licitaciones</h2>
            <p>{kpis.activas} en seguimiento · {filtered.length} visible{filtered.length!==1?"s":""}{hasFilters?" (filtrado)":""}</p>
          </div>
          <div className="tn-header__actions">
            <input ref={bacFileRef} type="file" accept=".xlsx,.xls" className="tn-hidden-input" onChange={handleBacFile}/>
            {hasFilters && <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={()=>{setGlobalQ("");setColFilters({});}}>✕ Limpiar</button>}
            {selected.size > 0 && <span style={{fontSize:12,fontWeight:700,color:"#0f2444"}}>{selected.size} selec.</span>}
            <button className="tn-btn tn-btn--export" onClick={exportToExcel} title={selected.size>0?`Exportar ${selected.size} seleccionadas`:`Exportar ${filtered.length} licitaciones`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {selected.size > 0 ? `Excel (${selected.size})` : "Excel"}
            </button>
            <button className="tn-btn tn-btn--refresh" onClick={loadTenders} title="Actualizar">↻</button>
            <button className="tn-btn tn-btn--ghost tn-btn--inteligencia" onClick={() => onNavigate("preciosHistoricos")}>
              💡 Inteligencia Comercial
            </button>
            <button className="tn-btn tn-btn--ghost" onClick={() => bacFileRef.current?.click()}>⬆ Subir comparativa BAC</button>
            <button className="tn-btn tn-btn--ghost" onClick={openQuick}>⚡ Carga rápida</button>
            <button className="tn-btn tn-btn--primary" onClick={openNew}>+ Formulario completo</button>
          </div>
        </div>

        <div className="tn-workbench">
          <div className="tn-workbench-card tn-workbench-card--primary">
            <span className="tn-workbench-eyebrow">Mesa de licitaciones</span>
            <h3>Cargar menos, decidir antes</h3>
            <p>Registrá procesos en borrador, completá sólo los campos críticos y usá comparativas BAC como base de inteligencia.</p>
            <div className="tn-workbench-actions">
              <button className="tn-btn tn-btn--primary" onClick={openQuick}>⚡ Carga rápida</button>
              <button className="tn-btn" onClick={() => bacFileRef.current?.click()}>⬆ Importar BAC</button>
            </div>
          </div>

          <div className="tn-workbench-card">
            <div className="tn-workbench-head"><span>Para completar</span><strong>{kpis.pendientesCarga}</strong></div>
            <div className="tn-workbench-list">
              {pendingRows.length ? pendingRows.map(({t,readiness}) => (
                <button key={t.id} className="tn-workbench-item" onClick={() => openEdit(t)}>
                  <span>
                    <strong>{t.institution || "Sin institución"}</strong>
                    <em>{tenderDisplayTitle(t)}</em>
                  </span>
                  <b>{readiness.score}%</b>
                </button>
              )) : <p className="tn-workbench-empty">Sin pendientes críticos.</p>}
            </div>
          </div>

          <div className="tn-workbench-card">
            <div className="tn-workbench-head"><span>Listas para cotizar</span><strong>{kpis.listasCotizar}</strong></div>
            <div className="tn-workbench-list">
              {readyRows.length ? readyRows.map(({t}) => (
                <button key={t.id} className="tn-workbench-item" onClick={() => openEdit(t)}>
                  <span>
                    <strong>{t.institution || "Sin institución"}</strong>
                    <em>{tenderDisplayTitle(t)}</em>
                  </span>
                  <b>{daysUntil(t.end_date) ?? "—"}d</b>
                </button>
              )) : <p className="tn-workbench-empty">Todavía no hay fichas listas.</p>}
            </div>
          </div>
        </div>

        <div className="tn-kpis">
          <div className="tn-kpi tn-kpi--blue">
            <span className="tn-kpi__icon">📋</span>
            <span className="tn-kpi__label">En seguimiento</span>
            <span className="tn-kpi__val">{kpis.activas}</span>
            <span className="tn-kpi__sub">{compactMoney(kpis.montoTotal)} potencial</span>
          </div>
          <div className={`tn-kpi ${kpis.pendientesCarga>0?"tn-kpi--warn":"tn-kpi--gray"}`}>
            <span className="tn-kpi__icon">🧩</span>
            <span className="tn-kpi__label">Para completar</span>
            <span className="tn-kpi__val">{kpis.pendientesCarga}</span>
            <span className="tn-kpi__sub">requieren datos clave</span>
          </div>
          <div className={`tn-kpi ${kpis.proxVencer>0?"tn-kpi--danger":"tn-kpi--gray"}`}>
            <span className="tn-kpi__icon">⏰</span>
            <span className="tn-kpi__label">Vencen en ≤7 días</span>
            <span className="tn-kpi__val">{kpis.proxVencer}</span>
            <span className="tn-kpi__sub">atención urgente</span>
          </div>
          <div className="tn-kpi tn-kpi--green">
            <span className="tn-kpi__icon">✅</span>
            <span className="tn-kpi__label">Listas para cotizar</span>
            <span className="tn-kpi__val">{kpis.listasCotizar}</span>
            <span className="tn-kpi__sub">fichas completas</span>
          </div>
          <div className="tn-kpi tn-kpi--gray">
            <span className="tn-kpi__icon">📊</span>
            <span className="tn-kpi__label">Total registradas</span>
            <span className="tn-kpi__val">{kpis.total}</span>
            <span className="tn-kpi__sub">{kpis.perdidas} perdidas</span>
          </div>
        </div>

        <div className="tn-view-tabs">
          {[
            ["all", "Todas"],
            ["pending", `Para completar (${kpis.pendientesCarga})`],
            ["ready", `Listas (${kpis.listasCotizar})`],
            ["urgent", `Urgentes (${kpis.proxVencer})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`tn-view-tab ${viewMode === key ? "tn-view-tab--active" : ""}`}
              onClick={() => setViewMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tn-search-bar">
          <input className="tn-search-input" placeholder="🔍  Buscar hospital, proceso, expediente, sector, responsable…" value={globalQ} onChange={e=>setGlobalQ(e.target.value)}/>
          <span className="tn-search-count">{filtered.length} resultado{filtered.length!==1?"s":""}</span>
        </div>

        <div className="tn-mobile-list">
          {loading ? (
            <div className="tn-empty"><div className="tn-empty__icon">⏳</div><h3>Cargando…</h3></div>
          ) : filtered.length === 0 ? (
            <div className="tn-empty"><div className="tn-empty__icon">⌕</div><h3>{tenders.length===0?"Sin licitaciones.":"Sin resultados con los filtros aplicados."}</h3></div>
          ) : filtered.map(t => <MobileTenderCard key={t.id} tender={t}/>)}
        </div>

        <div className="tn-grid-wrap">
          {loading?(
            <div className="tn-empty"><div className="tn-empty__icon">⏳</div><h3>Cargando…</h3></div>
          ):(
            <div className="tn-grid-scroll">
              <table className="tn-grid">
                <thead>
                  <tr className="tn-grid__head-row">
                    {COLS.map(col=>(
                      <th key={col.key} className="tn-grid__th" style={{minWidth:col.w,maxWidth:col.w,width:col.w}}
                        onClick={()=>{if(col.key==="_check")toggleSelectAll();else if(col.key[0]!=="_")toggleSort(col.key);}}>
                        {col.key==="_check"
                          ?<input type="checkbox" checked={filtered.length>0&&selected.size===filtered.length} onChange={toggleSelectAll} style={{cursor:"pointer",width:14,height:14,accentColor:"#93c5fd"}}/>
                          :<span className="tn-grid__th-label">{col.label}{sortCol===col.key&&<span style={{marginLeft:3,opacity:.6}}>{sortDir==="asc"?"↑":"↓"}</span>}</span>
                        }
                      </th>
                    ))}
                  </tr>
                  <tr className="tn-grid__filter-row">
                    {COLS.map(col=>(
                      <th key={col.key} className="tn-grid__filter-cell" style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>
                        {col.key[0]!=="_"&&<input className="tn-grid__filter-input" placeholder="Filtrar…" value={colFilters[col.key]||""} onChange={e=>setColFilter(col.key,e.target.value)}/>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0
                    ?<tr><td colSpan={COLS.length} className="tn-grid__empty">{tenders.length===0?"Sin licitaciones. Creá la primera con + Nueva licitación.":"Sin resultados con los filtros aplicados."}</td></tr>
                    :filtered.map((t,idx)=>(
                      <tr key={t.id} className={`tn-grid__row ${idx%2===0?"":"tn-grid__row--alt"}`} onClick={()=>openEdit(t)}>
                        {COLS.map(col=>(
                          <td key={col.key} className="tn-grid__td" style={{minWidth:col.w,maxWidth:col.w,width:col.w}}>{renderCell(col,t)}</td>
                        ))}
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <TenderModal
        showForm={showForm} form={form} setForm={setForm} editData={editData}
        activeTab={activeTab} setActiveTab={setActiveTab} saving={saving}
        onClose={() => setShowForm(false)} onSave={saveTender}
        onDelete={deleteTender} onCotizador={abrirCotizador}
      />
      <QuickTenderModal
        show={showQuick}
        value={quickForm}
        setValue={setQuickForm}
        duplicates={quickDuplicates}
        saving={saving}
        onClose={() => setShowQuick(false)}
        onSave={saveQuickTender}
      />
      <BacImportModal
        preview={bacPreview}
        setPreview={setBacPreview}
        saving={bacSaving}
        onClose={() => setBacPreview(null)}
        onConfirm={confirmBacImport}
      />
    </Layout>
  );
}
