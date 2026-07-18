import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import TaskAlertBanner from "./TaskAlertBanner";
import MobileSearch from "./MobileSearch";
import useTaskAlerts from "../hooks/useTaskAlerts";
import logoLight from "../assets/logo.jpg";
import logoDark  from "../assets/logo-dark.png";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  manager:     "Manager",
  seller:      "Vendedor",
};

// ─── Mobile header date ───────────────────────────────────────────────────────

function MobileHeaderDate() {
  const raw = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const date = raw.charAt(0).toUpperCase() + raw.slice(1);
  return <span className="page-header__mobile-date">{date}</span>;
}

// ─── Mobile page header ───────────────────────────────────────────────────────

function MobilePageHeader({ initials, onSearchOpen, scrolled }) {
  return (
    <header className={`mob-ph${scrolled ? " mob-ph--compact" : ""}`}>
      <div className="mob-ph__left">
        <div className="mob-ph__logo-wrap">
          <img src={logoLight} alt="MediCross" className="mob-ph__logo mob-ph__logo--light" />
          <img src={logoDark}  alt="MediCross" className="mob-ph__logo mob-ph__logo--dark" />
        </div>
        {!scrolled && <MobileHeaderDate />}
      </div>
      <div className="mob-ph__actions">
        <button
          className="mob-ph__icon-btn"
          onClick={onSearchOpen}
          aria-label="Buscar"
        >
          <Search size={17} strokeWidth={1.5} />
        </button>
        <div className="mob-ph__avatar" aria-hidden="true">{initials}</div>
      </div>
    </header>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function Layout({ title, profile, onNavigate, pageKey, children }) {
  const initials  = (profile?.full_name || profile?.email || "U").slice(0, 2).toUpperCase();
  const fullName  = profile?.full_name  || profile?.email || "Usuario";
  const roleLabel = ROLE_LABELS[profile?.role] || profile?.role || "Usuario";

  const [isMobile,    setIsMobile]    = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [scrolled,    setScrolled]    = useState(false);

  const { alerts: taskAlerts } = useTaskAlerts(profile?.id ?? null);
  const hasAlert = taskAlerts.length > 0;

  // Respond to viewport changes
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  // Compact header on scroll (mobile only)
  useEffect(() => {
    if (!isMobile) return;
    const fn = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, [isMobile]);

  // Close search on navigate (page change)
  useEffect(() => { setSearchOpen(false); }, [pageKey]);

  return (
    <div className="app-shell">
      <Sidebar profile={profile} onNavigate={onNavigate} />

      <main className="main-content">
        {isMobile ? (
          /* ── Mobile header ── */
          <MobilePageHeader
            initials={initials}
            onSearchOpen={() => setSearchOpen(true)}
            scrolled={scrolled}
          />
        ) : (
          /* ── Desktop header ── */
          <header className={`page-header${hasAlert ? " page-header--has-alert" : ""}`}>
            <div className="page-header__title-block">
              <h1>{title}</h1>
            </div>
            <div className="page-header__actions">
              <GlobalSearch onNavigate={onNavigate} />
              <div className="page-header__sep" aria-hidden="true" />
              <div className="page-header__user">
                <div className="page-header__avatar" aria-hidden="true">{initials}</div>
                <div className="page-header__user-info">
                  <span className="page-header__user-name">{fullName}</span>
                  <span className="page-header__user-role">{roleLabel}</span>
                </div>
              </div>
            </div>
          </header>
        )}

        {hasAlert && (
          <TaskAlertBanner alerts={taskAlerts} onNavigate={onNavigate} />
        )}

        <div key={pageKey} className="page-enter">
          {children}
        </div>
      </main>

      {/* Mobile Spotlight search — rendered outside main-content for fixed overlay */}
      {isMobile && (
        <MobileSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onNavigate={onNavigate}
          profile={profile}
        />
      )}
    </div>
  );
}
