import { useEffect, useRef, useState } from "react";
import {
  CalendarPlus, Sparkles, UserPlus, Target, MapPin, Calendar,
  CheckSquare, FileText, Briefcase, Package, Truck, Megaphone, Bell,
  BarChart2, Users, Settings, ChevronRight, LogOut, Moon, Sun, Plus,
} from "lucide-react";

// ── Contextual center button map ─────────────────────────────────────────────
const DOCK_CONTEXTS = {
  mobileHome:       { Icon: Sparkles,     label: "Medix",       action: "medix" },
  managerDashboard: { Icon: Sparkles,     label: "Medix",       action: "medix" },
  sellerDashboard:  { Icon: Sparkles,     label: "Medix",       action: "medix" },
  accounts:         { Icon: UserPlus,     label: "Cliente",     action: "accounts" },
  accountDetail:    { Icon: UserPlus,     label: "Cliente",     action: "accounts" },
  opportunities:    { Icon: Target,       label: "Oportunidad", action: "opportunities" },
  visits:           { Icon: MapPin,       label: "Visita",      action: "quick-visit" },
  calendar:         { Icon: CalendarPlus, label: "Evento",      action: "calendar" },
  tasks:            { Icon: CheckSquare,  label: "Tarea",       action: "tasks" },
  tenders:          { Icon: Briefcase,    label: "Licitación",  action: "tenders" },
  cotizador:        { Icon: FileText,     label: "Cotización",  action: "cotizador" },
  products:         { Icon: Package,      label: "Producto",    action: "products" },
  suppliers:        { Icon: Truck,        label: "Proveedor",   action: "suppliers" },
  campaigns:        { Icon: Megaphone,    label: "Campaña",     action: "campaigns" },
  salesAnalytics:   { Icon: BarChart2,    label: "Análisis",    action: "salesAnalytics" },
  notifications:    { Icon: Bell,         label: "Alerta",      action: "notifications" },
};

const DEFAULT_MODULES = [
  { key: "accounts",       label: "Clientes",      Icon: Users },
  { key: "opportunities",  label: "Oportunidades", Icon: Target },
  { key: "calendar",       label: "Agenda",        Icon: Calendar },
  { key: "visits",         label: "Visitas",        Icon: MapPin },
  { key: "tenders",        label: "Licitaciones",  Icon: Briefcase },
  { key: "tasks",          label: "Tareas",         Icon: CheckSquare },
  { key: "products",       label: "Productos",      Icon: Package },
  { key: "salesAnalytics", label: "Análisis",       Icon: BarChart2 },
  { key: "suppliers",      label: "Proveedores",    Icon: Truck },
];

const QUICK_ACTIONS = [
  { key: "visits",        label: "Nueva visita",      Icon: MapPin },
  { key: "opportunities", label: "Nueva oportunidad", Icon: Target },
  { key: "accounts",      label: "Nuevo cliente",     Icon: UserPlus },
  { key: "tasks",         label: "Nueva tarea",       Icon: CheckSquare },
  { key: "cotizador",     label: "Nueva cotización",  Icon: FileText },
  { key: "tenders",       label: "Nueva licitación",  Icon: Briefcase },
];

export default function MobileDock({ currentPage, onNavigate, profile, onLogout }) {
  const [isMobile,    setIsMobile]    = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [theme,       setTheme]       = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const [medixActive, setMedixActive] = useState(false);
  // contextKey forces re-mount of the center button → triggers its enter animation
  const [contextKey,  setContextKey]  = useState(currentPage);
  const prevPage = useRef(currentPage);

  const modules = (() => {
    try { return JSON.parse(localStorage.getItem("mob_modules")) || DEFAULT_MODULES; }
    catch { return DEFAULT_MODULES; }
  })();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  // Update contextKey when page changes (drives center button re-mount + animation)
  useEffect(() => {
    if (prevPage.current !== currentPage) {
      prevPage.current = currentPage;
      setContextKey(currentPage);
    }
  }, [currentPage]);

  // Close sheet on navigate or viewport change
  useEffect(() => { setSheetOpen(false); }, [currentPage]);
  useEffect(() => { if (!isMobile) setSheetOpen(false); }, [isMobile]);

  // Sync theme from document attribute
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") || "light");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Bottom nav "Más" tab dispatches this to toggle the sheet
  useEffect(() => {
    const handler = () => setSheetOpen(o => !o);
    document.addEventListener("crm:toggle-sheet", handler);
    return () => document.removeEventListener("crm:toggle-sheet", handler);
  }, []);

  // Track whether Medix panel is open (emitted by CRMAssistant)
  useEffect(() => {
    const onOpen  = () => setMedixActive(true);
    const onClose = () => setMedixActive(false);
    document.addEventListener("crm:medix-opened", onOpen);
    document.addEventListener("crm:medix-closed", onClose);
    return () => {
      document.removeEventListener("crm:medix-opened", onOpen);
      document.removeEventListener("crm:medix-closed", onClose);
    };
  }, []);

  if (!isMobile) return null;

  const isDark    = theme === "dark";
  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Usuario";
  const ctx       = DOCK_CONTEXTS[contextKey] || DOCK_CONTEXTS.mobileHome;
  const { Icon: CtxIcon, label: ctxLabel, action: ctxAction } = ctx;
  const isCtxMedix = ctxAction === "medix";

  function handleCtx() {
    if (ctxAction === "medix") {
      document.dispatchEvent(new CustomEvent("crm:toggle-medix"));
    } else if (ctxAction === "quick-visit") {
      onNavigate("visits", { action: "quick", source: "dock" });
    } else {
      onNavigate(ctxAction);
    }
  }

  function handleQuickVisit() {
    onNavigate("visits", { action: "quick", source: "dock" });
  }

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  return (
    <>
      {/* ── Dock pill ────────────────────────────────────────────────────── */}
      <div className="mob-dock" role="toolbar" aria-label="Acciones rápidas">

        {/* Left — Visita rápida (always) */}
        <button className="mob-dock-btn mob-dock-btn--side" onClick={handleQuickVisit} aria-label="Visita rápida">
          <CalendarPlus size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>Visita rápida</span>
        </button>

        <div className="mob-dock-sep" aria-hidden="true" />

        {/* Center — contextual, re-mounts on page change to animate */}
        <button
          key={contextKey}
          className={`mob-dock-btn mob-dock-btn--ctx${isCtxMedix && medixActive ? " mob-dock-btn--active" : ""}`}
          onClick={handleCtx}
          aria-label={ctxLabel}
        >
          <CtxIcon size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{ctxLabel}</span>
        </button>

        <div className="mob-dock-sep" aria-hidden="true" />

        {/* Right — hamburger menu */}
        <button
          className={`mob-dock-btn mob-dock-btn--menu${sheetOpen ? " mob-dock-btn--active" : ""}`}
          onClick={() => setSheetOpen(o => !o)}
          aria-label={sheetOpen ? "Cerrar menú" : "Menú"}
          aria-expanded={sheetOpen}
        >
          <span className="mob-dock-hamburger" aria-hidden="true">
            <span className="mob-dock-hline" />
            <span className="mob-dock-hline mob-dock-hline--mid" />
            <span className="mob-dock-hline" />
          </span>
        </button>

      </div>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {sheetOpen && (
        <div className="mob-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />
      )}

      {/* ── Bottom sheet ─────────────────────────────────────────────────── */}
      <div
        className={`mob-sheet${sheetOpen ? " mob-sheet--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menú móvil"
      >
        <div className="mob-sheet-handle" />
        <div className="mob-sheet-scroll">

          <div className="mob-sheet-section-label">CREAR</div>
          {QUICK_ACTIONS.map(({ key, label, Icon: Ic }) => (
            <button key={key} className="mob-sheet-row" onClick={() => { setSheetOpen(false); onNavigate(key); }}>
              <span className="mob-sheet-row__icon"><Ic size={18} strokeWidth={1.5} /></span>
              <span className="mob-sheet-row__label">{label}</span>
              <Plus size={15} strokeWidth={1.5} className="mob-sheet-row__plus" />
            </button>
          ))}

          <div className="mob-sheet-section-label">IR A</div>
          <div className="mob-module-grid">
            {modules.map(({ key, label, Icon: Ic }) => (
              <button key={key} className="mob-module-btn" onClick={() => { setSheetOpen(false); onNavigate(key); }}>
                <span className="mob-module-btn__icon"><Ic size={24} strokeWidth={1.5} /></span>
                <span className="mob-module-btn__label">{label}</span>
              </button>
            ))}
          </div>

          <div className="mob-sheet-section-label">CUENTA</div>
          <button className="mob-sheet-row" onClick={() => { setSheetOpen(false); onNavigate("settings"); }}>
            <span className="mob-sheet-row__icon"><Settings size={18} strokeWidth={1.5} /></span>
            <span className="mob-sheet-row__label">Perfil · {firstName}</span>
            <ChevronRight size={15} strokeWidth={1.5} className="mob-sheet-row__plus" />
          </button>
          <button className="mob-sheet-row" onClick={toggleTheme}>
            <span className="mob-sheet-row__icon">
              {isDark ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
            </span>
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
