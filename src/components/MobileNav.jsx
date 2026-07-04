import { useEffect, useState } from "react";
import { Home, Users, Calendar, Bell, MoreHorizontal } from "lucide-react";

const NAV_ITEMS = [
  { key: "mobileHome",    label: "Inicio",   Icon: Home },
  { key: "accounts",      label: "Clientes", Icon: Users },
  { key: "calendar",      label: "Agenda",   Icon: Calendar },
  { key: "notifications", label: "Alertas",  Icon: Bell },
  { key: "more",          label: "Más",      Icon: MoreHorizontal },
];

export default function MobileNav({ currentPage, onNavigate }) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  if (!isMobile) return null;

  function handleItem(key) {
    if (key === "more") {
      // Sheet lives in MobileDock — dispatch event
      document.dispatchEvent(new CustomEvent("crm:toggle-sheet"));
      return;
    }
    onNavigate(key);
  }

  return (
    <nav className="mob-bottom-nav" aria-label="Navegación principal">
      {NAV_ITEMS.map(({ key, label, Icon }) => {
        const isActive = currentPage === key;
        return (
          <button
            key={key}
            className={`mob-nav-item${isActive ? " mob-nav-item--active" : ""}`}
            onClick={() => handleItem(key)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
