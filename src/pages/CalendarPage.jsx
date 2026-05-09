import { useEffect, useState, useMemo } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./CalendarPage.css";

const STATUS_COLOR = {
  programada:        { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  realizada:         { bg: "#f0fdf4", text: "#059669", border: "#bbf7d0" },
  reprogramada:      { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  cancelada:         { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  pendiente_informe: { bg: "#faf5ff", text: "#7c3aed", border: "#ddd6fe" },
};

const PRIORITY_DOT = { alta: "#ef4444", media: "#f59e0b", baja: "#10b981" };

const DAYS   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function startOfMonth(y, m) { return new Date(y, m, 1); }
function daysInMonth(y, m)  { return new Date(y, m + 1, 0).getDate(); }

export default function CalendarPage({ profile, onNavigate }) {
  const today  = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [view,  setView]  = useState("mes");       // "mes" | "semana" | "lista"
  const [visits, setVisits]   = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);  // visita seleccionada para detalle
  const [filterUnit, setFilterUnit] = useState("todas");
  const [filterStatus, setFilterStatus] = useState("todas");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [vRes, aRes] = await Promise.all([
      supabase.from("visits")
        .select("*, accounts(name), products(name, line)")
        .order("visit_date", { ascending: true }),
      supabase.from("accounts").select("id, name").order("name"),
    ]);
    setVisits(vRes.data || []);
    setAccounts(aRes.data || []);
  }

  /* ── Filtros ── */
  const filtered = useMemo(() => {
    return visits.filter((v) => {
      if (filterStatus !== "todas" && v.status !== filterStatus) return false;
      if (filterUnit   !== "todas" && v.business_unit !== filterUnit) return false;
      return true;
    });
  }, [visits, filterStatus, filterUnit]);

  const businessUnits = useMemo(() => {
    const units = [...new Set(visits.map((v) => v.business_unit).filter(Boolean))];
    return ["todas", ...units];
  }, [visits]);

  /* ── Visitas por día ── */
  function visitsForDay(d) {
    return filtered.filter((v) => {
      if (!v.visit_date) return false;
      const vd = new Date(v.visit_date);
      return isSameDay(vd, d);
    });
  }

  /* ── Navegación ── */
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setYear(d.getFullYear()); setMonth(d.getMonth());
    setWeekStart(d);
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setYear(d.getFullYear()); setMonth(d.getMonth());
    setWeekStart(d);
  }

  /* Semana — inicio del lunes actual */
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  /* Próximas visitas para vista lista */
  const upcomingVisits = useMemo(() => {
    const now = new Date(); now.setHours(0,0,0,0);
    return filtered
      .filter((v) => v.visit_date && new Date(v.visit_date) >= now)
      .slice(0, 30);
  }, [filtered]);

  /* Stats del mes actual */
  const monthStats = useMemo(() => {
    const inMonth = filtered.filter((v) => {
      if (!v.visit_date) return false;
      const d = new Date(v.visit_date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return {
      total:       inMonth.length,
      programadas: inMonth.filter((v) => v.status === "programada").length,
      realizadas:  inMonth.filter((v) => v.status === "realizada").length,
      pendientes:  inMonth.filter((v) => v.status === "pendiente_informe").length,
    };
  }, [filtered, year, month]);

  /* ── Renderizar chip de visita ── */
  function VisitChip({ v, compact = false }) {
    const sc = STATUS_COLOR[v.status] || STATUS_COLOR.programada;
    const pd = PRIORITY_DOT[v.priority] || "#94a3b8";
    return (
      <div
        className={`cal-chip ${compact ? "cal-chip--compact" : ""}`}
        style={{ background: sc.bg, borderColor: sc.border, color: sc.text }}
        onClick={(e) => { e.stopPropagation(); setSelected(v); }}
        title={`${v.accounts?.name} · ${v.visit_type || "—"}`}
      >
        <span className="cal-chip__dot" style={{ background: pd }} />
        <span className="cal-chip__text">
          {v.visit_time ? v.visit_time.slice(0,5) + " " : ""}
          {v.accounts?.name || "Sin cliente"}
        </span>
      </div>
    );
  }

  /* ── Vista mes ── */
  function MonthView() {
    const firstDay = startOfMonth(year, month).getDay();
    const totalDays = daysInMonth(year, month);
    const cells = [];

    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(new Date(year, month, d));

    return (
      <div className="cal-month">
        <div className="cal-month__header">
          {DAYS.map((d) => <div key={d} className="cal-month__day-label">{d}</div>)}
        </div>
        <div className="cal-month__grid">
          {cells.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="cal-cell cal-cell--empty" />;
            const dayVisits = visitsForDay(date);
            const isToday   = isSameDay(date, today);
            return (
              <div key={date.toISOString()} className={`cal-cell ${isToday ? "cal-cell--today" : ""}`}>
                <div className="cal-cell__num">{date.getDate()}</div>
                <div className="cal-cell__visits">
                  {dayVisits.slice(0, 3).map((v) => <VisitChip key={v.id} v={v} compact />)}
                  {dayVisits.length > 3 && (
                    <div className="cal-cell__more">+{dayVisits.length - 3} más</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Vista semana ── */
  function WeekView() {
    return (
      <div className="cal-week">
        <div className="cal-week__header">
          <div className="cal-week__time-col" />
          {weekDays.map((d) => (
            <div key={d.toISOString()} className={`cal-week__day-head ${isSameDay(d, today) ? "today" : ""}`}>
              <span className="cal-week__day-name">{DAYS[d.getDay()]}</span>
              <span className={`cal-week__day-num ${isSameDay(d, today) ? "today" : ""}`}>{d.getDate()}</span>
            </div>
          ))}
        </div>

        <div className="cal-week__body">
          {weekDays.map((d) => {
            const dayVisits = visitsForDay(d);
            return (
              <div key={d.toISOString()} className={`cal-week__col ${isSameDay(d, today) ? "today" : ""}`}>
                {dayVisits.length === 0 ? (
                  <div className="cal-week__empty">—</div>
                ) : dayVisits.map((v) => <VisitChip key={v.id} v={v} />)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Vista lista ── */
  function ListView() {
    if (upcomingVisits.length === 0) {
      return <div className="cal-list-empty">No hay próximas visitas programadas.</div>;
    }

    let lastDate = null;

    return (
      <div className="cal-list">
        {upcomingVisits.map((v) => {
          const vDate = v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "—";
          const showDate = vDate !== lastDate;
          lastDate = vDate;
          const sc = STATUS_COLOR[v.status] || STATUS_COLOR.programada;
          const pd = PRIORITY_DOT[v.priority] || "#94a3b8";

          return (
            <div key={v.id}>
              {showDate && <div className="cal-list__date-sep">{vDate}</div>}
              <div className="cal-list-item" onClick={() => setSelected(v)}>
                <div className="cal-list-item__left">
                  <span className="cal-list-item__dot" style={{ background: pd }} />
                  <div>
                    <strong>{v.accounts?.name || "Sin cliente"}</strong>
                    <span>
                      {v.visit_time ? v.visit_time.slice(0,5) + " · " : ""}
                      {v.visit_type || "—"}
                      {v.business_unit ? ` · ${v.business_unit}` : ""}
                      {v.contact_name ? ` · ${v.contact_name}` : ""}
                    </span>
                    {v.objective && <em>{v.objective}</em>}
                  </div>
                </div>
                <span className="cal-list-item__status" style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}>
                  {v.status?.replace("_", " ") || "programada"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Modal detalle ── */
  function DetailModal({ v, onClose }) {
    if (!v) return null;
    const sc = STATUS_COLOR[v.status] || STATUS_COLOR.programada;
    const pd = PRIORITY_DOT[v.priority] || "#94a3b8";

    return (
      <div className="cal-modal-overlay" onClick={onClose}>
        <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cal-modal__header">
            <div className="cal-modal__title-wrap">
              <span className="cal-modal__dot" style={{ background: pd }} />
              <h3>{v.accounts?.name || "Sin cliente"}</h3>
            </div>
            <button className="cal-modal__close" onClick={onClose}>✕</button>
          </div>

          <div className="cal-modal__body">
            <div className="cal-modal__chips">
              <span className="cal-modal__chip" style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}>{v.status?.replace("_"," ")}</span>
              {v.priority && <span className="cal-modal__chip" style={{ background: `${pd}15`, color: pd, borderColor: `${pd}40` }}>{v.priority}</span>}
              {v.visit_type && <span className="cal-modal__chip">{v.visit_type}</span>}
              {v.business_unit && <span className="cal-modal__chip">{v.business_unit}</span>}
              {v.pipeline_stage && <span className="cal-modal__chip">📊 {v.pipeline_stage}</span>}
            </div>

            <div className="cal-modal__grid">
              {v.visit_date && <Row label="Fecha" value={new Date(v.visit_date).toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })} />}
              {v.visit_time && <Row label="Hora" value={v.visit_time.slice(0,5)} />}
              {v.contact_name && <Row label="Contacto" value={v.contact_name} />}
              {v.products?.name && <Row label="Producto" value={`${v.products.name} · ${v.products.line || ""}`} />}
              {v.commercial_potential > 0 && <Row label="Potencial" value={`$${Number(v.commercial_potential).toLocaleString("es-AR")}`} />}
              {v.followup_date && <Row label="Seguimiento" value={new Date(v.followup_date).toLocaleDateString("es-AR")} />}
              {v.next_action_date && <Row label="Próxima acción" value={new Date(v.next_action_date).toLocaleDateString("es-AR")} />}
            </div>

            {v.objective && <Section label="Objetivo" text={v.objective} />}
            {v.notes     && <Section label="Notas" text={v.notes} />}
            {v.result    && <Section label="Resultado" text={v.result} color="#059669" />}
            {v.objection && <Section label="Objeción" text={v.objection} color="#dc2626" />}
            {v.next_action && <Section label="Próxima acción" text={v.next_action} />}
            {v.next_step   && <Section label="Próximo compromiso" text={v.next_step} />}
          </div>

          <div className="cal-modal__footer">
            <button className="cal-modal__btn" onClick={() => { onClose(); onNavigate("visits"); }}>
              Ir a Visitas →
            </button>
          </div>
        </div>
      </div>
    );
  }

  function Row({ label, value }) {
    return (
      <div className="cal-modal__row">
        <span className="cal-modal__row-label">{label}</span>
        <span className="cal-modal__row-value">{value}</span>
      </div>
    );
  }

  function Section({ label, text, color }) {
    return (
      <div className="cal-modal__section">
        <span className="cal-modal__section-label" style={color ? { color } : {}}>{label}</span>
        <p className="cal-modal__section-text">{text}</p>
      </div>
    );
  }

  return (
    <Layout title="Calendario Comercial" profile={profile} onNavigate={onNavigate}>
      <div className="cal-page">

        {/* KPIs del mes */}
        <section className="cal-kpis">
          <CalKpi label={`Visitas en ${MONTHS[month]}`} value={monthStats.total}       accent="blue" />
          <CalKpi label="Programadas"                   value={monthStats.programadas}  accent="slate" />
          <CalKpi label="Realizadas"                    value={monthStats.realizadas}   accent="green" />
          <CalKpi label="Pendiente informe"             value={monthStats.pendientes}   accent="amber" />
        </section>

        {/* Toolbar */}
        <div className="cal-toolbar">
          <div className="cal-toolbar__left">
            <button className="cal-nav-btn" onClick={view === "semana" ? prevWeek : prevMonth}>‹</button>
            <h2 className="cal-toolbar__title">
              {view === "semana"
                ? `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${MONTHS[weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`
                : `${MONTHS[month]} ${year}`}
            </h2>
            <button className="cal-nav-btn" onClick={view === "semana" ? nextWeek : nextMonth}>›</button>
            <button className="cal-today-btn" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>
              Hoy
            </button>
          </div>

          <div className="cal-toolbar__right">
            {/* Filtros */}
            <select className="cal-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="todas">Todos los estados</option>
              <option value="programada">Programadas</option>
              <option value="realizada">Realizadas</option>
              <option value="reprogramada">Reprogramadas</option>
              <option value="cancelada">Canceladas</option>
              <option value="pendiente_informe">Pend. informe</option>
            </select>

            <select className="cal-filter-select" value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)}>
              {businessUnits.map((u) => (
                <option key={u} value={u}>{u === "todas" ? "Todas las unidades" : u}</option>
              ))}
            </select>

            {/* View tabs */}
            <div className="cal-view-tabs">
              {["mes","semana","lista"].map((v) => (
                <button key={v} className={`cal-view-tab ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>

            <button className="cal-new-btn" onClick={() => onNavigate("visits")}>+ Nueva visita</button>
          </div>
        </div>

        {/* Calendario */}
        <div className="cal-main">
          {view === "mes"    && <MonthView />}
          {view === "semana" && <WeekView />}
          {view === "lista"  && <ListView />}
        </div>

        {/* Leyenda */}
        <div className="cal-legend">
          {Object.entries(STATUS_COLOR).map(([key, c]) => (
            <span key={key} className="cal-legend-item">
              <span className="cal-legend-dot" style={{ background: c.text }} />
              {key.replace("_"," ")}
            </span>
          ))}
        </div>

        {/* Modal detalle */}
        {selected && <DetailModal v={selected} onClose={() => setSelected(null)} />}

        <footer className="cal-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>
      </div>
    </Layout>
  );
}

function CalKpi({ label, value, accent = "blue" }) {
  const colors = { blue: "#3b82f6", green: "#10b981", amber: "#f59e0b", slate: "#64748b" };
  return (
    <article className="cal-kpi" style={{ borderTopColor: colors[accent] || "#3b82f6" }}>
      <span className="cal-kpi__label">{label}</span>
      <strong className="cal-kpi__value">{value}</strong>
    </article>
  );
}