import { useMemo, useState } from "react";
import Layout from "../components/Layout";
import { ModuleHeader } from "../components/CRMUI";
import "./settings.css";

const DEFAULTS = {
  density: "comfortable",
  calendarDefault: "list",
  executiveMode: "off",
  allowedDomain: "",
  accountTypes: "Hospital, Clínica, Sanatorio, Instituto, Obra social, Distribuidor, Otro",
  businessUnits: "EchoLaser, Osypka, Diálisis, Nutrición Clínica, VAC, Kangaroo",
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("crm_settings") || "{}") }; }
  catch { return DEFAULTS; }
}

export default function SettingsPage({ profile, onNavigate }) {
  const [settings, setSettings] = useState(loadSettings);
  const rows = useMemo(() => [
    { key: "density", label: "Densidad desktop", type: "select", options: [["comfortable","Cómoda"],["dense","Densa"]] },
    { key: "calendarDefault", label: "Vista calendario", type: "select", options: [["list","Lista"],["month","Mes"]] },
    { key: "executiveMode", label: "Modo gerencia", type: "select", options: [["off","Normal"],["on","Solo lectura ejecutiva"]] },
    { key: "allowedDomain", label: "Dominio permitido", placeholder: "ej: medicross.com.ar" },
    { key: "accountTypes", label: "Tipos de cuenta" },
    { key: "businessUnits", label: "Unidades de negocio" },
  ], []);

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
        <section className="settings-note">
          <strong>Siguiente paso natural</strong>
          <p>Cuando apliques el SQL de Supabase, estos parámetros pueden migrarse de localStorage a una tabla central para que sean compartidos por todos los usuarios.</p>
        </section>
      </div>
    </Layout>
  );
}
