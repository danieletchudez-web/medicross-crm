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
const MOBILE_CORE_MODULES = ["todayActions","visits","calendar","accounts","opportunities"];
const MOBILE_MANAGER_MODULES = ["managerDashboard","todayActions","visits","calendar","accounts","opportunities","cotizador","tenders"];
const MOBILE_QUOTES_MODULES = ["accounts","opportunities","tenders","cotizador"];
const MOBILE_BI_MODULES = ["managerDashboard","importer","salesAnalytics"];

const READ_ONLY_MODULES = [
  "managerDashboard","salesAnalytics","accounts","products","opportunities",
  "campaigns","todayActions","visits","calendar","tenders","cotizador",
];

const QUOTES_MODULES = ["accounts","products","opportunities","tenders","cotizador","preciosHistoricos"];
const BI_MODULES = ["managerDashboard","importer","salesAnalytics"];

const ACTIONS = [
  { id: "view",          label: "Ver"              },
  { id: "create",        label: "Crear"            },
  { id: "edit",          label: "Editar"           },
  { id: "delete",        label: "Borrar/archivar"  },
  { id: "export",        label: "Exportar"         },
  { id: "approve_users", label: "Aprobar usuarios" },
];

const PRESETS = [
  {
    id: "read_only",
    label: "Solo lectura",
    role: "seller",
    modules: READ_ONLY_MODULES,
    mobileModules: ["managerDashboard","accounts","products","todayActions","calendar"],
    actions: ["view"],
    description: "Consulta CRM sin crear, editar, borrar ni exportar.",
  },
  {
    id: "seller",
    label: "Vendedor",
    role: "seller",
    modules: SELLER_MODULES,
    mobileModules: MOBILE_CORE_MODULES,
    actions: ["view","create","edit"],
    description: "Carga visitas, clientes y oportunidades del circuito comercial.",
  },
  {
    id: "manager",
    label: "Gerente",
    role: "manager",
    modules: MANAGER_MODULES.filter(m => m !== "adminUsers"),
    mobileModules: MOBILE_MANAGER_MODULES,
    actions: ["view","create","edit","export"],
    description: "Supervisa operación, tableros y exportaciones sin administrar usuarios.",
  },
  {
    id: "quotes",
    label: "Cotizaciones",
    role: "seller",
    modules: QUOTES_MODULES,
    mobileModules: MOBILE_QUOTES_MODULES,
    actions: ["view","create","edit","export"],
    description: "Foco en licitaciones, cotizador, precios y cuentas relacionadas.",
  },
  {
    id: "bi",
    label: "BI",
    role: "manager",
    modules: BI_MODULES,
    mobileModules: MOBILE_BI_MODULES,
    actions: ["view","export"],
    description: "Acceso a análisis comercial, importación e indicadores ejecutivos.",
  },
  {
    id: "admin",
    label: "Admin",
    role: "super_admin",
    modules: FULL_MODULES,
    mobileModules: MOBILE_MANAGER_MODULES,
    actions: ACTIONS.map(a => a.id),
    description: "Control total de módulos, roles, permisos y aprobaciones.",
  },
];

const OPTIONAL_PROFILE_FIELDS = [
  "allowed_actions",
  "mobile_allowed_modules",
  "permission_preset",
  "approved_at",
  "approved_by",
  "deleted_at",
  "deleted_by",
];

function optionalColumnError(error) {
  return /column|schema cache|could not find|does not exist/i.test(error?.message || "");
}

function inferActions(user) {
  if (Array.isArray(user.allowed_actions) && user.allowed_actions.length) return user.allowed_actions;
  if (user.role === "super_admin") return ACTIONS.map(a => a.id);
  if (user.role === "manager") return ["view","create","edit","export"];
  return user.approved ? ["view","create","edit"] : ["view"];
}

function mobileModulesForUser(user) {
  return Array.isArray(user.mobile_allowed_modules) ? user.mobile_allowed_modules : null;
}

function moduleEnabled(user, moduleId) {
  return (user.allowed_modules || []).includes(moduleId);
}

function mobileModuleEnabled(user, moduleId) {
  return (mobileModulesForUser(user) || []).includes(moduleId);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const [userView,    setUserView]    = useState("pending");
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [auditLogs,   setAuditLogs]   = useState([]);
  const canAdminUsers = profile?.role === "super_admin";

  useEffect(() => { loadUsers(); loadAuditLogs(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles").select("*").order("created_at", { ascending: false });
    if (error) { alert("Error cargando usuarios: " + error.message); setUsers([]); }
    else setUsers(data || []);
    setLoading(false);
  }

  async function loadAuditLogs() {
    const { data } = await supabase
      .from("admin_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12);
    setAuditLogs(data || []);
  }

  const activeUsers   = useMemo(() => users.filter(u => u.is_active !== false), [users]);
  const archivedUsers = useMemo(() => users.filter(u => u.is_active === false),  [users]);
  const pendingUsers  = useMemo(() => activeUsers.filter(u => !u.approved), [activeUsers]);
  const approvedUsers = useMemo(() => activeUsers.filter(u => u.approved),  [activeUsers]);

  const filteredUsers = useMemo(() => {
    const source = userView === "archived" ? archivedUsers : userView === "pending" ? pendingUsers : approvedUsers;
    const q = search.toLowerCase().trim();
    if (!q) return source;
    return source.filter(u =>
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email     || "").toLowerCase().includes(q) ||
      (u.role      || "").toLowerCase().includes(q)
    );
  }, [search, userView, pendingUsers, approvedUsers, archivedUsers]);

  const stats = useMemo(() => ({
    total:    activeUsers.length,
    approved: activeUsers.filter(u =>  u.approved).length,
    pending:  activeUsers.filter(u => !u.approved).length,
    admins:   activeUsers.filter(u =>  u.role === "super_admin").length,
    archived: archivedUsers.length,
  }), [activeUsers, archivedUsers]);

  async function logAdminEvent(event, targetUserId, changes) {
    await supabase.from("admin_audit_logs").insert([{
      event,
      target_user_id: targetUserId,
      actor_id: profile?.id || null,
      actor_email: profile?.email || null,
      changes,
      created_at: new Date().toISOString(),
    }]);
  }

  async function persistProfileUpdate(userId, payload) {
    const withUpdatedAt = { ...payload, updated_at: new Date().toISOString() };
    let { error } = await supabase.from("profiles").update(withUpdatedAt).eq("id", userId);
    if (error && optionalColumnError(error)) {
      const fallback = { ...withUpdatedAt };
      OPTIONAL_PROFILE_FIELDS.forEach(field => delete fallback[field]);
      ({ error } = await supabase.from("profiles").update(fallback).eq("id", userId));
      return { error, applied: fallback };
    }
    return { error, applied: withUpdatedAt };
  }

  async function updateUser(userId, changes, event = "profile_update") {
    if (!canAdminUsers) return;
    setSavingId(userId);
    const { error, applied } = await persistProfileUpdate(userId, changes);
    if (error) { alert("Error actualizando usuario: " + error.message); setSavingId(null); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...applied } : u));
    logAdminEvent(event, userId, changes).then(loadAuditLogs).catch(() => {});
    setSavingId(null);
  }

  function toggleModule(user, moduleId) {
    const current = user.allowed_modules || [];
    const currentMobile = mobileModulesForUser(user);
    const removing = current.includes(moduleId);
    const next = current.includes(moduleId)
      ? current.filter(m => m !== moduleId)
      : [...current, moduleId];
    const changes = { allowed_modules: next };
    if (currentMobile) changes.mobile_allowed_modules = currentMobile.filter(m => next.includes(m));
    if (removing && currentMobile?.includes(moduleId)) changes.mobile_allowed_modules = currentMobile.filter(m => m !== moduleId);
    updateUser(user.id, changes, "module_toggle");
  }

  function toggleMobileModule(user, moduleId) {
    if (!moduleEnabled(user, moduleId)) return;
    const current = mobileModulesForUser(user) || [];
    const next = current.includes(moduleId)
      ? current.filter(m => m !== moduleId)
      : [...current, moduleId];
    updateUser(user.id, { mobile_allowed_modules: next }, "mobile_module_toggle");
  }

  function copyDesktopToMobile(user) {
    updateUser(user.id, { mobile_allowed_modules: user.allowed_modules || [] }, "mobile_modules_copy_desktop");
  }

  function applyMobilePreset(user) {
    const desktop = new Set(user.allowed_modules || []);
    const next = MOBILE_CORE_MODULES.filter(moduleId => desktop.has(moduleId));
    updateUser(user.id, { mobile_allowed_modules: next }, "mobile_modules_preset");
  }

  function approveUser(user)  {
    updateUser(user.id, {
      approved: true,
      is_active: true,
      approved_at: new Date().toISOString(),
      approved_by: profile?.id || null,
    }, "user_approved");
  }

  function blockUser(user) {
    updateUser(user.id, {
      approved: false,
      is_active: false,
    }, "login_temporarily_blocked");
  }

  function applyPreset(user, presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    updateUser(user.id, {
      approved: true,
      is_active: true,
      role: preset.role,
      allowed_modules: preset.modules,
      mobile_allowed_modules: (preset.mobileModules || []).filter(m => preset.modules.includes(m)),
      allowed_actions: preset.actions,
      permission_preset: preset.id,
      approved_at: new Date().toISOString(),
      approved_by: profile?.id || null,
    }, `preset_${preset.id}`);
  }

  async function archiveUser(user) {
    await updateUser(user.id, {
      is_active:  false,
      approved:   false,
      deleted_at: new Date().toISOString(),
      deleted_by: profile?.id || null,
    }, "user_archived");
    setDeleteTarget(null);
  }

  async function restoreUser(user) {
    if (!confirm(`¿Restaurar acceso a ${user.full_name||user.email}?`)) return;
    await updateUser(user.id, {
      is_active:  true,
      approved:   true,
      deleted_at: null,
      deleted_by: null,
      approved_at: new Date().toISOString(),
      approved_by: profile?.id || null,
    }, "user_restored");
  }

  if (!canAdminUsers) {
    return (
      <Layout title="Administración de Usuarios" profile={profile} onNavigate={onNavigate}>
        <div className="admin-page">
          <section className="admin-guard-card">
            <h2>Administración restringida</h2>
            <p>Esta sección solo está disponible para perfiles Super Admin. Podés seguir usando los módulos habilitados desde el menú lateral.</p>
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Administración de Usuarios" profile={profile} onNavigate={onNavigate}>
      <div className="admin-page">

        {/* Header */}
        <section className="admin-header-card">
          <div>
            <h2>Usuarios y permisos</h2>
            <p>Aprobá accesos, definí roles y habilitá módulos visibles para cada usuario.</p>
          </div>
          <button className="admin-refresh-btn" onClick={loadUsers} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </section>

        {/* KPIs */}
        <section className="admin-kpi-grid">
          <Kpi title="Usuarios activos" value={stats.total} accent="blue" />
          <Kpi title="Aprobados" value={stats.approved} accent="green" />
          <Kpi title="Pendientes" value={stats.pending} accent="amber" />
          <Kpi title="Super Admin" value={stats.admins} accent="violet" />
          <Kpi title="Archivados" value={stats.archived} accent="slate" />
        </section>

        {/* Toolbar */}
        <section className="admin-toolbar">
          <div>
            <h3>{userView === "pending" ? "Pendientes de aprobación" : userView === "archived" ? "Usuarios archivados" : "Usuarios aprobados"}</h3>
            <span>{filteredUsers.length} usuarios visibles</span>
          </div>
          <div className="admin-toolbar-actions">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email o rol..."
            />
            <button
              className={`adm-tab-btn ${userView === "pending" ? "active" : ""}`}
              onClick={() => setUserView("pending")}
            >
              Pendientes ({stats.pending})
            </button>
            <button
              className={`adm-tab-btn ${userView === "approved" ? "active" : ""}`}
              onClick={() => setUserView("approved")}
            >
              Aprobados ({stats.approved})
            </button>
            <button
              className={`adm-tab-btn ${userView === "archived" ? "active" : ""}`}
              onClick={() => setUserView("archived")}
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
              {userView === "pending" ? "No hay usuarios pendientes." : userView === "archived" ? "No hay usuarios archivados." : "No hay usuarios aprobados para mostrar."}
            </p>
          ) : (
            <>
              <div className="admin-desktop-table">
                <table>
                  <thead>
                    {userView === "archived" ? (
                      <tr>
                        <th>Usuario</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Fecha de archivo</th>
                        <th>Acción</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Usuario</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Preset</th>
                        <th>Permisos</th>
                        <th>Módulos PC / móvil</th>
                        <th>Auditoría</th>
                        <th>Archivar</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {filteredUsers.map(user => (
                      userView === "archived" ? (
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
                          onRoleChange={role => updateUser(user.id, { role }, "role_change")}
                          onApprove={() => approveUser(user)}
                          onBlock={() => blockUser(user)}
                          onToggleModule={moduleId => toggleModule(user, moduleId)}
                          onToggleMobileModule={moduleId => toggleMobileModule(user, moduleId)}
                          onCopyDesktopToMobile={() => copyDesktopToMobile(user)}
                          onApplyMobilePreset={() => applyMobilePreset(user)}
                          onApplyPreset={presetId => applyPreset(user, presetId)}
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
                  userView === "archived" ? (
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
                      onRoleChange={role => updateUser(user.id, { role }, "role_change")}
                      onApprove={() => approveUser(user)}
                      onBlock={() => blockUser(user)}
                      onToggleModule={moduleId => toggleModule(user, moduleId)}
                      onToggleMobileModule={moduleId => toggleMobileModule(user, moduleId)}
                      onCopyDesktopToMobile={() => copyDesktopToMobile(user)}
                      onApplyMobilePreset={() => applyMobilePreset(user)}
                      onApplyPreset={presetId => applyPreset(user, presetId)}
                      onArchive={() => setDeleteTarget(user)}
                    />
                  )
                ))}
              </div>
            </>
          )}
        </section>

        <section className="admin-audit-card">
          <div className="admin-audit-card__head">
            <div>
              <h3>Auditoría de administración</h3>
              <p>Cambios recientes de roles, permisos, aprobaciones y archivado.</p>
            </div>
            <button className="admin-refresh-btn" onClick={loadAuditLogs}>Actualizar auditoría</button>
          </div>
          {auditLogs.length === 0 ? (
            <p className="admin-empty">No hay eventos de auditoría visibles todavía.</p>
          ) : (
            <div className="admin-audit-list">
              {auditLogs.map(log => (
                <article key={log.id || `${log.event}-${log.created_at}`}>
                  <strong>{log.event}</strong>
                  <span>{log.actor_email || "Sistema"} · {formatDateTime(log.created_at)}</span>
                  <small>{log.target_user_id || "Sin usuario objetivo"}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Nota informativa */}
        <div className="adm-info-box">
          <span className="adm-info-box__icon">Seguro</span>
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
function Kpi({ title, value, accent }) {
  return (
    <article className={`admin-kpi admin-kpi--${accent || "blue"}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

/* ─── Fila usuario activo ────────────────────────────────────────────── */
function UserRow({
  user,
  saving,
  currentProfile,
  onRoleChange,
  onApprove,
  onBlock,
  onToggleModule,
  onToggleMobileModule,
  onCopyDesktopToMobile,
  onApplyMobilePreset,
  onApplyPreset,
  onArchive,
}) {
  const isSelf = user.id === currentProfile?.id;
  const isSuperAdmin = user.role === "super_admin";
  const userActions = inferActions(user);

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
          {user.approved ? "Aprobado" : "Pendiente"}
        </button>
      </td>
      <td>
        <select
          className="admin-select admin-preset-select"
          value={user.permission_preset || ""}
          onChange={e => onApplyPreset(e.target.value)}
          disabled={saving||isSelf}
        >
          <option value="">Elegir preset</option>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <p className="adm-preset-help">
          {PRESETS.find(p => p.id === user.permission_preset)?.description || "Aplicá un preset para ordenar módulos y acciones."}
        </p>
      </td>
      <td>
        <div className="adm-action-grid">
          {ACTIONS.map(action => (
            <span key={action.id} className={`adm-action-chip ${userActions.includes(action.id) ? "on" : ""}`}>
              {action.label}
            </span>
          ))}
        </div>
      </td>
      <td>
        <ModuleScopeGrid
          user={user}
          saving={saving}
          onToggleModule={onToggleModule}
          onToggleMobileModule={onToggleMobileModule}
          onCopyDesktopToMobile={onCopyDesktopToMobile}
          onApplyMobilePreset={onApplyMobilePreset}
        />
      </td>
      <td>
        <div className="adm-meta-list">
          <span>Último acceso: {formatDateTime(user.last_sign_in_at || user.last_access_at)}</span>
          <span>Creado: {formatDateTime(user.created_at)}</span>
          <span>Aprobado: {formatDateTime(user.approved_at)}</span>
          <span>Por: {user.approved_by || user.created_by || "—"}</span>
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
            Archivar
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

function ModuleScopeGrid({
  user,
  saving,
  onToggleModule,
  onToggleMobileModule,
  onCopyDesktopToMobile,
  onApplyMobilePreset,
}) {
  const hasMobileConfig = Array.isArray(user.mobile_allowed_modules);

  return (
    <div className="adm-module-scope">
      <div className="adm-module-scope__head">
        <span>PC</span>
        <small>Permisos completos</small>
      </div>
      <div className="module-grid">
        {MODULES.map(m => (
          <label key={m.id} className="module-check">
            <input
              type="checkbox"
              checked={moduleEnabled(user, m.id)}
              onChange={() => onToggleModule(m.id)}
              disabled={saving}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      <div className="adm-module-scope__head adm-module-scope__head--mobile">
        <span>Móvil</span>
        <small>{hasMobileConfig ? "Menú reducido en teléfono/PWA" : "Sin filtro: usa módulos PC"}</small>
      </div>
      <div className="adm-module-tools">
        <button type="button" onClick={onApplyMobilePreset} disabled={saving}>
          Operativo móvil
        </button>
        <button type="button" onClick={onCopyDesktopToMobile} disabled={saving}>
          Copiar PC
        </button>
      </div>
      <div className="module-grid module-grid--mobile">
        {MODULES.map(m => {
          const desktopEnabled = moduleEnabled(user, m.id);
          return (
            <label key={m.id} className={`module-check ${!desktopEnabled ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={mobileModuleEnabled(user, m.id)}
                onChange={() => onToggleMobileModule(m.id)}
                disabled={saving || !desktopEnabled}
              />
              <span>{m.label}</span>
            </label>
          );
        })}
      </div>
    </div>
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
          Restaurar
        </button>
      </td>
    </tr>
  );
}

/* ─── Mobile usuario activo ──────────────────────────────────────────── */
function UserMobileCard({
  user,
  saving,
  currentProfile,
  onRoleChange,
  onApprove,
  onBlock,
  onToggleModule,
  onToggleMobileModule,
  onCopyDesktopToMobile,
  onApplyMobilePreset,
  onApplyPreset,
  onArchive,
}) {
  const isSelf = user.id === currentProfile?.id;
  const isSuperAdmin = user.role === "super_admin";
  const userActions = inferActions(user);

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
        {user.approved ? "Aprobado" : "Pendiente"}
      </button>
      <div className="mobile-admin-row mobile-admin-row--stack">
        <label>Preset</label>
        <select
          className="admin-select"
          value={user.permission_preset || ""}
          onChange={e => onApplyPreset(e.target.value)}
          disabled={saving||isSelf}
        >
          <option value="">Elegir preset</option>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <p className="adm-preset-help">
          {PRESETS.find(p => p.id === user.permission_preset)?.description || "Aplicá un preset para ordenar módulos y acciones."}
        </p>
      </div>
      <div className="adm-action-grid">
        {ACTIONS.map(action => (
          <span key={action.id} className={`adm-action-chip ${userActions.includes(action.id) ? "on" : ""}`}>
            {action.label}
          </span>
        ))}
      </div>
      <ModuleScopeGrid
        user={user}
        saving={saving}
        onToggleModule={onToggleModule}
        onToggleMobileModule={onToggleMobileModule}
        onCopyDesktopToMobile={onCopyDesktopToMobile}
        onApplyMobilePreset={onApplyMobilePreset}
      />
      <div className="adm-meta-list">
        <span>Último acceso: {formatDateTime(user.last_sign_in_at || user.last_access_at)}</span>
        <span>Creado: {formatDateTime(user.created_at)}</span>
        <span>Aprobado: {formatDateTime(user.approved_at)}</span>
      </div>
      <div className="quick-actions">
        {!isSelf && !isSuperAdmin && (
          <button className="adm-archive-btn" onClick={onArchive} disabled={saving}>
            Archivar
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
          Restaurar
        </button>
      </div>
    </article>
  );
}
