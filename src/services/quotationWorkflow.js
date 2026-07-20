import { supabase } from "../lib/supabaseClient";

const now = () => new Date().toISOString();
const safeName = value => String(value || "archivo").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);

export const COST_STATUSES = [
  ["buscando_proveedor", "Buscando proveedor"], ["esperando_respuesta", "Esperando respuesta"],
  ["costo_cargado", "Costo cargado"], ["sin_disponibilidad", "Sin disponibilidad"],
  ["sin_costo", "No se consiguió costo"], ["alternativa_propuesta", "Alternativa propuesta"],
  ["no_cotizable", "No cotizable"], ["completo", "Completo"],
];
export const PENDING_REASONS = ["Proveedor sin respuesta", "Producto discontinuado", "Producto sin disponibilidad", "No se encontró proveedor", "Costo pendiente de confirmación", "Producto no identificable", "Solicitud requiere aclaración", "Otro"];

export async function getWorkflowConfig() {
  const { data, error } = await supabase.from("crm_settings").select("value").eq("key", "quotation_collaboration").maybeSingle();
  if (error) return { enabled: false, unavailable: true, error };
  return { enabled: Boolean(data?.value?.enabled), ...(data?.value || {}) };
}

export async function getWorkflowQuote(quotationId) {
  const [{ data: quote, error: quoteError }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("cotizaciones").select("*").eq("id", quotationId).single(),
    supabase.from("quotation_items").select("*, quotation_item_costs(*)").eq("quotation_id", quotationId).order("sort_order"),
  ]);
  if (quoteError) throw quoteError;
  if (itemsError) throw itemsError;
  return { quote, items: (items || []).map(item => ({ ...item, current_cost: (item.quotation_item_costs || []).find(cost => cost.is_current) || null })) };
}

export async function ensureWorkflowItems(quotationId) {
  const { count, error } = await supabase.from("quotation_items").select("id", { count: "exact", head: true }).eq("quotation_id", quotationId);
  if (error) throw error;
  if (!count) {
    const { error: syncError } = await supabase.rpc("sync_legacy_quotation_items", { target_quote: quotationId });
    if (syncError) throw syncError;
  }
  return getWorkflowQuote(quotationId);
}

export async function sendToPurchasing({ quotationId, profile, purchasingOwnerId, deadline, priority = "normal" }) {
  await ensureWorkflowItems(quotationId);
  const payload = { sales_owner_id: profile.id, purchasing_owner_id: purchasingOwnerId || null, purchasing_queue: !purchasingOwnerId, internal_deadline: deadline || null, priority, workflow_status: "pendiente_costos", sent_to_purchasing_at: now(), updated_at: now() };
  const { error } = await supabase.from("cotizaciones").update(payload).eq("id", quotationId);
  if (error) throw error;
  await supabase.from("quotation_items").update({ purchasing_status: "pendiente_compras" }).eq("quotation_id", quotationId).eq("cost_available", false);
  await logActivity(quotationId, profile, "sent_to_purchasing", null, payload, "Enviada a Compras");
  const query = purchasingOwnerId ? supabase.from("profiles").select("id").eq("id", purchasingOwnerId) : supabase.from("profiles").select("id").eq("department", "compras").eq("is_active", true);
  const { data: recipients } = await query;
  if (recipients?.length) await supabase.from("crm_notifications").upsert(recipients.map(r => ({ recipient_id: r.id, title: "Nueva solicitud de costos", detail: "Ventas envió una cotización para gestión de costos.", category: "cotizaciones", severity: priority === "urgente" ? "warning" : "info", page: "cotizador", record_id: quotationId, metadata: { deadline, priority }, dedupe_key: `quotation-purchasing-${quotationId}-${r.id}` })), { onConflict: "dedupe_key", ignoreDuplicates: true });
}

export async function takePurchasingOwnership(quotationId, profile) {
  const { error } = await supabase.from("cotizaciones").update({ purchasing_owner_id: profile.id, purchasing_queue: false, workflow_status: "en_gestion_compras", updated_at: now() }).eq("id", quotationId);
  if (error) throw error;
  await logActivity(quotationId, profile, "purchasing_taken", null, { purchasing_owner_id: profile.id });
}

export async function saveItemCost(item, values, profile) {
  const previous = item.current_cost;
  const version = Number(previous?.version || 0) + 1;
  if (previous) {
    const { error } = await supabase.from("quotation_item_costs").update({ is_current: false }).eq("id", previous.id).eq("is_current", true);
    if (error) throw error;
  }
  const unit = Number(values.unit_cost || 0), rate = Number(values.exchange_rate || 1);
  const converted = values.currency === "ARS" ? unit : unit * rate;
  const total = converted + Number(values.taxes || 0) + Number(values.freight || 0) + Number(values.additional_expenses || 0);
  const payload = { quotation_item_id: item.id, version, supplier_id: values.supplier_id || null, supplier_name: values.supplier_name || null, offered_product: values.offered_product || null, brand: values.brand || null, model: values.model || null, supplier_code: values.supplier_code || null, unit_cost: unit || null, currency: values.currency || "ARS", exchange_rate: rate || null, converted_cost: converted || null, vat_pct: Number(values.vat_pct || 0), taxes: Number(values.taxes || 0), freight: Number(values.freight || 0), additional_expenses: Number(values.additional_expenses || 0), total_unit_cost: total || null, delivery_term: values.delivery_term || null, availability: values.availability || null, valid_until: values.valid_until || null, payment_terms: values.payment_terms || null, supplier_quote_number: values.supplier_quote_number || null, confidence: values.confidence || "pendiente_confirmacion", status: values.status || "costo_cargado", notes: values.notes || null, created_by: profile.id, is_current: true };
  const { data, error } = await supabase.from("quotation_item_costs").insert(payload).select().single();
  if (error) { if (previous) await supabase.from("quotation_item_costs").update({ is_current: true }).eq("id", previous.id); throw error; }
  await supabase.from("quotation_items").update({ purchasing_status: payload.status, pending_reason: values.pending_reason || null, purchasing_notes: values.notes || null, updated_by: profile.id }).eq("id", item.id);
  await supabase.rpc("sync_quotation_item_to_legacy", { target_item: item.id });
  await logActivity(item.quotation_id, profile, "cost_version_created", item.id, payload, values.notes, { cost_id: data.id, version });
  return data;
}

export async function savePendingResolution(item, values, profile) {
  const payload = { purchasing_status: values.status, pending_reason: values.pending_reason, purchasing_notes: values.notes, updated_by: profile.id };
  const { error } = await supabase.from("quotation_items").update(payload).eq("id", item.id);
  if (error) throw error;
  await logActivity(item.quotation_id, profile, "pending_resolution_updated", item.id, payload, values.notes);
}

export async function validateCosts({ quotationId, type, reason, notes, itemIds }) {
  const { data, error } = await supabase.rpc("validate_quotation_costs", { target_quote: quotationId, requested_type: type, validation_reason: reason || null, validation_notes: notes, selected_items: itemIds });
  if (error) throw error;
  return data;
}

export async function updateCommercialItem(item, values, profile) {
  if (!item.cost_available) throw new Error("El renglón todavía no fue validado por Compras.");
  const payload = { markup: values.markup === "" ? null : Number(values.markup), target_margin: values.target_margin === "" ? null : Number(values.target_margin), commission_pct: values.commission_pct === "" ? null : Number(values.commission_pct), commercial_expenses: Number(values.commercial_expenses || 0), discount_pct: Number(values.discount_pct || 0), sale_price_unit: values.sale_price_unit === "" ? null : Number(values.sale_price_unit), final_price_unit: values.final_price_unit === "" ? null : Number(values.final_price_unit), commercial_notes: values.commercial_notes || null, sales_decision: values.sales_decision || "cotizar", commercial_status: values.sales_decision === "cotizar" ? "precio_definido" : "descartado", commercial_started_at: item.commercial_started_at || now(), commercial_completed_at: now(), updated_by: profile.id };
  const { error } = await supabase.from("quotation_items").update(payload).eq("id", item.id).eq("cost_available", true);
  if (error) throw error;
  await supabase.rpc("sync_quotation_item_to_legacy", { target_item: item.id });
  await logActivity(item.quotation_id, profile, "commercial_definition_saved", item.id, payload, values.commercial_notes);
}

export async function saveCommercialDefinitionsFromLegacy(quotationId, renglones, tcGlobal, profile) {
  const { data: items, error } = await supabase.from("quotation_items").select("id,legacy_index,cost_available,commercial_started_at").eq("quotation_id", quotationId);
  if (error) throw error;
  const available = (items || []).filter(item => item.cost_available);
  for (const item of available) {
    const row = renglones[Number(item.legacy_index || 0)];
    if (!row) continue;
    const number = value => Number(String(value || 0).replace(",", "."));
    const cost = number(row.costo), rate = number(row.tcInd || tcGlobal || 1) || 1;
    const costArs = row.moneda === "ARS" ? cost : cost * rate;
    const vat = number(row.iva) / 100, multiplier = number(row.markup) || 1;
    const manual = row.modoManual === "manual" && number(row.pvManual) > 0;
    const finalPrice = manual ? number(row.pvManual) : costArs * multiplier * (1 + vat);
    const salePrice = finalPrice / (1 + vat);
    const payload = { markup: costArs > 0 ? ((salePrice - costArs) / costArs) * 100 : null, sale_price_unit: salePrice || null, final_price_unit: finalPrice || null, sales_decision: "cotizar", commercial_status: "precio_definido", commercial_started_at: item.commercial_started_at || now(), commercial_completed_at: now(), updated_by: profile?.id || null };
    const { error: updateError } = await supabase.from("quotation_items").update(payload).eq("id", item.id).eq("cost_available", true);
    if (updateError) throw updateError;
    await logActivity(quotationId, profile, "commercial_definition_saved", item.id, payload, "Precio definido desde Cotizador");
  }
  const pending = (items || []).filter(item => !item.cost_available);
  if (pending.length) {
    await supabase.from("quotation_items").update({ purchasing_status: "pendiente_compras", updated_by: profile?.id || null }).eq("quotation_id", quotationId).eq("cost_available", false);
    await supabase.from("cotizaciones").update({ workflow_status: available.length ? "costos_parciales" : "pendiente_costos", updated_at: now() }).eq("id", quotationId);
    const { data: quote } = await supabase.from("cotizaciones").select("purchasing_owner_id,quote_num_formatted").eq("id", quotationId).single();
    const recipientsQuery = quote?.purchasing_owner_id
      ? supabase.from("profiles").select("id").eq("id", quote.purchasing_owner_id)
      : supabase.from("profiles").select("id").eq("department", "compras").eq("is_active", true);
    const { data: recipients } = await recipientsQuery;
    if (recipients?.length) await supabase.from("crm_notifications").upsert(recipients.map(recipient => ({ recipient_id: recipient.id, title: "Cotización modificada por Ventas", detail: `La cotización #${quote?.quote_num_formatted || ""} tiene ${pending.length} renglón${pending.length === 1 ? "" : "es"} pendiente${pending.length === 1 ? "" : "s"} de costo.`, category: "cotizaciones", severity: "warning", page: "purchases", record_id: quotationId, metadata: { pending_items: pending.length }, dedupe_key: `quotation-purchasing-change-${quotationId}-${recipient.id}-${pending.length}` })), { onConflict: "dedupe_key", ignoreDuplicates: true });
    await logActivity(quotationId, profile, "items_returned_to_purchasing", null, { pending_items: pending.length }, "Ventas agregó o modificó renglones pendientes de costo");
  } else if (available.length) await supabase.from("cotizaciones").update({ workflow_status: "definicion_comercial", updated_at: now() }).eq("id", quotationId);
  return { defined: available.length, pending: pending.length };
}

export async function sendToTenders(quotationId, items, profile) {
  const unresolved = items.filter(item => !["precio_definido", "descartado", "aprobado_ventas"].includes(item.commercial_status));
  if (unresolved.length) throw new Error(`Todavía hay ${unresolved.length} renglones sin decisión comercial final.`);
  const { error } = await supabase.from("cotizaciones").update({ workflow_status: "lista_para_licitaciones", updated_at: now() }).eq("id", quotationId);
  if (error) throw error;
  const { data: recipients } = await supabase.from("profiles").select("id").eq("department", "licitaciones").eq("is_active", true);
  if (recipients?.length) await supabase.from("crm_notifications").upsert(recipients.map(r => ({ recipient_id: r.id, title: "Cotización lista para Licitaciones", detail: "Ventas completó las decisiones comerciales de todos los renglones.", category: "cotizaciones", severity: "info", page: "cotizador", record_id: quotationId, dedupe_key: `quotation-tenders-${quotationId}-${r.id}` })), { onConflict: "dedupe_key", ignoreDuplicates: true });
  await logActivity(quotationId, profile, "sent_to_tenders", null, { workflow_status: "lista_para_licitaciones" });
}

export async function requestCostReview(item, reason, comment, profile, assignedTo) {
  const { data, error } = await supabase.from("quotation_item_reviews").insert({ quotation_id: item.quotation_id, quotation_item_id: item.id, reason, comment, previous_cost_id: item.current_cost?.id || null, requested_by: profile.id, assigned_to: assignedTo || null }).select().single();
  if (error) throw error;
  await supabase.from("quotation_items").update({ purchasing_status: "revision_solicitada" }).eq("id", item.id);
  await logActivity(item.quotation_id, profile, "cost_review_requested", item.id, { review_id: data.id, reason }, comment);
  return data;
}

export async function listWorkflowSupport(quotationId) {
  const calls = await Promise.all([
    supabase.from("quotation_attachments").select("*").eq("quotation_id", quotationId).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("quotation_activity_log").select("*, profiles:actor_id(full_name,email)").eq("quotation_id", quotationId).order("created_at", { ascending: false }).limit(200),
    supabase.from("quotation_comments").select("*, profiles:author_id(full_name,email)").eq("quotation_id", quotationId).is("deleted_at", null).order("created_at"),
    supabase.from("quotation_validations").select("*").eq("quotation_id", quotationId).order("created_at", { ascending: false }),
    supabase.from("quotation_item_reviews").select("*").eq("quotation_id", quotationId).order("created_at", { ascending: false }),
  ]);
  const error = calls.find(result => result.error)?.error;
  if (error) throw error;
  return { attachments: calls[0].data || [], activity: calls[1].data || [], comments: calls[2].data || [], validations: calls[3].data || [], reviews: calls[4].data || [] };
}

export async function uploadQuotationFiles({ quotationId, itemId, files, category, description, profile }) {
  const uploaded = [];
  for (const file of files) {
    const internal = `${Date.now()}_${crypto.randomUUID()}_${safeName(file.name)}`;
    const path = `${quotationId}/${itemId ? `items/${itemId}` : "general"}/${internal}`;
    const { error: uploadError } = await supabase.storage.from("quotation-files").upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.from("quotation_attachments").insert({ quotation_id: quotationId, quotation_item_id: itemId || null, original_name: file.name, internal_name: internal, storage_path: path, mime_type: file.type, document_category: category || "otro", description: description || null, file_size: file.size, uploaded_by: profile.id, uploaded_department: profile.department || profile.role }).select().single();
    if (error) { await supabase.storage.from("quotation-files").remove([path]); throw error; }
    uploaded.push(data);
  }
  await logActivity(quotationId, profile, "attachments_uploaded", itemId, { count: uploaded.length, category });
  return uploaded;
}

export async function downloadAttachment(attachment) {
  const { data, error } = await supabase.storage.from("quotation-files").download(attachment.storage_path);
  if (error) throw error;
  const url = URL.createObjectURL(data), anchor = document.createElement("a");
  anchor.href = url; anchor.download = attachment.original_name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function softDeleteAttachment(attachment, profile) {
  const { error } = await supabase.from("quotation_attachments").update({ is_active: false, deleted_at: now(), deleted_by: profile.id }).eq("id", attachment.id);
  if (error) throw error;
  await logActivity(attachment.quotation_id, profile, "attachment_soft_deleted", attachment.quotation_item_id, { attachment_id: attachment.id });
}

export async function addQuotationComment(quotationId, itemId, body, profile) {
  const { data, error } = await supabase.from("quotation_comments").insert({ quotation_id: quotationId, quotation_item_id: itemId || null, body, sector: profile.department || profile.role, author_id: profile.id }).select("*, profiles:author_id(full_name,email)").single();
  if (error) throw error;
  await logActivity(quotationId, profile, "comment_added", itemId, null, body);
  return data;
}

export async function getPurchasingUsers() {
  const { data, error } = await supabase.from("profiles").select("id,full_name,email,department").eq("department", "compras").eq("is_active", true).order("full_name");
  if (error) throw error;
  return data || [];
}

export async function getWorkflowMetrics() {
  const { data, error } = await supabase.from("quotation_workflow_metrics").select("*");
  if (!error) return data || [];
  if (!/quotation_workflow_metrics|schema cache|does not exist/i.test(error.message || "")) throw error;

  const [{ data: quotes, error: quoteError }, { data: items, error: itemError }] = await Promise.all([
    supabase.from("cotizaciones").select("id,quote_num_formatted,institucion,workflow_status,sales_owner_id,purchasing_owner_id,internal_deadline,priority,sent_to_purchasing_at"),
    supabase.from("quotation_items").select("quotation_id,cost_available,commercial_status,cost_validated_at"),
  ]);
  if (quoteError) throw quoteError;
  if (itemError) throw itemError;
  const byQuote = new Map();
  for (const item of items || []) {
    const aggregate = byQuote.get(item.quotation_id) || { total_items: 0, available_items: 0, pending_items: 0, commercial_resolved_items: 0, last_cost_validation_at: null };
    aggregate.total_items += 1;
    if (item.cost_available) aggregate.available_items += 1;
    else aggregate.pending_items += 1;
    if (["precio_definido", "aprobado_ventas", "descartado"].includes(item.commercial_status)) aggregate.commercial_resolved_items += 1;
    if (item.cost_validated_at && (!aggregate.last_cost_validation_at || item.cost_validated_at > aggregate.last_cost_validation_at)) aggregate.last_cost_validation_at = item.cost_validated_at;
    byQuote.set(item.quotation_id, aggregate);
  }
  return (quotes || []).map(quote => ({ quotation_id: quote.id, ...quote, ...(byQuote.get(quote.id) || { total_items: 0, available_items: 0, pending_items: 0, commercial_resolved_items: 0, last_cost_validation_at: null }) }));
}

export async function logActivity(quotationId, profile, action, itemId = null, newValue = null, comment = null, metadata = {}) {
  const { error } = await supabase.from("quotation_activity_log").insert({ quotation_id: quotationId, quotation_item_id: itemId, action, actor_id: profile?.id || null, actor_department: profile?.department || profile?.role || null, new_value: newValue, comment, metadata });
  if (error) console.warn("quotation activity log:", error.message);
}
