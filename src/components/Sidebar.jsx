import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Sidebar.css";
import logoImg from "../assets/logo.jpg";

const MENU_SECTIONS = [
  {
    label: "ANÁLISIS",
    items: [
      { id: "managerDashboard", label: "Dashboard",          icon: "▦" },
      { id: "importer",         label: "BI Comercial",       icon: "📊" },
      { id: "salesAnalytics",   label: "Análisis Comercial", icon: "◑" },
    ],
  },
  {
    label: "COMERCIAL",
    items: [
      { id: "accounts",      label: "Clientes / Cuentas",    icon: "◎" },
      { id: "products",      label: "Productos / Share Kit", icon: "⬡" },
      { id: "opportunities", label: "Oportunidades",         icon: "◇" },
      { id: "campaigns",     label: "Campañas",              icon: "◉" },
    ],
  },
  {
    label: "OPERACIONES",
    items: [
      { id: "todayActions", label: "Acciones Hoy",  icon: "◷" },
      { id: "visits",       label: "Visitas",        icon: "◌" },
      { id: "calendar",     label: "Calendario",     icon: "▦" },
      { id: "tenders",     label: "Cotizaciones",   icon: "📄" },
      { id: "adminUsers",   label: "Administración", icon: "⊞" },
    ],
  },
];

const ALL_IDS = MENU_SECTIONS.flatMap((s) => s.items.map((i) => i.id));

function loadOrder() {
  try {
    const saved = localStorage.getItem("sidebar_order");
    if (!saved) return null;
    const ids = JSON.parse(saved);
    const ordered = ids.map((id) => ALL_IDS.find((x) => x === id)).filter(Boolean);
    const missing  = ALL_IDS.filter((id) => !ids.includes(id));
    return [...ordered, ...missing];
  } catch { return null; }
}

function saveOrder(ids) {
  localStorage.setItem("sidebar_order", JSON.stringify(ids));
}

function buildSections(orderedIds) {
  return MENU_SECTIONS.map((section) => ({
    ...section,
    items: section.items.sort((a, b) => {
      const ai = orderedIds.indexOf(a.id);
      const bi = orderedIds.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }),
  }));
}

export default function Sidebar({ profile, onNavigate }) {
  const [dark,       setDark]       = useState(() => localStorage.getItem("theme") === "dark");
  const [editing,    setEditing]    = useState(false);
  const [orderedIds, setOrderedIds] = useState(() => loadOrder() || ALL_IDS);
  const dragIdx = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  /* ── Permisos ─────────────────────────────────────────────────────── */
  const canSee = (module) => {
    // super_admin ve todo siempre
    if (profile?.role === "super_admin") return true;
    // Administración solo para manager y super_admin
    if (module === "adminUsers") return profile?.role === "manager";
    // El resto: respeta allowed_modules del perfil
    return profile?.allowed_modules?.includes(module);
  };

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function onDragStart(id) { dragIdx.current = id; }

  function onDragEnter(id) {
    if (dragIdx.current === id) return;
    const next = [...orderedIds];
    const fromIdx = next.indexOf(dragIdx.current);
    const toIdx   = next.indexOf(id);
    if (fromIdx === -1 || toIdx === -1) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragIdx.current);
    setOrderedIds(next);
  }

  function onDragEnd() {
    saveOrder(orderedIds);
    dragIdx.current = null;
  }

  function resetOrder() {
    setOrderedIds(ALL_IDS);
    localStorage.removeItem("sidebar_order");
  }

  const sections     = buildSections(orderedIds);
  const initials     = (profile?.full_name || profile?.email || "U").slice(0, 1).toUpperCase();
  const roleLabel    = { super_admin: "Super Admin", manager: "Manager", seller: "Vendedor" }[profile?.role] || profile?.role || "Usuario";
  const email        = profile?.email || "";
  const emailDisplay = email.length > 24 ? email.slice(0, 22) + "…" : email;

  return (
    <aside className="sidebar">

      <div className="sidebar-brand">
        <img src={logoImg} alt="STORING Medical" className="sidebar-brand__img"/>
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
            <span className="sidebar-nav__group-label">MÓDULOS</span>
            <button
              className={`sidebar-edit-btn ${editing ? "active" : ""}`}
              onClick={() => { setEditing((e) => !e); if (editing) saveOrder(orderedIds); }}
              title={editing ? "Guardar orden" : "Editar orden"}
            >
              {editing ? "✓ Listo" : "✎ Editar"}
            </button>
          </div>

          {editing && <p className="sidebar-edit-hint">Arrastrá para reordenar</p>}

          {sections.map((section, si) => {
            const visible = section.items.filter((item) => canSee(item.id));
            if (visible.length === 0) return null;
            return (
              <div key={section.label} className="sidebar-section">
                {si > 0 && <div className="sidebar-section__divider"/>}
                <span className="sidebar-section__label">{section.label}</span>
                {visible.map((item) => (
                  <div
                    key={item.id}
                    className={`sidebar-nav__item-wrap ${editing ? "editing" : ""}`}
                    draggable={editing}
                    onDragStart={() => onDragStart(item.id)}
                    onDragEnter={() => onDragEnter(item.id)}
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
              </div>
            );
          })}

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
              <div className="sidebar-theme-toggle__knob"/>
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