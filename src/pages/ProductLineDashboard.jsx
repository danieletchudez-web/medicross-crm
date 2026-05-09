import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./productLineDashboard.css";

const STAGES = ["Lead", "Contactado", "Reunión", "Demo", "Cotización", "Negociación"];

const LINE_OPTIONS = [
  "EchoLaser",
  "Osypka",
  "Diálisis",
  "Nutrición Clínica",
  "VAC",
  "Kangaroo",
  "Otro",
];

function money(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export default function ProductLineDashboard({ profile, onNavigate }) {
  const [selectedLine, setSelectedLine] = useState("EchoLaser");
  const [opportunities, setOpportunities] = useState([]);
  const [visits, setVisits] = useState([]);
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  const pipelineRef = useRef(null);
  const forecastRef = useRef(null);
  const activityRef = useRef(null);
  const productsRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) renderCharts();
  }, [loading, selectedLine, opportunities, visits, products, campaigns]);

  async function loadData() {
    setLoading(true);

    const [oppsRes, visitsRes, productsRes, accountsRes, campaignsRes] =
      await Promise.all([
        supabase
          .from("opportunities")
          .select("*, accounts(name, city, province, potential, follow_status), products(name, line), campaigns(name)")
          .order("created_at", { ascending: false }),

        supabase
          .from("visits")
          .select("*, accounts(name, city, province, potential, follow_status), products(name, line)")
          .order("visit_date", { ascending: false }),

        supabase.from("products").select("*").order("name"),

        supabase.from("accounts").select("*").order("name"),

        supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      ]);

    setOpportunities(oppsRes.data || []);
    setVisits(visitsRes.data || []);
    setProducts(productsRes.data || []);
    setAccounts(accountsRes.data || []);
    setCampaigns(campaignsRes.data || []);
    setLoading(false);
  }

  const lineProducts = useMemo(() => {
    return products.filter((p) => (p.line || "Otro") === selectedLine);
  }, [products, selectedLine]);

  const lineOpportunities = useMemo(() => {
    return opportunities.filter((o) => {
      const line = o.product_line || o.products?.line || "Otro";
      return line === selectedLine;
    });
  }, [opportunities, selectedLine]);

  const lineVisits = useMemo(() => {
    return visits.filter((v) => {
      const line = v.products?.line || "Otro";
      return line === selectedLine;
    });
  }, [visits, selectedLine]);

  const lineCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const line = c.product_line || c.line || "Otro";
      return line === selectedLine;
    });
  }, [campaigns, selectedLine]);

  const metrics = useMemo(() => {
    const openOpps = lineOpportunities.filter(
      (o) => !["Ganado", "Perdido"].includes(o.stage)
    );

    const pipeline = openOpps.reduce((s, o) => s + Number(o.amount || 0), 0);

    const forecast = openOpps.reduce(
      (s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100,
      0
    );

    const hotDeals = openOpps.filter((o) => Number(o.probability || 0) >= 70).length;
    const withoutNextAction = openOpps.filter((o) => !o.next_action).length;

    const target = lineCampaigns.reduce((s, c) => s + Number(c.target_amount || 0), 0);
    const coverage = target > 0 ? Math.round((forecast / target) * 100) : 0;

    const activeAccounts = new Set(
      [...lineOpportunities.map((o) => o.account_id), ...lineVisits.map((v) => v.account_id)]
        .filter(Boolean)
    ).size;

    const won = lineOpportunities.filter((o) => o.stage === "Ganado").length;
    const lost = lineOpportunities.filter((o) => o.stage === "Perdido").length;
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    return {
      pipeline,
      forecast,
      openOpps: openOpps.length,
      hotDeals,
      withoutNextAction,
      products: lineProducts.length,
      visits: lineVisits.length,
      accounts: activeAccounts,
      campaigns: lineCampaigns.length,
      target,
      coverage,
      winRate,
    };
  }, [lineOpportunities, lineVisits, lineProducts, lineCampaigns]);

  const decision = useMemo(() => {
    if (metrics.openOpps === 0) {
      return {
        title: "Generar pipeline",
        text: `La línea ${selectedLine} no tiene oportunidades abiertas. Activar visitas y prospección.`,
        tone: "danger",
      };
    }

    if (metrics.withoutNextAction > 0) {
      return {
        title: "Seguimiento pendiente",
        text: `${metrics.withoutNextAction} oportunidades de ${selectedLine} no tienen próxima acción definida.`,
        tone: "warning",
      };
    }

    if (metrics.hotDeals > 0) {
      return {
        title: "Priorizar cierre",
        text: `${metrics.hotDeals} oportunidades calientes en ${selectedLine}. Empujar cierre esta semana.`,
        tone: "success",
      };
    }

    return {
      title: "Operación estable",
      text: `La línea ${selectedLine} tiene actividad comercial activa. Mantener ritmo de seguimiento.`,
      tone: "neutral",
    };
  }, [metrics, selectedLine]);

  const campaignRows = useMemo(() => {
    return lineCampaigns.map((c) => {
      const forecast = lineOpportunities
        .filter((o) => o.campaign_id === c.id)
        .filter((o) => !["Ganado", "Perdido"].includes(o.stage))
        .reduce(
          (s, o) =>
            s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100,
          0
        );

      const target = Number(c.target_amount || 0);
      const coverage = target > 0 ? Math.round((forecast / target) * 100) : 0;

      return {
        id: c.id,
        name: c.name || "Sin nombre",
        forecast,
        target,
        coverage,
      };
    });
  }, [lineCampaigns, lineOpportunities]);

  function pipelineByStage() {
    return STAGES.map((stage) =>
      lineOpportunities
        .filter((o) => o.stage === stage)
        .reduce((s, o) => s + Number(o.amount || 0), 0)
    );
  }

  function forecastData() {
    const now = new Date();

    function inDays(days) {
      const limit = new Date();
      limit.setDate(now.getDate() + days);

      return lineOpportunities
        .filter((o) => {
          if (!o.expected_close) return false;
          const close = new Date(o.expected_close);
          return close <= limit && !["Ganado", "Perdido"].includes(o.stage);
        })
        .reduce(
          (s, o) =>
            s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100,
          0
        );
    }

    return [inDays(30), inDays(60), inDays(90)];
  }

  function activityByWeek() {
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie"];

    return days.map((_, i) =>
      lineVisits.filter((v) => {
        const d = new Date(v.visit_date);
        return d.getDay() === i + 1;
      }).length
    );
  }

  function productsMixData() {
    const labels = lineProducts.map((p) => p.name);

    const data = lineProducts.map((p) =>
      lineOpportunities
        .filter((o) => o.product_id === p.id)
        .reduce((s, o) => s + Number(o.amount || 0), 0)
    );

    return { labels, data };
  }

  function chartOptions({ yMoney = false } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => (yMoney ? money(ctx.raw) : ctx.raw),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#64748b",
            font: { size: 11, weight: "700" },
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#edf2f7" },
          ticks: {
            color: "#64748b",
            font: { size: 11, weight: "700" },
            callback: yMoney ? compactMoney : undefined,
          },
        },
      },
    };
  }

  function renderCharts() {
    const Chart = window.Chart;
    if (!Chart) return;

    [pipelineRef, forecastRef, activityRef, productsRef].forEach((ref) => {
      if (ref.current?.chartInstance) ref.current.chartInstance.destroy();
    });

    if (pipelineRef.current) {
      pipelineRef.current.chartInstance = new Chart(pipelineRef.current, {
        type: "bar",
        data: {
          labels: STAGES,
          datasets: [
            {
              label: "Pipeline",
              data: pipelineByStage(),
              backgroundColor: "#1677ff",
              borderRadius: 8,
              barPercentage: 0.65,
              categoryPercentage: 0.65,
            },
          ],
        },
        options: chartOptions({ yMoney: true }),
      });
    }

    if (forecastRef.current) {
      const ctx = forecastRef.current.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 0, 260);
      gradient.addColorStop(0, "rgba(22,119,255,0.25)");
      gradient.addColorStop(1, "rgba(22,119,255,0.02)");

      forecastRef.current.chartInstance = new Chart(forecastRef.current, {
        type: "line",
        data: {
          labels: ["30 días", "60 días", "90 días"],
          datasets: [
            {
              label: "Forecast",
              data: forecastData(),
              borderColor: "#1677ff",
              backgroundColor: gradient,
              fill: true,
              tension: 0.35,
              pointRadius: 4,
              pointBackgroundColor: "#1677ff",
            },
          ],
        },
        options: chartOptions({ yMoney: true }),
      });
    }

    if (activityRef.current) {
      activityRef.current.chartInstance = new Chart(activityRef.current, {
        type: "line",
        data: {
          labels: ["Lun", "Mar", "Mié", "Jue", "Vie"],
          datasets: [
            {
              label: "Visitas",
              data: activityByWeek(),
              borderColor: "#22c55e",
              backgroundColor: "rgba(34,197,94,0.12)",
              fill: true,
              tension: 0.35,
              pointRadius: 4,
              pointBackgroundColor: "#22c55e",
            },
          ],
        },
        options: chartOptions(),
      });
    }

    const mix = productsMixData();

    if (productsRef.current) {
      productsRef.current.chartInstance = new Chart(productsRef.current, {
        type: "bar",
        data: {
          labels: mix.labels.length ? mix.labels : ["Sin productos"],
          datasets: [
            {
              label: "Pipeline",
              data: mix.data.length ? mix.data : [0],
              backgroundColor: "#f59e0b",
              borderRadius: 8,
              barPercentage: 0.65,
              categoryPercentage: 0.65,
            },
          ],
        },
        options: chartOptions({ yMoney: true }),
      });
    }
  }

  if (loading) {
    return (
      <Layout title="Dashboard Línea" profile={profile} onNavigate={onNavigate}>
        <div className="line-loading">Cargando dashboard por línea...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard Línea" profile={profile} onNavigate={onNavigate}>
      <div className="line-dashboard">
        <section className="line-hero">
          <div>
            <h2>{selectedLine}</h2>
            <p>Vista comercial por línea de producto: pipeline, forecast, actividad y campañas.</p>
          </div>

          <div className="line-selector">
            <span>Línea</span>
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
            >
              {LINE_OPTIONS.map((line) => (
                <option key={line}>{line}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={`line-decision ${decision.tone}`}>
          <span>{decision.title}</span>
          <strong>{decision.text}</strong>
        </section>

        <section className="line-kpi-grid">
          <Kpi title="Pipeline abierto" value={money(metrics.pipeline)} />
          <Kpi title="Forecast ponderado" value={money(metrics.forecast)} />
          <Kpi title="Objetivo campañas" value={money(metrics.target)} />
          <Kpi title="Cobertura" value={`${metrics.coverage}%`} />
          <Kpi title="Oportunidades abiertas" value={metrics.openOpps} />
          <Kpi title="Productos cargados" value={metrics.products} />
          <Kpi title="Clientes activos" value={metrics.accounts} />
          <Kpi title="Visitas registradas" value={metrics.visits} />
          <Kpi title="Hot deals" value={metrics.hotDeals} />
          <Kpi title="Sin próxima acción" value={metrics.withoutNextAction} danger />
        </section>

        <section className="line-mid-grid">
          <CampaignTable rows={campaignRows} />
          <ListCard title="Productos / Share Kit">
            {lineProducts.length === 0 ? (
              <EmptyText text="No hay productos cargados para esta línea." />
            ) : (
              lineProducts.slice(0, 5).map((p) => (
                <ListItem
                  key={p.id}
                  title={p.name}
                  subtitle={p.speech ? "Speech cargado" : "Sin speech"}
                  right={p.brochure_url ? "Brochure" : "—"}
                />
              ))
            )}
          </ListCard>
        </section>

        <section className="line-chart-grid">
          <ChartCard title="Pipeline por etapa">
            <canvas ref={pipelineRef}></canvas>
          </ChartCard>

          <ChartCard title="Forecast 30 / 60 / 90 días">
            <canvas ref={forecastRef}></canvas>
          </ChartCard>

          <ChartCard title="Actividad semanal">
            <canvas ref={activityRef}></canvas>
          </ChartCard>

          <ChartCard title="Pipeline por producto">
            <canvas ref={productsRef}></canvas>
          </ChartCard>
        </section>

        <section className="line-list-grid">
          <ListCard title="Últimas oportunidades">
            {lineOpportunities.length === 0 ? (
              <EmptyText text="No hay oportunidades cargadas." />
            ) : (
              lineOpportunities.slice(0, 5).map((o) => (
                <ListItem
                  key={o.id}
                  title={o.name || "Sin nombre"}
                  subtitle={`${o.accounts?.name || "Sin cliente"} · ${o.stage || "Sin etapa"} · ${o.probability || 0}%`}
                  right={money(o.amount)}
                />
              ))
            )}
          </ListCard>

          <ListCard title="Últimas visitas">
            {lineVisits.length === 0 ? (
              <EmptyText text="No hay visitas cargadas." />
            ) : (
              lineVisits.slice(0, 5).map((v) => (
                <ListItem
                  key={v.id}
                  title={v.accounts?.name || "Sin cliente"}
                  subtitle={`${v.products?.name || "Sin producto"} · ${v.visit_type || "Sin tipo"}`}
                  right={
                    v.visit_date
                      ? new Date(v.visit_date).toLocaleDateString("es-AR")
                      : "—"
                  }
                />
              ))
            )}
          </ListCard>
        </section>
      </div>
    </Layout>
  );
}

function Kpi({ title, value, danger }) {
  return (
    <article className={`line-kpi ${danger ? "danger" : ""}`}>
      <span>{title}</span>
      <strong title={String(value)}>{value}</strong>
    </article>
  );
}

function CampaignTable({ rows }) {
  return (
    <article className="line-campaign-table">
      <h3>Campañas vs objetivo</h3>

      <div className="line-campaign-head">
        <span>Campaña</span>
        <span>Forecast</span>
        <span>Objetivo</span>
        <span>Cobertura</span>
      </div>

      {rows.length === 0 ? (
        <p className="line-empty">No hay campañas cargadas para esta línea.</p>
      ) : (
        rows.slice(0, 4).map((r) => (
          <div className="line-campaign-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <div className="line-progress-track">
                <div
                  style={{ width: `${Math.min(100, r.coverage)}%` }}
                  className={
                    r.coverage >= 80 ? "green" : r.coverage >= 50 ? "yellow" : "red"
                  }
                />
              </div>
            </div>
            <span>{money(r.forecast)}</span>
            <span>{money(r.target)}</span>
            <em
              className={
                r.coverage >= 80 ? "green" : r.coverage >= 50 ? "yellow" : "red"
              }
            >
              {r.coverage}%
            </em>
          </div>
        ))
      )}
    </article>
  );
}

function ChartCard({ title, children }) {
  return (
    <article className="line-chart-card">
      <div className="line-chart-head">
        <h3>{title}</h3>
      </div>
      <div className="line-chart-box">{children}</div>
    </article>
  );
}

function ListCard({ title, children }) {
  return (
    <article className="line-list-card">
      <h3>{title}</h3>
      <div>{children}</div>
    </article>
  );
}

function ListItem({ title, subtitle, right }) {
  return (
    <div className="line-list-item">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <em title={String(right)}>{right}</em>
    </div>
  );
}

function EmptyText({ text }) {
  return <p className="line-empty">{text}</p>;
}