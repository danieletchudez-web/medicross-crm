import { useEffect, useState } from "react";
import { Home, Users, Calendar, Bell, Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { key: "mobileHome",    label: "Inicio",   Icon: Home },
  { key: "accounts",      label: "Clientes", Icon: Users },
  { key: "calendar",      label: "Agenda",   Icon: Calendar },
  { key: "notifications", label: "Alertas",  Icon: Bell },
  { key: "medix",         label: "Medix",    Icon: Sparkles },
];

export default function MobileNav({ currentPage, onNavigate }) {
  const [isMobile,    setIsMobile]    = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [medixActive, setMedixActive] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  // Sync Medix tab active state with the panel open/close events
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

  function handleItem(key) {
    if (key === "medix") {
      document.dispatchEvent(new CustomEvent("crm:toggle-medix"));
      return;
    }
    onNavigate(key);
  }

  return (
    <nav className="mob-bottom-nav" aria-label="Navegación principal">
      {NAV_ITEMS.map(({ key, label, Icon }) => {
        const isActive = key === "medix" ? medixActive : currentPage === key;
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
