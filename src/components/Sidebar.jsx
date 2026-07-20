import { useEffect, useRef, useState } from "react";
import { Moon, Sun,
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
  Clock3,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PackageOpen,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
  Truck,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { canOpenModule, getFirstOpenModule } from "../lib/moduleAccess";
import useNotificationCount from "../hooks/useNotificationCount";
import useTaskAlerts from "../hooks/useTaskAlerts";
import "./Sidebar.css";
import logoImg     from "../assets/logo.jpg";
import logoDarkImg from "../assets/logo-dark.png";

const MENU_SECTIONS = [
  {
    label: "PRIORIDAD DEL DÍA",
    priority: true,
    items: [
      { id: "todayActions", label: "Acciones Hoy", icon: Clock3 },
      { id: "habits",       label: "Hábitos",       icon: RefreshCw },
      { id: "tasks",        label: "Tareas",         icon: CheckSquare },
    ],
  },
  {
    label: "ANÁLISIS",
    items: [
      { id: "managerDashboard", label: "Dashboard",          icon: LayoutDashboard },
      { id: "salesAnalytics",   label: "Análisis Comercial", icon: ChartPie },
      { id: "importer",         label: "BI Comercial",       icon: BarChart3 },
    ],
  },
  {
    label: "COTIZACIONES",
    items: [
      { id: "tenders",   label: "Licitaciones", icon: FileText },
      { id: "cotizador", label: "Cotizador",    icon: Calculator },
      { id: "purchases", label: "Compras",      icon: ShoppingCart },
    ],
  },
  {
    label: "COMERCIAL",
    items: [
      { id: "accounts",      label: "Clientes / Cuentas",    icon: Building2 },
      { id: "products",      label: "Productos / Share Kit", icon: PackageOpen },
      { id: "opportunities", label: "Oportunidades",         icon: Target },
      { id: "campaigns",     label: "Campañas",              icon: Megaphone },
      { id: "suppliers",     label: "Proveedores",           icon: Truck },
      { id: "visits",        label: "Visitas",               icon: Handshake },
      { id: "calendar",      label: "Calendario",            icon: CalendarDays },
    ],
  },
  {
    label: "OPERACIÓN INTERNA",
    items: [
      { id: "adminUsers",    label: "Administración",    icon: ShieldCheck },
      { id: "notifications", label: "Centro de Alertas", icon: BellRing },
      { id: "settings",      label: "Configuración",     icon: Settings },
    ],
  },
];

const ALL_IDS = MENU_SECTIONS.flatMap(s => s.items.map(i => i.id));

function freqToDaysLocal(freq) {
  if (!freq || freq === "daily") return [0,1,2,3,4,5,6];
  if (freq === "weekdays")       return [0,1,2,3,4];
  if (freq === "weekend")        return [5,6];
  try { const p = JSON.parse(freq); if (Array.isArray(p)) return p.filter(n => n >= 0 && n <= 6); } catch {}
  return [0,1,2,3,4,5,6];
}

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
  const [tooltip,    setTooltip]    = useState(null);
  const [sbHovered,  setSbHovered]  = useState(false);
  const [sbExpanded, setSbExpanded] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia?.("(max-width: 768px)").matches || false);
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  const dragIdx    = useRef(null);
  const hoverTimer = useRef(null);
  const notificationCount = useNotificationCount(profile?.id);
  const { count: taskAlertCount } = useTaskAlerts(profile?.id);
  const [purchasesAlertCount, setPurchasesAlertCount] = useState(0);
  const [habitsProgress, setHabitsProgress] = useState(null);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    async function loadPurchasesAlerts() {
      let query = supabase.from("cotizaciones").select("id", { count: "exact", head: true }).in("workflow_status", ["pendiente_costos", "costos_parciales", "revision_solicitada"]);
      const manager = ["super_admin", "admin", "manager", "purchasing_manager", "team_lead"].includes(profile?.role) || ["administracion", "manager"].includes(profile?.department);
      if (profile?.department === "compras" && !manager) query = query.or(`purchasing_owner_id.is.null,purchasing_owner_id.eq.${profile.id}`);
      const { count, error } = await query;
      if (active && !error) setPurchasesAlertCount(count || 0);
    }
    loadPurchasesAlerts();
    const timer = setInterval(loadPurchasesAlerts, 30000);
    window.addEventListener("crm:purchases-updated", loadPurchasesAlerts);
    return () => { active = false; clearInterval(timer); window.removeEventListener("crm:purchases-updated", loadPurchasesAlerts); };
  }, [profile?.id, profile?.role, profile?.department]);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    async function loadHabits() {
      const today = new Date().toISOString().slice(0, 10);
      const dow   = (new Date().getDay() + 6) % 7;
      const [hRes, cRes] = await Promise.all([
        supabase.from("habits").select("id,frequency").eq("user_id", profile.id),
        supabase.from("habit_completions").select("habit_id").eq("completed_date", today).eq("user_id", profile.id),
      ]);
      if (!active) return;
      const todayHabits = (hRes.data || []).filter(h => freqToDaysLocal(h.frequency).includes(dow));
      const doneIds = new Set((cRes.data || []).map(c => c.habit_id));
      setHabitsProgress({ done: todayHabits.filter(h => doneIds.has(h.id)).length, total: todayHabits.length });
    }
    loadHabits();
    const timer = setInterval(loadHabits, 5 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [profile?.id]);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("theme", next ? "dark" : "light");
  }

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
      if (e.detail.collapsed) { setEditing(false); setTooltip(null); clearTimeout(hoverTimer.current); setSbExpanded(false); }
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
    if (next) { setEditing(false); clearTimeout(hoverTimer.current); setSbExpanded(false); }
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
      <aside
        className={`sidebar ${collapsed ? "sidebar--collapsed" : ""} ${collapsed && sbExpanded ? "sidebar--expanded" : ""}`}
        onMouseEnter={() => {
          if (collapsed) {
            setSbHovered(true);
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => setSbExpanded(true), 120);
          }
        }}
        onMouseLeave={() => {
          setSbHovered(false);
          clearTimeout(hoverTimer.current);
          setSbExpanded(false);
        }}
      >

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
          <img src={logoImg}     alt="MediCross" className="sidebar-brand__img sidebar-brand__img--light" />
          <img src={logoDarkImg} alt="MediCross" className="sidebar-brand__img sidebar-brand__img--dark" />
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
                      {item.id === "purchases" && purchasesAlertCount > 0 && <span className="sidebar-nav__badge sidebar-nav__badge--red">{purchasesAlertCount > 9 ? "9+" : purchasesAlertCount}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {sections.map((section, si) => {
              const visible = section.items.filter(item => canSee(item.id));
              if (visible.length === 0) return null;
              const isPriority = !!section.priority;
              return (
                <div key={section.label} className={`sidebar-section${isPriority ? " sidebar-section--priority" : ""}`}>
                  {si > 0 && !isPriority && !sections[si - 1]?.priority && <div className="sidebar-section__divider"/>}
                  <span className={`sidebar-section__label${isPriority ? " sidebar-section__label--priority" : ""}`}>{section.label}</span>
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
                        className={`sidebar-nav__item${isPriority ? " sidebar-nav__item--priority" : ""}`}
                        onClick={() => { if (!editing) handleNavigate(item.id); }}
                        style={{ cursor: editing ? "grab" : "pointer" }}
                        aria-label={item.label}
                        onMouseEnter={(e) => showTooltip(e, item.label)}
                        onMouseLeave={hideTooltip}
                      >
                        <span className="sidebar-nav__icon"><SidebarIcon icon={item.icon} /></span>
                        <span className="sidebar-nav__label">{item.label}</span>
                        {item.id === "notifications" && notificationCount > 0 && <span className="sidebar-nav__badge">{notificationCount > 99 ? "99+" : notificationCount}</span>}
                        {item.id === "purchases" && purchasesAlertCount > 0 && <span className="sidebar-nav__badge sidebar-nav__badge--red">{purchasesAlertCount > 9 ? "9+" : purchasesAlertCount}</span>}
                        {item.id === "tasks" && taskAlertCount > 0 && <span className="sidebar-nav__badge sidebar-nav__badge--red">{taskAlertCount > 9 ? "9+" : taskAlertCount}</span>}
                        {item.id === "habits" && habitsProgress && habitsProgress.total > 0 && (
                          <span className={`sidebar-nav__badge ${habitsProgress.done === habitsProgress.total ? "sidebar-nav__badge--green" : "sidebar-nav__badge--blue"}`}>
                            {habitsProgress.done}/{habitsProgress.total}
                          </span>
                        )}
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
              className="sidebar-theme-toggle"
              onClick={toggleTheme}
              aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              onMouseEnter={(e) => showTooltip(e, isDark ? "Modo claro" : "Modo oscuro")}
              onMouseLeave={hideTooltip}
            >
              <span className="sidebar-logout__icon">
                {isDark ? <Sun size={16} aria-hidden="true"/> : <Moon size={16} aria-hidden="true"/>}
              </span>
              <span className="sidebar-logout__label">{isDark ? "Modo claro" : "Modo oscuro"}</span>
            </button>
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

      {/* Tooltip flotante — position:fixed escapa cualquier overflow:hidden.
          Se oculta cuando el sidebar CSS-expande en hover (sbHovered),
          porque el label ya es visible y el div es sibling del aside (no descendiente),
          así que la regla CSS .sidebar--collapsed:hover .sidebar-tooltip no matchea. */}
      {tooltip && collapsed && !sbHovered && (
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
