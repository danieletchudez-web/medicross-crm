import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useDailyMotivation } from "../hooks/useDailyMotivation";
import "./DailyMotivationPopup.css";

const TAGLINES_BY_CATEGORY = {
  ventas:       "Escuchá. Acompañá. Cerrá.",
  seguimiento:  "Constancia sobre inspiración.",
  crm:          "Registrá. Gestioná. Ganá.",
  productividad:"Orden. Foco. Acción.",
  visitas:      "Preparate. Visitá. Registrá.",
  clientes:     "Presencia que genera confianza.",
  constancia:   "Los resultados son consecuencia.",
  equipo:       "Juntos se vende mejor.",
  pipeline:     "Lo visible se puede gestionar.",
  general:      "Enfocate. Acompañá. Seguí.",
};

function Popup({ message, onClose }) {
  const tagline = TAGLINES_BY_CATEGORY[message.category] ?? TAGLINES_BY_CATEGORY.general;
  const primaryRef = useRef(null);

  // Focus the primary button on mount for keyboard accessibility
  useEffect(() => {
    const t = setTimeout(() => primaryRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Close on ESC
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div
      className="dm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mensaje de inicio de jornada"
      onClick={handleOverlayClick}
    >
      <div className="dm-card">
        {/* Icon */}
        <div className="dm-icon-wrap" aria-hidden="true">
          <Sparkles size={22} strokeWidth={1.5} />
        </div>

        {/* Label */}
        <div className="dm-label">Mensaje del día</div>

        {/* Divider */}
        <div className="dm-divider" aria-hidden="true" />

        {/* Main message */}
        <p className="dm-message">{message.message}</p>

        {/* Subtitle */}
        {message.subtitle && (
          <p className="dm-subtitle">{message.subtitle}</p>
        )}

        {/* Inner tagline */}
        <div className="dm-tagline" aria-hidden="true">
          <span className="dm-tagline__text">{tagline}</span>
        </div>

        {/* Primary CTA */}
        <button
          ref={primaryRef}
          className="dm-btn-primary"
          onClick={onClose}
        >
          Comenzar el día
          <ArrowRight size={15} strokeWidth={2.2} />
        </button>

        {/* Secondary close */}
        <button className="dm-btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>,
    document.body
  );
}

// Gate: owns the hook, renders nothing if no popup or no userId
export default function DailyMotivationGate({ userId }) {
  const { showPopup, message, closePopup } = useDailyMotivation(userId);
  if (!showPopup || !message) return null;
  return <Popup message={message} onClose={closePopup} />;
}
