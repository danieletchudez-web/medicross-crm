export function ModuleHeader({ title, subtitle, actions }) {
  return (
    <section className="crm-module-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="crm-module-header__actions">{actions}</div>}
    </section>
  );
}

export function MetricKpi({ label, value, sub, accent = "blue" }) {
  return (
    <article className={`crm-kpi crm-kpi--${accent}`}>
      <span className="crm-kpi__label">{label}</span>
      <strong className="crm-kpi__value">{value}</strong>
      {sub && <small className="crm-kpi__sub">{sub}</small>}
    </article>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="crm-empty-state">
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
