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
  const [idx, setIdx] = useState(0);

  if (!alerts || alerts.length === 0) return null;

  const safeIdx = Math.min(idx, alerts.length - 1);
  const task    = alerts[safeIdx];
  const d       = daysUntil(task.due_date);
  const detail  = d < 0
    ? `Vencida hace ${Math.abs(d)} día${Math.abs(d) !== 1 ? "s" : ""}`
    : "Vence hoy";

  function handleSnooze(hours) {
    snoozeTask(task.id, Date.now() + hours * 3600000);
    setIdx(0);
  }

  function handleDismiss() {
    dismissTask(task.id);
    setIdx(0);
  }

  return (
    <div className="tab-banner" role="alert" aria-live="polite">
      <div className="tab-banner__top">
        <span className="tab-banner__icon">⚠️</span>
        <span className="tab-banner__label">Tarea vencida</span>
        {alerts.length > 1 && (
          <span className="tab-banner__counter">{safeIdx + 1}/{alerts.length}</span>
        )}
        <button className="tab-banner__close" onClick={handleDismiss} title="Descartar hoy">✕</button>
      </div>

      <p className="tab-banner__title">{task.title}</p>
      <p className="tab-banner__detail">{detail}</p>

      <div className="tab-banner__actions">
        <button className="tab-banner__btn" onClick={() => handleSnooze(2)}>Aplazar 2h</button>
        <button className="tab-banner__btn" onClick={() => handleSnooze(24)}>Aplazar mañana</button>
        <button className="tab-banner__btn tab-banner__btn--primary" onClick={() => { onNavigate("tasks"); handleDismiss(); }}>
          Ver tarea
        </button>
      </div>

      {alerts.length > 1 && (
        <div className="tab-banner__nav">
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={safeIdx === 0}>‹</button>
          <button onClick={() => setIdx(i => Math.min(alerts.length - 1, i + 1))} disabled={safeIdx === alerts.length - 1}>›</button>
        </div>
      )}
    </div>
  );
}
