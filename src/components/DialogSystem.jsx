import { useEffect, useRef, useState } from "react";

export default function DialogSystem() {
  const [toasts, setToasts] = useState([]);
  const originalAlert = useRef(null);

  useEffect(() => {
    originalAlert.current = window.alert;
    window.alert = (message) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts(prev => [...prev, { id, message: String(message || "") }].slice(-4));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4200);
    };
    return () => {
      if (originalAlert.current) window.alert = originalAlert.current;
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="crm-toast-stack" role="status" aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className="crm-toast">
          <span>{toast.message}</span>
          <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>Cerrar</button>
        </div>
      ))}
    </div>
  );
}
