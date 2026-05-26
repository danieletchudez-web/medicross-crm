import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";

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

export default function Layout({ title, profile, onNavigate, pageKey, children }) {
  return (
    <div className="app-shell">
      <Sidebar profile={profile} onNavigate={onNavigate} />

      <main className="main-content">
        <header className="page-header">
          <div className="page-header__left">
            <h1>{title}</h1>
            <p>
              <strong>{profile?.full_name || "Usuario"}</strong> · <strong>{profile?.role || "sin rol"}</strong>
            </p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <GlobalSearch onNavigate={onNavigate} />
            <LiveClock />
          </div>
        </header>

        <div key={pageKey} className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
