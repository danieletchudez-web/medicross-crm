import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./business-units.css";

const EMPTY_UNIT = {
  name: "", color: "#5b7cfa", description: "",
  owner_id: "", backup_id: "", is_active: true,
};

const COLOR_PRESETS = [
  "#5b7cfa","#22c55e","#f59e0b","#ef4444","#a855f7",
  "#06b6d4","#f97316","#ec4899","#64748b","#0ea5e9",
];

export default function BusinessUnitsPage({ profile }) {
  const [units,        setUnits]        = useState([]);
  const [profiles,     setProfiles]     = useState([]);
  const [tenderCounts, setTenderCounts] = useState({});
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [editData,     setEditData]     = useState(null);
  const [form,         setForm]         = useState({ ...EMPTY_UNIT });
  const [saving,       setSaving]       = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: u }, { data: p }, { data: t }] = await Promise.all([
      supabase.from("business_units").select("*").order("name"),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("tenders").select("business_unit_id").not("business_unit_id", "is", null),
    ]);
    setUnits(u || []);
    setProfiles(p || []);
    const counts = {};
    (t || []).forEach(r => {
      counts[r.business_unit_id] = (counts[r.business_unit_id] || 0) + 1;
    });
    setTenderCounts(counts);
    setLoading(false);
  }

  function openCreate() {
    setEditData(null);
    setForm({ ...EMPTY_UNIT });
    setShowForm(true);
  }

  function openEdit(u) {
    setEditData(u);
    setForm({
      name:        u.name        || "",
      color:       u.color       || "#5b7cfa",
      description: u.description || "",
      owner_id:    u.owner_id    || "",
      backup_id:   u.backup_id   || "",
      is_active:   u.is_active !== false,
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name?.trim()) { alert("El nombre es obligatorio."); return; }
    setSaving(true);
    const payload = {
      name:        form.name.trim(),
      color:       form.color || "#5b7cfa",
      description: form.description || null,
      owner_id:    form.owner_id  || null,
      backup_id:   form.backup_id || null,
      is_active:   form.is_active,
    };
    if (editData) {
      const { error } = await supabase.from("business_units").update(payload).eq("id", editData.id);
      if (error) { alert("Error: " + error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from("business_units").insert(payload);
      if (error) { alert("Error: " + error.message); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    loadAll();
  }

  async function toggleActive(u) {
    await supabase.from("business_units").update({ is_active: !u.is_active }).eq("id", u.id);
    setUnits(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
  }

  function profileName(id) {
    if (!id) return "—";
    const p = profiles.find(x => x.id === id);
    return p ? (p.full_name || p.email) : "—";
  }

  return (
    <Layout profile={profile}>
      <div className="bu-page">
        <div className="bu-header">
          <div>
            <h1 className="bu-title">Unidades de Negocio</h1>
            <p className="bu-subtitle">Organizá licitaciones y oportunidades por área comercial</p>
          </div>
          <button className="bu-btn bu-btn--primary" onClick={openCreate}>+ Nueva unidad</button>
        </div>

        {loading ? (
          <div className="bu-loading">Cargando…</div>
        ) : (
          <div className="bu-grid">
            {units.length === 0 && (
              <div className="bu-empty">No hay unidades de negocio. Creá la primera.</div>
            )}
            {units.map(u => {
              const count = tenderCounts[u.id] || 0;
              return (
                <div key={u.id} className={`bu-card ${!u.is_active ? "bu-card--inactive" : ""}`}>
                  <div className="bu-card__accent" style={{ background: u.color || "#5b7cfa" }} />
                  <div className="bu-card__body">
                    <div className="bu-card__top">
                      <div className="bu-card__color-dot" style={{ background: u.color || "#5b7cfa" }} />
                      <span className="bu-card__name">{u.name}</span>
                      {!u.is_active && <span className="bu-badge bu-badge--inactive">Inactiva</span>}
                    </div>
                    {u.description && <p className="bu-card__desc">{u.description}</p>}
                    <div className="bu-card__meta">
                      <div className="bu-card__meta-row">
                        <span className="bu-card__meta-label">Responsable</span>
                        <span className="bu-card__meta-val">{profileName(u.owner_id)}</span>
                      </div>
                      {u.backup_id && (
                        <div className="bu-card__meta-row">
                          <span className="bu-card__meta-label">Backup</span>
                          <span className="bu-card__meta-val">{profileName(u.backup_id)}</span>
                        </div>
                      )}
                      <div className="bu-card__meta-row">
                        <span className="bu-card__meta-label">Licitaciones</span>
                        <span className="bu-card__meta-val bu-card__meta-val--count">{count}</span>
                      </div>
                    </div>
                    <div className="bu-card__actions">
                      <button className="bu-btn bu-btn--sm bu-btn--ghost" onClick={() => openEdit(u)}>Editar</button>
                      <button className="bu-btn bu-btn--sm bu-btn--ghost" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showForm && (
          <div className="bu-modal-overlay" onClick={() => setShowForm(false)}>
            <div className="bu-modal" onClick={e => e.stopPropagation()}>
              <div className="bu-modal__header">
                <h2>{editData ? "Editar unidad" : "Nueva unidad de negocio"}</h2>
                <button className="bu-modal__close" onClick={() => setShowForm(false)}>✕</button>
              </div>
              <div className="bu-modal__body">
                <div className="bu-field">
                  <label>Nombre *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="EJ: FILTROS, APHERESIS, ONCOLOGÍA"
                  />
                </div>
                <div className="bu-field">
                  <label>Descripción</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2}
                    placeholder="Descripción opcional de la unidad"
                  />
                </div>
                <div className="bu-field">
                  <label>Color</label>
                  <div className="bu-color-row">
                    {COLOR_PRESETS.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`bu-color-swatch ${form.color === c ? "active" : ""}`}
                        style={{ background: c }}
                        onClick={() => setForm(p => ({ ...p, color: c }))}
                      />
                    ))}
                    <input
                      type="color"
                      value={form.color}
                      onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                      className="bu-color-input"
                    />
                  </div>
                </div>
                <div className="bu-field">
                  <label>Responsable principal</label>
                  <select value={form.owner_id} onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}>
                    <option value="">Sin asignar</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </select>
                </div>
                <div className="bu-field">
                  <label>Responsable backup</label>
                  <select value={form.backup_id} onChange={e => setForm(p => ({ ...p, backup_id: e.target.value }))}>
                    <option value="">Sin asignar</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </select>
                </div>
                <div className="bu-field bu-field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                    />
                    Unidad activa
                  </label>
                </div>
              </div>
              <div className="bu-modal__footer">
                <button className="bu-btn bu-btn--ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="bu-btn bu-btn--primary" onClick={save} disabled={saving}>
                  {saving ? "Guardando…" : editData ? "Guardar cambios" : "Crear unidad"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
