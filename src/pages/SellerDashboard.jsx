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

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/* Roles que ven datos de TODO el equipo */
const isManager = (role) => ["super_admin", "manager"].includes(role);

export default function SellerDashboard({ profile, onNavigate }) {
  const [visits, setVisits]               = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [allProfiles, setAllProfiles]     = useState([]);
  const [selectedSeller, setSelectedSeller] = useState("all"); // solo manager
  const [loading, setLoading]             = useState(true);

  const pipelineRef = useRef(null);
  const activityRef = useRef(null);

  const managerView = isManager(profile?.role);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!loading) renderCharts(); }, [loading, visits, opportunities, accounts, selectedSeller]);

  async function loadData() {
    setLoading(true);

    if (managerView) {
      /* Manager/Admin: carga todo */
      const [visitsRes, oppsRes, accountsRes, profilesRes] = await Promise.all([
        supabase.from("visits").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").order("visit_date", { ascending: false }),
        supabase.from("opportunities").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").order("created_at", { ascending: false }),
        supabase.from("accounts").select("*").order("name"),
        supabase.from("profiles").select("id, full_name, email").eq("approved", true),
      ]);
      setVisits(visitsRes.data || []);
      setOpportunities(oppsRes.data || []);
      setAccounts(accountsRes.data || []);
      setAllProfiles(profilesRes.data || []);
    } else {
      /* Vendedor: solo sus datos */
      const [visitsRes, oppsRes, accountsRes] = await Promise.all([
        supabase.from("visits").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").eq("owner_id", profile.id).order("visit_date", { ascending: false }),
        supabase.from("opportunities").select("*, accounts(name, city, province, potential, follow_status), products(name, line)").eq("owner_id", profile.id).order("created_at", { ascending: false }),
        supabase.from("accounts").select("*").eq("owner_id", profile.id).order("name"),
      ]);
      setVisits(visitsRes.data || []);
      setOpportunities(oppsRes.data || []);
      setAccounts(accountsRes.data || []);
    }

    setLoading(false);
  }

  /* Filtrar por vendedor seleccionado (solo manager) */
  const filteredVisits = useMemo(() => {
    if (!managerView || selectedSeller === "all") return visits;
    return visits.filter((v) => v.owner_id === selectedSeller);
  }, [visits, selectedSeller, managerView]);

  const filteredOpps = useMemo(() => {
    if (!managerView || selectedSeller === "all") return opportunities;
    return opportunities.filter((o) => o.owner_id === selectedSeller);
  }, [opportunities, selectedSeller, managerView]);

  const filteredAccounts = useMemo(() => {
    if (!managerView || selectedSeller === "all") return accounts;
    return accounts.filter((a) => a.owner_id === selectedSeller);
  }, [accounts, selectedSeller, managerView]);

  const metrics = useMemo(() => {
    const today    = new Date();
    const openOpps = filteredOpps.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    const pipeline = openOpps.reduce((s, o) => s + Number(o.amount || 0), 0);
    const forecast = openOpps.reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
    const hotDeals = openOpps.filter((o) => Number(o.probability || 0) >= 70).length;
    const withoutNextAction = openOpps.filter((o) => !o.next_action).length;
    const redAccounts = filteredAccounts.filter((a) => a.follow_status === "rojo").length;
    const won  = filteredOpps.filter((o) => o.stage === "Ganado").length;
    const lost = filteredOpps.filter((o) => o.stage === "Perdido").length;
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    const overdueOpps = openOpps.filter((o) => o.expected_close && new Date(o.expected_close) < today).length;

    const coldAccounts = filteredAccounts.filter((a) => {
      const av = filteredVisits.filter((v) => v.account_id === a.id);
      if (!av.length) return true;
      const last = av.sort((x, y) => new Date(y.visit_date) - new Date(x.visit_date))[0];
      return Math.floor((today - new Date(last.visit_date)) / 86400000) > 30;
    }).length;

    const weekAgo    = new Date(today.getTime() - 7 * 86400000);
    const twoWeekAgo = new Date(today.getTime() - 14 * 86400000);
    const visitsThisWeek = filteredVisits.filter((v) => new Date(v.visit_date) >= weekAgo).length;
    const visitsPrevWeek = filteredVisits.filter((v) => { const d = new Date(v.visit_date); return d >= twoWeekAgo && d < weekAgo; }).length;

    const in30Days = new Date(today.getTime() + 30 * 86400000);
    const closingThisMonth = openOpps.filter((o) => {
      if (!o.expected_close) return false;
      const d = new Date(o.expected_close);
      return d >= today && d <= in30Days;
    });
    const closingAmount = closingThisMonth.reduce((s, o) => s + Number(o.amount || 0), 0);

    return {
      visits: filteredVisits.length, opportunities: filteredOpps.length,
      openOpps: openOpps.length, accounts: filteredAccounts.length,
      redAccounts, pipeline, forecast, hotDeals, withoutNextAction, winRate,
      overdueOpps, coldAccounts, visitsThisWeek, visitsPrevWeek,
      closingThisMonth: closingThisMonth.length, closingAmount,
    };
  }, [filteredVisits, filteredOpps, filteredAccounts]);

  const visitPriority = useMemo(() => {
    const today = new Date();
    return filteredAccounts
      .map((account) => {
        const av = filteredVisits.filter((v) => v.account_id === account.id);
        const lastVisit = av[0];
        const ao = filteredOpps.filter((o) => o.account_id === account.id);
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
  }, [filteredAccounts, filteredVisits, filteredOpps]);

  const closingSoon = useMemo(() => {
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 86400000);
    return filteredOpps
      .filter((o) => !["Ganado","Perdido"].includes(o.stage) && o.expected_close)
      .filter((o) => { const d = new Date(o.expected_close); return d >= today && d <= in30Days; })
      .sort((a, b) => new Date(a.expected_close) - new Date(b.expected_close));
  }, [filteredOpps]);

  function pipelineByStage() {
    return STAGES.map((stage) => filteredOpps.filter((o) => o.stage === stage).reduce((s, o) => s + Number(o.amount || 0), 0));
  }

  function activityByWeek() {
    return ["Lun","Mar","Mié","Jue","Vie"].map((_, i) => filteredVisits.filter((v) => new Date(v.visit_date).getDay() === i + 1).length);
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
    [pipelineRef, activityRef].forEach((ref) => { if (ref.current?.chartInstance) ref.current.chartInstance.destroy(); });

    if (pipelineRef.current) {
      pipelineRef.current.chartInstance = new Chart(pipelineRef.current, {
        type: "bar",
        data: { labels: STAGES, datasets: [{ data: pipelineByStage(), backgroundColor: "rgba(59,130,246,0.15)", borderColor: "rgba(59,130,246,0.7)", borderWidth: 1.5, borderRadius: 6, borderSkipped: false }] },
        options: chartOptions({ yMoney: true }),
      });
    }

    if (activityRef.current) {
      const ctx = activityRef.current.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 220);
      grad.addColorStop(0, "rgba(16,185,129,0.15)");
      grad.addColorStop(1, "rgba(16,185,129,0.01)");
      activityRef.current.chartInstance = new Chart(activityRef.current, {
        type: "line",
        data: { labels: ["Lun","Mar","Mié","Jue","Vie"], datasets: [{ data: activityByWeek(), borderColor: "rgba(16,185,129,0.8)", backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: "#10b981", pointBorderColor: "#fff", pointBorderWidth: 2 }] },
        options: chartOptions(),
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

  const firstName = profile?.full_name?.split(" ")[0] || "vendedor";
  const weekTrend = metrics.visitsThisWeek >= metrics.visitsPrevWeek ? "↑" : "↓";
  const weekColor = metrics.visitsThisWeek >= metrics.visitsPrevWeek ? "#10b981" : "#ef4444";

  const heroTitle = managerView
    ? selectedSeller === "all"
      ? `Hola, ${firstName} 👋`
      : `Viendo: ${allProfiles.find((p) => p.id === selectedSeller)?.full_name || "vendedor"}`
    : `Hola, ${firstName} 👋`;

  const heroSub = managerView
    ? "Resumen del equipo comercial. Filtrá por vendedor para ver datos individuales."
    : "Resumen diario de tus visitas, oportunidades y clientes prioritarios.";

  return (
    <Layout title="Dashboard" profile={profile} onNavigate={onNavigate}>
      <div className="sd">

        {/* HERO */}
        <header className="sd-hero">
          <div className="sd-hero__left">
            <p className="sd-hero__eyebrow">STORING Medical · CRM</p>
            <h1 className="sd-hero__title">{heroTitle}</h1>
            <p className="sd-hero__sub">{heroSub}</p>
          </div>
          <div className="sd-hero__right">
            {/* Filtro por vendedor — solo managers */}
            {managerView && (
              <select
                className="sd-seller-filter"
                value={selectedSeller}
                onChange={(e) => setSelectedSeller(e.target.value)}
              >
                <option value="all">Todo el equipo</option>
                {allProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </select>
            )}
            <button className="sd-hero__btn" onClick={() => onNavigate("visits")}>+ Registrar visita</button>
          </div>
        </header>

        {/* PRIMARY KPIs */}
        <section className="sd-primary-kpis">
          <SdPrimaryKpi label="Pipeline abierto"    value={money(metrics.pipeline)}  sub="Total oportunidades activas" accent="blue"/>
          <SdPrimaryKpi label="Forecast ponderado"  value={money(metrics.forecast)}  sub="Probabilidad × monto"        accent="blue"/>
          <SdPrimaryKpi label="Opps. abiertas"      value={metrics.openOpps}         sub="En proceso de cierre"        accent="slate"/>
          <SdPrimaryKpi label="Visitas registradas" value={metrics.visits}           sub="Total en el período"         accent="green"/>
        </section>

        {/* SECONDARY KPIs */}
        <section className="sd-kpi-grid">
          <SdKpi label={managerView ? "Clientes totales" : "Clientes asignados"} value={metrics.accounts}/>
          <SdKpi label="Clientes en riesgo"  value={metrics.redAccounts}       accent="red"/>
          <SdKpi label="Hot deals"           value={metrics.hotDeals}          accent="amber"/>
          <SdKpi label="Sin próxima acción"  value={metrics.withoutNextAction} accent="red"/>
          <SdKpi label="Opps. vencidas"      value={metrics.overdueOpps}       accent={metrics.overdueOpps > 0 ? "red" : undefined}/>
          <SdKpi label="Clientes fríos +30d" value={metrics.coldAccounts}      accent={metrics.coldAccounts > 0 ? "amber" : undefined}/>
          <SdKpi label="Visitas esta semana" value={metrics.visitsThisWeek}/>
          <SdKpi label="A cerrar en 30 días" value={metrics.closingThisMonth}  accent={metrics.closingThisMonth > 0 ? "green" : undefined}/>
        </section>

        {/* INSIGHTS */}
        <section className="sd-insights">
          <div className="sd-insight-card">
            <span className="sd-insight__label">Actividad esta semana</span>
            <div className="sd-insight__row">
              <strong className="sd-insight__value">{metrics.visitsThisWeek} visitas</strong>
              <span style={{ color: weekColor, fontWeight: 700, fontSize: 13 }}>{weekTrend} vs semana anterior ({metrics.visitsPrevWeek})</span>
            </div>
            <span className="sd-insight__sub">Mantené el ritmo de contacto comercial</span>
          </div>

          <div className="sd-insight-card sd-insight-card--green">
            <span className="sd-insight__label">Pipeline a cerrar este mes</span>
            <div className="sd-insight__row">
              <strong className="sd-insight__value">{money(metrics.closingAmount)}</strong>
              <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>{metrics.closingThisMonth} oportunidad{metrics.closingThisMonth !== 1 ? "es" : ""}</span>
            </div>
            <span className="sd-insight__sub">Con cierre en los próximos 30 días</span>
          </div>

          <div className={`sd-insight-card ${metrics.overdueOpps > 0 ? "sd-insight-card--red" : ""}`}>
            <span className="sd-insight__label">Oportunidades vencidas</span>
            <div className="sd-insight__row">
              <strong className="sd-insight__value">{metrics.overdueOpps}</strong>
              {metrics.overdueOpps > 0 && <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 13 }}>⚠ Requieren acción</span>}
            </div>
            <span className="sd-insight__sub">Fecha de cierre ya pasó sin resolver</span>
          </div>

          <div className={`sd-insight-card ${metrics.coldAccounts > 0 ? "sd-insight-card--amber" : ""}`}>
            <span className="sd-insight__label">Clientes fríos</span>
            <div className="sd-insight__row">
              <strong className="sd-insight__value">{metrics.coldAccounts}</strong>
              {metrics.coldAccounts > 0 && <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13 }}>+30 días sin visita</span>}
            </div>
            <span className="sd-insight__sub">Sin contacto reciente</span>
          </div>
        </section>

        {/* DECISIONS */}
        <section className="sd-decisions">
          <SdDecision
            tone={metrics.overdueOpps > 0 ? "danger" : metrics.withoutNextAction > 0 ? "warning" : metrics.hotDeals > 0 ? "success" : "neutral"}
            icon={metrics.overdueOpps > 0 ? "⚠" : metrics.withoutNextAction > 0 ? "◎" : metrics.hotDeals > 0 ? "↑" : "●"}
            title="Acción comercial sugerida"
            text={
              metrics.overdueOpps > 0
                ? `${metrics.overdueOpps} oportunidad${metrics.overdueOpps > 1 ? "es vencidas" : " vencida"}. Actualizar fecha o cerrar.`
                : metrics.withoutNextAction > 0
                ? `${metrics.withoutNextAction} oportunidades necesitan próximo paso. Definir acción hoy.`
                : metrics.hotDeals > 0
                ? `${metrics.hotDeals} oportunidades calientes. Priorizar cierre.`
                : "Operación estable. Mantener seguimiento de visitas."
            }
          />
          <SdDecision
            tone={visitPriority[0] ? "warning" : "neutral"}
            icon="◷"
            title="Prioridad de visita"
            text={visitPriority[0] ? `Visitar primero: ${visitPriority[0].name}. Score ${visitPriority[0].score}.` : "No hay clientes asignados todavía."}
          />
        </section>

        {/* CHARTS */}
        <section className="sd-chart-grid">
          <SdPanel title="Pipeline por etapa" sub="Monto total en cada fase"><canvas ref={pipelineRef}/></SdPanel>
          <SdPanel title="Actividad semanal"  sub="Visitas registradas por día"><canvas ref={activityRef}/></SdPanel>
        </section>

        {/* LISTS */}
        <section className="sd-list-grid">
          <SdListCard title="Últimas visitas" sub="Registro reciente de actividad">
            {filteredVisits.length === 0 ? <p className="sd-empty">No hay visitas registradas.</p> : (
              filteredVisits.slice(0, 5).map((v) => (
                <SdListItem key={v.id} title={v.accounts?.name || "Sin cliente"} sub={`${v.products?.name || "Sin producto"} · ${v.visit_type || "—"}`} right={v.visit_date ? new Date(v.visit_date).toLocaleDateString("es-AR") : "—"}/>
              ))
            )}
          </SdListCard>

          <SdListCard title="A cerrar este mes" sub="Expected close en próximos 30 días">
            {closingSoon.length === 0 ? <p className="sd-empty">No hay oportunidades próximas.</p> : (
              closingSoon.slice(0, 5).map((o) => (
                <SdListItem key={o.id} title={o.name || "Sin nombre"} sub={`${o.stage} · ${new Date(o.expected_close).toLocaleDateString("es-AR")}`} right={money(o.amount)} rightAccent="green"/>
              ))
            )}
          </SdListCard>

          <SdListCard title="Clientes prioritarios" sub="Ordenados por score de urgencia">
            {visitPriority.length === 0 ? <p className="sd-empty">No hay clientes.</p> : (
              visitPriority.map((c) => (
                <SdListItem key={c.id} title={c.name} sub={`Score ${c.score} · ${c.daysWithoutVisit} días sin visita`} right={money(c.openPipeline)} rightAccent={c.daysWithoutVisit > 30 ? "red" : undefined}/>
              ))
            )}
          </SdListCard>
        </section>

        <footer className="sd-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer" className="sd-footer-link">
            Designed by Daniel Etchudez
          </a>
        </footer>

      </div>
    </Layout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */
function SdPrimaryKpi({ label, value, sub, accent = "blue" }) {
  return (
    <article className={`sd-primary-kpi sd-primary-kpi--${accent}`}>
      <span className="sd-primary-kpi__label">{label}</span>
      <strong className="sd-primary-kpi__value" title={String(value)}>{value}</strong>
      <span className="sd-primary-kpi__sub">{sub}</span>
    </article>
  );
}

function SdKpi({ label, value, accent }) {
  return (
    <article className={`sd-kpi ${accent ? `sd-kpi--${accent}` : ""}`}>
      <span className="sd-kpi__label">{label}</span>
      <strong className="sd-kpi__value" title={String(value)}>{value}</strong>
    </article>
  );
}

function SdDecision({ tone, icon, title, text }) {
  return (
    <article className={`sd-decision sd-decision--${tone}`}>
      <span className="sd-decision__icon">{icon}</span>
      <div><span className="sd-decision__title">{title}</span><strong className="sd-decision__text">{text}</strong></div>
    </article>
  );
}

function SdPanel({ title, sub, children }) {
  return (
    <article className="sd-panel">
      <header className="sd-panel__header">
        <h3 className="sd-panel__title">{title}</h3>
        {sub && <p className="sd-panel__sub">{sub}</p>}
      </header>
      <div className="sd-chart-box">{children}</div>
    </article>
  );
}

function SdListCard({ title, sub, children }) {
  return (
    <article className="sd-list-card">
      <header className="sd-panel__header">
        <h3 className="sd-panel__title">{title}</h3>
        {sub && <p className="sd-panel__sub">{sub}</p>}
      </header>
      <div className="sd-list-body">{children}</div>
    </article>
  );
}

function SdListItem({ title, sub, right, rightAccent }) {
  return (
    <div className="sd-list-item">
      <div className="sd-list-item__left">
        <strong>{title}</strong>
        <span>{sub}</span>
      </div>
      <em className={`sd-list-item__right ${rightAccent ? `sd-list-item__right--${rightAccent}` : ""}`} title={String(right)}>{right}</em>
    </div>
  );
}