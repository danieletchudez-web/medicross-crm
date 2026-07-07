import { useCallback, useEffect, useState } from "react";
import {
  MapPin, CheckSquare, Target, Sparkles, Navigation,
  ChevronRight, ChevronDown, Clock, RefreshCw, FileText,
  TrendingUp, Calendar, Plus,
} from "lucide-react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return null;
  const dt    = new Date(d + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((dt - today) / 86_400_000);
  if (diff === 0)  return "Hoy";
  if (diff === 1)  return "Mañana";
  if (diff < 0)   return `Hace ${Math.abs(diff)}d`;
  return dt.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const dt    = new Date(dateStr + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((dt - today) / 86_400_000);
}

function fmtTime(t) { return t ? t.slice(0, 5) : null; }

function fmtMoney(n) {
  if (!n || n === 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function mapsURL(addr, name) {
  return `https://maps.google.com/?q=${encodeURIComponent(addr || name || "")}`;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="hoy-page">
      <div className="hoy-skeleton hoy-skeleton--sm" />
      <div className="hoy-skeleton hoy-skeleton--xs" />
      <div className="hoy-skeleton hoy-skeleton--lg" />
      <div className="hoy-skeleton" />
      <div className="hoy-skeleton hoy-skeleton--sm" />
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileHomePage({ profile, onNavigate, pageKey }) {
  const [loading,      setLoading]      = useState(true);
  const [visits,       setVisits]       = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [opps,         setOpps]         = useState([]);
  const [quotesCount,  setQuotesCount]  = useState(0);
  const [licitaciones, setLicitaciones] = useState([]);
  const [pipeline,     setPipeline]     = useState({ total: 0, forecast: 0, count: 0 });
  const [collapseOpen, setCollapseOpen] = useState(false);

  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Vendedor";
  const todayStr  = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const twoWeeksLater = new Date();
      twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
      const twoWeeksStr = twoWeeksLater.toISOString().split("T")[0];

      const [visitsRes, tasksRes, oppsRes, quotesRes, licitRes, pipelineRes] = await Promise.all([
        supabase
          .from("visits")
          .select("id, visit_date, visit_time, status, accounts(id, name, address)")
          .eq("status", "programada")
          .gte("visit_date", todayStr)
          .order("visit_date", { ascending: true })
          .order("visit_time", { ascending: true, nullsFirst: false })
          .limit(6),
        supabase
          .from("tasks")
          .select("id, title, due_date, priority, status")
          .in("status", ["pendiente", "en_progreso"])
          .order("due_date", { ascending: true, nullsFirst: true })
          .limit(10),
        supabase
          .from("opportunities")
          .select("id, name, amount, probability, stage, accounts(name)")
          .not("stage", "in", '("Ganado","Perdido")')
          .gte("probability", 60)
          .order("probability", { ascending: false })
          .limit(5),
        supabase
          .from("cotizaciones")
          .select("id", { count: "exact", head: true })
          .eq("estado", "pendiente")
          .eq("deleted", false),
        supabase
          .from("tenders")
          .select("id, institution, process_name, process_number, end_date, operational_status, priority")
          .gte("end_date", todayStr)
          .lte("end_date", twoWeeksStr)
          .not("resultado", "in", '("ganada","perdida")')
          .order("end_date", { ascending: true })
          .limit(6),
        supabase
          .from("opportunities")
          .select("amount, forecast_amount")
          .not("stage", "in", '("Ganado","Perdido")'),
      ]);

      setVisits(visitsRes.data || []);
      setTasks(tasksRes.data || []);
      setOpps(oppsRes.data || []);
      setQuotesCount(quotesRes.count || 0);
      setLicitaciones(licitRes.data || []);

      const pipeData = pipelineRes.data || [];
      const total    = pipeData.reduce((s, o) => s + Number(o.amount || 0), 0);
      const forecast = pipeData.reduce((s, o) => s + Number(o.forecast_amount || 0), 0);
      setPipeline({ total, forecast, count: pipeData.length });
    } catch (err) {
      console.error("[MobileHome] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [todayStr, pageKey]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const todayVisits   = visits.filter(v => v.visit_date === todayStr);
  const futureVisits  = visits.filter(v => v.visit_date > todayStr).slice(0, 2);
  const todayTasks    = tasks.filter(t => !t.due_date || t.due_date <= todayStr);
  const futureTasks   = tasks.filter(t => t.due_date && t.due_date > todayStr).slice(0, 3);
  const hotOpps       = opps.filter(o => Number(o.probability) >= 70).slice(0, 3);

  const chipVisits    = visits.filter(v => v.visit_date === todayStr).length;
  const chipTasks     = tasks.length;
  const chipHot       = opps.filter(o => Number(o.probability) >= 70).length;
  const isQuiet       = chipVisits === 0 && chipTasks === 0 && chipHot === 0 && quotesCount === 0;

  if (loading) {
    return (
      <Layout title="HOY" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
        <Skeleton />
      </Layout>
    );
  }

  return (
    <Layout title="HOY" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="hoy-page">

        {/* ── GREETING ──────────────────────────────────────────────── */}
        <div className="hoy-greeting">
          <p className="hoy-greeting__text">{getGreeting()}, {firstName}.</p>
        </div>

        {/* ── HOY TENÉS ─────────────────────────────────────────────── */}
        <div className="hoy-tenés-wrap">
          <p className="hoy-eyebrow">HOY TENÉS</p>
          <div className="hoy-chips">
            {chipVisits > 0 && (
              <button className="hoy-chip hoy-chip--visit" onClick={() => onNavigate("visits")}>
                <MapPin size={12} strokeWidth={1.5} />
                {chipVisits} {chipVisits === 1 ? "visita" : "visitas"}
              </button>
            )}
            {chipTasks > 0 && (
              <button className="hoy-chip hoy-chip--task" onClick={() => onNavigate("tasks")}>
                <CheckSquare size={12} strokeWidth={1.5} />
                {chipTasks} {chipTasks === 1 ? "tarea" : "tareas"}
              </button>
            )}
            {chipHot > 0 && (
              <button className="hoy-chip hoy-chip--hot" onClick={() => onNavigate("opportunities")}>
                <Target size={12} strokeWidth={1.5} />
                {chipHot} {chipHot === 1 ? "caliente" : "calientes"}
              </button>
            )}
            {quotesCount > 0 && (
              <button className="hoy-chip hoy-chip--quote" onClick={() => onNavigate("cotizador")}>
                <FileText size={12} strokeWidth={1.5} />
                {quotesCount} {quotesCount === 1 ? "cotización" : "cotizaciones"}
              </button>
            )}
            {isQuiet && (
              <span className="hoy-chip hoy-chip--free">Día tranquilo</span>
            )}
          </div>
        </div>

        {/* ── AGENDA HOY ────────────────────────────────────────────── */}
        <div className="hoy-section">
          <div className="hoy-section__head">
            <p className="hoy-eyebrow">
              <MapPin size={10} strokeWidth={2.5} style={{ display:"inline", marginRight:4, verticalAlign:"middle" }} />
              AGENDA HOY
            </p>
            <button className="hoy-section__more" onClick={() => onNavigate("visits")}>
              Ver agenda <ChevronRight size={12} strokeWidth={2} />
            </button>
          </div>

          {todayVisits.length === 0 ? (
            <div className="hoy-empty-state">
              <p className="hoy-empty-state__text">Sin visitas programadas para hoy</p>
              <button className="hoy-empty-state__cta" onClick={() => onNavigate("visits")}>
                <Plus size={12} strokeWidth={2} /> Programar visita
              </button>
            </div>
          ) : (
            <div className="hoy-agenda-list">
              {todayVisits.map(v => (
                <div key={v.id} className="hoy-agenda-item">
                  <div className="hoy-agenda-item__time">
                    {fmtTime(v.visit_time)
                      ? <><Clock size={11} strokeWidth={2} />{fmtTime(v.visit_time)}</>
                      : <span className="hoy-agenda-item__notime">Sin hora</span>
                    }
                  </div>
                  <div className="hoy-agenda-item__info">
                    <span className="hoy-agenda-item__name">{v.accounts?.name || "Visita"}</span>
                    {v.accounts?.address && (
                      <span className="hoy-agenda-item__addr">{v.accounts.address}</span>
                    )}
                  </div>
                  {(v.accounts?.address || v.accounts?.name) && (
                    <a
                      className="hoy-agenda-item__map"
                      href={mapsURL(v.accounts?.address, v.accounts?.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                    >
                      <Navigation size={13} strokeWidth={1.8} />
                    </a>
                  )}
                </div>
              ))}
              {futureVisits.length > 0 && (
                <div className="hoy-agenda-upcoming">
                  {futureVisits.map(v => (
                    <button key={v.id} className="hoy-list-item" onClick={() => onNavigate("visits")}>
                      <span className="hoy-list-item__dot hoy-dot--baja" />
                      <span className="hoy-list-item__label">{v.accounts?.name || "Visita"}</span>
                      <span className="hoy-list-item__date">{fmtDate(v.visit_date)}</span>
                      <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── TAREAS HOY ────────────────────────────────────────────── */}
        <div className="hoy-section">
          <div className="hoy-section__head">
            <p className="hoy-eyebrow">
              <CheckSquare size={10} strokeWidth={2.5} style={{ display:"inline", marginRight:4, verticalAlign:"middle" }} />
              TAREAS PENDIENTES
            </p>
            <button className="hoy-section__more" onClick={() => onNavigate("tasks")}>
              Ver todas <ChevronRight size={12} strokeWidth={2} />
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="hoy-empty-state">
              <p className="hoy-empty-state__text">Sin tareas pendientes</p>
              <button className="hoy-empty-state__cta" onClick={() => onNavigate("tasks")}>
                <Plus size={12} strokeWidth={2} /> Nueva tarea
              </button>
            </div>
          ) : (
            <div className="hoy-list">
              {todayTasks.slice(0, 3).map(t => (
                <button key={t.id} className="hoy-list-item" onClick={() => onNavigate("tasks")}>
                  <span className={`hoy-list-item__dot hoy-dot--${t.priority === "alta" ? "alta" : t.due_date && t.due_date < todayStr ? "alta" : "media"}`} />
                  <span className="hoy-list-item__label">{t.title}</span>
                  <span className="hoy-list-item__date">
                    {t.due_date && t.due_date < todayStr
                      ? <span className="hoy-task-overdue">{fmtDate(t.due_date)}</span>
                      : "Hoy"
                    }
                  </span>
                  <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                </button>
              ))}
              {futureTasks.map(t => (
                <button key={t.id} className="hoy-list-item" onClick={() => onNavigate("tasks")}>
                  <span className={`hoy-list-item__dot hoy-dot--${t.priority || "baja"}`} />
                  <span className="hoy-list-item__label">{t.title}</span>
                  <span className="hoy-list-item__date">{fmtDate(t.due_date)}</span>
                  <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                </button>
              ))}
              {tasks.length > todayTasks.slice(0,3).length + futureTasks.length && (
                <button className="hoy-list-item hoy-list-item--more" onClick={() => onNavigate("tasks")}>
                  <span className="hoy-list-item__label" style={{ color:"#64748b" }}>
                    +{tasks.length - todayTasks.slice(0,3).length - futureTasks.length} más
                  </span>
                  <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── OPORTUNIDADES ──────────────────────────────────────────── */}
        {hotOpps.length > 0 && (
          <div className="hoy-section">
            <div className="hoy-section__head">
              <p className="hoy-eyebrow">OPORTUNIDADES</p>
              <button className="hoy-section__more" onClick={() => onNavigate("opportunities")}>
                Ver todas <ChevronRight size={12} strokeWidth={2} />
              </button>
            </div>
            <div className="hoy-list">
              {hotOpps.map(o => (
                <button key={o.id} className="hoy-list-item" onClick={() => onNavigate("opportunities")}>
                  <span className={`hoy-list-item__dot hoy-dot--${Number(o.probability) >= 80 ? "alta" : "media"}`} />
                  <span className="hoy-list-item__label">{o.accounts?.name || o.name}</span>
                  <span className="hoy-list-item__date">{o.probability}%</span>
                  <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PIPELINE + LICITACIONES (collapsible) ─────────────────── */}
        <div className="hoy-collapse">
          <button className="hoy-collapse__trigger" onClick={() => setCollapseOpen(o => !o)}>
            <div className="hoy-collapse__label">
              <TrendingUp size={11} strokeWidth={2} />
              <span>PIPELINE Y LICITACIONES</span>
            </div>
            <div className="hoy-collapse__meta">
              <span className="hoy-collapse__preview">{fmtMoney(pipeline.total)}</span>
              <ChevronDown
                size={14}
                strokeWidth={2}
                className={`hoy-collapse__chevron${collapseOpen ? " hoy-collapse__chevron--open" : ""}`}
              />
            </div>
          </button>

          {collapseOpen && (
            <div className="hoy-collapse__body">
              {/* Pipeline summary */}
              <div className="hoy-pipeline-summary">
                <div className="hoy-pipeline-row">
                  <span>Pipeline activo</span>
                  <strong>{fmtMoney(pipeline.total)}</strong>
                </div>
                <div className="hoy-pipeline-row hoy-pipeline-row--sub">
                  <span>{pipeline.count} oportunidades abiertas</span>
                  <span>Forecast {fmtMoney(pipeline.forecast)}</span>
                </div>
              </div>

              {/* Licitaciones */}
              {licitaciones.length > 0 ? (
                <>
                  <div className="hoy-collapse__section-label">
                    <Calendar size={9} strokeWidth={2.5} />
                    PRÓXIMAS (14 días)
                  </div>
                  {licitaciones.map(l => {
                    const days = daysUntil(l.end_date);
                    const urgent = days !== null && days <= 2;
                    return (
                      <button
                        key={l.id}
                        className="hoy-licit-item"
                        onClick={() => onNavigate("tenders")}
                      >
                        <div className="hoy-licit-item__main">
                          <span className="hoy-licit-item__name">
                            {l.institution || l.process_name || "Licitación"}
                          </span>
                          {l.process_number && (
                            <span className="hoy-licit-item__num">#{l.process_number}</span>
                          )}
                        </div>
                        <span className={`hoy-licit-item__days${urgent ? " hoy-licit-item__days--urgent" : ""}`}>
                          {days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days}d`}
                        </span>
                      </button>
                    );
                  })}
                  <button className="hoy-collapse__more" onClick={() => onNavigate("tenders")}>
                    Ver todas las licitaciones <ChevronRight size={11} strokeWidth={2} />
                  </button>
                </>
              ) : (
                <p className="hoy-collapse__empty">Sin licitaciones en los próximos 14 días.</p>
              )}
            </div>
          )}
        </div>

        {/* ── MEDIX ──────────────────────────────────────────────────── */}
        <button
          className="hoy-medix"
          onClick={() => document.dispatchEvent(new CustomEvent("crm:toggle-medix"))}
        >
          <div className="hoy-medix__left">
            <span className="hoy-medix__dot" aria-hidden="true" />
            <div>
              <p className="hoy-medix__eyebrow">MEDIX</p>
              <p className="hoy-medix__prompt">¿Con qué querés que te ayude hoy?</p>
            </div>
          </div>
          <Sparkles size={18} strokeWidth={1.5} className="hoy-medix__icon" aria-hidden="true" />
        </button>

        {/* ── Refresh ────────────────────────────────────────────────── */}
        <div className="hoy-footer">
          <button className="hoy-refresh-btn" onClick={load}>
            <RefreshCw size={13} strokeWidth={1.5} />
            Actualizar
          </button>
        </div>

      </div>
    </Layout>
  );
}
