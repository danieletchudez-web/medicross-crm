import { useEffect, useState, useMemo } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./accounts.css";

const EMPTY_CONTACT = { name: "", role: "", area: "", phone: "", email: "" };

const EMPTY_FORM = {
  name: "",
  type: "Hospital",
  province: "",
  city: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  potential: "Medio",
  follow_status: "verde",
  contacts: [],
};

export default function AccountsPage({ profile, onNavigate }) {
  const [accounts, setAccounts]   = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(null);
  const [search, setSearch]       = useState("");

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts() {
    const { data, error } = await supabase
      .from("accounts")
      .select("*, profiles(full_name, email)")
      .order("created_at", { ascending: false });
    if (error) { alert("Error: " + error.message); return; }
    setAccounts(data || []);
  }

  function resetForm() { setForm(EMPTY_FORM); setEditingId(null); }

  function editAccount(a) {
    setEditingId(a.id);
    setForm({
      name:          a.name || "",
      type:          a.type || "Hospital",
      province:      a.province || "",
      city:          a.city || "",
      address:       a.address || "",
      phone:         a.phone || "",
      email:         a.email || "",
      website:       a.website || "",
      potential:     a.potential || "Medio",
      follow_status: a.follow_status || "verde",
      contacts:      Array.isArray(a.contacts) ? a.contacts : [],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAccount(e) {
    e.preventDefault();
    setLoading(true);
    const payload = { ...form, owner_id: profile?.id || null };
    const result = editingId
      ? await supabase.from("accounts").update(payload).eq("id", editingId)
      : await supabase.from("accounts").insert([payload]);
    setLoading(false);
    if (result.error) { alert("Error: " + result.error.message); return; }
    resetForm();
    await loadAccounts();
  }

  async function deleteAccount(id) {
    if (!confirm("¿Borrar este cliente? Las visitas y oportunidades asociadas quedarán sin cliente.")) return;
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await loadAccounts();
  }

  /* Contactos */
  function addContact() {
    setForm({ ...form, contacts: [...form.contacts, { ...EMPTY_CONTACT }] });
  }

  function updateContact(i, field, value) {
    const updated = form.contacts.map((c, idx) => idx === i ? { ...c, [field]: value } : c);
    setForm({ ...form, contacts: updated });
  }

  function removeContact(i) {
    setForm({ ...form, contacts: form.contacts.filter((_, idx) => idx !== i) });
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter((a) =>
      a.name?.toLowerCase().includes(q) ||
      a.city?.toLowerCase().includes(q) ||
      a.province?.toLowerCase().includes(q) ||
      a.type?.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const total       = accounts.length;
  const highPot     = accounts.filter((a) => a.potential === "Alto").length;
  const redFollow   = accounts.filter((a) => a.follow_status === "rojo").length;
  const withContact = accounts.filter((a) => Array.isArray(a.contacts) && a.contacts.length > 0).length;

  return (
    <Layout title="Clientes / Cuentas" profile={profile} onNavigate={onNavigate}>
      <div className="acc-page">

        {/* KPIs */}
        <section className="acc-kpis">
          <AccKpi label="Clientes totales"    value={total} />
          <AccKpi label="Potencial alto"      value={highPot} accent="blue" />
          <AccKpi label="Seguimiento rojo"    value={redFollow} accent="red" />
          <AccKpi label="Con contactos"       value={withContact} accent="green" />
        </section>

        {/* FORM + LIST side by side */}
        <div className="acc-main">

        {/* FORM */}
        <section className="acc-card acc-card--form">
          <div className="acc-card-head">
            <div>
              <h2>{editingId ? "Editar cliente" : "Nuevo cliente"}</h2>
              <p>Alta de hospitales, clínicas, sanatorios y cuentas objetivo.</p>
            </div>
            {editingId && <button className="acc-ghost-btn" onClick={resetForm}>Cancelar edición</button>}
          </div>

          <form className="acc-form" onSubmit={saveAccount}>

            {/* DATOS PRINCIPALES */}
            <div className="acc-form-section">
              <span className="acc-form-section__label">Datos de la institución</span>
              <div className="acc-form-grid">
                <div className="acc-field acc-field--wide">
                  <label>Nombre del cliente / institución</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Hospital Italiano de Buenos Aires" required />
                </div>
                <div className="acc-field">
                  <label>Tipo de cuenta</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option>Hospital</option>
                    <option>Clínica</option>
                    <option>Sanatorio</option>
                    <option>Instituto</option>
                    <option>Obra social</option>
                    <option>Distribuidor</option>
                    <option>Otro</option>
                  </select>
                </div>
                <div className="acc-field">
                  <label>Potencial</label>
                  <select value={form.potential} onChange={(e) => setForm({ ...form, potential: e.target.value })}>
                    <option>Alto</option>
                    <option>Medio</option>
                    <option>Bajo</option>
                  </select>
                </div>
                <div className="acc-field">
                  <label>Semáforo seguimiento</label>
                  <select value={form.follow_status} onChange={(e) => setForm({ ...form, follow_status: e.target.value })}>
                    <option value="verde">Verde</option>
                    <option value="amarillo">Amarillo</option>
                    <option value="rojo">Rojo</option>
                  </select>
                </div>
              </div>
            </div>

            {/* UBICACIÓN */}
            <div className="acc-form-section">
              <span className="acc-form-section__label">Ubicación</span>
              <div className="acc-form-grid">
                <div className="acc-field">
                  <label>Provincia</label>
                  <input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="Ej: Buenos Aires" />
                </div>
                <div className="acc-field">
                  <label>Ciudad</label>
                  <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Ej: CABA" />
                </div>
                <div className="acc-field acc-field--wide">
                  <label>Dirección</label>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Ej: Av. Potosí 4234, piso 3" />
                </div>
              </div>
            </div>

            {/* CONTACTO INSTITUCIONAL */}
            <div className="acc-form-section">
              <span className="acc-form-section__label">Contacto institucional</span>
              <div className="acc-form-grid">
                <div className="acc-field">
                  <label>Teléfono</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Ej: +54 11 4321-0000" />
                </div>
                <div className="acc-field">
                  <label>Email institucional</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Ej: compras@hospital.com" />
                </div>
                <div className="acc-field">
                  <label>Sitio web</label>
                  <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="Ej: www.hospitalitaliano.org.ar" />
                </div>
              </div>
            </div>

            {/* CONTACTOS POR ÁREA */}
            <div className="acc-form-section">
              <div className="acc-contacts-head">
                <span className="acc-form-section__label">Contactos por área</span>
                <button type="button" className="acc-add-contact-btn" onClick={addContact}>+ Agregar contacto</button>
              </div>

              {form.contacts.length === 0 && (
                <p className="acc-contacts-empty">No hay contactos cargados. Agregá referentes de compras, biomedicina, jefatura, etc.</p>
              )}

              {form.contacts.map((c, i) => (
                <div key={i} className="acc-contact-row">
                  <div className="acc-contact-fields">
                    <div className="acc-field">
                      <label>Nombre completo</label>
                      <input value={c.name} onChange={(e) => updateContact(i, "name", e.target.value)} placeholder="Ej: María González" />
                    </div>
                    <div className="acc-field">
                      <label>Cargo</label>
                      <input value={c.role} onChange={(e) => updateContact(i, "role", e.target.value)} placeholder="Ej: Jefa de Compras" />
                    </div>
                    <div className="acc-field">
                      <label>Área</label>
                      <select value={c.area} onChange={(e) => updateContact(i, "area", e.target.value)}>
                        <option value="">Seleccionar área</option>
                        <option>Compras</option>
                        <option>Biomedicina</option>
                        <option>Jefatura médica</option>
                        <option>Administración</option>
                        <option>Dirección</option>
                        <option>Tecnología</option>
                        <option>Otro</option>
                      </select>
                    </div>
                    <div className="acc-field">
                      <label>Teléfono directo</label>
                      <input value={c.phone} onChange={(e) => updateContact(i, "phone", e.target.value)} placeholder="Ej: +54 11 1234-5678" />
                    </div>
                    <div className="acc-field">
                      <label>Email directo</label>
                      <input type="email" value={c.email} onChange={(e) => updateContact(i, "email", e.target.value)} placeholder="Ej: mgonzalez@hospital.com" />
                    </div>
                  </div>
                  <button type="button" className="acc-remove-contact" onClick={() => removeContact(i)} title="Eliminar contacto">✕</button>
                </div>
              ))}
            </div>

            <button className="acc-submit" disabled={loading}>
              {loading ? "Guardando..." : editingId ? "Actualizar cliente" : "Crear cliente"}
            </button>
          </form>
        </section>

        {/* LISTA */}
        <section className="acc-card acc-card--list">
          <div className="acc-card-head">
            <div>
              <h2>Listado de clientes</h2>
              <p>Base comercial para visitas, oportunidades y score automático.</p>
            </div>
            <input
              className="acc-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, ciudad o tipo…"
            />
          </div>

          <div className="acc-table-wrap">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Ubicación</th>
                  <th>Contacto</th>
                  <th>Potencial</th>
                  <th>Seguimiento</th>
                  <th>Responsable</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan="8" className="acc-empty">No hay clientes cargados.</td></tr>
                ) : filtered.map((a) => (
                  <>
                    <tr key={a.id} className={expanded === a.id ? "acc-row--expanded" : ""}>
                      <td className="acc-td-name">
                        <button className="acc-account-link" onClick={() => onNavigate("accountDetail", { accountId: a.id })}>{a.name}</button>
                        {a.address && <small>{a.address}</small>}
                      </td>
                      <td>{a.type || "—"}</td>
                      <td>{[a.city, a.province].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="acc-td-contact">
                        {a.phone && <span>📞 {a.phone}</span>}
                        {a.email && <span>✉ {a.email}</span>}
                        {Array.isArray(a.contacts) && a.contacts.length > 0 && (
                          <button className="acc-contacts-toggle" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                            {a.contacts.length} contacto{a.contacts.length > 1 ? "s" : ""} {expanded === a.id ? "▲" : "▼"}
                          </button>
                        )}
                      </td>
                      <td><span className={`acc-badge acc-badge--${a.potential?.toLowerCase()}`}>{a.potential || "Medio"}</span></td>
                      <td><span className={`acc-badge acc-badge--${a.follow_status}`}>{a.follow_status || "verde"}</span></td>
                      <td>{a.profiles?.full_name || a.profiles?.email || "Sin asignar"}</td>
                      <td>
                        <div className="acc-actions">
                          <button className="acc-btn acc-btn--edit" onClick={() => editAccount(a)}>Editar</button>
                          <button className="acc-btn acc-btn--del"  onClick={() => deleteAccount(a.id)}>Borrar</button>
                        </div>
                      </td>
                    </tr>

                    {/* Fila expandida de contactos */}
                    {expanded === a.id && Array.isArray(a.contacts) && a.contacts.length > 0 && (
                      <tr key={`${a.id}-contacts`} className="acc-row--contacts">
                        <td colSpan="8">
                          <div className="acc-contacts-grid">
                            {a.contacts.map((c, i) => (
                              <div key={i} className="acc-contact-card">
                                <div className="acc-contact-card__top">
                                  <strong>{c.name || "Sin nombre"}</strong>
                                  {c.area && <span className="acc-contact-area">{c.area}</span>}
                                </div>
                                {c.role  && <p className="acc-contact-role">{c.role}</p>}
                                {c.phone && <p className="acc-contact-info">📞 {c.phone}</p>}
                                {c.email && <p className="acc-contact-info">✉ <a href={`mailto:${c.email}`}>{c.email}</a></p>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        </div>{/* end acc-main */}

        <footer className="acc-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}

function AccKpi({ label, value, accent }) {
  const colors = {
    blue:  { border: "#3b82f6", text: "#2563eb" },
    red:   { border: "#ef4444", text: "#dc2626" },
    green: { border: "#10b981", text: "#059669" },
  };
  const c = colors[accent] || {};
  return (
    <article className="acc-kpi" style={c.border ? { borderTopColor: c.border } : {}}>
      <span className="acc-kpi__label">{label}</span>
      <strong className="acc-kpi__value" style={c.text ? { color: c.text } : {}}>{value}</strong>
    </article>
  );
}
