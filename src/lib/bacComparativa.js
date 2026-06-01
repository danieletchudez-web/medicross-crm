const BAC_EXTERNAL_MARKER = "[BAC_EXTERNAL]";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function valueAfterLabel(raw, label) {
  const normalizedLabel = normalizeText(label);
  for (const row of raw) {
    for (let index = 0; index < row.length; index++) {
      if (!normalizeText(row[index]).includes(normalizedLabel)) continue;
      const value = row.slice(index + 1).find(cell => String(cell ?? "").trim());
      if (value !== undefined) return String(value).trim();
    }
  }
  return "";
}

function parseLocaleNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!text) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    return Number(text.replace(/\./g, "").replace(",", "."));
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    return Number(text.replace(/,/g, ""));
  }
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseDate(value, XLSX) {
  if (!value) return "";
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const match = String(value).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function cleanInstitution(value) {
  return String(value || "")
    .replace(/^\s*\d+\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowSignature(row) {
  return [
    row.renglon,
    normalizeText(row.descripcion),
    normalizeText(row.empresa),
    Number(row.precio_unitario || 0).toFixed(4),
    Number(row.cantidad || 0).toFixed(4),
  ].join("|");
}

export function isExternalBacTender(tender) {
  return String(tender?.notes || "").includes(BAC_EXTERNAL_MARKER);
}

export function comparativaSignature(row) {
  return rowSignature(row);
}

export async function parseBacComparativaFile(file, isOwnCompany = () => false) {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  const headerRowIndex = raw.findIndex(row => {
    const text = normalizeText(row.join("|"));
    return text.includes("renglon") && text.includes("opcion");
  });
  if (headerRowIndex < 0) {
    throw new Error("No se detectó el formato oficial BAC. Verificá que el archivo sea un cuadro comparativo.");
  }

  const companyRow = raw[headerRowIndex - 1] || [];
  const headerRow = raw[headerRowIndex] || [];
  const companies = [];
  let currentCompany = "";
  headerRow.forEach((cell, column) => {
    if (String(companyRow[column] || "").trim()) currentCompany = String(companyRow[column]).trim();
    if (normalizeText(cell).includes("precio unitario") && currentCompany) {
      companies.push({ name: currentCompany, priceColumn: column });
    }
  });
  if (!companies.length) throw new Error("No se detectaron empresas con precio unitario en el Excel.");

  const rowColumn = headerRow.findIndex(cell => normalizeText(cell) === "renglon");
  const descriptionColumn = headerRow.findIndex(cell => normalizeText(cell).includes("descripcion"));
  const quantityColumn = headerRow.findIndex(cell => normalizeText(cell).includes("cantidad solicitada"));
  const parsedRows = [];

  for (let index = headerRowIndex + 1; index < raw.length; index++) {
    const sourceRow = raw[index];
    const renglon = Number.parseInt(sourceRow[rowColumn], 10);
    if (!renglon) continue;
    const descripcion = String(sourceRow[descriptionColumn] || "").trim().slice(0, 900);
    const cantidad = parseLocaleNumber(sourceRow[quantityColumn]) || 1;

    companies.forEach(company => {
      const precioUnitario = parseLocaleNumber(sourceRow[company.priceColumn]);
      if (!precioUnitario || precioUnitario <= 0) return;
      const totalArs = parseLocaleNumber(sourceRow[company.priceColumn + 4]);
      parsedRows.push({
        renglon,
        descripcion,
        empresa: company.name,
        es_nuestra_oferta: isOwnCompany(company.name),
        moneda: "ARS",
        precio_unitario: precioUnitario,
        cantidad,
        total_ars: totalArs || precioUnitario * cantidad,
        adjudicado: false,
      });
    });
  }

  const uniqueRows = [];
  const signatures = new Set();
  parsedRows.forEach(row => {
    const signature = rowSignature(row);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    uniqueRows.push(row);
  });
  if (!uniqueRows.length) throw new Error("No se encontraron precios comparables dentro del archivo.");

  return {
    fileName: file.name,
    metadata: {
      institution: cleanInstitution(valueAfterLabel(raw, "Unidad Operativa de Adquisiciones")),
      processNumber: valueAfterLabel(raw, "Número proceso de compra"),
      processName: valueAfterLabel(raw, "Nombre proceso de compra"),
      expedientNumber: valueAfterLabel(raw, "Número expediente"),
      referenceDate: parseDate(valueAfterLabel(raw, "Fecha de Apertura"), XLSX),
      jurisdiction: "CABA",
    },
    rows: uniqueRows,
    companies: [...new Set(uniqueRows.map(row => row.empresa))],
    rowNumbers: [...new Set(uniqueRows.map(row => row.renglon))],
    companyCount: new Set(uniqueRows.map(row => row.empresa)).size,
    itemCount: new Set(uniqueRows.map(row => row.renglon)).size,
    discardedDuplicates: parsedRows.length - uniqueRows.length,
  };
}

export function bacTenderNotes(fileName) {
  return `${BAC_EXTERNAL_MARKER} Referencia externa BAC importada desde Inteligencia de Precios. Archivo: ${fileName}. No requiere participación de MediCross.`;
}
