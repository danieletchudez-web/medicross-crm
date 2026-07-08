import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Calendar, CheckSquare,
  ChevronRight, Clock, DollarSign, Edit3, FileText,
  Loader2, Package, Plus, Save, Stethoscope, Trash2,
  Truck, X, Activity, Check, MessageSquare, Upload,
  User, MapPin, ClipboardList, BarChart2,
} from "lucide-react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import { PIPELINE_STAGES, PRIORITY_CONFIG, CHECKLIST_ITEMS, stageFor } from "./FarapulsePage";
import "./farapulseDetail.css";

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("es-AR", {
    day: "numeric", month: "long", year: "numeric",
  });
}
function fmtTime(t) {
  if (!t) return "—";
  return t.slice(0, 5);
}
function fmtTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("es-AR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function money(v) {
  if (!v) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(v));
}

const PRODUCT_STATUSES = ["disponible","reservado","entregado","devuelto","consumido"];
const PRODUCT_STATUS_LABEL = {
  disponible: "Disponible", reservado: "Reservado", entregado: "Entregado",
  devuelto:   "Devuelto",   consumido: "Consumido",
};
const PRODUCT_STATUS_COLOR = {
  disponible: "#64748b", reservado: "#3b82f6", entregado: "#22c55e",
  devuelto:   "#f59e0b", consumido: "#6d28d9",
};

const DOC_TYPES = [
  "cotizacion","oc","remito","factura","constancia_entrega",
  "certificado","foto","pdf","excel","email","whatsapp","otro",
];
const DOC_TYPE_LABEL = {
  cotizacion: "Cotización", oc: "Orden de compra", remito: "Remito",
  factura: "Factura", constancia_entrega: "Constancia de entrega",
  certificado: "Certificado", foto: "Foto", pdf: "PDF",
  excel: "Excel", email: "Email", whatsapp: "WhatsApp", otro: "Otro",
};

const TABS = [
  { key: "ficha",     label: "Ficha",         icon: User },
  { key: "comercial", label: "Comercial",      icon: DollarSign },
  { key: "productos", label: "Productos",      icon: Package },
  { key: "checklist", label: "Checklist",      icon: CheckSquare },
  { key: "logistica", label: "Logística",      icon: Truck },
  { key: "documentos",label: "Documentos",     icon: FileText },
  { key: "timeline",  label: "Actividad",      icon: Activity },
];

const EMPTY_PRODUCT = {
  code: "", description: "", quantity: 1, lot_number: "",
  serial_number: "", expiry_date: "", status: "disponible",
};

// ─── Component ────────────────────────────────────────────────
export default function FarapulseDetailPage({ profile, onNavigate, navigationData }) {
  const procedureId = navigationData?.procedureId;

  const [proc,      setProc]      = useState(null);
  const [products,  setProducts]  = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [timeline,  setTimeline]  = useState([]);
  const [documents, setDocuments] = useState([]);
  const [sellers,   setSellers]   = useState([]);
  const [accounts,  setAccounts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState("ficha");
  const [saving,    setSaving]    = useState(false);

  // Edit states
  const [editingFicha,    setEditingFicha]    = useState(false);
  const [editingComercial,setEditingComercial]= useState(false);
  const [editingLogistica,setEditingLogistica]= useState(false);
  const [fichaForm,       setFichaForm]       = useState({});
  const [comercialForm,   setComercialForm]   = useState({});
  const [logisticaForm,   setLogisticaForm]   = useState({});

  // Products modal
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm,     setProductForm]     = useState(EMPTY_PRODUCT);

  // Note modal
  const [showNote,   setShowNote]   = useState(false);
  const [noteText,   setNoteText]   = useState("");

  // Document form
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm,     setDocForm]     = useState({ doc_type: "otro", name: "", url: "" });

  // Status advance confirmation
  const [confirmStatus, setConfirmStatus] = useState(null);

  useEffect(() => {
    if (!procedureId) return;
    loadAll();
  }, [procedureId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [procRes, prodRes, checkRes, tlRes, docRes, selRes, accRes] = await Promise.all([
        supabase.from("farapulse_procedures").select("*, accounts(name)").eq("id", procedureId).single(),
        supabase.from("farapulse_procedure_products").select("*").eq("procedure_id", procedureId).order("created_at"),
        supabase.from("farapulse_procedure_checklist").select("*").eq("procedure_id", procedureId).order("item_key"),
        supabase.from("farapulse_procedure_timeline").select("*").eq("procedure_id", procedureId).order("created_at", { ascending: false }),
        supabase.from("farapulse_procedure_documents").select("*").eq("procedure_id", procedureId).order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
        supabase.from("accounts").select("id, name").order("name"),
      ]);
      setProc(procRes.data);
      setFichaForm(procRes.data    || {});
      setComercialForm(procRes.data || {});
      setLogisticaForm(procRes.data || {});
      setProducts(prodRes.data   || []);
      setChecklist(checkRes.data || []);
      setTimeline(tlRes.data     || []);
      setDocuments(docRes.data   || []);
      setSellers(selRes.data     || []);
      setAccounts(accRes.data    || []);
    } finally {
      setLoading(false);
    }
  }

  // ── Status advance ──────────────────────────────────────────
  async function advanceStatus(newStatus) {
    setSaving(true);
    try {
      const stage = stageFor(newStatus);
      await supabase
        .from("farapulse_procedures")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", procedureId);
      await logTimeline("status_change", `Estado actualizado → ${stage.label}`);
      await loadAll();
    } finally {
      setSaving(false);
      setConfirmStatus(null);
    }
  }

  // ── Timeline log ────────────────────────────────────────────
  async function logTimeline(action, description, metadata = null) {
    await supabase.from("farapulse_procedure_timeline").insert([{
      procedure_id: procedureId,
      action,
      description,
      user_id:   profile.id,
      user_name: profile.full_name,
      metadata,
    }]);
  }

  // ── Save ficha ──────────────────────────────────────────────
  async function saveFicha() {
    setSaving(true);
    const fields = [
      "institution","account_id","doctor_name","electrophysiologist",
      "buyer_name","patient_name","social_security","oc_number",
      "quote_number","surgery_number","surgery_date","surgery_time",
      "operating_room","city","province","seller_id","priority","notes",
    ];
    const payload = {};
    fields.forEach(f => { payload[f] = fichaForm[f] ?? null; });
    payload.updated_at = new Date().toISOString();
    await supabase.from("farapulse_procedures").update(payload).eq("id", procedureId);
    await logTimeline("edit", "Ficha principal actualizada");
    setEditingFicha(false);
    await loadAll();
    setSaving(false);
  }

  // ── Save comercial ──────────────────────────────────────────
  async function saveComercial() {
    setSaving(true);
    const fields = [
      "approved_price","final_price","discount_pct","margin_pct",
      "commercial_status","competitor","probability","commercial_deadline","commercial_notes",
    ];
    const payload = {};
    fields.forEach(f => { payload[f] = comercialForm[f] ?? null; });
    payload.updated_at = new Date().toISOString();
    await supabase.from("farapulse_procedures").update(payload).eq("id", procedureId);
    await logTimeline("edit", "Sección comercial actualizada");
    setEditingComercial(false);
    await loadAll();
    setSaving(false);
  }

  // ── Save logistica ──────────────────────────────────────────
  async function saveLogistica() {
    setSaving(true);
    const fields = [
      "departure_date","departure_time","carrier","vehicle_plate",
      "logistics_responsible","tracking_number","destination",
      "estimated_delivery","actual_delivery","received_by","logistics_notes",
    ];
    const payload = {};
    fields.forEach(f => { payload[f] = logisticaForm[f] ?? null; });
    payload.updated_at = new Date().toISOString();
    await supabase.from("farapulse_procedures").update(payload).eq("id", procedureId);
    await logTimeline("edit", "Sección logística actualizada");
    setEditingLogistica(false);
    await loadAll();
    setSaving(false);
  }

  // ── Checklist toggle ────────────────────────────────────────
  async function toggleChecklist(item) {
    const next = !item.is_checked;
    await supabase
      .from("farapulse_procedure_checklist")
      .update({ is_checked: next, checked_at: next ? new Date().toISOString() : null, checked_by: next ? profile.id : null })
      .eq("id", item.id);
    await logTimeline("checklist", `${next ? "✅" : "☐"} ${item.label}`);
    await loadAll();
  }

  // ── Products ────────────────────────────────────────────────
  async function saveProduct() {
    setSaving(true);
    if (productForm.id) {
      const { id, ...rest } = productForm;
      await supabase.from("farapulse_procedure_products").update(rest).eq("id", id);
    } else {
      await supabase.from("farapulse_procedure_products").insert([{
        ...productForm, procedure_id: procedureId,
      }]);
    }
    await logTimeline("product", `Material ${productForm.id ? "actualizado" : "agregado"}: ${productForm.description}`);
    setShowProductForm(false);
    setProductForm(EMPTY_PRODUCT);
    await loadAll();
    setSaving(false);
  }

  async function deleteProduct(id, desc) {
    if (!window.confirm(`Eliminar "${desc}"?`)) return;
    await supabase.from("farapulse_procedure_products").delete().eq("id", id);
    await logTimeline("product", `Material eliminado: ${desc}`);
    await loadAll();
  }

  // ── Notes ───────────────────────────────────────────────────
  async function saveNote() {
    if (!noteText.trim()) return;
    await logTimeline("note", noteText.trim());
    setNoteText("");
    setShowNote(false);
    await loadAll();
  }

  // ── Documents ───────────────────────────────────────────────
  async function saveDocument() {
    if (!docForm.name) return;
    await supabase.from("farapulse_procedure_documents").insert([{
      ...docForm, procedure_id: procedureId, uploaded_by: profile.id,
    }]);
    await logTimeline("document", `Documento adjuntado: ${docForm.name}`);
    setShowDocForm(false);
    setDocForm({ doc_type: "otro", name: "", url: "" });
    await loadAll();
  }

  async function deleteDocument(id, name) {
    if (!window.confirm(`Eliminar "${name}"?`)) return;
    await supabase.from("farapulse_procedure_documents").delete().eq("id", id);
    await loadAll();
  }

  // ── Getters ─────────────────────────────────────────────────
  if (!procedureId) {
    return (
      <Layout title="Procedimiento" profile={profile} onNavigate={onNavigate}>
        <div className="fpd-empty-state">
          <p>Seleccioná un procedimiento desde la lista.</p>
          <button className="fp-btn-primary" onClick={() => onNavigate("farapulse")}>
            <ArrowLeft size={14} /> Ir a la lista
          </button>
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Cargando…" profile={profile} onNavigate={onNavigate}>
        <div className="fpd-loading">
          <Loader2 size={22} className="fpd-loading__icon" />
          Cargando expediente…
        </div>
      </Layout>
    );
  }

  if (!proc) {
    return (
      <Layout title="Error" profile={profile} onNavigate={onNavigate}>
        <div className="fpd-empty-state">
          <AlertTriangle size={32} />
          <p>No se encontró el procedimiento.</p>
        </div>
      </Layout>
    );
  }

  const stage   = stageFor(proc.status);
  const prio    = PRIORITY_CONFIG[proc.priority] || PRIORITY_CONFIG.media;
  const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === proc.status);
  const nextStage = stageIdx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[stageIdx + 1] : null;
  const checkedCount   = checklist.filter(c => c.is_checked).length;
  const requiredCount  = checklist.filter(c => c.is_required).length;
  const requiredDone   = checklist.filter(c => c.is_required && c.is_checked).length;

  const sf = k => v => setFichaForm    (prev => ({ ...prev, [k]: v }));
  const sc = k => v => setComercialForm(prev => ({ ...prev, [k]: v }));
  const sl = k => v => setLogisticaForm(prev => ({ ...prev, [k]: v }));
  const sp = k => v => setProductForm  (prev => ({ ...prev, [k]: v }));

  // ─── Render ─────────────────────────────────────────────────
  return (
    <Layout title={proc.internal_code || "Procedimiento"} profile={profile} onNavigate={onNavigate}>
      <div className="fpd-page">

        {/* ── Page header ──────────────────────────────────── */}
        <div className="fpd-page-hd">
          <button className="fpd-back" onClick={() => onNavigate("farapulse")}>
            <ArrowLeft size={15} /> Procedimientos
          </button>
          <div className="fpd-page-hd__info">
            <span className="fpd-page-hd__code">{proc.internal_code}</span>
            <h2>{proc.institution || proc.accounts?.name || "Sin institución"}</h2>
            {proc.doctor_name && <span className="fpd-page-hd__doctor">{proc.doctor_name}</span>}
          </div>
          <div className="fpd-page-hd__badges">
            <span className="fpd-badge" style={{ "--b": stage.color }}>{stage.label}</span>
            <span className="fpd-prio" style={{ "--p": prio.color }}>{prio.label}</span>
            {proc.surgery_date && (
              <span className="fpd-surgery-date">
                <Calendar size={13} /> {fmtDate(proc.surgery_date)}
                {proc.surgery_time && <> · {fmtTime(proc.surgery_time)}</>}
              </span>
            )}
          </div>
        </div>

        {/* ── Body: pipeline + content ─────────────────────── */}
        <div className="fpd-body">

          {/* ── Left: Pipeline stepper ─────────────────────── */}
          <aside className="fpd-pipeline">
            <div className="fpd-pipeline__title">Pipeline</div>
            <ol className="fpd-steps">
              {PIPELINE_STAGES.map((s, i) => {
                const done    = i < stageIdx;
                const current = i === stageIdx;
                const future  = i > stageIdx;
                return (
                  <li
                    key={s.key}
                    className={`fpd-step${done ? " fpd-step--done" : ""}${current ? " fpd-step--current" : ""}${future ? " fpd-step--future" : ""}`}
                    onClick={() => !saving && i !== stageIdx && setConfirmStatus(s)}
                  >
                    <span className="fpd-step__dot" style={current ? { "--sc": s.color } : {}}>
                      {done ? <Check size={10} /> : <span>{s.step}</span>}
                    </span>
                    <span className="fpd-step__label">{s.label}</span>
                  </li>
                );
              })}
            </ol>

            {nextStage && (
              <button
                className="fpd-advance-btn"
                disabled={saving}
                onClick={() => setConfirmStatus(nextStage)}
              >
                {saving ? <Loader2 size={13} className="spin" /> : <ChevronRight size={13} />}
                Avanzar a {nextStage.label}
              </button>
            )}

            <div className="fpd-pipeline__meta">
              <div><span>OC</span><strong>{proc.oc_number || "—"}</strong></div>
              <div><span>Cirugía</span><strong>{proc.surgery_number || "—"}</strong></div>
              <div><span>Checklist</span>
                <strong className={requiredDone < requiredCount ? "fpd-warn" : "fpd-ok"}>
                  {checkedCount}/{checklist.length}
                </strong>
              </div>
              <div><span>Documentos</span><strong>{documents.length}</strong></div>
            </div>

            <button
              className="fpd-note-btn"
              onClick={() => setShowNote(true)}
            >
              <MessageSquare size={13} /> Agregar nota
            </button>
          </aside>

          {/* ── Right: Tabs ───────────────────────────────── */}
          <div className="fpd-main">
            <nav className="fpd-tabs">
              {TABS.map(t => (
                <button
                  key={t.key}
                  className={`fpd-tab${activeTab === t.key ? " fpd-tab--active" : ""}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  <t.icon size={14} strokeWidth={2} />
                  {t.label}
                  {t.key === "checklist" && requiredDone < requiredCount && (
                    <span className="fpd-tab__badge">{requiredCount - requiredDone}</span>
                  )}
                  {t.key === "documentos" && documents.length > 0 && (
                    <span className="fpd-tab__badge fpd-tab__badge--neutral">{documents.length}</span>
                  )}
                </button>
              ))}
            </nav>

            <div className="fpd-tab-content">

              {/* ── Ficha principal ──────────────────────── */}
              {activeTab === "ficha" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Ficha Principal</h3>
                    {!editingFicha
                      ? <button className="fpd-edit-btn" onClick={() => setEditingFicha(true)}><Edit3 size={13}/> Editar</button>
                      : <div className="fpd-edit-actions">
                          <button className="fpd-cancel-btn" onClick={() => { setEditingFicha(false); setFichaForm(proc); }}>Cancelar</button>
                          <button className="fp-btn-primary" onClick={saveFicha} disabled={saving}>
                            {saving ? <Loader2 size={13} className="spin"/> : <Save size={13}/>} Guardar
                          </button>
                        </div>
                    }
                  </div>

                  {!editingFicha ? (
                    <div className="fpd-info-grid">
                      <FieldRow label="Institución"       value={proc.institution} />
                      <FieldRow label="Cuenta vinculada"  value={proc.accounts?.name} />
                      <FieldRow label="Médico responsable"value={proc.doctor_name} />
                      <FieldRow label="Electrofisiólogo"  value={proc.electrophysiologist} />
                      <FieldRow label="Comprador"         value={proc.buyer_name} />
                      <FieldRow label="Paciente"          value={proc.patient_name} />
                      <FieldRow label="Obra Social"       value={proc.social_security} />
                      <FieldRow label="Número de OC"      value={proc.oc_number} />
                      <FieldRow label="Número de cotización" value={proc.quote_number} />
                      <FieldRow label="Número de cirugía" value={proc.surgery_number} />
                      <FieldRow label="Fecha de cirugía"  value={fmtDate(proc.surgery_date)} />
                      <FieldRow label="Hora de cirugía"   value={fmtTime(proc.surgery_time)} />
                      <FieldRow label="Quirófano"         value={proc.operating_room} />
                      <FieldRow label="Ciudad"            value={proc.city} />
                      <FieldRow label="Provincia"         value={proc.province} />
                      <FieldRow label="Vendedor"          value={sellers.find(s => s.id === proc.seller_id)?.full_name} />
                      {proc.notes && (
                        <div className="fpd-notes-row">
                          <span>Observaciones</span>
                          <p>{proc.notes}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="fp-form-grid fpd-form-grid">
                      <EditField label="Institución"        value={fichaForm.institution}        onChange={sf("institution")} />
                      <label className="fp-label">
                        <span>Cuenta vinculada</span>
                        <select value={fichaForm.account_id || ""} onChange={e => sf("account_id")(e.target.value)}>
                          <option value="">Sin cuenta</option>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </label>
                      <EditField label="Médico responsable" value={fichaForm.doctor_name}        onChange={sf("doctor_name")} />
                      <EditField label="Electrofisiólogo"   value={fichaForm.electrophysiologist}onChange={sf("electrophysiologist")} />
                      <EditField label="Comprador"          value={fichaForm.buyer_name}         onChange={sf("buyer_name")} />
                      <EditField label="Paciente"           value={fichaForm.patient_name}       onChange={sf("patient_name")} />
                      <EditField label="Obra Social"        value={fichaForm.social_security}    onChange={sf("social_security")} />
                      <EditField label="Número de OC"       value={fichaForm.oc_number}          onChange={sf("oc_number")} />
                      <EditField label="Número de cotización"value={fichaForm.quote_number}      onChange={sf("quote_number")} />
                      <EditField label="Número de cirugía"  value={fichaForm.surgery_number}     onChange={sf("surgery_number")} />
                      <EditField label="Fecha de cirugía"   value={fichaForm.surgery_date}       onChange={sf("surgery_date")} type="date" />
                      <EditField label="Hora de cirugía"    value={fichaForm.surgery_time}       onChange={sf("surgery_time")} type="time" />
                      <EditField label="Quirófano"          value={fichaForm.operating_room}     onChange={sf("operating_room")} />
                      <EditField label="Ciudad"             value={fichaForm.city}               onChange={sf("city")} />
                      <EditField label="Provincia"          value={fichaForm.province}           onChange={sf("province")} />
                      <label className="fp-label">
                        <span>Vendedor</span>
                        <select value={fichaForm.seller_id || ""} onChange={e => sf("seller_id")(e.target.value)}>
                          <option value="">Sin asignar</option>
                          {sellers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                      </label>
                      <label className="fp-label">
                        <span>Prioridad</span>
                        <select value={fichaForm.priority || "media"} onChange={e => sf("priority")(e.target.value)}>
                          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </label>
                      <label className="fp-label fp-label--full">
                        <span>Observaciones</span>
                        <textarea value={fichaForm.notes || ""} onChange={e => sf("notes")(e.target.value)} rows={3} />
                      </label>
                    </div>
                  )}
                </section>
              )}

              {/* ── Comercial ────────────────────────────── */}
              {activeTab === "comercial" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Sección Comercial</h3>
                    {!editingComercial
                      ? <button className="fpd-edit-btn" onClick={() => setEditingComercial(true)}><Edit3 size={13}/> Editar</button>
                      : <div className="fpd-edit-actions">
                          <button className="fpd-cancel-btn" onClick={() => { setEditingComercial(false); setComercialForm(proc); }}>Cancelar</button>
                          <button className="fp-btn-primary" onClick={saveComercial} disabled={saving}>
                            {saving ? <Loader2 size={13} className="spin"/> : <Save size={13}/>} Guardar
                          </button>
                        </div>
                    }
                  </div>
                  {!editingComercial ? (
                    <div className="fpd-info-grid">
                      <FieldRow label="Precio aprobado"  value={money(proc.approved_price)} />
                      <FieldRow label="Precio final"     value={money(proc.final_price)} />
                      <FieldRow label="Descuento"        value={proc.discount_pct ? `${proc.discount_pct}%` : null} />
                      <FieldRow label="Margen"           value={proc.margin_pct ? `${proc.margin_pct}%` : null} />
                      <FieldRow label="Estado comercial" value={proc.commercial_status} />
                      <FieldRow label="Competidor"       value={proc.competitor} />
                      <FieldRow label="Probabilidad"     value={proc.probability ? `${proc.probability}%` : null} />
                      <FieldRow label="Fecha límite"     value={fmtDate(proc.commercial_deadline)} />
                      {proc.commercial_notes && (
                        <div className="fpd-notes-row">
                          <span>Notas comerciales</span>
                          <p>{proc.commercial_notes}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="fp-form-grid fpd-form-grid">
                      <EditField label="Precio aprobado"  value={comercialForm.approved_price}     onChange={sc("approved_price")}   type="number" />
                      <EditField label="Precio final"     value={comercialForm.final_price}         onChange={sc("final_price")}      type="number" />
                      <EditField label="Descuento (%)"    value={comercialForm.discount_pct}        onChange={sc("discount_pct")}     type="number" />
                      <EditField label="Margen (%)"       value={comercialForm.margin_pct}          onChange={sc("margin_pct")}       type="number" />
                      <EditField label="Estado comercial" value={comercialForm.commercial_status}   onChange={sc("commercial_status")} />
                      <EditField label="Competidor"       value={comercialForm.competitor}           onChange={sc("competitor")} />
                      <EditField label="Probabilidad (%)" value={comercialForm.probability}          onChange={sc("probability")}      type="number" />
                      <EditField label="Fecha límite"     value={comercialForm.commercial_deadline}  onChange={sc("commercial_deadline")} type="date" />
                      <label className="fp-label fp-label--full">
                        <span>Notas comerciales</span>
                        <textarea value={comercialForm.commercial_notes || ""} onChange={e => sc("commercial_notes")(e.target.value)} rows={3} />
                      </label>
                    </div>
                  )}
                </section>
              )}

              {/* ── Productos / Materiales ───────────────── */}
              {activeTab === "productos" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Materiales entregados</h3>
                    <button className="fp-btn-primary" onClick={() => { setProductForm(EMPTY_PRODUCT); setShowProductForm(true); }}>
                      <Plus size={13} /> Agregar
                    </button>
                  </div>
                  {products.length === 0 ? (
                    <div className="fpd-empty">
                      <Package size={28} />
                      <p>Sin materiales registrados.</p>
                    </div>
                  ) : (
                    <div className="fpd-products-table-wrap">
                      <table className="fpd-products-table">
                        <thead>
                          <tr>
                            <th>Código</th><th>Descripción</th><th>Cant.</th>
                            <th>Lote</th><th>Serie</th><th>Venc.</th><th>Estado</th><th/>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map(p => (
                            <tr key={p.id}>
                              <td><code>{p.code || "—"}</code></td>
                              <td><strong>{p.description}</strong></td>
                              <td>{p.quantity}</td>
                              <td>{p.lot_number || "—"}</td>
                              <td>{p.serial_number || "—"}</td>
                              <td>{p.expiry_date ? fmtDate(p.expiry_date) : "—"}</td>
                              <td>
                                <span className="fpd-prod-status" style={{ "--ps": PRODUCT_STATUS_COLOR[p.status] }}>
                                  {PRODUCT_STATUS_LABEL[p.status] || p.status}
                                </span>
                              </td>
                              <td>
                                <div className="fpd-row-actions">
                                  <button onClick={() => { setProductForm(p); setShowProductForm(true); }}><Edit3 size={13}/></button>
                                  <button onClick={() => deleteProduct(p.id, p.description)}><Trash2 size={13}/></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* ── Checklist ────────────────────────────── */}
              {activeTab === "checklist" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Checklist Pre-Cirugía</h3>
                    <span className={`fpd-check-counter ${requiredDone >= requiredCount ? "fpd-ok" : "fpd-warn"}`}>
                      {requiredDone}/{requiredCount} obligatorios
                    </span>
                  </div>
                  <div className="fpd-checklist">
                    {checklist.length === 0 ? (
                      <div className="fpd-empty"><ClipboardList size={28}/><p>Sin checklist. Recargá la página.</p></div>
                    ) : (
                      checklist.map(item => (
                        <div
                          key={item.id}
                          className={`fpd-check-item${item.is_checked ? " fpd-check-item--done" : ""}`}
                          onClick={() => toggleChecklist(item)}
                        >
                          <span className={`fpd-check-box${item.is_checked ? " fpd-check-box--checked" : ""}`}>
                            {item.is_checked && <Check size={12} />}
                          </span>
                          <div className="fpd-check-info">
                            <span>{item.label}</span>
                            {item.is_required && !item.is_checked && (
                              <em className="fpd-required">Obligatorio</em>
                            )}
                            {item.is_checked && item.checked_at && (
                              <em className="fpd-checked-at">{fmtTs(item.checked_at)}</em>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {requiredDone < requiredCount && (
                    <div className="fpd-check-warning">
                      <AlertTriangle size={14} />
                      {requiredCount - requiredDone} ítem{requiredCount - requiredDone !== 1 ? "s" : ""} obligatorio{requiredCount - requiredDone !== 1 ? "s" : ""} sin completar.
                    </div>
                  )}
                </section>
              )}

              {/* ── Logística ────────────────────────────── */}
              {activeTab === "logistica" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Logística</h3>
                    {!editingLogistica
                      ? <button className="fpd-edit-btn" onClick={() => setEditingLogistica(true)}><Edit3 size={13}/> Editar</button>
                      : <div className="fpd-edit-actions">
                          <button className="fpd-cancel-btn" onClick={() => { setEditingLogistica(false); setLogisticaForm(proc); }}>Cancelar</button>
                          <button className="fp-btn-primary" onClick={saveLogistica} disabled={saving}>
                            {saving ? <Loader2 size={13} className="spin"/> : <Save size={13}/>} Guardar
                          </button>
                        </div>
                    }
                  </div>
                  {!editingLogistica ? (
                    <div className="fpd-info-grid">
                      <FieldRow label="Fecha salida"        value={fmtDate(proc.departure_date)} />
                      <FieldRow label="Hora salida"         value={fmtTime(proc.departure_time)} />
                      <FieldRow label="Transportista"       value={proc.carrier} />
                      <FieldRow label="Patente"             value={proc.vehicle_plate} />
                      <FieldRow label="Responsable"         value={proc.logistics_responsible} />
                      <FieldRow label="Tracking"            value={proc.tracking_number} />
                      <FieldRow label="Destino"             value={proc.destination} />
                      <FieldRow label="Entrega prevista"    value={fmtDate(proc.estimated_delivery)} />
                      <FieldRow label="Entrega realizada"   value={fmtDate(proc.actual_delivery)} />
                      <FieldRow label="Recibido por"        value={proc.received_by} />
                      {proc.logistics_notes && (
                        <div className="fpd-notes-row">
                          <span>Observaciones logística</span>
                          <p>{proc.logistics_notes}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="fp-form-grid fpd-form-grid">
                      <EditField label="Fecha salida"      value={logisticaForm.departure_date}       onChange={sl("departure_date")}       type="date" />
                      <EditField label="Hora salida"       value={logisticaForm.departure_time}       onChange={sl("departure_time")}       type="time" />
                      <EditField label="Transportista"     value={logisticaForm.carrier}              onChange={sl("carrier")} />
                      <EditField label="Patente"           value={logisticaForm.vehicle_plate}        onChange={sl("vehicle_plate")} />
                      <EditField label="Responsable"       value={logisticaForm.logistics_responsible}onChange={sl("logistics_responsible")} />
                      <EditField label="Tracking"          value={logisticaForm.tracking_number}      onChange={sl("tracking_number")} />
                      <EditField label="Destino"           value={logisticaForm.destination}          onChange={sl("destination")} />
                      <EditField label="Entrega prevista"  value={logisticaForm.estimated_delivery}   onChange={sl("estimated_delivery")} type="date" />
                      <EditField label="Entrega realizada" value={logisticaForm.actual_delivery}       onChange={sl("actual_delivery")}   type="date" />
                      <EditField label="Recibido por"      value={logisticaForm.received_by}          onChange={sl("received_by")} />
                      <label className="fp-label fp-label--full">
                        <span>Observaciones logística</span>
                        <textarea value={logisticaForm.logistics_notes || ""} onChange={e => sl("logistics_notes")(e.target.value)} rows={3} />
                      </label>
                    </div>
                  )}
                </section>
              )}

              {/* ── Documentos ───────────────────────────── */}
              {activeTab === "documentos" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Documentos adjuntos</h3>
                    <button className="fp-btn-primary" onClick={() => setShowDocForm(true)}>
                      <Plus size={13} /> Adjuntar
                    </button>
                  </div>
                  {documents.length === 0 ? (
                    <div className="fpd-empty">
                      <FileText size={28} />
                      <p>Sin documentos adjuntos.</p>
                    </div>
                  ) : (
                    <div className="fpd-docs-list">
                      {documents.map(doc => (
                        <div key={doc.id} className="fpd-doc-item">
                          <div className="fpd-doc-icon">
                            <FileText size={16} />
                          </div>
                          <div className="fpd-doc-info">
                            <strong>{doc.name}</strong>
                            <span>{DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type} · {fmtTs(doc.created_at)}</span>
                          </div>
                          <div className="fpd-doc-actions">
                            {doc.url && (
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" className="fpd-doc-link">
                                Abrir
                              </a>
                            )}
                            <button onClick={() => deleteDocument(doc.id, doc.name)}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ── Timeline ─────────────────────────────── */}
              {activeTab === "timeline" && (
                <section className="fpd-section">
                  <div className="fpd-section__hd">
                    <h3>Actividad</h3>
                    <button className="fp-btn-primary" onClick={() => setShowNote(true)}>
                      <Plus size={13} /> Agregar nota
                    </button>
                  </div>
                  {timeline.length === 0 ? (
                    <div className="fpd-empty"><Activity size={28}/><p>Sin actividad registrada.</p></div>
                  ) : (
                    <ol className="fpd-timeline">
                      {timeline.map(entry => (
                        <li key={entry.id} className={`fpd-tl-item fpd-tl--${entry.action}`}>
                          <span className="fpd-tl__dot" />
                          <div className="fpd-tl__body">
                            <p>{entry.description}</p>
                            <em>{entry.user_name || "Sistema"} · {fmtTs(entry.created_at)}</em>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}

            </div>
          </div>
        </div>

        {/* ── Status confirm modal ─────────────────────────── */}
        {confirmStatus && (
          <div className="fp-modal-overlay" onClick={() => setConfirmStatus(null)}>
            <div className="fpd-confirm-modal" onClick={e => e.stopPropagation()}>
              <h4>Cambiar estado</h4>
              <p>
                ¿Mover este procedimiento a{" "}
                <strong style={{ color: confirmStatus.color }}>{confirmStatus.label}</strong>?
              </p>
              <div className="fpd-confirm-actions">
                <button className="fpd-cancel-btn" onClick={() => setConfirmStatus(null)}>Cancelar</button>
                <button
                  className="fp-btn-primary"
                  style={{ background: confirmStatus.color }}
                  onClick={() => advanceStatus(confirmStatus.key)}
                  disabled={saving}
                >
                  {saving ? "Actualizando…" : `Confirmar → ${confirmStatus.label}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Note modal ───────────────────────────────────── */}
        {showNote && (
          <div className="fp-modal-overlay" onClick={() => setShowNote(false)}>
            <div className="fpd-confirm-modal" onClick={e => e.stopPropagation()}>
              <h4>Agregar nota</h4>
              <textarea
                className="fpd-note-textarea"
                rows={4}
                placeholder="Escribí una nota sobre este procedimiento…"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                autoFocus
              />
              <div className="fpd-confirm-actions">
                <button className="fpd-cancel-btn" onClick={() => setShowNote(false)}>Cancelar</button>
                <button className="fp-btn-primary" onClick={saveNote} disabled={!noteText.trim()}>
                  Guardar nota
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Product form modal ───────────────────────────── */}
        {showProductForm && (
          <div className="fp-modal-overlay" onClick={() => setShowProductForm(false)}>
            <div className="fp-modal" onClick={e => e.stopPropagation()}>
              <div className="fp-modal__hd">
                <div><h3>{productForm.id ? "Editar material" : "Agregar material"}</h3></div>
                <button className="fp-modal__close" onClick={() => setShowProductForm(false)}><X size={18}/></button>
              </div>
              <div className="fp-modal__body">
                <div className="fp-form-grid">
                  <EditField label="Código"      value={productForm.code}          onChange={sp("code")} />
                  <EditField label="Descripción *"value={productForm.description}  onChange={sp("description")} />
                  <EditField label="Cantidad"    value={productForm.quantity}      onChange={sp("quantity")} type="number" />
                  <EditField label="Lote"        value={productForm.lot_number}    onChange={sp("lot_number")} />
                  <EditField label="Serie"       value={productForm.serial_number} onChange={sp("serial_number")} />
                  <EditField label="Vencimiento" value={productForm.expiry_date}   onChange={sp("expiry_date")} type="date" />
                  <label className="fp-label">
                    <span>Estado</span>
                    <select value={productForm.status} onChange={e => sp("status")(e.target.value)}>
                      {PRODUCT_STATUSES.map(s => <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="fp-modal__ft">
                <button className="fp-btn-ghost" onClick={() => setShowProductForm(false)}>Cancelar</button>
                <button className="fp-btn-primary" onClick={saveProduct} disabled={saving || !productForm.description}>
                  {saving ? "Guardando…" : productForm.id ? "Guardar cambios" : "Agregar material"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Document form modal ──────────────────────────── */}
        {showDocForm && (
          <div className="fp-modal-overlay" onClick={() => setShowDocForm(false)}>
            <div className="fpd-confirm-modal" onClick={e => e.stopPropagation()}>
              <h4>Adjuntar documento</h4>
              <div className="fpd-doc-form">
                <label className="fp-label">
                  <span>Tipo</span>
                  <select value={docForm.doc_type} onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}>
                    {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="fp-label">
                  <span>Nombre *</span>
                  <input value={docForm.name} onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre del documento" />
                </label>
                <label className="fp-label">
                  <span>URL / Link</span>
                  <input value={docForm.url} onChange={e => setDocForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." />
                </label>
              </div>
              <div className="fpd-confirm-actions">
                <button className="fpd-cancel-btn" onClick={() => setShowDocForm(false)}>Cancelar</button>
                <button className="fp-btn-primary" onClick={saveDocument} disabled={!docForm.name}>
                  Adjuntar
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}

// ─── Micro-components ─────────────────────────────────────────
function FieldRow({ label, value }) {
  if (!value || value === "—") return (
    <div className="fpd-field-row fpd-field-row--empty">
      <span>{label}</span>
      <span className="fpd-empty-val">—</span>
    </div>
  );
  return (
    <div className="fpd-field-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text" }) {
  return (
    <label className="fp-label">
      <span>{label}</span>
      <input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} />
    </label>
  );
}
