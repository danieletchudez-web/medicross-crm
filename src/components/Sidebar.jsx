import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BellRing,
  Building2,
  Calculator,
  CalendarDays,
  CalendarPlus,
  ChartPie,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Handshake,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PackageOpen,
  Settings,
  ShieldCheck,
  Target,
  Truck,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { canOpenModule, getFirstOpenModule } from "../lib/moduleAccess";
import useNotificationCount from "../hooks/useNotificationCount";
import useTaskAlerts from "../hooks/useTaskAlerts";
import "./Sidebar.css";
import logoImg from "../assets/logo.jpg";

const MENU_SECTIONS = [
  {
    label: "ANÁLISIS",
    items: [
      { id: "managerDashboard", label: "Dashboard",          icon: LayoutDashboard },
      { id: "importer",         label: "BI Comercial",       icon: BarChart3 },
      { id: "salesAnalytics",   label: "Análisis Comercial", icon: ChartPie },
    ],
  },
  {
    label: "COMERCIAL",
    items: [
      { id: "accounts",      label: "Clientes / Cuentas",    icon: Building2 },
      { id: "products",      label: "Productos / Share Kit", icon: PackageOpen },
      { id: "suppliers",     label: "Proveedores",           icon: Truck },
      { id: "opportunities",  label: "Oportunidades",         icon: Target },
      { id: "campaigns",     label: "Campañas",              icon: Megaphone },
      { id: "businessUnits", label: "Unidades de Negocio",   icon: Layers },
    ],
  },
  {
    label: "COTIZACIONES",
    items: [
      { id: "cotizador", label: "Cotizador",    icon: Calculator },
      { id: "tenders",   label: "Licitaciones", icon: FileText },
    ],
  },
  {
    label: "OPERACIONES",
    items: [
      { id: "notifications", label: "Centro de Alertas", icon: BellRing },
      { id: "tasks",         label: "Tareas",             icon: CheckSquare },
      { id: "todayActions",  label: "Acciones Hoy",      icon: Clock3 },
      { id: "visits",        label: "Visitas",            icon: Handshake },
      { id: "calendar",      label: "Calendario",         icon: CalendarDays },
      { id: "adminUsers",    label: "Administración",     icon: ShieldCheck },
      { id: "settings",      label: "Configuración",      icon: Settings },
    ],
  },
];

const ALL_IDS = MENU_SECTIONS.flatMap(s => s.items.map(i => i.id));
const MOBILE_NAV = [
  { id: "todayActions",  label: "Hoy",       icon: Clock3 },
  { id: "accounts",      label: "Clientes",  icon: Building2 },
  { id: "visits",        label: "Visitas",   icon: Handshake },
  { id: "calendar",      label: "Agenda",    icon: CalendarDays },
  { id: "notifications", label: "Alertas",   icon: BellRing },
];

function loadOrder() {
  try {
    const saved = localStorage.getItem("sidebar_order");
    if (!saved) return null;
    const ids = JSON.parse(saved);
    const ordered = ids.map(id => ALL_IDS.find(x => x === id)).filter(Boolean);
    const missing  = ALL_IDS.filter(id => !ids.includes(id));
    return [...ordered, ...missing];
  } catch { return null; }
}

function saveOrder(ids) { localStorage.setItem("sidebar_order", JSON.stringify(ids)); }

function SidebarIcon({ icon: Icon }) {
  return <Icon aria-hidden="true" strokeWidth={2.15} />;
}

function buildSections(orderedIds) {
  return MENU_SECTIONS.map(section => ({
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
  const [editing,    setEditing]    = useState(false);
  const [orderedIds, setOrderedIds] = useState(() => loadOrder() || ALL_IDS);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [collapsed,  setCollapsed]  = useState(() => localStorage.getItem("sidebar_collapsed") !== "false");
  const [favorites,  setFavorites]  = useState(() => {
    try { return JSON.parse(localStorage.getItem("sidebar_favorites") || "[]"); }
    catch { return []; }
  });
  const [tooltip, setTooltip] = useState(null); // { label, y }
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia?.("(max-width: 768px)").matches || false);
  const dragIdx = useRef(null);
  const notificationCount = useNotificationCount(profile?.id);
  const { count: taskAlertCount } = useTaskAlerts(profile?.id);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.removeItem("theme");
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  useEffect(() => {
    const fn = () => { if (window.innerWidth > 768) setMenuOpen(false); };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 768px)");
    if (!media) return;
    const onChange = e => setIsMobileViewport(e.matches);
    setIsMobileViewport(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  // Sync collapsed state across all mounted Sidebar instances (keep-alive)
  useEffect(() => {
    function onSync(e) {
      setCollapsed(e.detail.collapsed);
      if (e.detail.collapsed) { setEditing(false); setTooltip(null); }
    }
    window.addEventListener("sidebar:collapsed", onSync);
    return () => window.removeEventListener("sidebar:collapsed", onSync);
  }, []);

  function showTooltip(e, label) {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, y: r.top + r.height / 2 });
  }

  function hideTooltip() { setTooltip(null); }

  const canSee = module => {
    return canOpenModule(profile, module, isMobileViewport);
  };
  const homeModule = getFirstOpenModule(profile, isMobileViewport) || "settings";

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function handleNavigate(id, data) {
    setMenuOpen(false);
    setEditing(false);
    setTooltip(null);
    onNavigate(id, data);
  }

  function handleToggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed", String(next));
    window.dispatchEvent(new CustomEvent("sidebar:collapsed", { detail: { collapsed: next } }));
    setTooltip(null);
    if (next) setEditing(false);
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
  function onDragEnd() { saveOrder(orderedIds); dragIdx.current = null; }
  function resetOrder() { setOrderedIds(ALL_IDS); localStorage.removeItem("sidebar_order"); }
  function toggleFavorite(id) {
    const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id].slice(-4);
    setFavorites(next);
    localStorage.setItem("sidebar_favorites", JSON.stringify(next));
  }

  const sections = buildSections(orderedIds);

  return (
    <>
      <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>

        <button
          type="button"
          className={`sidebar-pin-btn ${!collapsed ? "pinned" : ""}`}
          onClick={handleToggle}
          aria-label={collapsed ? "Abrir sidebar" : "Cerrar sidebar"}
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        </button>

        {/* Brand / logo */}
        <div
          className="sidebar-brand"
          onClick={() => handleNavigate(homeModule)}
          style={{ cursor: "pointer" }}
          aria-label="Ir al inicio"
        >
          <img src={logoImg} alt="MediCross Productos Médicos" className="sidebar-brand__img" />
          <span className="sidebar-brand__mark">M</span>
        </div>

        {/* Botón hamburguesa — solo visible en móvil via CSS */}
        <button
          className={`sidebar-hamburger ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Abrir menú"
        >
          <span/><span/><span/>
        </button>

        {/* Drawer / body */}
        <div className={`sidebar-body ${menuOpen ? "open" : ""}`}>

          <nav className="sidebar-nav">
            <div className="sidebar-quick">
              {canSee("visits") && (
                <button
                  onClick={() => handleNavigate("visits", { action: "create", source: "sidebarQuickAction" })}
                  aria-label="Nueva visita"
                  onMouseEnter={(e) => showTooltip(e, "Nueva visita")}
                  onMouseLeave={hideTooltip}
                >
                  <span><CalendarPlus aria-hidden="true"/></span>
                  <em>Visita</em>
                </button>
              )}
              {canSee("accounts") && (
                <button
                  onClick={() => handleNavigate("accounts")}
                  aria-label="Nuevo cliente"
                  onMouseEnter={(e) => showTooltip(e, "Nuevo cliente")}
                  onMouseLeave={hideTooltip}
                >
                  <span><Building2 aria-hidden="true"/></span>
                  <em>Cliente</em>
                </button>
              )}
              {canSee("opportunities") && (
                <button
                  onClick={() => handleNavigate("opportunities")}
                  aria-label="Nueva oportunidad"
                  onMouseEnter={(e) => showTooltip(e, "Nueva oportunidad")}
                  onMouseLeave={hideTooltip}
                >
                  <span><CircleDollarSign aria-hidden="true"/></span>
                  <em>Oportunidad</em>
                </button>
              )}
            </div>

            <div className="sidebar-nav__group-row">
              <span className="sidebar-nav__group-label">MÓDULOS</span>
              <button
                className={`sidebar-edit-btn ${editing ? "active" : ""}`}
                onClick={() => { setEditing(e => !e); if (editing) saveOrder(orderedIds); }}
                title={editing ? "Guardar orden" : "Editar orden"}
              >
                {editing ? "✓ Listo" : "✎ Editar"}
              </button>
            </div>

            {editing && <p className="sidebar-edit-hint">Arrastrá para reordenar</p>}

            {favorites.length > 0 && (
              <div className="sidebar-section">
                <span className="sidebar-section__label">FRECUENTES</span>
                {favorites.map(id => {
                  const item = MENU_SECTIONS.flatMap(s => s.items).find(i => i.id === id);
                  if (!item || !canSee(id)) return null;
                  return (
                    <button
                      key={id}
                      className="sidebar-nav__item sidebar-nav__item--fav"
                      onClick={() => handleNavigate(id)}
                      aria-label={item.label}
                      onMouseEnter={(e) => showTooltip(e, item.label)}
                      onMouseLeave={hideTooltip}
                    >
                      <span className="sidebar-nav__icon"><SidebarIcon icon={item.icon} /></span>
                      <span className="sidebar-nav__label">{item.label}</span>
                      {item.id === "notifications" && notificationCount > 0 && <span className="sidebar-nav__badge">{notificationCount > 99 ? "99+" : notificationCount}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {sections.map((section, si) => {
              const visible = section.items.filter(item => canSee(item.id));
              if (visible.length === 0) return null;
              return (
                <div key={section.label} className="sidebar-section">
                  {si > 0 && <div className="sidebar-section__divider"/>}
                  <span className="sidebar-section__label">{section.label}</span>
                  {visible.map(item => (
                    <div
                      key={item.id}
                      className={`sidebar-nav__item-wrap ${editing ? "editing" : ""}`}
                      draggable={editing}
                      onDragStart={() => onDragStart(item.id)}
                      onDragEnter={() => onDragEnter(item.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={e => e.preventDefault()}
                    >
                      {editing && <span className="sidebar-drag-handle">⠿</span>}
                      <button
                        type="button"
                        className="sidebar-nav__item"
                        onClick={() => { if (!editing) handleNavigate(item.id); }}
                        style={{ cursor: editing ? "grab" : "pointer" }}
                        aria-label={item.label}
                        onMouseEnter={(e) => showTooltip(e, item.label)}
                        onMouseLeave={hideTooltip}
                      >
                        <span className="sidebar-nav__icon"><SidebarIcon icon={item.icon} /></span>
                        <span className="sidebar-nav__label">{item.label}</span>
                        {item.id === "notifications" && notificationCount > 0 && <span className="sidebar-nav__badge">{notificationCount > 99 ? "99+" : notificationCount}</span>}
                        {item.id === "tasks" && taskAlertCount > 0 && <span className="sidebar-nav__badge sidebar-nav__badge--red">{taskAlertCount > 9 ? "9+" : taskAlertCount}</span>}
                      </button>
                      {editing && (
                        <button
                          type="button"
                          className={`sidebar-fav-btn ${favorites.includes(item.id) ? "active" : ""}`}
                          onClick={() => toggleFavorite(item.id)}
                          title="Marcar como frecuente"
                        >
                          ★
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {editing && (
              <button className="sidebar-reset-btn" onClick={resetOrder}>↺ Restablecer orden</button>
            )}
          </nav>

          <div className="sidebar-footer">
            <button
              type="button"
              className="sidebar-logout"
              onClick={logout}
              aria-label="Cerrar sesión"
              onMouseEnter={(e) => showTooltip(e, "Cerrar sesión")}
              onMouseLeave={hideTooltip}
            >
              <span className="sidebar-logout__icon"><LogOut aria-hidden="true"/></span>
              <span className="sidebar-logout__label">Cerrar sesión</span>
            </button>
          </div>

        </div>
      </aside>

      {/* Tooltip flotante — position:fixed escapa cualquier overflow:hidden */}
      {tooltip && collapsed && (
        <div
          className="sidebar-tooltip"
          style={{ top: tooltip.y, left: 80 }}
          aria-hidden="true"
        >
          {tooltip.label}
        </div>
      )}

      {/* Overlay oscuro detrás del drawer */}
      <div
        className={`sidebar-overlay ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      <nav className="mobile-bottom-nav" aria-label="Navegación móvil principal">
        {MOBILE_NAV.filter(item => canSee(item.id)).map(item => (
          <button key={item.id} type="button" onClick={() => handleNavigate(item.id)} aria-label={item.label}>
            <span>
              <SidebarIcon icon={item.icon}/>
              {item.id === "notifications" && notificationCount > 0 && <b>{notificationCount > 9 ? "9+" : notificationCount}</b>}
            </span>
            <em>{item.label}</em>
          </button>
        ))}
      </nav>

      {canSee("visits") && (
        <button
          type="button"
          className="mobile-quick-visit-fab"
          onClick={() => handleNavigate("visits", { action: "quick", source: "mobileQuickAction" })}
        >
          <CalendarPlus aria-hidden="true"/>
          <span>Visita rápida</span>
        </button>
      )}
    </>
  );
}
