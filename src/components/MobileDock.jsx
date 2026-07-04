import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarPlus, Sparkles, UserPlus, Target, MapPin, Calendar,
  CheckSquare, FileText, Briefcase, Package, Truck, Megaphone, Bell,
  BarChart2, Users, Settings, User, ChevronRight, LogOut, Moon, Sun,
  Plus, X, Eye, EyeOff, RotateCcw,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

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

const ALL_MODULES = [
  { key: "accounts",       label: "Clientes",      Icon: Users },
  { key: "opportunities",  label: "Oportunidades", Icon: Target },
  { key: "calendar",       label: "Agenda",        Icon: Calendar },
  { key: "visits",         label: "Visitas",       Icon: MapPin },
  { key: "tenders",        label: "Licitaciones",  Icon: Briefcase },
  { key: "tasks",          label: "Tareas",        Icon: CheckSquare },
  { key: "products",       label: "Productos",     Icon: Package },
  { key: "salesAnalytics", label: "Análisis",      Icon: BarChart2 },
  { key: "suppliers",      label: "Proveedores",   Icon: Truck },
  { key: "campaigns",      label: "Campañas",      Icon: Megaphone },
  { key: "cotizador",      label: "Cotizador",     Icon: FileText },
];

const PAGE_LABELS = {
  mobileHome: "HOY", accounts: "Clientes", opportunities: "Oportunidades",
  calendar: "Agenda", visits: "Visitas", tenders: "Licitaciones",
  tasks: "Tareas", products: "Productos", salesAnalytics: "Análisis",
  suppliers: "Proveedores", campaigns: "Campañas", cotizador: "Cotizador",
  notifications: "Alertas", settings: "Configuración",
};

const QUICK_ACTIONS = [
  { key: "visits",        label: "Nueva visita",      Icon: MapPin },
  { key: "opportunities", label: "Nueva oportunidad", Icon: Target },
  { key: "accounts",      label: "Nuevo cliente",     Icon: UserPlus },
  { key: "tasks",         label: "Nueva tarea",       Icon: CheckSquare },
  { key: "cotizador",     label: "Nueva cotización",  Icon: FileText },
  { key: "tenders",       label: "Nueva licitación",  Icon: Briefcase },
];

const DEFAULT_CONFIG = ALL_MODULES.map(m => ({ key: m.key, visible: true, fav: false }));

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadModuleConfig() {
  try {
    const raw = localStorage.getItem("mob_module_config");
    if (!raw) return DEFAULT_CONFIG;
    const stored = JSON.parse(raw);
    // Merge: keep stored order/prefs, append any new modules at the end
    const storedKeys = new Set(stored.map(m => m.key));
    const newMods = ALL_MODULES
      .filter(m => !storedKeys.has(m.key))
      .map(m => ({ key: m.key, visible: true, fav: false }));
    return [...stored, ...newMods];
  } catch { return DEFAULT_CONFIG; }
}

function saveModuleConfig(config) {
  localStorage.setItem("mob_module_config", JSON.stringify(config));
}

function loadRecientes() {
  try { return JSON.parse(localStorage.getItem("mob_recientes") || "[]"); }
  catch { return []; }
}

function pushReciente(key) {
  const label = PAGE_LABELS[key];
  if (!label) return;
  const stored  = loadRecientes();
  const updated = [{ key, label, ts: Date.now() }]
    .concat(stored.filter(r => r.key !== key))
    .slice(0, 6);
  localStorage.setItem("mob_recientes", JSON.stringify(updated));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileDock({ currentPage, onNavigate, profile, onLogout }) {
  const [isMobile,      setIsMobile]      = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [sheetOpen,     setSheetOpen]     = useState(false);
  const [theme,         setTheme]         = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const [medixActive,   setMedixActive]   = useState(false);
  const [contextKey,    setContextKey]    = useState(currentPage);
  const [editMode,      setEditMode]      = useState(false);
  const [moduleConfig,  setModuleConfig]  = useState(loadModuleConfig);
  const [draggingKey,   setDraggingKey]   = useState(null);
  const [hoverKey,      setHoverKey]      = useState(null);
  const [toast,         setToast]         = useState(null);

  const prevPage        = useRef(currentPage);
  const ghostRef        = useRef(null);
  const dragState       = useRef({ active: false, sourceKey: null, currentHoverKey: null, offsetX: 0, offsetY: 0 });
  const toastTimer      = useRef(null);
  const longPressTimer  = useRef(null);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (prevPage.current !== currentPage) {
      prevPage.current = currentPage;
      setContextKey(currentPage);
      pushReciente(currentPage);
    }
  }, [currentPage]);

  useEffect(() => { setSheetOpen(false); setEditMode(false); }, [currentPage]);
  useEffect(() => { if (!isMobile) { setSheetOpen(false); setEditMode(false); } }, [isMobile]);

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") || "light");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const handler = () => setSheetOpen(o => !o);
    document.addEventListener("crm:toggle-sheet", handler);
    return () => document.removeEventListener("crm:toggle-sheet", handler);
  }, []);

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

  // Reset edit mode when sheet closes
  useEffect(() => { if (!sheetOpen) setEditMode(false); }, [sheetOpen]);

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearTimeout(longPressTimer.current);
  }, []);

  if (!isMobile) return null;

  // ── Derived ──────────────────────────────────────────────────────────────

  const isDark    = theme === "dark";
  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Usuario";
  const ctx       = DOCK_CONTEXTS[contextKey] || DOCK_CONTEXTS.mobileHome;
  const { Icon: CtxIcon, label: ctxLabel, action: ctxAction } = ctx;
  const isCtxMedix = ctxAction === "medix";

  // Compute display order (live reorder preview while dragging)
  let displayConfig = [...moduleConfig];
  if (draggingKey && hoverKey && draggingKey !== hoverKey) {
    const si = displayConfig.findIndex(m => m.key === draggingKey);
    const ti = displayConfig.findIndex(m => m.key === hoverKey);
    if (si !== -1 && ti !== -1) {
      const [item] = displayConfig.splice(si, 1);
      displayConfig.splice(ti, 0, item);
    }
  }

  const allVisible = displayConfig
    .filter(m => m.visible)
    .map(m => ({ ...m, ...ALL_MODULES.find(a => a.key === m.key) }))
    .filter(Boolean);

  const hiddenMods = displayConfig
    .filter(m => !m.visible)
    .map(m => ({ ...m, ...ALL_MODULES.find(a => a.key === m.key) }))
    .filter(Boolean);

  // ── Toast helper ─────────────────────────────────────────────────────────

  function showToast(msg = "Menú actualizado") {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }

  // ── Module config helpers ─────────────────────────────────────────────────

  function updateConfig(updater) {
    setModuleConfig(prev => {
      const next = updater(prev);
      saveModuleConfig(next);
      showToast();
      return next;
    });
  }

  function toggleVisible(key) {
    updateConfig(prev => prev.map(m => m.key === key ? { ...m, visible: !m.visible } : m));
  }

  function resetConfig() {
    saveModuleConfig(DEFAULT_CONFIG);
    setModuleConfig(DEFAULT_CONFIG);
    showToast("Orden restaurado");
  }

  // ── Sheet swipe-to-dismiss ────────────────────────────────────────────────

  const [dragDelta,    setDragDelta]    = useState(0);
  const isDraggingRef  = useRef(false);
  const dragStartY     = useRef(0);
  const currentDelta   = useRef(0);

  function onSheetDragStart(e) {
    if (editMode) return; // don't swipe-close in edit mode
    dragStartY.current   = e.touches[0].clientY;
    currentDelta.current = 0;
    isDraggingRef.current = true;
  }
  function onSheetDragMove(e) {
    if (!isDraggingRef.current) return;
    const delta = Math.max(0, e.touches[0].clientY - dragStartY.current);
    currentDelta.current = delta;
    setDragDelta(delta);
  }
  function onSheetDragEnd() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const delta = currentDelta.current;
    currentDelta.current = 0;
    setDragDelta(0);
    if (delta > 80) setSheetOpen(false);
  }

  const sheetDragStyle = dragDelta > 0
    ? { transform: `translateY(${dragDelta}px)`, transition: "none" }
    : undefined;

  // ── Drag & drop for module reordering ────────────────────────────────────

  const handleDragMove = useCallback((e) => {
    if (!dragState.current.active) return;
    e.preventDefault();
    const touch = e.touches[0];
    const ds    = dragState.current;

    if (ghostRef.current) {
      ghostRef.current.style.left = `${touch.clientX - ds.offsetX}px`;
      ghostRef.current.style.top  = `${touch.clientY - ds.offsetY}px`;
    }

    const el    = document.elementFromPoint(touch.clientX, touch.clientY);
    const modEl = el?.closest("[data-mod-key]");
    if (modEl) {
      const targetKey = modEl.dataset.modKey;
      if (targetKey && targetKey !== ds.currentHoverKey && targetKey !== ds.sourceKey) {
        ds.currentHoverKey = targetKey;
        setHoverKey(targetKey);
      }
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!dragState.current.active) return;
    dragState.current.active = false;

    document.removeEventListener("touchmove", handleDragMove);
    document.removeEventListener("touchend",  handleDragEnd);

    if (ghostRef.current) ghostRef.current.style.display = "none";

    const { sourceKey, currentHoverKey } = dragState.current;

    if (sourceKey && currentHoverKey && sourceKey !== currentHoverKey) {
      setModuleConfig(prev => {
        const next = [...prev];
        const si = next.findIndex(m => m.key === sourceKey);
        const ti = next.findIndex(m => m.key === currentHoverKey);
        if (si !== -1 && ti !== -1) {
          const [item] = next.splice(si, 1);
          next.splice(ti, 0, item);
          saveModuleConfig(next);
        }
        return next;
      });
    }

    setDraggingKey(null);
    setHoverKey(null);
    showToast();
  }, [handleDragMove]); // eslint-disable-line

  function startModuleDrag(e, key) {
    if (!editMode) return;
    const touch = e.touches[0];
    const rect  = e.currentTarget.getBoundingClientRect();

    dragState.current = {
      active:          true,
      sourceKey:       key,
      currentHoverKey: null,
      offsetX:         touch.clientX - rect.left,
      offsetY:         touch.clientY - rect.top,
    };

    if (ghostRef.current) {
      ghostRef.current.style.left    = `${rect.left}px`;
      ghostRef.current.style.top     = `${rect.top}px`;
      ghostRef.current.style.width   = `${rect.width}px`;
      ghostRef.current.style.height  = `${rect.height}px`;
      ghostRef.current.style.display = "flex";
    }

    setDraggingKey(key);
    document.addEventListener("touchmove", handleDragMove, { passive: false });
    document.addEventListener("touchend",  handleDragEnd,  { passive: true  });
  }

  // ── Long press to enter edit mode ────────────────────────────────────────

  function onModuleLongPressStart(e, key) {
    longPressTimer.current = setTimeout(() => {
      setEditMode(true);
    }, 600);
  }
  function onModuleLongPressCancel() {
    clearTimeout(longPressTimer.current);
  }

  // ── Nav actions ──────────────────────────────────────────────────────────

  function handleCtx() {
    if (ctxAction === "medix")            document.dispatchEvent(new CustomEvent("crm:toggle-medix"));
    else if (ctxAction === "quick-visit") onNavigate("visits", { action: "quick", source: "dock" });
    else                                  onNavigate(ctxAction);
  }

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  function openMedix() {
    setSheetOpen(false);
    document.dispatchEvent(new CustomEvent("crm:toggle-medix"));
  }

  // ── Ghost content (resolved from draggingKey) ─────────────────────────────

  const ghostMod = ALL_MODULES.find(m => m.key === draggingKey);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Dock pill ─────────────────────────────────────────────────── */}
      <div
        className={`mob-dock${sheetOpen ? " mob-dock--recede" : ""}`}
        role="toolbar"
        aria-label="Acciones rápidas"
      >
        <button
          className="mob-dock-btn mob-dock-btn--side"
          onClick={() => onNavigate("visits", { action: "quick", source: "dock" })}
          aria-label="Visita rápida"
        >
          <CalendarPlus size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>Visita rápida</span>
        </button>

        <div className="mob-dock-sep" aria-hidden="true" />

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

      {/* ── Backdrop ──────────────────────────────────────────────────── */}
      {sheetOpen && (
        <div
          className="mob-backdrop"
          onClick={() => !editMode && setSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Bottom sheet ──────────────────────────────────────────────── */}
      <div
        className={`mob-sheet${sheetOpen ? " mob-sheet--open" : ""}`}
        style={sheetDragStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
      >
        {/* Handle */}
        <div
          className="mob-sheet-handle"
          onTouchStart={onSheetDragStart}
          onTouchMove={onSheetDragMove}
          onTouchEnd={onSheetDragEnd}
        />

        {/* Header */}
        <div
          className="mob-sheet-header"
          onTouchStart={onSheetDragStart}
          onTouchMove={onSheetDragMove}
          onTouchEnd={onSheetDragEnd}
        >
          {/* Left: Editar / Listo */}
          <button
            className={`mob-sheet-header__edit-btn${editMode ? " mob-sheet-header__edit-btn--done" : ""}`}
            onClick={() => {
              if (editMode) setEditMode(false);
              else setEditMode(true);
            }}
          >
            {editMode ? "Listo" : "Editar"}
          </button>

          <span className="mob-sheet-header__title">Menú</span>

          {/* Right: Close (always) */}
          <button
            className="mob-sheet-header__close"
            onClick={() => { setSheetOpen(false); setEditMode(false); }}
            aria-label="Cerrar"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Edit mode bar */}
        {editMode && (
          <div className="mob-edit-bar">
            <span className="mob-edit-bar__hint">Arrastrá para reordenar · Tocá el ojo para ocultar</span>
            <button className="mob-edit-bar__reset" onClick={resetConfig}>
              <RotateCcw size={12} strokeWidth={2} />
              Restaurar
            </button>
          </div>
        )}

        {/* Scrollable content */}
        <div className="mob-sheet-scroll">

          {/* CREAR (only when not editing) */}
          {!editMode && (
            <>
              <div className="mob-sheet-section-label">CREAR</div>
              {QUICK_ACTIONS.map(({ key, label, Icon: Ic }) => (
                <button
                  key={key}
                  className="mob-sheet-row"
                  onClick={() => { setSheetOpen(false); onNavigate(key); }}
                >
                  <span className="mob-sheet-row__icon"><Ic size={18} strokeWidth={1.5} /></span>
                  <span className="mob-sheet-row__label">{label}</span>
                  <Plus size={14} strokeWidth={2} className="mob-sheet-row__plus" />
                </button>
              ))}
            </>
          )}

          {/* IR A */}
          <div className="mob-sheet-section-label">IR A</div>
          <div className={`mob-module-grid${editMode ? " mob-module-grid--editing" : ""}`}>
            {allVisible.map(({ key, label, Icon: Ic }, idx) => (
              <div
                key={key}
                className="mob-module-btn-wrap"
                data-mod-key={key}
                onTouchStart={editMode
                  ? (e) => startModuleDrag(e, key)
                  : (e) => onModuleLongPressStart(e, key)
                }
                onTouchEnd={editMode ? undefined : onModuleLongPressCancel}
                onTouchMove={editMode ? undefined : onModuleLongPressCancel}
              >
                <button
                  className={`mob-module-btn${editMode ? " mob-module-btn--editing" : ""}${draggingKey === key ? " mob-module-btn--dragging" : ""}${hoverKey === key && draggingKey && draggingKey !== key ? " mob-module-btn--drop-target" : ""}`}
                  style={editMode ? { "--wiggle-delay": `${(idx % 4) * 55}ms` } : undefined}
                  onClick={() => { if (!editMode) { setSheetOpen(false); onNavigate(key); } }}
                  aria-label={label}
                >
                  <span className="mob-module-btn__icon"><Ic size={22} strokeWidth={1.5} /></span>
                  <span className="mob-module-btn__label">{label}</span>
                </button>
                {editMode && (
                  <button className="mob-mod-eye" onClick={() => toggleVisible(key)} aria-label="Ocultar">
                    <Eye size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* OCULTOS — only in edit mode */}
          {editMode && hiddenMods.length > 0 && (
            <>
              <div className="mob-sheet-section-label">MÓDULOS OCULTOS</div>
              <div className="mob-module-grid">
                {hiddenMods.map(({ key, label, Icon: Ic }) => (
                  <div key={key} className="mob-module-btn-wrap">
                    <button
                      className="mob-module-btn mob-module-btn--hidden"
                      onClick={() => toggleVisible(key)}
                      aria-label={`Mostrar ${label}`}
                    >
                      <span className="mob-module-btn__icon"><Ic size={22} strokeWidth={1.5} /></span>
                      <span className="mob-module-btn__label">{label}</span>
                    </button>
                    <button className="mob-mod-eye mob-mod-eye--off" onClick={() => toggleVisible(key)} aria-label="Mostrar">
                      <EyeOff size={11} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ASISTENTE IA (only when not editing) */}
          {!editMode && (
            <>
              <div className="mob-sheet-section-label">ASISTENTE IA</div>
              <button className="mob-sheet-row" onClick={openMedix}>
                <span className="mob-sheet-row__icon mob-sheet-row__icon--medix">
                  <Sparkles size={18} strokeWidth={1.5} />
                </span>
                <span className="mob-sheet-row__label">Medix</span>
                <span className="mob-sheet-ai-badge">IA</span>
              </button>
            </>
          )}

          {/* CUENTA (only when not editing) */}
          {!editMode && (
            <>
              <div className="mob-sheet-section-label">CUENTA</div>
              <button
                className="mob-sheet-row"
                onClick={() => { setSheetOpen(false); onNavigate("settings"); }}
              >
                <span className="mob-sheet-row__icon"><User size={18} strokeWidth={1.5} /></span>
                <span className="mob-sheet-row__label">Perfil · {firstName}</span>
                <ChevronRight size={14} strokeWidth={1.5} className="mob-sheet-row__plus" />
              </button>
              <button
                className="mob-sheet-row"
                onClick={() => { setSheetOpen(false); onNavigate("settings"); }}
              >
                <span className="mob-sheet-row__icon"><Settings size={18} strokeWidth={1.5} /></span>
                <span className="mob-sheet-row__label">Configuración</span>
                <ChevronRight size={14} strokeWidth={1.5} className="mob-sheet-row__plus" />
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
            </>
          )}

          <div className="mob-sheet-safe-area" />
        </div>
      </div>

      {/* ── Drag ghost (always mounted, shown via direct DOM) ─────────── */}
      <div ref={ghostRef} className="mob-drag-ghost" style={{ display: "none" }} aria-hidden="true">
        {ghostMod && (() => {
          const Ic = ghostMod.Icon;
          return (
            <>
              <span className="mob-module-btn__icon"><Ic size={22} strokeWidth={1.5} /></span>
              <span className="mob-module-btn__label">{ghostMod.label}</span>
            </>
          );
        })()}
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      {toast && (
        <div className="mob-toast" role="status" aria-live="polite">{toast}</div>
      )}
    </>
  );
}
