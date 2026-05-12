import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./adminUsers.css";

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "manager",     label: "Gerente"     },
  { value: "seller",      label: "Vendedor"    },
];

/* Lista completa de módulos del CRM */
const MODULES = [
  { id: "managerDashboard", label: "Dashboard"             },
  { id: "importer",         label: "BI Comercial"          },
  { id: "salesAnalytics",   label: "Análisis Comercial"    },
  { id: "accounts",         label: "Clientes / Cuentas"    },
  { id: "products",         label: "Productos / Share Kit" },
  { id: "opportunities",    label: "Oportunidades"         },
  { id: "campaigns",        label: "Campañas"              },
  { id: "todayActions",     label: "Acciones Hoy"          },
  { id: "visits",           label: "Visitas"               },
  { id: "calendar",         label: "Calendario"            },
  { id: "adminUsers",       label: "Administración"        },
];

/* Módulos por defecto para cada rol */
const SELLER_MODULES = [
  "managerDashboard", "importer", "salesAnalytics",
  "accounts", "products", "opportunities", "campaigns",
  "todayActions", "visits", "calendar",
];

const MANAGER_MODULES = [
  "managerDashboard", "importer", "salesAnalytics",
  "accounts", "products", "opportunities", "campaigns",
  "todayActions", "visits", "calendar", "adminUsers",
];

const FULL_MODULES = MODULES.map((m) => m.id);

export default function AdminUsersPage({ profile, onNavigate }) {
  const [users,    setUsers]    = useState([]);
  const [search,   setSearch]   = useState("");
  const [savingId, setSavingId] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles").select("*").order("created_at", { ascending: false });
    if (error) { alert("Error cargando usuarios: " + error.message); setUsers([]); }
    else setUsers(data || []);
    setLoading(false);
  }

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email     || "").toLowerCase().includes(q) ||
      (u.role      || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const stats = useMemo(() => ({
    total:    users.length,
    approved: users.filter((u) =>  u.approved).length,
    pending:  users.filter((u) => !u.approved).length,
    admins:   users.filter((u) =>  u.role === "super_admin").length,
  }), [users]);

  async function updateUser(userId, changes) {
    setSavingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) { alert("Error actualizando usuario: " + error.message); setSavingId(null); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...changes } : u)));
    setSavingId(null);
  }

  function toggleModule(user, moduleId) {
    const current = user.allowed_modules || [];
    const next = current.includes(moduleId)
      ? current.filter((m) => m !== moduleId)
      : [...current, moduleId];
    updateUser(user.id, { allowed_modules: next });
  }

  function approveUser(user)  { updateUser(user.id, { approved: true  }); }
  function blockUser(user)    { updateUser(user.id, { approved: false }); }

  function setFullAccess(user) {
    updateUser(user.id, { approved: true, allowed_modules: FULL_MODULES });
  }

  function setSellerAccess(user) {
    updateUser(user.id, { approved: true, role: "seller", allowed_modules: SELLER_MODULES });
  }

  function setManagerAccess(user) {
    updateUser(user.id, { approved: true, role: "manager", allowed_modules: MANAGER_MODULES });
  }

  return (
    <Layout title="Administración de Usuarios" profile={profile} onNavigate={onNavigate}>
      <div className="admin-page">

        <section className="admin-hero">
          <div>
            <h2>Usuarios y permisos</h2>
            <p>Aprobá accesos, definí roles y habilitá módulos visibles para cada usuario.</p>
          </div>
          <button onClick={loadUsers}>Actualizar</button>
        </section>

        <section className="admin-kpi-grid">
          <Kpi title="Usuarios totales" value={stats.total} />
          <Kpi title="Aprobados"        value={stats.approved} />
          <Kpi title="Pendientes"       value={stats.pending} danger={stats.pending > 0} />
          <Kpi title="Super Admin"      value={stats.admins} />
        </section>

        <section className="admin-toolbar">
          <div>
            <h3>Usuarios registrados</h3>
            <span>{filteredUsers.length} usuarios visibles</span>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o rol..."
          />
        </section>

        <section className="admin-table-card">
          {loading ? (
            <p className="admin-empty">Cargando usuarios...</p>
          ) : filteredUsers.length === 0 ? (
            <p className="admin-empty">No hay usuarios para mostrar.</p>
          ) : (
            <>
              <div className="admin-desktop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Módulos</th>
                      <th>Acciones rápidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        saving={savingId === user.id}
                        onRoleChange={(role) => updateUser(user.id, { role })}
                        onApprove={() => approveUser(user)}
                        onBlock={() => blockUser(user)}
                        onToggleModule={(moduleId) => toggleModule(user, moduleId)}
                        onFullAccess={() => setFullAccess(user)}
                        onSellerAccess={() => setSellerAccess(user)}
                        onManagerAccess={() => setManagerAccess(user)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="admin-mobile-list">
                {filteredUsers.map((user) => (
                  <UserMobileCard
                    key={user.id}
                    user={user}
                    saving={savingId === user.id}
                    onRoleChange={(role) => updateUser(user.id, { role })}
                    onApprove={() => approveUser(user)}
                    onBlock={() => blockUser(user)}
                    onToggleModule={(moduleId) => toggleModule(user, moduleId)}
                    onFullAccess={() => setFullAccess(user)}
                    onSellerAccess={() => setSellerAccess(user)}
                    onManagerAccess={() => setManagerAccess(user)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}

function Kpi({ title, value, danger }) {
  return (
    <article className={`admin-kpi ${danger ? "danger" : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function UserRow({ user, saving, onRoleChange, onApprove, onBlock, onToggleModule, onFullAccess, onSellerAccess, onManagerAccess }) {
  return (
    <tr>
      <td>
        <div className="admin-user-cell">
          <div className="admin-avatar">{(user.full_name || user.email || "U").slice(0,1).toUpperCase()}</div>
          <div>
            <strong>{user.full_name || "Sin nombre"}</strong>
            <span>{user.email || "Sin email"}</span>
          </div>
        </div>
      </td>
      <td>
        <select className="admin-select" value={user.role || "seller"} onChange={(e) => onRoleChange(e.target.value)} disabled={saving}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td>
        <button className={`status-pill ${user.approved ? "approved" : "pending"}`} onClick={user.approved ? onBlock : onApprove} disabled={saving}>
          {user.approved ? "Aprobado" : "Pendiente"}
        </button>
      </td>
      <td>
        <div className="module-grid">
          {MODULES.map((m) => (
            <label key={m.id} className="module-check">
              <input type="checkbox" checked={(user.allowed_modules || []).includes(m.id)} onChange={() => onToggleModule(m.id)} disabled={saving}/>
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </td>
      <td>
        <div className="quick-actions">
          <button onClick={onSellerAccess}  disabled={saving}>Vendedor</button>
          <button onClick={onManagerAccess} disabled={saving}>Gerente</button>
          <button onClick={onFullAccess}    disabled={saving}>Full</button>
        </div>
      </td>
    </tr>
  );
}

function UserMobileCard({ user, saving, onRoleChange, onApprove, onBlock, onToggleModule, onFullAccess, onSellerAccess, onManagerAccess }) {
  return (
    <article className="admin-mobile-card">
      <div className="admin-user-cell">
        <div className="admin-avatar">{(user.full_name || user.email || "U").slice(0,1).toUpperCase()}</div>
        <div>
          <strong>{user.full_name || "Sin nombre"}</strong>
          <span>{user.email || "Sin email"}</span>
        </div>
      </div>
      <div className="mobile-admin-row">
        <label>Rol</label>
        <select className="admin-select" value={user.role || "seller"} onChange={(e) => onRoleChange(e.target.value)} disabled={saving}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <button className={`status-pill ${user.approved ? "approved" : "pending"}`} onClick={user.approved ? onBlock : onApprove} disabled={saving}>
        {user.approved ? "Aprobado" : "Pendiente"}
      </button>
      <div className="module-grid">
        {MODULES.map((m) => (
          <label key={m.id} className="module-check">
            <input type="checkbox" checked={(user.allowed_modules || []).includes(m.id)} onChange={() => onToggleModule(m.id)} disabled={saving}/>
            <span>{m.label}</span>
          </label>
        ))}
      </div>
      <div className="quick-actions">
        <button onClick={onSellerAccess}  disabled={saving}>Vendedor</button>
        <button onClick={onManagerAccess} disabled={saving}>Gerente</button>
        <button onClick={onFullAccess}    disabled={saving}>Full</button>
      </div>
    </article>
  );
}