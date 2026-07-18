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

/* ── Probability panel ──────────────────────────────────────────────── */
function ProbabilityPanel({ probabilityRef, total }) {
  return (
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Probabilidad de cierre</span>
          <span className="p-sub">Monto del pipeline agrupado por rango de probabilidad</span>
        </div>
        <div className="p-hd-right">
          <span className="p-title">{total}</span>
        </div>
      </div>
      <div className="p-chart"><canvas ref={probabilityRef}/></div>
    </div>
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
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Distribución por etapa</span>
          <span className="p-sub">Oportunidades activas y monto por fase</span>
        </div>
      </div>
      {rows.length === 0 ? <p className="p-empty">No hay oportunidades abiertas.</p> : (
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
    </div>
  );
}

/* ── Últimas visitas ────────────────────────────────────────────────── */
function RecentVisitsPanel({ visits }) {
  return (
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Últimas visitas del equipo</span>
          <span className="p-sub">Actividad comercial reciente registrada</span>
        </div>
      </div>
      {visits.length === 0 ? <p className="p-empty">No hay visitas registradas.</p> : (
        <div className="p-list">
          {visits.slice(0, 6).map((v) => (
            <div className="p-row" key={v.id}>
              <div className="p-row__main">
                <span className="p-row__name">{v.accounts?.name || "Sin cliente"}</span>
                <span className="p-row__sub">{v.products?.name || "Sin producto"} · {v.visit_type || "—"}</span>
              </div>
              <div className="p-row__meta">
                <span className="p-row__val">{v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR") : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ManagerDashboard({ profile, onNavigate, pageKey }) {
  const [selectedLine, setSelectedLine]   = useState("Todas");
  const [opportunities, setOpportunities] = useState([]);
  const [visits, setVisits]               = useState([]);
  const [products, setProducts]           = useState([]);
  const [campaigns, setCampaigns]         = useState([]);
  const [loading, setLoading]             = useState(true);
  const [dashboardMode, setDashboardMode] = useState(() => localStorage.getItem("medicross-dashboard-mode") || "executive");
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState("month");

  const pipelineRef    = useRef(null);
  const activityRef    = useRef(null);
  const probabilityRef = useRef(null);

  useEffect(() => { loadData(); }, [pageKey]);
  useEffect(() => { if (!loading) renderCharts(); }, [loading, selectedLine, opportunities, visits, campaigns, products, dashboardMode]);
  useEffect(() => {
    if (loading) return;
    const obs = new MutationObserver(() => renderCharts());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, [loading]);
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

  const PIPELINE_BAR_COLORS = ["#8b9cb3","#3b82f6","#818cf8","#fbbf24","#fb923c","#f87171"];
  const PROB_BAR_COLORS     = ["#94a3b8","#60a5fa","#fbbf24","#34d399"];

  function chartOptions({ yMoney = false, isDark = false, indexAxis = "x" } = {}) {
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
    const tickColor = isDark ? "#6b7280" : "#94a3b8";
    return {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 350, easing: "easeOutQuart" },
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
        x: { grid: { display: false }, border: { display: false }, ticks: { color: tickColor, font: { size: 11, weight: "600", family: "DM Sans" } } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: gridColor, lineWidth: 1 },
             ticks: { color: tickColor, font: { size: 11, weight: "600", family: "DM Sans" }, callback: yMoney ? compactMoney : undefined } },
      },
    };
  }

  function renderCharts() {
    const Chart = window.Chart;
    if (!Chart) return;
    [pipelineRef, activityRef, probabilityRef].forEach((ref) => { if (ref.current?.chartInstance) ref.current.chartInstance.destroy(); });

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";

    if (pipelineRef.current) {
      pipelineRef.current.chartInstance = new Chart(pipelineRef.current, {
        type: "bar",
        data: { labels: STAGES, datasets: [{ data: pipelineByStage(), backgroundColor: PIPELINE_BAR_COLORS, borderColor: PIPELINE_BAR_COLORS, borderWidth: 0, borderRadius: 6, borderSkipped: false }] },
        options: chartOptions({ yMoney: true, isDark }),
      });
    }

    if (activityRef.current) {
      const actCtx  = activityRef.current.getContext("2d");
      const actGrad = actCtx.createLinearGradient(0, 0, 0, 200);
      actGrad.addColorStop(0, isDark ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.18)");
      actGrad.addColorStop(1, "rgba(16,185,129,0.00)");
      activityRef.current.chartInstance = new Chart(activityRef.current, {
        type: "line",
        data: { labels: ["Lun","Mar","Mié","Jue","Vie"], datasets: [{ data: activityByWeek(), borderColor: "#10b981", borderWidth: 2.5, backgroundColor: actGrad, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: "#10b981", pointBorderColor: isDark ? "#111" : "#fff", pointBorderWidth: 2.5 }] },
        options: chartOptions({ isDark }),
      });
    }

    if (probabilityRef.current) {
      const probData = probabilityData();
      const baseOpts = chartOptions({ yMoney: true, isDark });
      probabilityRef.current.chartInstance = new Chart(probabilityRef.current, {
        type: "bar",
        data: { labels: probData.map((d) => d.label), datasets: [{ data: probData.map((d) => d.amount), backgroundColor: PROB_BAR_COLORS, borderColor: PROB_BAR_COLORS, borderWidth: 0, borderRadius: 6, borderSkipped: false }] },
        options: {
          ...baseOpts,
          indexAxis: "y",
          plugins: {
            ...baseOpts.plugins,
            tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: (ctx) => { const d = probData[ctx.dataIndex]; return ` ${money(ctx.raw)}  ·  ${d.count} opp${d.count !== 1 ? "s" : ""}`; } } },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: isDark ? "#6b7280" : "#94a3b8", font: { size: 11, weight: "600", family: "DM Sans" }, callback: compactMoney } },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: isDark ? "#9ca3af" : "#64748b", font: { size: 12, weight: "700", family: "DM Sans" } } },
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
      <div className="p-page">

        {/* TOP PANEL — header + metrics strip */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Dashboard Comercial</span>
              <span className="p-sub">Pipeline · Forecast ponderado · Campañas · Probabilidad de cierre</span>
            </div>
            <div className="p-hd-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select className="p-select" value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)}>
                {productLines.map((line) => <option key={line}>{line}</option>)}
              </select>
              <button className="p-btn p-btn--ghost" onClick={() => onNavigate("opportunities")}>Ver pipeline</button>
            </div>
          </div>
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline</span>
              <span className="p-metric__val">{compactMoney(metrics.pipeline)}</span>
              <span className="p-metric__sub">Monto total activo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast</span>
              <span className="p-metric__val">{compactMoney(metrics.forecast)}</span>
              <span className="p-metric__sub">Ponderado por probabilidad</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Cobertura</span>
              <span className="p-metric__val">{metrics.coverage}%</span>
              <span className="p-metric__sub">Forecast vs objetivo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Visitas (semana)</span>
              <span className="p-metric__val">{weeklyVisits}</span>
              <span className="p-metric__sub">Últimos 7 días</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline abierto</span>
              <span className="p-metric__val">{metrics.openOpps}</span>
              <span className="p-metric__sub">{metrics.hotDeals} hot deals</span>
            </div>
          </div>
        </div>

        {/* COMPARISON PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Comparativo de períodos</span>
              <span className="p-sub">Actividad comercial generada · medición por fecha de creación o registro</span>
            </div>
            <div className="p-hd-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select className="p-select" value={comparisonPeriod} onChange={(event) => setComparisonPeriod(event.target.value)}>
                {COMPARISON_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
              <button type="button" className="p-btn p-btn--ghost" onClick={() => setComparisonExpanded((expanded) => !expanded)}>
                {comparisonExpanded ? "Ocultar detalle" : "Ver comparativo"}
              </button>
            </div>
          </div>
          {comparisonExpanded && (
            <div className="p-metrics">
              {comparison.map((item) => {
                const delta = comparisonDelta(item.value, item.previous);
                const format = item.formatter || ((value) => Number(value || 0).toLocaleString("es-AR"));
                return (
                  <div key={item.label} className="p-metric">
                    <span className="p-metric__ey">{item.label}</span>
                    <span className="p-metric__val">{format(item.value)}</span>
                    <span className="p-metric__sub">Anterior: {format(item.previous)}</span>
                    <span className={delta.tone === "up" ? "p-metric__up" : delta.tone === "down" ? "p-metric__down" : "p-metric__sub"}>
                      {delta.tone === "up" ? "↑" : delta.tone === "down" ? "↓" : "→"} {delta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* OPERATIONAL METRICS PANEL */}
        <div className="p-panel dash-health-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Salud comercial</span>
              <span className="p-sub">Métricas operativas · Pipeline, eficiencia y calidad</span>
            </div>
            <div className="p-hd-right" style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={`p-btn ${dashboardMode === "complete" ? "p-btn--primary" : "p-btn--ghost"}`}
                onClick={() => setDashboardMode("complete")}
              >
                Completo
              </button>
              <button
                type="button"
                className={`p-btn ${dashboardMode === "executive" ? "p-btn--primary" : "p-btn--ghost"}`}
                onClick={() => setDashboardMode("executive")}
              >
                Ejecutivo
              </button>
            </div>
          </div>
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Opps. abiertas</span>
              <span className="p-metric__val">{metrics.openOpps}</span>
              <span className="p-metric__sub">Pipeline activo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Hot deals</span>
              <span className="p-metric__val">{metrics.hotDeals}</span>
              <span className="p-metric__sub">Prob. ≥70%</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Sin próx. acción</span>
              <span className="p-metric__val">{metrics.noAction}</span>
              <span className="p-metric__sub">Requieren seguimiento</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Vencidas</span>
              <span className="p-metric__val">{metrics.overdue}</span>
              <span className="p-metric__sub">Revisión urgente</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Win rate</span>
              <span className="p-metric__val">{metrics.winRate}%</span>
              <span className="p-metric__sub">{metrics.won} ganadas · {metrics.lost} perdidas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Ticket promedio</span>
              <span className="p-metric__val">{compactMoney(metrics.avgDeal)}</span>
              <span className="p-metric__sub">Por opp. abierta</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Días en pipeline</span>
              <span className="p-metric__val">{metrics.avgDaysInPipeline}d</span>
              <span className="p-metric__sub">Promedio de antigüedad</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Conversión</span>
              <span className="p-metric__val">{metrics.convRate}%</span>
              <span className="p-metric__sub">Lead → Cotización+</span>
            </div>
          </div>
        </div>


        {/* CHARTS ROW */}
        {showDetailedPanels ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="p-panel">
                <div className="p-hd">
                  <div className="p-hd-left">
                    <span className="p-title">Pipeline por etapa</span>
                    <span className="p-sub">Monto total en cada fase</span>
                  </div>
                </div>
                <div className="p-chart"><canvas ref={pipelineRef}/></div>
              </div>
              <div className="p-panel">
                <div className="p-hd">
                  <div className="p-hd-left">
                    <span className="p-title">Actividad semanal</span>
                    <span className="p-sub">Visitas registradas por día de la semana</span>
                  </div>
                </div>
                <div className="p-chart"><canvas ref={activityRef}/></div>
              </div>
            </div>

            {/* PROBABILITY + STAGE DISTRIBUTION */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <ProbabilityPanel probabilityRef={probabilityRef} total={compactMoney(metrics.pipeline)}/>
              <StageDistributionPanel opps={filteredOpps}/>
            </div>

            {/* HOT PROJECTS + CAMPAIGNS */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <HotProjects rows={projectTemperature}/>
              <CampaignPanel rows={campaignRows}/>
            </div>

            {/* RECENT VISITS */}
            <RecentVisitsPanel visits={filteredVisits}/>
          </>
        ) : (
          <div className="p-panel">
            <div className="p-body">
              <span className="p-section__label">Análisis extendido</span>
              <p className="p-title" style={{ marginTop: 8 }}>Gráficos, campañas y actividad del equipo</p>
              <p className="p-sub" style={{ marginTop: 4 }}>La lectura ejecutiva prioriza decisiones. Abrí la vista completa cuando necesites profundizar.</p>
              <button type="button" className="p-btn p-btn--primary" style={{ marginTop: 14 }} onClick={() => setDashboardMode("complete")}>Ver análisis completo</button>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */
function PrimaryKpi({ label, value, sub, accent = "blue", tooltip, progress = 0, meta }) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)));
  return (
    <article className={`dash-primary-kpi module-hover-effect dash-primary-kpi--${accent}`}>
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
    <article className={`dash-kpi module-hover-effect${accent ? ` dash-kpi--${accent}` : ""}`}>
      <div className="dash-kpi__header">
        <span className="dash-kpi__label">{label}</span>
        {tooltip && <Tooltip text={tooltip}/>}
      </div>
      <strong className="dash-kpi__value" title={String(value)}>{value}</strong>
    </article>
  );
}

function Panel({ title, subtitle, metric, children }) {
  return (
    <article className="dash-panel module-hover-effect">
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
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Campañas vs objetivo</span>
          <span className="p-sub">Forecast ponderado por campaña</span>
        </div>
        <div className="p-hd-right">
          <span className="p-sub">{rows.length} campañas</span>
        </div>
      </div>
      {rows.length === 0 ? <p className="p-empty">No hay campañas cargadas.</p> : (
        <div className="p-list">
          {rows.slice(0, 4).map((r) => (
            <div className="p-row" key={r.id}>
              <div className="p-row__main">
                <span className="p-row__name">{r.name}</span>
                <div className="p-progress">
                  <div className={`p-progress-fill ${r.coverage >= 80 ? "p-progress-fill--green" : r.coverage >= 50 ? "p-progress-fill--amber" : "p-progress-fill--red"}`} style={{ width:`${Math.min(100, r.coverage)}%` }}/>
                </div>
              </div>
              <div className="p-row__meta">
                <span className="p-row__val">{money(r.forecast)}</span>
                <span className={r.coverage >= 80 ? "p-badge--green" : r.coverage >= 50 ? "p-badge--amber" : "p-badge--red"}>{r.coverage}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HotProjects({ rows }) {
  return (
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Proyectos prioritarios</span>
          <span className="p-sub">Ordenados por score de temperatura</span>
        </div>
        <div className="p-hd-right">
          <span className="p-sub">Top score: {rows[0]?.score || 0}</span>
        </div>
      </div>
      {rows.length === 0 ? <p className="p-empty">No hay oportunidades abiertas.</p> : (
        <div className="p-list">
          {rows.slice(0, 5).map((p, index) => (
            <div className="p-row" key={p.id}>
              <span className="p-row__rank">{index + 1}</span>
              <div className="p-row__main">
                <span className="p-row__name">{p.name}</span>
                <span className="p-row__sub">{p.client} · {p.stage}</span>
                <span className="p-row__sub">{p.nextAction}</span>
                <div className="p-progress">
                  <div className={`p-progress-fill ${p.score >= 75 ? "p-progress-fill--green" : p.score >= 50 ? "p-progress-fill--amber" : "p-progress-fill--red"}`} style={{ width: `${p.score}%` }} />
                </div>
              </div>
              <div className="p-row__meta">
                <span className="p-row__val">{money(p.forecast)}</span>
                <span className={p.score >= 75 ? "p-badge--green" : p.score >= 50 ? "p-badge--amber" : "p-badge--gray"}>{p.score}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
