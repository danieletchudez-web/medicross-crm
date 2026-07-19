import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  COST_STATUSES, PENDING_REASONS, addQuotationComment, downloadAttachment,
  ensureWorkflowItems, getPurchasingUsers, getWorkflowConfig, getWorkflowMetrics,
  listWorkflowSupport, requestCostReview, saveItemCost, savePendingResolution,
  sendToPurchasing, softDeleteAttachment, takePurchasingOwnership,
  sendToTenders, updateCommercialItem, uploadQuotationFiles, validateCosts,
} from "../../services/quotationWorkflow";
import "./QuotationWorkflow.css";

const money = (value, currency = "ARS") => `${currency} ${Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = value => value ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";
const labelStatus = value => String(value || "pendiente").replaceAll("_", " ");
const isPurchasing = profile => profile?.department === "compras" || profile?.role === "super_admin";
const isSales = profile => ["ventas", "vendedor"].includes(profile?.department || profile?.role) || profile?.role === "super_admin";

function CostEditor({ item, profile, onSaved }) {
  const base = item.current_cost || {};
  const [form, setForm] = useState({ supplier_name: base.supplier_name || item.suggested_supplier_name || "", offered_product: base.offered_product || "", brand: base.brand || item.desired_brand || "", model: base.model || "", supplier_code: base.supplier_code || "", unit_cost: base.unit_cost || "", currency: base.currency || "ARS", exchange_rate: base.exchange_rate || "", vat_pct: base.vat_pct || 0, taxes: base.taxes || 0, freight: base.freight || 0, additional_expenses: base.additional_expenses || 0, delivery_term: base.delivery_term || "", availability: base.availability || "", valid_until: base.valid_until || "", payment_terms: base.payment_terms || "", supplier_quote_number: base.supplier_quote_number || "", confidence: base.confidence || "pendiente_confirmacion", status: base.status || item.purchasing_status || "buscando_proveedor", pending_reason: item.pending_reason || "", notes: base.notes || item.purchasing_notes || "" });
  const [saving, setSaving] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const resolved = ["costo_cargado", "completo", "alternativa_propuesta"].includes(form.status);
  const save = async () => {
    if (!resolved && (!form.pending_reason || !form.notes.trim())) return alert("Indicá motivo y observación para el renglón pendiente.");
    if (resolved && Number(form.unit_cost || 0) <= 0) return alert("Ingresá un costo unitario válido.");
    setSaving(true);
    try {
      if (resolved) await saveItemCost(item, form, profile);
      else await savePendingResolution(item, form, profile);
      await onSaved();
    } catch (error) { alert(error.message); } finally { setSaving(false); }
  };
  return (
    <article className={`qwf-item ${item.cost_available ? "qwf-item--validated" : ""}`}>
      <header><div><b>Renglón {item.line_number || item.legacy_index + 1}</b><p>{item.requested_description || "Sin descripción"}</p></div><span className={`qwf-badge qwf-badge--${item.cost_available ? "success" : "neutral"}`}>{item.cost_available ? "Validado" : labelStatus(form.status)}</span></header>
      <div className="qwf-form-grid">
        <label>Proveedor<input value={form.supplier_name} onChange={e => change("supplier_name", e.target.value)} disabled={item.cost_available}/></label>
        <label>Producto ofrecido<input value={form.offered_product} onChange={e => change("offered_product", e.target.value)} disabled={item.cost_available}/></label>
        <label>Marca<input value={form.brand} onChange={e => change("brand", e.target.value)} disabled={item.cost_available}/></label>
        <label>Modelo<input value={form.model} onChange={e => change("model", e.target.value)} disabled={item.cost_available}/></label>
        <label>Estado<select value={form.status} onChange={e => change("status", e.target.value)} disabled={item.cost_available}>{COST_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Confianza<select value={form.confidence} onChange={e => change("confidence", e.target.value)} disabled={item.cost_available}><option value="confirmado">Confirmado</option><option value="estimado">Estimado</option><option value="historico">Histórico</option><option value="pendiente_confirmacion">Pendiente de confirmación</option></select></label>
        {resolved ? <>
          <label>Costo unitario<input type="number" value={form.unit_cost} onChange={e => change("unit_cost", e.target.value)} disabled={item.cost_available}/></label>
          <label>Moneda<select value={form.currency} onChange={e => change("currency", e.target.value)} disabled={item.cost_available}><option>ARS</option><option>USD</option><option>EUR</option></select></label>
          <label>Tipo de cambio<input type="number" value={form.exchange_rate} onChange={e => change("exchange_rate", e.target.value)} disabled={item.cost_available}/></label>
          <label>IVA %<input type="number" value={form.vat_pct} onChange={e => change("vat_pct", e.target.value)} disabled={item.cost_available}/></label>
          <label>Flete<input type="number" value={form.freight} onChange={e => change("freight", e.target.value)} disabled={item.cost_available}/></label>
          <label>Gastos adicionales<input type="number" value={form.additional_expenses} onChange={e => change("additional_expenses", e.target.value)} disabled={item.cost_available}/></label>
          <label>Disponibilidad<input value={form.availability} onChange={e => change("availability", e.target.value)} disabled={item.cost_available}/></label>
          <label>Plazo de entrega<input value={form.delivery_term} onChange={e => change("delivery_term", e.target.value)} disabled={item.cost_available}/></label>
          <label>Vigencia<input type="date" value={form.valid_until} onChange={e => change("valid_until", e.target.value)} disabled={item.cost_available}/></label>
          <label>Presupuesto proveedor<input value={form.supplier_quote_number} onChange={e => change("supplier_quote_number", e.target.value)} disabled={item.cost_available}/></label>
        </> : <label className="qwf-span-2">Motivo pendiente<select value={form.pending_reason} onChange={e => change("pending_reason", e.target.value)} disabled={item.cost_available}><option value="">Seleccionar…</option>{PENDING_REASONS.map(reason => <option key={reason}>{reason}</option>)}</select></label>}
        <label className="qwf-span-2">Observaciones<textarea value={form.notes} onChange={e => change("notes", e.target.value)} disabled={item.cost_available}/></label>
      </div>
      <footer>{base.version && <small>Versión de costo {base.version} · {money(base.total_unit_cost || base.unit_cost, base.currency)}</small>}<button type="button" onClick={save} disabled={saving || item.cost_available}>{saving ? "Guardando…" : resolved ? "Guardar versión de costo" : "Guardar resolución pendiente"}</button></footer>
    </article>
  );
}

function CommercialEditor({ item, profile, purchasingOwnerId, onSaved }) {
  const cost = item.current_cost;
  const [form, setForm] = useState({ markup: item.markup || "", target_margin: item.target_margin || "", commission_pct: item.commission_pct || "", commercial_expenses: item.commercial_expenses || 0, discount_pct: item.discount_pct || 0, sale_price_unit: item.sale_price_unit || "", final_price_unit: item.final_price_unit || "", commercial_notes: item.commercial_notes || "", sales_decision: item.sales_decision || "cotizar" });
  const [review, setReview] = useState(false);
  const [reviewData, setReviewData] = useState({ reason: "Revisar costo", comment: "" });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async () => { try { await updateCommercialItem(item, form, profile); await onSaved(); } catch (error) { alert(error.message); } };
  const requestReview = async () => { if (!reviewData.comment.trim()) return; try { await requestCostReview(item, reviewData.reason, reviewData.comment, profile, purchasingOwnerId); setReview(false); await onSaved(); } catch (error) { alert(error.message); } };
  return (
    <article className={`qwf-item ${!item.cost_available ? "qwf-item--locked" : ""}`}>
      <header><div><b>Renglón {item.line_number || item.legacy_index + 1}</b><p>{item.requested_description}</p></div><span className={`qwf-badge qwf-badge--${item.cost_available ? "success" : "warning"}`}>{item.cost_available ? "Disponible para definir" : "Pendiente de Compras"}</span></header>
      {!item.cost_available ? <div className="qwf-pending"><b>{item.pending_reason || "Costo aún no validado"}</b><span>{item.purchasing_notes || "Compras continúa gestionando este renglón."}</span></div> : <>
        <div className="qwf-cost-summary"><span>Costo validado <b>{money(cost?.total_unit_cost || cost?.unit_cost, cost?.currency)}</b></span><span>Proveedor <b>{cost?.supplier_name || "—"}</b></span><span>Confianza <b>{labelStatus(cost?.confidence)}</b></span><span>Disponibilidad <b>{cost?.availability || "—"}</b></span></div>
        <div className="qwf-form-grid">
          <label>Markup %<input type="number" value={form.markup} onChange={e => change("markup", e.target.value)}/></label>
          <label>Margen objetivo %<input type="number" value={form.target_margin} onChange={e => change("target_margin", e.target.value)}/></label>
          <label>Comisión %<input type="number" value={form.commission_pct} onChange={e => change("commission_pct", e.target.value)}/></label>
          <label>Gastos comerciales<input type="number" value={form.commercial_expenses} onChange={e => change("commercial_expenses", e.target.value)}/></label>
          <label>Precio venta unitario<input type="number" value={form.sale_price_unit} onChange={e => change("sale_price_unit", e.target.value)}/></label>
          <label>Descuento %<input type="number" value={form.discount_pct} onChange={e => change("discount_pct", e.target.value)}/></label>
          <label>Precio final<input type="number" value={form.final_price_unit} onChange={e => change("final_price_unit", e.target.value)}/></label>
          <label>Decisión<select value={form.sales_decision} onChange={e => change("sales_decision", e.target.value)}><option value="cotizar">Cotizar</option><option value="no_cotizar">No cotizar</option><option value="solicitar_revision">Solicitar revisión</option><option value="solicitar_alternativa">Solicitar alternativa</option></select></label>
          <label className="qwf-span-2">Observaciones comerciales<textarea value={form.commercial_notes} onChange={e => change("commercial_notes", e.target.value)}/></label>
        </div>
        <footer><button className="qwf-secondary" onClick={() => setReview(!review)}>Solicitar revisión a Compras</button><button onClick={save}>Guardar definición comercial</button></footer>
        {review && <div className="qwf-review"><select value={reviewData.reason} onChange={e => setReviewData({ ...reviewData, reason: e.target.value })}><option>Revisar costo</option><option>Vigencia vencida</option><option>Solicitar alternativa</option><option>Error de producto</option></select><textarea placeholder="Comentario obligatorio" value={reviewData.comment} onChange={e => setReviewData({ ...reviewData, comment: e.target.value })}/><button onClick={requestReview}>Enviar revisión</button></div>}
      </>}
    </article>
  );
}

function ValidationDialog({ quote, items, onClose, onValidated }) {
  const eligible = items.filter(item => item.current_cost && !item.cost_available && ["costo_cargado", "completo", "alternativa_propuesta"].includes(item.current_cost.status));
  const [selected, setSelected] = useState(eligible.map(item => item.id));
  const [type, setType] = useState(items.every(i => !i.cost_available) && eligible.length === items.length ? "total" : items.some(i => i.cost_available) ? "incremental" : "partial");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = selected.length > 0 && Boolean(notes.trim()) && (type === "total" || Boolean(reason));
  const submit = async () => {
    if (!canSubmit) { setErrorMessage("Completá los campos obligatorios antes de validar."); return; }
    setSubmitting(true); setErrorMessage("");
    try { await validateCosts({ quotationId: quote.id, type, reason, notes, itemIds: selected }); await onValidated(); onClose(); }
    catch (error) { setErrorMessage(error.message || "No se pudo validar la solicitud."); }
    finally { setSubmitting(false); }
  };
  return createPortal(<div className="qwf-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="qwf-modal">
      <header><div><small>Compras</small><h3>Validar cotización</h3></div><button type="button" onClick={onClose} aria-label="Cerrar sin validar">×</button></header>
      <div className="qwf-validation-kpis"><span><b>{items.length}</b>Total</span><span><b>{eligible.length}</b>Con costo</span><span><b>{items.filter(i => !i.cost_available && !i.current_cost).length}</b>Sin costo</span><span><b>{items.filter(i => i.cost_available).length}</b>Ya validados</span></div>
      <label>Tipo de validación<select value={type} onChange={e => { setType(e.target.value); setErrorMessage(""); }}><option value="partial">Validación parcial</option><option value="incremental">Validación incremental</option><option value="total">Validación total</option></select></label>
      <div className="qwf-check-list">{eligible.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><span><b>Renglón {item.line_number || item.legacy_index + 1}</b>{item.requested_description}</span><em>{money(item.current_cost.total_unit_cost || item.current_cost.unit_cost, item.current_cost.currency)}</em></label>)}</div>
      {type !== "total" && <label>Motivo obligatorio<select value={reason} onChange={e => { setReason(e.target.value); setErrorMessage(""); }}><option value="">Seleccionar…</option>{PENDING_REASONS.map(value => <option key={value}>{value}</option>)}</select></label>}
      <label>Observación de cierre obligatoria<textarea placeholder="Ej.: Costos y disponibilidad confirmados con el proveedor." value={notes} onChange={e => { setNotes(e.target.value); setErrorMessage(""); }} /></label>
      {errorMessage && <div className="qwf-modal-error" role="alert">{errorMessage}</div>}
      <footer><button type="button" className="qwf-secondary" onClick={onClose}>Cerrar sin validar</button><button type="button" onClick={submit} disabled={!canSubmit || submitting}>{submitting ? "Validando…" : `Confirmar validación (${selected.length})`}</button></footer>
    </section>
  </div>, document.body);
}

export default function QuotationWorkflow({ quotationId, profile, context = "cotizador" }) {
  const [config, setConfig] = useState(null), [data, setData] = useState(null), [support, setSupport] = useState(null);
  const [tab, setTab] = useState("summary"), [error, setError] = useState(""), [loading, setLoading] = useState(false), [validationOpen, setValidationOpen] = useState(false);
  const [buyers, setBuyers] = useState([]), [sendForm, setSendForm] = useState({ purchasingOwnerId: "", deadline: "", priority: "normal" });
  const [files, setFiles] = useState([]), [fileForm, setFileForm] = useState({ itemId: "", category: "otro", description: "" }), [comment, setComment] = useState("");
  const [metrics, setMetrics] = useState([]);
  const load = useCallback(async () => {
    if (!quotationId) return;
    setLoading(true); setError("");
    try {
      const [workflow, extras, purchasingUsers, workflowMetrics] = await Promise.all([ensureWorkflowItems(quotationId), listWorkflowSupport(quotationId), getPurchasingUsers(), getWorkflowMetrics()]);
      setData(workflow); setSupport(extras); setBuyers(purchasingUsers); setMetrics(workflowMetrics);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [quotationId]);
  useEffect(() => { getWorkflowConfig().then(setConfig); }, []);
  useEffect(() => { if (config?.enabled && quotationId) load(); }, [config, quotationId, load]);
  const progress = useMemo(() => { const items = data?.items || []; const available = items.filter(item => item.cost_available).length; return { total: items.length, available, pending: items.length - available, commercial: items.filter(item => ["precio_definido", "descartado", "aprobado_ventas"].includes(item.commercial_status)).length }; }, [data]);
  if (!quotationId) return <section className="qwf-shell qwf-empty"><b>Flujo colaborativo</b><span>Guardá la cotización para habilitar Compras, validaciones, documentación e historial.</span></section>;
  if (!config) return null;
  if (!config.enabled) return profile?.role === "super_admin" ? <section className="qwf-shell qwf-empty"><b>Flujo colaborativo desactivado</b><span>Activá `quotation_collaboration.enabled` en Configuración para iniciar el piloto.</span></section> : null;
  if (error) return <section className="qwf-shell qwf-error"><b>No se pudo abrir el flujo colaborativo</b><span>{error}</span><small>Aplicá la migración `20260718200000_quotation_collaboration.sql` y reintentá.</small><button onClick={load}>Reintentar</button></section>;
  if (!data || loading) return <section className="qwf-shell qwf-empty">Preparando flujo colaborativo…</section>;
  const send = async () => { try { await sendToPurchasing({ quotationId, profile, ...sendForm }); await load(); } catch (e) { alert(e.message); } };
  const upload = async () => { if (!files.length) return; try { await uploadQuotationFiles({ quotationId, itemId: fileForm.itemId || null, files, category: fileForm.category, description: fileForm.description, profile }); setFiles([]); await load(); } catch (e) { alert(e.message); } };
  const addComment = async () => { if (!comment.trim()) return; try { await addQuotationComment(quotationId, null, comment, profile); setComment(""); await load(); } catch (e) { alert(e.message); } };
  const tabs = [["summary", "Resumen"], ...(context === "purchases" || (isPurchasing(profile) && !isSales(profile)) ? [["costs", `Costos (${progress.available}/${progress.total})`]] : []), ...(context !== "purchases" && isSales(profile) ? [["commercial", "Definición comercial"]] : []), ["documents", `Documentación (${support?.attachments.length || 0})`], ["history", "Historial"], ["comments", "Comentarios"], ["metrics", "KPIs"]];
  return <section className="qwf-shell">
    <header className="qwf-head"><div><span>Flujo colaborativo</span><h3>{data.quote.workflow_status ? labelStatus(data.quote.workflow_status) : "Cotización en preparación"}</h3></div><div className="qwf-progress"><b>{progress.available} de {progress.total}</b><span>renglones con costo disponible</span><i><i style={{ width: `${progress.total ? progress.available / progress.total * 100 : 0}%` }}/></i></div></header>
    {progress.available > 0 && progress.pending > 0 && <div className="qwf-partial"><b>Cotización validada parcialmente: {progress.available} de {progress.total} renglones disponibles para definición comercial.</b><span>Ventas puede avanzar sobre los disponibles. Los {progress.pending} pendientes permanecen visibles y en gestión de Compras.</span></div>}
    <nav className="qwf-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="qwf-body">
      {tab === "summary" && <div className="qwf-summary"><div className="qwf-kpis"><article><span>Total</span><b>{progress.total}</b><small>renglones</small></article><article><span>Disponibles</span><b>{progress.available}</b><small>para Ventas</small></article><article><span>Pendientes</span><b>{progress.pending}</b><small>en Compras</small></article><article><span>Definidos</span><b>{progress.commercial}</b><small>comercialmente</small></article></div><div className="qwf-meta"><span>Ventas <b>{data.quote.sales_owner_id ? "Asignado" : "Sin asignar"}</b></span><span>Compras <b>{data.quote.purchasing_owner_id ? "Asignado" : "Cola general"}</b></span><span>Fecha límite <b>{data.quote.internal_deadline || "Sin fecha"}</b></span><span>Prioridad <b>{data.quote.priority || "normal"}</b></span></div>{isSales(profile) && !data.quote.sent_to_purchasing_at && <div className="qwf-send"><select value={sendForm.purchasingOwnerId} onChange={e => setSendForm({ ...sendForm, purchasingOwnerId: e.target.value })}><option value="">Cola general de Compras</option>{buyers.map(user => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}</select><input type="date" value={sendForm.deadline} onChange={e => setSendForm({ ...sendForm, deadline: e.target.value })}/><select value={sendForm.priority} onChange={e => setSendForm({ ...sendForm, priority: e.target.value })}><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select><button onClick={send}>Enviar a Compras</button></div>}{isPurchasing(profile) && !data.quote.purchasing_owner_id && data.quote.sent_to_purchasing_at && <button onClick={async () => { await takePurchasingOwnership(quotationId, profile); await load(); }}>Tomar gestión</button>}</div>}
      {tab === "costs" && <><div className="qwf-section-head"><div><h4>Gestión de costos</h4><p>Los avances se guardan por renglón y cada costo genera una versión.</p></div>{isPurchasing(profile) && <button onClick={() => setValidationOpen(true)}>Validar cotización</button>}</div>{data.items.map(item => <CostEditor key={item.id} item={item} profile={profile} onSaved={load}/>)}</>}
      {tab === "commercial" && <><div className="qwf-section-head"><div><h4>Definición comercial</h4><p>{progress.available} disponibles · {progress.pending} pendientes visibles</p></div>{progress.commercial === progress.total && progress.total > 0 && <button onClick={async () => { try { await sendToTenders(quotationId, data.items, profile); await load(); } catch (e) { alert(e.message); } }}>Enviar a Licitaciones</button>}</div>{data.items.map(item => <CommercialEditor key={item.id} item={item} profile={profile} purchasingOwnerId={data.quote.purchasing_owner_id} onSaved={load}/>)}</>}
      {tab === "documents" && <><div className="qwf-upload"><input type="file" multiple onChange={e => setFiles([...e.target.files])}/><select value={fileForm.itemId} onChange={e => setFileForm({ ...fileForm, itemId: e.target.value })}><option value="">Documento general</option>{data.items.map(item => <option key={item.id} value={item.id}>Renglón {item.line_number || item.legacy_index + 1}</option>)}</select><select value={fileForm.category} onChange={e => setFileForm({ ...fileForm, category: e.target.value })}>{["folleto", "ficha_tecnica", "pm_anmat", "certificado_anmat", "presupuesto_proveedor", "pliego", "imagen_producto", "otro"].map(value => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select><input placeholder="Descripción" value={fileForm.description} onChange={e => setFileForm({ ...fileForm, description: e.target.value })}/><button onClick={upload} disabled={!files.length}>Subir {files.length || ""} archivo(s)</button></div><div className="qwf-files">{support.attachments.map(file => <article key={file.id}><div><b>{file.original_name}</b><span>{labelStatus(file.document_category)} · {file.file_size ? `${Math.ceil(file.file_size / 1024)} KB` : ""}</span></div><button onClick={() => downloadAttachment(file)}>Descargar</button><button className="qwf-danger" onClick={async () => { await softDeleteAttachment(file, profile); await load(); }}>Eliminar</button></article>)}</div></>}
      {tab === "history" && <div className="qwf-timeline">{support.activity.map(event => <article key={event.id}><i/><div><b>{labelStatus(event.action)}</b><span>{event.profiles?.full_name || event.profiles?.email || event.actor_department || "Sistema"} · {shortDate(event.created_at)}</span>{event.comment && <p>{event.comment}</p>}</div></article>)}</div>}
      {tab === "comments" && <><div className="qwf-comment-box"><textarea placeholder="Agregar comentario para Ventas, Compras o Licitaciones…" value={comment} onChange={e => setComment(e.target.value)}/><button onClick={addComment}>Comentar</button></div><div className="qwf-comments">{support.comments.map(entry => <article key={entry.id}><b>{entry.profiles?.full_name || entry.profiles?.email}</b><small>{entry.sector} · {shortDate(entry.created_at)}</small><p>{entry.body}</p></article>)}</div></>}
      {tab === "metrics" && <div className="qwf-kpis qwf-kpis--metrics"><article><span>Solicitudes activas</span><b>{metrics.filter(row => ["pendiente_costos", "en_gestion_compras", "costos_parciales"].includes(row.workflow_status)).length}</b></article><article><span>Renglones pendientes</span><b>{metrics.reduce((sum, row) => sum + Number(row.pending_items || 0), 0)}</b></article><article><span>Avance promedio</span><b>{metrics.length ? Math.round(metrics.reduce((sum, row) => sum + (row.total_items ? row.available_items / row.total_items * 100 : 0), 0) / metrics.length) : 0}%</b></article><article><span>Revisiones abiertas</span><b>{support.reviews.filter(review => review.status !== "resolved").length}</b></article></div>}
    </div>
    {validationOpen && <ValidationDialog quote={data.quote} items={data.items} onClose={() => setValidationOpen(false)} onValidated={load}/>} 
  </section>;
}

export function QuotationWorkflowInbox({ profile, onOpenQuote }) {
  const [rows, setRows] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const department = profile?.department || profile?.role;
  useEffect(() => {
    let active = true;
    Promise.all([getWorkflowConfig(), getWorkflowMetrics()])
      .then(([config, metrics]) => {
        if (!active) return;
        setEnabled(Boolean(config.enabled));
        setRows(metrics || []);
      })
      .catch(() => active && setEnabled(false))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);
  const visible = useMemo(() => rows.filter(row => {
    if (profile?.role === "super_admin" || department === "administracion") return row.workflow_status && row.workflow_status !== "borrador";
    if (department === "compras") return ["pendiente_costos", "en_gestion_compras", "costos_parciales", "revision_solicitada"].includes(row.workflow_status);
    if (department === "licitaciones") return ["lista_para_licitaciones", "en_licitaciones"].includes(row.workflow_status);
    return ["costos_parciales", "costos_completos", "definicion_comercial"].includes(row.workflow_status);
  }).sort((a, b) => {
    const urgency = value => value === "urgente" ? 0 : value === "alta" ? 1 : 2;
    return urgency(a.priority) - urgency(b.priority) || String(a.internal_deadline || "9999").localeCompare(String(b.internal_deadline || "9999"));
  }), [rows, department, profile?.role]);
  if (loading || !enabled || !visible.length) return null;
  return <section className="qwf-inbox">
    <header><div><small>Flujo colaborativo</small><h3>Solicitudes de costos</h3></div><span>{visible.length} activas</span></header>
    <div className="qwf-inbox-list">{visible.slice(0, 8).map(row => {
      const total = Number(row.total_items || 0), available = Number(row.available_items || 0);
      return <button type="button" key={row.quotation_id} onClick={() => onOpenQuote(row.quotation_id)}>
        <div><b>{row.quote_num_formatted || "Cotización sin número"}</b><span>{row.institucion || "Sin institución"}</span></div>
        <div className="qwf-inbox-progress"><span>{available}/{total} con costo</span><i><i style={{ width: `${total ? available / total * 100 : 0}%` }}/></i></div>
        <span className={`qwf-badge qwf-badge--${row.priority === "urgente" ? "warning" : "neutral"}`}>{labelStatus(row.workflow_status)}</span>
        <small>{row.internal_deadline ? `Límite ${new Date(`${row.internal_deadline}T00:00:00`).toLocaleDateString("es-AR")}` : labelStatus(row.priority || "normal")}</small>
      </button>;
    })}</div>
  </section>;
}
