import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./sellerDashboard.css";

const STAGES = ["Lead", "Contactado", "Reunión", "Demo", "Cotización", "Negociación"];

function money(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(1).replace(".", ",")} MM`;
  if (n >= 1_000_000_000)     return `$${(n / 1_000_000_000).toFixed(1).replace(".", ",")} MM`;
  if (n >= 1_000_000)         return `$${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000)             return `$${(n / 1_000).toFixed(0)} K`;
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

export default function SellerDashboard({ profile, onNavigate, pageKey }) {
  const [visits, setVisits]               = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [loading, setLoading]             = useState(true);

  const pipelineRef = useRef(null);
  const activityRef = useRef(null);

  useEffect(() => { loadData(); }, [pageKey]);
  useEffect(() => { if (!loading) renderCharts(); }, [loading, visits, opportunities, accounts]);
  useEffect(() => {
    if (loading) return;
    const obs = new MutationObserver(() => renderCharts());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, [loading]);

  async function loadData() {
    setLoading(true);
    // Todos los roles cargan TODOS los datos del equipo — sin filtro por owner
    const [visitsRes, oppsRes, accountsRes] = await Promise.all([
      supabase.from("visits").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").order("visit_date", { ascending: false }),
      supabase.from("opportunities").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").order("created_at", { ascending: false }),
      supabase.from("accounts").select("*").order("name"),
    ]);
    setVisits(visitsRes.data || []);
    setOpportunities(oppsRes.data || []);
    setAccounts(accountsRes.data || []);
    setLoading(false);
  }

  const metrics = useMemo(() => {
    const today    = new Date();
    const openOpps = opportunities.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    const pipeline = openOpps.reduce((s, o) => s + Number(o.amount || 0), 0);
    const forecast = openOpps.reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
    const hotDeals = openOpps.filter((o) => Number(o.probability || 0) >= 70).length;
    const withoutNextAction = openOpps.filter((o) => !o.next_action).length;
    const redAccounts = accounts.filter((a) => a.follow_status === "rojo").length;
    const won  = opportunities.filter((o) => o.stage === "Ganado").length;
    const lost = opportunities.filter((o) => o.stage === "Perdido").length;
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    const overdueOpps = openOpps.filter((o) => o.expected_close && new Date(o.expected_close) < today).length;

    const coldAccounts = accounts.filter((a) => {
      const av = visits.filter((v) => v.account_id === a.id);
      if (!av.length) return true;
      const last = av.sort((x, y) => new Date(y.visit_date) - new Date(x.visit_date))[0];
      return Math.floor((today - new Date(last.visit_date)) / 86400000) > 30;
    }).length;

    const weekAgo    = new Date(today.getTime() - 7 * 86400000);
    const twoWeekAgo = new Date(today.getTime() - 14 * 86400000);
    const visitsThisWeek = visits.filter((v) => new Date(v.visit_date) >= weekAgo).length;
    const visitsPrevWeek = visits.filter((v) => { const d = new Date(v.visit_date); return d >= twoWeekAgo && d < weekAgo; }).length;

    const in30Days = new Date(today.getTime() + 30 * 86400000);
    const closingThisMonth = openOpps.filter((o) => {
      if (!o.expected_close) return false;
      const d = new Date(o.expected_close);
      return d >= today && d <= in30Days;
    });
    const closingAmount = closingThisMonth.reduce((s, o) => s + Number(o.amount || 0), 0);

    return {
      visits: visits.length, opportunities: opportunities.length,
      openOpps: openOpps.length, accounts: accounts.length,
      redAccounts, pipeline, forecast, hotDeals, withoutNextAction, winRate,
      overdueOpps, coldAccounts, visitsThisWeek, visitsPrevWeek,
      closingThisMonth: closingThisMonth.length, closingAmount,
    };
  }, [visits, opportunities, accounts]);

  const visitPriority = useMemo(() => {
    const today = new Date();
    return accounts
      .map((account) => {
        const av = visits.filter((v) => v.account_id === account.id);
        const lastVisit = av[0];
        const ao = opportunities.filter((o) => o.account_id === account.id);
        const openPipeline = ao.filter((o) => !["Ganado","Perdido"].includes(o.stage)).reduce((s, o) => s + Number(o.amount || 0), 0);
        let daysWithoutVisit = 999;
        if (lastVisit?.visit_date) daysWithoutVisit = Math.floor((today - new Date(lastVisit.visit_date)) / 86400000);
        let score = 0;
        if (account.potential === "Alto")  score += 40;
        if (account.potential === "Medio") score += 25;
        if (account.potential === "Bajo")  score += 10;
        if (daysWithoutVisit > 30) score += 35;
        else if (daysWithoutVisit > 15) score += 20;
        else score += 5;
        if (openPipeline > 0) score += 25;
        if (account.follow_status === "rojo") score += 20;
        return { ...account, score, daysWithoutVisit, openPipeline };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [accounts, visits, opportunities]);

  const closingSoon = useMemo(() => {
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 86400000);
    return opportunities
      .filter((o) => !["Ganado","Perdido"].includes(o.stage) && o.expected_close)
      .filter((o) => { const d = new Date(o.expected_close); return d >= today && d <= in30Days; })
      .sort((a, b) => new Date(a.expected_close) - new Date(b.expected_close));
  }, [opportunities]);

  function pipelineByStage() {
    return STAGES.map((stage) => opportunities.filter((o) => o.stage === stage).reduce((s, o) => s + Number(o.amount || 0), 0));
  }

  function activityByWeek() {
    return ["Lun","Mar","Mié","Jue","Vie"].map((_, i) => visits.filter((v) => new Date(v.visit_date).getDay() === i + 1).length);
  }

  const PIPELINE_BAR_COLORS = ["#8b9cb3","#3b82f6","#818cf8","#fbbf24","#fb923c","#f87171"];

  function chartOptions({ yMoney = false, isDark = false } = {}) {
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
    [pipelineRef, activityRef].forEach((ref) => { if (ref.current?.chartInstance) ref.current.chartInstance.destroy(); });

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";

    if (pipelineRef.current) {
      pipelineRef.current.chartInstance = new Chart(pipelineRef.current, {
        type: "bar",
        data: { labels: STAGES, datasets: [{ data: pipelineByStage(), backgroundColor: PIPELINE_BAR_COLORS, borderColor: PIPELINE_BAR_COLORS, borderWidth: 0, borderRadius: 6, borderSkipped: false }] },
        options: chartOptions({ yMoney: true, isDark }),
      });
    }

    if (activityRef.current) {
      const ctx  = activityRef.current.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 220);
      grad.addColorStop(0, isDark ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.18)");
      grad.addColorStop(1, "rgba(16,185,129,0.00)");
      activityRef.current.chartInstance = new Chart(activityRef.current, {
        type: "line",
        data: { labels: ["Lun","Mar","Mié","Jue","Vie"], datasets: [{ data: activityByWeek(), borderColor: "#10b981", borderWidth: 2.5, backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: "#10b981", pointBorderColor: isDark ? "#111" : "#fff", pointBorderWidth: 2.5 }] },
        options: chartOptions({ isDark }),
      });
    }
  }

  if (loading) {
    return (
      <Layout title="Dashboard" profile={profile} onNavigate={onNavigate}>
        <div className="sd-loading"><div className="sd-loading__pulse"/><span>Cargando dashboard…</span></div>
      </Layout>
    );
  }

  const firstName = profile?.full_name?.split(" ")[0] || "usuario";
  const weekTrend = metrics.visitsThisWeek >= metrics.visitsPrevWeek ? "↑" : "↓";
  const weekColor = metrics.visitsThisWeek >= metrics.visitsPrevWeek ? "#10b981" : "#ef4444";

  return (
    <Layout title="Dashboard" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* HEADER PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-sub">STORING Medical · CRM</span>
              <span className="p-title" style={{ fontSize: 18, fontWeight: 600 }}>Hola, {firstName}</span>
              <span className="p-sub">Resumen del equipo comercial — pipeline, visitas, oportunidades y clientes.</span>
            </div>
            <div className="p-hd-right">
              <button className="p-btn p-btn--primary" onClick={() => onNavigate("visits", { action: "create", source: "sellerDashboard" })}>+ Registrar visita</button>
            </div>
          </div>

          {/* PRIMARY METRICS STRIP */}
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline abierto</span>
              <span className="p-metric__val">{compactMoney(metrics.pipeline)}</span>
              <span className="p-metric__sub">Total oportunidades activas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast ponderado</span>
              <span className="p-metric__val">{compactMoney(metrics.forecast)}</span>
              <span className="p-metric__sub">Probabilidad × monto</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Opps. abiertas</span>
              <span className="p-metric__val">{metrics.openOpps}</span>
              <span className="p-metric__sub">En proceso de cierre</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Visitas registradas</span>
              <span className="p-metric__val">{metrics.visits}</span>
              <span className="p-metric__sub">Total del equipo</span>
            </div>
          </div>

          {/* SECONDARY METRICS STRIP */}
          <div className="p-metrics" style={{ borderBottom: "none" }}>
            <div className="p-metric">
              <span className="p-metric__ey">Clientes totales</span>
              <span className="p-metric__val">{metrics.accounts}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Clientes en riesgo</span>
              <span className="p-metric__val p-metric__down">{metrics.redAccounts}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Hot deals</span>
              <span className="p-metric__val" style={{ color: "#f59e0b" }}>{metrics.hotDeals}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Sin próxima acción</span>
              <span className="p-metric__val p-metric__down">{metrics.withoutNextAction}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Opps. vencidas</span>
              <span className={`p-metric__val ${metrics.overdueOpps > 0 ? "p-metric__down" : ""}`}>{metrics.overdueOpps}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Clientes fríos +30d</span>
              <span className={`p-metric__val ${metrics.coldAccounts > 0 ? "p-metric__down" : ""}`}>{metrics.coldAccounts}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Visitas esta semana</span>
              <span className="p-metric__val">{metrics.visitsThisWeek}</span>
              <span className="p-metric__sub" style={{ color: weekColor }}>{weekTrend} vs sem. ant. ({metrics.visitsPrevWeek})</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">A cerrar en 30 días</span>
              <span className={`p-metric__val ${metrics.closingThisMonth > 0 ? "p-metric__up" : ""}`}>{metrics.closingThisMonth}</span>
              <span className="p-metric__sub">{compactMoney(metrics.closingAmount)}</span>
            </div>
          </div>
        </div>

        {/* INSIGHTS PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Alertas y sugerencias</span>
            </div>
          </div>
          <div className="p-metrics" style={{ borderBottom: "none" }}>
            <div className="p-metric">
              <span className="p-metric__ey">Actividad esta semana</span>
              <span className="p-metric__val">{metrics.visitsThisWeek} visitas</span>
              <span className="p-metric__sub" style={{ color: weekColor }}>{weekTrend} vs semana anterior ({metrics.visitsPrevWeek})</span>
              <span className="p-metric__sub">Ritmo de contacto del equipo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline a cerrar este mes</span>
              <span className="p-metric__val p-metric__up">{compactMoney(metrics.closingAmount)}</span>
              <span className="p-metric__sub">{metrics.closingThisMonth} oportunidad{metrics.closingThisMonth !== 1 ? "es" : ""} próximas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Oportunidades vencidas</span>
              <span className={`p-metric__val ${metrics.overdueOpps > 0 ? "p-metric__down" : ""}`}>{metrics.overdueOpps}</span>
              <span className="p-metric__sub">{metrics.overdueOpps > 0 ? "Requieren acción urgente" : "Sin vencimientos"}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Clientes fríos</span>
              <span className={`p-metric__val ${metrics.coldAccounts > 0 ? "p-metric__down" : ""}`}>{metrics.coldAccounts}</span>
              <span className="p-metric__sub">{metrics.coldAccounts > 0 ? "+30 días sin visita" : "Todos contactados"}</span>
            </div>
          </div>

          {/* ACTION SUGGESTIONS */}
          <div className="p-section">
            <div className="p-body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220, padding: "12px 16px", background: metrics.overdueOpps > 0 ? "rgba(239,68,68,0.08)" : metrics.withoutNextAction > 0 ? "rgba(245,158,11,0.08)" : metrics.hotDeals > 0 ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.04)", borderRadius: 10, borderLeft: `3px solid ${metrics.overdueOpps > 0 ? "#ef4444" : metrics.withoutNextAction > 0 ? "#f59e0b" : metrics.hotDeals > 0 ? "#10b981" : "#6b7280"}` }}>
                <span className="p-metric__ey">Acción comercial sugerida</span>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>
                  {metrics.overdueOpps > 0
                    ? `${metrics.overdueOpps} oportunidad${metrics.overdueOpps > 1 ? "es vencidas" : " vencida"}. Actualizar fecha o cerrar.`
                    : metrics.withoutNextAction > 0
                    ? `${metrics.withoutNextAction} oportunidades necesitan próximo paso. Definir acción hoy.`
                    : metrics.hotDeals > 0
                    ? `${metrics.hotDeals} oportunidades calientes. Priorizar cierre.`
                    : "Operación estable. Mantener seguimiento de visitas."}
                </p>
              </div>
              <div style={{ flex: 1, minWidth: 220, padding: "12px 16px", background: visitPriority[0] ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.04)", borderRadius: 10, borderLeft: `3px solid ${visitPriority[0] ? "#f59e0b" : "#6b7280"}` }}>
                <span className="p-metric__ey">Prioridad de visita</span>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>
                  {visitPriority[0] ? `Visitar primero: ${visitPriority[0].name}. Score ${visitPriority[0].score}.` : "No hay clientes cargados todavía."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CHARTS PANELS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Pipeline por etapa</span>
                <span className="p-sub">Monto total en cada fase</span>
              </div>
            </div>
            <div className="p-chart" style={{ height: 240 }}>
              <canvas ref={pipelineRef}/>
            </div>
          </div>

          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Actividad semanal</span>
                <span className="p-sub">Visitas registradas por día</span>
              </div>
            </div>
            <div className="p-chart" style={{ height: 240 }}>
              <canvas ref={activityRef}/>
            </div>
          </div>
        </div>

        {/* LISTS PANELS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>

          {/* Últimas visitas */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Últimas visitas</span>
                <span className="p-sub">Actividad reciente del equipo</span>
              </div>
            </div>
            <div className="p-list">
              {visits.length === 0 ? (
                <p className="p-empty">No hay visitas registradas.</p>
              ) : (
                visits.slice(0, 5).map((v) => (
                  <div key={v.id} className="p-row">
                    <div className="p-row__main">
                      <div className="p-row__name">{v.accounts?.name || "Sin cliente"}</div>
                      <div className="p-row__sub">{v.products?.name || "Sin producto"} · {v.visit_type || "—"}</div>
                    </div>
                    <div className="p-row__val">{v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR") : "—"}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* A cerrar este mes */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">A cerrar este mes</span>
                <span className="p-sub">Expected close en próximos 30 días</span>
              </div>
            </div>
            <div className="p-list">
              {closingSoon.length === 0 ? (
                <p className="p-empty">No hay oportunidades próximas.</p>
              ) : (
                closingSoon.slice(0, 5).map((o) => (
                  <div key={o.id} className="p-row">
                    <div className="p-row__main">
                      <div className="p-row__name">{o.name || "Sin nombre"}</div>
                      <div className="p-row__sub">{o.stage} · {new Date(o.expected_close).toLocaleDateString("es-AR")}</div>
                    </div>
                    <div className="p-row__val" style={{ color: "#10b981" }}>{money(o.amount)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Clientes prioritarios */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Clientes prioritarios</span>
                <span className="p-sub">Ordenados por score de urgencia</span>
              </div>
            </div>
            <div className="p-list">
              {visitPriority.length === 0 ? (
                <p className="p-empty">No hay clientes cargados.</p>
              ) : (
                visitPriority.map((c) => (
                  <div key={c.id} className="p-row">
                    <div className="p-row__main">
                      <div className="p-row__name">{c.name}</div>
                      <div className="p-row__sub">Score {c.score} · {c.daysWithoutVisit} días sin visita</div>
                    </div>
                    <div className="p-row__val" style={{ color: c.daysWithoutVisit > 30 ? "#ef4444" : undefined }}>{money(c.openPipeline)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </Layout>
  );
}
