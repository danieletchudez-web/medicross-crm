import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import TaskAlertBanner from "./TaskAlertBanner";
import useTaskAlerts from "../hooks/useTaskAlerts";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  manager:     "Manager",
  seller:      "Vendedor",
};

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="layout-clock">
      <span className="layout-clock__time">{time}</span>
      <span className="layout-clock__date">{date}</span>
    </div>
  );
}

export default function Layout({ title, profile, onNavigate, pageKey, children }) {
  const initials  = (profile?.full_name || profile?.email || "U").slice(0, 2).toUpperCase();
  const fullName  = profile?.full_name  || profile?.email || "Usuario";
  const roleLabel = ROLE_LABELS[profile?.role] || profile?.role || "Usuario";

  const { alerts: taskAlerts } = useTaskAlerts(profile?.id ?? null);
  const hasAlert = taskAlerts.length > 0;

  return (
    <div className="app-shell">
      <Sidebar profile={profile} onNavigate={onNavigate} />

      <main className="main-content">
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

            <div className="page-header__sep" aria-hidden="true" />

            <LiveClock />
          </div>

        </header>

        {hasAlert && (
          <TaskAlertBanner alerts={taskAlerts} onNavigate={onNavigate} />
        )}

        <div key={pageKey} className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
