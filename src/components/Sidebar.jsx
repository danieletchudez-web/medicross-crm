import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Sidebar.css";
import logoImg from "../assets/logo.jpg";

const MENU = [
  { id: "managerDashboard", label: "Dashboard",           icon: "▦" },
  { id: "salesAnalytics",   label: "Análisis Comercial",  icon: "◑" },
  { id: "accounts",         label: "Clientes / Cuentas",  icon: "◎" },
  { id: "products",         label: "Productos / Share Kit", icon: "⬡" },
  { id: "opportunities",    label: "Oportunidades",        icon: "◇" },
  { id: "campaigns",        label: "Campañas",             icon: "◉" },
  { id: "todayActions",     label: "Acciones Hoy",         icon: "◷" },
  { id: "visits",           label: "Visitas",              icon: "◌" },
  { id: "calendar",         label: "Calendario",           icon: "▦" },
  { id: "adminUsers",       label: "Administración",       icon: "⊞" },
];

export default function Sidebar({ profile, onNavigate }) {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

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

  const initials = (profile?.full_name || profile?.email || "U").slice(0, 1).toUpperCase();

  const roleLabel = {
    super_admin: "Super Admin",
    manager:     "Manager",
    seller:      "Vendedor",
  }[profile?.role] || profile?.role || "Usuario";

  const email = profile?.email || "";
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
          <span className="sidebar-nav__group-label">Módulos</span>
          {MENU.filter((item) => canSee(item.id)).map((item) => (
            <button key={item.id} type="button" className="sidebar-nav__item" onClick={() => onNavigate(item.id)}>
              <span className="sidebar-nav__icon">{item.icon}</span>
              <span className="sidebar-nav__label">{item.label}</span>
            </button>
          ))}
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