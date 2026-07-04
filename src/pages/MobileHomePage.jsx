import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, CheckSquare, MapPin, Target, RefreshCw } from "lucide-react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";

// ─── Helpers ────────────────────────────────────────────────────────────────

function compactMoney(n) {
  const val = Number(n || 0);
  if (val === 0) return "$0";
  if (Math.abs(val) >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)} B`;
  if (Math.abs(val) >= 1_000_000)     return `$${(val / 1_000_000).toFixed(0)} M`;
  if (Math.abs(val) >= 1_000)         return `$${(val / 1_000).toFixed(0)} K`;
  return `$${val.toFixed(0)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const target = new Date(d + "T00:00:00");
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  return target.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenos tardes";
  return "Buenos noches";
}

function getSpanishDate() {
  return new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
  });
}

function probDot(prob) {
  if (prob >= 80) return "p-dot p-dot--green";
  if (prob >= 60) return "p-dot p-dot--amber";
  return "p-dot p-dot--red";
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileHomePage({ profile, onNavigate, pageKey }) {
  const [loading,  setLoading]  = useState(true);
  const [opps,     setOpps]     = useState([]);
  const [tasks,    setTasks]    = useState([]);
  const [visits,   setVisits]   = useState([]);

  const firstName = (profile?.full_name || profile?.email || "").split(" ")[0] || "Vendedor";

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const [oppsRes, tasksRes, visitsRes] = await Promise.all([
      supabase
        .from("opportunities")
        .select("id, name, amount, probability, stage, expected_close, accounts(name)")
        .not("stage", "in", '("Ganado","Perdido")')
        .order("probability", { ascending: false })
        .limit(20),
      supabase
        .from("tasks")
        .select("id, title, due_date, priority, status")
        .in("status", ["pendiente", "en_progreso"])
        .order("due_date", { ascending: true })
        .limit(5),
      supabase
        .from("visits")
        .select("id, visit_date, status, accounts(name)")
        .eq("status", "programada")
        .gte("visit_date", today)
        .order("visit_date", { ascending: true })
        .limit(3),
    ]);

    setOpps(oppsRes.data   || []);
    setTasks(tasksRes.data || []);
    setVisits(visitsRes.data || []);
    setLoading(false);
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const pipeline  = opps.reduce((s, o) => s + Number(o.amount || 0), 0);
  const forecast  = opps.reduce((s, o) => s + Number(o.amount || 0) * (Number(o.probability || 0) / 100), 0);
  const hotOpps   = opps.filter(o => Number(o.probability || 0) >= 70).slice(0, 3);
  const today     = new Date().toISOString().split("T")[0];
  const overdue   = opps.filter(o => o.expected_close && o.expected_close < today);
  const nextTask  = tasks[0] || null;
  const nextVisit = visits[0] || null;

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Layout title="Inicio" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
        <div className="p-page mob-home">
          <div className="mob-home-loading">
            <div className="mob-home-loading__spinner" />
            <span>Cargando…</span>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout title="Inicio" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="p-page mob-home">

        {/* ── Greeting ─────────────────────────────────────────────────── */}
        <div className="mob-home-greeting">
          <span className="mob-home-greeting__name">{getGreeting()}, {firstName}.</span>
          <span className="mob-home-greeting__date">{getSpanishDate()}</span>
        </div>

        {/* ── KPI Panel ────────────────────────────────────────────────── */}
        <div className="p-panel mob-home-item" onClick={() => onNavigate("opportunities")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onNavigate("opportunities")}>
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Pipeline comercial</span>
              <span className="p-sub">Oportunidades activas</span>
            </div>
            <div className="p-hd-right">
              <ChevronRight size={18} strokeWidth={1.5} />
            </div>
          </div>
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline total</span>
              <span className="p-metric__val">{compactMoney(pipeline)}</span>
              <span className="p-metric__sub">{opps.length} oportunidades</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast ponderado</span>
              <span className="p-metric__val">{compactMoney(forecast)}</span>
              <span className="p-metric__sub">prob. ponderada</span>
            </div>
          </div>
        </div>

        {/* ── Next pending task ────────────────────────────────────────── */}
        <div className="p-panel mob-home-item" onClick={() => onNavigate("tasks")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onNavigate("tasks")}>
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title"><CheckSquare size={15} strokeWidth={1.5} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Próxima tarea</span>
            </div>
            <div className="p-hd-right">
              <ChevronRight size={18} strokeWidth={1.5} />
            </div>
          </div>
          {nextTask ? (
            <div className="p-list">
              <div className="p-row">
                <div className="p-row__main">
                  <div className="p-row__name">{nextTask.title}</div>
                  <div className="p-row__sub">
                    Vence: {fmtDate(nextTask.due_date)}
                    {nextTask.priority && <> · Prioridad {nextTask.priority}</>}
                  </div>
                </div>
                <div className="p-row__meta">
                  <span className="p-row__val">{nextTask.status === "en_progreso" ? "En curso" : "Pendiente"}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-body">
              <div className="p-empty">Sin tareas pendientes</div>
            </div>
          )}
        </div>

        {/* ── Next scheduled visit ─────────────────────────────────────── */}
        <div className="p-panel mob-home-item" onClick={() => onNavigate("visits")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onNavigate("visits")}>
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title"><MapPin size={15} strokeWidth={1.5} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Próxima visita</span>
            </div>
            <div className="p-hd-right">
              <ChevronRight size={18} strokeWidth={1.5} />
            </div>
          </div>
          {nextVisit ? (
            <div className="p-list">
              <div className="p-row">
                <div className="p-row__main">
                  <div className="p-row__name">{nextVisit.accounts?.name || "—"}</div>
                  <div className="p-row__sub">{fmtDate(nextVisit.visit_date)}</div>
                </div>
                <div className="p-row__meta">
                  <span className="p-row__val">Programada</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-body">
              <div className="p-empty">Sin visitas programadas</div>
            </div>
          )}
        </div>

        {/* ── Hot opportunities ────────────────────────────────────────── */}
        <div className="p-panel mob-home-item" onClick={() => onNavigate("opportunities")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onNavigate("opportunities")}>
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title"><Target size={15} strokeWidth={1.5} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Oportunidades calientes</span>
              <span className="p-sub">Probabilidad ≥ 70 %</span>
            </div>
            <div className="p-hd-right">
              <ChevronRight size={18} strokeWidth={1.5} />
            </div>
          </div>
          {hotOpps.length > 0 ? (
            <div className="p-list">
              {hotOpps.map(o => (
                <div key={o.id} className="p-row">
                  <span className={probDot(o.probability)} aria-hidden="true" />
                  <div className="p-row__main">
                    <div className="p-row__name">{o.name}</div>
                    <div className="p-row__sub">
                      {o.accounts?.name || "—"} · {o.stage}
                    </div>
                  </div>
                  <div className="p-row__meta">
                    <span className="p-row__val">{compactMoney(o.amount)}</span>
                    <span className="p-row__sub">{o.probability}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-body">
              <div className="p-empty">Sin oportunidades calientes</div>
            </div>
          )}
        </div>

        {/* ── Alerts: overdue opps ─────────────────────────────────────── */}
        <div className="p-panel mob-home-item" onClick={() => onNavigate("opportunities")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onNavigate("opportunities")}>
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title"><AlertTriangle size={15} strokeWidth={1.5} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Alertas</span>
              <span className="p-sub">Oportunidades vencidas</span>
            </div>
            <div className="p-hd-right">
              <ChevronRight size={18} strokeWidth={1.5} />
            </div>
          </div>
          {overdue.length > 0 ? (
            <div className="p-list">
              {overdue.slice(0, 5).map(o => (
                <div key={o.id} className="p-row">
                  <span className="p-dot p-dot--red" aria-hidden="true" />
                  <div className="p-row__main">
                    <div className="p-row__name">{o.name}</div>
                    <div className="p-row__sub">
                      {o.accounts?.name || "—"} · Cierre {fmtDate(o.expected_close)}
                    </div>
                  </div>
                  <div className="p-row__meta">
                    <span className="p-row__val">{compactMoney(o.amount)}</span>
                  </div>
                </div>
              ))}
              {overdue.length > 5 && (
                <div className="p-body" style={{ paddingTop: 0 }}>
                  <span className="p-sub">+{overdue.length - 5} más vencidas</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-body">
              <div className="p-empty">Sin oportunidades vencidas</div>
            </div>
          )}
        </div>

        {/* ── Refresh footer ───────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>
          <button className="p-btn p-btn--ghost" type="button" onClick={load}>
            <RefreshCw size={15} strokeWidth={1.5} /> Actualizar
          </button>
        </div>

      </div>
    </Layout>
  );
}
