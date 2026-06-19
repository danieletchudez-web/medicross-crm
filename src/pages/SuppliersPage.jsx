import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./suppliers.css";

/* ── helpers ─────────────────────────────────────────────── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtPrice = (p, cur = "ARS") => {
  if (p == null || p === "") return "—";
  return (cur === "USD" ? "U$D " : "$ ") +
    Number(p).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const FIELD_LABELS = {
  code: "Código", name: "Nombre / Descripción", brand: "Marca",
  line: "Línea", unit: "Unidad", price: "Precio", currency: "Moneda",
};
const FIELD_ORDER = ["name", "code", "brand", "line", "unit", "price", "currency"];

function emptySupplier() {
  return {
    name: "", trade_name: "", cuit: "", contact_name: "",
    email: "", phone: "", website: "", address: "",
    payment_terms: "", notes: "", is_active: true,
  };
}
function emptyProduct() {
  return { code: "", name: "", brand: "", line: "", unit: "u.", price: "", currency: "ARS", notes: "" };
}

/* ── Toast ───────────────────────────────────────────────── */
function useToast() {
  const [msg, setMsg] = useState(null);
  const show = useCallback((text, type = "ok") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3200);
  }, []);
  return [msg, show];
}

/* ── Auto-detect column mapping ──────────────────────────── */
function guessMapping(headers) {
  const h = headers.map(s => String(s || "").toLowerCase().trim());
  const map = {};
  const aliases = {
    code:     ["codigo","cod","sku","cod.","item","art","articulo","ref","referencia","part"],
    name:     ["nombre","descripcion","descripción","producto","detalle","name","desc","articulo"],
    brand:    ["marca","brand","fabricante"],
    line:     ["linea","línea","rubro","categoria","categoría","familia","grupo"],
    unit:     ["unidad","um","u.m.","ud","uom","unit","presentacion"],
    price:    ["precio","price","costo","valor","pvp","importe","monto","p.v.p"],
    currency: ["moneda","currency","divisa"],
  };
  for (const [field, words] of Object.entries(aliases)) {
    const idx = h.findIndex(col => words.some(w => col.includes(w)));
    if (idx !== -1) map[field] = String(idx);
  }
  return map;
}

/* ── Parse text from PDF paste ───────────────────────────── */
function parsePastedText(raw) {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  const priceRe = /\$?\s*([\d.,]+)\s*(ARS|USD)?/i;
  const codeRe  = /^([A-Z0-9][A-Z0-9\-]{2,14})\s+(.+)/;
  const results = [];
  for (const line of lines) {
    const priceMatch = line.match(priceRe);
    const codeMatch  = line.match(codeRe);
    let price = "", currency = "ARS", name = line, code = "";
    if (priceMatch) {
      price = priceMatch[1].replace(/\./g, "").replace(",", ".");
      currency = priceMatch[2]?.toUpperCase() === "USD" ? "USD" : "ARS";
      name = line.replace(priceMatch[0], "").trim();
    }
    if (codeMatch) {
      code = codeMatch[1];
      name = codeMatch[2].replace(priceMatch?.[0] || "", "").trim();
    }
    if (name.length > 3) results.push({ code, name, brand: "", line: "", unit: "u.", price, currency, notes: "" });
  }
  return results;
}

/* ── ProductRow (inline edit) ────────────────────────────── */
function ProductRow({ prod, onSave, onDelete, lines }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(prod);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (!editing) {
    return (
      <tr className={`sp-prod-row${!prod.is_active ? " sp-prod-row--inactive" : ""}`}>
        <td className="sp-td sp-td--code">{prod.code || <span className="sp-muted">—</span>}</td>
        <td className="sp-td sp-td--name">{prod.name}</td>
        <td className="sp-td">{prod.brand || <span className="sp-muted">—</span>}</td>
        <td className="sp-td">{prod.line || <span className="sp-muted">—</span>}</td>
        <td className="sp-td">{prod.unit}</td>
        <td className="sp-td sp-td--price">{fmtPrice(prod.price, prod.currency)}</td>
        <td className="sp-td sp-td--actions">
          <button className="sp-icon-btn" onClick={() => { setForm(prod); setEditing(true); }} title="Editar">✎</button>
          <button className="sp-icon-btn sp-icon-btn--del" onClick={() => onDelete(prod.id)} title="Eliminar">✕</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="sp-prod-row sp-prod-row--editing">
      <td className="sp-td"><input className="sp-td-input" value={form.code} onChange={e => set("code", e.target.value)} placeholder="Código"/></td>
      <td className="sp-td"><input className="sp-td-input sp-td-input--wide" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Nombre *"/></td>
      <td className="sp-td"><input className="sp-td-input" value={form.brand} onChange={e => set("brand", e.target.value)} placeholder="Marca"/></td>
      <td className="sp-td">
        <input className="sp-td-input" value={form.line} onChange={e => set("line", e.target.value)}
          placeholder="Línea" list={`lines-${prod.id}`}/>
        <datalist id={`lines-${prod.id}`}>{lines.map(l => <option key={l} value={l}/>)}</datalist>
      </td>
      <td className="sp-td"><input className="sp-td-input sp-td-input--sm" value={form.unit} onChange={e => set("unit", e.target.value)} placeholder="u."/></td>
      <td className="sp-td">
        <div className="sp-price-inline">
          <select className="sp-td-select" value={form.currency} onChange={e => set("currency", e.target.value)}>
            <option value="ARS">$</option><option value="USD">U$D</option>
          </select>
          <input className="sp-td-input sp-td-input--price" type="number" value={form.price} onChange={e => set("price", e.target.value)} placeholder="0"/>
        </div>
      </td>
      <td className="sp-td sp-td--actions">
        <button className="sp-icon-btn sp-icon-btn--save" onClick={() => { onSave(form); setEditing(false); }} title="Guardar">✓</button>
        <button className="sp-icon-btn" onClick={() => setEditing(false)} title="Cancelar">✕</button>
      </td>
    </tr>
  );
}

/* ── Global search results ───────────────────────────────── */
function GlobalSearchResults({ results, loading, query, onSelectSupplier }) {
  if (loading) return <div className="sp-gsearch-loading">Buscando en catálogo…</div>;
  if (!results.length) return (
    <div className="sp-gsearch-empty">
      <div className="sp-gsearch-empty__icon">🔍</div>
      <div>No se encontraron productos para <strong>"{query}"</strong></div>
      <div className="sp-gsearch-empty__sub">Probá con otro término o revisá el catálogo de cada proveedor</div>
    </div>
  );
  const bySupplier = {};
  for (const p of results) {
    const sid = p.supplier_id;
    if (!bySupplier[sid]) bySupplier[sid] = { s: p.suppliers, prods: [] };
    bySupplier[sid].prods.push(p);
  }
  const groups = Object.values(bySupplier).sort((a, b) => a.s?.name?.localeCompare(b.s?.name || "") || 0);
  return (
    <div className="sp-gsearch-results">
      <div className="sp-gsearch-summary">
        <strong>{results.length}</strong> producto{results.length !== 1 ? "s" : ""} en{" "}
        <strong>{groups.length}</strong> proveedor{groups.length !== 1 ? "es" : ""}
      </div>
      {groups.map(({ s, prods }) => (
        <div key={s?.id} className="sp-gsearch-group">
          <div className="sp-gsearch-supplier-row">
            <div className="sp-gsearch-supplier-info">
              <span className="sp-gsearch-supplier-name">{s?.name || "Proveedor"}</span>
              <div className="sp-gsearch-supplier-contact">
                {s?.contact_name && <span>👤 {s.contact_name}</span>}
                {s?.phone        && <a href={`tel:${s.phone}`}>📞 {s.phone}</a>}
                {s?.email        && <a href={`mailto:${s.email}`}>✉ {s.email}</a>}
              </div>
            </div>
            <button className="sp-gsearch-link" onClick={() => onSelectSupplier(s)}>
              Ver ficha →
            </button>
          </div>
          <div className="sp-gsearch-prod-list">
            {prods.map(p => (
              <span key={p.id} className="sp-gsearch-prod-chip">
                {p.name}{p.code ? <em> · {p.code}</em> : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function SuppliersPage({ profile, onNavigate, pageKey }) {
  /* ── suppliers list ── */
  const [suppliers,    setSuppliers]    = useState([]);
  const [loadingList,  setLoadingList]  = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterActive, setFilterActive] = useState(true);
  const [selected,     setSelected]     = useState(null); // supplier object
  const [tab,          setTab]          = useState("info");

  /* ── supplier form ── */
  const [supplierForm, setSupplierForm] = useState(emptySupplier());
  const [formDirty,    setFormDirty]    = useState(false);
  const [savingForm,   setSavingForm]   = useState(false);
  const [showNewForm,  setShowNewForm]  = useState(false);
  const [newForm,      setNewForm]      = useState(emptySupplier());

  /* ── products ── */
  const [products,     setProducts]     = useState([]);
  const [loadingProds, setLoadingProds] = useState(false);
  const [prodSearch,   setProdSearch]   = useState("");
  const [prodLine,     setProdLine]     = useState("");
  const [addingProd,   setAddingProd]   = useState(false);
  const [newProd,      setNewProd]      = useState(emptyProduct());

  /* ── import ── */
  const [importMode,   setImportMode]   = useState("file");   // file | paste
  const [rawRows,      setRawRows]      = useState(null);     // array of arrays
  const [colMapping,   setColMapping]   = useState({});
  const [importing,    setImporting]    = useState(false);
  const [pasteText,    setPasteText]    = useState("");
  const [pastePreview, setPastePreview] = useState(null);
  const [filename,     setFilename]     = useState("");
  const [importHistory, setImportHistory] = useState([]);

  /* ── global search ── */
  const [globalQuery,     setGlobalQuery]     = useState("");
  const [globalResults,   setGlobalResults]   = useState(null);
  const [globalSearching, setGlobalSearching] = useState(false);
  const globalTimer = useRef(null);

  /* ── multi-sheet import ── */
  const [multiOpen,      setMultiOpen]      = useState(false);
  const [multiPreview,   setMultiPreview]   = useState(null); // [{name, products[]}]
  const [multiImporting, setMultiImporting] = useState(false);
  const multiFileRef = useRef();

  const fileRef = useRef();
  const [toast, showToast] = useToast();

  /* ── load suppliers ── */
  useEffect(() => { loadSuppliers(); }, []);

  async function loadSuppliers() {
    setLoadingList(true);
    const { data } = await supabase.from("suppliers").select("*, supplier_products(count)").order("name");
    setSuppliers(data || []);
    setLoadingList(false);
  }

  async function loadProducts(supplierId) {
    setLoadingProds(true);
    const { data } = await supabase.from("supplier_products")
      .select("*").eq("supplier_id", supplierId).eq("is_active", true).order("name");
    setProducts(data || []);
    setLoadingProds(false);
  }

  async function loadImportHistory(supplierId) {
    const { data } = await supabase.from("supplier_imports")
      .select("*").eq("supplier_id", supplierId).order("created_at", { ascending: false }).limit(10);
    setImportHistory(data || []);
  }

  function selectSupplier(s) {
    setSelected(s);
    setSupplierForm({ ...s });
    setFormDirty(false);
    setTab("info");
    setProdSearch(""); setProdLine(""); setAddingProd(false);
    setRawRows(null); setColMapping({}); setPasteText(""); setPastePreview(null);
    if (s) { loadProducts(s.id); loadImportHistory(s.id); }
  }

  /* ── filtered list ── */
  const filtered = useMemo(() => {
    return suppliers.filter(s => {
      if (filterActive && !s.is_active) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return [s.name, s.trade_name, s.contact_name, s.cuit, s.email].join(" ").toLowerCase().includes(q);
    });
  }, [suppliers, search, filterActive]);

  const prodLines = useMemo(() =>
    [...new Set(products.map(p => p.line).filter(Boolean))].sort(), [products]);

  const filteredProds = useMemo(() => {
    return products.filter(p => {
      if (prodLine && p.line !== prodLine) return false;
      if (!prodSearch) return true;
      const q = prodSearch.toLowerCase();
      return [p.code, p.name, p.brand, p.line].join(" ").toLowerCase().includes(q);
    });
  }, [products, prodSearch, prodLine]);

  /* ── supplier CRUD ── */
  async function saveSupplier() {
    if (!supplierForm.name.trim()) { showToast("El nombre es obligatorio", "err"); return; }
    setSavingForm(true);
    const { error } = await supabase.from("suppliers").update({
      name: supplierForm.name.trim(), trade_name: supplierForm.trade_name, cuit: supplierForm.cuit,
      contact_name: supplierForm.contact_name, email: supplierForm.email, phone: supplierForm.phone,
      website: supplierForm.website, address: supplierForm.address,
      payment_terms: supplierForm.payment_terms, notes: supplierForm.notes,
      is_active: supplierForm.is_active,
    }).eq("id", selected.id);
    setSavingForm(false);
    if (error) { showToast("Error al guardar: " + error.message, "err"); return; }
    showToast("Proveedor actualizado ✓");
    setFormDirty(false);
    await loadSuppliers();
    const updated = suppliers.find(s => s.id === selected.id);
    if (updated) setSelected({ ...updated, ...supplierForm });
  }

  async function createSupplier() {
    if (!newForm.name.trim()) { showToast("El nombre es obligatorio", "err"); return; }
    setSavingForm(true);
    const { error } = await supabase.from("suppliers").insert({
      ...newForm, name: newForm.name.trim(), created_by: profile?.id,
    });
    setSavingForm(false);
    if (error) { showToast("Error al crear: " + error.message, "err"); return; }
    showToast("Proveedor creado ✓");
    setShowNewForm(false);
    setNewForm(emptySupplier());
    await loadSuppliers();
  }

  async function toggleActive(s) {
    await supabase.from("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
    await loadSuppliers();
    if (selected?.id === s.id) setSelected(sv => sv ? { ...sv, is_active: !sv.is_active } : sv);
  }

  /* ── product CRUD ── */
  async function saveProduct(prod) {
    const payload = { ...prod, supplier_id: selected.id, price_updated_at: new Date().toISOString() };
    if (prod.id) {
      await supabase.from("supplier_products").update(payload).eq("id", prod.id);
    } else {
      await supabase.from("supplier_products").insert(payload);
      setAddingProd(false); setNewProd(emptyProduct());
    }
    await loadProducts(selected.id);
    showToast("Producto guardado ✓");
  }

  async function deleteProduct(id) {
    if (!window.confirm("¿Eliminás este producto?")) return;
    await supabase.from("supplier_products").update({ is_active: false }).eq("id", id);
    setProducts(p => p.filter(x => x.id !== id));
  }

  /* ── global search ── */
  function handleGlobalSearch(q) {
    setGlobalQuery(q);
    if (!q.trim() || q.trim().length < 2) { setGlobalResults(null); return; }
    clearTimeout(globalTimer.current);
    globalTimer.current = setTimeout(async () => {
      setGlobalSearching(true);
      const { data } = await supabase
        .from("supplier_products")
        .select("id, name, code, brand, line, unit, supplier_id, suppliers(id, name, contact_name, phone, email)")
        .ilike("name", `%${q.trim()}%`)
        .eq("is_active", true)
        .order("name")
        .limit(300);
      setGlobalResults(data || []);
      setGlobalSearching(false);
    }, 350);
  }

  /* ── multi-sheet import ── */
  async function handleMultiFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type: "array" });
    const sheets = wb.SheetNames.map(sheetName => {
      const ws   = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const prods = rows
        .map(r => String(r[0] || "").trim())
        .filter(n => n && n.toLowerCase() !== sheetName.toLowerCase() && n.length > 2);
      return { name: sheetName.trim(), products: prods };
    }).filter(s => s.products.length > 0);
    setMultiPreview(sheets);
    e.target.value = "";
  }

  async function runMultiImport() {
    if (!multiPreview?.length) return;
    setMultiImporting(true);
    let totalProds = 0, suppCount = 0;
    for (const sheet of multiPreview) {
      let supplierId;
      const existing = suppliers.find(s => s.name.trim().toLowerCase() === sheet.name.toLowerCase());
      if (existing) {
        supplierId = existing.id;
      } else {
        const { data: ns } = await supabase.from("suppliers")
          .insert({ name: sheet.name, created_by: profile?.id })
          .select("id").single();
        supplierId = ns?.id;
      }
      if (!supplierId) continue;

      // Full replace: deactivate old products then insert new ones
      await supabase.from("supplier_products").update({ is_active: false }).eq("supplier_id", supplierId);

      const rows = sheet.products.map(name => ({
        supplier_id: supplierId, name, unit: "u.", is_active: true,
        price_updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("supplier_products").insert(rows.slice(i, i + 500));
      }
      await supabase.from("supplier_imports").insert({
        supplier_id: supplierId,
        filename: "Catálogo multi-proveedor (Excel)",
        product_count: sheet.products.length,
        imported_by: profile?.id,
        notes: `${sheet.products.length} productos desde hoja "${sheet.name}"`,
      });
      totalProds += sheet.products.length;
      suppCount++;
    }
    showToast(`${totalProds} productos importados de ${suppCount} proveedores ✓`);
    setMultiImporting(false);
    setMultiOpen(false);
    setMultiPreview(null);
    await loadSuppliers();
  }

  /* ── FILE IMPORT ── */
  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setFilename(file.name);
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type: "array" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim()));
    setRawRows(nonEmpty);
    const headers = nonEmpty[0]?.map(h => String(h)) || [];
    setColMapping(guessMapping(headers));
    e.target.value = "";
  }

  function mappedValue(row, field) {
    const idx = colMapping[field];
    if (idx == null || idx === "") return "";
    return String(row[parseInt(idx, 10)] || "").trim();
  }

  const previewRows = useMemo(() => {
    if (!rawRows || rawRows.length < 2) return [];
    return rawRows.slice(1, 6);
  }, [rawRows]);

  const importCount = rawRows ? rawRows.length - 1 : 0;

  async function runImport() {
    if (!rawRows || !colMapping.name) { showToast("Mapeá al menos el campo Nombre", "err"); return; }
    setImporting(true);
    const rows = rawRows.slice(1).filter(r => r.some(c => String(c).trim()));
    const products = rows.map(r => ({
      supplier_id: selected.id,
      code:     mappedValue(r, "code")     || null,
      name:     mappedValue(r, "name")     || "Sin nombre",
      brand:    mappedValue(r, "brand")    || null,
      line:     mappedValue(r, "line")     || null,
      unit:     mappedValue(r, "unit")     || "u.",
      price:    parseFloat(mappedValue(r, "price").replace(/[^\d.,]/g, "").replace(",", ".")) || null,
      currency: mappedValue(r, "currency")?.toUpperCase() === "USD" ? "USD" : "ARS",
      price_updated_at: new Date().toISOString(),
    })).filter(p => p.name && p.name !== "Sin nombre" || p.code);

    // Upsert by (supplier_id, code) or insert if no code
    const withCode    = products.filter(p => p.code);
    const withoutCode = products.filter(p => !p.code);

    let err;
    if (withCode.length) {
      const res = await supabase.from("supplier_products")
        .upsert(withCode, { onConflict: "supplier_id,code", ignoreDuplicates: false });
      err = res.error;
    }
    if (!err && withoutCode.length) {
      const res = await supabase.from("supplier_products").insert(withoutCode);
      err = res.error;
    }

    if (err) { showToast("Error en importación: " + err.message, "err"); setImporting(false); return; }

    await supabase.from("supplier_imports").insert({
      supplier_id: selected.id, filename, product_count: products.length,
      imported_by: profile?.id, notes: `Importado desde ${filename}`,
    });

    showToast(`${products.length} productos importados ✓`);
    setImporting(false);
    setRawRows(null); setColMapping({}); setFilename("");
    await loadProducts(selected.id);
    await loadImportHistory(selected.id);
    await loadSuppliers();
  }

  /* ── PASTE IMPORT ── */
  function analyzePaste() {
    const rows = parsePastedText(pasteText);
    if (!rows.length) { showToast("No se detectaron productos en el texto", "err"); return; }
    setPastePreview(rows);
  }

  async function confirmPasteImport() {
    if (!pastePreview?.length) return;
    setImporting(true);
    const rows = pastePreview.map(p => ({ ...p, supplier_id: selected.id, price_updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("supplier_products").insert(rows);
    if (error) { showToast("Error: " + error.message, "err"); setImporting(false); return; }

    await supabase.from("supplier_imports").insert({
      supplier_id: selected.id, filename: "Texto pegado", product_count: rows.length,
      imported_by: profile?.id, notes: "Importado desde texto (PDF)",
    });
    showToast(`${rows.length} productos importados ✓`);
    setPasteText(""); setPastePreview(null); setImporting(false);
    await loadProducts(selected.id);
    await loadImportHistory(selected.id);
    await loadSuppliers();
  }

  /* ── stats ── */
  const totalProds = suppliers.reduce((s, x) => s + (x.supplier_products?.[0]?.count || 0), 0);
  const activeCount = suppliers.filter(s => s.is_active).length;

  /* ════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════ */
  const setF = (k, v) => { setSupplierForm(f => ({ ...f, [k]: v })); setFormDirty(true); };

  return (
    <Layout title="Proveedores" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="sp-page">

        {toast && <div className={`sp-toast sp-toast--${toast.type}`}>{toast.text}</div>}

        {/* ── Global search ── */}
        <div className="sp-global-search-wrap">
          <span className="sp-global-search-icon">🔍</span>
          <input
            className="sp-global-search"
            placeholder="Buscá un producto en TODOS los proveedores… ej: algodón, osmosis, aguja, guante"
            value={globalQuery}
            onChange={e => handleGlobalSearch(e.target.value)}
          />
          {globalQuery && (
            <button className="sp-global-clear" onClick={() => { setGlobalQuery(""); setGlobalResults(null); }} title="Limpiar búsqueda">✕</button>
          )}
        </div>

        {/* ── Stats + multi-import button ── */}
        <div className="sp-stats-row">
          <div className="sp-stats">
            <div className="sp-stat"><span className="sp-stat__n">{activeCount}</span><span className="sp-stat__l">Proveedores activos</span></div>
            <div className="sp-stat"><span className="sp-stat__n">{suppliers.length}</span><span className="sp-stat__l">Total proveedores</span></div>
            <div className="sp-stat"><span className="sp-stat__n">{totalProds.toLocaleString("es-AR")}</span><span className="sp-stat__l">Productos en catálogo</span></div>
          </div>
          <button className="sp-btn sp-btn--outline" onClick={() => setMultiOpen(true)}>
            📥 Importar catálogo completo
          </button>
        </div>

        {/* ── Global search results ── */}
        {globalResults !== null && (
          <GlobalSearchResults
            results={globalResults}
            loading={globalSearching}
            query={globalQuery}
            onSelectSupplier={s => {
              setGlobalQuery(""); setGlobalResults(null);
              const full = suppliers.find(x => x.id === s?.id);
              if (full) selectSupplier(full);
            }}
          />
        )}

        {globalResults === null && <div className="sp-layout">

          {/* ══ LEFT PANEL: supplier list ══ */}
          <aside className="sp-list-panel">
            <div className="sp-list-toolbar">
              <input
                className="sp-search"
                placeholder="Buscar proveedor…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="sp-list-actions">
                <button
                  className={`sp-filter-btn${filterActive ? " active" : ""}`}
                  onClick={() => setFilterActive(v => !v)}
                  title={filterActive ? "Ver todos" : "Solo activos"}
                >
                  {filterActive ? "Activos" : "Todos"}
                </button>
                <button className="sp-btn sp-btn--primary sp-btn--sm" onClick={() => setShowNewForm(true)}>
                  + Nuevo
                </button>
              </div>
            </div>

            {loadingList ? (
              <div className="sp-list-empty">Cargando…</div>
            ) : filtered.length === 0 ? (
              <div className="sp-list-empty">Sin proveedores{search ? " que coincidan" : ""}</div>
            ) : (
              <div className="sp-list">
                {filtered.map(s => {
                  const count = s.supplier_products?.[0]?.count || 0;
                  return (
                    <button
                      key={s.id}
                      className={`sp-list-item${selected?.id === s.id ? " sp-list-item--active" : ""}${!s.is_active ? " sp-list-item--inactive" : ""}`}
                      onClick={() => selectSupplier(s)}
                    >
                      <div className="sp-list-item__name">{s.name}</div>
                      {s.trade_name && <div className="sp-list-item__sub">{s.trade_name}</div>}
                      <div className="sp-list-item__meta">
                        {s.contact_name && <span>{s.contact_name}</span>}
                        <span className="sp-prod-badge">{count} prod.</span>
                        {!s.is_active && <span className="sp-inactive-badge">Inactivo</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* ══ RIGHT PANEL: detail ══ */}
          <section className="sp-detail">
            {!selected && (
              <div className="sp-empty-state">
                <div className="sp-empty-state__icon">🏭</div>
                <div className="sp-empty-state__title">Seleccioná un proveedor</div>
                <div className="sp-empty-state__sub">o creá uno nuevo con el botón "+ Nuevo"</div>
              </div>
            )}

            {selected && (
              <>
                {/* Detail header */}
                <div className="sp-detail-header">
                  <div>
                    <h2 className="sp-detail-name">{selected.name}</h2>
                    {selected.trade_name && <span className="sp-detail-sub">{selected.trade_name}</span>}
                  </div>
                  <div className="sp-detail-header-actions">
                    <button
                      className={`sp-badge-btn${selected.is_active ? " sp-badge-btn--green" : " sp-badge-btn--red"}`}
                      onClick={() => toggleActive(selected)}
                      title="Cambiar estado"
                    >
                      {selected.is_active ? "Activo" : "Inactivo"}
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="sp-tabs">
                  {[["info","📋 Info"],["catalog","📦 Catálogo ("+products.length+")"],["import","⬆ Importar"],["history","🕐 Historial"]].map(([id, label]) => (
                    <button key={id} className={`sp-tab${tab === id ? " sp-tab--active" : ""}`} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── TAB: INFO ── */}
                {tab === "info" && (
                  <div className="sp-tab-body">
                    <div className="sp-form-grid">
                      <div className="sp-field sp-field--full">
                        <label>Nombre del proveedor *</label>
                        <input value={supplierForm.name} onChange={e => setF("name", e.target.value)} placeholder="Razón social"/>
                      </div>
                      <div className="sp-field">
                        <label>Nombre comercial</label>
                        <input value={supplierForm.trade_name||""} onChange={e => setF("trade_name", e.target.value)} placeholder="Como lo conocen"/>
                      </div>
                      <div className="sp-field">
                        <label>CUIT</label>
                        <input value={supplierForm.cuit||""} onChange={e => setF("cuit", e.target.value)} placeholder="XX-XXXXXXXX-X"/>
                      </div>
                      <div className="sp-field">
                        <label>Contacto principal</label>
                        <input value={supplierForm.contact_name||""} onChange={e => setF("contact_name", e.target.value)} placeholder="Nombre y apellido"/>
                      </div>
                      <div className="sp-field">
                        <label>Email</label>
                        <input type="email" value={supplierForm.email||""} onChange={e => setF("email", e.target.value)} placeholder="mail@proveedor.com"/>
                      </div>
                      <div className="sp-field">
                        <label>Teléfono</label>
                        <input value={supplierForm.phone||""} onChange={e => setF("phone", e.target.value)} placeholder="+54 11 XXXX-XXXX"/>
                      </div>
                      <div className="sp-field">
                        <label>Sitio web</label>
                        <input value={supplierForm.website||""} onChange={e => setF("website", e.target.value)} placeholder="https://"/>
                      </div>
                      <div className="sp-field">
                        <label>Condiciones de pago</label>
                        <input value={supplierForm.payment_terms||""} onChange={e => setF("payment_terms", e.target.value)} placeholder="Ej: 30 días, contado, etc."/>
                      </div>
                      <div className="sp-field sp-field--full">
                        <label>Dirección</label>
                        <input value={supplierForm.address||""} onChange={e => setF("address", e.target.value)} placeholder="Calle, ciudad, provincia"/>
                      </div>
                      <div className="sp-field sp-field--full">
                        <label>Notas internas</label>
                        <textarea rows={3} value={supplierForm.notes||""} onChange={e => setF("notes", e.target.value)} placeholder="Información adicional, contactos secundarios, etc."/>
                      </div>
                    </div>
                    {formDirty && (
                      <div className="sp-form-footer">
                        <button className="sp-btn sp-btn--ghost" onClick={() => { setSupplierForm({ ...selected }); setFormDirty(false); }}>Cancelar</button>
                        <button className="sp-btn sp-btn--primary" onClick={saveSupplier} disabled={savingForm}>
                          {savingForm ? "Guardando…" : "Guardar cambios"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: CATALOG ── */}
                {tab === "catalog" && (
                  <div className="sp-tab-body">
                    <div className="sp-prod-toolbar">
                      <input
                        className="sp-search sp-search--sm"
                        placeholder="Buscar en catálogo…"
                        value={prodSearch}
                        onChange={e => setProdSearch(e.target.value)}
                      />
                      {prodLines.length > 0 && (
                        <select className="sp-select" value={prodLine} onChange={e => setProdLine(e.target.value)}>
                          <option value="">Todas las líneas</option>
                          {prodLines.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      )}
                      <button className="sp-btn sp-btn--primary sp-btn--sm" onClick={() => setAddingProd(true)}>
                        + Agregar
                      </button>
                    </div>

                    {loadingProds ? (
                      <div className="sp-list-empty">Cargando catálogo…</div>
                    ) : (
                      <div className="sp-prod-table-wrap">
                        <table className="sp-prod-table">
                          <thead>
                            <tr>
                              <th>Código</th><th>Nombre / Descripción</th><th>Marca</th>
                              <th>Línea</th><th>Und.</th><th>Precio</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {addingProd && (
                              <tr className="sp-prod-row sp-prod-row--editing">
                                <td><input className="sp-td-input" value={newProd.code} onChange={e => setNewProd(p=>({...p,code:e.target.value}))} placeholder="Cód."/></td>
                                <td><input className="sp-td-input sp-td-input--wide" value={newProd.name} onChange={e => setNewProd(p=>({...p,name:e.target.value}))} placeholder="Nombre *"/></td>
                                <td><input className="sp-td-input" value={newProd.brand} onChange={e => setNewProd(p=>({...p,brand:e.target.value}))} placeholder="Marca"/></td>
                                <td>
                                  <input className="sp-td-input" value={newProd.line} onChange={e => setNewProd(p=>({...p,line:e.target.value}))} placeholder="Línea" list="new-lines"/>
                                  <datalist id="new-lines">{prodLines.map(l=><option key={l} value={l}/>)}</datalist>
                                </td>
                                <td><input className="sp-td-input sp-td-input--sm" value={newProd.unit} onChange={e => setNewProd(p=>({...p,unit:e.target.value}))} placeholder="u."/></td>
                                <td>
                                  <div className="sp-price-inline">
                                    <select className="sp-td-select" value={newProd.currency} onChange={e => setNewProd(p=>({...p,currency:e.target.value}))}>
                                      <option value="ARS">$</option><option value="USD">U$D</option>
                                    </select>
                                    <input className="sp-td-input sp-td-input--price" type="number" value={newProd.price} onChange={e => setNewProd(p=>({...p,price:e.target.value}))} placeholder="0"/>
                                  </div>
                                </td>
                                <td className="sp-td sp-td--actions">
                                  <button className="sp-icon-btn sp-icon-btn--save" onClick={() => saveProduct(newProd)} title="Guardar">✓</button>
                                  <button className="sp-icon-btn" onClick={() => setAddingProd(false)} title="Cancelar">✕</button>
                                </td>
                              </tr>
                            )}
                            {filteredProds.length === 0 && !addingProd && (
                              <tr><td colSpan={7} className="sp-table-empty">
                                {products.length === 0
                                  ? "Sin productos. Usá \"+ Agregar\" o importá desde la pestaña Importar."
                                  : "No hay productos que coincidan con la búsqueda."}
                              </td></tr>
                            )}
                            {filteredProds.map(p => (
                              <ProductRow key={p.id} prod={p} lines={prodLines} onSave={saveProduct} onDelete={deleteProduct}/>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: IMPORT ── */}
                {tab === "import" && (
                  <div className="sp-tab-body">
                    <div className="sp-import-mode-tabs">
                      <button className={`sp-mode-btn${importMode==="file"?" active":""}`} onClick={()=>{setImportMode("file");setRawRows(null);}}>
                        📂 Excel / CSV
                      </button>
                      <button className={`sp-mode-btn${importMode==="paste"?" active":""}`} onClick={()=>{setImportMode("paste");setPastePreview(null);}}>
                        📋 Pegar texto (PDF)
                      </button>
                    </div>

                    {/* FILE MODE */}
                    {importMode === "file" && (
                      <div className="sp-import-section">
                        {!rawRows && (
                          <div
                            className="sp-drop-zone"
                            onClick={() => fileRef.current?.click()}
                            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("sp-drop-zone--over"); }}
                            onDragLeave={e => e.currentTarget.classList.remove("sp-drop-zone--over")}
                            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("sp-drop-zone--over"); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; handleFile({ target: fileRef.current }); } }}
                          >
                            <div className="sp-drop-zone__icon">📊</div>
                            <div className="sp-drop-zone__title">Arrastrá o hacé click para subir</div>
                            <div className="sp-drop-zone__sub">.xlsx · .xls · .csv — La primera fila debe ser el encabezado</div>
                            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleFile}/>
                          </div>
                        )}

                        {rawRows && (
                          <div className="sp-import-config">
                            <div className="sp-import-file-info">
                              <span className="sp-import-filename">📊 {filename}</span>
                              <span className="sp-import-count">{importCount} filas detectadas</span>
                              <button className="sp-link-btn" onClick={() => { setRawRows(null); setColMapping({}); setFilename(""); }}>Cambiar archivo</button>
                            </div>

                            {/* Column mapping */}
                            <div className="sp-mapping-section">
                              <div className="sp-mapping-title">Mapeo de columnas</div>
                              <div className="sp-mapping-hint">Seleccioná qué columna de tu archivo corresponde a cada campo. El campo <strong>Nombre</strong> es obligatorio.</div>
                              <div className="sp-mapping-grid">
                                {FIELD_ORDER.map(field => {
                                  const headers = rawRows[0] || [];
                                  return (
                                    <div key={field} className="sp-mapping-row">
                                      <label className={`sp-mapping-label${field==="name"?" sp-mapping-label--req":""}`}>
                                        {FIELD_LABELS[field]}{field==="name"?" *":""}
                                      </label>
                                      <select
                                        className="sp-select"
                                        value={colMapping[field] ?? ""}
                                        onChange={e => setColMapping(m => ({ ...m, [field]: e.target.value }))}
                                      >
                                        <option value="">— No mapear —</option>
                                        {headers.map((h, i) => (
                                          <option key={i} value={String(i)}>{String(h) || `Columna ${i+1}`}</option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Preview */}
                            {previewRows.length > 0 && (
                              <div className="sp-preview-section">
                                <div className="sp-mapping-title">Vista previa (primeras 5 filas)</div>
                                <div className="sp-preview-table-wrap">
                                  <table className="sp-preview-table">
                                    <thead>
                                      <tr>
                                        {FIELD_ORDER.filter(f => colMapping[f] != null && colMapping[f] !== "").map(f => (
                                          <th key={f}>{FIELD_LABELS[f]}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {previewRows.map((row, ri) => (
                                        <tr key={ri}>
                                          {FIELD_ORDER.filter(f => colMapping[f] != null && colMapping[f] !== "").map(f => (
                                            <td key={f}>{mappedValue(row, f) || <span className="sp-muted">—</span>}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            <div className="sp-import-footer">
                              <button className="sp-btn sp-btn--primary" onClick={runImport} disabled={importing || !colMapping.name}>
                                {importing ? "Importando…" : `Importar ${importCount} productos`}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* PASTE MODE */}
                    {importMode === "paste" && (
                      <div className="sp-import-section">
                        <div className="sp-paste-hint">
                          Abrí el PDF en tu visor, seleccioná todo el texto (Ctrl+A), copiá (Ctrl+C) y pegalo acá. El sistema detecta automáticamente los productos.
                        </div>
                        <textarea
                          className="sp-paste-area"
                          rows={12}
                          placeholder={"Pegá el contenido del PDF aquí…\n\nEjemplo:\nABC123  Osmosis Portatil PW-1  ULTRAPURA  $12,500\nDEF456  Filtro de carbon activado  AQUA  $3,200"}
                          value={pasteText}
                          onChange={e => { setPasteText(e.target.value); setPastePreview(null); }}
                        />
                        {!pastePreview && (
                          <button className="sp-btn sp-btn--primary" onClick={analyzePaste} disabled={!pasteText.trim()}>
                            🔍 Detectar productos
                          </button>
                        )}
                        {pastePreview && (
                          <div className="sp-paste-preview">
                            <div className="sp-import-file-info">
                              <span className="sp-import-count">{pastePreview.length} productos detectados</span>
                              <button className="sp-link-btn" onClick={() => setPastePreview(null)}>Volver a editar</button>
                            </div>
                            <div className="sp-preview-table-wrap">
                              <table className="sp-preview-table">
                                <thead><tr><th>Código</th><th>Nombre</th><th>Precio</th><th>Moneda</th></tr></thead>
                                <tbody>
                                  {pastePreview.slice(0, 10).map((p, i) => (
                                    <tr key={i}>
                                      <td>{p.code || <span className="sp-muted">—</span>}</td>
                                      <td>{p.name}</td>
                                      <td>{p.price || <span className="sp-muted">—</span>}</td>
                                      <td>{p.currency}</td>
                                    </tr>
                                  ))}
                                  {pastePreview.length > 10 && (
                                    <tr><td colSpan={4} className="sp-table-empty">… y {pastePreview.length - 10} más</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="sp-paste-note">
                              Revisá los datos antes de confirmar. Si algo no quedó bien, podés editar el texto y analizar de nuevo.
                            </div>
                            <div className="sp-import-footer">
                              <button className="sp-btn sp-btn--primary" onClick={confirmPasteImport} disabled={importing}>
                                {importing ? "Importando…" : `Confirmar ${pastePreview.length} productos`}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: HISTORY ── */}
                {tab === "history" && (
                  <div className="sp-tab-body">
                    {importHistory.length === 0 ? (
                      <div className="sp-list-empty">Sin importaciones registradas para este proveedor.</div>
                    ) : (
                      <div className="sp-history-list">
                        {importHistory.map(h => (
                          <div key={h.id} className="sp-history-item">
                            <div className="sp-history-item__icon">📊</div>
                            <div className="sp-history-item__body">
                              <div className="sp-history-item__name">{h.filename || "Importación"}</div>
                              <div className="sp-history-item__meta">{h.notes}</div>
                            </div>
                            <div className="sp-history-item__right">
                              <span className="sp-history-item__count">{h.product_count} prod.</span>
                              <span className="sp-history-item__date">{fmtDate(h.created_at)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>}

        {/* ══ MULTI-SHEET IMPORT MODAL ══ */}
        {multiOpen && (
          <div className="sp-overlay" onClick={e => e.target === e.currentTarget && setMultiOpen(false)}>
            <div className="sp-modal sp-modal--wide">
              <div className="sp-modal__head">
                <h3>📥 Importar catálogo completo (multi-proveedor)</h3>
                <button className="sp-modal__close" onClick={() => { setMultiOpen(false); setMultiPreview(null); }}>✕</button>
              </div>
              <div style={{ padding: "16px 20px" }}>
                {!multiPreview && (
                  <>
                    <div className="sp-paste-hint" style={{ marginBottom: 16 }}>
                      <strong>Formato esperado:</strong> Excel con múltiples hojas. El nombre de cada solapa es el proveedor. La columna A de cada hoja tiene los productos (fila 1 puede ser el nombre del proveedor, se ignora automáticamente).
                    </div>
                    <div
                      className="sp-drop-zone"
                      onClick={() => multiFileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("sp-drop-zone--over"); }}
                      onDragLeave={e => e.currentTarget.classList.remove("sp-drop-zone--over")}
                      onDrop={e => {
                        e.preventDefault(); e.currentTarget.classList.remove("sp-drop-zone--over");
                        const f = e.dataTransfer.files[0];
                        if (f) { const dt = new DataTransfer(); dt.items.add(f); multiFileRef.current.files = dt.files; handleMultiFile({ target: multiFileRef.current }); }
                      }}
                    >
                      <div className="sp-drop-zone__icon">📊</div>
                      <div className="sp-drop-zone__title">Arrastrá o hacé click para subir el Excel</div>
                      <div className="sp-drop-zone__sub">.xlsx · .xls — Una hoja por proveedor</div>
                      <input ref={multiFileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleMultiFile}/>
                    </div>
                  </>
                )}

                {multiPreview && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="sp-import-file-info">
                      <span className="sp-import-count">
                        Se detectaron <strong>{multiPreview.length} proveedores</strong> con{" "}
                        <strong>{multiPreview.reduce((s, x) => s + x.products.length, 0).toLocaleString("es-AR")} productos</strong> en total
                      </span>
                      <button className="sp-link-btn" onClick={() => setMultiPreview(null)}>Cambiar archivo</button>
                    </div>
                    <div className="sp-multi-preview-list">
                      {multiPreview.map(sheet => {
                        const existing = suppliers.find(s => s.name.trim().toLowerCase() === sheet.name.toLowerCase());
                        return (
                          <div key={sheet.name} className="sp-multi-preview-row">
                            <div className="sp-multi-preview-name">
                              {sheet.name}
                              {existing
                                ? <span className="sp-multi-badge sp-multi-badge--update">Actualiza existente</span>
                                : <span className="sp-multi-badge sp-multi-badge--new">Nuevo proveedor</span>
                              }
                            </div>
                            <div className="sp-multi-preview-count">{sheet.products.length} productos</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="sp-paste-note">
                      Los proveedores existentes se actualizarán (reemplaza su catálogo). Los nuevos se crean automáticamente.
                    </div>
                  </div>
                )}
              </div>
              <div className="sp-modal__foot">
                <button className="sp-btn sp-btn--ghost" onClick={() => { setMultiOpen(false); setMultiPreview(null); }}>Cancelar</button>
                {multiPreview && (
                  <button className="sp-btn sp-btn--primary" onClick={runMultiImport} disabled={multiImporting}>
                    {multiImporting ? "Importando…" : `Importar ${multiPreview.reduce((s, x) => s + x.products.length, 0).toLocaleString("es-AR")} productos`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══ NEW SUPPLIER MODAL ══ */}
        {showNewForm && (
          <div className="sp-overlay" onClick={e => e.target === e.currentTarget && setShowNewForm(false)}>
            <div className="sp-modal">
              <div className="sp-modal__head">
                <h3>Nuevo proveedor</h3>
                <button className="sp-modal__close" onClick={() => setShowNewForm(false)}>✕</button>
              </div>
              <div className="sp-form-grid">
                <div className="sp-field sp-field--full">
                  <label>Nombre / Razón social *</label>
                  <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="Razón social del proveedor" autoFocus/>
                </div>
                <div className="sp-field">
                  <label>Nombre comercial</label>
                  <input value={newForm.trade_name||""} onChange={e => setNewForm(f => ({ ...f, trade_name: e.target.value }))} placeholder="Como lo conocen"/>
                </div>
                <div className="sp-field">
                  <label>CUIT</label>
                  <input value={newForm.cuit||""} onChange={e => setNewForm(f => ({ ...f, cuit: e.target.value }))} placeholder="XX-XXXXXXXX-X"/>
                </div>
                <div className="sp-field">
                  <label>Contacto</label>
                  <input value={newForm.contact_name||""} onChange={e => setNewForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Nombre y apellido"/>
                </div>
                <div className="sp-field">
                  <label>Email</label>
                  <input type="email" value={newForm.email||""} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} placeholder="mail@proveedor.com"/>
                </div>
                <div className="sp-field">
                  <label>Teléfono</label>
                  <input value={newForm.phone||""} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} placeholder="+54 11 XXXX-XXXX"/>
                </div>
                <div className="sp-field">
                  <label>Condiciones de pago</label>
                  <input value={newForm.payment_terms||""} onChange={e => setNewForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="Contado, 30 días, etc."/>
                </div>
                <div className="sp-field">
                  <label>Sitio web</label>
                  <input value={newForm.website||""} onChange={e => setNewForm(f => ({ ...f, website: e.target.value }))} placeholder="https://"/>
                </div>
              </div>
              <div className="sp-modal__foot">
                <button className="sp-btn sp-btn--ghost" onClick={() => setShowNewForm(false)}>Cancelar</button>
                <button className="sp-btn sp-btn--primary" onClick={createSupplier} disabled={savingForm}>
                  {savingForm ? "Creando…" : "Crear proveedor"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
