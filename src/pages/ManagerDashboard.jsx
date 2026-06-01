import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./managerDashboard.css";

const STAGES = ["Lead", "Contactado", "Reunión", "Demo", "Cotización", "Negociación"];
const COMPARISON_PERIODS = [
  { value: "week", label: "Esta semana vs anterior" },
  { value: "month", label: "Este mes vs anterior" },
  { value: "quarter", label: "Este trimestre vs anterior" },
  { value: "year", label: "Este año vs anterior" },
];

const STAGE_COLORS = {
  "Lead":        { bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.5)" },
  "Contactado":  { bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.5)"  },
  "Reunión":     { bg: "rgba(99,102,241,0.12)",  border: "rgba(99,102,241,0.5)"  },
  "Demo":        { bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.5)"  },
  "Cotización":  { bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.5)"  },
  "Negociación": { bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.5)"   },
};

function money(value) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(1).replace(".", ",")} MM`;
  if (n >= 1_000_000_000)     return `$${(n / 1_000_000_000).toFixed(1).replace(".", ",")} MM`;
  if (n >= 1_000_000)         return `$${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000)             return `$${(n / 1_000).toFixed(0)} K`;
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function periodRange(period, offset = 0) {
  const now = new Date();
  let start;
  let end;

  if (period === "week") {
    const day = now.getDay() || 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1 + (offset * 7));
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else if (period === "quarter") {
    const quarterStart = Math.floor(now.getMonth() / 3) * 3 + (offset * 3);
    start = new Date(now.getFullYear(), quarterStart, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
  } else if (period === "year") {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(now.getFullYear() + offset + 1, 0, 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  }

  return { start, end };
}

function isInPeriod(value, range) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= range.start && date < range.end;
}

function comparisonDelta(current, previous) {
  if (!previous) return current ? { label: "Nuevo", tone: "up" } : { label: "Sin cambios", tone: "flat" };
  const value = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return { label: `${value > 0 ? "+" : ""}${value}%`, tone: value > 0 ? "up" : value < 0 ? "down" : "flat" };
}

/* ── Tooltip ────────────────────────────────────────────────────────── */
function Tooltip({ text }) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  function show() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }

  function hide() { setPos(null); }

  return (
    <span className="kpi-tooltip-wrap">
      <span
        ref={triggerRef}
        className="kpi-tooltip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={show}
      >?</span>
      {pos && createPortal(
        <span
          className="kpi-tooltip-box"
          style={{ position: "fixed", top: pos.top, right: pos.right, left: "auto" }}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}

/* ── Gauge SVG ──────────────────────────────────────────────────────── */
function ForecastGauge({ forecast, target, coverage }) {
  const pct   = Math.min(100, Math.max(0, coverage));
  const angle = -135 + (pct / 100) * 270;
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";
  const label = pct >= 80 ? "En objetivo" : pct >= 50 ? "En progreso" : "Bajo objetivo";

  function describeArc(cx, cy, r, s, e) {
    const toRad = (d) => (d * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(s)), y1 = cy + r * Math.sin(toRad(s));
    const x2 = cx + r * Math.cos(toRad(e)), y2 = cy + r * Math.sin(toRad(e));
    return `M ${x1} ${y1} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }

  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 200 130" className="gauge-svg">
        <path d={describeArc(100,110,75,-135,135)} fill="none" stroke="#e8ecf2" strokeWidth="14" strokeLinecap="round"/>
        {pct > 0 && <path d={describeArc(100,110,75,-135,-135+(pct/100)*270)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" style={{filter:`drop-shadow(0 0 6px ${color}55)`}}/>}
        <line x1="100" y1="110" x2={100+60*Math.cos(((angle-90)*Math.PI)/180)} y2={110+60*Math.sin(((angle-90)*Math.PI)/180)} stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="100" cy="110" r="5" fill={color}/>
        <text x="100" y="90"  textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a" fontFamily="DM Sans">{pct}%</text>
        <text x="100" y="106" textAnchor="middle" fontSize="9"  fontWeight="600" fill="#94a3b8" fontFamily="DM Sans">{label}</text>
        <text x="8"   y="124" textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="DM Mono">0%</text>
        <text x="100" y="16"  textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="DM Mono">50%</text>
        <text x="192" y="124" textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="DM Mono">100%</text>
      </svg>
      <div className="gauge-vals">
        <div className="gauge-val"><span>Ponderado</span><strong>{compactMoney(forecast)}</strong></div>
        <div className="gauge-divider"/>
        <div className="gauge-val"><span>Objetivo</span><strong>{compactMoney(target)}</strong></div>
      </div>
    </div>
  );
}

/* ── Probability panel ──────────────────────────────────────────────── */
function ProbabilityPanel({ probabilityRef, total }) {
  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <div>
          <h3 className="dash-panel__title">Probabilidad de cierre</h3>
          <p className="dash-panel__sub">Monto del pipeline agrupado por rango de probabilidad</p>
        </div>
        <span className="dash-panel__metric">{total}</span>
      </header>
      <div className="dash-chart-box"><canvas ref={probabilityRef}/></div>
    </article>
  );
}

/* ── Stage Distribution ─────────────────────────────────────────────── */
function StageDistributionPanel({ opps }) {
  const open        = opps.filter((o) => !["Ganado","Perdido"].includes(o.stage));
  const totalAmount = open.reduce((s, o) => s + Number(o.amount || 0), 0);
  const rows        = STAGES.map((stage) => {
    const stageOpps = open.filter((o) => o.stage === stage);
    const amount    = stageOpps.reduce((s, o) => s + Number(o.amount || 0), 0);
    const pct       = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
    return { stage, count: stageOpps.length, amount, pct };
  }).filter((r) => r.count > 0);

  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <h3 className="dash-panel__title">Distribución por etapa</h3>
        <p className="dash-panel__sub">Oportunidades activas y monto por fase</p>
      </header>
      {rows.length === 0 ? <p className="dash-empty">No hay oportunidades abiertas.</p> : (
        <div className="stage-dist">
          {rows.map((r) => (
            <div className="stage-dist__row" key={r.stage}>
              <div className="stage-dist__label">
                <span className="stage-dist__dot" style={{ background: STAGE_COLORS[r.stage]?.border || "#94a3b8" }}/>
                <span className="stage-dist__name">{r.stage}</span>
                <span className="stage-dist__count">{r.count}</span>
              </div>
              <div className="stage-dist__bar-wrap">
                <div className="stage-dist__bar" style={{ width:`${r.pct}%`, background: STAGE_COLORS[r.stage]?.bg, borderColor: STAGE_COLORS[r.stage]?.border }}/>
              </div>
              <span className="stage-dist__amount">{compactMoney(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* ── Últimas visitas ────────────────────────────────────────────────── */
function RecentVisitsPanel({ visits }) {
  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <h3 className="dash-panel__title">Últimas visitas del equipo</h3>
        <p className="dash-panel__sub">Actividad comercial reciente registrada</p>
      </header>
      {visits.length === 0 ? <p className="dash-empty">No hay visitas registradas.</p> : (
        <div className="dash-list">
          {visits.slice(0, 6).map((v) => (
            <div className="dash-list-row" key={v.id}>
              <div className="dash-list-row__main">
                <strong>{v.accounts?.name || "Sin cliente"}</strong>
                <small>{v.products?.name || "Sin producto"} · {v.visit_type || "—"}</small>
              </div>
              <div className="dash-list-row__meta">
                <span>{v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR") : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function ManagerDashboard({ profile, onNavigate }) {
  const [selectedLine, setSelectedLine]   = useState("Todas");
  const [opportunities, setOpportunities] = useState([]);
  const [visits, setVisits]               = useState([]);
  const [products, setProducts]           = useState([]);
  const [campaigns, setCampaigns]         = useState([]);
  const [loading, setLoading]             = useState(true);
  const [dashboardMode, setDashboardMode] = useState(() => localStorage.getItem("medicross-dashboard-mode") || "executive");
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState("month");

  const pipelineRef    = useRef(null);
  const activityRef    = useRef(null);
  const probabilityRef = useRef(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!loading) renderCharts(); }, [loading, selectedLine, opportunities, visits, campaigns, products, dashboardMode]);
  useEffect(() => { localStorage.setItem("medicross-dashboard-mode", dashboardMode); }, [dashboardMode]);

  async function loadData() {
    setLoading(true);
    const [oppRes, visitRes, prodRes, campRes] = await Promise.all([
      supabase.from("opportunities").select("*, accounts(name), products(name, line), campaigns(name)").order("created_at", { ascending: false }),
      supabase.from("visits").select("*, accounts(name), products(name, line)").order("visit_date", { ascending: false }),
      supabase.from("products").select("*").order("name"),
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    ]);
    setOpportunities(oppRes.data || []);
    setVisits(visitRes.data || []);
    setProducts(prodRes.data || []);
    setCampaigns(campRes.data || []);
    setLoading(false);
  }

  const productLines = useMemo(() => {
    const lines = [
      ...products.map((p) => p.line),
      ...opportunities.map((o) => o.product_line || o.products?.line),
      ...campaigns.map((c) => c.product_line || c.line),
    ].filter(Boolean);
    return ["Todas", ...new Set(lines)];
  }, [products, opportunities, campaigns]);

  const filteredOpps = useMemo(() => {
    if (selectedLine === "Todas") return opportunities;
    return opportunities.filter((o) => (o.product_line || o.products?.line || "") === selectedLine);
  }, [opportunities, selectedLine]);

  const filteredVisits = useMemo(() => {
    if (selectedLine === "Todas") return visits;
    return visits.filter((v) => (v.products?.line || v.product_line || "") === selectedLine);
  }, [visits, selectedLine]);

  const filteredProducts = useMemo(() => {
    if (selectedLine === "Todas") return products;
    return products.filter((p) => p.line === selectedLine);
  }, [products, selectedLine]);

  const filteredCampaigns = useMemo(() => {
    if (selectedLine === "Todas") return campaigns;
    return campaigns.filter((c) => (c.product_line || c.line || "") === selectedLine);
  }, [campaigns, selectedLine]);

  const comparison = useMemo(() => {
    const currentRange  = periodRange(comparisonPeriod);
    const previousRange = periodRange(comparisonPeriod, -1);
    const open = (o) => !["Ganado", "Perdido"].includes(o.stage);
    const createdIn = (range) => filteredOpps.filter((o) => isInPeriod(o.created_at, range));
    const visitsIn = (range) => filteredVisits.filter((v) => isInPeriod(v.visit_date || v.created_at, range));
    const wonIn = (range) => filteredOpps.filter((o) => o.stage === "Ganado" && isInPeriod(o.updated_at || o.created_at, range));
    const summarize = (range) => {
      const opportunities = createdIn(range);
      const openCreated = opportunities.filter(open);
      return {
        pipeline: openCreated.reduce((sum, o) => sum + Number(o.amount || 0), 0),
        forecast: openCreated.reduce((sum, o) => sum + ((Number(o.amount || 0) * Number(o.probability || 0)) / 100), 0),
        visits: visitsIn(range).length,
        created: opportunities.length,
        won: wonIn(range).length,
      };
    };
    const current = summarize(currentRange);
    const previous = summarize(previousRange);
    return [
      { label: "Pipeline generado", value: current.pipeline, previous: previous.pipeline, formatter: compactMoney },
      { label: "Forecast generado", value: current.forecast, previous: previous.forecast, formatter: compactMoney },
      { label: "Visitas", value: current.visits, previous: previous.visits },
      { label: "Opps. creadas", value: current.created, previous: previous.created },
      { label: "Opps. ganadas", value: current.won, previous: previous.won },
    ];
  }, [comparisonPeriod, filteredOpps, filteredVisits]);

  const metrics = useMemo(() => {
    const open     = filteredOpps.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    const pipeline = open.reduce((s, o) => s + Number(o.amount || 0), 0);
    const forecast = open.reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
    const target   = filteredCampaigns.reduce((s, c) => s + Number(c.target_amount || 0), 0);
    const coverage = target > 0 ? Math.round((forecast / target) * 100) : 0;
    const hotDeals = open.filter((o) => Number(o.probability || 0) >= 70).length;
    const noAction = open.filter((o) => !o.next_action).length;
    const overdue  = open.filter((o) => o.expected_close && new Date(o.expected_close) < new Date()).length;
    const won      = filteredOpps.filter((o) => o.stage === "Ganado").length;
    const lost     = filteredOpps.filter((o) => o.stage === "Perdido").length;
    const winRate  = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    const avgDeal  = open.length > 0 ? Math.round(pipeline / open.length) : 0;
    const today    = new Date();
    const daysInPipeline = open.filter((o) => o.created_at).map((o) => Math.floor((today - new Date(o.created_at)) / 86400000));
    const avgDaysInPipeline = daysInPipeline.length > 0 ? Math.round(daysInPipeline.reduce((s, d) => s + d, 0) / daysInPipeline.length) : 0;
    const withForecast  = open.filter((o) => Number(o.probability || 0) > 0).length;
    const forecastRatio = open.length > 0 ? Math.round((withForecast / open.length) * 100) : 0;
    const leads      = filteredOpps.filter((o) => o.stage === "Lead").length;
    const cotizacion = filteredOpps.filter((o) => ["Cotización","Negociación","Ganado"].includes(o.stage)).length;
    const convRate   = leads + cotizacion > 0 ? Math.round((cotizacion / (leads + cotizacion)) * 100) : 0;
    const uniqueAccounts = new Set([
      ...filteredOpps.map((o) => o.account_id),
      ...filteredVisits.map((v) => v.account_id),
    ].filter(Boolean)).size;
    return {
      pipeline, forecast, target, coverage, openOpps: open.length, hotDeals, noAction, overdue,
      visits: filteredVisits.length, products: filteredProducts.length,
      campaigns: filteredCampaigns.length, accounts: uniqueAccounts,
      winRate, won, lost, avgDeal, avgDaysInPipeline, forecastRatio, convRate,
    };
  }, [filteredOpps, filteredVisits, filteredProducts, filteredCampaigns]);

  const projectTemperature = useMemo(() => {
    return filteredOpps
      .filter((o) => !["Ganado","Perdido"].includes(o.stage))
      .map((o) => {
        const amount      = Number(o.amount || 0);
        const weighted    = (amount * Number(o.probability || 0)) / 100;
        const probability = Number(o.probability || 0);
        const hasNext     = Boolean(o.next_action);
        const daysToClose = o.expected_close ? Math.ceil((new Date(o.expected_close) - new Date()) / 86400000) : 999;
        let score = Math.min(30, probability * 0.3);
        score += weighted > 0 ? 30 : 0;
        score += amount > 0 ? 10 : 0;
        score += hasNext ? 20 : -15;
        score += daysToClose <= 30 ? 10 : daysToClose <= 60 ? 5 : 0;
        if (daysToClose < 0) score -= 25;
        score = Math.max(0, Math.min(100, Math.round(score)));
        return {
          id: o.id,
          name: o.name || "Sin nombre",
          client: o.accounts?.name || "Sin cliente",
          stage: o.stage || "Sin etapa",
          amount,
          forecast: weighted,
          probability,
          score,
          nextAction: o.next_action || "Definir próxima acción",
          expectedClose: o.expected_close || null,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [filteredOpps]);

  const decision = useMemo(() => {
    if (metrics.pipeline === 0) return { tone:"danger",  icon:"⚠", title:"Generar pipeline",     text:"No hay pipeline abierto. Crear oportunidades desde visitas y prospectos." };
    if (metrics.noAction > 0)  return { tone:"warning", icon:"◎", title:"Seguimiento pendiente", text:`${metrics.noAction} oportunidades no tienen próxima acción definida.` };
    if (metrics.hotDeals > 0)  return { tone:"success", icon:"↑", title:"Priorizar cierre",      text:`${metrics.hotDeals} oportunidades calientes. Enfocar cierre comercial esta semana.` };
    return                             { tone:"neutral", icon:"●", title:"Operación estable",     text:"Pipeline activo. Mantener ritmo de visitas, seguimiento y forecast." };
  }, [metrics]);

  const todayDecisions = useMemo(() => {
    const rows = [];
    rows.push({
      tone: metrics.coverage < 50 ? "danger" : metrics.coverage < 80 ? "warning" : "success",
      title: `Cobertura ${metrics.coverage}%`,
      text: metrics.coverage < 50 ? "Aumentar pipeline o ajustar campañas para cubrir objetivo." : "Mantener seguimiento de forecast contra objetivo.",
    });
    if (metrics.noAction > 0) rows.push({
      tone: "warning",
      title: `${metrics.noAction} sin próxima acción`,
      text: "Definir dueño, fecha y siguiente paso antes de cerrar el día.",
    });
    const top = projectTemperature[0];
    if (top) rows.push({
      tone: top.score >= 75 ? "danger" : "success",
      title: top.name,
      text: `${top.client} · ${top.stage} · score ${top.score}`,
    });
    if (metrics.hotDeals > 0) rows.push({
      tone: "success",
      title: `${metrics.hotDeals} hot deals`,
      text: "Priorizar cierre comercial y confirmar fecha de decisión.",
    });
    return rows.slice(0, 3);
  }, [metrics, projectTemperature]);

  const campaignRows = useMemo(() => {
    return filteredCampaigns.map((c) => {
      const forecast = filteredOpps
        .filter((o) => o.campaign_id === c.id && !["Ganado","Perdido"].includes(o.stage))
        .reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
      const target   = Number(c.target_amount || 0);
      const coverage = target > 0 ? Math.round((forecast / target) * 100) : 0;
      return { id: c.id, name: c.name || "Sin nombre", forecast, target, coverage };
    });
  }, [filteredCampaigns, filteredOpps]);

  const weeklyVisits = useMemo(() => (
    visits.filter((v) => {
      const d = new Date(v.visit_date);
      return d >= new Date(new Date().getTime() - 7 * 86400000);
    }).length
  ), [visits]);

  const showOperationalMetrics = dashboardMode === "complete" || metricsExpanded;
  const showDetailedPanels = dashboardMode === "complete";

  function pipelineByStage() {
    return STAGES.map((stage) => filteredOpps.filter((o) => o.stage === stage).reduce((s, o) => s + Number(o.amount || 0), 0));
  }

  function activityByWeek() {
    return ["Lun","Mar","Mié","Jue","Vie"].map((_, i) => filteredVisits.filter((v) => new Date(v.visit_date).getDay() === i + 1).length);
  }

  function probabilityData() {
    const open   = filteredOpps.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    const ranges = [
      { label: "0–25%",   min: 0,  max: 25  },
      { label: "26–50%",  min: 26, max: 50  },
      { label: "51–75%",  min: 51, max: 75  },
      { label: "76–100%", min: 76, max: 100 },
    ];
    return ranges.map((r) => {
      const rangeOpps = open.filter((o) => { const p = Number(o.probability || 0); return p >= r.min && p <= r.max; });
      return { label: r.label, amount: rangeOpps.reduce((s, o) => s + Number(o.amount || 0), 0), count: rangeOpps.length };
    });
  }

  function chartOptions({ yMoney = false } = {}) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f172a", titleColor: "#94a3b8", bodyColor: "#f8fafc",
          padding: 12, cornerRadius: 8,
          titleFont: { size: 11, weight: "600", family: "DM Sans" },
          bodyFont:  { size: 13, weight: "700", family: "DM Sans" },
          callbacks: { label: (ctx) => yMoney ? money(ctx.raw) : ctx.raw },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, weight: "600", family: "DM Sans" } } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: "#f1f5f9", lineWidth: 1 },
             ticks: { color: "#94a3b8", font: { size: 11, weight: "600", family: "DM Sans" }, callback: yMoney ? compactMoney : undefined } },
      },
    };
  }

  function renderCharts() {
    const Chart = window.Chart;
    if (!Chart) return;
    [pipelineRef, activityRef, probabilityRef].forEach((ref) => { if (ref.current?.chartInstance) ref.current.chartInstance.destroy(); });

    if (pipelineRef.current) {
      pipelineRef.current.chartInstance = new Chart(pipelineRef.current, {
        type: "bar",
        data: { labels: STAGES, datasets: [{ data: pipelineByStage(), backgroundColor: "rgba(59,130,246,0.15)", borderColor: "rgba(59,130,246,0.7)", borderWidth: 1.5, borderRadius: 6, borderSkipped: false }] },
        options: chartOptions({ yMoney: true }),
      });
    }

    if (activityRef.current) {
      const actGrad = activityRef.current.getContext("2d").createLinearGradient(0, 0, 0, 200);
      actGrad.addColorStop(0, "rgba(16,185,129,0.15)");
      actGrad.addColorStop(1, "rgba(16,185,129,0.01)");
      activityRef.current.chartInstance = new Chart(activityRef.current, {
        type: "line",
        data: { labels: ["Lun","Mar","Mié","Jue","Vie"], datasets: [{ data: activityByWeek(), borderColor: "rgba(16,185,129,0.8)", backgroundColor: actGrad, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: "#10b981", pointBorderColor: "#fff", pointBorderWidth: 2 }] },
        options: chartOptions(),
      });
    }

    if (probabilityRef.current) {
      const probData   = probabilityData();
      const probColors = [
        { bg: "rgba(100,116,139,0.15)", border: "rgba(100,116,139,0.6)" },
        { bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.6)"  },
        { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.7)"  },
        { bg: "rgba(16,185,129,0.15)",  border: "rgba(16,185,129,0.7)"  },
      ];
      probabilityRef.current.chartInstance = new Chart(probabilityRef.current, {
        type: "bar",
        data: { labels: probData.map((d) => d.label), datasets: [{ data: probData.map((d) => d.amount), backgroundColor: probColors.map((c) => c.bg), borderColor: probColors.map((c) => c.border), borderWidth: 1.5, borderRadius: 6, borderSkipped: false }] },
        options: {
          ...chartOptions({ yMoney: true }),
          indexAxis: "y",
          plugins: {
            ...chartOptions({ yMoney: true }).plugins,
            tooltip: { ...chartOptions({ yMoney: true }).plugins.tooltip, callbacks: { label: (ctx) => { const d = probData[ctx.dataIndex]; return ` ${money(ctx.raw)}  ·  ${d.count} opp${d.count !== 1 ? "s" : ""}`; } } },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, weight: "600", family: "DM Sans" }, callback: compactMoney } },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: "#64748b", font: { size: 12, weight: "700", family: "DM Sans" } } },
          },
        },
      });
    }
  }

  if (loading) {
    return (
      <Layout title="Dashboard Comercial" profile={profile} onNavigate={onNavigate}>
        <div className="dash-loading"><div className="dash-loading-pulse"/><span>Cargando dashboard…</span></div>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard Comercial" profile={profile} onNavigate={onNavigate}>
      <div className="unified-dashboard">

        {/* HEADER */}
        <header className="dash-header dash-hero">
          <div className="dash-header-left">
            <div className="dash-wordmark"><span className="dash-wordmark-dot"/>Soluciones Médicas</div>
            <h1 className="dash-title">Centro de Ventas</h1>
            <p className="dash-subtitle">Pipeline · Forecast ponderado · Campañas · Probabilidad de cierre</p>
            <div className={`dash-hero-status dash-hero-status--${decision.tone}`}>
              <span>{decision.icon}</span>
              <strong>{decision.title}</strong>
              <small>{decision.text}</small>
            </div>
          </div>
          <div className="dash-hero-metrics">
            <div><span>Pipeline</span><strong>{compactMoney(metrics.pipeline)}</strong></div>
            <div><span>Forecast</span><strong>{compactMoney(metrics.forecast)}</strong></div>
            <div><span>Cobertura</span><strong>{metrics.coverage}%</strong></div>
          </div>
          <div className="dash-header-right">
            <div className="dash-filter-wrap">
              <label className="dash-filter-label">Línea de producto</label>
              <select className="dash-filter-select" value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)}>
                {productLines.map((line) => <option key={line}>{line}</option>)}
              </select>
            </div>
            <button className="dash-hero-cta" onClick={() => onNavigate("opportunities")}>Ver pipeline</button>
          </div>
        </header>

        <section className={`dash-comparison ${comparisonExpanded ? "is-expanded" : ""}`}>
          <div className="dash-comparison__head">
            <div>
              <span>Comparativo de períodos</span>
              <strong>Actividad comercial generada</strong>
              <p>Medición por fecha de creación o registro, separada de la foto actual del pipeline.</p>
            </div>
            <div className="dash-comparison__actions">
              <select value={comparisonPeriod} onChange={(event) => setComparisonPeriod(event.target.value)}>
                {COMPARISON_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
              <button type="button" onClick={() => setComparisonExpanded((expanded) => !expanded)}>
                {comparisonExpanded ? "Ocultar detalle" : "Ver comparativo"}
              </button>
            </div>
          </div>
          {comparisonExpanded && (
            <div className="dash-comparison__grid">
              {comparison.map((item) => {
                const delta = comparisonDelta(item.value, item.previous);
                const format = item.formatter || ((value) => Number(value || 0).toLocaleString("es-AR"));
                return (
                  <article key={item.label} className="dash-comparison-card">
                    <span>{item.label}</span>
                    <strong>{format(item.value)}</strong>
                    <small>Anterior: {format(item.previous)}</small>
                    <em className={`dash-comparison-card__delta dash-comparison-card__delta--${delta.tone}`}>
                      {delta.tone === "up" ? "↑" : delta.tone === "down" ? "↓" : "→"} {delta.label}
                    </em>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* PRIMARY KPIs — fila 1 */}
        <section className="dash-primary-kpis">
          <PrimaryKpi
            label="Pipeline abierto"
            value={money(metrics.pipeline)}
            sub="Total oportunidades activas"
            accent="blue"
            progress={metrics.target > 0 ? Math.min(100, Math.round((metrics.pipeline / metrics.target) * 100)) : 0}
            meta={`${metrics.openOpps} oportunidades`}
            tooltip="Suma total del monto de todas las oportunidades abiertas (excluye Ganado y Perdido). Representa el potencial máximo de ventas en curso."
          />
          <PrimaryKpi
            label="Forecast ponderado"
            value={money(metrics.forecast)}
            sub="Pipeline × probabilidad"
            accent="blue"
            progress={metrics.coverage}
            meta={`${metrics.forecastRatio}% con probabilidad`}
            tooltip="Cada oportunidad abierta multiplicada por su % de probabilidad de cierre. Ejemplo: $100M al 60% aporta $60M al forecast. Es la estimación realista de lo que se va a cobrar."
          />
          <PrimaryKpi
            label="Objetivo campañas"
            value={money(metrics.target)}
            sub="Meta comercial definida"
            accent="slate"
            progress={metrics.campaigns > 0 ? 100 : 0}
            meta={`${metrics.campaigns} campañas activas`}
            tooltip="Suma de los objetivos económicos de todas las campañas activas. Es la meta que el equipo comercial debe alcanzar."
          />
          <PrimaryKpi
            label="Cobertura"
            value={`${metrics.coverage}%`}
            sub="Forecast ponderado vs objetivo"
            accent={metrics.coverage >= 80 ? "green" : metrics.coverage >= 50 ? "yellow" : "red"}
            progress={metrics.coverage}
            meta={metrics.coverage >= 80 ? "En zona saludable" : metrics.coverage >= 50 ? "Requiere atención" : "Riesgo comercial"}
            tooltip="Forecast ponderado ÷ Objetivo de campañas. Indica qué porcentaje del objetivo ya está cubierto con el pipeline actual. Verde ≥80%, amarillo ≥50%, rojo <50%."
          />
        </section>

        <section className="dash-decisions">
          <div className="dash-decisions__head">
            <span>Decisiones de hoy</span>
            <strong>Prioridad ejecutiva</strong>
            <p>{decision.text}</p>
            <button
              className="dash-exec-action"
              onClick={() => onNavigate(metrics.noAction > 0 ? "opportunities" : "visits")}
            >
              Ejecutar acción
            </button>
          </div>
          {todayDecisions.map((item, index) => (
            <article key={`${item.title}-${index}`} className={`dash-decision-card dash-decision-card--${item.tone}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
            </article>
          ))}
        </section>

        {/* KPIs COLAPSABLES — fila 2 y 3 */}
        <div className="dash-kpi-section">
          <div className="dash-kpi-section__head">
            <div>
              <span>Salud comercial</span>
              <strong>Métricas operativas</strong>
            </div>
            <div className="dash-kpi-section__controls">
              {dashboardMode === "executive" && (
                <button className="dash-metrics-toggle" onClick={() => setMetricsExpanded((expanded) => !expanded)}>
                  {metricsExpanded ? "Ocultar métricas" : "Ver métricas"}
                </button>
              )}
              <div className="dash-kpi-toggle" role="group" aria-label="Nivel de detalle del dashboard">
                <button
                  type="button"
                  className={dashboardMode === "complete" ? "is-active" : ""}
                  onClick={() => setDashboardMode("complete")}
                >
                  Completo
                </button>
                <button
                  type="button"
                  className={dashboardMode === "executive" ? "is-active" : ""}
                  onClick={() => setDashboardMode("executive")}
                >
                  Ejecutivo
                </button>
              </div>
            </div>
          </div>

          {showOperationalMetrics && (
            <>
              {/* FILA 2 — KPIs secundarios */}
              <section className="dash-kpi-grid">
                <Kpi label="Opps. abiertas"   value={metrics.openOpps}   tooltip="Cantidad de oportunidades que no están Ganadas ni Perdidas. Refleja el tamaño activo del pipeline."/>
                <Kpi label="Hot deals"        value={metrics.hotDeals}   accent="amber" tooltip="Oportunidades con probabilidad de cierre ≥70%. Son las más cercanas a convertirse en venta. Priorizalas esta semana."/>
                <Kpi label="Sin próx. acción" value={metrics.noAction}   accent="red"   tooltip="Oportunidades abiertas sin próxima acción definida. Si no hay acción planificada, el negocio se enfría. Asigná un paso concreto a cada una."/>
                <Kpi label="Vencidas"         value={metrics.overdue}    accent="red"   tooltip="Oportunidades cuya fecha esperada de cierre ya pasó. Requieren revisión urgente: actualizar fecha o cambiar etapa."/>
                <Kpi label="Win rate"         value={`${metrics.winRate}%`} tooltip="Porcentaje de oportunidades ganadas sobre el total de cerradas (Ganado + Perdido). Mide la efectividad de cierre del equipo."/>
                <Kpi label="Ticket promedio"  value={compactMoney(metrics.avgDeal)} tooltip="Monto promedio por oportunidad abierta. Pipeline total ÷ cantidad de oportunidades abiertas."/>
                <Kpi label="Días en pipeline" value={`${metrics.avgDaysInPipeline}d`} tooltip="Promedio de días que llevan abiertas las oportunidades desde su creación. Ciclos muy largos pueden indicar estancamiento."/>
                <Kpi label="Con probabilidad" value={`${metrics.forecastRatio}%`} accent={metrics.forecastRatio < 50 ? "red" : metrics.forecastRatio < 80 ? "amber" : undefined} tooltip="Porcentaje de oportunidades abiertas que tienen cargado un % de probabilidad. Sin probabilidad no hay forecast confiable."/>
              </section>

              {/* FILA 3 — Insights */}
              <section className="dash-insights-grid">
                <InsightCard
                  label="Conversión al pipeline"
                  value={`${metrics.convRate}%`}
                  sub="Lead → Cotización o superior"
                  tone={metrics.convRate >= 40 ? "green" : metrics.convRate >= 20 ? "amber" : "red"}
                  tooltip="Porcentaje de leads que avanzaron a etapa de Cotización, Negociación o Ganado. Mide la calidad del proceso comercial desde el primer contacto."
                />
                <InsightCard
                  label="Días promedio en pipeline"
                  value={`${metrics.avgDaysInPipeline} días`}
                  sub="Desde creación hasta hoy"
                  tone={metrics.avgDaysInPipeline <= 30 ? "green" : metrics.avgDaysInPipeline <= 60 ? "amber" : "red"}
                  tooltip="Tiempo promedio que una oportunidad lleva abierta. Verde ≤30 días, amarillo ≤60 días, rojo >60 días. Ciclos largos reducen la velocidad de cierre."
                />
                <InsightCard
                  label="Con probabilidad cargada"
                  value={`${metrics.forecastRatio}%`}
                  sub="Opps. con % de cierre definido"
                  tone={metrics.forecastRatio >= 80 ? "green" : metrics.forecastRatio >= 50 ? "amber" : "red"}
                  tooltip="Porcentaje de oportunidades abiertas que tienen asignado un % de probabilidad de cierre. Sin este dato el forecast ponderado no es confiable."
                />
                <InsightCard
                  label="Visitas esta semana"
                  value={weeklyVisits}
                  sub="Últimos 7 días del equipo"
                  tone="blue"
                  tooltip="Total de visitas comerciales registradas en los últimos 7 días por todo el equipo. Refleja el nivel de actividad y presencia en el mercado."
                />
              </section>
            </>
          )}
        </div>

        {showDetailedPanels ? (
          <>
            {/* MAIN PANELS */}
            <section className="dash-main-grid">
              <ProbabilityPanel probabilityRef={probabilityRef} total={compactMoney(metrics.pipeline)}/>
              <CampaignPanel rows={campaignRows}/>
              <HotProjects rows={projectTemperature}/>
            </section>

            {/* CHART PANELS */}
            <section className="dash-chart-grid">
              <Panel title="Pipeline por etapa" subtitle="Monto total en cada fase">
                <canvas ref={pipelineRef}/>
              </Panel>

              <article className="dash-panel">
                <header className="dash-panel__header">
                  <div>
                    <h3 className="dash-panel__title">Cobertura de forecast</h3>
                    <p className="dash-panel__sub">Pipeline ponderado vs objetivo de campañas</p>
                  </div>
                  <span className="dash-panel__metric">{metrics.coverage}%</span>
                </header>
                <div className="dash-chart-box dash-chart-box--gauge">
                  <ForecastGauge forecast={metrics.forecast} target={metrics.target} coverage={metrics.coverage}/>
                </div>
              </article>

              <StageDistributionPanel opps={filteredOpps}/>
            </section>

            {/* ACTIVIDAD + ÚLTIMAS VISITAS */}
            <section className="dash-bottom-grid">
              <Panel title="Actividad semanal" subtitle="Visitas registradas por día de la semana">
                <canvas ref={activityRef}/>
              </Panel>
              <RecentVisitsPanel visits={filteredVisits}/>
            </section>
          </>
        ) : (
          <section className="dash-detail-gate">
            <div>
              <span>Análisis extendido</span>
              <strong>Gráficos, campañas y actividad del equipo</strong>
              <p>La lectura ejecutiva prioriza decisiones. Abrí la vista completa cuando necesites profundizar.</p>
            </div>
            <button type="button" onClick={() => setDashboardMode("complete")}>Ver análisis completo</button>
          </section>
        )}

        <footer className="dash-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer" className="dash-footer-link">
            Designed by Daniel Etchudez
          </a>
        </footer>

      </div>
    </Layout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */
function PrimaryKpi({ label, value, sub, accent = "blue", tooltip, progress = 0, meta }) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)));
  return (
    <article className={`dash-primary-kpi dash-primary-kpi--${accent}`}>
      <div className="dash-primary-kpi__header">
        <span className="dash-primary-kpi__label">{label}</span>
        {tooltip && <Tooltip text={tooltip}/>}
      </div>
      <strong className="dash-primary-kpi__value" title={String(value)}>{value}</strong>
      <div className="dash-primary-kpi__progress" aria-hidden="true">
        <span style={{ width: `${safeProgress}%` }} />
      </div>
      <div className="dash-primary-kpi__footer">
        <span className="dash-primary-kpi__sub">{sub}</span>
        {meta && <em>{meta}</em>}
      </div>
    </article>
  );
}

function Kpi({ label, value, accent, tooltip }) {
  return (
    <article className={`dash-kpi ${accent ? `dash-kpi--${accent}` : ""}`}>
      <div className="dash-kpi__header">
        <span className="dash-kpi__label">{label}</span>
        {tooltip && <Tooltip text={tooltip}/>}
      </div>
      <strong className="dash-kpi__value" title={String(value)}>{value}</strong>
    </article>
  );
}

function InsightCard({ label, value, sub, tone = "blue", tooltip }) {
  const colors = {
    green: { border: "#10b981", bg: "rgba(16,185,129,0.06)", text: "#059669" },
    amber: { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", text: "#d97706" },
    red:   { border: "#ef4444", bg: "rgba(239,68,68,0.06)",  text: "#dc2626" },
    blue:  { border: "#3b82f6", bg: "rgba(59,130,246,0.06)", text: "#2563eb" },
  };
  const c = colors[tone] || colors.blue;
  return (
    <article className="dash-insight" style={{ borderTopColor: c.border, background: c.bg }}>
      <div className="dash-insight__header">
        <span className="dash-insight__label">{label}</span>
        {tooltip && <Tooltip text={tooltip}/>}
      </div>
      <strong className="dash-insight__value" style={{ color: c.text }}>{value}</strong>
      <span className="dash-insight__sub">{sub}</span>
    </article>
  );
}

function Panel({ title, subtitle, metric, children }) {
  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <div>
          <h3 className="dash-panel__title">{title}</h3>
          {subtitle && <p className="dash-panel__sub">{subtitle}</p>}
        </div>
        {metric && <span className="dash-panel__metric">{metric}</span>}
      </header>
      <div className="dash-chart-box">{children}</div>
    </article>
  );
}

function CampaignPanel({ rows }) {
  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <div>
          <h3 className="dash-panel__title">Campañas vs objetivo</h3>
          <p className="dash-panel__sub">Forecast ponderado por campaña</p>
        </div>
        <span className="dash-panel__metric">{rows.length}</span>
      </header>
      {rows.length === 0 ? <p className="dash-empty">No hay campañas cargadas.</p> : (
        <div className="dash-list">
          {rows.slice(0, 4).map((r) => (
            <div className="dash-list-row" key={r.id}>
              <div className="dash-list-row__main">
                <strong>{r.name}</strong>
                <div className="dash-progress-track">
                  <div className="dash-progress-fill" style={{ width:`${Math.min(100,r.coverage)}%` }}/>
                </div>
              </div>
              <div className="dash-list-row__meta">
                <span>{money(r.forecast)}</span>
                <em className={r.coverage>=80?"badge badge--green":r.coverage>=50?"badge badge--amber":"badge badge--red"}>{r.coverage}%</em>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function HotProjects({ rows }) {
  return (
    <article className="dash-panel">
      <header className="dash-panel__header">
        <div>
          <h3 className="dash-panel__title">Proyectos prioritarios</h3>
          <p className="dash-panel__sub">Ordenados por score de temperatura</p>
        </div>
        <span className="dash-panel__metric">{rows[0]?.score || 0}</span>
      </header>
      {rows.length === 0 ? <p className="dash-empty">No hay oportunidades abiertas.</p> : (
        <div className="dash-hot-list">
          {rows.slice(0, 5).map((p, index) => (
            <div className="dash-hot-row" key={p.id}>
              <span className="dash-hot-rank">{index + 1}</span>
              <div className="dash-hot-row__main">
                <strong>{p.name}</strong>
                <small>{p.client} · {p.stage}</small>
                <p>{p.nextAction}</p>
                <div className="dash-hot-score">
                  <div style={{ width: `${p.score}%` }} />
                </div>
              </div>
              <div className="dash-hot-row__meta">
                <span>{money(p.forecast)}</span>
                <em className={p.score>=75?"badge badge--red":p.score>=50?"badge badge--amber":"badge badge--green"}>{p.score}</em>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
