import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./visits.css";

const EMPTY_FORM = {
  account_id:           "",
  product_id:           "",
  contact_name:         "",
  visit_type:           "presencial",
  visit_date:           new Date().toISOString().slice(0, 10),
  visit_time:           "",
  status:               "programada",
  priority:             "media",
  business_unit:        "",
  pipeline_stage:       "",
  objective:            "",
  notes:                "",
  result:               "",
  objection:            "",
  next_step:            "",
  next_action:          "",
  next_action_date:     "",
  followup_date:        "",
  commercial_potential: "",
  materials:            [],
};

const VISIT_TYPES = [
  { value: "presencial",   label: "Presencial"   },
  { value: "virtual",      label: "Virtual"      },
  { value: "telefono",     label: "Llamada"      },
  { value: "seguimiento",  label: "Seguimiento"  },
  { value: "demo",         label: "Demo"         },
  { value: "capacitacion", label: "Capacitación" },
  { value: "cotizacion",   label: "Cotización"   },
  { value: "postventa",    label: "Postventa"    },
];

const STATUS_OPTIONS = [
  { value: "programada",        label: "Programada",        color: "#3b82f6" },
  { value: "realizada",         label: "Realizada",         color: "#10b981" },
  { value: "reprogramada",      label: "Reprogramada",      color: "#f59e0b" },
  { value: "cancelada",         label: "Cancelada",         color: "#ef4444" },
  { value: "pendiente_informe", label: "Pendiente informe", color: "#8b5cf6" },
];

const PRIORITY_OPTIONS = [
  { value: "alta",  label: "Alta",  color: "#ef4444" },
  { value: "media", label: "Media", color: "#f59e0b" },
  { value: "baja",  label: "Baja",  color: "#10b981" },
];

const BUSINESS_UNITS  = ["EchoLaser","Diálisis","Osypka","VAC","Fresenius Kabi","Kangaroo","Otra"];
const PIPELINE_STAGES = ["Lead","Contacto","Reunión","Demo","Cotización","Negociación","Ganado","Perdido"];

const MATERIAL_LABELS = {
  speech:        "Speech",
  brochure:      "Brochure",
  video:         "Video",
  ficha_tecnica: "Ficha técnica",
};

function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}

function getFollowupAlert(visitDate, followupDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (!followupDate) return null;
  const follow = new Date(followupDate); follow.setHours(0,0,0,0);
  const d = Math.ceil((follow - today) / 86400000);
  if (d < 0)   return { tone: "overdue", label: `Vencido hace ${Math.abs(d)}d` };
  if (d === 0) return { tone: "today",   label: "Seguimiento HOY" };
  if (d <= 2)  return { tone: "urgent",  label: `Seguimiento en ${d}d` };
  if (d <= 7)  return { tone: "soon",    label: `Seguimiento en ${d}d` };
  return { tone: "ok", label: `Seguimiento en ${d}d` };
}

function getTimelineData(visitDate, followupDate) {
  if (!visitDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const visit = new Date(visitDate); visit.setHours(0,0,0,0);
  const daysSinceVisit = Math.ceil((today - visit) / 86400000);
  if (!followupDate) return { daysSinceVisit, totalSpan: null, progress: null };
  const follow = new Date(followupDate); follow.setHours(0,0,0,0);
  const totalSpan = Math.ceil((follow - visit) / 86400000);
  const elapsed   = Math.ceil((today - visit) / 86400000);
  const progress  = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / totalSpan) * 100))) : 100;
  return { daysSinceVisit, totalSpan, progress };
}

function buildPayload(f, profileId) {
  return {
    account_id:           f.account_id           || null,
    product_id:           f.product_id           || null,
    contact_name:         f.contact_name         || null,
    visit_type:           f.visit_type,
    visit_date:           f.visit_date,
    visit_time:           f.visit_time           || null,
    status:               f.status,
    priority:             f.priority,
    business_unit:        f.business_unit        || null,
    pipeline_stage:       f.pipeline_stage       || null,
    objective:            f.objective            || null,
    notes:                f.notes                || null,
    result:               f.result               || null,
    objection:            f.objection            || null,
    next_step:            f.next_step            || null,
    next_action:          f.next_action          || null,
    next_action_date:     f.next_action_date     || null,
    followup_date:        f.followup_date        || null,
    commercial_potential: Number(f.commercial_potential || 0),
    materials:            f.materials,
    owner_id:             profileId              || null,
    updated_at:           new Date().toISOString(),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   VisitForm — FUERA del componente principal para evitar re-mount
   ══════════════════════════════════════════════════════════════════════ */
function VisitForm({ f, setF, isEdit, onSubmit, onCancel, accounts, products, loading, onToggleMaterial }) {
  return (
    <div className="vf-wrap">

      {/* DATOS PRINCIPALES */}
      <div className="vf-section">
        <span className="vf-section__label">Datos principales</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--wide">
            <label>Cliente *</label>
            <select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} required>
              <option value="">Seleccionar cliente</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Contacto en la visita</label>
            <input
              value={f.contact_name}
              onChange={(e) => setF({ ...f, contact_name: e.target.value })}
              placeholder="Ej: Dr. Ramírez, Jefa de compras"
            />
          </div>
          <div className="vf-field">
            <label>Producto / línea</label>
            <select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              <option value="">Seleccionar producto</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.line}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Unidad de negocio</label>
            <select value={f.business_unit} onChange={(e) => setF({ ...f, business_unit: e.target.value })}>
              <option value="">Seleccionar</option>
              {BUSINESS_UNITS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* FECHA, TIPO Y ESTADO */}
      <div className="vf-section">
        <span className="vf-section__label">Fecha, tipo y estado</span>
        <div className="vf-grid">
          <div className="vf-field">
            <label>Fecha visita</label>
            <input type="date" value={f.visit_date} onChange={(e) => setF({ ...f, visit_date: e.target.value })} />
          </div>
          <div className="vf-field">
            <label>Hora</label>
            <input type="time" value={f.visit_time} onChange={(e) => setF({ ...f, visit_time: e.target.value })} />
          </div>
          <div className="vf-field">
            <label>Tipo de visita</label>
            <select value={f.visit_type} onChange={(e) => setF({ ...f, visit_type: e.target.value })}>
              {VISIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Estado</label>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Prioridad</label>
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Etapa del pipeline</label>
            <select value={f.pipeline_stage} onChange={(e) => setF({ ...f, pipeline_stage: e.target.value })}>
              <option value="">Seleccionar etapa</option>
              {PIPELINE_STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Potencial comercial ARS</label>
            <input
              type="number"
              value={f.commercial_potential}
              onChange={(e) => setF({ ...f, commercial_potential: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* CONTENIDO */}
      <div className="vf-section">
        <span className="vf-section__label">Contenido de la visita</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--full">
            <label>Objetivo de la visita</label>
            <input
              value={f.objective}
              onChange={(e) => setF({ ...f, objective: e.target.value })}
              placeholder="¿Qué querías lograr con esta visita?"
            />
          </div>
          <div className="vf-field vf-field--full">
            <label>Qué se habló / notas</label>
            <textarea
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Resumen de la conversación, interés detectado, contexto comercial..."
            />
          </div>
          <div className="vf-field vf-field--full">
            <label>Resultado concreto</label>
            <textarea
              value={f.result}
              onChange={(e) => setF({ ...f, result: e.target.value })}
              placeholder="¿Qué se acordó? ¿Avanzó? ¿Se solicitó cotización?"
              rows={2}
            />
          </div>
          <div className="vf-field">
            <label>Objeción principal</label>
            <input
              value={f.objection}
              onChange={(e) => setF({ ...f, objection: e.target.value })}
              placeholder="Precio, timing, decisión médica..."
            />
          </div>
          <div className="vf-field vf-field--wide">
            <label>Material enviado</label>
            <div className="vf-materials">
              {["speech","brochure","video","ficha_tecnica"].map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`vf-material-btn ${f.materials.includes(m) ? "active" : ""}`}
                  onClick={() => onToggleMaterial(m)}
                >
                  {MATERIAL_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* PRÓXIMOS PASOS */}
      <div className="vf-section">
        <span className="vf-section__label">Próximos pasos</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--wide">
            <label>Próximo compromiso</label>
            <input
              value={f.next_step}
              onChange={(e) => setF({ ...f, next_step: e.target.value })}
              placeholder="Enviar cotización, coordinar demo..."
            />
          </div>
          <div className="vf-field vf-field--wide">
            <label>Próxima acción concreta</label>
            <input
              value={f.next_action}
              onChange={(e) => setF({ ...f, next_action: e.target.value })}
              placeholder="Llamar al comprador, agendar visita técnica..."
            />
          </div>
          <div className="vf-field">
            <label>Fecha próxima acción</label>
            <input type="date" value={f.next_action_date} onChange={(e) => setF({ ...f, next_action_date: e.target.value })} />
          </div>
          <div className="vf-field">
            <label>Fecha de seguimiento</label>
            <input type="date" value={f.followup_date} onChange={(e) => setF({ ...f, followup_date: e.target.value })} />
          </div>
        </div>
      </div>

      {/* BOTONES */}
      <div className="vf-actions">
        {onCancel && (
          <button type="button" className="vf-btn vf-btn--cancel" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button
          type={isEdit ? "button" : "submit"}
          className="vf-btn vf-btn--save"
          onClick={isEdit ? onSubmit : undefined}
          disabled={loading}
        >
          {loading ? "Guardando..." : isEdit ? "Guardar cambios" : "Guardar visita"}
        </button>
      </div>

    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   VisitsPage — componente principal
   ══════════════════════════════════════════════════════════════════════ */
export default function VisitsPage({ profile, onNavigate }) {
  const [visits, setVisits]         = useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [products, setProducts]     = useState([]);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [loading, setLoading]       = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [editForm, setEditForm]     = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("todas");
  const [activeTab, setActiveTab]   = useState("form");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [vRes, aRes, pRes] = await Promise.all([
      supabase.from("visits").select("*, accounts(name), products(name, line)").order("visit_date", { ascending: false }),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
    ]);
    setVisits(vRes.data || []);
    setAccounts(aRes.data || []);
    setProducts(pRes.data || []);
  }

  function toggleMaterialNew(m) {
    setForm((p) => ({
      ...p,
      materials: p.materials.includes(m) ? p.materials.filter((x) => x !== m) : [...p.materials, m],
    }));
  }

  function toggleMaterialEdit(m) {
    setEditForm((p) => ({
      ...p,
      materials: p.materials.includes(m) ? p.materials.filter((x) => x !== m) : [...p.materials, m],
    }));
  }

  async function saveVisit(e) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("visits").insert([buildPayload(form, profile?.id)]);
    if (error) alert("Error: " + error.message);
    else { setForm(EMPTY_FORM); setActiveTab("history"); await loadData(); }
    setLoading(false);
  }

  function startEdit(v) {
    setEditingId(v.id);
    setEditForm({
      account_id:           v.account_id           || "",
      product_id:           v.product_id           || "",
      contact_name:         v.contact_name         || "",
      visit_type:           v.visit_type           || "presencial",
      visit_date:           v.visit_date?.slice(0, 10) || "",
      visit_time:           v.visit_time           || "",
      status:               v.status               || "programada",
      priority:             v.priority             || "media",
      business_unit:        v.business_unit        || "",
      pipeline_stage:       v.pipeline_stage       || "",
      objective:            v.objective            || "",
      notes:                v.notes                || "",
      result:               v.result               || "",
      objection:            v.objection            || "",
      next_step:            v.next_step            || "",
      next_action:          v.next_action          || "",
      next_action_date:     v.next_action_date     || "",
      followup_date:        v.followup_date        || "",
      commercial_potential: v.commercial_potential || "",
      materials:            v.materials            || [],
    });
  }

  function cancelEdit() { setEditingId(null); setEditForm(null); }

  async function saveEdit(id) {
    setLoading(true);
    const { error } = await supabase.from("visits").update(buildPayload(editForm, profile?.id)).eq("id", id);
    if (error) alert("Error: " + error.message);
    else { setEditingId(null); setEditForm(null); await loadData(); }
    setLoading(false);
  }

  async function deleteVisit(id) {
    if (!confirm("¿Eliminar esta visita?")) return;
    setDeletingId(id);
    const { error } = await supabase.from("visits").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else await loadData();
    setDeletingId(null);
  }

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      total:       visits.length,
      programadas: visits.filter((v) => v.status === "programada").length,
      realizadas:  visits.filter((v) => v.status === "realizada").length,
      pendientes:  visits.filter((v) => v.status === "pendiente_informe").length,
      hoy:         visits.filter((v) => v.visit_date?.slice(0, 10) === today).length,
    };
  }, [visits]);

  const filteredVisits = useMemo(() => {
    if (filterStatus === "todas") return visits;
    return visits.filter((v) => v.status === filterStatus);
  }, [visits, filterStatus]);

  const statusInfo   = (s) => STATUS_OPTIONS.find((x)   => x.value === s) || { label: s,   color: "#94a3b8" };
  const priorityInfo = (p) => PRIORITY_OPTIONS.find((x) => x.value === p) || { label: p,   color: "#94a3b8" };

  return (
    <Layout title="Visitas Comerciales" profile={profile} onNavigate={onNavigate}>
      <div className="visits-page">

        <header className="visits-header">
          <div>
            <p className="visits-header__eyebrow">STORING Medical · CRM</p>
            <h1 className="visits-header__title">Visitas Comerciales</h1>
            <p className="visits-header__sub">Registro completo de visitas, objetivos, resultados y próximas acciones.</p>
          </div>
        </header>

        <section className="visits-kpi-grid">
          <VisitKpi label="Visitas totales"   value={stats.total}       accent="blue"  />
          <VisitKpi label="Programadas"       value={stats.programadas} accent="slate" />
          <VisitKpi label="Realizadas"        value={stats.realizadas}  accent="green" />
          <VisitKpi label="Pendiente informe" value={stats.pendientes}  accent="amber" />
          <VisitKpi label="Hoy"               value={stats.hoy}         accent="blue"  />
        </section>

        <div className="visits-tabs">
          <button className={`visits-tab ${activeTab === "form"    ? "active" : ""}`} onClick={() => setActiveTab("form")}>+ Nueva visita</button>
          <button className={`visits-tab ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>Historial ({visits.length})</button>
        </div>

        {/* ── NUEVA VISITA ── */}
        {activeTab === "form" && (
          <section className="visits-panel">
            <header className="visits-panel__header">
              <h2 className="visits-panel__title">Nueva visita</h2>
              <p className="visits-panel__sub">Completá los datos de la visita, el resultado y la próxima acción.</p>
            </header>
            <form onSubmit={saveVisit}>
              <VisitForm
                f={form}
                setF={setForm}
                isEdit={false}
                accounts={accounts}
                products={products}
                loading={loading}
                onToggleMaterial={toggleMaterialNew}
              />
            </form>
          </section>
        )}

        {/* ── HISTORIAL ── */}
        {activeTab === "history" && (
          <section className="visits-panel">
            <header className="visits-panel__header">
              <h2 className="visits-panel__title">Historial de visitas</h2>
              <div className="visits-filter-tabs">
                {[
                  { key: "todas",             label: `Todas (${visits.length})` },
                  { key: "programada",        label: `Programadas (${stats.programadas})` },
                  { key: "realizada",         label: `Realizadas (${stats.realizadas})` },
                  { key: "pendiente_informe", label: `Pend. informe (${stats.pendientes})` },
                ].map((t) => (
                  <button
                    key={t.key}
                    className={`visits-filter-tab ${filterStatus === t.key ? "active" : ""}`}
                    onClick={() => setFilterStatus(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </header>

            <div className="visits-history">
              {filteredVisits.length === 0 ? (
                <p className="visits-empty">No hay visitas en esta categoría.</p>
              ) : filteredVisits.map((v) => {
                const alert    = getFollowupAlert(v.visit_date, v.followup_date);
                const timeline = getTimelineData(v.visit_date, v.followup_date);
                const si = statusInfo(v.status);
                const pi = priorityInfo(v.priority);

                return (
                  <article
                    className={`visits-item ${alert ? `visits-item--${alert.tone}` : ""}`}
                    key={v.id}
                  >
                    {editingId === v.id ? (
                      <VisitForm
                        f={editForm}
                        setF={setEditForm}
                        isEdit={true}
                        onSubmit={() => saveEdit(v.id)}
                        onCancel={cancelEdit}
                        accounts={accounts}
                        products={products}
                        loading={loading}
                        onToggleMaterial={toggleMaterialEdit}
                      />
                    ) : (
                      <>
                        {alert && (
                          <div className={`visits-alert visits-alert--${alert.tone}`}>
                            <span className="visits-alert__dot" />{alert.label}
                          </div>
                        )}

                        <div className="visits-item__top">
                          <div className="visits-item__avatar">
                            {(v.accounts?.name || "?").slice(0, 1).toUpperCase()}
                          </div>
                          <div className="visits-item__head">
                            <strong>{v.accounts?.name || "Sin cliente"}</strong>
                            <span>
                              {v.contact_name && <em>{v.contact_name} · </em>}
                              {v.products?.name || "Sin producto"} · {VISIT_TYPES.find((t) => t.value === v.visit_type)?.label || v.visit_type}
                              {v.visit_time && ` · ${v.visit_time.slice(0, 5)}`}
                            </span>
                          </div>
                          <div className="visits-item__badges">
                            <span className="visits-badge" style={{ background:`${si.color}15`, color:si.color, borderColor:`${si.color}40` }}>{si.label}</span>
                            <span className="visits-badge" style={{ background:`${pi.color}15`, color:pi.color, borderColor:`${pi.color}40` }}>{pi.label}</span>
                          </div>
                          <div className="visits-item__actions">
                            <button className="visits-action-btn visits-action-btn--edit"   onClick={() => startEdit(v)}     title="Editar">✎</button>
                            <button className="visits-action-btn visits-action-btn--delete" onClick={() => deleteVisit(v.id)} disabled={deletingId === v.id} title="Eliminar">
                              {deletingId === v.id ? "…" : "✕"}
                            </button>
                          </div>
                        </div>

                        <div className="visits-item__meta-row">
                          {v.business_unit         && <span className="visits-meta-chip">🏢 {v.business_unit}</span>}
                          {v.pipeline_stage        && <span className="visits-meta-chip">📊 {v.pipeline_stage}</span>}
                          {v.commercial_potential > 0 && <span className="visits-meta-chip">💰 {money(v.commercial_potential)}</span>}
                          {v.visit_date            && <span className="visits-meta-chip">📅 {new Date(v.visit_date).toLocaleDateString("es-AR")}</span>}
                        </div>

                        {v.objective && (
                          <div className="visits-objective">
                            <span>Objetivo</span>
                            <p>{v.objective}</p>
                          </div>
                        )}

                        {timeline && (
                          <div className="visits-timeline">
                            <div className="visits-timeline__labels">
                              <span>Visita: {v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR") : "—"}</span>
                              {v.followup_date && <span>Seguimiento: {new Date(v.followup_date).toLocaleDateString("es-AR")}</span>}
                            </div>
                            {timeline.totalSpan !== null && (
                              <>
                                <div className="visits-timeline__track">
                                  <div className={`visits-timeline__fill visits-timeline__fill--${alert?.tone || "ok"}`} style={{ width:`${timeline.progress}%` }} />
                                  <div className="visits-timeline__cursor" style={{ left:`${timeline.progress}%` }} />
                                </div>
                                <div className="visits-timeline__info">
                                  <span>{timeline.daysSinceVisit}d desde visita</span>
                                  <span>{timeline.totalSpan}d totales · {timeline.progress}%</span>
                                </div>
                              </>
                            )}
                            {timeline.totalSpan === null && (
                              <div className="visits-timeline__info">
                                <span>{timeline.daysSinceVisit}d desde la visita · Sin seguimiento agendado</span>
                              </div>
                            )}
                          </div>
                        )}

                        {v.notes  && <p className="visits-item__notes">{v.notes}</p>}

                        {v.result && (
                          <div className="visits-result">
                            <span>Resultado</span>
                            <p>{v.result}</p>
                          </div>
                        )}

                        <div className="visits-item__meta">
                          {v.next_action      && <span className="visits-tag">↗ {v.next_action}</span>}
                          {v.next_step        && <span className="visits-tag">📋 {v.next_step}</span>}
                          {v.objection        && <span className="visits-tag visits-tag--red">⚑ {v.objection}</span>}
                          {v.next_action_date && <span className="visits-tag visits-tag--blue">🗓 Acción: {new Date(v.next_action_date).toLocaleDateString("es-AR")}</span>}
                          {(v.materials || []).map((m) => (
                            <span className="visits-tag visits-tag--blue" key={m}>{MATERIAL_LABELS[m] || m}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <footer className="visits-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}

/* ── Sub-components ── */
function VisitKpi({ label, value, accent = "blue" }) {
  return (
    <article className={`visits-kpi visits-kpi--${accent}`}>
      <span className="visits-kpi__label">{label}</span>
      <strong className="visits-kpi__value">{value}</strong>
    </article>
  );
}