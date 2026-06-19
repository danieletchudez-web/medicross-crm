import { useState } from "react";
import { dismissTask, snoozeTask } from "../hooks/useTaskAlerts";
import "./TaskAlertBanner.css";

function daysUntil(value) {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date  = new Date(value); date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / 86400000);
}

export default function TaskAlertBanner({ alerts, onNavigate }) {
  const [idx,        setIdx]       = useState(0);
  const [confirming, setConfirming] = useState(false);

  if (!alerts || alerts.length === 0) return null;

  const safeIdx = Math.min(idx, alerts.length - 1);
  const task    = alerts[safeIdx];
  const d       = daysUntil(task.due_date);
  const detail  = d !== null && d < 0
    ? `Vencida hace ${Math.abs(d)} día${Math.abs(d) !== 1 ? "s" : ""}`
    : "Vence hoy";

  function handleSnooze(hours) {
    snoozeTask(task.id, Date.now() + hours * 3600000);
    setIdx(0);
    setConfirming(false);
  }

  function executeDismiss() {
    dismissTask(task.id);
    setIdx(0);
    setConfirming(false);
  }

  return (
    <div className="ph-alert" role="alert" aria-live="polite">
      {confirming ? (
        <>
          <span className="ph-alert__icon">⚠</span>
          <span className="ph-alert__confirm-text">
            ¿Descartás esta alerta? No volverá a mostrarse.
          </span>
          <div className="ph-alert__actions">
            <button className="ph-alert__btn" onClick={() => setConfirming(false)}>Cancelar</button>
            <button className="ph-alert__btn ph-alert__btn--danger" onClick={executeDismiss}>Sí, descartar</button>
          </div>
        </>
      ) : (
        <>
          <span className="ph-alert__icon">⚠</span>
          <span className="ph-alert__label">Tarea vencida</span>
          <span className="ph-alert__sep" aria-hidden="true" />
          <span className="ph-alert__title">{task.title}</span>
          <span className="ph-alert__detail">{detail}</span>

          {alerts.length > 1 && (
            <span className="ph-alert__nav">
              <button
                onClick={() => setIdx(i => Math.max(0, i - 1))}
                disabled={safeIdx === 0}
                aria-label="Anterior"
              >‹</button>
              <span>{safeIdx + 1}/{alerts.length}</span>
              <button
                onClick={() => setIdx(i => Math.min(alerts.length - 1, i + 1))}
                disabled={safeIdx === alerts.length - 1}
                aria-label="Siguiente"
              >›</button>
            </span>
          )}

          <div className="ph-alert__actions">
            <button className="ph-alert__btn" onClick={() => handleSnooze(2)}>Aplazar 2 h</button>
            <button className="ph-alert__btn" onClick={() => handleSnooze(24)}>Aplazar mañana</button>
            <button
              className="ph-alert__btn ph-alert__btn--primary"
              onClick={() => onNavigate("tasks")}
            >Ver tarea</button>
            <button
              className="ph-alert__close"
              onClick={() => setConfirming(true)}
              title="Descartar alerta"
              aria-label="Descartar alerta"
            >✕</button>
          </div>
        </>
      )}
    </div>
  );
}
