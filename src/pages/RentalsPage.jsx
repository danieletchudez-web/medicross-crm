import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./rentals.css";

const STATUSES = [
  "solicitud","cotizacion","aprobado","reservado","entregado",
  "en_procedimiento","retirado","facturado","cerrado","cancelado",
];

const STATUS_LABELS = {
  solicitud:         "Solicitud",
  cotizacion:        "Cotización",
  aprobado:          "Aprobado",
  reservado:         "Reservado",
  entregado:         "Entregado",
  en_procedimiento:  "En procedimiento",
  retirado:          "Retirado",
  facturado:         "Facturado",
  cerrado:           "Cerrado",
  cancelado:         "Cancelado",
};

const STATUS_FLOW = [
  "solicitud","cotizacion","aprobado","reservado",
  "entregado","en_procedimiento","retirado","facturado","cerrado",
];

const NEXT_STATUS = {
  solicitud:        "cotizacion",
  cotizacion:       "aprobado",
  aprobado:         "reservado",
  reservado:        "entregado",
  entregado:        "en_procedimiento",
  en_procedimiento: "retirado",
  retirado:         "facturado",
  facturado:        "cerrado",
};

const EMPTY_FORM = {
  id: null,
  equipment_id: "",
  account_id: "",
  opportunity_id: "",
  doctor_name: "",
  institution: "",
  procedure_name: "",
  status: "solicitud",
  delivery_date: "",
  procedure_date: "",
  retrieval_date: "",
  base_amount: "",
  consumables_amount: "",
  logistics_amount: "",
  instrumentation_amount: "",
  other_amount: "",
  cost_amount: "",
  notes: "",
  internal_notes: "",
};

function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}

function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)} K`;
  return money(n);
}

function fDate(v) {
  if (!v) return "—";
  const [y, m, d] = String(v).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function totalAmount(form) {
  return ["base_amount","consumables_amount","logistics_amount","instrumentation_amount","other_amount"]
    .reduce((s, k) => s + Number(form[k] || 0), 0);
}

function marginPct(form) {
  const total = totalAmount(form);
  const cost = Number(form.cost_amount || 0);
  if (!total || !cost) return 0;
  return Math.round(((total - cost) / total) * 100);
}

function getMarginClass(pct) {
  if (pct >= 45) return "";
  if (pct >= 30) return "ren-margin-preview__fill--warn";
  return "ren-margin-preview__fill--bad";
}

export default function RentalsPage({ profile, onNavigate, navigationData, pageKey }) {
  const [rentals, setRentals]       = useState([]);
  const [equipment, setEquipment]   = useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [opportunities, setOpps]    = useState([]);
  const [loading, setLoading]       = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [showForm, setShowForm]     = useState(false);
  const [selected, setSelected]     = useState(null);
  const [view, setView]             = useState("tabla");
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [filterEquipment, setFilterEquipment] = useState("todos");
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);
  const [ganttOffset, setGanttOffset] = useState(0);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (navigationData?.action === "create") {
      setForm(f => ({
        ...f,
        account_id: navigationData.accountId || "",
        opportunity_id: navigationData.opportunityId || "",
        equipment_id: navigationData.equipmentId || "",
      }));
      setShowForm(true);
    }
    if (navigationData?.equipmentId && !navigationData?.action) {
      setFilterEquipment(navigationData.equipmentId);
    }
  }, [navigationData]);

  async function loadData() {
    setLoading(true);
    const [renRes, eqRes, accRes, oppRes] = await Promise.all([
      supabase.from("equipment_rentals")
        .select("*, equipment(name, brand, category), accounts(name)")
        .order("created_at", { ascending: false }),
      supabase.from("equipment").select("id, name, brand, category, status").order("name"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("opportunities").select("id, name, account_id").order("name"),
    ]);
    setRentals(renRes.data || []);
    setEquipment(eqRes.data || []);
    setAccounts(accRes.data || []);
    setOpps(oppRes.data || []);
    setLoading(false);
  }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }

  async function generateRentalNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase
      .from("equipment_rentals")
      .select("id", { count: "exact", head: true });
    return `ALQ-${year}-${String((count || 0) + 1).padStart(3, "0")}`;
  }

  async function handleSave() {
    if (!form.equipment_id || !form.procedure_date) return;
    setSaving(true);
    const total = totalAmount(form);
    const margin = marginPct(form);
    const payload = {
      equipment_id: form.equipment_id,
      account_id: form.account_id || null,
      opportunity_id: form.opportunity_id || null,
      doctor_name: form.doctor_name,
      institution: form.institution,
      procedure_name: form.procedure_name,
      status: form.status,
      delivery_date: form.delivery_date || null,
      procedure_date: form.procedure_date || null,
      retrieval_date: form.retrieval_date || null,
      base_amount: Number(form.base_amount || 0),
      consumables_amount: Number(form.consumables_amount || 0),
      logistics_amount: Number(form.logistics_amount || 0),
      instrumentation_amount: Number(form.instrumentation_amount || 0),
      other_amount: Number(form.other_amount || 0),
      total_amount: total,
      cost_amount: Number(form.cost_amount || 0),
      profit_margin: margin,
      seller_id: profile?.id || null,
      notes: form.notes,
      internal_notes: form.internal_notes,
      updated_at: new Date().toISOString(),
    };
    if (form.id) {
      await supabase.from("equipment_rentals").update(payload).eq("id", form.id);
      showToast("Alquiler actualizado");
    } else {
      payload.rental_number = await generateRentalNumber();
      payload.request_date = new Date().toISOString().slice(0, 10);
      payload.created_at = new Date().toISOString();
      await supabase.from("equipment_rentals").insert(payload);
      showToast("Alquiler creado");
    }
    setSaving(false);
    setShowForm(false);
    loadData();
  }

  async function handleAdvanceStatus(rental) {
    const next = NEXT_STATUS[rental.status];
    if (!next) return;
    await supabase.from("equipment_rentals")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", rental.id);

    // Actualizar estado del equipo según transiciones clave
    if (next === "reservado") {
      await supabase.from("equipment").update({ status: "reservado" }).eq("id", rental.equipment_id);
      await createCalendarEvents(rental);
    }
    if (next === "en_procedimiento") {
      await supabase.from("equipment").update({ status: "en_cirugia" }).eq("id", rental.equipment_id);
    }
    if (next === "retirado") {
      await supabase.from("equipment").update({
        status: "disponible",
        next_available_date: null,
        updated_at: new Date().toISOString(),
      }).eq("id", rental.equipment_id);
    }
    showToast(`Estado: ${STATUS_LABELS[next]}`);
    setSelected(prev => prev ? { ...prev, status: next } : null);
    loadData();
  }

  async function createCalendarEvents(rental) {
    const events = [];
    if (rental.delivery_date) {
      events.push({
        rental_id: rental.id, equipment_id: rental.equipment_id,
        event_type: "entrega", event_date: rental.delivery_date,
        title: `Entrega — ${rental.equipment?.name || "Equipo"}`,
        description: rental.institution, color: "#10b981",
      });
    }
    if (rental.procedure_date) {
      events.push({
        rental_id: rental.id, equipment_id: rental.equipment_id,
        event_type: "procedimiento", event_date: rental.procedure_date,
        title: `Procedimiento — ${rental.doctor_name || ""}`,
        description: `${rental.procedure_name || ""} · ${rental.institution || ""}`,
        color: "#f97316",
      });
    }
    if (rental.retrieval_date) {
      events.push({
        rental_id: rental.id, equipment_id: rental.equipment_id,
        event_type: "retiro", event_date: rental.retrieval_date,
        title: `Retiro — ${rental.equipment?.name || "Equipo"}`,
        description: rental.institution, color: "#8b5cf6",
      });
    }
    if (events.length) {
      await supabase.from("equipment_calendar_events").insert(events);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(rental) {
    setForm({
      ...EMPTY_FORM,
      ...rental,
      base_amount: rental.base_amount || "",
      consumables_amount: rental.consumables_amount || "",
      logistics_amount: rental.logistics_amount || "",
      instrumentation_amount: rental.instrumentation_amount || "",
      other_amount: rental.other_amount || "",
      cost_amount: rental.cost_amount || "",
    });
    setShowForm(true);
  }

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return rentals.filter(r => {
      if (filterStatus !== "todos" && r.status !== filterStatus) return false;
      if (filterEquipment !== "todos" && r.equipment_id !== filterEquipment) return false;
      if (q && !`${r.rental_number} ${r.doctor_name} ${r.institution} ${r.procedure_name} ${r.equipment?.name} ${r.accounts?.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rentals, filterStatus, filterEquipment, searchText]);

  const kpis = useMemo(() => {
    const active = rentals.filter(r => !["cerrado","cancelado"].includes(r.status));
    const billed = rentals.filter(r => ["facturado","cerrado"].includes(r.status));
    const totalBilled = billed.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const avgMargin = active.length
      ? Math.round(active.reduce((s, r) => s + Number(r.profit_margin || 0), 0) / active.length)
      : 0;
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = rentals.filter(r =>
      r.delivery_date === today || r.procedure_date === today || r.retrieval_date === today
    );
    return { active: active.length, totalBilled, avgMargin, todayEvents: todayEvents.length, total: rentals.length };
  }, [rentals]);

  // Gantt — 14 días desde hoy - ganttOffset
  const ganttDays = useMemo(() => {
    const days = [];
    const base = new Date();
    base.setDate(base.getDate() - ganttOffset);
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }, [ganttOffset]);

  const ganttEquipment = useMemo(() => {
    return equipment.map(eq => ({
      ...eq,
      blocks: rentals.filter(r =>
        r.equipment_id === eq.id &&
        !["cerrado","cancelado"].includes(r.status) &&
        (r.delivery_date || r.procedure_date)
      ),
    }));
  }, [equipment, rentals]);

  // Devuelve true si el equipo tiene un alquiler activo que solapa con la fecha pedida
  function hasDateConflict(equipmentId, procedureDate, excludeRentalId = null) {
    if (!procedureDate || !equipmentId) return false;
    return rentals.some(r => {
      if (r.equipment_id !== equipmentId) return false;
      if (r.id === excludeRentalId) return false;
      if (["cerrado","cancelado"].includes(r.status)) return false;
      const from = r.delivery_date || r.procedure_date;
      const to   = r.retrieval_date || r.procedure_date;
      if (!from || !to) return false;
      return procedureDate >= from && procedureDate <= to;
    });
  }

  // Clasifica cada equipo para el formulario
  function equipmentAvailability(eq) {
    if (["fuera_de_servicio","en_mantenimiento"].includes(eq.status)) {
      return { disabled: true, label: `(${eq.status.replace("_"," ")})`, tag: "blocked" };
    }
    const conflict = hasDateConflict(eq.id, form.procedure_date, form.id);
    if (conflict) {
      return { disabled: false, label: "⚠ Conflicto de fecha", tag: "conflict" };
    }
    return { disabled: false, label: "✓ Disponible", tag: "ok" };
  }

  return (
    <Layout title="Alquileres" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="ren-page">

        {toast && (
          <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 2000,
            background: toast.type === "ok" ? "#0f172a" : "#ef4444",
            color: "#fff", padding: "12px 20px", borderRadius: 12,
            fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          }}>{toast.msg}</div>
        )}

        {/* KPIs */}
        <div className="ren-kpis">
          <div className="ren-kpi">
            <span className="ren-kpi__label">Alquileres activos</span>
            <strong className="ren-kpi__value ren-kpi__value--blue">{kpis.active}</strong>
            <span className="ren-kpi__sub">en curso</span>
          </div>
          <div className="ren-kpi">
            <span className="ren-kpi__label">Facturado (total)</span>
            <strong className="ren-kpi__value">{compactMoney(kpis.totalBilled)}</strong>
            <span className="ren-kpi__sub">facturado + cerrado</span>
          </div>
          <div className="ren-kpi">
            <span className="ren-kpi__label">Margen promedio</span>
            <strong className="ren-kpi__value ren-kpi__value--green">{kpis.avgMargin}%</strong>
            <span className="ren-kpi__sub">activos</span>
          </div>
          <div className="ren-kpi">
            <span className="ren-kpi__label">Eventos hoy</span>
            <strong className="ren-kpi__value ren-kpi__value--orange">{kpis.todayEvents}</strong>
            <span className="ren-kpi__sub">entregas / procedimientos / retiros</span>
          </div>
          <div className="ren-kpi">
            <span className="ren-kpi__label">Total histórico</span>
            <strong className="ren-kpi__value">{kpis.total}</strong>
            <span className="ren-kpi__sub">alquileres registrados</span>
          </div>
        </div>

        {/* Panel principal */}
        <div className="ren-panel">
          <div className="ren-panel-head">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <h2>Alquileres ({filtered.length})</h2>
              <div className="ren-view-toggle">
                <button className={view === "tabla" ? "active" : ""} onClick={() => setView("tabla")}>Tabla</button>
                <button className={view === "timeline" ? "active" : ""} onClick={() => setView("timeline")}>Timeline</button>
              </div>
            </div>
            <button className="ren-btn-primary" onClick={openCreate}>+ Nuevo alquiler</button>
          </div>

          <div className="ren-filters">
            <input
              className="ren-search"
              placeholder="Buscar número, médico, institución…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            <select className="ren-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="todos">Todos los estados</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select className="ren-select" value={filterEquipment} onChange={e => setFilterEquipment(e.target.value)}>
              <option value="todos">Todos los equipos</option>
              {equipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {/* Vista tabla */}
          {view === "tabla" && (
            loading ? (
              <div className="ren-empty"><p>Cargando…</p></div>
            ) : filtered.length === 0 ? (
              <div className="ren-empty">
                <strong>Sin alquileres</strong>
                <p>Creá el primer alquiler para comenzar.</p>
              </div>
            ) : (
              <div className="ren-table-wrap">
                <table className="ren-table">
                  <thead>
                    <tr>
                      <th>N° Alquiler</th>
                      <th>Equipo</th>
                      <th>Médico / Institución</th>
                      <th>Fechas</th>
                      <th>Total</th>
                      <th>Margen</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const margin = Number(r.profit_margin || 0);
                      const marginClass = margin >= 45 ? "" : margin >= 30 ? "ren-margin-bar__fill--warn" : "ren-margin-bar__fill--bad";
                      return (
                        <tr key={r.id} onClick={() => setSelected(r)}>
                          <td><span className="ren-table__num">{r.rental_number || "—"}</span></td>
                          <td>
                            <div className="ren-table__name">{r.equipment?.name || "—"}</div>
                            <div className="ren-table__sub">{r.equipment?.brand || ""}</div>
                          </td>
                          <td>
                            <div className="ren-table__name">{r.doctor_name || "—"}</div>
                            <div className="ren-table__sub">{r.institution}</div>
                          </td>
                          <td>
                            <div style={{ fontSize: 12 }}>
                              {r.delivery_date && <div>📦 {fDate(r.delivery_date)}</div>}
                              {r.procedure_date && <div>🏥 {fDate(r.procedure_date)}</div>}
                            </div>
                          </td>
                          <td style={{ fontWeight: 700 }}>{money(r.total_amount)}</td>
                          <td>
                            <div className="ren-margin-bar">
                              <div className="ren-margin-bar__track">
                                <div className={`ren-margin-bar__fill ${marginClass}`} style={{ width: `${Math.min(margin, 100)}%` }} />
                              </div>
                              <span style={{ color: margin >= 45 ? "#10b981" : margin >= 30 ? "#f97316" : "#ef4444" }}>
                                {margin}%
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`ren-badge ren-badge--${r.status}`}>
                              <span className="ren-badge-dot" />
                              {STATUS_LABELS[r.status]}
                            </span>
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <button className="ren-btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => openEdit(r)}>
                              Editar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Vista timeline / Gantt */}
          {view === "timeline" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                <button className="ren-btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setGanttOffset(o => o + 7)}>← Anterior</button>
                <button className="ren-btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setGanttOffset(0)}>Hoy</button>
                <button className="ren-btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setGanttOffset(o => Math.max(0, o - 7))}>Siguiente →</button>
              </div>
              <div className="ren-legend">
                {[
                  { label: "Entrega", color: "#10b981" },
                  { label: "Procedimiento", color: "#f97316" },
                  { label: "Retiro", color: "#8b5cf6" },
                  { label: "Reservado", color: "#3b82f6" },
                ].map(l => (
                  <div key={l.label} className="ren-legend-item">
                    <div className="ren-legend-dot" style={{ background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
              <div className="ren-timeline" style={{ marginTop: 10 }}>
                <div className="ren-gantt">
                  {/* Header días */}
                  <div className="ren-gantt-header" style={{ gridTemplateColumns: `160px repeat(${ganttDays.length}, 1fr)` }}>
                    <div style={{ padding: "0 14px" }}>Equipo</div>
                    {ganttDays.map(d => {
                      const dt = new Date(d + "T00:00:00");
                      return (
                        <div key={d} style={{ textAlign: "center", fontSize: 10 }}>
                          <div>{["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][dt.getDay()]}</div>
                          <div>{dt.getDate()}/{dt.getMonth() + 1}</div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Filas por equipo */}
                  {ganttEquipment.map(eq => (
                    <div key={eq.id} className="ren-gantt-row" style={{ gridTemplateColumns: `160px repeat(${ganttDays.length}, 1fr)` }}>
                      <div className="ren-gantt-label">
                        {eq.name}
                        <div className="ren-gantt-label__sub">{eq.brand}</div>
                      </div>
                      {ganttDays.map(day => {
                        const dayRentals = eq.blocks.filter(r =>
                          r.delivery_date === day || r.procedure_date === day || r.retrieval_date === day
                        );
                        const today = new Date().toISOString().slice(0, 10);
                        return (
                          <div key={day} style={{
                            background: day === today ? "rgba(91,124,250,0.05)" : undefined,
                            borderLeft: day === today ? "2px solid #5b7cfa" : "1px solid #f1f5f9",
                            display: "flex", flexDirection: "column", gap: 2, padding: "4px 2px",
                          }}>
                            {dayRentals.map(r => {
                              const isDelivery = r.delivery_date === day;
                              const isProc = r.procedure_date === day;
                              const isRetrieval = r.retrieval_date === day;
                              const color = isProc ? "#f97316" : isDelivery ? "#10b981" : "#8b5cf6";
                              return (
                                <div
                                  key={r.id}
                                  onClick={() => setSelected(r)}
                                  style={{
                                    background: color, color: "#fff", borderRadius: 4,
                                    padding: "2px 4px", fontSize: 9, fontWeight: 700,
                                    cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={`${STATUS_LABELS[r.status]} — ${r.doctor_name || r.institution}`}
                                >
                                  {isDelivery ? "📦" : isProc ? "🏥" : "📤"} {r.doctor_name || r.institution || r.rental_number}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal nuevo/editar alquiler */}
        {showForm && (
          <div className="ren-modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <div className="ren-modal">
              <div className="ren-modal-head">
                <h3>{form.id ? "Editar alquiler" : "Nuevo alquiler"}</h3>
                <button className="ren-modal-close" onClick={() => setShowForm(false)}>×</button>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Vinculación</div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Cliente *</label>
                    <select value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
                      <option value="">Seleccionar cliente…</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className="ren-field">
                    <label>Oportunidad</label>
                    <select value={form.opportunity_id} onChange={e => setForm(f => ({ ...f, opportunity_id: e.target.value }))}>
                      <option value="">Sin oportunidad</option>
                      {opportunities.filter(o => !form.account_id || o.account_id === form.account_id).map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Equipo</div>
                <div className="ren-field ren-field--full">
                  <label>Equipo a alquilar *</label>
                  <select value={form.equipment_id} onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))}>
                    <option value="">Seleccionar equipo…</option>
                    {equipment.map(e => {
                      const avail = equipmentAvailability(e);
                      return (
                        <option key={e.id} value={e.id} disabled={avail.disabled}>
                          {e.name} — {e.brand} · {avail.label}
                        </option>
                      );
                    })}
                  </select>
                  {form.equipment_id && equipmentAvailability(equipment.find(e => e.id === form.equipment_id) || {}).tag === "conflict" && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#c2410c", fontWeight: 600 }}>
                      ⚠ Este equipo tiene otro alquiler solapado en esa fecha. Podés reservarlo igual — se verá como conflicto en el calendario.
                    </p>
                  )}
                </div>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Médico y procedimiento</div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Médico</label>
                    <input value={form.doctor_name} onChange={e => setForm(f => ({ ...f, doctor_name: e.target.value }))} placeholder="Dr. Nombre Apellido" />
                  </div>
                  <div className="ren-field">
                    <label>Institución</label>
                    <input value={form.institution} onChange={e => setForm(f => ({ ...f, institution: e.target.value }))} placeholder="Hospital Italiano" />
                  </div>
                </div>
                <div className="ren-field ren-field--full">
                  <label>Procedimiento</label>
                  <input value={form.procedure_name} onChange={e => setForm(f => ({ ...f, procedure_name: e.target.value }))} placeholder="Ablación renal EchoLaser" />
                </div>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Fechas</div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Entrega 📦</label>
                    <input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} />
                  </div>
                  <div className="ren-field">
                    <label>Procedimiento 🏥 *</label>
                    <input type="date" value={form.procedure_date} onChange={e => setForm(f => ({ ...f, procedure_date: e.target.value }))} />
                  </div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Retiro 📤</label>
                    <input type="date" value={form.retrieval_date} onChange={e => setForm(f => ({ ...f, retrieval_date: e.target.value }))} />
                  </div>
                  <div className="ren-field">
                    <label>Estado</label>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Montos</div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Alquiler equipo $</label>
                    <input type="number" value={form.base_amount} onChange={e => setForm(f => ({ ...f, base_amount: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="ren-field">
                    <label>Consumibles $</label>
                    <input type="number" value={form.consumables_amount} onChange={e => setForm(f => ({ ...f, consumables_amount: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Logística $</label>
                    <input type="number" value={form.logistics_amount} onChange={e => setForm(f => ({ ...f, logistics_amount: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="ren-field">
                    <label>Instrumentación $</label>
                    <input type="number" value={form.instrumentation_amount} onChange={e => setForm(f => ({ ...f, instrumentation_amount: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Otros $</label>
                    <input type="number" value={form.other_amount} onChange={e => setForm(f => ({ ...f, other_amount: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="ren-field">
                    <label>Costo real $</label>
                    <input type="number" value={form.cost_amount} onChange={e => setForm(f => ({ ...f, cost_amount: e.target.value }))} placeholder="0" />
                  </div>
                </div>

                {/* Resumen */}
                <div className="ren-amounts-summary">
                  {[
                    ["Alquiler", form.base_amount],
                    ["Consumibles", form.consumables_amount],
                    ["Logística", form.logistics_amount],
                    ["Instrumentación", form.instrumentation_amount],
                    ["Otros", form.other_amount],
                  ].filter(([, v]) => Number(v) > 0).map(([label, v]) => (
                    <div key={label} className="ren-amounts-row">
                      <span className="ren-amounts-row__label">{label}</span>
                      <span className="ren-amounts-row__value">{money(v)}</span>
                    </div>
                  ))}
                  <div className="ren-amounts-row ren-amounts-total">
                    <span className="ren-amounts-row__label">TOTAL</span>
                    <span className="ren-amounts-row__value">{money(totalAmount(form))}</span>
                  </div>
                  {Number(form.cost_amount) > 0 && (
                    <div className="ren-margin-preview">
                      <span style={{ fontSize: 12, color: "#64748b" }}>Margen:</span>
                      <div className="ren-margin-preview__track">
                        <div
                          className={`ren-margin-preview__fill ${getMarginClass(marginPct(form))}`}
                          style={{ width: `${Math.min(marginPct(form), 100)}%` }}
                        />
                      </div>
                      <span className="ren-margin-preview__label">{marginPct(form)}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Notas</div>
                <div className="ren-field ren-field--full">
                  <label>Notas al cliente</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Condiciones especiales, requerimientos…" />
                </div>
                <div className="ren-field ren-field--full">
                  <label>Notas internas</label>
                  <textarea value={form.internal_notes} onChange={e => setForm(f => ({ ...f, internal_notes: e.target.value }))} placeholder="Instrucciones logísticas, responsables…" />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8, borderTop: "1px solid #e8ecf2" }}>
                <button className="ren-btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="ren-btn-primary" onClick={handleSave} disabled={saving || !form.equipment_id || !form.procedure_date}>
                  {saving ? "Guardando…" : form.id ? "Guardar cambios" : "Crear alquiler"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Panel detalle lateral */}
        {selected && (
          <div className="ren-detail-overlay" onClick={e => e.target === e.currentTarget && setSelected(null)}>
            <div className="ren-detail">
              <div className="ren-detail-head">
                <div>
                  <h3>{selected.rental_number || "Sin número"} — {selected.equipment?.name}</h3>
                  <span className={`ren-badge ren-badge--${selected.status}`}>
                    <span className="ren-badge-dot" />
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <button className="ren-modal-close" onClick={() => setSelected(null)}>×</button>
              </div>

              <div className="ren-detail-body">
                {/* Flujo */}
                <div className="ren-detail-section">
                  <div className="ren-detail-section-title">Flujo operativo</div>
                  <div className="ren-flow">
                    {STATUS_FLOW.map((s, i) => {
                      const currentIdx = STATUS_FLOW.indexOf(selected.status);
                      const isDone = i < currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <div key={s} className={`ren-flow-step ${isDone ? "ren-flow-step--done" : ""} ${isCurrent ? "ren-flow-step--current" : ""}`}>
                          <div className="ren-flow-dot">{isDone ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg> : null}</div>
                          <span className="ren-flow-label">{STATUS_LABELS[s]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="ren-detail-section">
                  <div className="ren-detail-section-title">Médico / Institución</div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">Médico</span><span className="ren-detail-row__value">{selected.doctor_name || "—"}</span></div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">Institución</span><span className="ren-detail-row__value">{selected.institution || "—"}</span></div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">Procedimiento</span><span className="ren-detail-row__value">{selected.procedure_name || "—"}</span></div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">Cliente</span><span className="ren-detail-row__value">{selected.accounts?.name || "—"}</span></div>
                </div>

                <div className="ren-detail-section">
                  <div className="ren-detail-section-title">Fechas</div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">📦 Entrega</span><span className="ren-detail-row__value">{fDate(selected.delivery_date)}</span></div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">🏥 Procedimiento</span><span className="ren-detail-row__value">{fDate(selected.procedure_date)}</span></div>
                  <div className="ren-detail-row"><span className="ren-detail-row__label">📤 Retiro</span><span className="ren-detail-row__value">{fDate(selected.retrieval_date)}</span></div>
                </div>

                <div className="ren-detail-section">
                  <div className="ren-detail-section-title">Montos</div>
                  {[
                    ["Alquiler equipo", selected.base_amount],
                    ["Consumibles", selected.consumables_amount],
                    ["Logística", selected.logistics_amount],
                    ["Instrumentación", selected.instrumentation_amount],
                    ["Otros", selected.other_amount],
                  ].map(([label, v]) => Number(v) > 0 && (
                    <div key={label} className="ren-detail-row">
                      <span className="ren-detail-row__label">{label}</span>
                      <span className="ren-detail-row__value">{money(v)}</span>
                    </div>
                  ))}
                  <div className="ren-detail-row" style={{ borderTop: "1px solid #e8ecf2", paddingTop: 6, marginTop: 2 }}>
                    <span className="ren-detail-row__label" style={{ fontWeight: 700 }}>TOTAL</span>
                    <span className="ren-detail-row__value" style={{ fontSize: 15, color: "#5b7cfa" }}>{money(selected.total_amount)}</span>
                  </div>
                  <div className="ren-detail-row">
                    <span className="ren-detail-row__label">Margen</span>
                    <span className="ren-detail-row__value" style={{ color: Number(selected.profit_margin) >= 45 ? "#10b981" : "#f97316" }}>
                      {selected.profit_margin}%
                    </span>
                  </div>
                </div>

                {selected.notes && (
                  <div className="ren-detail-section">
                    <div className="ren-detail-section-title">Notas</div>
                    <p style={{ fontSize: 13, color: "#334155", margin: 0 }}>{selected.notes}</p>
                  </div>
                )}
              </div>

              <div className="ren-detail-footer">
                {NEXT_STATUS[selected.status] && (
                  <button className="ren-btn-success" onClick={() => handleAdvanceStatus(selected)}>
                    Avanzar → {STATUS_LABELS[NEXT_STATUS[selected.status]]}
                  </button>
                )}
                <button className="ren-btn-ghost" onClick={() => { openEdit(selected); setSelected(null); }}>
                  Editar alquiler
                </button>
                {selected.opportunity_id && (
                  <button className="ren-btn-ghost" onClick={() => onNavigate("opportunities", { navigationData: { id: selected.opportunity_id } })}>
                    Ver oportunidad
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
