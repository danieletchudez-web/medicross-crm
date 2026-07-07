import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Leaf, Sparkles } from "lucide-react";
import { useDailyMotivation } from "../hooks/useDailyMotivation";
import "./DailyMotivationPopup.css";

// ── Taglines by category ─────────────────────────────────────────────────────
const TAGLINES = {
  ventas:       { line1: "Escuchá. Acompañá. Cerrá.", line2: "Los resultados son consecuencia." },
  seguimiento:  { line1: "Constancia sobre inspiración.",  line2: "Un paso más hoy." },
  crm:          { line1: "Registrá. Gestioná. Ganá.",      line2: "El orden también es una ventaja." },
  productividad:{ line1: "Orden. Foco. Acción.",           line2: "Lo que importa merece tu mejor energía." },
  visitas:      { line1: "Preparate. Visitá. Registrá.",   line2: "Cada visita bien hecha multiplica." },
  clientes:     { line1: "Presencia que genera confianza.",line2: "El cliente recuerda cómo lo hiciste sentir." },
  constancia:   { line1: "Los resultados son consecuencia.",line2: "Seguí adelante sin parar." },
  equipo:       { line1: "Juntos se vende mejor.",         line2: "Compartir información es ganar." },
  pipeline:     { line1: "Lo visible se puede gestionar.", line2: "Un pipeline ordenado es una meta visible." },
  bienestar:    { line1: "Cuidate. Enfocate. Avanzá.",     line2: "Tu energía es tu mayor activo." },
  general:      { line1: "Enfocate. Acompañá. Seguí.",     line2: "Los resultados son consecuencia." },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Animation variants ───────────────────────────────────────────────────────
const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.28, ease: "easeOut" } },
  exit: (fm) => ({
    opacity: 0,
    transition: fm
      ? { duration: 0.65, ease: [0.22, 1, 0.36, 1] }
      : { duration: 0.22, ease: "easeIn" },
  }),
};

const cardVariants = {
  hidden:  { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
  exit: (fm) => ({
    opacity: 0,
    scale: fm ? 0.98 : 0.96,
    y:     fm ? -10  : 6,
    transition: fm
      ? { duration: 0.65, ease: [0.22, 1, 0.36, 1] }
      : { duration: 0.22, ease: "easeIn" },
  }),
};

const iconVariants = {
  hidden:  { opacity: 0, scale: 0.82, y: -6 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { duration: 0.38, delay: 0.10, ease: "easeOut" },
  },
};

const taglineVariants = {
  hidden:  { opacity: 0, y: 6 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.30, delay: 0.18, ease: "easeOut" },
  },
};

// ── Popup inner component ────────────────────────────────────────────────────
function Popup({ message, onClose, isVisible }) {
  const tagline    = TAGLINES[message.category] ?? TAGLINES.general;
  const primaryRef = useRef(null);

  const [phase,     setPhase]     = useState("idle"); // "idle" | "loading"
  const [focusMode, setFocusMode] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => primaryRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleFocusMode() {
    if (phase !== "idle") return;
    setFocusMode(true);
    setPhase("loading");
    await sleep(500);
    onClose();
    await sleep(700);
    setShowToast(true);
    await sleep(800);
    setShowToast(false);
    setFocusMode(false);
    setPhase("idle");
  }

  return createPortal(
    <>
      <AnimatePresence custom={focusMode}>
        {isVisible && (
          <motion.div
            className={`dm-overlay${phase === "loading" ? " dm-overlay--loading" : ""}`}
            custom={focusMode}
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Mensaje de inicio de jornada"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
          >
            <motion.div
              className="dm-card dm-card--ready"
              custom={focusMode}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {/* Organic wave decorations */}
              <span className="dm-wave dm-wave--tr"   aria-hidden="true" />
              <span className="dm-wave dm-wave--tr-2" aria-hidden="true" />
              <span className="dm-wave dm-wave--bl"   aria-hidden="true" />

              {/* Icon */}
              <motion.div
                className="dm-icon-wrap"
                variants={iconVariants}
                aria-hidden="true"
              >
                <Leaf size={24} strokeWidth={1.5} />
              </motion.div>

              {/* Title */}
              <h2 className="dm-title">
                Un gran día comienza<br />con una gran decisión.
              </h2>

              {/* Divider */}
              <div className="dm-divider" aria-hidden="true" />

              {/* Dynamic message from Supabase */}
              <p className="dm-message">{message.message}</p>

              {/* Secondary tagline card */}
              <motion.div
                className="dm-tagline-card"
                variants={taglineVariants}
              >
                <Sparkles
                  className="dm-tagline-icon"
                  size={16}
                  strokeWidth={1.5}
                />
                <div className="dm-tagline-text">
                  <strong>{tagline.line1}</strong>
                  {tagline.line2}
                </div>
              </motion.div>

              {/* Primary CTA */}
              <motion.button
                ref={primaryRef}
                className={`dm-btn-primary${phase === "loading" ? " dm-btn--loading" : ""}`}
                onClick={handleFocusMode}
                whileHover={phase === "idle" ? { scale: 1.02, boxShadow: "0 8px 28px rgba(15,23,42,0.28)" } : undefined}
                whileTap={phase === "idle" ? { scale: 0.98 } : undefined}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                style={phase === "loading" ? { pointerEvents: "none" } : undefined}
              >
                {phase === "loading" ? (
                  <>
                    <span className="dm-spinner" aria-hidden="true" />
                    Preparando tu jornada…
                  </>
                ) : (
                  <>
                    Comenzar el día
                    <ArrowRight size={16} strokeWidth={2.2} />
                  </>
                )}
              </motion.button>

              {/* Secondary close */}
              <motion.button
                className="dm-btn-secondary"
                onClick={onClose}
                whileHover={{ color: "#475569" }}
                transition={{ duration: 0.2 }}
                style={phase === "loading" ? { opacity: 0, pointerEvents: "none" } : undefined}
              >
                Cerrar
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focus mode toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            className="dm-toast"
            initial={{ opacity: 0, x: "-50%", y: 10 }}
            animate={{ opacity: 1, x: "-50%", y: 0 }}
            exit={{ opacity: 0, x: "-50%", y: -4 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            aria-live="polite"
          >
            ✓ Que tengas una gran jornada.
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

// ── Gate: owns the hook, renders nothing if no popup or no userId ─────────────
export default function DailyMotivationGate({ userId }) {
  const { showPopup, message, closePopup } = useDailyMotivation(userId);
  if (!message) return null;
  return <Popup message={message} onClose={closePopup} isVisible={showPopup} />;
}
