import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./adminUsers.css";

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "manager",     label: "Gerente"      },
  { value: "seller",      label: "Vendedor"      },
];

const MODULES = [
  { id: "managerDashboard", label: "Dashboard Comercial"  },
  { id: "sellerDashboard",  label: "Dashboard Vendedor"   },
  { id: "accounts",         label: "Clientes / Cuentas"   },
  { id: "products",         label: "Productos / Share Kit"},
  { id: "opportunities",    label: "Oportunidades"        },
  { id: "campaigns",        label: "Campañas"             },
  { id: "todayActions",     label: "Acciones Hoy"         },
  { id: "visits",           label: "Visitas"              },
  { id: "calendar",         label: "Calendario"           },
  { id: "adminUsers",       label: "Administración"       },
];

const SELLER_MODULES  = ["sellerDashboard","accounts","products","opportunities","todayActions","visits","calendar"];
const MANAGER_MODULES = ["managerDashboard","sellerDashboard","accounts","products","opportunities","campaigns","todayActions","visits","calendar"];
const FULL_MODULES    = MODULES.map((m) => m.id);

export default function AdminUsersPage({ profile, onNavigate }) {
  const [users, setUsers]     = useState([]);
  const [search, setSearch]   = useState("");
  const [savingId, setSavingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) alert("Error: " + error.message);
    setUsers(data || []);
    setLoading(false);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function updateUser(userId, changes) {
    setSavingId(userId);
    const { error } = await supabase.from("profiles").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) { alert("Error: " + error.message); setSavingId(null); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...changes } : u)));
    setSavingId(null);
  }

  async function approveWithRole(user, role) {
    const modules = role === "seller" ? SELLER_MODULES : role === "manager" ? MANAGER_MODULES : FULL_MODULES;
    await updateUser(user.id, { approved: true, role, allowed_modules: modules });
    showToast(`✓ ${user.full_name || user.email} aprobado como ${role}`);
  }

  function toggleModule(user, moduleId) {
    const current = user.allowed_modules || [];
    const next = current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId];
    updateUser(user.id, { allowed_modules: next });
  }

  function blockUser(user) {
    updateUser(user.id, { approved: false });
    showToast(`Usuario ${user.full_name || user.email} bloqueado`);
  }

  const pending  = useMemo(() => users.filter((u) => !u.approved), [users]);
  const approved = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter((u) => u.approved && (
      !q ||
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email     || "").toLowerCase().includes(q) ||
      (u.role      || "").toLowerCase().includes(q)
    ));
  }, [users, search]);

  const stats = useMemo(() => ({
    total:    users.length,
    approved: users.filter((u) => u.approved).length,
    pending:  pending.length,
    admins:   users.filter((u) => u.role === "super_admin").length,
  }), [users, pending]);

  return (
    <Layout title="Administración" profile={profile} onNavigate={onNavigate}>
      <div className="adm-page">

        {/* TOAST */}
        {toast && <div className="adm-toast">{toast}</div>}

        {/* KPIs */}
        <section className="adm-kpis">
          <AdmKpi label="Usuarios totales" value={stats.total} />
          <AdmKpi label="Aprobados"        value={stats.approved} accent="green" />
          <AdmKpi label="Pendientes"       value={stats.pending}  accent={stats.pending > 0 ? "red" : undefined} />
          <AdmKpi label="Super Admin"      value={stats.admins}   accent="blue" />
        </section>

        {/* ── PENDIENTES DE APROBACIÓN ── */}
        {pending.length > 0 && (
          <section className="adm-pending-section">
            <div className="adm-pending-header">
              <div className="adm-pending-header__left">
                <span className="adm-pending-badge">{pending.length}</span>
                <div>
                  <h2>Pendientes de aprobación</h2>
                  <p>Estos usuarios se registraron y esperan acceso al CRM.</p>
                </div>
              </div>
            </div>

            <div className="adm-pending-list">
              {pending.map((user) => (
                <div key={user.id} className="adm-pending-card">
                  <div className="adm-pending-card__info">
                    <div className="adm-avatar adm-avatar--pending">
                      {(user.full_name || user.email || "U").slice(0,1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{user.full_name || "Sin nombre"}</strong>
                      <span>{user.email}</span>
                      <em>Registrado: {user.created_at ? new Date(user.created_at).toLocaleDateString("es-AR") : "—"}</em>
                    </div>
                  </div>

                  <div className="adm-pending-card__actions">
                    <span className="adm-pending-card__label">Aprobar como:</span>
                    <button
                      className="adm-approve-btn adm-approve-btn--seller"
                      onClick={() => approveWithRole(user, "seller")}
                      disabled={savingId === user.id}
                    >
                      Vendedor
                    </button>
                    <button
                      className="adm-approve-btn adm-approve-btn--manager"
                      onClick={() => approveWithRole(user, "manager")}
                      disabled={savingId === user.id}
                    >
                      Gerente
                    </button>
                    <button
                      className="adm-approve-btn adm-approve-btn--admin"
                      onClick={() => approveWithRole(user, "super_admin")}
                      disabled={savingId === user.id}
                    >
                      Admin
                    </button>
                    <button
                      className="adm-reject-btn"
                      onClick={() => updateUser(user.id, { approved: false })}
                      disabled={savingId === user.id}
                      title="Rechazar / mantener pendiente"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── USUARIOS APROBADOS ── */}
        <section className="adm-card">
          <div className="adm-toolbar">
            <div>
              <h2>Usuarios activos</h2>
              <span>{approved.length} usuarios</span>
            </div>
            <div className="adm-toolbar__right">
              <input
                className="adm-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, email o rol..."
              />
              <button className="adm-refresh-btn" onClick={loadUsers}>↺ Actualizar</button>
            </div>
          </div>

          {loading ? (
            <p className="adm-empty">Cargando usuarios...</p>
          ) : approved.length === 0 ? (
            <p className="adm-empty">No hay usuarios aprobados.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Módulos habilitados</th>
                    <th>Acceso rápido</th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="adm-user-cell">
                          <div className="adm-avatar">
                            {(user.full_name || user.email || "U").slice(0,1).toUpperCase()}
                          </div>
                          <div>
                            <strong>{user.full_name || "Sin nombre"}</strong>
                            <span>{user.email}</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <select
                          className="adm-select"
                          value={user.role || "seller"}
                          onChange={(e) => updateUser(user.id, { role: e.target.value })}
                          disabled={savingId === user.id}
                        >
                          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>

                      <td>
                        <button
                          className="adm-status-btn adm-status-btn--approved"
                          onClick={() => blockUser(user)}
                          disabled={savingId === user.id}
                          title="Click para bloquear"
                        >
                          ✓ Aprobado
                        </button>
                      </td>

                      <td>
                        <div className="adm-module-grid">
                          {MODULES.map((m) => (
                            <label key={m.id} className="adm-module-check">
                              <input
                                type="checkbox"
                                checked={(user.allowed_modules || []).includes(m.id)}
                                onChange={() => toggleModule(user, m.id)}
                                disabled={savingId === user.id}
                              />
                              <span>{m.label}</span>
                            </label>
                          ))}
                        </div>
                      </td>

                      <td>
                        <div className="adm-quick-actions">
                          <button onClick={() => approveWithRole(user, "seller")}      disabled={savingId === user.id}>Vendedor</button>
                          <button onClick={() => approveWithRole(user, "manager")}     disabled={savingId === user.id}>Gerente</button>
                          <button onClick={() => approveWithRole(user, "super_admin")} disabled={savingId === user.id}>Full</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="adm-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}

function AdmKpi({ label, value, accent }) {
  const colors = { green: "#10b981", red: "#ef4444", blue: "#3b82f6" };
  const c = colors[accent] || "#e8ecf2";
  return (
    <article className="adm-kpi" style={{ borderTopColor: c }}>
      <span className="adm-kpi__label">{label}</span>
      <strong className="adm-kpi__value" style={accent ? { color: c } : {}}>{value}</strong>
    </article>
  );
}