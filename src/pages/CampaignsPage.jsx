import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./campaigns.css";

const EMPTY_FORM = {
  name: "",
  product_line: "EchoLaser",
  target_amount: "",
  forecast_manual: "",
  start_date: "",
  end_date: "",
  status: "activa",
  objective: "",
};

const LINES = [
  "EchoLaser",
  "Osypka",
  "Diálisis",
  "Nutrición Clínica",
  "VAC",
  "Kangaroo",
  "Infusión",
  "Cardiología",
  "Terapia Intensiva",
  "Urología",
  "Hemodinamia",
  "Cirugía",
  "Otro",
];

function money(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function CampaignsPage({ profile, onNavigate }) {
  const [campaigns, setCampaigns] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [campaignsRes, oppsRes] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("opportunities").select("*, accounts(name), products(name, line)"),
    ]);

    setCampaigns(campaignsRes.data || []);
    setOpportunities(oppsRes.data || []);
  }

  const enrichedCampaigns = useMemo(() => {
    return campaigns.map((campaign) => {
      const relatedOpps = opportunities.filter((o) => o.campaign_id === campaign.id);

      const openOpps = relatedOpps.filter(
        (o) => !["Ganado", "Perdido"].includes(o.stage)
      );

      const pipeline = openOpps.reduce(
        (sum, o) => sum + Number(o.amount || 0),
        0
      );

      const forecastOpps = openOpps.reduce(
        (sum, o) => sum + Number(o.forecast_amount || 0),
        0
      );

      // Usar forecast_manual si existe, sino usar el de oportunidades
      const forecast = Number(campaign.forecast_manual || 0) || forecastOpps;

      const target = Number(campaign.target_amount || 0);
      const coverage = target > 0 ? Math.round((forecast / target) * 100) : 0;

      return {
        ...campaign,
        pipeline,
        forecast,
        forecastOpps,
        target,
        coverage,
        opportunities: relatedOpps.length,
        openOpps: openOpps.length,
      };
    });
  }, [campaigns, opportunities]);

  const stats = useMemo(() => {
    const totalTarget   = enrichedCampaigns.reduce((s, c) => s + c.target, 0);
    const totalForecast = enrichedCampaigns.reduce((s, c) => s + c.forecast, 0);

    return {
      total:    campaigns.length,
      active:   campaigns.filter((c) => c.status === "activa").length,
      target:   totalTarget,
      forecast: totalForecast,
      coverage: totalTarget > 0 ? Math.round((totalForecast / totalTarget) * 100) : 0,
    };
  }, [campaigns, enrichedCampaigns]);

  async function saveCampaign(e) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      name:             form.name,
      product_line:     form.product_line,
      line:             form.product_line,
      target_amount:    Number(form.target_amount || 0),
      forecast_manual:  Number(form.forecast_manual || 0),
      start_date:       form.start_date || null,
      end_date:         form.end_date || null,
      status:           form.status,
      objective:        form.objective,
      owner_id:         profile?.id || null,
      updated_at:       new Date().toISOString(),
    };

    let result;

    if (editingId) {
      result = await supabase.from("campaigns").update(payload).eq("id", editingId);
    } else {
      result = await supabase.from("campaigns").insert([payload]);
    }

    if (result.error) {
      alert("Error guardando campaña: " + result.error.message);
      setLoading(false);
      return;
    }

    setForm(EMPTY_FORM);
    setEditingId(null);
    setLoading(false);
    loadData();
  }

  function editCampaign(campaign) {
    setEditingId(campaign.id);
    setForm({
      name:            campaign.name || "",
      product_line:    campaign.product_line || campaign.line || "EchoLaser",
      target_amount:   campaign.target_amount || "",
      forecast_manual: campaign.forecast_manual || "",
      start_date:      campaign.start_date || "",
      end_date:        campaign.end_date || "",
      status:          campaign.status || "activa",
      objective:       campaign.objective || "",
    });
  }

  async function deleteCampaign(campaign) {
    if (!confirm("¿Eliminar campaña?")) return;

    const { error } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", campaign.id);

    if (error) {
      alert("Error eliminando campaña: " + error.message);
      return;
    }

    loadData();
  }

  return (
    <Layout title="Campañas Comerciales" profile={profile} onNavigate={onNavigate}>
      <div className="campaigns-page">
        <section className="campaign-hero">
          <div>
            <h2>Campañas comerciales</h2>
            <p>
              Definí objetivos por línea de producto. El avance se mide con forecast manual de oportunidades vinculadas.
            </p>
          </div>
        </section>

        <section className="campaign-kpi-grid">
          <Kpi title="Campañas totales"     value={stats.total} />
          <Kpi title="Activas"              value={stats.active} />
          <Kpi title="Objetivo total"       value={money(stats.target)} />
          <Kpi title="Forecast manual total" value={money(stats.forecast)} />
          <Kpi title="Cobertura global"     value={`${stats.coverage}%`} />
        </section>

        <section className="campaign-form-card">
          <div className="campaign-section-head">
            <div>
              <h3>{editingId ? "Editar campaña" : "Nueva campaña"}</h3>
              <p>La campaña impacta automáticamente en el dashboard comercial.</p>
            </div>

            {editingId && (
              <button
                className="ghost-btn"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancelar edición
              </button>
            )}
          </div>

          <form className="campaign-form" onSubmit={saveCampaign}>
            <div>
              <label>Nombre de campaña</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: EchoLaser Urología Q3"
                required
              />
            </div>

            <div>
              <label>Línea de producto</label>
              <select
                value={form.product_line}
                onChange={(e) => setForm({ ...form, product_line: e.target.value })}
              >
                {LINES.map((line) => (
                  <option key={line}>{line}</option>
                ))}
              </select>
            </div>

            <div>
              <label>Objetivo económico ARS</label>
              <input
                type="number"
                value={form.target_amount}
                onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
                placeholder="150000000"
              />
            </div>

            <div>
              <label>Forecast manual ARS</label>
              <input
                type="number"
                value={form.forecast_manual}
                onChange={(e) => setForm({ ...form, forecast_manual: e.target.value })}
                placeholder="Ej: 120000000"
              />
            </div>

            <div>
              <label>Estado</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="activa">Activa</option>
                <option value="pausada">Pausada</option>
                <option value="finalizada">Finalizada</option>
              </select>
            </div>

            <div>
              <label>Inicio</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>

            <div>
              <label>Cierre</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>

            <div className="wide">
              <label>Objetivo comercial</label>
              <textarea
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                placeholder="Ej: abrir 5 cuentas nuevas, generar 3 demos y cerrar primera compra..."
              />
            </div>

            <button disabled={loading}>
              {loading ? "Guardando..." : editingId ? "Guardar cambios" : "Crear campaña"}
            </button>
          </form>
        </section>

        <section className="campaign-list-card">
          <div className="campaign-section-head">
            <div>
              <h3>Campañas cargadas</h3>
              <p>Seguimiento con forecast manual y oportunidades vinculadas.</p>
            </div>
          </div>

          {enrichedCampaigns.length === 0 ? (
            <p className="campaign-empty">No hay campañas cargadas todavía.</p>
          ) : (
            <div className="campaign-grid">
              {enrichedCampaigns.map((campaign) => (
                <article className="campaign-card" key={campaign.id}>
                  <div className="campaign-card-head">
                    <div>
                      <h4>{campaign.name}</h4>
                      <span>{campaign.product_line || campaign.line}</span>
                    </div>

                    <em className={`status ${campaign.status}`}>
                      {campaign.status}
                    </em>
                  </div>

                  <div className="campaign-progress-block">
                    <div className="progress-info">
                      <strong>{campaign.coverage}%</strong>
                      <span>cobertura</span>
                    </div>

                    <div className="campaign-progress">
                      <div
                        style={{ width: `${Math.min(100, campaign.coverage)}%` }}
                        className={
                          campaign.coverage >= 80
                            ? "green"
                            : campaign.coverage >= 50
                            ? "yellow"
                            : "red"
                        }
                      />
                    </div>
                  </div>

                  <div className="campaign-data-grid">
                    <div>
                      <span>Objetivo</span>
                      <strong>{money(campaign.target)}</strong>
                    </div>

                    <div>
                      <span>Forecast manual</span>
                      <strong style={{ color: campaign.forecast > 0 ? "#3b82f6" : undefined }}>
                        {money(campaign.forecast)}
                      </strong>
                    </div>

                    <div>
                      <span>Pipeline</span>
                      <strong>{money(campaign.pipeline)}</strong>
                    </div>

                    <div>
                      <span>Oportunidades</span>
                      <strong>{campaign.openOpps}</strong>
                    </div>
                  </div>

                  {campaign.objective && (
                    <p className="campaign-objective">{campaign.objective}</p>
                  )}

                  <div className="campaign-actions">
                    <button onClick={() => editCampaign(campaign)}>Editar</button>
                    <button className="danger" onClick={() => deleteCampaign(campaign)}>
                      Borrar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}

function Kpi({ title, value }) {
  return (
    <article className="campaign-kpi">
      <span>{title}</span>
      <strong title={String(value)}>{value}</strong>
    </article>
  );
}