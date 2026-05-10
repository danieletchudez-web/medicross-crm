import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Sidebar.css";
import logoImg from "../assets/logo.jpg";

const DEFAULT_MENU = [
  { id: "managerDashboard", label: "Dashboard",             icon: "▦" },
  { id: "salesAnalytics",   label: "Análisis Comercial",    icon: "◑" },
  { id: "importer",         label: "BI Comercial",          icon: "📊" },
  { id: "accounts",         label: "Clientes / Cuentas",    icon: "◎" },
  { id: "products",         label: "Productos / Share Kit", icon: "⬡" },
  { id: "opportunities",    label: "Oportunidades",         icon: "◇" },
  { id: "campaigns",        label: "Campañas",              icon: "◉" },
  { id: "todayActions",     label: "Acciones Hoy",          icon: "◷" },
  { id: "visits",           label: "Visitas",               icon: "◌" },
  { id: "calendar",         label: "Calendario",            icon: "▦" },
  { id: "adminUsers",       label: "Administración",        icon: "⊞" },
];

function loadOrder() {
  try {
    const saved = localStorage.getItem("sidebar_order");
    if (!saved) return null;
    const ids = JSON.parse(saved);
    // Reconstruir en el orden guardado, agregando nuevos items al final
    const ordered = ids.map((id) => DEFAULT_MENU.find((m) => m.id === id)).filter(Boolean);
    const missing  = DEFAULT_MENU.filter((m) => !ids.includes(m.id));
    return [...ordered, ...missing];
  } catch { return null; }
}

function saveOrder(menu) {
  localStorage.setItem("sidebar_order", JSON.stringify(menu.map((m) => m.id)));
}

export default function Sidebar({ profile, onNavigate }) {
  const [dark, setDark]       = useState(() => localStorage.getItem("theme") === "dark");
  const [editing, setEditing] = useState(false);
  const [menu, setMenu]       = useState(() => loadOrder() || DEFAULT_MENU);

  // Drag state
  const dragIdx  = useRef(null);
  const dragOver = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const canSee = (module) => {
    if (profile?.role === "super_admin") return true;
    return profile?.allowed_modules?.includes(module);
  };

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  /* ── Drag & Drop ── */
  function onDragStart(i) { dragIdx.current = i; }

  function onDragEnter(i) {
    if (dragIdx.current === i) return;
    dragOver.current = i;
    const next = [...menu];
    const item = next.splice(dragIdx.current, 1)[0];
    next.splice(i, 0, item);
    dragIdx.current = i;
    setMenu(next);
  }

  function onDragEnd() {
    dragIdx.current = null;
    dragOver.current = null;
    saveOrder(menu);
  }

  function resetOrder() {
    setMenu(DEFAULT_MENU);
    localStorage.removeItem("sidebar_order");
  }

  const visibleMenu = menu.filter((item) => canSee(item.id));

  const initials   = (profile?.full_name || profile?.email || "U").slice(0, 1).toUpperCase();
  const roleLabel  = { super_admin: "Super Admin", manager: "Manager", seller: "Vendedor" }[profile?.role] || profile?.role || "Usuario";
  const email      = profile?.email || "";
  const emailDisplay = email.length > 24 ? email.slice(0, 22) + "…" : email;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logoImg} alt="STORING Medical" className="sidebar-brand__img" />
      </div>

      <div className="sidebar-body">

        <div className="sidebar-user">
          <div className="sidebar-user__row">
            <div className="sidebar-user__avatar">{initials}</div>
            <div className="sidebar-user__info">
              <strong>{profile?.full_name || "Usuario"}</strong>
              <small title={email}>{emailDisplay}</small>
            </div>
          </div>
          <span className="sidebar-user__role">{roleLabel}</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav__group-row">
            <span className="sidebar-nav__group-label">Módulos</span>
            <button
              className={`sidebar-edit-btn ${editing ? "active" : ""}`}
              onClick={() => { setEditing((e) => !e); if (editing) saveOrder(menu); }}
              title={editing ? "Guardar orden" : "Editar orden"}
            >
              {editing ? "✓ Listo" : "✎ Editar"}
            </button>
          </div>

          {editing && (
            <p className="sidebar-edit-hint">Arrastrá para reordenar</p>
          )}

          {visibleMenu.map((item, i) => (
            <div
              key={item.id}
              className={`sidebar-nav__item-wrap ${editing ? "editing" : ""}`}
              draggable={editing}
              onDragStart={() => onDragStart(menu.indexOf(item))}
              onDragEnter={() => onDragEnter(menu.indexOf(item))}
              onDragEnd={onDragEnd}
              onDragOver={(e) => e.preventDefault()}
            >
              {editing && <span className="sidebar-drag-handle">⠿</span>}
              <button
                type="button"
                className="sidebar-nav__item"
                onClick={() => { if (!editing) onNavigate(item.id); }}
                style={{ cursor: editing ? "grab" : "pointer" }}
              >
                <span className="sidebar-nav__icon">{item.icon}</span>
                <span className="sidebar-nav__label">{item.label}</span>
              </button>
            </div>
          ))}

          {editing && (
            <button className="sidebar-reset-btn" onClick={resetOrder}>
              ↺ Restablecer orden
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-theme-toggle" onClick={() => setDark((d) => !d)}>
            <span className="sidebar-theme-toggle__icon">{dark ? "☀" : "☽"}</span>
            <span className="sidebar-theme-toggle__label">{dark ? "Modo claro" : "Modo oscuro"}</span>
            <div className={`sidebar-theme-toggle__switch ${dark ? "on" : ""}`}>
              <div className="sidebar-theme-toggle__knob" />
            </div>
          </div>
          <button type="button" className="sidebar-logout" onClick={logout}>
            <span className="sidebar-logout__icon">↪</span>
            Cerrar sesión
          </button>
        </div>

      </div>
    </aside>
  );
}