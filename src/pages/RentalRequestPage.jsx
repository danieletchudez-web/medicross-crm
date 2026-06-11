import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./rentalRequest.css";

const TECHNOLOGIES = ["Farapulse", "EchoLaser", "Ecógrafo", "Fusión de imágenes", "Otro"];
const ROLES = ["Médico", "Secretaria", "Enfermería", "Compras", "Coordinador de quirófano", "Institución", "Otro"];
const SERVICES = ["Equipo", "Consumibles", "Especialista clínico", "Instrumentadora", "Ecógrafo", "Logística", "Traslado", "Otro"];

const EMPTY = {
  requester_name:"", requester_role:"", requester_phone:"", requester_email:"",
  institution:"", doctor_name:"",
  technology:"", procedure_type:"",
  requested_date:"", requested_time:"", location:"",
  services_requested:[], observations:"",
};

export default function RentalRequestPage() {
  const [form,     setForm]     = useState(EMPTY);
  const [saving,   setSaving]   = useState(false);
  const [submitted, setSubmitted] = useState(null); // case number after success
  const [error,    setError]    = useState("");

  const F = (k,v) => setForm(f=>({...f,[k]:v}));

  function toggleService(s) {
    setForm(f=>({
      ...f,
      services_requested: f.services_requested.includes(s)
        ? f.services_requested.filter(x=>x!==s)
        : [...f.services_requested, s],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.requester_name.trim()||!form.technology||!form.institution.trim()) {
      setError("Por favor completá: nombre del solicitante, tecnología requerida e institución.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const { data, error: err } = await supabase.from("rental_requests").insert({
        requester_name:    form.requester_name.trim(),
        requester_role:    form.requester_role,
        requester_phone:   form.requester_phone,
        requester_email:   form.requester_email,
        institution:       form.institution.trim(),
        doctor_name:       form.doctor_name,
        technology:        form.technology,
        procedure_type:    form.procedure_type,
        requested_date:    form.requested_date||null,
        requested_time:    form.requested_time||null,
        location:          form.location,
        services_requested: form.services_requested,
        observations:      form.observations,
      }).select("id").single();

      if (err) throw err;

      // Generate a case reference for the confirmation screen
      const ref = `REQ-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9000)+1000)}`;
      setSubmitted(ref);
    } catch (err) {
      setError("Error al enviar la solicitud. Intentá nuevamente o contactanos directamente.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="rr-page">
        <div className="rr-card rr-success-card">
          <div className="rr-success-icon">✓</div>
          <h2>¡Solicitud enviada!</h2>
          <p>Tu solicitud fue recibida. Un representante de Storing Insumos Médicos se pondrá en contacto a la brevedad.</p>
          <div className="rr-ref-box">
            <span className="rr-ref-label">Número de referencia</span>
            <span className="rr-ref-num">{submitted}</span>
          </div>
          <p style={{fontSize:13,color:"#64748b",marginTop:8}}>Guardá este número para hacer seguimiento de tu solicitud.</p>
          <button className="rr-btn-primary" onClick={()=>{setForm(EMPTY);setSubmitted(null);}}>Enviar otra solicitud</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rr-page">
      <div className="rr-card">
        {/* Header */}
        <div className="rr-header">
          <div className="rr-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#5b7cfa"/>
              <path d="M10 16h12M16 10v12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <div>
              <div className="rr-logo-name">Storing Insumos Médicos</div>
              <div className="rr-logo-sub">Solicitud de Equipamiento Médico</div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>

          {error&&(
            <div className="rr-error">{error}</div>
          )}

          {/* Solicitante */}
          <div className="rr-section">
            <div className="rr-section-title">Datos del solicitante</div>
            <div className="rr-grid-2">
              <div className="rr-field">
                <label>Nombre completo *</label>
                <input required value={form.requester_name} onChange={e=>F("requester_name",e.target.value)} placeholder="Dr. / Lic. Nombre Apellido"/>
              </div>
              <div className="rr-field">
                <label>Cargo / Rol</label>
                <select value={form.requester_role} onChange={e=>F("requester_role",e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="rr-field">
                <label>Teléfono / WhatsApp</label>
                <input type="tel" value={form.requester_phone} onChange={e=>F("requester_phone",e.target.value)} placeholder="+54 11 XXXX-XXXX"/>
              </div>
              <div className="rr-field">
                <label>Email</label>
                <input type="email" value={form.requester_email} onChange={e=>F("requester_email",e.target.value)} placeholder="nombre@hospital.com"/>
              </div>
            </div>
          </div>

          {/* Institución */}
          <div className="rr-section">
            <div className="rr-section-title">Institución y médico</div>
            <div className="rr-grid-2">
              <div className="rr-field">
                <label>Institución / Hospital *</label>
                <input required value={form.institution} onChange={e=>F("institution",e.target.value)} placeholder="Hospital Italiano de Buenos Aires"/>
              </div>
              <div className="rr-field">
                <label>Médico tratante</label>
                <input value={form.doctor_name} onChange={e=>F("doctor_name",e.target.value)} placeholder="Dr. Nombre Apellido"/>
              </div>
            </div>
          </div>

          {/* Tecnología */}
          <div className="rr-section">
            <div className="rr-section-title">Tecnología requerida *</div>
            <div className="rr-tech-grid">
              {TECHNOLOGIES.map(t=>(
                <label key={t} className={`rr-tech-option${form.technology===t?" active":""}`}>
                  <input type="radio" name="technology" value={t} checked={form.technology===t} onChange={()=>F("technology",t)}/>
                  {t}
                </label>
              ))}
            </div>
            <div className="rr-field" style={{marginTop:14}}>
              <label>Tipo de procedimiento</label>
              <input value={form.procedure_type} onChange={e=>F("procedure_type",e.target.value)} placeholder="Ablación, enucleación, mapeo, etc."/>
            </div>
          </div>

          {/* Fecha y lugar */}
          <div className="rr-section">
            <div className="rr-section-title">Fecha y lugar del procedimiento</div>
            <div className="rr-grid-2">
              <div className="rr-field">
                <label>Fecha tentativa</label>
                <input type="date" value={form.requested_date} onChange={e=>F("requested_date",e.target.value)}/>
              </div>
              <div className="rr-field">
                <label>Horario estimado</label>
                <input type="time" value={form.requested_time} onChange={e=>F("requested_time",e.target.value)}/>
              </div>
              <div className="rr-field rr-field--full">
                <label>Lugar del procedimiento</label>
                <input value={form.location} onChange={e=>F("location",e.target.value)} placeholder="Nombre del hospital, sala, quirófano"/>
              </div>
            </div>
          </div>

          {/* Servicios */}
          <div className="rr-section">
            <div className="rr-section-title">Servicios requeridos</div>
            <div className="rr-services-grid">
              {SERVICES.map(s=>(
                <label key={s} className={`rr-service-option${form.services_requested.includes(s)?" active":""}`}>
                  <input type="checkbox" checked={form.services_requested.includes(s)} onChange={()=>toggleService(s)}/>
                  {s}
                </label>
              ))}
            </div>
          </div>

          {/* Observaciones */}
          <div className="rr-section">
            <div className="rr-section-title">Observaciones</div>
            <div className="rr-field">
              <label>Información adicional</label>
              <textarea rows={4} value={form.observations} onChange={e=>F("observations",e.target.value)} placeholder="Requerimientos especiales, insumos adicionales, urgencia, contexto clínico…"/>
            </div>
          </div>

          <div className="rr-submit-row">
            <p className="rr-disclaimer">Al enviar esta solicitud, un representante se comunicará para confirmar disponibilidad y coordinar los detalles.</p>
            <button type="submit" className="rr-btn-primary" disabled={saving}>
              {saving?"Enviando solicitud…":"Enviar solicitud"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
