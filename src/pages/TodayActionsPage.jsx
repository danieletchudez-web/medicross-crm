import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import { buildTodayActions } from "../services/decisionEngine";
import "./todayActions.css";

function moneyARS(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function TodayActionsPage({ profile, onNavigate }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadActions(); }, []);

  async function loadActions() {
    setLoading(true);

    const [accountsRes, visitsRes, oppsRes, productsRes] = await Promise.all([
      supabase.from("accounts").select("*").order("name"),
      supabase.from("visits").select("*"),
      supabase.from("opportunities").select("*"),
      supabase.from("products").select("*"),
    ]);

    const result = buildTodayActions({
      accounts:     accountsRes.data || [],
      visits:       visitsRes.data   || [],
      opportunities: oppsRes.data    || [],
      products:     productsRes.data || [],
    });

    setActions(result);
    setLoading(false);
  }

  function shareProduct(product, accountName) {
    if (!product) {
      alert("Este cliente todavía no tiene producto sugerido.");
      return;
    }

    const text = `Hola, te comparto información sobre ${product.name}.

${product.speech || ""}

${product.brochure_url   ? `Brochure: ${product.brochure_url}`        : ""}
${product.tech_sheet_url ? `Ficha técnica: ${product.tech_sheet_url}` : ""}
${product.video_url      ? `Video: ${product.video_url}`              : ""}

Quedo atento para coordinar una presentación.`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  if (loading) {
    return (
      <Layout title="Acciones Hoy" profile={profile} onNavigate={onNavigate}>
        <div className="ta-loading"><div className="ta-loading__pulse" /><span>Cargando recomendaciones…</span></div>
      </Layout>
    );
  }

  const high   = actions.filter((a) => a.priority === "Alta").length;
  const medium = actions.filter((a) => a.priority === "Media").length;
  const cold   = actions.filter((a) => a.daysWithoutContact > 30).length;

  return (
    <Layout title="Acciones Hoy" profile={profile} onNavigate={onNavigate}>
      <div className="ta-page">

        {/* HEADER */}
        <header className="ta-header">
          <div className="ta-header__left">
            <p className="ta-header__eyebrow">STORING Medical · CRM</p>
            <h1 className="ta-header__title">Motor de decisión comercial</h1>
            <p className="ta-header__sub">Clientes priorizados por potencial, visitas, pipeline y días sin contacto.</p>
          </div>
          <div className="ta-kpis">
            <TaKpi label="Prioridad alta"        value={high}   accent="red" />
            <TaKpi label="Prioridad media"       value={medium} accent="amber" />
            <TaKpi label="+30 días sin contacto" value={cold}   accent="slate" />
          </div>
        </header>

        {/* GRID DE ACCIONES */}
        <section className="ta-grid">
          {actions.length === 0 ? (
            <div className="ta-empty">Todavía no hay clientes cargados.</div>
          ) : (
            actions.slice(0, 12).map((item) => (
              <article key={item.account.id} className={`ta-card ta-card--${item.priority.toLowerCase()}`}>

                {/* TOP */}
                <div className="ta-card__top">
                  <div className="ta-card__info">
                    <span className="ta-card__eyebrow">Cliente recomendado</span>
                    <h3 className="ta-card__name">{item.account.name}</h3>
                    <p className="ta-card__location">
                      {item.account.city || "—"} · {item.account.province || "—"} · Potencial {item.account.potential || "Medio"}
                    </p>
                  </div>
                  <div className="ta-score">
                    <span>Score</span>
                    <strong>{item.score}</strong>
                  </div>
                </div>

                {/* MÉTRICAS */}
                <div className="ta-metrics">
                  <TaMetric label="Prioridad"         value={item.priority} />
                  <TaMetric label="Días sin contacto" value={item.daysWithoutContact} />
                  <TaMetric label="Pipeline abierto"  value={moneyARS(item.openPipeline)} />
                  <TaMetric label="Producto sugerido" value={item.suggestedProduct?.name || "Sin producto"} />
                </div>

                {/* DECISIÓN */}
                <div className="ta-decision">
                  <span>Decisión sugerida</span>
                  <p>{item.reason}</p>
                </div>

                {/* BOTONES */}
                <div className="ta-actions">
                  <button
                    className="ta-btn ta-btn--primary"
                    onClick={() => shareProduct(item.suggestedProduct, item.account.name)}
                  >
                    Compartir Share Kit
                  </button>
                  <button
                    className="ta-btn ta-btn--secondary"
                    onClick={() => onNavigate("visits")}
                  >
                    Registrar visita
                  </button>
                </div>

              </article>
            ))
          )}
        </section>

      </div>
    </Layout>
  );
}

function TaKpi({ label, value, accent }) {
  return (
    <div className={`ta-kpi ta-kpi--${accent}`}>
      <span className="ta-kpi__label">{label}</span>
      <strong className="ta-kpi__value">{value}</strong>
    </div>
  );
}

function TaMetric({ label, value }) {
  return (
    <div className="ta-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}