import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileText,
  Layers3,
  MessageCircle,
  PackageOpen,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./products.css";

const PRODUCT_LINES = [
  "EchoLaser",
  "Osypka",
  "Diálisis",
  "Nutrición Clínica",
  "VAC",
  "Kangaroo",
  "Otro",
];

const MATERIALS = [
  { key: "brochure_url", label: "Brochure", Icon: FileText },
  { key: "tech_sheet_url", label: "Ficha técnica", Icon: FileSpreadsheet },
  { key: "video_url", label: "Video", Icon: PlayCircle },
];

const EMPTY_FORM = {
  name: "",
  line: "EchoLaser",
  speech: "",
  brochure_url: "",
  tech_sheet_url: "",
  video_url: "",
  supplier: "",
  sku: "",
  brand: "",
  base_price: "",
};

export default function ProductsPage({ profile, onNavigate }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("Todas");
  const [readinessFilter, setReadinessFilter] = useState("todos");

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert("Error cargando productos: " + error.message);
      return;
    }

    setProducts(data || []);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditorOpen(false);
  }

  function scrollToEditor() {
    window.setTimeout(() => {
      document.getElementById("products-editor")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  function openNewProduct() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditorOpen(true);
    scrollToEditor();
  }

  function editProduct(product) {
    setEditingId(product.id);
    setEditorOpen(true);
    setForm({
      name: product.name || "",
      line: product.line || "EchoLaser",
      speech: product.speech || "",
      brochure_url: product.brochure_url || "",
      tech_sheet_url: product.tech_sheet_url || "",
      video_url: product.video_url || "",
      supplier: product.supplier || "",
      sku: product.sku || "",
      brand: product.brand || "",
      base_price: product.base_price || "",
    });

    scrollToEditor();
  }

  async function saveProduct(e) {
    e.preventDefault();
    setLoading(true);

    const result = editingId
      ? await supabase.from("products").update(form).eq("id", editingId)
      : await supabase.from("products").insert([form]);

    setLoading(false);

    if (result.error) {
      alert("Error guardando producto: " + result.error.message);
      return;
    }

    resetForm();
    await loadProducts();
  }

  async function deleteProduct(id) {
    const ok = confirm("¿Seguro querés borrar este producto?");
    if (!ok) return;

    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) {
      alert("Error eliminando producto: " + error.message);
      return;
    }

    await loadProducts();
  }

  function buildShareText(product) {
    return `Hola, te comparto información sobre ${product.name}.

${product.speech || ""}

${product.brochure_url ? `Brochure: ${product.brochure_url}` : ""}
${product.tech_sheet_url ? `Ficha técnica: ${product.tech_sheet_url}` : ""}
${product.video_url ? `Video: ${product.video_url}` : ""}

Quedo atento para coordinar una presentación.`;
  }

  function shareWhatsApp(product) {
    const text = buildShareText(product);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  async function copyShareKit(product) {
    await navigator.clipboard.writeText(buildShareText(product));
    alert("Share Kit copiado.");
  }

  function materialCount(product) {
    return MATERIALS.filter((material) => product[material.key]).length;
  }

  function isReadyToShare(product) {
    return Boolean(product.speech?.trim()) && materialCount(product) > 0;
  }

  const total = products.length;
  const readyToShare = products.filter(isReadyToShare).length;
  const completeKits = products.filter((product) => materialCount(product) === MATERIALS.length).length;
  const needsAttention = total - readyToShare;
  const activeLines = new Set(products.map((product) => product.line).filter(Boolean)).size;
  const coverage = total ? Math.round((readyToShare / total) * 100) : 0;

  const lineOptions = useMemo(() => {
    return [...new Set([...PRODUCT_LINES, ...products.map((product) => product.line).filter(Boolean)])];
  }, [products]);

  const lineSummary = useMemo(() => {
    return [...new Set(products.map((product) => product.line || "Sin línea"))]
      .map((line) => ({
        line,
        count: products.filter((product) => (product.line || "Sin línea") === line).length,
      }))
      .sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch = !query || [product.name, product.line, product.speech, product.supplier, product.sku, product.brand]
        .some((value) => value?.toLowerCase().includes(query));
      const matchesLine = lineFilter === "Todas" || product.line === lineFilter;
      const matchesReadiness =
        readinessFilter === "todos" ||
        (readinessFilter === "listos" && isReadyToShare(product)) ||
        (readinessFilter === "incompletos" && !isReadyToShare(product));

      return matchesSearch && matchesLine && matchesReadiness;
    });
  }, [lineFilter, products, readinessFilter, search]);

  function clearFilters() {
    setSearch("");
    setLineFilter("Todas");
    setReadinessFilter("todos");
  }

  return (
    <Layout title="Productos / Share Kit" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* Metrics Panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Productos / Share Kit</span>
              <span className="p-sub">Biblioteca comercial para preparar visitas y compartir materiales con el equipo.</span>
            </div>
            <div className="p-hd-right">
              <button type="button" className="p-btn p-btn--primary" onClick={openNewProduct}>
                <Plus size={17} />
                Nuevo producto
              </button>
            </div>
          </div>

          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Productos cargados</span>
              <span className="p-metric__val">{total}</span>
              <span className="p-metric__sub">{activeLines} líneas activas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Listos para compartir</span>
              <span className="p-metric__val p-metric__up">{readyToShare}</span>
              <span className="p-metric__sub">{coverage}% del catálogo</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Material completo</span>
              <span className="p-metric__val">{completeKits}</span>
              <span className="p-metric__sub">Brochure, ficha y video</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Requieren atención</span>
              <span className={`p-metric__val ${needsAttention ? "p-metric__down" : "p-metric__up"}`}>{needsAttention}</span>
              <span className="p-metric__sub">Sin speech o sin material</span>
            </div>
          </div>

          <div className="p-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Layers3 size={19} style={{ color: "var(--p-gray, #888)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <span className="p-sub" style={{ marginRight: 8 }}>Preparación comercial</span>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>
                {coverage}% del catálogo está listo para usar en una visita.
              </span>
              <div className="p-sub" style={{ marginTop: 2 }}>
                {needsAttention
                  ? `${needsAttention} producto${needsAttention === 1 ? "" : "s"} necesita${needsAttention === 1 ? "" : "n"} completar speech o materiales.`
                  : "Todos los productos tienen material disponible para compartir."}
              </div>
            </div>
            {needsAttention > 0 && (
              <button type="button" className="p-btn p-btn--ghost" onClick={() => setReadinessFilter("incompletos")}>
                Revisar pendientes
              </button>
            )}
          </div>
        </div>

        {/* Catalog Panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Share Kit por producto</span>
              <span className="p-sub">Encontrá rápidamente el speech y el material indicado para cada visita.</span>
            </div>
            <div className="p-hd-right">
              <span className="p-sub">{filteredProducts.length} de {total} productos</span>
            </div>
          </div>

          <div className="p-toolbar--top" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="p-search" style={{ flex: 1 }}>
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por producto, línea o contenido del speech..."
              />
            </label>
            <select
              className="p-select"
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
            >
              <option>Todas</option>
              {lineOptions.map((line) => <option key={line}>{line}</option>)}
            </select>
            <select
              className="p-select"
              value={readinessFilter}
              onChange={(event) => setReadinessFilter(event.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="listos">Listos para compartir</option>
              <option value="incompletos">Requieren atención</option>
            </select>
            {(search || lineFilter !== "Todas" || readinessFilter !== "todos") && (
              <button type="button" className="p-btn p-btn--ghost p-btn--icon" onClick={clearFilters} title="Limpiar filtros">
                <X size={17} />
              </button>
            )}
          </div>

          {lineSummary.length > 0 && (
            <div className="p-pills" style={{ padding: "8px 16px", borderBottom: "1px solid #222" }}>
              <button
                type="button"
                className={`p-pill ${lineFilter === "Todas" ? "p-pill--active" : ""}`}
                onClick={() => setLineFilter("Todas")}
              >
                Todas <strong>{total}</strong>
              </button>
              {lineSummary.map(({ line, count }) => (
                <button
                  type="button"
                  className={`p-pill ${lineFilter === line ? "p-pill--active" : ""}`}
                  key={line}
                  onClick={() => setLineFilter(line)}
                >
                  {line} <strong>{count}</strong>
                </button>
              ))}
            </div>
          )}

          <div className="p-list">
            {filteredProducts.length === 0 ? (
              <div className="p-empty">
                <div style={{ fontWeight: 500, color: "#fff", marginBottom: 4 }}>
                  {products.length ? "No encontramos productos con esos filtros" : "No hay productos cargados"}
                </div>
                <div className="p-sub">
                  {products.length
                    ? "Probá otra búsqueda o limpiá los filtros para volver a ver el catálogo completo."
                    : "Creá el primer producto para que el equipo pueda compartir speech, brochure y ficha técnica desde el CRM."}
                </div>
                <button
                  type="button"
                  className="p-btn p-btn--ghost"
                  style={{ marginTop: 12 }}
                  onClick={products.length ? clearFilters : openNewProduct}
                >
                  {products.length ? "Limpiar filtros" : "Crear primer producto"}
                </button>
              </div>
            ) : (
              filteredProducts.map((p) => {
                const resources = materialCount(p);
                const ready = isReadyToShare(p);

                return (
                  <div className="p-row" key={p.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 0, padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <span className={`p-badge--${ready ? "blue" : "amber"}`} style={{ marginRight: 8 }}>
                          {p.line || "Sin línea"}
                        </span>
                        <span className="p-row__name">{p.name}</span>
                      </div>
                      <span className={`p-badge--${ready ? "green" : "red"}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {ready ? "Listo para compartir" : "Completar kit"}
                      </span>
                    </div>

                    <div style={{ marginBottom: 8 }}>
                      <div className="p-section__label" style={{ marginBottom: 4 }}>Speech comercial</div>
                      <div className="p-sub" style={{ fontSize: 12, lineHeight: 1.5 }}>
                        {p.speech || "Todavía no se cargó un speech comercial para este producto."}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div className="p-section__label">Material disponible</div>
                      <span className="p-sub">{resources}/{MATERIALS.length}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {MATERIALS.map(({ key, label, Icon }) => p[key] ? (
                          <a
                            href={p[key]}
                            target="_blank"
                            rel="noreferrer"
                            key={key}
                            className="p-btn p-btn--ghost"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "4px 10px", height: "auto" }}
                          >
                            <Icon size={13} />
                            {label}
                          </a>
                        ) : (
                          <span
                            key={key}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#444", padding: "4px 10px" }}
                          >
                            <Icon size={13} />
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-row__actions" style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="p-btn p-btn--primary" style={{ fontSize: 12, height: 30 }} onClick={() => shareWhatsApp(p)}>
                        <MessageCircle size={14} />
                        WhatsApp
                      </button>
                      <button type="button" className="p-btn p-btn--ghost" style={{ fontSize: 12, height: 30 }} onClick={() => copyShareKit(p)}>
                        <Copy size={14} />
                        Copiar
                      </button>
                      <button type="button" className="p-btn p-btn--ghost" style={{ fontSize: 12, height: 30 }} onClick={() => editProduct(p)}>
                        <Pencil size={14} />
                        Editar
                      </button>
                      <button type="button" className="p-btn p-btn--danger" style={{ fontSize: 12, height: 30 }} onClick={() => deleteProduct(p.id)} title="Borrar producto">
                        <Trash2 size={14} />
                        Borrar
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Editor Panel */}
        {editorOpen && (
          <div className="p-panel" id="products-editor">
            <div className="p-hd">
              <div className="p-hd-left">
                <span className="p-title">{editingId ? "Editar producto" : "Nuevo producto"}</span>
                <span className="p-sub">Cargá el speech y los enlaces disponibles para dejar el kit listo para el equipo comercial.</span>
              </div>
              <div className="p-hd-right">
                <button type="button" className="p-btn p-btn--ghost p-btn--icon" onClick={resetForm}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="p-body">
              <form className="p-form" onSubmit={saveProduct}>
                <div className="p-field">
                  <label>Nombre del producto</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: EchoLaser SoracteLite"
                    required
                  />
                </div>

                <div className="p-field">
                  <label>Línea</label>
                  <select
                    className="p-select"
                    value={form.line}
                    onChange={(e) => setForm({ ...form, line: e.target.value })}
                  >
                    {PRODUCT_LINES.map((line) => <option key={line}>{line}</option>)}
                  </select>
                </div>

                <div className="p-field p-field--span2" style={{ gridColumn: "1 / -1" }}>
                  <label>Speech comercial</label>
                  <textarea
                    value={form.speech}
                    onChange={(e) => setForm({ ...form, speech: e.target.value })}
                    placeholder="Texto introductorio para enviar o usar en visita..."
                    rows={4}
                  />
                </div>

                <div className="p-field">
                  <label>Empresa / Proveedor</label>
                  <input
                    value={form.supplier}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                    placeholder="Ej: MediCross"
                  />
                </div>

                <div className="p-field">
                  <label>Código / SKU</label>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="Ej: MC-001"
                  />
                </div>

                <div className="p-field">
                  <label>Marca</label>
                  <input
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    placeholder="Ej: EchoLaser"
                  />
                </div>

                <div className="p-field">
                  <label>Precio base sugerido</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.base_price}
                    onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                    placeholder="0,00"
                  />
                </div>

                <div className="p-field">
                  <label>Brochure PDF URL</label>
                  <input
                    value={form.brochure_url}
                    onChange={(e) => setForm({ ...form, brochure_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>

                <div className="p-field">
                  <label>Ficha técnica URL</label>
                  <input
                    value={form.tech_sheet_url}
                    onChange={(e) => setForm({ ...form, tech_sheet_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>

                <div className="p-field">
                  <label>Video URL</label>
                  <input
                    value={form.video_url}
                    onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>

                <div className="p-form-actions" style={{ gridColumn: "1 / -1" }}>
                  <button type="button" className="p-btn p-btn--ghost" onClick={resetForm}>
                    Cancelar
                  </button>
                  <button type="submit" className="p-btn p-btn--primary" disabled={loading}>
                    <PackageOpen size={17} />
                    {loading
                      ? "Guardando..."
                      : editingId
                      ? "Actualizar producto"
                      : "Crear producto"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
