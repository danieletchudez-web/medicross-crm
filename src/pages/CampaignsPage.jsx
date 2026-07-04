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
      <div className="p-page p-page--2col">

        {/* LEFT — Campaign list panel */}
        <div className="p-panel p-panel--grow">

          {/* Metrics strip */}
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Campañas</span>
              <span className="p-metric__val">{stats.total}</span>
              <span className="p-metric__sub">total</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Activas</span>
              <span className="p-metric__val">{stats.active}</span>
              <span className="p-metric__sub">en curso</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Objetivo</span>
              <span className="p-metric__val">{money(stats.target)}</span>
              <span className="p-metric__sub">total</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast</span>
              <span className="p-metric__val">{money(stats.forecast)}</span>
              <span className="p-metric__sub">manual total</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Cobertura</span>
              <span className="p-metric__val">{stats.coverage}%</span>
              <span className="p-metric__sub">global</span>
            </div>
          </div>

          {/* Panel header */}
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Campañas</span>
              <span className="p-sub">Seguimiento con forecast manual y oportunidades vinculadas</span>
            </div>
          </div>

          {/* Campaign list */}
          <div className="p-list">
            {enrichedCampaigns.length === 0 ? (
              <div className="p-empty">No hay campañas cargadas todavía.</div>
            ) : (
              enrichedCampaigns.map((campaign) => (
                <div className="p-row" key={campaign.id}>
                  <div className="p-row__main">
                    <div className="p-row__name">{campaign.name}</div>
                    <div className="p-row__sub">
                      {campaign.product_line || campaign.line}
                      {campaign.start_date && ` · ${campaign.start_date}`}
                      {campaign.end_date && ` — ${campaign.end_date}`}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <div className="p-progress" style={{ width: 180 }}>
                        <div
                          className={
                            campaign.coverage >= 80
                              ? "p-progress-fill p-progress-fill--green"
                              : campaign.coverage >= 50
                              ? "p-progress-fill p-progress-fill--amber"
                              : "p-progress-fill p-progress-fill--red"
                          }
                          style={{ width: `${Math.min(100, campaign.coverage)}%` }}
                        />
                      </div>
                      <span className="p-row__sub" style={{ marginTop: 2, display: "block" }}>
                        {campaign.coverage}% · Forecast: {money(campaign.forecast)} · Pipeline: {money(campaign.pipeline)} · {campaign.openOpps} opps
                      </span>
                    </div>
                  </div>
                  <div className="p-row__meta">
                    <span
                      className={
                        campaign.status === "activa"
                          ? "p-badge--green"
                          : campaign.status === "finalizada"
                          ? "p-badge--red"
                          : "p-badge--gray"
                      }
                    >
                      {campaign.status}
                    </span>
                    <div className="p-row__actions" style={{ marginTop: 6 }}>
                      <button className="p-btn p-btn--ghost" onClick={() => editCampaign(campaign)}>
                        Editar
                      </button>
                      <button className="p-btn p-btn--danger" onClick={() => deleteCampaign(campaign)}>
                        Borrar
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT — Form panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">{editingId ? "Editar campaña" : "Nueva campaña"}</span>
              <span className="p-sub">La campaña impacta automáticamente en el dashboard comercial</span>
            </div>
            {editingId && (
              <div className="p-hd-right">
                <button
                  className="p-btn p-btn--ghost"
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY_FORM);
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="p-body">
            <form className="p-form p-form--2col" onSubmit={saveCampaign}>
              <div className="p-field p-field--span2">
                <label>Nombre de campaña</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: EchoLaser Urología Q3"
                  required
                />
              </div>

              <div className="p-field">
                <label>Línea de producto</label>
                <select
                  className="p-select"
                  value={form.product_line}
                  onChange={(e) => setForm({ ...form, product_line: e.target.value })}
                >
                  {LINES.map((line) => (
                    <option key={line}>{line}</option>
                  ))}
                </select>
              </div>

              <div className="p-field">
                <label>Estado</label>
                <select
                  className="p-select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="activa">Activa</option>
                  <option value="pausada">Pausada</option>
                  <option value="finalizada">Finalizada</option>
                </select>
              </div>

              <div className="p-field">
                <label>Objetivo económico ARS</label>
                <input
                  type="number"
                  value={form.target_amount}
                  onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
                  placeholder="150000000"
                />
              </div>

              <div className="p-field">
                <label>Forecast manual ARS</label>
                <input
                  type="number"
                  value={form.forecast_manual}
                  onChange={(e) => setForm({ ...form, forecast_manual: e.target.value })}
                  placeholder="Ej: 120000000"
                />
              </div>

              <div className="p-field">
                <label>Inicio</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>

              <div className="p-field">
                <label>Cierre</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>

              <div className="p-field p-field--span2">
                <label>Objetivo comercial</label>
                <textarea
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                  placeholder="Ej: abrir 5 cuentas nuevas, generar 3 demos y cerrar primera compra..."
                />
              </div>

              <div className="p-form-actions p-field--span2">
                <button className="p-btn p-btn--primary" disabled={loading}>
                  {loading ? "Guardando..." : editingId ? "Guardar cambios" : "Crear campaña"}
                </button>
              </div>
            </form>
          </div>
        </div>

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
