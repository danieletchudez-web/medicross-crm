import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BellRing,
  Building2,
  Calculator,
  CalendarDays,
  CalendarPlus,
  ChartPie,
  CircleDollarSign,
  Clock3,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Moon,
  PackageOpen,
  Settings,
  ShieldCheck,
  Sun,
  Target,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
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
      { id: "opportunities", label: "Oportunidades",         icon: Target },
      { id: "campaigns",     label: "Campañas",              icon: Megaphone },
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
      { id: "todayActions", label: "Acciones Hoy",  icon: Clock3 },
      { id: "visits",       label: "Visitas",        icon: Handshake },
      { id: "calendar",     label: "Calendario",     icon: CalendarDays },
      { id: "adminUsers",   label: "Administración", icon: ShieldCheck },
      { id: "settings",     label: "Configuración",  icon: Settings },
    ],
  },
];

const ALL_IDS = MENU_SECTIONS.flatMap(s => s.items.map(i => i.id));

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
  const [dark,       setDark]       = useState(() => localStorage.getItem("theme") === "dark");
  const [editing,    setEditing]    = useState(false);
  const [orderedIds, setOrderedIds] = useState(() => loadOrder() || ALL_IDS);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [collapsed,  setCollapsed]  = useState(true);
  const [favorites,  setFavorites]  = useState(() => {
    try { return JSON.parse(localStorage.getItem("sidebar_favorites") || "[]"); }
    catch { return []; }
  });
  const dragIdx        = useRef(null);
  const expandTimer    = useRef(null);
  const collapseTimer  = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    return () => {
      clearTimeout(expandTimer.current);
      clearTimeout(collapseTimer.current);
    };
  }, []);

  function handleMouseEnter() {
    clearTimeout(collapseTimer.current);
    expandTimer.current = setTimeout(() => setCollapsed(false), 120);
  }

  function handleMouseLeave() {
    clearTimeout(expandTimer.current);
    collapseTimer.current = setTimeout(() => {
      setCollapsed(true);
      setEditing(false);
    }, 2000);
  }

  // Bloquear scroll cuando el menú móvil está abierto
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  // Cerrar al rotar pantalla
  useEffect(() => {
    const fn = () => { if (window.innerWidth > 768) setMenuOpen(false); };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const canSee = module => {
    if (profile?.role === "super_admin") return true;
    if (module === "adminUsers") return false;
    return profile?.allowed_modules?.includes(module);
  };

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function handleNavigate(id) {
    setMenuOpen(false);
    clearTimeout(expandTimer.current);
    clearTimeout(collapseTimer.current);
    setCollapsed(true);
    setEditing(false);
    onNavigate(id);
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

  const sections     = buildSections(orderedIds);
  const initials     = (profile?.full_name || profile?.email || "U").slice(0,1).toUpperCase();
  const roleLabel    = {super_admin:"Super Admin",manager:"Manager",seller:"Vendedor"}[profile?.role] || profile?.role || "Usuario";
  const email        = profile?.email || "";
  const emailDisplay = email.length > 24 ? email.slice(0,22)+"…" : email;

  return (
    <>
      <aside
        className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >

        {/* Brand / logo */}
        <div className="sidebar-brand" onClick={() => handleNavigate("managerDashboard")} style={{cursor:"pointer"}} aria-label="Dashboard">
          <img src={logoImg} alt="MediCross Productos Médicos" className="sidebar-brand__img"/>
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
              <button onClick={() => handleNavigate("visits")} aria-label="Nueva visita" data-tooltip="Nueva visita"><span><CalendarPlus aria-hidden="true"/></span><em>Visita</em></button>
              <button onClick={() => handleNavigate("accounts")} aria-label="Nuevo cliente" data-tooltip="Nuevo cliente"><span><Building2 aria-hidden="true"/></span><em>Cliente</em></button>
              <button onClick={() => handleNavigate("opportunities")} aria-label="Nueva oportunidad" data-tooltip="Nueva oportunidad"><span><CircleDollarSign aria-hidden="true"/></span><em>Oportunidad</em></button>
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
                    <button key={id} className="sidebar-nav__item sidebar-nav__item--fav" onClick={() => handleNavigate(id)} aria-label={item.label} data-tooltip={item.label}>
                      <span className="sidebar-nav__icon"><SidebarIcon icon={item.icon} /></span>
                      <span className="sidebar-nav__label">{item.label}</span>
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
                        data-tooltip={item.label}
                      >
                        <span className="sidebar-nav__icon"><SidebarIcon icon={item.icon} /></span>
                        <span className="sidebar-nav__label">{item.label}</span>
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
            <div className="sidebar-theme-toggle" onClick={() => setDark(d => !d)} aria-label={dark ? "Modo claro" : "Modo oscuro"} data-tooltip={dark ? "Modo claro" : "Modo oscuro"}>
              <span className="sidebar-theme-toggle__icon">{dark ? <Sun aria-hidden="true"/> : <Moon aria-hidden="true"/>}</span>
              <span className="sidebar-theme-toggle__label">{dark ? "Modo claro" : "Modo oscuro"}</span>
              <div className={`sidebar-theme-toggle__switch ${dark ? "on" : ""}`}>
                <div className="sidebar-theme-toggle__knob"/>
              </div>
            </div>
            <button type="button" className="sidebar-logout" onClick={logout} aria-label="Cerrar sesión" data-tooltip="Cerrar sesión">
              <span className="sidebar-logout__icon"><LogOut aria-hidden="true"/></span>
              <span className="sidebar-logout__label">Cerrar sesión</span>
            </button>
          </div>

        </div>
      </aside>

      {/* Overlay oscuro detrás del drawer */}
      <div
        className={`sidebar-overlay ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
    </>
  );
}
