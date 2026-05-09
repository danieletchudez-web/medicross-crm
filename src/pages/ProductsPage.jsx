import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./products.css";

const EMPTY_FORM = {
  name: "",
  line: "EchoLaser",
  speech: "",
  brochure_url: "",
  tech_sheet_url: "",
  video_url: "",
};

export default function ProductsPage({ profile, onNavigate }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

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
  }

  function editProduct(product) {
    setEditingId(product.id);
    setForm({
      name: product.name || "",
      line: product.line || "EchoLaser",
      speech: product.speech || "",
      brochure_url: product.brochure_url || "",
      tech_sheet_url: product.tech_sheet_url || "",
      video_url: product.video_url || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
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

  const total = products.length;
  const echoLaser = products.filter((p) => p.line === "EchoLaser").length;
  const withBrochure = products.filter((p) => p.brochure_url).length;

  return (
    <Layout title="Productos / Share Kit" profile={profile} onNavigate={onNavigate}>
      <div className="products-page">
        <section className="products-kpis">
          <MiniKpi title="Productos totales" value={total} />
          <MiniKpi title="EchoLaser" value={echoLaser} />
          <MiniKpi title="Con brochure" value={withBrochure} />
        </section>

        <section className="products-card">
          <div className="products-head">
            <div>
              <h2>{editingId ? "Editar producto" : "Nuevo producto"}</h2>
              <p>
                Cargá speech, brochure, ficha técnica y video para que el vendedor
                pueda compartir material en un clic.
              </p>
            </div>

            {editingId && (
              <button type="button" onClick={resetForm}>
                Cancelar edición
              </button>
            )}
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
                <option>EchoLaser</option>
                <option>Osypka</option>
                <option>Diálisis</option>
                <option>Nutrición Clínica</option>
                <option>VAC</option>
                <option>Kangaroo</option>
                <option>Otro</option>
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
              <label>Brochure PDF URL</label>
              <input
                value={form.brochure_url}
                onChange={(e) =>
                  setForm({ ...form, brochure_url: e.target.value })
                }
                placeholder="https://..."
              />
            </div>

            <div>
              <label>Ficha técnica URL</label>
              <input
                value={form.tech_sheet_url}
                onChange={(e) =>
                  setForm({ ...form, tech_sheet_url: e.target.value })
                }
                placeholder="https://..."
              />
            </div>

            <div>
              <label>Video URL</label>
              <input
                value={form.video_url}
                onChange={(e) =>
                  setForm({ ...form, video_url: e.target.value })
                }
                placeholder="https://..."
              />
            </div>

            <button disabled={loading}>
              {loading
                ? "Guardando..."
                : editingId
                ? "Actualizar producto"
                : "Crear producto"}
            </button>
          </form>
        </section>

        <section className="products-card">
          <div className="products-head">
            <div>
              <h2>Share Kit por producto</h2>
              <p>Material listo para usar en visitas, WhatsApp o email.</p>
            </div>
          </div>

          <div className="products-grid">
            {products.length === 0 ? (
              <div className="empty-products">No hay productos cargados todavía.</div>
            ) : (
              products.map((p) => (
                <article className="product-card" key={p.id}>
                  <div className="product-top">
                    <div>
                      <span>{p.line || "Sin línea"}</span>
                      <h3>{p.name}</h3>
                    </div>
                  </div>

                  <p>{p.speech || "Sin speech cargado."}</p>

                  <div className="product-links">
                    {p.brochure_url && (
                      <a href={p.brochure_url} target="_blank" rel="noreferrer">
                        Brochure
                      </a>
                    )}

                    {p.tech_sheet_url && (
                      <a href={p.tech_sheet_url} target="_blank" rel="noreferrer">
                        Ficha técnica
                      </a>
                    )}

                    {p.video_url && (
                      <a href={p.video_url} target="_blank" rel="noreferrer">
                        Video
                      </a>
                    )}
                  </div>

                  <div className="product-actions">
                    <button onClick={() => shareWhatsApp(p)}>WhatsApp</button>
                    <button className="secondary" onClick={() => copyShareKit(p)}>
                      Copiar
                    </button>
                    <button className="secondary" onClick={() => editProduct(p)}>
                      Editar
                    </button>
                    <button className="danger" onClick={() => deleteProduct(p.id)}>
                      Borrar
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}

function MiniKpi({ title, value }) {
  return (
    <div className="product-kpi">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}