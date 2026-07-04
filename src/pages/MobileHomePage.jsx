import { useCallback, useEffect, useState } from "react";
import {
  MapPin, CheckSquare, Target, Sparkles, Navigation,
  ChevronRight, Clock, RefreshCw, Zap, FileText,
} from "lucide-react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const dt    = new Date(d + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((dt - today) / 86_400_000);
  if (diff === 0)  return "Hoy";
  if (diff === 1)  return "Mañana";
  if (diff < 0)   return `Hace ${Math.abs(diff)}d`;
  return dt.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function fmtTime(t) { return t ? t.slice(0, 5) : null; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function mapsURL(addr, name) {
  return `https://maps.google.com/?q=${encodeURIComponent(addr || name || "")}`;
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

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
  const [loading,     setLoading]     = useState(true);
  const [visits,      setVisits]      = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [opps,        setOpps]        = useState([]);
  const [quotesCount, setQuotesCount] = useState(0);

  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Vendedor";
  const todayStr  = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    setLoading(true);
    const [visitsRes, tasksRes, oppsRes, quotesRes] = await Promise.all([
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
        .order("due_date", { ascending: true })
        .limit(8),
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
    ]);

    setVisits(visitsRes.data   || []);
    setTasks(tasksRes.data     || []);
    setOpps(oppsRes.data       || []);
    setQuotesCount(quotesRes.count || 0);
    setLoading(false);
  }, [todayStr]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const todayVisits  = visits.filter(v => v.visit_date === todayStr);
  const nextVisit    = visits[0] || null;
  const pendingTasks = tasks.slice(0, 4);
  const hotOpps      = opps.filter(o => Number(o.probability) >= 70).slice(0, 3);
  const isQuiet      = todayVisits.length === 0 && tasks.length === 0 && hotOpps.length === 0 && quotesCount === 0;

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
            {todayVisits.length > 0 && (
              <button className="hoy-chip hoy-chip--visit" onClick={() => onNavigate("visits")}>
                <MapPin size={12} strokeWidth={1.5} />
                {todayVisits.length} {todayVisits.length === 1 ? "visita" : "visitas"}
              </button>
            )}
            {tasks.length > 0 && (
              <button className="hoy-chip hoy-chip--task" onClick={() => onNavigate("tasks")}>
                <CheckSquare size={12} strokeWidth={1.5} />
                {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
              </button>
            )}
            {hotOpps.length > 0 && (
              <button className="hoy-chip hoy-chip--hot" onClick={() => onNavigate("opportunities")}>
                <Target size={12} strokeWidth={1.5} />
                {hotOpps.length} {hotOpps.length === 1 ? "caliente" : "calientes"}
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

        {/* ── PRÓXIMA VISITA ─────────────────────────────────────────── */}
        {nextVisit && (
          <div className="hoy-card">
            <p className="hoy-card__eyebrow">
              <MapPin size={11} strokeWidth={2} />
              {nextVisit.visit_date === todayStr ? "VISITA HOY" : "PRÓXIMA VISITA"}
            </p>
            <p className="hoy-card__title">{nextVisit.accounts?.name || "Visita programada"}</p>
            {fmtTime(nextVisit.visit_time) ? (
              <p className="hoy-card__time">
                <Clock size={12} strokeWidth={2} />
                {fmtTime(nextVisit.visit_time)}
                {nextVisit.visit_date !== todayStr && ` · ${fmtDate(nextVisit.visit_date)}`}
              </p>
            ) : nextVisit.visit_date !== todayStr ? (
              <p className="hoy-card__time">
                <Clock size={12} strokeWidth={2} />
                {fmtDate(nextVisit.visit_date)}
              </p>
            ) : null}
            {nextVisit.accounts?.address && (
              <p className="hoy-card__address">{nextVisit.accounts.address}</p>
            )}
            <div className="hoy-card__actions">
              {nextVisit.accounts?.address || nextVisit.accounts?.name ? (
                <a
                  className="hoy-action-btn hoy-action-btn--ghost"
                  href={mapsURL(nextVisit.accounts?.address, nextVisit.accounts?.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Navigation size={13} strokeWidth={2} />
                  Cómo llegar
                </a>
              ) : null}
              <button
                className="hoy-action-btn hoy-action-btn--primary"
                onClick={() => onNavigate("visits")}
              >
                <MapPin size={13} strokeWidth={2} />
                Ver visitas
              </button>
            </div>
          </div>
        )}

        {/* ── PRÓXIMA TAREA (if no visits today) ────────────────────── */}
        {!nextVisit && pendingTasks.length > 0 && (
          <div className="hoy-card">
            <p className="hoy-card__eyebrow">
              <CheckSquare size={11} strokeWidth={2} />
              PRÓXIMA TAREA
            </p>
            <p className="hoy-card__title">{pendingTasks[0].title}</p>
            {pendingTasks[0].due_date && (
              <p className="hoy-card__time">
                <Clock size={12} strokeWidth={2} />
                Vence {fmtDate(pendingTasks[0].due_date)}
              </p>
            )}
            <div className="hoy-card__actions">
              <button
                className="hoy-action-btn hoy-action-btn--primary"
                onClick={() => onNavigate("tasks")}
              >
                <CheckSquare size={13} strokeWidth={2} />
                Ver tareas
              </button>
            </div>
          </div>
        )}

        {/* ── PENDIENTES ─────────────────────────────────────────────── */}
        {pendingTasks.length > 0 && (
          <div className="hoy-section">
            <div className="hoy-section__head">
              <p className="hoy-eyebrow">PENDIENTES</p>
              <button className="hoy-section__more" onClick={() => onNavigate("tasks")}>
                Ver todas <ChevronRight size={12} strokeWidth={2} />
              </button>
            </div>
            <div className="hoy-list">
              {pendingTasks.map(t => (
                <button key={t.id} className="hoy-list-item" onClick={() => onNavigate("tasks")}>
                  <span className={`hoy-list-item__dot hoy-dot--${t.priority || "media"}`} />
                  <span className="hoy-list-item__label">{t.title}</span>
                  <span className="hoy-list-item__date">{fmtDate(t.due_date)}</span>
                  <ChevronRight size={13} strokeWidth={1.5} className="hoy-list-item__chevron" />
                </button>
              ))}
            </div>
          </div>
        )}

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
