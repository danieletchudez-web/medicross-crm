import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./settings.css";

const DEFAULTS = {
  density: "comfortable",
  calendarDefault: "list",
  executiveMode: "off",
  allowedDomain: "",
  accountTypes: "Hospital, Clínica, Sanatorio, Instituto, Obra social, Distribuidor, Otro",
  businessUnits: "EchoLaser, Osypka, Diálisis, Nutrición Clínica, VAC, Kangaroo",
};

const OPERATIONAL_DEFAULTS = {
  seller_without_visits_days: 5,
  high_potential_account_days: 30,
  opportunity_stale_days: 30,
  quote_expiration_days: 30,
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("crm_settings") || "{}") }; }
  catch { return DEFAULTS; }
}

export default function SettingsPage({ profile, onNavigate }) {
  const [settings, setSettings] = useState(loadSettings);
  const [operational, setOperational] = useState(OPERATIONAL_DEFAULTS);
  const [operationalStatus, setOperationalStatus] = useState("");
  const [savingOperational, setSavingOperational] = useState(false);
  const canWriteOperational = profile?.role === "super_admin";
  const rows = useMemo(() => [
    { key: "density", label: "Densidad desktop", type: "select", options: [["comfortable","Cómoda"],["dense","Densa"]] },
    { key: "calendarDefault", label: "Vista calendario", type: "select", options: [["list","Lista"],["month","Mes"]] },
    { key: "executiveMode", label: "Modo gerencia", type: "select", options: [["off","Normal"],["on","Solo lectura ejecutiva"]] },
    { key: "allowedDomain", label: "Dominio permitido", placeholder: "ej: medicross.com.ar" },
    { key: "accountTypes", label: "Tipos de cuenta" },
    { key: "businessUnits", label: "Unidades de negocio" },
  ], []);

  useEffect(() => { loadOperationalSettings(); }, []);

  async function loadOperationalSettings() {
    const { data, error } = await supabase
      .from("crm_settings")
      .select("key,value")
      .in("key", ["inactivity_thresholds", "quote_expiration_days"]);
    if (error) {
      setOperationalStatus("Aplicá el SQL operativo para compartir estos parámetros con el equipo.");
      return;
    }
    const values = Object.fromEntries((data || []).map(row => [row.key, row.value || {}]));
    setOperational({
      seller_without_visits_days: Number(values.inactivity_thresholds?.seller_without_visits_days ?? OPERATIONAL_DEFAULTS.seller_without_visits_days),
      high_potential_account_days: Number(values.inactivity_thresholds?.high_potential_account_days ?? OPERATIONAL_DEFAULTS.high_potential_account_days),
      opportunity_stale_days: Number(values.inactivity_thresholds?.opportunity_stale_days ?? OPERATIONAL_DEFAULTS.opportunity_stale_days),
      quote_expiration_days: Number(values.quote_expiration_days?.days ?? OPERATIONAL_DEFAULTS.quote_expiration_days),
    });
  }

  function updateOperational(key, value) {
    setOperational(prev => ({ ...prev, [key]: Number(value || 0) }));
    setOperationalStatus("");
  }

  async function saveOperationalSettings() {
    if (!canWriteOperational) return;
    setSavingOperational(true);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from("crm_settings").upsert([
      {
        key: "inactivity_thresholds",
        value: {
          seller_without_visits_days: operational.seller_without_visits_days,
          high_potential_account_days: operational.high_potential_account_days,
          opportunity_stale_days: operational.opportunity_stale_days,
        },
        updated_by: profile?.id || null,
        updated_at: updatedAt,
      },
      {
        key: "quote_expiration_days",
        value: { days: operational.quote_expiration_days },
        updated_by: profile?.id || null,
        updated_at: updatedAt,
      },
    ], { onConflict: "key" });
    setOperationalStatus(error ? `No se pudo guardar: ${error.message}` : "Parámetros operativos guardados.");
    setSavingOperational(false);
  }

  function update(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("crm_settings", JSON.stringify(next));
    document.documentElement.dataset.density = next.density;
  }

  return (
    <Layout title="Configuración" profile={profile} onNavigate={onNavigate}>
      <div className="settings-page">
        <ModuleHeader
          title="Configuración"
          subtitle="Parámetros visuales y operativos del CRM. Esta primera versión guarda preferencias locales."
        />
        <section className="settings-card">
          {rows.map(row => (
            <label key={row.key} className="settings-row">
              <span>{row.label}</span>
              {row.type === "select" ? (
                <select value={settings[row.key]} onChange={e => update(row.key, e.target.value)}>
                  {row.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              ) : (
                <input value={settings[row.key]} onChange={e => update(row.key, e.target.value)} placeholder={row.placeholder} />
              )}
            </label>
          ))}
        </section>
        <section className="settings-card">
          <div className="settings-section-head">
            <div>
              <h3>Umbrales operativos</h3>
              <p>Estos valores alimentan alertas del equipo y vencimientos automáticos.</p>
            </div>
            <button type="button" onClick={saveOperationalSettings} disabled={!canWriteOperational || savingOperational}>
              {savingOperational ? "Guardando..." : "Guardar parámetros"}
            </button>
          </div>
          <OperationalRow label="Vendedor sin visitas" value={operational.seller_without_visits_days} suffix="días" onChange={value => updateOperational("seller_without_visits_days", value)} disabled={!canWriteOperational} />
          <OperationalRow label="Cliente alto potencial sin contacto" value={operational.high_potential_account_days} suffix="días" onChange={value => updateOperational("high_potential_account_days", value)} disabled={!canWriteOperational} />
          <OperationalRow label="Oportunidad sin movimiento" value={operational.opportunity_stale_days} suffix="días" onChange={value => updateOperational("opportunity_stale_days", value)} disabled={!canWriteOperational} />
          <OperationalRow label="Cotización enviada sin respuesta" value={operational.quote_expiration_days} suffix="días" onChange={value => updateOperational("quote_expiration_days", value)} disabled={!canWriteOperational} />
          {operationalStatus && <p className="settings-status">{operationalStatus}</p>}
        </section>
        <section className="settings-note">
          <strong>Preferencias y control operativo</strong>
          <p>La primera sección conserva preferencias locales por dispositivo. Los umbrales operativos se comparten mediante Supabase y sólo un Super Admin puede modificarlos.</p>
        </section>
      </div>
    </Layout>
  );
}

function OperationalRow({ label, value, suffix, onChange, disabled }) {
  return (
    <label className="settings-row settings-row--numeric">
      <span>{label}</span>
      <div>
        <input type="number" min="1" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}
