import { useEffect, useState } from "react";
import { Home, Users, Calendar, Bell, MoreHorizontal, Plus, X, Eye, Target, UserPlus, CheckSquare, FileText, Briefcase, Settings, LogOut, Moon, Sun, ChevronRight, Package, BarChart2, MapPin, Truck } from "lucide-react";

const DEFAULT_MODULES = [
  { key: "accounts",      label: "Clientes",      Icon: Users },
  { key: "opportunities", label: "Oportunidades",  Icon: Target },
  { key: "calendar",      label: "Agenda",         Icon: Calendar },
  { key: "visits",        label: "Visitas",         Icon: MapPin },
  { key: "tenders",       label: "Licitaciones",    Icon: Briefcase },
  { key: "tasks",         label: "Tareas",          Icon: CheckSquare },
  { key: "products",      label: "Productos",       Icon: Package },
  { key: "salesAnalytics",label: "Análisis",        Icon: BarChart2 },
  { key: "suppliers",     label: "Proveedores",     Icon: Truck },
];

const ALL_MODULES_CONFIG = [
  { key: "accounts",      label: "Clientes",         Icon: Users },
  { key: "opportunities", label: "Oportunidades",    Icon: Target },
  { key: "calendar",      label: "Agenda",           Icon: Calendar },
  { key: "visits",        label: "Visitas",          Icon: MapPin },
  { key: "tenders",       label: "Licitaciones",     Icon: Briefcase },
  { key: "tasks",         label: "Tareas",           Icon: CheckSquare },
  { key: "products",      label: "Productos",        Icon: Package },
  { key: "salesAnalytics",label: "Análisis",         Icon: BarChart2 },
  { key: "suppliers",     label: "Proveedores",      Icon: Truck },
  { key: "campaigns",     label: "Campañas",         Icon: FileText },
  { key: "notifications", label: "Alertas",          Icon: Bell },
  { key: "settings",      label: "Configuración",    Icon: Settings },
];

const QUICK_ACTIONS = [
  { key: "visits",        label: "Nueva visita",      Icon: MapPin },
  { key: "opportunities", label: "Nueva oportunidad", Icon: Target },
  { key: "accounts",      label: "Nuevo cliente",     Icon: UserPlus },
  { key: "tasks",         label: "Nueva tarea",       Icon: CheckSquare },
  { key: "cotizador",     label: "Nueva cotización",  Icon: FileText },
  { key: "tenders",       label: "Nueva licitación",  Icon: Briefcase },
];

const NAV_ITEMS = [
  { key: "mobileHome",    label: "Inicio",   Icon: Home },
  { key: "accounts",      label: "Clientes", Icon: Users },
  { key: "calendar",      label: "Agenda",   Icon: Calendar },
  { key: "notifications", label: "Alertas",  Icon: Bell },
  { key: "more",          label: "Más",      Icon: MoreHorizontal },
];

export default function MobileNav({ currentPage, onNavigate, profile, onLogout }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  // Module list from localStorage
  const [modules] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mob_modules")) || DEFAULT_MODULES; }
    catch { return DEFAULT_MODULES; }
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  // Close sheet when navigating
  useEffect(() => { setOpen(false); }, [currentPage]);
  // Close sheet on desktop resize
  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);

  // Sync theme from document
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") || "light");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  if (!isMobile) return null;

  const isDark = theme === "dark";
  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Usuario";

  function handleNav(key) {
    if (key === "more") { setOpen(o => !o); return; }
    setOpen(false);
    onNavigate(key);
  }

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  return (
    <>
      {/* Bottom navigation */}
      <nav className="mob-bottom-nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => {
          const isActive = key === "more" ? open : currentPage === key;
          return (
            <button key={key} className={`mob-nav-item${isActive ? " mob-nav-item--active" : ""}`} onClick={() => handleNav(key)} aria-label={label}>
              <Icon size={21} strokeWidth={1.5} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* FAB */}
      <button className={`mob-fab${open ? " mob-fab--open" : ""}`} onClick={() => setOpen(o => !o)} aria-label={open ? "Cerrar" : "Acciones"}>
        {open ? <X size={21} strokeWidth={1.5} /> : <Plus size={21} strokeWidth={1.5} />}
      </button>

      {/* Backdrop */}
      {open && <div className="mob-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}

      {/* Bottom Sheet */}
      <div className={`mob-sheet${open ? " mob-sheet--open" : ""}`} role="dialog" aria-modal="true" aria-label="Menú móvil">
        <div className="mob-sheet-handle" />
        <div className="mob-sheet-scroll">

          {/* CREAR section */}
          <div className="mob-sheet-section-label">CREAR</div>
          {QUICK_ACTIONS.map(({ key, label, Icon: Ic }) => (
            <button key={key} className="mob-sheet-row" onClick={() => { setOpen(false); onNavigate(key); }}>
              <span className="mob-sheet-row__icon"><Ic size={18} strokeWidth={1.5} /></span>
              <span className="mob-sheet-row__label">{label}</span>
              <Plus size={15} strokeWidth={1.5} className="mob-sheet-row__plus" />
            </button>
          ))}

          {/* IR A section */}
          <div className="mob-sheet-section-label">IR A</div>
          <div className="mob-module-grid">
            {modules.map(({ key, label, Icon: Ic }) => (
              <button key={key} className="mob-module-btn" onClick={() => { setOpen(false); onNavigate(key); }}>
                <span className="mob-module-btn__icon"><Ic size={24} strokeWidth={1.5} /></span>
                <span className="mob-module-btn__label">{label}</span>
              </button>
            ))}
          </div>

          {/* CUENTA section */}
          <div className="mob-sheet-section-label">CUENTA</div>
          <button className="mob-sheet-row" onClick={() => { setOpen(false); onNavigate("settings"); }}>
            <span className="mob-sheet-row__icon"><Settings size={18} strokeWidth={1.5} /></span>
            <span className="mob-sheet-row__label">Perfil · {firstName}</span>
            <ChevronRight size={15} strokeWidth={1.5} className="mob-sheet-row__plus" />
          </button>
          <button className="mob-sheet-row" onClick={toggleTheme}>
            <span className="mob-sheet-row__icon">{isDark ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}</span>
            <span className="mob-sheet-row__label">Tema: {isDark ? "Oscuro" : "Claro"}</span>
          </button>
          <button className="mob-sheet-row mob-sheet-row--danger" onClick={onLogout}>
            <span className="mob-sheet-row__icon"><LogOut size={18} strokeWidth={1.5} /></span>
            <span className="mob-sheet-row__label">Cerrar sesión</span>
          </button>

          <div className="mob-sheet-safe-area" />
        </div>
      </div>
    </>
  );
}
