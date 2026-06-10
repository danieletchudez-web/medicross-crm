import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./equipment.css";

const ESTADOS = [
  "disponible",
  "reservado",
  "en_cirugia",
  "en_traslado",
  "en_mantenimiento",
  "fuera_de_servicio",
];

const ESTADO_LABELS = {
  disponible:         "Disponible",
  reservado:          "Reservado",
  en_cirugia:         "En cirugía",
  en_traslado:        "En traslado",
  en_mantenimiento:   "En mantenimiento",
  fuera_de_servicio:  "Fuera de servicio",
};

const ESTADO_COLORS = {
  disponible:         { bg: "#d1fae5", text: "#065f46" },
  reservado:          { bg: "#dbeafe", text: "#1e3a8a" },
  en_cirugia:         { bg: "#ffedd5", text: "#9a3412" },
  en_traslado:        { bg: "#ede9fe", text: "#4c1d95" },
  en_mantenimiento:   { bg: "#fee2e2", text: "#7f1d1d" },
  fuera_de_servicio:  { bg: "#f1f5f9", text: "#475569" },
};

const CATEGORIAS = ["EchoLaser", "Ecógrafo", "Láser Quirúrgico", "Fusión Imagen", "Instrumental", "Otro"];

const EMPTY_FORM = {
  id: null,
  name: "",
  brand: "",
  model: "",
  serial_number: "",
  category: "",
  status: "disponible",
  location: "",
  notes: "",
  daily_rate: "",
  purchase_date: "",
  last_maintenance_date: "",
  next_maintenance_date: "",
};

function fDate(value) {
  if (!value) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

export default function EquipmentPage({ profile, onNavigate, pageKey }) {
  const [equipment, setEquipment]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [showForm, setShowForm]     = useState(false);
  const [selected, setSelected]     = useState(null);
  const [rentalHistory, setRentalHistory] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [filterCat, setFilterCat]   = useState("todas");
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);
  const [formError, setFormError]   = useState("");
  const modalRef                    = useRef(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (showForm && modalRef.current) modalRef.current.scrollTop = 0;
  }, [showForm]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from("equipment")
      .select("*")
      .order("name");
    setEquipment(data || []);
    setLoading(false);
  }

  async function loadHistory(equipmentId) {
    const { data } = await supabase
      .from("equipment_rentals")
      .select("rental_number, procedure_date, doctor_name, institution, status, total_amount")
      .eq("equipment_id", equipmentId)
      .order("procedure_date", { ascending: false })
      .limit(8);
    setRentalHistory(data || []);
  }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(eq) {
    setForm({ ...EMPTY_FORM, ...eq });
    setFormError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError("El nombre del equipo es obligatorio.");
      return;
    }
    setFormError("");
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      brand: form.brand,
      model: form.model,
      serial_number: form.serial_number || null,
      category: form.category,
      status: form.status,
      location: form.location,
      notes: form.notes,
      daily_rate: form.daily_rate ? Number(form.daily_rate) : null,
      purchase_date: form.purchase_date || null,
      last_maintenance_date: form.last_maintenance_date || null,
      next_maintenance_date: form.next_maintenance_date || null,
      updated_at: new Date().toISOString(),
    };
    if (form.id) {
      await supabase.from("equipment").update(payload).eq("id", form.id);
      showToast("Equipo actualizado");
    } else {
      payload.created_at = new Date().toISOString();
      await supabase.from("equipment").insert(payload);
      showToast("Equipo creado");
    }
    setSaving(false);
    setShowForm(false);
    loadData();
  }

  async function handleStatusChange(equipmentId, newStatus) {
    await supabase
      .from("equipment")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", equipmentId);
    setEquipment(prev => prev.map(e => e.id === equipmentId ? { ...e, status: newStatus } : e));
    if (selected?.id === equipmentId) setSelected(prev => ({ ...prev, status: newStatus }));
    showToast(`Estado actualizado: ${ESTADO_LABELS[newStatus]}`);
  }

  function handleSelect(eq) {
    setSelected(eq);
    loadHistory(eq.id);
  }

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return equipment.filter(e => {
      if (filterStatus !== "todos" && e.status !== filterStatus) return false;
      if (filterCat !== "todas" && e.category !== filterCat) return false;
      if (q && !`${e.name} ${e.brand} ${e.model} ${e.serial_number} ${e.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [equipment, filterStatus, filterCat, searchText]);

  const kpis = useMemo(() => {
    const counts = {};
    ESTADOS.forEach(s => { counts[s] = equipment.filter(e => e.status === s).length; });
    const maintSoon = equipment.filter(e => {
      const d = daysDiff(e.next_maintenance_date);
      return d !== null && d >= 0 && d <= 30;
    });
    return { ...counts, total: equipment.length, maintSoon };
  }, [equipment]);

  return (
    <Layout title="Equipamientos" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="eq-page">

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 2000,
            background: toast.type === "ok" ? "#0f172a" : "#ef4444",
            color: "#fff", padding: "12px 20px", borderRadius: 12,
            fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            animation: "eq-fade-in 0.2s ease",
          }}>{toast.msg}</div>
        )}

        {/* KPIs */}
        <div className="eq-kpis">
          <div className="eq-kpi">
            <span className="eq-kpi__label">Total</span>
            <strong className="eq-kpi__value">{kpis.total}</strong>
            <span className="eq-kpi__sub">equipos registrados</span>
          </div>
          <div className="eq-kpi">
            <span className="eq-kpi__label">Disponibles</span>
            <strong className="eq-kpi__value eq-kpi__value--green">{kpis.disponible || 0}</strong>
            <span className="eq-kpi__sub">listos para uso</span>
          </div>
          <div className="eq-kpi">
            <span className="eq-kpi__label">Reservados</span>
            <strong className="eq-kpi__value eq-kpi__value--blue">{kpis.reservado || 0}</strong>
            <span className="eq-kpi__sub">con reserva activa</span>
          </div>
          <div className="eq-kpi">
            <span className="eq-kpi__label">En cirugía</span>
            <strong className="eq-kpi__value eq-kpi__value--orange">{kpis.en_cirugia || 0}</strong>
            <span className="eq-kpi__sub">en uso ahora</span>
          </div>
          <div className="eq-kpi">
            <span className="eq-kpi__label">Mantenimiento</span>
            <strong className="eq-kpi__value eq-kpi__value--red">{kpis.en_mantenimiento || 0}</strong>
            <span className="eq-kpi__sub">fuera de línea</span>
          </div>
          <div className="eq-kpi">
            <span className="eq-kpi__label">Próx. manten.</span>
            <strong className="eq-kpi__value eq-kpi__value--orange">{kpis.maintSoon.length}</strong>
            <span className="eq-kpi__sub">en los próx. 30 días</span>
          </div>
        </div>

        {/* Alerta mantenimiento */}
        {kpis.maintSoon.length > 0 && (
          <div className="eq-maint-alert">
            <span className="eq-maint-alert__icon">⚠️</span>
            <div className="eq-maint-alert__body">
              <div className="eq-maint-alert__title">Equipos con mantenimiento próximo</div>
              <ul className="eq-maint-alert__list">
                {kpis.maintSoon.map(e => (
                  <li key={e.id} className="eq-maint-alert__item">
                    {e.name} — {e.brand} — Vence: {fDate(e.next_maintenance_date)}
                    {" "}({daysDiff(e.next_maintenance_date)} días)
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Panel tabla */}
        <div className="eq-panel">
          <div className="eq-panel-head">
            <h2>Catálogo de Equipos ({filtered.length})</h2>
            <div className="eq-filters">
              <input
                className="eq-search"
                placeholder="Buscar equipo, serie, marca…"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
              <select className="eq-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="todos">Todos los estados</option>
                {ESTADOS.map(s => <option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
              </select>
              <select className="eq-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="todas">Todas las categorías</option>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="eq-btn-primary" onClick={openCreate}>+ Nuevo equipo</button>
            </div>
          </div>

          {loading ? (
            <div className="eq-empty"><p>Cargando equipos…</p></div>
          ) : filtered.length === 0 ? (
            <div className="eq-empty">
              <strong>Sin equipos</strong>
              <p>Agregá el primer equipo para comenzar.</p>
            </div>
          ) : (
            <div className="eq-table-wrap">
              <table className="eq-table">
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Categoría</th>
                    <th>N° Serie</th>
                    <th>Ubicación</th>
                    <th>Estado</th>
                    <th>Próx. manten.</th>
                    <th>Tarifa / día</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(eq => {
                    const dMaint = daysDiff(eq.next_maintenance_date);
                    const maintUrgent = dMaint !== null && dMaint <= 7;
                    return (
                      <tr key={eq.id}>
                        <td>
                          <div className="eq-table__name">{eq.name}</div>
                          <div className="eq-table__sub">{eq.brand}{eq.model ? ` · ${eq.model}` : ""}</div>
                        </td>
                        <td>{eq.category || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{eq.serial_number || "—"}</td>
                        <td>{eq.location || "—"}</td>
                        <td>
                          <span className={`eq-badge eq-badge--${eq.status}`}>
                            <span className="eq-badge-dot" />
                            {ESTADO_LABELS[eq.status] || eq.status}
                          </span>
                        </td>
                        <td style={{ color: maintUrgent ? "#ef4444" : undefined, fontWeight: maintUrgent ? 700 : undefined }}>
                          {eq.next_maintenance_date ? fDate(eq.next_maintenance_date) : "—"}
                          {maintUrgent && " ⚠️"}
                        </td>
                        <td>{eq.daily_rate ? money(eq.daily_rate) : "—"}</td>
                        <td>
                          <div className="eq-row-actions">
                            <button className="eq-action-btn" onClick={() => handleSelect(eq)}>Ver</button>
                            <button className="eq-action-btn" onClick={() => openEdit(eq)}>Editar</button>
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

        {/* Modal formulario */}
        {showForm && (
          <div className="eq-modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <div className="eq-modal" ref={modalRef}>
              <div className="eq-modal-head">
                <h3>{form.id ? "Editar equipo" : "Nuevo equipo"}</h3>
                <button className="eq-modal-close" onClick={() => setShowForm(false)}>×</button>
              </div>
              <div className="eq-form">
                {formError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
                    ⚠ {formError}
                  </div>
                )}
                <div className="eq-form-row">
                  <div className="eq-field" style={{ gridColumn: "1 / -1" }}>
                    <label>Nombre del equipo *</label>
                    <input
                      value={form.name}
                      onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFormError(""); }}
                      placeholder="EchoLaser SoracteLite"
                      style={formError && !form.name.trim() ? { borderColor: "#ef4444" } : undefined}
                    />
                  </div>
                </div>
                <div className="eq-form-row">
                  <div className="eq-field">
                    <label>Marca</label>
                    <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Elesta" />
                  </div>
                  <div className="eq-field">
                    <label>Modelo</label>
                    <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="SoracteLite" />
                  </div>
                </div>
                <div className="eq-form-row">
                  <div className="eq-field">
                    <label>N° de serie</label>
                    <input value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="SN-001" />
                  </div>
                  <div className="eq-field">
                    <label>Categoría</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="">Seleccionar…</option>
                      {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="eq-form-row">
                  <div className="eq-field">
                    <label>Estado</label>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {ESTADOS.map(s => <option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <div className="eq-field">
                    <label>Ubicación actual</label>
                    <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Depósito central" />
                  </div>
                </div>
                <div className="eq-form-row">
                  <div className="eq-field">
                    <label>Tarifa / día (ARS)</label>
                    <input type="number" value={form.daily_rate} onChange={e => setForm(f => ({ ...f, daily_rate: e.target.value }))} placeholder="120000" />
                  </div>
                  <div className="eq-field">
                    <label>Fecha de compra</label>
                    <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
                  </div>
                </div>
                <div className="eq-form-row">
                  <div className="eq-field">
                    <label>Último mantenimiento</label>
                    <input type="date" value={form.last_maintenance_date} onChange={e => setForm(f => ({ ...f, last_maintenance_date: e.target.value }))} />
                  </div>
                  <div className="eq-field">
                    <label>Próximo mantenimiento</label>
                    <input type="date" value={form.next_maintenance_date} onChange={e => setForm(f => ({ ...f, next_maintenance_date: e.target.value }))} />
                  </div>
                </div>
                <div className="eq-field">
                  <label>Notas internas</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Condiciones, accesorios incluidos, etc." />
                </div>
                <div className="eq-form-actions">
                  <button className="eq-btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                  <button className="eq-btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? "Guardando…" : form.id ? "Guardar cambios" : "Crear equipo"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel detalle lateral */}
        {selected && (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 890, background: "transparent" }}
              onClick={() => { setSelected(null); setRentalHistory([]); }}
            />
            <div className="eq-detail-drawer">
              <div className="eq-detail-head">
                <div>
                  <h3>{selected.name}</h3>
                  <span className={`eq-badge eq-badge--${selected.status}`}>
                    <span className="eq-badge-dot" />
                    {ESTADO_LABELS[selected.status]}
                  </span>
                </div>
                <button className="eq-modal-close" onClick={() => { setSelected(null); setRentalHistory([]); }}>×</button>
              </div>

              <div className="eq-detail-body">
                <div className="eq-detail-section">
                  <div className="eq-detail-section-title">Identificación</div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Marca / Modelo</span><span className="eq-detail-row__value">{selected.brand} {selected.model}</span></div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">N° Serie</span><span className="eq-detail-row__value" style={{ fontFamily: "monospace", fontSize: 12 }}>{selected.serial_number || "—"}</span></div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Categoría</span><span className="eq-detail-row__value">{selected.category || "—"}</span></div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Ubicación</span><span className="eq-detail-row__value">{selected.location || "—"}</span></div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Tarifa / día</span><span className="eq-detail-row__value">{selected.daily_rate ? money(selected.daily_rate) : "—"}</span></div>
                </div>

                <div className="eq-detail-section">
                  <div className="eq-detail-section-title">Mantenimiento</div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Último</span><span className="eq-detail-row__value">{fDate(selected.last_maintenance_date)}</span></div>
                  <div className="eq-detail-row">
                    <span className="eq-detail-row__label">Próximo</span>
                    <span className="eq-detail-row__value" style={{ color: daysDiff(selected.next_maintenance_date) <= 7 ? "#ef4444" : undefined }}>
                      {fDate(selected.next_maintenance_date)}
                      {daysDiff(selected.next_maintenance_date) !== null && ` (${daysDiff(selected.next_maintenance_date)}d)`}
                    </span>
                  </div>
                  <div className="eq-detail-row"><span className="eq-detail-row__label">Fecha compra</span><span className="eq-detail-row__value">{fDate(selected.purchase_date)}</span></div>
                </div>

                <div className="eq-detail-section">
                  <div className="eq-detail-section-title">Cambiar estado</div>
                  <div className="eq-status-menu">
                    {ESTADOS.map(s => (
                      <button
                        key={s}
                        className={`eq-status-opt eq-badge eq-badge--${s} ${selected.status === s ? "eq-status-opt--active" : ""}`}
                        onClick={() => handleStatusChange(selected.id, s)}
                      >
                        {ESTADO_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="eq-detail-section">
                  <div className="eq-detail-section-title">Historial de alquileres</div>
                  {rentalHistory.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#94a3b8" }}>Sin alquileres registrados.</p>
                  ) : (
                    <div className="eq-history-list">
                      {rentalHistory.map(r => (
                        <div key={r.rental_number} className="eq-history-item">
                          <strong>{r.rental_number} — {r.institution || r.doctor_name}</strong>
                          <span>{fDate(r.procedure_date)} · {money(r.total_amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selected.notes && (
                  <div className="eq-detail-section">
                    <div className="eq-detail-section-title">Notas</div>
                    <p style={{ fontSize: 13, color: "#334155", margin: 0 }}>{selected.notes}</p>
                  </div>
                )}
              </div>

              <div className="eq-detail-actions">
                <button className="eq-btn-primary" onClick={() => { openEdit(selected); setSelected(null); }}>
                  Editar equipo
                </button>
                <button className="eq-btn-ghost" onClick={() => onNavigate("rentals", { equipmentId: selected.id })}>
                  Ver alquileres de este equipo
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
