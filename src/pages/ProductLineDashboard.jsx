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

    const [oppsRes, visitsRes, productsRes, campaignsRes] =
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

        supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      ]);

    setOpportunities(oppsRes.data || []);
    setVisits(visitsRes.data || []);
    setProducts(productsRes.data || []);
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
        <div className="p-page">
          <div className="p-panel">
            <div className="p-body p-empty">Cargando dashboard por línea...</div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard Línea" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* Top panel: line selector + KPI metrics strip */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">{selectedLine}</span>
              <span className="p-sub">Vista comercial por línea de producto</span>
            </div>
            <div className="p-hd-right">
              <select
                className="p-select"
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
              >
                {LINE_OPTIONS.map((line) => (
                  <option key={line}>{line}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline abierto</span>
              <span className="p-metric__val">{compactMoney(metrics.pipeline)}</span>
              <span className="p-metric__sub">{money(metrics.pipeline)}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast ponderado</span>
              <span className="p-metric__val">{compactMoney(metrics.forecast)}</span>
              <span className="p-metric__sub">{money(metrics.forecast)}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Objetivo campañas</span>
              <span className="p-metric__val">{compactMoney(metrics.target)}</span>
              <span className="p-metric__sub">{money(metrics.target)}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Cobertura</span>
              <span className={`p-metric__val ${metrics.coverage >= 80 ? "p-metric__up" : metrics.coverage >= 50 ? "" : "p-metric__down"}`}>{metrics.coverage}%</span>
              <span className="p-metric__sub">vs objetivo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Opps abiertas</span>
              <span className="p-metric__val">{metrics.openOpps}</span>
              <span className="p-metric__sub">oportunidades</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Hot deals</span>
              <span className={`p-metric__val ${metrics.hotDeals > 0 ? "p-metric__up" : ""}`}>{metrics.hotDeals}</span>
              <span className="p-metric__sub">prob. &ge; 70%</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Clientes activos</span>
              <span className="p-metric__val">{metrics.accounts}</span>
              <span className="p-metric__sub">cuentas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Visitas</span>
              <span className="p-metric__val">{metrics.visits}</span>
              <span className="p-metric__sub">registradas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Sin prox. acción</span>
              <span className={`p-metric__val ${metrics.withoutNextAction > 0 ? "p-metric__down" : ""}`}>{metrics.withoutNextAction}</span>
              <span className="p-metric__sub">pendientes</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Productos</span>
              <span className="p-metric__val">{metrics.products}</span>
              <span className="p-metric__sub">cargados</span>
            </div>
          </div>

          {/* Decision alert */}
          <div className="p-toolbar">
            <span className={`p-badge--${decision.tone === "danger" ? "red" : decision.tone === "warning" ? "amber" : decision.tone === "success" ? "green" : "gray"}`}>{decision.title}</span>
            <span className="p-sub" style={{ marginLeft: 10 }}>{decision.text}</span>
          </div>
        </div>

        {/* Charts row 1: Pipeline by stage + Forecast */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Pipeline por etapa</span>
              </div>
            </div>
            <div className="p-chart">
              <canvas ref={pipelineRef}></canvas>
            </div>
          </div>

          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Forecast 30 / 60 / 90 días</span>
              </div>
            </div>
            <div className="p-chart">
              <canvas ref={forecastRef}></canvas>
            </div>
          </div>
        </div>

        {/* Charts row 2: Activity + Products mix */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Actividad semanal</span>
              </div>
            </div>
            <div className="p-chart">
              <canvas ref={activityRef}></canvas>
            </div>
          </div>

          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Pipeline por producto</span>
              </div>
            </div>
            <div className="p-chart">
              <canvas ref={productsRef}></canvas>
            </div>
          </div>
        </div>

        {/* Campaigns + Products list */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14 }}>
          {/* Campaigns panel */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Campañas vs objetivo</span>
                <span className="p-sub">{campaignRows.length} campañas</span>
              </div>
            </div>
            {campaignRows.length === 0 ? (
              <div className="p-body p-empty">No hay campañas cargadas para esta línea.</div>
            ) : (
              <div className="p-table-wrap">
                <table className="p-table">
                  <thead>
                    <tr>
                      <th>Campaña</th>
                      <th>Forecast</th>
                      <th>Objetivo</th>
                      <th>Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.slice(0, 4).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div>{r.name}</div>
                          <div className="p-progress" style={{ marginTop: 4 }}>
                            <div
                              className={`p-progress-fill ${r.coverage >= 80 ? "p-progress-fill--green" : r.coverage >= 50 ? "p-progress-fill--amber" : "p-progress-fill--red"}`}
                              style={{ width: `${Math.min(100, r.coverage)}%` }}
                            />
                          </div>
                        </td>
                        <td>{money(r.forecast)}</td>
                        <td>{money(r.target)}</td>
                        <td>
                          <span className={`p-badge--${r.coverage >= 80 ? "green" : r.coverage >= 50 ? "amber" : "red"}`}>{r.coverage}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Products list panel */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Productos / Share Kit</span>
                <span className="p-sub">{lineProducts.length} productos</span>
              </div>
            </div>
            {lineProducts.length === 0 ? (
              <div className="p-body p-empty">No hay productos cargados para esta línea.</div>
            ) : (
              <div className="p-list">
                {lineProducts.slice(0, 5).map((p, i) => (
                  <div className="p-row" key={p.id}>
                    <span className="p-row__rank">{i + 1}</span>
                    <div className="p-row__main">
                      <div className="p-row__name">{p.name}</div>
                      <div className="p-row__sub">{p.speech ? "Speech cargado" : "Sin speech"}</div>
                    </div>
                    <div className="p-row__val">{p.brochure_url ? "Brochure" : "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Opportunities + Visits lists */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Latest opportunities */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Últimas oportunidades</span>
                <span className="p-sub">{lineOpportunities.length} total</span>
              </div>
            </div>
            {lineOpportunities.length === 0 ? (
              <div className="p-body p-empty">No hay oportunidades cargadas.</div>
            ) : (
              <div className="p-list">
                {lineOpportunities.slice(0, 5).map((o) => (
                  <div className="p-row" key={o.id}>
                    <div className="p-row__main">
                      <div className="p-row__name">{o.name || "Sin nombre"}</div>
                      <div className="p-row__sub">{o.accounts?.name || "Sin cliente"} · {o.stage || "Sin etapa"} · {o.probability || 0}%</div>
                    </div>
                    <div className="p-row__val">{money(o.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Latest visits */}
          <div className="p-panel">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">Últimas visitas</span>
                <span className="p-sub">{lineVisits.length} total</span>
              </div>
            </div>
            {lineVisits.length === 0 ? (
              <div className="p-body p-empty">No hay visitas cargadas.</div>
            ) : (
              <div className="p-list">
                {lineVisits.slice(0, 5).map((v) => (
                  <div className="p-row" key={v.id}>
                    <div className="p-row__main">
                      <div className="p-row__name">{v.accounts?.name || "Sin cliente"}</div>
                      <div className="p-row__sub">{v.products?.name || "Sin producto"} · {v.visit_type || "Sin tipo"}</div>
                    </div>
                    <div className="p-row__val">
                      {v.visit_date
                        ? new Date(v.visit_date).toLocaleDateString("es-AR")
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
