import { useEffect, useMemo, useState } from "react";
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

/* ─── Helpers ────────────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
}

function fmtMoney(v) {
  if (!v) return "—";
  return new Intl.NumberFormat("es-AR", { style:"currency", currency:"ARS", minimumFractionDigits:0 }).format(Number(v));
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + "T00:00:00") - new Date();
  return Math.ceil(diff / 86400000);
}

function endDateAlert(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return "gray";
  if (days < 0)  return "red";
  if (days < 7)  return "red";
  if (days < 15) return "orange";
  if (days < 30) return "yellow";
  return "green";
}

function actionAlert(tender) {
  if (!tender.next_action) return "red";
  if (!tender.next_action_date) return "yellow";
  const days = daysUntil(tender.next_action_date);
  if (days < 0)  return "red";
  if (days <= 3) return "yellow";
  return "green";
}

function statusBadge(status) {
  const map = {
    "En análisis": "blue", "Cotizada": "blue", "Presentada": "yellow",
    "Adjudicada": "green", "Orden de compra recibida": "green",
    "En ejecución": "green", "Entrega parcial": "orange",
    "Entregada": "green", "Facturada": "purple", "Cobrada": "green",
    "Finalizada": "gray", "Perdida / No adjudicada": "red", "Vencida": "red",
  };
  return map[status] || "gray";
}

function priorityClass(p) {
  return { "Alta":"alta", "Crítica":"critica", "Media":"media", "Baja":"baja" }[p] || "baja";
}

function priorityIcon(p) {
  return { "Alta":"▲", "Crítica":"⬆", "Media":"→", "Baja":"▼" }[p] || "→";
}

/* ─── Componente principal ───────────────────────────────────────────── */
export default function TendersPage({ profile, onNavigate }) {
  const [tenders,     setTenders]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [showDetail,  setShowDetail]  = useState(null);
  const [editData,    setEditData]    = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [form,        setForm]        = useState(EMPTY_FORM);

  // Filtros
  const [fJurisdiccion, setFJurisdiccion] = useState("");
  const [fInstitucion,  setFInstitucion]  = useState("");
  const [fEstado,       setFEstado]       = useState("");
  const [fResponsable,  setFResponsable]  = useState("");
  const [fPrioridad,    setFPrioridad]    = useState("");
  const [fBusqueda,     setFBusqueda]     = useState("");

  useEffect(() => { loadTenders(); }, []);

  async function loadTenders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenders").select("*").order("created_at", { ascending: false });
    if (!error) setTenders(data || []);
    setLoading(false);
  }

  /* KPIs */
  const kpis = useMemo(() => {
    const activas       = tenders.filter(t => !["Finalizada","Perdida / No adjudicada","Vencida"].includes(t.operational_status));
    const montoTotal    = activas.reduce((s,t) => s + Number(t.purchase_order_amount||0), 0);
    const adjudicadas   = tenders.filter(t => ["Adjudicada","Orden de compra recibida","En ejecución","Entrega parcial","Entregada","Facturada","Cobrada"].includes(t.operational_status));
    const montoAdj      = adjudicadas.reduce((s,t) => s + Number(t.purchase_order_amount||0), 0);
    const ocActivas     = tenders.filter(t => t.purchase_order_number && ["En ejecución","Entrega parcial","Entregada"].includes(t.operational_status));
    const proxVencer    = tenders.filter(t => { const d = daysUntil(t.end_date); return d !== null && d >= 0 && d <= 30; });
    const vencidas      = tenders.filter(t => { const d = daysUntil(t.end_date); return d !== null && d < 0 && !["Finalizada","Cobrada"].includes(t.operational_status); });
    const sinAccion     = tenders.filter(t => !t.next_action && !["Finalizada","Cobrada","Perdida / No adjudicada"].includes(t.operational_status));
    const docPendiente  = tenders.filter(t => t.documentation_status === "Pendiente" && !["Finalizada","Cobrada"].includes(t.operational_status));
    return { activas:activas.length, montoTotal, montoAdj, ocActivas:ocActivas.length, proxVencer:proxVencer.length, vencidas:vencidas.length, sinAccion:sinAccion.length, docPendiente:docPendiente.length };
  }, [tenders]);

  /* Filtrado */
  const filtered = useMemo(() => {
    return tenders.filter(t => {
      if (fJurisdiccion && t.jurisdiction !== fJurisdiccion) return false;
      if (fInstitucion  && t.institution  !== fInstitucion)  return false;
      if (fEstado       && t.operational_status !== fEstado) return false;
      if (fResponsable  && t.internal_owner !== fResponsable) return false;
      if (fPrioridad    && t.priority !== fPrioridad) return false;
      if (fBusqueda) {
        const q = fBusqueda.toLowerCase();
        return (
          (t.process_number   || "").toLowerCase().includes(q) ||
          (t.expedient_number || "").toLowerCase().includes(q) ||
          (t.purchase_order_number || "").toLowerCase().includes(q) ||
          (t.institution      || "").toLowerCase().includes(q) ||
          (t.process_name     || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tenders, fJurisdiccion, fInstitucion, fEstado, fResponsable, fPrioridad, fBusqueda]);

  /* Opciones para filtros */
  const jurisdicciones = [...new Set(tenders.map(t => t.jurisdiction).filter(Boolean))];
  const instituciones  = [...new Set(tenders.map(t => t.institution).filter(Boolean))];
  const responsables   = [...new Set(tenders.map(t => t.internal_owner).filter(Boolean))];

  /* Form handlers */
  function openNew() {
    setEditData(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(t) {
    setEditData(t);
    setForm({
      jurisdiction: t.jurisdiction || "", institution: t.institution || "",
      process_type: t.process_type || "", process_number: t.process_number || "",
      tender_type: t.tender_type || "Original", process_name: t.process_name || "",
      expedient_number: t.expedient_number || "", requesting_sector: t.requesting_sector || "",
      contract_term: t.contract_term || "", purchase_order_number: t.purchase_order_number || "",
      purchase_order_date: t.purchase_order_date || "", purchase_order_amount: t.purchase_order_amount || "",
      start_date: t.start_date || "", end_date: t.end_date || "",
      validity_status: t.validity_status || "En análisis", execution_policy: t.execution_policy || "",
      bridge_ot: t.bridge_ot || "", internal_owner: t.internal_owner || "",
      product_line: t.product_line || "", operational_status: t.operational_status || "En análisis",
      next_action: t.next_action || "", next_action_date: t.next_action_date || "",
      documentation_status: t.documentation_status || "Pendiente",
      documentation_pending_detail: t.documentation_pending_detail || "",
      billing_status: t.billing_status || "Pendiente", delivery_status: t.delivery_status || "Pendiente",
      priority: t.priority || "Media", portal_link: t.portal_link || "", notes: t.notes || "",
    });
    setShowForm(true);
    setShowDetail(null);
  }

  function setF(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function saveTender() {
    setSaving(true);
    const payload = {
      ...form,
      purchase_order_amount: form.purchase_order_amount ? Number(form.purchase_order_amount) : null,
      purchase_order_date:   form.purchase_order_date   || null,
      start_date:            form.start_date            || null,
      end_date:              form.end_date              || null,
      next_action_date:      form.next_action_date      || null,
      owner_id:              profile?.id,
      updated_at:            new Date().toISOString(),
    };

    if (editData) {
      const { error } = await supabase.from("tenders").update(payload).eq("id", editData.id);
      if (!error) await loadTenders();
      else alert("Error: " + error.message);
    } else {
      const { error } = await supabase.from("tenders").insert([payload]);
      if (!error) await loadTenders();
      else alert("Error: " + error.message);
    }
    setSaving(false);
    setShowForm(false);
  }

  async function deleteTender(id) {
    if (!confirm("¿Eliminar esta licitación?")) return;
    await supabase.from("tenders").delete().eq("id", id);
    setTenders(prev => prev.filter(t => t.id !== id));
    setShowDetail(null);
  }

  const compactMoney = v => {
    const n = Number(v || 0);
    if (!n) return "—";
    if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(1).replace(".",",")} MM`;
    if (n >= 1_000_000)     return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
    if (n >= 1_000)         return `$${Math.round(n/1_000)} K`;
    return `$${n}`;
  };

  return (
    <Layout title="Licitaciones" profile={profile} onNavigate={onNavigate}>
      <div className="tn-page">

        {/* Header */}
        <div className="tn-header">
          <div>
            <h2>Licitaciones y Órdenes de Compra</h2>
            <p>Seguimiento completo de procesos licitatorios y OC en curso</p>
          </div>
          <div className="tn-header__actions">
            <button className="tn-btn tn-btn--ghost" onClick={loadTenders}>↻ Actualizar</button>
            <button className="tn-btn tn-btn--primary" onClick={openNew}>+ Nueva licitación</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="tn-kpis">
          <div className="tn-kpi">
            <span className="tn-kpi__label">Licitaciones activas</span>
            <span className="tn-kpi__val">{kpis.activas}</span>
            <span className="tn-kpi__sub">{compactMoney(kpis.montoTotal)} en curso</span>
          </div>
          <div className="tn-kpi tn-kpi--green">
            <span className="tn-kpi__label">Monto adjudicado</span>
            <span className="tn-kpi__val">{compactMoney(kpis.montoAdj)}</span>
            <span className="tn-kpi__sub">{kpis.ocActivas} OC en ejecución</span>
          </div>
          <div className={`tn-kpi ${kpis.proxVencer > 0 ? "tn-kpi--warn" : ""}`}>
            <span className="tn-kpi__label">Próximas a vencer</span>
            <span className="tn-kpi__val">{kpis.proxVencer}</span>
            <span className="tn-kpi__sub">en los próximos 30 días</span>
          </div>
          <div className={`tn-kpi ${kpis.vencidas > 0 ? "tn-kpi--danger" : ""}`}>
            <span className="tn-kpi__label">Vencidas</span>
            <span className="tn-kpi__val">{kpis.vencidas}</span>
            <span className="tn-kpi__sub">{kpis.sinAccion} sin próxima acción</span>
          </div>
          <div className={`tn-kpi ${kpis.docPendiente > 0 ? "tn-kpi--warn" : "tn-kpi--green"}`}>
            <span className="tn-kpi__label">Doc. pendiente</span>
            <span className="tn-kpi__val">{kpis.docPendiente}</span>
            <span className="tn-kpi__sub">licitaciones con docs incompletos</span>
          </div>
          <div className="tn-kpi">
            <span className="tn-kpi__label">Total registros</span>
            <span className="tn-kpi__val">{tenders.length}</span>
            <span className="tn-kpi__sub">{filtered.length} visibles con filtros</span>
          </div>
          <div className="tn-kpi tn-kpi--green">
            <span className="tn-kpi__label">OC activas</span>
            <span className="tn-kpi__val">{kpis.ocActivas}</span>
            <span className="tn-kpi__sub">en ejecución o entrega</span>
          </div>
          <div className={`tn-kpi ${kpis.sinAccion > 0 ? "tn-kpi--danger" : "tn-kpi--green"}`}>
            <span className="tn-kpi__label">Sin próxima acción</span>
            <span className="tn-kpi__val">{kpis.sinAccion}</span>
            <span className="tn-kpi__sub">requieren seguimiento</span>
          </div>
        </div>

        {/* Filtros */}
        <div className="tn-filters">
          <div className="tn-filter-group tn-filter-group--wide">
            <label>Buscar</label>
            <input placeholder="Proceso, expediente, OC, institución…" value={fBusqueda} onChange={e => setFBusqueda(e.target.value)}/>
          </div>
          <div className="tn-filter-group">
            <label>Estado</label>
            <select value={fEstado} onChange={e => setFEstado(e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="tn-filter-group">
            <label>Jurisdicción</label>
            <select value={fJurisdiccion} onChange={e => setFJurisdiccion(e.target.value)}>
              <option value="">Todas</option>
              {jurisdicciones.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div className="tn-filter-group">
            <label>Institución</label>
            <select value={fInstitucion} onChange={e => setFInstitucion(e.target.value)}>
              <option value="">Todas</option>
              {instituciones.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div className="tn-filter-group">
            <label>Responsable</label>
            <select value={fResponsable} onChange={e => setFResponsable(e.target.value)}>
              <option value="">Todos</option>
              {responsables.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="tn-filter-group">
            <label>Prioridad</label>
            <select value={fPrioridad} onChange={e => setFPrioridad(e.target.value)}>
              <option value="">Todas</option>
              {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {(fBusqueda||fEstado||fJurisdiccion||fInstitucion||fResponsable||fPrioridad) && (
            <button className="tn-btn tn-btn--ghost tn-btn--sm" style={{alignSelf:"flex-end"}} onClick={() => { setFBusqueda(""); setFEstado(""); setFJurisdiccion(""); setFInstitucion(""); setFResponsable(""); setFPrioridad(""); }}>
              ✕ Limpiar
            </button>
          )}
        </div>

        {/* Tabla */}
        <div className="tn-table-card">
          {loading ? (
            <div className="tn-empty"><div className="tn-empty__icon">⏳</div><h3>Cargando…</h3></div>
          ) : filtered.length === 0 ? (
            <div className="tn-empty">
              <div className="tn-empty__icon">📋</div>
              <h3>Sin licitaciones</h3>
              <p>{tenders.length === 0 ? "Creá la primera licitación con el botón + Nueva." : "No hay resultados con los filtros aplicados."}</p>
            </div>
          ) : (
            <div className="tn-table-wrap">
              <table className="tn-table">
                <thead>
                  <tr>
                    <th>Alerta</th>
                    <th>Institución</th>
                    <th>Proceso</th>
                    <th>Expediente</th>
                    <th>OC</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Fin</th>
                    <th>Próx. acción</th>
                    <th>Responsable</th>
                    <th>Prioridad</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const endColor    = endDateAlert(t.end_date);
                    const actionColor = actionAlert(t);
                    return (
                      <tr key={t.id} onClick={() => setShowDetail(t)}>
                        <td>
                          <div style={{display:"flex",gap:4}}>
                            <span className={`tn-alert-dot tn-alert-dot--${endColor}`} title={`Vencimiento: ${fmtDate(t.end_date)}`}/>
                            <span className={`tn-alert-dot tn-alert-dot--${actionColor}`} title={`Próx. acción: ${t.next_action||"Sin definir"}`}/>
                          </div>
                        </td>
                        <td><strong style={{fontSize:12}}>{t.institution||"—"}</strong><br/><span style={{fontSize:11,color:"#94a3b8"}}>{t.jurisdiction||""}</span></td>
                        <td style={{maxWidth:180}}><span style={{fontSize:12}}>{t.process_number||"—"}</span><br/><span style={{fontSize:11,color:"#94a3b8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"block",maxWidth:170}}>{t.process_name||""}</span></td>
                        <td style={{fontSize:12}}>{t.expedient_number||"—"}</td>
                        <td style={{fontSize:12}}>{t.purchase_order_number||"—"}</td>
                        <td style={{fontSize:12,fontWeight:700}}>{compactMoney(t.purchase_order_amount)}</td>
                        <td><span className={`tn-badge tn-badge--${statusBadge(t.operational_status)}`}>{t.operational_status||"—"}</span></td>
                        <td style={{fontSize:12,color: endColor==="red"?"#ef4444": endColor==="orange"?"#f97316":endColor==="yellow"?"#d97706":"#334155"}}>{fmtDate(t.end_date)}</td>
                        <td style={{fontSize:12,maxWidth:160}}>
                          {t.next_action ? <span style={{color:actionColor==="red"?"#ef4444":actionColor==="yellow"?"#d97706":"#334155"}}>{t.next_action}</span> : <span style={{color:"#ef4444",fontSize:11}}>Sin definir</span>}
                          {t.next_action_date && <><br/><span style={{fontSize:11,color:"#94a3b8"}}>{fmtDate(t.next_action_date)}</span></>}
                        </td>
                        <td style={{fontSize:12}}>{t.internal_owner||"—"}</td>
                        <td>
                          <span className={`tn-priority tn-priority--${priorityClass(t.priority)}`}>
                            {priorityIcon(t.priority)} {t.priority||"—"}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="tn-actions">
                            <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={() => openEdit(t)}>✎</button>
                            <button className="tn-btn tn-btn--danger tn-btn--sm" onClick={() => deleteTender(t.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {showDetail && (
          <div className="tn-detail">
            <div className="tn-detail__header">
              <div>
                <p className="tn-detail__title">{showDetail.process_name || showDetail.process_number || "Sin nombre"}</p>
                <p className="tn-detail__sub">{showDetail.institution} · {showDetail.jurisdiction}</p>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span className={`tn-badge tn-badge--${statusBadge(showDetail.operational_status)}`}>{showDetail.operational_status}</span>
                <button className="tn-btn tn-btn--ghost tn-btn--sm" onClick={() => openEdit(showDetail)}>✎ Editar</button>
                <button className="tn-modal__close" onClick={() => setShowDetail(null)}>✕</button>
              </div>
            </div>
            <div className="tn-detail__body">
              <div className="tn-detail__section">
                <p className="tn-detail__section-title">Datos del proceso</p>
                <div className="tn-detail__row"><span>Número de proceso</span><span>{showDetail.process_number||"—"}</span></div>
                <div className="tn-detail__row"><span>Tipo de proceso</span><span>{showDetail.process_type||"—"}</span></div>
                <div className="tn-detail__row"><span>Tipo</span><span>{showDetail.tender_type||"—"}</span></div>
                <div className="tn-detail__row"><span>Expediente</span><span>{showDetail.expedient_number||"—"}</span></div>
                <div className="tn-detail__row"><span>Sector solicitante</span><span>{showDetail.requesting_sector||"—"}</span></div>
                <div className="tn-detail__row"><span>Plazo de contrato</span><span>{showDetail.contract_term||"—"}</span></div>
                <div className="tn-detail__row"><span>Portal</span><span>{showDetail.portal_link ? <a href={showDetail.portal_link} target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>Ver enlace</a> : "—"}</span></div>
              </div>
              <div className="tn-detail__section">
                <p className="tn-detail__section-title">Orden de compra</p>
                <div className="tn-detail__row"><span>Número OC</span><span>{showDetail.purchase_order_number||"—"}</span></div>
                <div className="tn-detail__row"><span>Fecha OC</span><span>{fmtDate(showDetail.purchase_order_date)}</span></div>
                <div className="tn-detail__row"><span>Monto OC</span><span style={{fontWeight:800,color:"#0f172a"}}>{fmtMoney(showDetail.purchase_order_amount)}</span></div>
                <div className="tn-detail__row"><span>Fecha inicio</span><span>{fmtDate(showDetail.start_date)}</span></div>
                <div className="tn-detail__row"><span>Fecha fin</span><span style={{color: endDateAlert(showDetail.end_date)==="red"?"#ef4444":"inherit"}}>{fmtDate(showDetail.end_date)}</span></div>
                <div className="tn-detail__row"><span>Póliza ejecución</span><span>{showDetail.execution_policy||"—"}</span></div>
                <div className="tn-detail__row"><span>OT Bridge</span><span>{showDetail.bridge_ot||"—"}</span></div>
              </div>
              <div className="tn-detail__section">
                <p className="tn-detail__section-title">Seguimiento operativo</p>
                <div className="tn-detail__row"><span>Responsable</span><span>{showDetail.internal_owner||"—"}</span></div>
                <div className="tn-detail__row"><span>Línea de producto</span><span>{showDetail.product_line||"—"}</span></div>
                <div className="tn-detail__row"><span>Prioridad</span><span className={`tn-priority tn-priority--${priorityClass(showDetail.priority)}`}>{priorityIcon(showDetail.priority)} {showDetail.priority}</span></div>
                <div className="tn-detail__row"><span>Próxima acción</span><span>{showDetail.next_action||"—"}</span></div>
                <div className="tn-detail__row"><span>Fecha próx. acción</span><span>{fmtDate(showDetail.next_action_date)}</span></div>
              </div>
              <div className="tn-detail__section">
                <p className="tn-detail__section-title">Estado operativo</p>
                <div className="tn-detail__row"><span>Documentación</span><span><span className={`tn-badge tn-badge--${showDetail.documentation_status==="Completa"?"green":showDetail.documentation_status==="Incompleta"?"yellow":"red"}`}>{showDetail.documentation_status}</span></span></div>
                {showDetail.documentation_pending_detail && <div className="tn-detail__row"><span>Detalle doc.</span><span style={{fontSize:11}}>{showDetail.documentation_pending_detail}</span></div>}
                <div className="tn-detail__row"><span>Facturación</span><span><span className={`tn-badge tn-badge--${showDetail.billing_status==="Cobrada"?"green":showDetail.billing_status==="Facturada"?"blue":showDetail.billing_status==="Parcial"?"yellow":"red"}`}>{showDetail.billing_status}</span></span></div>
                <div className="tn-detail__row"><span>Entrega</span><span><span className={`tn-badge tn-badge--${showDetail.delivery_status==="Completa"?"green":showDetail.delivery_status==="Parcial"?"yellow":"red"}`}>{showDetail.delivery_status}</span></span></div>
                {showDetail.notes && <><p className="tn-detail__section-title" style={{marginTop:8}}>Observaciones</p><p style={{fontSize:12.5,color:"#334155",lineHeight:1.5,margin:0}}>{showDetail.notes}</p></>}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Modal formulario */}
      {showForm && (
        <div className="tn-overlay" onClick={e => { if (e.target.classList.contains("tn-overlay")) setShowForm(false); }}>
          <div className="tn-modal">
            <div className="tn-modal__header">
              <h3>{editData ? "Editar licitación" : "Nueva licitación"}</h3>
              <button className="tn-modal__close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="tn-modal__body">

              {/* Datos generales */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Datos generales</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Jurisdicción</label><input value={form.jurisdiction} onChange={e=>setF("jurisdiction",e.target.value)} placeholder="Ej: CABA, Provincia de Buenos Aires"/></div>
                  <div className="tn-field"><label>Hospital / Institución</label><input value={form.institution} onChange={e=>setF("institution",e.target.value)} placeholder="Nombre del hospital o ente"/></div>
                  <div className="tn-field"><label>Responsable interno</label><input value={form.internal_owner} onChange={e=>setF("internal_owner",e.target.value)} placeholder="Nombre del responsable"/></div>
                  <div className="tn-field"><label>Línea de producto</label><input value={form.product_line} onChange={e=>setF("product_line",e.target.value)} placeholder="Ej: Electrocirugía, Ortopedia"/></div>
                </div>
              </div>

              {/* Datos del proceso */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Datos del proceso</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Número de proceso</label><input value={form.process_number} onChange={e=>setF("process_number",e.target.value)} placeholder="Ej: LP 001/2026"/></div>
                  <div className="tn-field"><label>Tipo de proceso</label><input value={form.process_type} onChange={e=>setF("process_type",e.target.value)} placeholder="Ej: Licitación Pública, Concurso de Precios"/></div>
                  <div className="tn-field"><label>Tipo</label>
                    <select value={form.tender_type} onChange={e=>setF("tender_type",e.target.value)}>
                      {TENDER_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="tn-field"><label>Número de expediente</label><input value={form.expedient_number} onChange={e=>setF("expedient_number",e.target.value)} placeholder="Ej: EX-2026-12345"/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field"><label>Nombre del proceso</label><input value={form.process_name} onChange={e=>setF("process_name",e.target.value)} placeholder="Descripción del proceso licitatorio"/></div>
                </div>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Sector solicitante</label><input value={form.requesting_sector} onChange={e=>setF("requesting_sector",e.target.value)} placeholder="Ej: Quirófano, Guardia"/></div>
                  <div className="tn-field"><label>Plazo de contrato</label><input value={form.contract_term} onChange={e=>setF("contract_term",e.target.value)} placeholder="Ej: 12 meses"/></div>
                </div>
              </div>

              {/* Orden de compra */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Orden de compra</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Número de OC</label><input value={form.purchase_order_number} onChange={e=>setF("purchase_order_number",e.target.value)} placeholder="Ej: OC-2026-001"/></div>
                  <div className="tn-field"><label>Fecha de OC</label><input type="date" value={form.purchase_order_date} onChange={e=>setF("purchase_order_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Monto de OC ($)</label><input type="number" value={form.purchase_order_amount} onChange={e=>setF("purchase_order_amount",e.target.value)} placeholder="0"/></div>
                </div>
              </div>

              {/* Fechas */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Fechas y vigencia</p>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Fecha de inicio</label><input type="date" value={form.start_date} onChange={e=>setF("start_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Fecha de finalización</label><input type="date" value={form.end_date} onChange={e=>setF("end_date",e.target.value)}/></div>
                  <div className="tn-field"><label>Estado de vigencia</label>
                    <select value={form.validity_status} onChange={e=>setF("validity_status",e.target.value)}>
                      {ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Seguimiento */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Seguimiento operativo</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Estado operativo</label>
                    <select value={form.operational_status} onChange={e=>setF("operational_status",e.target.value)}>
                      {ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field"><label>Prioridad</label>
                    <select value={form.priority} onChange={e=>setF("priority",e.target.value)}>
                      {PRIORIDADES.map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="tn-field"><label>Próxima acción</label><input value={form.next_action} onChange={e=>setF("next_action",e.target.value)} placeholder="Ej: Enviar documentación"/></div>
                  <div className="tn-field"><label>Fecha próxima acción</label><input type="date" value={form.next_action_date} onChange={e=>setF("next_action_date",e.target.value)}/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--3">
                  <div className="tn-field"><label>Documentación</label>
                    <select value={form.documentation_status} onChange={e=>setF("documentation_status",e.target.value)}>
                      {DOC_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field"><label>Facturación</label>
                    <select value={form.billing_status} onChange={e=>setF("billing_status",e.target.value)}>
                      {BILL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tn-field"><label>Entrega</label>
                    <select value={form.delivery_status} onChange={e=>setF("delivery_status",e.target.value)}>
                      {DEL_ESTADOS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Doc / Póliza / OT */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Documentación / Póliza / OT Bridge</p>
                <div className="tn-form-grid">
                  <div className="tn-field"><label>Póliza de ejecución</label><input value={form.execution_policy} onChange={e=>setF("execution_policy",e.target.value)} placeholder="Número o descripción"/></div>
                  <div className="tn-field"><label>OT Sistema Bridge</label><input value={form.bridge_ot} onChange={e=>setF("bridge_ot",e.target.value)} placeholder="Número de OT"/></div>
                  <div className="tn-field"><label>Link / Portal</label><input value={form.portal_link} onChange={e=>setF("portal_link",e.target.value)} placeholder="https://…"/></div>
                </div>
                <div className="tn-form-grid tn-form-grid--1">
                  <div className="tn-field"><label>Detalle documentación pendiente</label><input value={form.documentation_pending_detail} onChange={e=>setF("documentation_pending_detail",e.target.value)} placeholder="Qué falta, qué está incompleto"/></div>
                </div>
              </div>

              {/* Observaciones */}
              <div className="tn-form-section">
                <p className="tn-form-section__title">Observaciones</p>
                <div className="tn-field">
                  <textarea value={form.notes} onChange={e=>setF("notes",e.target.value)} placeholder="Notas adicionales, comentarios, historial de seguimiento…"/>
                </div>
              </div>

            </div>
            <div className="tn-modal__footer">
              <button className="tn-btn tn-btn--ghost" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="tn-btn tn-btn--primary" onClick={saveTender} disabled={saving}>
                {saving ? "Guardando…" : editData ? "Guardar cambios" : "Crear licitación"}
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}