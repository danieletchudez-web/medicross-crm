import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./SalesAnalytics.css";

/* ─── Helpers ────────────────────────────────────────────────────────── */
function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}
function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

const PERIOD_OPTIONS = [
  { key: "week",    label: "Esta semana"  },
  { key: "month",   label: "Este mes"     },
  { key: "quarter", label: "Trimestre"    },
  { key: "year",    label: "Este año"     },
];

function periodRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (key === "week") {
    const day = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1); mon.setHours(0,0,0,0);
    return { from: mon, to: now };
  }
  if (key === "month")   return { from: new Date(y, m, 1),           to: now };
  if (key === "quarter") return { from: new Date(y, Math.floor(m/3)*3, 1), to: now };
  if (key === "year")    return { from: new Date(y, 0, 1),            to: now };
  return { from: new Date(y, m, 1), to: now };
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= range.from && d <= range.to;
}

/* ─── Colores por vendedor ───────────────────────────────────────────── */
const PALETTE = [
  "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#ec4899","#84cc16","#f97316","#6366f1",
];

/* ══════════════════════════════════════════════════════════════════════ */
export default function SalesAnalyticsPage({ profile, onNavigate }) {
  const [sellers,  setSellers]  = useState([]);
  const [visits,   setVisits]   = useState([]);
  const [opps,     setOpps]     = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const [period,    setPeriod]    = useState("month");
  const [selected,  setSelected]  = useState([]); // seller ids
  const [activeTab, setActiveTab] = useState("overview"); // overview | ranking | funnel | activity

  const barRef    = useRef(null);
  const lineRef   = useRef(null);
  const radarRef  = useRef(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!loading) renderCharts(); }, [loading, period, selected, activeTab]);

  async function loadData() {
    setLoading(true);
    const [sellRes, visRes, oppRes, accRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role").eq("approved", true),
      supabase.from("visits").select("id, owner_id, visit_date, status, visit_type, account_id, commercial_potential").order("visit_date", { ascending: false }),
      supabase.from("opportunities").select("id, owner_id, stage, amount, probability, created_at, expected_close, next_action").order("created_at", { ascending: false }),
      supabase.from("accounts").select("id, owner_id, follow_status, potential"),
    ]);
    setSellers(sellRes.data || []);
    setVisits(visRes.data  || []);
    setOpps(oppRes.data    || []);
    setAccounts(accRes.data || []);
    setSelected((sellRes.data || []).map((s) => s.id)); // todos seleccionados por defecto
    setLoading(false);
  }

  const range = useMemo(() => periodRange(period), [period]);

  /* Métricas por vendedor */
  const sellerMetrics = useMemo(() => {
    return sellers.map((seller, idx) => {
      const sv = visits.filter((v) => v.owner_id === seller.id);
      const so = opps.filter((o) => o.owner_id === seller.id);
      const sa = accounts.filter((a) => a.owner_id === seller.id);

      const svP = sv.filter((v) => inRange(v.visit_date, range));
      const soP = so.filter((o) => inRange(o.created_at, range));

      const totalVisits     = svP.length;
      const realizadas      = svP.filter((v) => v.status === "realizada").length;
      const canceladas      = svP.filter((v) => v.status === "cancelada").length;
      const reprogramadas   = svP.filter((v) => v.status === "reprogramada").length;
      const oppsCreated     = soP.length;
      const oppsWon         = so.filter((o) => o.stage === "Ganado" && inRange(o.created_at, range)).length;
      const oppsLost        = so.filter((o) => o.stage === "Perdido" && inRange(o.created_at, range)).length;
      const openOpps        = so.filter((o) => !["Ganado","Perdido"].includes(o.stage));
      const pipeline        = openOpps.reduce((s, o) => s + Number(o.amount || 0), 0);
      const wonAmount       = so.filter((o) => o.stage === "Ganado").reduce((s, o) => s + Number(o.amount || 0), 0);
      const forecast        = openOpps.reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
      const convRate        = pct(oppsWon, oppsWon + oppsLost);
      const avgDeal         = openOpps.length > 0 ? Math.round(pipeline / openOpps.length) : 0;
      const overdueOpps     = openOpps.filter((o) => o.expected_close && new Date(o.expected_close) < new Date()).length;
      const noNextAction    = openOpps.filter((o) => !o.next_action).length;
      const redAccounts     = sa.filter((a) => a.follow_status === "rojo").length;

      // Actividad por día de semana
      const byDow = [0,1,2,3,4,5,6].map((d) => svP.filter((v) => new Date(v.visit_date).getDay() === d).length);

      // Score de productividad (0-100)
      let score = 0;
      score += Math.min(40, totalVisits * 4);
      score += Math.min(20, realizadas * 3);
      score += Math.min(20, convRate * 0.4);
      score += Math.min(10, oppsCreated * 2);
      score -= Math.min(10, overdueOpps * 3);
      score -= Math.min(10, noNextAction * 2);
      score = Math.max(0, Math.min(100, Math.round(score)));

      return {
        id: seller.id,
        name: seller.full_name || seller.email,
        email: seller.email,
        role: seller.role,
        color: PALETTE[idx % PALETTE.length],
        totalVisits, realizadas, canceladas, reprogramadas,
        oppsCreated, oppsWon, oppsLost, pipeline, wonAmount, forecast,
        convRate, avgDeal, overdueOpps, noNextAction, redAccounts,
        openOpps: openOpps.length, byDow, score,
        totalAccounts: sa.length,
      };
    });
  }, [sellers, visits, opps, accounts, range]);

  const filtered = useMemo(() => sellerMetrics.filter((s) => selected.includes(s.id)), [sellerMetrics, selected]);
  const ranked   = useMemo(() => [...filtered].sort((a, b) => b.score - a.score), [filtered]);

  /* Totales del equipo */
  const totals = useMemo(() => ({
    visits:    filtered.reduce((s, x) => s + x.totalVisits, 0),
    opps:      filtered.reduce((s, x) => s + x.oppsCreated, 0),
    pipeline:  filtered.reduce((s, x) => s + x.pipeline, 0),
    won:       filtered.reduce((s, x) => s + x.oppsWon, 0),
    convRate:  filtered.length > 0 ? Math.round(filtered.reduce((s, x) => s + x.convRate, 0) / filtered.length) : 0,
  }), [filtered]);

  /* ── Charts ── */
  function renderCharts() {
    const Chart = window.Chart;
    if (!Chart || filtered.length === 0) return;
    [barRef, lineRef, radarRef].forEach((r) => { if (r.current?.chartInstance) r.current.chartInstance.destroy(); });

    // Bar — visitas por vendedor
    if (barRef.current && activeTab === "overview") {
      barRef.current.chartInstance = new Chart(barRef.current, {
        type: "bar",
        data: {
          labels: filtered.map((s) => s.name.split(" ")[0]),
          datasets: [
            { label: "Visitas", data: filtered.map((s) => s.totalVisits), backgroundColor: filtered.map((s) => s.color + "33"), borderColor: filtered.map((s) => s.color), borderWidth: 1.5, borderRadius: 6 },
            { label: "Ganadas", data: filtered.map((s) => s.oppsWon), backgroundColor: filtered.map(() => "rgba(16,185,129,0.15)"), borderColor: filtered.map(() => "#10b981"), borderWidth: 1.5, borderRadius: 6 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top", labels: { font: { size: 11, family: "DM Sans" }, color: "#64748b" } }, tooltip: { backgroundColor: "#0f172a", bodyColor: "#f8fafc", titleColor: "#94a3b8", cornerRadius: 8, padding: 10 } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" } } }, y: { beginAtZero: true, border: { display: false }, grid: { color: "#f1f5f9" }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" } } } } },
      });
    }

    // Line — pipeline por vendedor
    if (lineRef.current && activeTab === "overview") {
      lineRef.current.chartInstance = new Chart(lineRef.current, {
        type: "bar",
        data: {
          labels: filtered.map((s) => s.name.split(" ")[0]),
          datasets: [{ label: "Pipeline", data: filtered.map((s) => s.pipeline), backgroundColor: filtered.map((s) => s.color + "22"), borderColor: filtered.map((s) => s.color), borderWidth: 1.5, borderRadius: 6 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0f172a", bodyColor: "#f8fafc", titleColor: "#94a3b8", cornerRadius: 8, padding: 10, callbacks: { label: (ctx) => ` ${compactMoney(ctx.raw)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" } } }, y: { beginAtZero: true, border: { display: false }, grid: { color: "#f1f5f9" }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" }, callback: compactMoney } } } },
      });
    }

    // Radar — comparativa multidimensional
    if (radarRef.current && activeTab === "overview" && filtered.length > 0) {
      const maxV = Math.max(...filtered.map((s) => s.totalVisits), 1);
      const maxP = Math.max(...filtered.map((s) => s.pipeline), 1);
      radarRef.current.chartInstance = new Chart(radarRef.current, {
        type: "radar",
        data: {
          labels: ["Visitas", "Conversión", "Pipeline", "Opps.", "Score", "Realizadas"],
          datasets: filtered.slice(0, 5).map((s) => ({
            label: s.name.split(" ")[0],
            data: [
              Math.round((s.totalVisits / maxV) * 100),
              s.convRate,
              Math.round((s.pipeline / maxP) * 100),
              Math.min(100, s.oppsCreated * 10),
              s.score,
              Math.round((s.realizadas / Math.max(s.totalVisits, 1)) * 100),
            ],
            borderColor: s.color,
            backgroundColor: s.color + "18",
            pointBackgroundColor: s.color,
            borderWidth: 2,
            pointRadius: 3,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { font: { size: 11, family: "DM Sans" }, color: "#64748b", boxWidth: 10 } } },
          scales: { r: { beginAtZero: true, max: 100, ticks: { display: false }, grid: { color: "#e8ecf2" }, pointLabels: { font: { size: 11, family: "DM Sans" }, color: "#64748b" } } },
        },
      });
    }
  }

  function toggleSeller(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function selectAll()  { setSelected(sellers.map((s) => s.id)); }
  function selectNone() { setSelected([]); }

  if (loading) {
    return (
      <Layout title="Análisis Comercial" profile={profile} onNavigate={onNavigate}>
        <div className="sa-loading"><div className="sa-pulse"/><span>Cargando análisis…</span></div>
      </Layout>
    );
  }

  const best = ranked[0];

  return (
    <Layout title="Análisis Comercial" profile={profile} onNavigate={onNavigate}>
      <div className="sa-page">

        {/* TOOLBAR */}
        <div className="sa-toolbar">
          <div className="sa-toolbar__left">
            <h2 className="sa-toolbar__title">Comparativa de vendedores</h2>
            <p className="sa-toolbar__sub">Análisis de actividad, pipeline y productividad del equipo</p>
          </div>
          <div className="sa-toolbar__right">
            <div className="sa-period-tabs">
              {PERIOD_OPTIONS.map((p) => (
                <button key={p.key} className={`sa-period-tab ${period === p.key ? "active" : ""}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* TEAM KPIs */}
        <section className="sa-team-kpis">
          <SaKpi label="Visitas del equipo"  value={totals.visits}              accent="blue"/>
          <SaKpi label="Opps. creadas"       value={totals.opps}                accent="slate"/>
          <SaKpi label="Pipeline total"      value={compactMoney(totals.pipeline)} accent="green"/>
          <SaKpi label="Opp. ganadas"        value={totals.won}                 accent="green"/>
          <SaKpi label="Conversión promedio" value={`${totals.convRate}%`}      accent={totals.convRate >= 40 ? "green" : totals.convRate >= 20 ? "amber" : "red"}/>
          {best && <SaKpi label="⭐ Top vendedor" value={best.name.split(" ")[0]} sub={`Score ${best.score}`} accent="gold"/>}
        </section>

        {/* FILTRO DE VENDEDORES */}
        <div className="sa-seller-filter">
          <div className="sa-seller-filter__head">
            <span>Vendedores</span>
            <div className="sa-seller-filter__actions">
              <button onClick={selectAll}>Todos</button>
              <button onClick={selectNone}>Ninguno</button>
            </div>
          </div>
          <div className="sa-seller-chips">
            {sellerMetrics.map((s) => (
              <button
                key={s.id}
                className={`sa-seller-chip ${selected.includes(s.id) ? "active" : ""}`}
                style={selected.includes(s.id) ? { borderColor: s.color, background: s.color + "15", color: s.color } : {}}
                onClick={() => toggleSeller(s.id)}
              >
                <span className="sa-seller-chip__dot" style={{ background: s.color }}/>
                {s.name.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div className="sa-tabs">
          {[
            { key: "overview", label: "Resumen"   },
            { key: "ranking",  label: "Ranking"   },
            { key: "detail",   label: "Detalle"   },
            { key: "alerts",   label: "Alertas"   },
          ].map((t) => (
            <button key={t.key} className={`sa-tab ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <>
            <section className="sa-charts-grid">
              <div className="sa-chart-card sa-chart-card--wide">
                <div className="sa-chart-card__header">
                  <h3>Actividad comparativa</h3>
                  <p>Visitas y oportunidades ganadas por vendedor</p>
                </div>
                <div className="sa-chart-box"><canvas ref={barRef}/></div>
              </div>
              <div className="sa-chart-card">
                <div className="sa-chart-card__header">
                  <h3>Radar multidimensional</h3>
                  <p>Perfil comercial comparado</p>
                </div>
                <div className="sa-chart-box"><canvas ref={radarRef}/></div>
              </div>
              <div className="sa-chart-card sa-chart-card--wide">
                <div className="sa-chart-card__header">
                  <h3>Pipeline por vendedor</h3>
                  <p>Valor de oportunidades abiertas</p>
                </div>
                <div className="sa-chart-box"><canvas ref={lineRef}/></div>
              </div>
            </section>

            {/* Heatmap de actividad semanal */}
            <div className="sa-chart-card">
              <div className="sa-chart-card__header">
                <h3>Actividad por día de semana</h3>
                <p>Visitas registradas por día</p>
              </div>
              <div className="sa-heatmap">
                <div className="sa-heatmap__labels">
                  {["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"].map((d) => <span key={d}>{d}</span>)}
                </div>
                {filtered.map((s) => {
                  const maxDay = Math.max(...s.byDow, 1);
                  return (
                    <div key={s.id} className="sa-heatmap__row">
                      <span className="sa-heatmap__name">{s.name.split(" ")[0]}</span>
                      {s.byDow.map((count, i) => (
                        <div key={i} className="sa-heatmap__cell" style={{ background: s.color, opacity: count > 0 ? 0.2 + (count / maxDay) * 0.8 : 0.06 }} title={`${count} visitas`}>
                          {count > 0 && <span>{count}</span>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── RANKING ── */}
        {activeTab === "ranking" && (
          <div className="sa-ranking">
            {ranked.map((s, i) => (
              <div key={s.id} className="sa-rank-card">
                <div className="sa-rank-card__pos" style={{ color: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7c3a" : "#cbd5e1" }}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`}
                </div>
                <div className="sa-rank-card__avatar" style={{ background: s.color }}>
                  {s.name.slice(0,1).toUpperCase()}
                </div>
                <div className="sa-rank-card__info">
                  <strong>{s.name}</strong>
                  <span>{s.email}</span>
                </div>
                <div className="sa-rank-score-bar">
                  <div className="sa-rank-score-bar__fill" style={{ width: `${s.score}%`, background: s.color }}/>
                </div>
                <div className="sa-rank-card__score" style={{ color: s.color }}>{s.score}<small>/100</small></div>
                <div className="sa-rank-card__stats">
                  <SaStat label="Visitas"    value={s.totalVisits}/>
                  <SaStat label="Pipeline"   value={compactMoney(s.pipeline)}/>
                  <SaStat label="Conversión" value={`${s.convRate}%`}/>
                  <SaStat label="Ganadas"    value={s.oppsWon}/>
                </div>
              </div>
            ))}
            {ranked.length === 0 && <p className="sa-empty">Seleccioná al menos un vendedor.</p>}
          </div>
        )}

        {/* ── DETALLE ── */}
        {activeTab === "detail" && (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Visitas</th>
                  <th>Realizadas</th>
                  <th>Canceladas</th>
                  <th>Opps.</th>
                  <th>Ganadas</th>
                  <th>Conversión</th>
                  <th>Pipeline</th>
                  <th>Forecast</th>
                  <th>Ticket prom.</th>
                  <th>Vencidas</th>
                  <th>Sin acción</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="sa-table-seller">
                        <span className="sa-table-dot" style={{ background: s.color }}/>
                        <span>{s.name}</span>
                      </div>
                    </td>
                    <td>{s.totalVisits}</td>
                    <td className="sa-td-green">{s.realizadas}</td>
                    <td className={s.canceladas > 0 ? "sa-td-red" : ""}>{s.canceladas}</td>
                    <td>{s.oppsCreated}</td>
                    <td className="sa-td-green">{s.oppsWon}</td>
                    <td>
                      <span className={`sa-pct-badge ${s.convRate >= 40 ? "green" : s.convRate >= 20 ? "amber" : "red"}`}>{s.convRate}%</span>
                    </td>
                    <td>{compactMoney(s.pipeline)}</td>
                    <td>{compactMoney(s.forecast)}</td>
                    <td>{compactMoney(s.avgDeal)}</td>
                    <td className={s.overdueOpps > 0 ? "sa-td-red" : ""}>{s.overdueOpps}</td>
                    <td className={s.noNextAction > 0 ? "sa-td-amber" : ""}>{s.noNextAction}</td>
                    <td>
                      <div className="sa-score-mini">
                        <div className="sa-score-mini__bar" style={{ width: `${s.score}%`, background: s.color }}/>
                        <span style={{ color: s.color }}>{s.score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── ALERTAS ── */}
        {activeTab === "alerts" && (
          <div className="sa-alerts">

            {/* Sin actividad */}
            {filtered.filter((s) => s.totalVisits === 0).map((s) => (
              <AlertCard key={s.id} type="danger" icon="⚠"
                title={`${s.name} sin actividad`}
                text={`No registró ninguna visita en el período seleccionado.`}
              />
            ))}

            {/* Oportunidades vencidas */}
            {filtered.filter((s) => s.overdueOpps > 0).map((s) => (
              <AlertCard key={s.id} type="warning" icon="◎"
                title={`${s.name} — ${s.overdueOpps} opp. vencida${s.overdueOpps > 1 ? "s" : ""}`}
                text="Oportunidades con fecha de cierre pasada sin actualizar."
              />
            ))}

            {/* Sin próxima acción */}
            {filtered.filter((s) => s.noNextAction > 0).map((s) => (
              <AlertCard key={s.id} type="warning" icon="◎"
                title={`${s.name} — ${s.noNextAction} opp. sin próxima acción`}
                text="Definir próximo paso en las oportunidades abiertas."
              />
            ))}

            {/* Clientes en riesgo */}
            {filtered.filter((s) => s.redAccounts > 0).map((s) => (
              <AlertCard key={s.id} type="danger" icon="🔴"
                title={`${s.name} — ${s.redAccounts} cliente${s.redAccounts > 1 ? "s" : ""} en riesgo`}
                text="Clientes con seguimiento en rojo que requieren atención urgente."
              />
            ))}

            {/* Top performer */}
            {best && (
              <AlertCard type="success" icon="⭐"
                title={`${best.name} — mejor vendedor del período`}
                text={`Score ${best.score}/100 · ${best.totalVisits} visitas · ${best.convRate}% conversión · ${compactMoney(best.pipeline)} en pipeline.`}
              />
            )}

            {filtered.filter((s) => s.totalVisits > 0 && s.overdueOpps === 0 && s.noNextAction === 0).length === 0 && filtered.length > 0 && filtered.every((s) => s.totalVisits > 0) && (
              <AlertCard type="success" icon="✓" title="Sin alertas críticas" text="Todos los vendedores tienen actividad registrada en el período."/>
            )}

            {filtered.length === 0 && <p className="sa-empty">Seleccioná al menos un vendedor para ver alertas.</p>}
          </div>
        )}

        <footer className="sa-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */
function SaKpi({ label, value, sub, accent }) {
  const colors = { blue: "#3b82f6", green: "#10b981", amber: "#f59e0b", red: "#ef4444", slate: "#64748b", gold: "#f59e0b" };
  const c = colors[accent] || "#3b82f6";
  return (
    <article className="sa-kpi" style={{ borderTopColor: c }}>
      <span className="sa-kpi__label">{label}</span>
      <strong className="sa-kpi__value" style={{ color: c }}>{value}</strong>
      {sub && <small className="sa-kpi__sub">{sub}</small>}
    </article>
  );
}

function SaStat({ label, value }) {
  return (
    <div className="sa-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AlertCard({ type, icon, title, text }) {
  const bg = { danger: "#fef2f2", warning: "#fffbeb", success: "#f0fdf4" }[type];
  const border = { danger: "#fecaca", warning: "#fde68a", success: "#bbf7d0" }[type];
  const color  = { danger: "#dc2626", warning: "#d97706", success: "#059669" }[type];
  return (
    <div className="sa-alert-card" style={{ background: bg, borderColor: border }}>
      <span className="sa-alert-card__icon" style={{ color }}>{icon}</span>
      <div>
        <strong style={{ color }}>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}