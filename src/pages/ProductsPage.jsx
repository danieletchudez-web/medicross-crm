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
      <div className="products-page">
        <ModuleHeader
          title="Productos / Share Kit"
          subtitle="Biblioteca comercial para preparar visitas y compartir materiales con el equipo."
          actions={
            <button type="button" className="products-new-btn" onClick={openNewProduct}>
              <Plus size={17} />
              Nuevo producto
            </button>
          }
        />

        <section className="products-kpis">
          <MetricKpi label="Productos cargados" value={total} sub={`${activeLines} líneas activas`} />
          <MetricKpi label="Listos para compartir" value={readyToShare} sub={`${coverage}% del catálogo`} accent="green" />
          <MetricKpi label="Material completo" value={completeKits} sub="Brochure, ficha y video" accent="blue" />
          <MetricKpi label="Requieren atención" value={needsAttention} sub="Sin speech o sin material" accent={needsAttention ? "amber" : "green"} />
        </section>

        <section className="products-insight">
          <div className="products-insight__icon">
            <Layers3 size={19} />
          </div>
          <div>
            <span>Preparación comercial</span>
            <strong>{coverage}% del catálogo está listo para usar en una visita.</strong>
            <small>
              {needsAttention
                ? `${needsAttention} producto${needsAttention === 1 ? "" : "s"} necesita${needsAttention === 1 ? "" : "n"} completar speech o materiales.`
                : "Todos los productos tienen material disponible para compartir."}
            </small>
          </div>
          {needsAttention > 0 && (
            <button type="button" onClick={() => setReadinessFilter("incompletos")}>
              Revisar pendientes
            </button>
          )}
        </section>

        <section className="products-catalog">
          <div className="products-head products-head--catalog">
            <div>
              <span className="products-eyebrow">Biblioteca comercial</span>
              <h2>Share Kit por producto</h2>
              <p>Encontrá rápidamente el speech y el material indicado para cada visita.</p>
            </div>
            <span className="products-result-count">{filteredProducts.length} de {total} productos</span>
          </div>

          <div className="products-toolbar">
            <label className="products-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por producto, línea o contenido del speech..."
              />
            </label>
            <label>
              <span>Línea</span>
              <select
                value={lineFilter}
                onChange={(event) => setLineFilter(event.target.value)}
              >
                <option>Todas</option>
                {lineOptions.map((line) => <option key={line}>{line}</option>)}
              </select>
            </label>
            <label>
              <span>Estado del kit</span>
              <select
                value={readinessFilter}
                onChange={(event) => setReadinessFilter(event.target.value)}
              >
                <option value="todos">Todos</option>
                <option value="listos">Listos para compartir</option>
                <option value="incompletos">Requieren atención</option>
              </select>
            </label>
            {(search || lineFilter !== "Todas" || readinessFilter !== "todos") && (
              <button type="button" className="products-clear-btn" onClick={clearFilters} title="Limpiar filtros">
                <X size={17} />
              </button>
            )}
          </div>

          {lineSummary.length > 0 && (
            <div className="products-lines">
              <span>Catálogo por línea</span>
              <button
                type="button"
                className={lineFilter === "Todas" ? "active" : ""}
                onClick={() => setLineFilter("Todas")}
              >
                Todas <strong>{total}</strong>
              </button>
              {lineSummary.map(({ line, count }) => (
                <button
                  type="button"
                  className={lineFilter === line ? "active" : ""}
                  key={line}
                  onClick={() => setLineFilter(line)}
                >
                  {line} <strong>{count}</strong>
                </button>
              ))}
            </div>
          )}

          <div className="products-grid">
            {filteredProducts.length === 0 ? (
              <EmptyState
                title={products.length ? "No encontramos productos con esos filtros" : "No hay productos cargados"}
                text={products.length
                  ? "Probá otra búsqueda o limpiá los filtros para volver a ver el catálogo completo."
                  : "Creá el primer producto para que el equipo pueda compartir speech, brochure y ficha técnica desde el CRM."}
                action={
                  <button type="button" className="products-empty-btn" onClick={products.length ? clearFilters : openNewProduct}>
                    {products.length ? "Limpiar filtros" : "Crear primer producto"}
                  </button>
                }
              />
            ) : (
              filteredProducts.map((p) => {
                const resources = materialCount(p);
                const ready = isReadyToShare(p);

                return (
                <article className={`product-card ${ready ? "product-card--ready" : "product-card--pending"}`} key={p.id}>
                  <div className="product-top">
                    <div>
                      <span className="product-line">{p.line || "Sin línea"}</span>
                      <h3>{p.name}</h3>
                    </div>
                    <span className={`product-readiness ${ready ? "product-readiness--ready" : "product-readiness--pending"}`}>
                      {ready ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {ready ? "Listo para compartir" : "Completar kit"}
                    </span>
                  </div>

                  <div className="product-speech">
                    <span>Speech comercial</span>
                    <p>{p.speech || "Todavía no se cargó un speech comercial para este producto."}</p>
                  </div>

                  <div className="product-material-head">
                    <span>Material disponible</span>
                    <strong>{resources}/{MATERIALS.length}</strong>
                  </div>
                  <div className="product-links">
                    {MATERIALS.map(({ key, label, Icon }) => p[key] ? (
                      <a href={p[key]} target="_blank" rel="noreferrer" key={key}>
                        <Icon size={15} />
                        {label}
                      </a>
                    ) : (
                      <span className="product-link-missing" key={key}>
                        <Icon size={15} />
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="product-actions">
                    <button type="button" onClick={() => shareWhatsApp(p)}>
                      <MessageCircle size={16} />
                      WhatsApp
                    </button>
                    <button type="button" className="secondary" onClick={() => copyShareKit(p)}>
                      <Copy size={16} />
                      Copiar
                    </button>
                    <button type="button" className="secondary" onClick={() => editProduct(p)}>
                      <Pencil size={16} />
                      Editar
                    </button>
                    <button type="button" className="danger" onClick={() => deleteProduct(p.id)} title="Borrar producto">
                      <Trash2 size={16} />
                      Borrar
                    </button>
                  </div>
                </article>
              )})
            )}
          </div>
        </section>

        {editorOpen && (
          <section className="products-card products-editor" id="products-editor">
            <div className="products-head">
              <div>
                <span className="products-eyebrow">Gestión de catálogo</span>
                <h2>{editingId ? "Editar producto" : "Nuevo producto"}</h2>
                <p>Cargá el speech y los enlaces disponibles para dejar el kit listo para el equipo comercial.</p>
              </div>
              <button type="button" onClick={resetForm}>
                <X size={16} />
                Cerrar
              </button>
            </div>

            <form className="products-form" onSubmit={saveProduct}>
              <div>
                <label>Nombre del producto</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: EchoLaser SoracteLite"
                  required
                />
              </div>

              <div>
                <label>Línea</label>
                <select
                  value={form.line}
                  onChange={(e) => setForm({ ...form, line: e.target.value })}
                >
                  {PRODUCT_LINES.map((line) => <option key={line}>{line}</option>)}
                </select>
              </div>

              <div className="wide">
                <label>Speech comercial</label>
                <textarea
                  value={form.speech}
                  onChange={(e) => setForm({ ...form, speech: e.target.value })}
                  placeholder="Texto introductorio para enviar o usar en visita..."
                />
              </div>

              <div>
                <label>Empresa / Proveedor</label>
                <input
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  placeholder="Ej: MediCross"
                />
              </div>

              <div>
                <label>Código / SKU</label>
                <input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="Ej: MC-001"
                />
              </div>

              <div>
                <label>Marca</label>
                <input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="Ej: EchoLaser"
                />
              </div>

              <div>
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

              <div>
                <label>Brochure PDF URL</label>
                <input
                  value={form.brochure_url}
                  onChange={(e) => setForm({ ...form, brochure_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div>
                <label>Ficha técnica URL</label>
                <input
                  value={form.tech_sheet_url}
                  onChange={(e) => setForm({ ...form, tech_sheet_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div>
                <label>Video URL</label>
                <input
                  value={form.video_url}
                  onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="products-form__actions">
                <button type="button" className="products-form__cancel" onClick={resetForm}>
                  Cancelar
                </button>
                <button type="submit" disabled={loading}>
                  <PackageOpen size={17} />
                  {loading
                    ? "Guardando..."
                    : editingId
                    ? "Actualizar producto"
                    : "Crear producto"}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </Layout>
  );
}
