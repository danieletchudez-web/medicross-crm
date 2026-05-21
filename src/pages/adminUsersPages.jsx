import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./adminUsers.css";

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "manager",     label: "Gerente"     },
  { value: "seller",      label: "Vendedor"    },
];

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
  { id: "tenders",          label: "Licitaciones"          },
  { id: "cotizador",        label: "Cotizador"             },
  { id: "adminUsers",       label: "Administración"        },
];

const SELLER_MODULES = [
  "managerDashboard","importer","salesAnalytics",
  "accounts","products","opportunities","campaigns",
  "todayActions","visits","calendar","tenders","cotizador",
];

const MANAGER_MODULES = [
  "managerDashboard","importer","salesAnalytics",
  "accounts","products","opportunities","campaigns",
  "todayActions","visits","calendar","tenders","cotizador","adminUsers",
];

const FULL_MODULES = MODULES.map(m => m.id);

/* ─── Modal de confirmación para eliminar ────────────────────────────── */
function DeleteConfirmModal({ user, onConfirm, onCancel }) {
  const [input, setInput] = useState("");
  const isMatch = input.trim().toLowerCase() === (user.email||"").toLowerCase();

  return (
    <div className="adm-modal-overlay" onClick={e => { if(e.target.classList.contains("adm-modal-overlay")) onCancel(); }}>
      <div className="adm-modal">
        <div className="adm-modal__header">
          <span className="adm-modal__icon">⚠️</span>
          <h3>Archivar usuario</h3>
        </div>
        <div className="adm-modal__body">
          <p style={{margin:"0 0 8px",fontSize:13.5,color:"#0f172a",fontWeight:600}}>
            Vas a archivar a <strong>{user.full_name||user.email}</strong>.
          </p>
          <p style={{margin:"0 0 16px",fontSize:13,color:"#64748b",lineHeight:1.5}}>
            El usuario no podrá acceder al CRM pero sus datos quedan guardados y podés restaurarlo cuando quieras.
          </p>
          <p style={{margin:"0 0 8px",fontSize:12,color:"#64748b"}}>
            Para confirmar, escribí el email del usuario:
          </p>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#0f172a",
            background:"#f1f5f9",padding:"6px 10px",borderRadius:7,fontFamily:"monospace"}}>
            {user.email}
          </p>
          <input
            className="adm-confirm-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribí el email para confirmar…"
            autoFocus
          />
        </div>
        <div className="adm-modal__footer">
          <button className="adm-cancel-btn" onClick={onCancel}>Cancelar</button>
          <button
            className="adm-confirm-btn"
            onClick={onConfirm}
            disabled={!isMatch}
          >
            Sí, archivar usuario
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────── */
export default function AdminUsersPage({ profile, onNavigate }) {
  const [users,       setUsers]       = useState([]);
  const [search,      setSearch]      = useState("");
  const [savingId,    setSavingId]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [showArchived,setShowArchived]= useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles").select("*").order("created_at", { ascending: false });
    if (error) { alert("Error cargando usuarios: " + error.message); setUsers([]); }
    else setUsers(data || []);
    setLoading(false);
  }

  const activeUsers   = useMemo(() => users.filter(u => u.is_active !== false), [users]);
  const archivedUsers = useMemo(() => users.filter(u => u.is_active === false),  [users]);

  const filteredUsers = useMemo(() => {
    const source = showArchived ? archivedUsers : activeUsers;
    const q = search.toLowerCase().trim();
    if (!q) return source;
    return source.filter(u =>
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email     || "").toLowerCase().includes(q) ||
      (u.role      || "").toLowerCase().includes(q)
    );
  }, [users, search, showArchived, activeUsers, archivedUsers]);

  const stats = useMemo(() => ({
    total:    activeUsers.length,
    approved: activeUsers.filter(u =>  u.approved).length,
    pending:  activeUsers.filter(u => !u.approved).length,
    admins:   activeUsers.filter(u =>  u.role === "super_admin").length,
    archived: archivedUsers.length,
  }), [activeUsers, archivedUsers]);

  async function updateUser(userId, changes) {
    setSavingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) { alert("Error actualizando usuario: " + error.message); setSavingId(null); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...changes } : u));
    setSavingId(null);
  }

  function toggleModule(user, moduleId) {
    const current = user.allowed_modules || [];
    const next = current.includes(moduleId)
      ? current.filter(m => m !== moduleId)
      : [...current, moduleId];
    updateUser(user.id, { allowed_modules: next });
  }

  function approveUser(user)  { updateUser(user.id, { approved: true  }); }
  function blockUser(user)    { updateUser(user.id, { approved: false }); }

  function setFullAccess(user)    { updateUser(user.id, { approved: true, allowed_modules: FULL_MODULES }); }
  function setSellerAccess(user)  { updateUser(user.id, { approved: true, role: "seller",  allowed_modules: SELLER_MODULES  }); }
  function setManagerAccess(user) { updateUser(user.id, { approved: true, role: "manager", allowed_modules: MANAGER_MODULES }); }

  async function archiveUser(user) {
    setSavingId(user.id);
    await updateUser(user.id, {
      is_active:  false,
      approved:   false,
      deleted_at: new Date().toISOString(),
      deleted_by: profile?.id || null,
    });
    setDeleteTarget(null);
    setSavingId(null);
  }

  async function restoreUser(user) {
    if (!confirm(`¿Restaurar acceso a ${user.full_name||user.email}?`)) return;
    await updateUser(user.id, {
      is_active:  true,
      approved:   true,
      deleted_at: null,
      deleted_by: null,
    });
  }

  return (
    <Layout title="Administración de Usuarios" profile={profile} onNavigate={onNavigate}>
      <div className="admin-page">

        {/* Hero */}
        <section className="admin-hero">
          <div>
            <h2>Usuarios y permisos</h2>
            <p>Aprobá accesos, definí roles y habilitá módulos visibles para cada usuario.</p>
          </div>
          <button onClick={loadUsers}>Actualizar</button>
        </section>

        {/* KPIs */}
        <section className="admin-kpi-grid">
          <Kpi title="Usuarios activos"  value={stats.total}    />
          <Kpi title="Aprobados"         value={stats.approved} />
          <Kpi title="Pendientes"        value={stats.pending}  danger={stats.pending > 0} />
          <Kpi title="Super Admin"       value={stats.admins}   />
          <Kpi title="Archivados"        value={stats.archived} warn={stats.archived > 0} />
        </section>

        {/* Toolbar */}
        <section className="admin-toolbar">
          <div>
            <h3>{showArchived ? "Usuarios archivados" : "Usuarios registrados"}</h3>
            <span>{filteredUsers.length} usuarios visibles</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email o rol..."
            />
            <button
              className={`adm-tab-btn ${!showArchived?"active":""}`}
              onClick={() => setShowArchived(false)}
            >
              Activos ({stats.total})
            </button>
            <button
              className={`adm-tab-btn ${showArchived?"active":""}`}
              onClick={() => setShowArchived(true)}
            >
              Archivados ({stats.archived})
            </button>
          </div>
        </section>

        {/* Tabla */}
        <section className="admin-table-card">
          {loading ? (
            <p className="admin-empty">Cargando usuarios...</p>
          ) : filteredUsers.length === 0 ? (
            <p className="admin-empty">
              {showArchived ? "No hay usuarios archivados." : "No hay usuarios para mostrar."}
            </p>
          ) : (
            <>
              <div className="admin-desktop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      {!showArchived && <th>Módulos</th>}
                      {!showArchived && <th>Acciones rápidas</th>}
                      <th>{showArchived ? "Archivado" : "Archivar"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(user => (
                      showArchived ? (
                        <ArchivedRow
                          key={user.id}
                          user={user}
                          saving={savingId === user.id}
                          onRestore={() => restoreUser(user)}
                        />
                      ) : (
                        <UserRow
                          key={user.id}
                          user={user}
                          saving={savingId === user.id}
                          currentProfile={profile}
                          onRoleChange={role => updateUser(user.id, { role })}
                          onApprove={() => approveUser(user)}
                          onBlock={() => blockUser(user)}
                          onToggleModule={moduleId => toggleModule(user, moduleId)}
                          onFullAccess={() => setFullAccess(user)}
                          onSellerAccess={() => setSellerAccess(user)}
                          onManagerAccess={() => setManagerAccess(user)}
                          onArchive={() => setDeleteTarget(user)}
                        />
                      )
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="admin-mobile-list">
                {filteredUsers.map(user => (
                  showArchived ? (
                    <ArchivedMobileCard
                      key={user.id}
                      user={user}
                      saving={savingId === user.id}
                      onRestore={() => restoreUser(user)}
                    />
                  ) : (
                    <UserMobileCard
                      key={user.id}
                      user={user}
                      saving={savingId === user.id}
                      currentProfile={profile}
                      onRoleChange={role => updateUser(user.id, { role })}
                      onApprove={() => approveUser(user)}
                      onBlock={() => blockUser(user)}
                      onToggleModule={moduleId => toggleModule(user, moduleId)}
                      onFullAccess={() => setFullAccess(user)}
                      onSellerAccess={() => setSellerAccess(user)}
                      onManagerAccess={() => setManagerAccess(user)}
                      onArchive={() => setDeleteTarget(user)}
                    />
                  )
                ))}
              </div>
            </>
          )}
        </section>

        {/* Nota informativa */}
        <div className="adm-info-box">
          <span style={{fontSize:16}}>🔒</span>
          <div>
            <strong>Seguridad de datos</strong>
            <p>
              Los usuarios archivados no pueden acceder al CRM pero todos sus datos (ventas, licitaciones, oportunidades) se conservan intactos.
              Podés restaurar un usuario en cualquier momento desde la pestaña "Archivados".
            </p>
          </div>
        </div>

      </div>

      {/* Modal confirmación archivado */}
      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          onConfirm={() => archiveUser(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

    </Layout>
  );
}

/* ─── KPI ────────────────────────────────────────────────────────────── */
function Kpi({ title, value, danger, warn }) {
  return (
    <article className={`admin-kpi ${danger?"danger":""} ${warn?"warn":""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

/* ─── Fila usuario activo ────────────────────────────────────────────── */
function UserRow({ user, saving, currentProfile, onRoleChange, onApprove, onBlock, onToggleModule, onFullAccess, onSellerAccess, onManagerAccess, onArchive }) {
  const isSelf = user.id === currentProfile?.id;
  const isSuperAdmin = user.role === "super_admin";

  return (
    <tr>
      <td>
        <div className="admin-user-cell">
          <div className="admin-avatar">{(user.full_name||user.email||"U").slice(0,1).toUpperCase()}</div>
          <div>
            <strong>{user.full_name||"Sin nombre"}</strong>
            <span>{user.email||"Sin email"}</span>
          </div>
        </div>
      </td>
      <td>
        <select className="admin-select" value={user.role||"seller"}
          onChange={e => onRoleChange(e.target.value)} disabled={saving||isSelf}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td>
        <button className={`status-pill ${user.approved?"approved":"pending"}`}
          onClick={user.approved ? onBlock : onApprove} disabled={saving||isSelf}>
          {user.approved ? "✓ Aprobado" : "⏳ Pendiente"}
        </button>
      </td>
      <td>
        <div className="module-grid">
          {MODULES.map(m => (
            <label key={m.id} className="module-check">
              <input type="checkbox"
                checked={(user.allowed_modules||[]).includes(m.id)}
                onChange={() => onToggleModule(m.id)}
                disabled={saving}
              />
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
      <td>
        {!isSelf && !isSuperAdmin ? (
          <button
            className="adm-archive-btn"
            onClick={onArchive}
            disabled={saving}
            title="Archivar usuario (no borra datos)"
          >
            📦 Archivar
          </button>
        ) : (
          <span style={{fontSize:11,color:"#94a3b8"}}>
            {isSelf ? "Cuenta propia" : "Super Admin"}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ─── Fila usuario archivado ─────────────────────────────────────────── */
function ArchivedRow({ user, saving, onRestore }) {
  return (
    <tr style={{opacity:.7}}>
      <td>
        <div className="admin-user-cell">
          <div className="admin-avatar" style={{background:"#94a3b8"}}>
            {(user.full_name||user.email||"U").slice(0,1).toUpperCase()}
          </div>
          <div>
            <strong style={{color:"#64748b"}}>{user.full_name||"Sin nombre"}</strong>
            <span>{user.email||"Sin email"}</span>
          </div>
        </div>
      </td>
      <td><span style={{fontSize:12,color:"#64748b"}}>{ROLES.find(r=>r.value===user.role)?.label||user.role||"—"}</span></td>
      <td><span className="status-pill" style={{background:"#f1f5f9",color:"#64748b",borderColor:"#e2e8f0"}}>Archivado</span></td>
      <td>
        <span style={{fontSize:11,color:"#94a3b8"}}>
          {user.deleted_at ? new Date(user.deleted_at).toLocaleDateString("es-AR") : "—"}
        </span>
      </td>
      <td>
        <button className="adm-restore-btn" onClick={onRestore} disabled={saving}>
          ↩ Restaurar
        </button>
      </td>
    </tr>
  );
}

/* ─── Mobile usuario activo ──────────────────────────────────────────── */
function UserMobileCard({ user, saving, currentProfile, onRoleChange, onApprove, onBlock, onToggleModule, onFullAccess, onSellerAccess, onManagerAccess, onArchive }) {
  const isSelf = user.id === currentProfile?.id;
  const isSuperAdmin = user.role === "super_admin";

  return (
    <article className="admin-mobile-card">
      <div className="admin-user-cell">
        <div className="admin-avatar">{(user.full_name||user.email||"U").slice(0,1).toUpperCase()}</div>
        <div>
          <strong>{user.full_name||"Sin nombre"}</strong>
          <span>{user.email||"Sin email"}</span>
        </div>
      </div>
      <div className="mobile-admin-row">
        <label>Rol</label>
        <select className="admin-select" value={user.role||"seller"}
          onChange={e => onRoleChange(e.target.value)} disabled={saving||isSelf}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <button className={`status-pill ${user.approved?"approved":"pending"}`}
        onClick={user.approved ? onBlock : onApprove} disabled={saving||isSelf}>
        {user.approved ? "✓ Aprobado" : "⏳ Pendiente"}
      </button>
      <div className="module-grid">
        {MODULES.map(m => (
          <label key={m.id} className="module-check">
            <input type="checkbox"
              checked={(user.allowed_modules||[]).includes(m.id)}
              onChange={() => onToggleModule(m.id)}
              disabled={saving}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>
      <div className="quick-actions">
        <button onClick={onSellerAccess}  disabled={saving}>Vendedor</button>
        <button onClick={onManagerAccess} disabled={saving}>Gerente</button>
        <button onClick={onFullAccess}    disabled={saving}>Full</button>
        {!isSelf && !isSuperAdmin && (
          <button className="adm-archive-btn" onClick={onArchive} disabled={saving}>
            📦 Archivar
          </button>
        )}
      </div>
    </article>
  );
}

/* ─── Mobile usuario archivado ───────────────────────────────────────── */
function ArchivedMobileCard({ user, saving, onRestore }) {
  return (
    <article className="admin-mobile-card" style={{opacity:.7}}>
      <div className="admin-user-cell">
        <div className="admin-avatar" style={{background:"#94a3b8"}}>
          {(user.full_name||user.email||"U").slice(0,1).toUpperCase()}
        </div>
        <div>
          <strong style={{color:"#64748b"}}>{user.full_name||"Sin nombre"}</strong>
          <span>{user.email||"Sin email"}</span>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#94a3b8"}}>
          Archivado: {user.deleted_at ? new Date(user.deleted_at).toLocaleDateString("es-AR") : "—"}
        </span>
        <button className="adm-restore-btn" onClick={onRestore} disabled={saving}>
          ↩ Restaurar
        </button>
      </div>
    </article>
  );
}