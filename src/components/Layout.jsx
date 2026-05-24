import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  const date = now.toLocaleDateString("es-AR", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
  return (
    <div className="layout-clock">
      <span className="layout-clock__time">{time}</span>
      <span className="layout-clock__date">{date}</span>
    </div>
  );
}

export default function Layout({ title, profile, onNavigate, children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => { if (window.innerWidth > 900) setMenuOpen(false); };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  function handleNavigate(page) {
    setMenuOpen(false);
    onNavigate(page);
  }

  return (
    <div className="app-shell">

      {/* Sidebar desktop */}
      <div className="desktop-sidebar">
        <Sidebar profile={profile} onNavigate={onNavigate} />
      </div>

      {/* Menú móvil */}
      {menuOpen && (
        <div className="mobile-sidebar-overlay" onClick={() => setMenuOpen(false)}>
          <div className="mobile-sidebar-panel" onClick={e => e.stopPropagation()}>
            <Sidebar profile={profile} onNavigate={handleNavigate} />
          </div>
        </div>
      )}

      <main className="main-content">
        <header className="page-header">

          {/* Botón hamburguesa — izquierda, solo móvil */}
          <button
            className="mobile-menu-button"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Abrir menú"
          >
            ☰
          </button>

          {/* Título — centrado en desktop, después del botón en móvil */}
          <div className="page-header__left">
            <h1>{title}</h1>
            <p>
              <strong>{profile?.full_name || "Usuario"}</strong> · <strong>{profile?.role || "sin rol"}</strong>
            </p>
          </div>

          {/* Reloj — derecha */}
          <LiveClock />

        </header>

        {children}
      </main>
    </div>
  );
}