import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./VoiceAssistant.css";

/* ─── NLP ────────────────────────────────────────────────────────────── */
const ACTION_MAP = {
  task:        ["tarea","hacer","coordinar","preparar","enviar","organizar","gestionar","agendar","completar"],
  note:        ["nota","anotar","registrar","documentar","apuntar","transcribir"],
  reminder:    ["recordar","recordatorio","no olvidar","avisar","alertar","acordarme"],
  visit:       ["visita","ir a","visitar","reunión","reunirme","presentarme","pasar por"],
  opportunity: ["oportunidad","propuesta","cotización","presupuesto","oferta","licitación"],
  follow_up:   ["seguimiento","seguir","chequear","revisar","avanzar","confirmar","hacer seguimiento"],
};

const ACTION_LABELS = {
  task:        "Tarea",
  note:        "Nota de visita",
  reminder:    "Recordatorio",
  visit:       "Visita pendiente",
  opportunity: "Oportunidad",
  follow_up:   "Seguimiento",
};

const DOW_ES = { lunes:1, martes:2, "miércoles":3, "jueves":4, "viernes":5, "sábado":6, "domingo":0 };
const NUM_ES = { un:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, diez:10, quince:15 };

function detectActionType(text) {
  const l = text.toLowerCase();
  for (const [type, kw] of Object.entries(ACTION_MAP)) {
    if (kw.some(k => l.includes(k))) return type;
  }
  return "task";
}

function detectPriority(text) {
  const l = text.toLowerCase();
  if (["urgente","urgentemente","prioridad alta","alta prioridad","importante","crítico"].some(k => l.includes(k))) return "alta";
  if (["prioridad baja","baja prioridad","sin urgencia","cuando pueda"].some(k => l.includes(k))) return "baja";
  return "media";
}

function detectDate(text) {
  const l = text.toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);
  if (l.includes("hoy")) return today;
  if (l.includes("mañana")) return new Date(today.getTime() + 86400000);
  if (["próxima semana","semana próxima","semana que viene"].some(k => l.includes(k))) {
    const d = new Date(today); d.setDate(today.getDate() + 7); return d;
  }
  const m = l.match(/en\s+(\w+)\s+días?/);
  if (m) {
    const n = parseInt(m[1]) || NUM_ES[m[1]] || 0;
    if (n > 0) return new Date(today.getTime() + n * 86400000);
  }
  for (const [name, dow] of Object.entries(DOW_ES)) {
    if (l.includes(name)) {
      const cur = today.getDay();
      let diff = (dow - cur + 7) % 7; if (!diff) diff = 7;
      return new Date(today.getTime() + diff * 86400000);
    }
  }
  return null;
}

function detectContact(text) {
  const patterns = [
    /\b(?:dr\.?|dra\.?|doctor(?:a)?|prof\.?|ing\.?|lic\.?)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/g,
    /\bcontacto\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/g,
  ];
  for (const p of patterns) {
    const hits = [...text.matchAll(p)];
    if (hits.length) return hits[0][0].trim();
  }
  return "";
}

function detectAccount(text, accounts) {
  const l = text.toLowerCase();
  const sorted = [...accounts].sort((a,b) => (b.name||"").length - (a.name||"").length);
  return sorted.find(a => a.name && l.includes(a.name.toLowerCase())) || null;
}

function detectProject(text) {
  const m = text.match(/(?:proyecto|línea|producto|programa|línea comercial)\s+([^,.]+)/i);
  return m ? m[1].trim() : "";
}

function toInputDate(d) { return d ? d.toISOString().split("T")[0] : ""; }

function parseText(text, accounts) {
  const account = detectAccount(text, accounts);
  return {
    transcript: text,
    actionType: detectActionType(text),
    priority:   detectPriority(text),
    date:       detectDate(text),
    account,
    accountId:    account?.id   || "",
    accountName:  account?.name || "",
    contactName:  detectContact(text),
    project:      detectProject(text),
    description:  text,
  };
}

/* ─── Storage ────────────────────────────────────────────────────────── */
const STORE = (uid) => `crm_voice_${uid || "anon"}`;

function readCaptures(uid) {
  try { return JSON.parse(localStorage.getItem(STORE(uid)) || "[]"); } catch { return []; }
}
function writeCaptures(uid, list) {
  localStorage.setItem(STORE(uid), JSON.stringify(list));
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function VoiceAssistant({ profile }) {
  const [uiState,     setUiState]     = useState("idle");
  const [transcript,  setTranscript]  = useState("");
  const [interim,     setInterim]     = useState("");
  const [form,        setForm]        = useState(null);
  const [captures,    setCaptures]    = useState([]);
  const [pendingCnt,  setPendingCnt]  = useState(0);
  const [accounts,    setAccounts]    = useState([]);
  const [supported,   setSupported]   = useState(true);
  const [err,         setErr]         = useState("");
  const [manualMode,  setManualMode]  = useState(false);

  const recRef     = useRef(null);
  const timerRef   = useRef(null);
  const txRef      = useRef("");          // accumulate final transcript
  const accsLoaded = useRef(false);

  const uid = profile?.id;

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) setSupported(false);
    refreshCaptures();
  }, [uid]);

  function refreshCaptures() {
    const all = readCaptures(uid);
    const pending = all.filter(c => c.status === "pending");
    setCaptures(pending);
    setPendingCnt(pending.length);
  }

  async function loadAccounts() {
    if (accsLoaded.current) return;
    const { data } = await supabase.from("accounts").select("id, name, city, contacts");
    if (data) { setAccounts(data); accsLoaded.current = true; }
  }

  /* ── Recording ── */
  function startRecording() {
    loadAccounts();
    setErr("");
    setTranscript("");
    setInterim("");
    txRef.current = "";
    setUiState("listening");

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "es-AR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;

    rec.onresult = (e) => {
      let intr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { txRef.current += t + " "; setTranscript(txRef.current); }
        else intr += t;
      }
      setInterim(intr);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech") { stopRecording(); return; }
      setErr("Error al grabar: " + e.error);
      setUiState("idle");
    };

    rec.onend = () => setInterim("");
    rec.start();
    timerRef.current = setTimeout(stopRecording, 90_000);
  }

  function stopRecording() {
    recRef.current?.stop(); recRef.current = null;
    clearTimeout(timerRef.current);
    setInterim("");
    setUiState("processing");
    const text = txRef.current.trim();
    setTimeout(() => {
      if (!text) { setUiState("idle"); return; }
      const p = parseText(text, accounts);
      setForm({
        transcript:  p.transcript,
        actionType:  p.actionType,
        priority:    p.priority,
        date:        toInputDate(p.date),
        accountId:   p.accountId,
        accountName: p.accountName,
        contactName: p.contactName,
        project:     p.project,
        description: p.description,
      });
      setUiState("confirm");
    }, 500);
  }

  function openManual() {
    loadAccounts();
    setManualMode(true);
    setErr("");
    txRef.current = "";
    setTranscript("");
    setForm({
      transcript:"", actionType:"task", priority:"media",
      date:"", accountId:"", accountName:"", contactName:"",
      project:"", description:"",
    });
    setUiState("confirm");
  }

  /* ── Save ── */
  async function saveConfirmed() {
    setUiState("saving");
    try {
      const payload = {
        owner_id:            uid,
        account_id:          form.accountId || null,
        visit_date:          form.date || new Date().toISOString().split("T")[0],
        status:              form.actionType === "visit" ? "planificada" : "completada",
        visit_type:          form.actionType === "opportunity" ? "comercial" : "seguimiento",
        commercial_potential: form.priority === "alta" ? "alto" : form.priority === "baja" ? "bajo" : "medio",
      };
      // Try to include notes field — Supabase silently ignores unknown columns (it won't; catch it)
      let { error: e1 } = await supabase.from("visits").insert([{
        ...payload,
        notes: buildNotes(form),
      }]);
      if (e1) {
        // Retry without notes in case column doesn't exist
        const { error: e2 } = await supabase.from("visits").insert([payload]);
        if (e2) throw e2;
      }
      // Best-effort: try voice_captures table
      try {
        await supabase.from("voice_captures").insert([{
          owner_id:           uid,
          transcript:         form.transcript,
          parsed_account_id:  form.accountId || null,
          parsed_account_name:form.accountName,
          parsed_contact_name:form.contactName,
          parsed_action_type: form.actionType,
          parsed_date:        form.date || null,
          parsed_priority:    form.priority,
          parsed_project:     form.project,
          parsed_description: form.description,
          status:             "confirmed",
        }]);
      } catch { /* table optional */ }
      setUiState("success");
    } catch (ex) {
      setErr("Error al guardar: " + ex.message);
      setUiState("confirm");
    }
  }

  function saveAsDraft() {
    const all = readCaptures(uid);
    all.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...form,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    writeCaptures(uid, all);
    refreshCaptures();
    setUiState("success");
  }

  function resolveCapture(id) {
    const all = readCaptures(uid).map(c => c.id === id ? { ...c, status: "resolved" } : c);
    writeCaptures(uid, all); refreshCaptures();
  }
  function discardCapture(id) {
    const all = readCaptures(uid).map(c => c.id === id ? { ...c, status: "discarded" } : c);
    writeCaptures(uid, all); refreshCaptures();
  }

  function buildNotes(f) {
    return [
      `[CAPTURA DE VOZ]`,
      f.contactName && `Contacto: ${f.contactName}`,
      f.project     && `Proyecto: ${f.project}`,
      `Prioridad: ${f.priority}`,
      `Descripción: ${f.description}`,
    ].filter(Boolean).join("\n");
  }

  function close() {
    recRef.current?.stop(); recRef.current = null;
    clearTimeout(timerRef.current);
    setUiState("idle");
    setErr("");
    setManualMode(false);
    txRef.current = "";
    setTranscript(""); setInterim("");
  }

  const pf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  /* ── Render ── */
  return (
    <>
      {/* FAB */}
      <button
        className={`va-fab${uiState !== "idle" ? " va-fab--open" : ""}${pendingCnt > 0 ? " va-fab--pending" : ""}`}
        onClick={() => uiState === "idle" ? (supported ? startRecording() : openManual()) : undefined}
        aria-label="Asistente de voz"
        title="Asistente comercial de voz"
      >
        <MicIcon />
        {pendingCnt > 0 && <span className="va-fab__badge">{pendingCnt}</span>}
      </button>

      {/* Modal */}
      {uiState !== "idle" && (
        <div className="va-overlay" onClick={e => e.target === e.currentTarget && close()}>
          <div className="va-sheet" role="dialog" aria-modal="true">

            {/* Header */}
            <div className="va-sheet__header">
              <div className="va-sheet__drag"/>
              <div className="va-sheet__titlerow">
                <span className="va-sheet__title">
                  {uiState === "listening" && "Escuchando…"}
                  {uiState === "processing" && "Procesando…"}
                  {uiState === "confirm"   && (manualMode ? "Nueva captura manual" : "Confirmar captura")}
                  {uiState === "saving"    && "Guardando…"}
                  {uiState === "success"   && "¡Guardado!"}
                  {uiState === "captures"  && "Capturas pendientes"}
                </span>
                <div className="va-sheet__actions">
                  {uiState !== "captures" && (
                    <button className="va-chip-btn" onClick={() => setUiState("captures")}>
                      Pendientes {pendingCnt > 0 && <span className="va-cnt">{pendingCnt}</span>}
                    </button>
                  )}
                  <button className="va-icon-btn" onClick={close} aria-label="Cerrar">✕</button>
                </div>
              </div>
            </div>

            {/* ── LISTENING ── */}
            {uiState === "listening" && (
              <div className="va-body va-body--center">
                <div className="va-mic-anim">
                  <span className="va-ring va-ring--1"/>
                  <span className="va-ring va-ring--2"/>
                  <span className="va-ring va-ring--3"/>
                  <MicIcon className="va-mic-live"/>
                </div>
                <p className="va-hint">Hablá claramente en español.<br/>Tocá <strong>Detener</strong> cuando termines.</p>
                {(transcript || interim) && (
                  <div className="va-live-tx">
                    <span className="va-live-tx__label">Transcripción en vivo</span>
                    <p>{transcript}<span className="va-interim">{interim}</span></p>
                  </div>
                )}
                <button className="va-btn va-btn--stop" onClick={stopRecording}>
                  <StopIcon /> Detener
                </button>
                <button className="va-text-btn" onClick={openManual}>Escribir manualmente</button>
              </div>
            )}

            {/* ── PROCESSING / SAVING ── */}
            {(uiState === "processing" || uiState === "saving") && (
              <div className="va-body va-body--center">
                <div className="va-spinner"/>
                <p className="va-hint">{uiState === "processing" ? "Interpretando instrucción…" : "Guardando en el CRM…"}</p>
              </div>
            )}

            {/* ── SUCCESS ── */}
            {uiState === "success" && (
              <div className="va-body va-body--center">
                <div className="va-success-icon">✓</div>
                <p className="va-success-text">Captura registrada correctamente</p>
                <div className="va-btn-col">
                  <button className="va-btn va-btn--primary" onClick={supported ? startRecording : openManual}>
                    Nueva captura
                  </button>
                  <button className="va-btn va-btn--ghost" onClick={close}>Cerrar</button>
                </div>
              </div>
            )}

            {/* ── CONFIRM FORM ── */}
            {uiState === "confirm" && form && (
              <div className="va-body va-form">
                {err && <div className="va-error">{err}</div>}

                {!manualMode && (
                  <div className="va-field-group">
                    <label className="va-field-label">Transcripción original</label>
                    <textarea
                      className="va-textarea"
                      rows={3}
                      value={form.transcript}
                      onChange={e => pf("transcript", e.target.value)}
                    />
                  </div>
                )}

                {manualMode && (
                  <div className="va-field-group">
                    <label className="va-field-label">Descripción de la acción</label>
                    <textarea
                      className="va-textarea"
                      rows={3}
                      placeholder="Ej: Coordinar jornada de capacitación de curado de heridas con Dr. Campos..."
                      value={form.description}
                      onChange={e => { pf("description", e.target.value); pf("transcript", e.target.value); }}
                    />
                  </div>
                )}

                <div className="va-field-group">
                  <label className="va-field-label">Tipo de acción</label>
                  <div className="va-type-pills">
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <button
                        key={k}
                        className={`va-pill${form.actionType === k ? " va-pill--active" : ""}`}
                        onClick={() => pf("actionType", k)}
                      >{v}</button>
                    ))}
                  </div>
                </div>

                <div className="va-field-row">
                  <div className="va-field-group">
                    <label className="va-field-label">Cliente / Institución</label>
                    <input
                      className="va-input"
                      value={form.accountName}
                      onChange={e => { pf("accountName", e.target.value); pf("accountId", ""); }}
                      placeholder="Ej: Hospital Italiano"
                      list="va-acc-list"
                    />
                    <datalist id="va-acc-list">
                      {accounts.map(a => <option key={a.id} value={a.name}/>)}
                    </datalist>
                  </div>
                  <div className="va-field-group">
                    <label className="va-field-label">Contacto</label>
                    <input
                      className="va-input"
                      value={form.contactName}
                      onChange={e => pf("contactName", e.target.value)}
                      placeholder="Ej: Dr. Campos"
                    />
                  </div>
                </div>

                <div className="va-field-row">
                  <div className="va-field-group">
                    <label className="va-field-label">Proyecto / Línea</label>
                    <input
                      className="va-input"
                      value={form.project}
                      onChange={e => pf("project", e.target.value)}
                      placeholder="Ej: Curado de Heridas"
                    />
                  </div>
                  <div className="va-field-group">
                    <label className="va-field-label">Seguimiento</label>
                    <input
                      type="date"
                      className="va-input"
                      value={form.date}
                      onChange={e => pf("date", e.target.value)}
                    />
                  </div>
                </div>

                <div className="va-field-group">
                  <label className="va-field-label">Prioridad</label>
                  <div className="va-priority-pills">
                    {[["alta","Alta","va-pill--red"],["media","Media","va-pill--amber"],["baja","Baja","va-pill--green"]].map(([k,v,cls]) => (
                      <button
                        key={k}
                        className={`va-pill ${cls}${form.priority === k ? " va-pill--active" : ""}`}
                        onClick={() => pf("priority", k)}
                      >{v}</button>
                    ))}
                  </div>
                </div>

                {!manualMode && (
                  <div className="va-field-group">
                    <label className="va-field-label">Descripción (editable)</label>
                    <textarea
                      className="va-textarea va-textarea--sm"
                      rows={2}
                      value={form.description}
                      onChange={e => pf("description", e.target.value)}
                    />
                  </div>
                )}

                {/* Parsed detection hints */}
                {(form.accountName || form.contactName || form.date) && (
                  <div className="va-parsed-hints">
                    <span className="va-parsed-label">Detectado automáticamente:</span>
                    {form.accountName && <span className="va-hint-tag va-hint-tag--blue">📍 {form.accountName}</span>}
                    {form.contactName && <span className="va-hint-tag va-hint-tag--violet">👤 {form.contactName}</span>}
                    {form.date       && <span className="va-hint-tag va-hint-tag--green">📅 {new Date(form.date + "T12:00").toLocaleDateString("es-AR", { day:"numeric", month:"short" })}</span>}
                    {form.priority === "alta" && <span className="va-hint-tag va-hint-tag--red">⚡ Alta prioridad</span>}
                  </div>
                )}

                <div className="va-action-row">
                  <button className="va-btn va-btn--primary" onClick={saveConfirmed}>
                    Guardar en CRM
                  </button>
                  <button className="va-btn va-btn--outline" onClick={saveAsDraft}>
                    Borrador
                  </button>
                  {supported && !manualMode && (
                    <button className="va-btn va-btn--ghost" onClick={startRecording} title="Repetir grabación">
                      <MicIcon />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── CAPTURES ── */}
            {uiState === "captures" && (
              <div className="va-body va-captures">
                {captures.length === 0 ? (
                  <div className="va-empty-captures">
                    <span className="va-empty-icon">✓</span>
                    <p>Sin capturas pendientes</p>
                    <button className="va-btn va-btn--primary" onClick={supported ? startRecording : openManual}>
                      Nueva captura
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="va-captures-subtitle">
                      {captures.length} captura{captures.length > 1 ? "s" : ""} sin asignar al CRM
                    </p>
                    {captures.map(c => (
                      <div key={c.id} className="va-capture-card">
                        <div className="va-capture-card__top">
                          <span className={`va-dot va-dot--${c.priority}`}/>
                          <span className="va-capture-card__type">{ACTION_LABELS[c.actionType] || c.actionType}</span>
                          <span className="va-capture-card__time">
                            {new Date(c.createdAt).toLocaleDateString("es-AR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
                          </span>
                        </div>
                        {c.accountName  && <div className="va-capture-card__acc">{c.accountName}</div>}
                        {c.contactName  && <div className="va-capture-card__contact">{c.contactName}</div>}
                        <p className="va-capture-card__desc">
                          {(c.description||"").slice(0, 140)}{(c.description||"").length > 140 ? "…" : ""}
                        </p>
                        {c.date && <div className="va-capture-card__date">📅 {new Date(c.date + "T12:00").toLocaleDateString("es-AR", { weekday:"short", day:"numeric", month:"short" })}</div>}
                        <div className="va-capture-card__btns">
                          <button className="va-capture-btn va-capture-btn--ok"  onClick={() => resolveCapture(c.id)}>Resolver</button>
                          <button className="va-capture-btn va-capture-btn--del" onClick={() => discardCapture(c.id)}>Descartar</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}

/* ─── Icons ──────────────────────────────────────────────────────────── */
function MicIcon({ className = "" }) {
  return (
    <svg className={`va-svg-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3"/>
      <path d="M5 10a7 7 0 0014 0"/>
      <line x1="12" y1="17" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="va-svg-icon" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  );
}
