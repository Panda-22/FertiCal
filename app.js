const ELEMENT_META = [
  { key: "NO3-N", label: "硝态氮 NO3-N", unit: "mg/L" },
  { key: "NH4-N", label: "铵态氮 NH4-N", unit: "mg/L" },
  { key: "N", label: "总氮 N", unit: "mg/L" },
  { key: "P", label: "磷 P", unit: "mg/L" },
  { key: "K", label: "钾 K", unit: "mg/L" },
  { key: "Ca", label: "钙 Ca", unit: "mg/L" },
  { key: "Mg", label: "镁 Mg", unit: "mg/L" },
  { key: "S", label: "硫 S", unit: "mg/L" },
  { key: "Cl", label: "氯 Cl", unit: "mg/L" },
  { key: "Fe", label: "铁 Fe", unit: "mg/L" },
  { key: "Mn", label: "锰 Mn", unit: "mg/L" },
  { key: "Zn", label: "锌 Zn", unit: "mg/L" },
  { key: "B", label: "硼 B", unit: "mg/L" },
  { key: "Cu", label: "铜 Cu", unit: "mg/L" },
  { key: "Mo", label: "钼 Mo", unit: "mg/L" },
  { key: "Na", label: "钠 Na", unit: "mg/L" },
  { key: "Si", label: "硅 Si", unit: "mg/L" },
  { key: "HCO3", label: "碳酸氢根 HCO3-", unit: "mg/L" },
  { key: "EC", label: "EC", unit: "uS/cm" },
  { key: "pH", label: "pH", unit: "" }
];

const MOLAR_MASS = {
  "NO3-N": 14.007,
  "NH4-N": 14.007,
  N: 14.007,
  P: 30.974,
  K: 39.0983,
  Ca: 40.078,
  Mg: 24.305,
  S: 32.065,
  Cl: 35.453,
  Fe: 55.845,
  Mn: 54.938,
  Zn: 65.38,
  B: 10.81,
  Cu: 63.546,
  Mo: 95.95,
  Na: 22.989769,
  Si: 28.085,
  HCO3: 61.0168
};

const PRECIPITATION_SYSTEMS = [
  { salt: "CaSO4", counterKey: "S", counterLabel: "SO4", ksp: 2.4e-5, equation: "Ca x SO4" },
  { salt: "Ca3(PO4)2", counterKey: "P", counterLabel: "PO4", ksp: 2.07e-33, equation: "Ca^3 x PO4^2" }
];

const FERTILIZER_CATALOG = [
  {
    id: "ca-no3-4h2o",
    name: "硝酸钙（四水合）",
    bucket: "A",
    notes: "Ca(NO3)2·4H2O",
    compounds: [
      { label: "NO3-N", percent: 11.86, element: "NO3-N" },
      { label: "Ca", percent: 16.97, element: "Ca" }
    ]
  },
  {
    id: "mg-no3-6h2o",
    name: "硝酸镁（六水合）",
    bucket: "A",
    notes: "Mg(NO3)2·6H2O",
    compounds: [
      { label: "NO3-N", percent: 10.92, element: "NO3-N" },
      { label: "Mg", percent: 9.48, element: "Mg" }
    ]
  },
  {
    id: "can",
    name: "硝酸铵钙",
    bucket: "A",
    notes: "5Ca(NO3)2·NH4NO3·10H2O",
    compounds: [
      { label: "NH4-N", percent: 1.3, element: "NH4-N" },
      { label: "NO3-N", percent: 14.25, element: "NO3-N" },
      { label: "Ca", percent: 18.54, element: "Ca" }
    ]
  },
  {
    id: "cacl2",
    name: "氯化钙",
    bucket: "A",
    notes: "CaCl2",
    compounds: [
      { label: "Ca", percent: 36.11, element: "Ca" },
      { label: "Cl", percent: 63.89, element: "Cl" }
    ]
  },
  {
    id: "kcl",
    name: "氯化钾",
    bucket: "AB",
    notes: "KCl",
    compounds: [
      { label: "K", percent: 52.44, element: "K" },
      { label: "Cl", percent: 47.56, element: "Cl" }
    ]
  },
  {
    id: "kno3",
    name: "硝酸钾",
    bucket: "AB",
    notes: "KNO3",
    compounds: [
      { label: "NO3-N", percent: 13.85, element: "NO3-N" },
      { label: "K", percent: 38.67, element: "K" }
    ]
  },
  {
    id: "eddha-fe-11",
    name: "EDDHA-Fe-11",
    bucket: "A",
    notes: "Fe 11%",
    compounds: [{ label: "Fe", percent: 11, element: "Fe" }]
  },
  {
    id: "hno3-40",
    name: "硝酸（40%）",
    bucket: "A",
    notes: "HNO3 40%",
    compounds: [{ label: "NO3-N", percent: 8.89, element: "NO3-N" }]
  },
  {
    id: "kh2po4",
    name: "磷酸二氢钾",
    bucket: "B",
    notes: "KH2PO4",
    compounds: [
      { label: "P", percent: 22.76, element: "P" },
      { label: "K", percent: 28.73, element: "K" }
    ]
  },
  {
    id: "mgso4-7h2o",
    name: "七水硫酸镁",
    bucket: "B",
    notes: "MgSO4·7H2O",
    compounds: [
      { label: "Mg", percent: 9.86, element: "Mg" },
      { label: "S", percent: 13.01, element: "S" }
    ]
  },
  {
    id: "k2so4",
    name: "硫酸钾",
    bucket: "B",
    notes: "K2SO4",
    compounds: [
      { label: "K", percent: 44.87, element: "K" },
      { label: "S", percent: 18.4, element: "S" }
    ]
  },
  {
    id: "mnso4",
    name: "硫酸锰（32%Mn）",
    bucket: "B",
    notes: "MnSO4·H2O",
    compounds: [
      { label: "Mn", percent: 32, element: "Mn" },
      { label: "S", percent: 18.95, element: "S" }
    ]
  },
  {
    id: "borax",
    name: "硼砂（11%B）",
    bucket: "B",
    notes: "Na2B4O7·10H2O",
    compounds: [
      { label: "B", percent: 11, element: "B" },
      { label: "Na", percent: 12.05, element: "Na" }
    ]
  },
  {
    id: "znso4",
    name: "硫酸锌（23%Zn）",
    bucket: "B",
    notes: "ZnSO4·7H2O",
    compounds: [
      { label: "Zn", percent: 23, element: "Zn" },
      { label: "S", percent: 11.15, element: "S" }
    ]
  },
  {
    id: "cuso4",
    name: "五水硫酸铜（25%Cu）",
    bucket: "B",
    notes: "CuSO4·5H2O",
    compounds: [
      { label: "Cu", percent: 25, element: "Cu" },
      { label: "S", percent: 12.84, element: "S" }
    ]
  },
  {
    id: "na2moo4",
    name: "钼酸钠（40%Mo）",
    bucket: "B",
    notes: "Na2MoO4",
    compounds: [
      { label: "Mo", percent: 40, element: "Mo" },
      { label: "Na", percent: 22.33, element: "Na" }
    ]
  },
  {
    id: "h3po4-85",
    name: "磷酸（85%）",
    bucket: "B",
    notes: "H3PO4 85%",
    compounds: [{ label: "P", percent: 26.89, element: "P" }]
  }
];

const DETECTION_RULES = [
  { key: "NO3-N", matchers: [/no3/i, /硝态氮/, /硝酸盐/, /硝氮/] },
  { key: "NH4-N", matchers: [/nh4/i, /铵态氮/, /铵氮/, /氨氮/, /nh3/i] },
  { key: "N", matchers: [/\btn\b/i, /总氮/, /全氮/, /nitrogen/i] },
  { key: "P", matchers: [/\bp\b/i, /以p计/i, /磷/, /phosphorus/i] },
  { key: "K", matchers: [/\bk\b/i, /以k计/i, /钾/, /potassium/i] },
  { key: "Ca", matchers: [/\bca\b/i, /钙/] },
  { key: "Mg", matchers: [/\bmg\b(?!\/l)/i, /镁/] },
  { key: "S", matchers: [/\bs\b/i, /以s计/i, /硫/, /sulfur/i] },
  { key: "Cl", matchers: [/\bcl\b/i, /氯离子/, /氯/] },
  { key: "Fe", matchers: [/\bfe\b/i, /铁/] },
  { key: "Mn", matchers: [/\bmn\b/i, /锰/] },
  { key: "Zn", matchers: [/\bzn\b/i, /锌/] },
  { key: "B", matchers: [/\bb\b/i, /硼/] },
  { key: "Cu", matchers: [/\bcu\b/i, /铜/] },
  { key: "Mo", matchers: [/\bmo\b/i, /钼/] },
  { key: "Na", matchers: [/\bna\b/i, /钠/] },
  { key: "Si", matchers: [/\bsi\b/i, /硅/] },
  { key: "HCO3", matchers: [/hco3/i, /碳酸氢根/, /重碳酸根/] },
  { key: "EC", matchers: [/\bec\b/i, /电导率/] },
  { key: "pH", matchers: [/\bph\b/i] }
];

const state = {
  water: Object.fromEntries(ELEMENT_META.map((item) => [item.key, 0])),
  targets: Object.fromEntries(ELEMENT_META.map((item) => [item.key, null])),
  bucketA: [],
  bucketB: []
};

const waterTableBody = document.querySelector("#waterTableBody");
const bucketAList = document.querySelector("#bucketAList");
const bucketBList = document.querySelector("#bucketBList");
const summaryA = document.querySelector("#summaryA");
const summaryB = document.querySelector("#summaryB");
const elementTotalsBody = document.querySelector("#elementTotalsBody");
const targetBody = document.querySelector("#targetBody");
const irrigationBody = document.querySelector("#irrigationBody");
const precipitationBody = document.querySelector("#precipitationBody");
const reportStatus = document.querySelector("#reportStatus");
const reportFile = document.querySelector("#reportFile");

init();

function init() {
  state.bucketA = [buildRow("A"), buildRow("A")];
  state.bucketB = [buildRow("B"), buildRow("B")];
  renderWaterTable();
  renderTargetTable();
  renderBucket("A");
  renderBucket("B");
  bindStaticEvents();
  recalculate();
}

function bindStaticEvents() {
  document.querySelector("#addA").addEventListener("click", () => {
    state.bucketA.push(buildRow("A"));
    renderBucket("A");
    recalculate();
  });

  document.querySelector("#addB").addEventListener("click", () => {
    state.bucketB.push(buildRow("B"));
    renderBucket("B");
    recalculate();
  });

  ["aTankVolume", "aDilution", "bTankVolume", "bDilution"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", recalculate);
  });

  reportFile.addEventListener("change", handleReportUpload);
}

function buildRow(bucket) {
  const candidates = getCatalogByBucket(bucket);
  return {
    id: crypto.randomUUID(),
    fertilizerId: candidates[0]?.id ?? FERTILIZER_CATALOG[0].id,
    amount: 0,
    unit: "kg"
  };
}

function getCatalogByBucket(bucket) {
  return FERTILIZER_CATALOG.filter((item) => item.bucket === bucket || item.bucket === "AB");
}

function renderWaterTable() {
  waterTableBody.innerHTML = ELEMENT_META.map(
    (item) => `
      <tr>
        <td>${item.label}</td>
        <td>
          <input
            class="water-input"
            data-water-key="${item.key}"
            type="number"
            step="0.001"
            value="${toInputValue(state.water[item.key])}"
          />
        </td>
        <td>${item.unit}</td>
      </tr>
    `
  ).join("");

  waterTableBody.querySelectorAll("[data-water-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const key = event.target.dataset.waterKey;
      state.water[key] = toNumber(event.target.value);
      if (key === "NO3-N" || key === "NH4-N") {
        syncWaterTotalN();
        renderWaterTable();
      }
      recalculate();
    });
  });
}

function renderBucket(bucket) {
  const list = bucket === "A" ? bucketAList : bucketBList;
  const rows = bucket === "A" ? state.bucketA : state.bucketB;
  const options = getCatalogByBucket(bucket)
    .map((item) => `<option value="${item.id}">${item.name}</option>`)
    .join("");

  list.innerHTML = rows
    .map((row) => {
      const fertilizer = getFertilizer(row.fertilizerId);
      const chips = fertilizer.compounds
        .map((compound) => `<span>${compound.label} ${formatPercent(compound.percent)}</span>`)
        .join("");

      return `
        <article class="mix-row" data-row-id="${row.id}" data-bucket="${bucket}">
          <div class="row-main">
            <label>
              <span>肥料类型</span>
              <select data-role="fertilizer">
                ${options}
              </select>
            </label>
            <label>
              <span>用量</span>
              <input data-role="amount" type="number" min="0" step="0.001" value="${toInputValue(row.amount)}" />
            </label>
            <label>
              <span>单位</span>
              <select data-role="unit">
                <option value="kg">kg</option>
                <option value="g">g</option>
              </select>
            </label>
            <button class="danger-btn" data-role="remove" type="button" aria-label="删除">×</button>
          </div>
          <div class="compound-chips">${chips}</div>
          <p class="muted">${fertilizer.notes}</p>
        </article>
      `;
    })
    .join("");

  rows.forEach((row) => {
    const root = list.querySelector(`[data-row-id="${row.id}"]`);
    root.querySelector('[data-role="fertilizer"]').value = row.fertilizerId;
    root.querySelector('[data-role="unit"]').value = row.unit;

    root.querySelector('[data-role="fertilizer"]').addEventListener("change", (event) => {
      row.fertilizerId = event.target.value;
      renderBucket(bucket);
      recalculate();
    });

    root.querySelector('[data-role="amount"]').addEventListener("input", (event) => {
      row.amount = toNumber(event.target.value);
      recalculate();
    });

    root.querySelector('[data-role="unit"]').addEventListener("change", (event) => {
      row.unit = event.target.value;
      recalculate();
    });

    root.querySelector('[data-role="remove"]').addEventListener("click", () => {
      const targetRows = bucket === "A" ? state.bucketA : state.bucketB;
      if (targetRows.length === 1) {
        targetRows[0] = buildRow(bucket);
      } else {
        const index = targetRows.findIndex((item) => item.id === row.id);
        targetRows.splice(index, 1);
      }
      renderBucket(bucket);
      recalculate();
    });
  });
}

function renderTargetTable() {
  targetBody.innerHTML = ELEMENT_META.map((item) => {
    const unit = getDisplayUnit(item.key);
    return `
      <tr>
        <td>${item.label}</td>
        <td>${unit}</td>
        <td>
          <input
            class="target-input"
            data-target-key="${item.key}"
            type="number"
            step="0.001"
            value="${toInputValue(state.targets[item.key])}"
          />
        </td>
      </tr>
    `;
  }).join("");

  targetBody.querySelectorAll("[data-target-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const key = event.target.dataset.targetKey;
      state.targets[key] = toNullableNumber(event.target.value);
      recalculate();
    });
  });
}

function recalculate() {
  const bucketAResult = calculateBucket(state.bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
  const bucketBResult = calculateBucket(state.bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));

  renderSummary(summaryA, bucketAResult, "A");
  renderSummary(summaryB, bucketBResult, "B");
  renderElementTotals(bucketAResult, bucketBResult);
  renderIrrigation(bucketAResult, bucketBResult);
  renderPrecipitation(bucketAResult, bucketBResult);
}

function calculateBucket(rows, tankVolume, dilutionFactor) {
  const totals = emptyElementMap();

  rows.forEach((row) => {
    const fertilizer = getFertilizer(row.fertilizerId);
    const amountInGrams = row.unit === "kg" ? row.amount * 1000 : row.amount;
    fertilizer.compounds.forEach((compound) => {
      const mass = amountInGrams * (compound.percent / 100);
      totals[compound.element] += mass;
    });
  });

  totals.N = totals["NO3-N"] + totals["NH4-N"];

  const perLiter = emptyElementMap();
  const irrigation = emptyElementMap();
  const perLiterMmol = emptyElementMap();
  const irrigationMmol = emptyElementMap();

  ELEMENT_META.forEach((item) => {
    if (!tankVolume || !dilutionFactor) {
      perLiter[item.key] = 0;
      irrigation[item.key] = 0;
      perLiterMmol[item.key] = toMmolPerLiter(item.key, 0);
      irrigationMmol[item.key] = toMmolPerLiter(item.key, 0);
      return;
    }

    perLiter[item.key] = totals[item.key] * 1000 / tankVolume;
    irrigation[item.key] = perLiter[item.key] / dilutionFactor;
    perLiterMmol[item.key] = toMmolPerLiter(item.key, perLiter[item.key]);
    irrigationMmol[item.key] = toMmolPerLiter(item.key, irrigation[item.key]);
  });

  return { totals, perLiter, irrigation, perLiterMmol, irrigationMmol };
}

function renderSummary(target, bucketResult, bucketName) {
  const leadKeys = ["N", "P", "K", "Ca", "Mg", "S", "Fe"];
  target.innerHTML = leadKeys
    .map((key) => {
      const amount = bucketResult.totals[key];
      if (!amount) return "";
      return `<span class="summary-chip">${bucketName} ${key}: ${formatNumber(amount)} g</span>`;
    })
    .join("");

  if (!target.innerHTML.trim()) {
    target.innerHTML = `<span class="summary-chip">${bucketName} 桶尚未录入有效肥料用量</span>`;
  }
}

function renderElementTotals(bucketAResult, bucketBResult) {
  const rows = ELEMENT_META.filter((item) => !["EC", "pH", "HCO3"].includes(item.key))
    .map((item) => {
      const aValue = bucketAResult.totals[item.key] ?? 0;
      const bValue = bucketBResult.totals[item.key] ?? 0;
      const total = aValue + bValue;
      if (!aValue && !bValue && !["N", "P", "K", "Ca", "Mg", "S"].includes(item.key)) {
        return "";
      }
      return `
        <tr>
          <td>${item.label}</td>
          <td>${formatNumber(aValue)}</td>
          <td>${formatNumber(bValue)}</td>
          <td>${formatNumber(total)}</td>
        </tr>
      `;
    })
    .join("");

  elementTotalsBody.innerHTML = rows;
}

function renderIrrigation(bucketAResult, bucketBResult) {
  irrigationBody.innerHTML = ELEMENT_META.map((item) => {
    const isConverted = Boolean(MOLAR_MASS[item.key]);
    const waterValue = isConverted ? toMmolPerLiter(item.key, state.water[item.key] ?? 0) : (state.water[item.key] ?? 0);
    const aValue = isConverted ? (bucketAResult.irrigationMmol[item.key] ?? 0) : (bucketAResult.irrigation[item.key] ?? 0);
    const bValue = isConverted ? (bucketBResult.irrigationMmol[item.key] ?? 0) : (bucketBResult.irrigation[item.key] ?? 0);
    const total = waterValue + aValue + bValue;
    const unit = getDisplayUnit(item.key);
    const targetValue = state.targets[item.key];
    const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
    const deviationRatio = hasTarget && targetValue !== 0 ? (total - targetValue) / targetValue : null;
    const outOfRange = deviationRatio !== null && Math.abs(deviationRatio) > 0.15;
    const totalClass = outOfRange ? "alert-text" : "";
    const deviationClass = outOfRange ? "alert-text" : "";
    const deviationText = deviationRatio === null
      ? "-"
      : `${deviationRatio >= 0 ? "+" : ""}${formatNumber(deviationRatio * 100)}%`;

    return `
      <tr>
        <td>${item.label}</td>
        <td>${unit}</td>
        <td>${formatNumber(waterValue)}</td>
        <td>${formatNumber(aValue)}</td>
        <td>${formatNumber(bValue)}</td>
        <td class="${totalClass}">${formatNumber(total)}</td>
        <td>${hasTarget ? formatNumber(targetValue) : "-"}</td>
        <td class="${deviationClass}">${deviationText}</td>
      </tr>
    `;
  }).join("");
}

function renderPrecipitation(bucketAResult, bucketBResult) {
  const rows = [
    ...buildPrecipitationRows("A", bucketAResult),
    ...buildPrecipitationRows("B", bucketBResult)
  ];

  precipitationBody.innerHTML = rows.join("");
}

function buildPrecipitationRows(bucketName, bucketResult) {
  const caMmol = getStockIonMmol(bucketResult, "Ca");

  return PRECIPITATION_SYSTEMS.map((system) => {
    const counterMmol = getStockIonMmol(bucketResult, system.counterKey);
    const ionicProduct = system.salt === "CaSO4"
      ? Math.pow(caMmol / 1000, 1) * Math.pow(counterMmol / 1000, 1)
      : Math.pow(caMmol / 1000, 3) * Math.pow(counterMmol / 1000, 2);

    return `
      <tr>
        <td>${bucketName}</td>
        <td>${system.salt}</td>
        <td>${formatNumber(caMmol)}</td>
        <td>${system.counterLabel}: ${formatNumber(counterMmol)}</td>
        <td>${formatScientific(ionicProduct)}</td>
        <td>${formatScientific(system.ksp)}</td>
      </tr>
    `;
  });
}

function getStockIonMmol(bucketResult, key) {
  const waterMgL = state.water[key] ?? 0;
  const stockMgL = bucketResult.perLiter[key] ?? 0;
  return toMmolPerLiter(key, waterMgL + stockMgL);
}

async function handleReportUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  reportStatus.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseWorkbook(workbook);
    Object.assign(state.water, parsed.values);
    syncWaterTotalN();
    renderWaterTable();
    recalculate();
    reportStatus.textContent = `已导入 ${file.name}，识别到 ${parsed.hitCount} 个指标，来源工作表：${parsed.sheetName}`;
  } catch (error) {
    console.error(error);
    reportStatus.textContent = `文件读取失败：${error?.message || "请确认 Excel 文件可正常打开"}`;
  }
}

function readFileAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("浏览器无法读取该文件"));
    reader.readAsArrayBuffer(file);
  });
}

function parseWorkbook(workbook) {
  let best = { values: emptyElementMap(), hitCount: 0, sheetName: workbook.SheetNames[0] };

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const wide = parseWideRows(rows);
    const long = parseLongRows(rows);
    const parsed = mergeElementMaps(wide.values, long.values);
    const hitCount = new Set([...wide.hits, ...long.hits]).size;
    if (hitCount > best.hitCount) {
      best = { values: parsed, hitCount, sheetName };
    }
  });

  return best;
}

function parseWideRows(rows) {
  const result = emptyElementMap();
  const hits = new Set();
  const candidateRow = rows.find((row) => Array.isArray(row) && row.filter(Boolean).length >= 6) || [];
  const valueRow = rows[rows.indexOf(candidateRow) + 1] || [];

  candidateRow.forEach((header, index) => {
    const elementKey = detectElementKey(header);
    if (!elementKey) return;
    const rawValue = valueRow[index];
    const parsedValue = convertValue(elementKey, rawValue, String(header ?? ""));
    if (Number.isFinite(parsedValue)) {
      result[elementKey] = parsedValue;
      hits.add(elementKey);
    }
  });

  return { values: result, hits };
}

function parseLongRows(rows) {
  const result = emptyElementMap();
  const hits = new Set();

  rows.forEach((row) => {
    if (!Array.isArray(row) || row.length < 2) return;

    const textIndex = row.findIndex((cell) => typeof cell === "string" && detectElementKey(cell));
    const textCell = row[textIndex];
    if (!textCell) return;

    const elementKey = detectElementKey(textCell);
    const rightSideNumbers = row.slice(textIndex + 1).filter((cell) => typeof cell === "number");
    const numericCell = rightSideNumbers[0];
    const parsedValue = convertValue(elementKey, numericCell, textCell);
    if (Number.isFinite(parsedValue)) {
      result[elementKey] = parsedValue;
      hits.add(elementKey);
    }
  });

  return { values: result, hits };
}

function detectElementKey(source) {
  if (source == null) return null;
  const text = String(source).replace(/[\r\n\t]+/g, " ");

  for (const rule of DETECTION_RULES) {
    if (rule.matchers.some((matcher) => matcher.test(text))) return rule.key;
  }

  return null;
}

function convertValue(elementKey, rawValue, headerText) {
  if (!Number.isFinite(Number(rawValue))) return NaN;
  const numeric = Number(rawValue);
  const header = String(headerText).toLowerCase();

  if (elementKey === "NH4-N" && header.includes("nh3")) {
    return numeric * (14 / 17);
  }

  return numeric;
}

function syncWaterTotalN() {
  const totalFromForms = (state.water["NO3-N"] || 0) + (state.water["NH4-N"] || 0);
  if (totalFromForms > 0 && (!state.water.N || Math.abs(state.water.N - totalFromForms) < 0.001)) {
    state.water.N = totalFromForms;
  }
}

function mergeElementMaps(...maps) {
  const merged = emptyElementMap();
  maps.forEach((map) => {
    Object.entries(map).forEach(([key, value]) => {
      if (value) merged[key] = value;
    });
  });
  return merged;
}

function emptyElementMap() {
  return Object.fromEntries(ELEMENT_META.map((item) => [item.key, 0]));
}

function getDisplayUnit(key) {
  return MOLAR_MASS[key] ? "mmol/L" : (ELEMENT_META.find((item) => item.key === key)?.unit ?? "");
}

function toMmolPerLiter(key, mgPerLiter) {
  const molarMass = MOLAR_MASS[key];
  if (!molarMass) return mgPerLiter;
  return mgPerLiter / molarMass;
}

function getFertilizer(fertilizerId) {
  return FERTILIZER_CATALOG.find((item) => item.id === fertilizerId) ?? FERTILIZER_CATALOG[0];
}

function getNumericField(id) {
  return toNumber(document.querySelector(`#${id}`).value);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullableNumber(value) {
  if (value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toInputValue(value) {
  return value == null || value === 0 ? "" : value;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function formatScientific(value) {
  if (!value) return "0";
  return Number(value).toExponential(3);
}
