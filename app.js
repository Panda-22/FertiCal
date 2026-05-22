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

const WATER_KW = 1e-14;
const CARBONIC_KA1 = 4.45e-7;
const CARBONIC_KA2 = 4.69e-11;
const PHOSPHORIC_KA1 = 7.08e-3;
const PHOSPHORIC_KA2 = 6.31e-8;
const PHOSPHORIC_KA3 = 4.17e-13;
const BISULFATE_KA = 1.02e-2;
const PHOSPHORIC_PKA1 = -Math.log10(PHOSPHORIC_KA1);
const PHOSPHORIC_PKA2 = -Math.log10(PHOSPHORIC_KA2);
const EC_COEFFICIENTS = {
  "NO3-N": 71.5,
  "NH4-N": 73.5,
  K: 73.5,
  Ca: 119.0,
  Mg: 106.0,
  Na: 50.1,
  S: 160.0,
  Cl: 76.3,
  Fe: 107.0,
  Mn: 107.0,
  Zn: 105.0,
  Cu: 108.0
};
const EC_ACTIVITY_FACTOR = 0.82;
const LOW_CONTENT_KEYS = new Set(["S", "Cl"]);
const LOW_CONTENT_BENCHMARK = {
  S: 2,
  Cl: 1
};
const LOW_CONTENT_WEIGHT = {
  S: 0.45,
  Cl: 0.8
};
const DEFAULT_TARGET_PH = 6;
const MIN_AUTO_ACID_STOCK_PH = 2.2;
const WORKING_SOLUTION_CO2_RELEASE_FACTOR = 0.7;

function calculateEC(totalMmol) {
  let ec = 0;
  for (const [key, coeff] of Object.entries(EC_COEFFICIENTS)) {
    const mmol = totalMmol[key] ?? 0;
    ec += mmol * coeff;
  }
  // 若用户只填了总 N 而未拆分 NO3-N/NH4-N，将总 N 按 NO3- 的导体系数计入
  // （灌溉水中氮素以硝态为主，此处为保守估算）
  const no3 = totalMmol["NO3-N"] ?? 0;
  const nh4 = totalMmol["NH4-N"] ?? 0;
  const totalN = totalMmol["N"] ?? 0;
  const unaccountedN = Math.max(0, totalN - no3 - nh4);
  if (unaccountedN > 0) {
    ec += unaccountedN * EC_COEFFICIENTS["NO3-N"];
  }
  return ec * EC_ACTIVITY_FACTOR;
}

function calculatePH(totalMmol, acidProfile = null) {
  try {
    return calculatePHImpl(totalMmol, acidProfile);
  } catch (e) {
    console.error('FertiCal: calculatePH error', e);
    return 7.0;
  }
}

function calculatePHImpl(totalMmol, acidProfile = null) {
  const hco3Mmol = Number(totalMmol.HCO3) || 0;
  const waterPH = (typeof state.water?.pH === "number" && state.water.pH > 0)
    ? state.water.pH : 7.5;

  if (hco3Mmol <= 0) {
    const acid = effectiveAcidMmol(acidProfile);
    const phosphateBuffer = (acidProfile?.h2po4 ?? 0) + (acidProfile?.h3po4 ?? 0);
    if (phosphateBuffer > 0) return Math.max(2.5, Math.min(7.2, 6.2 - acid / phosphateBuffer));
    return Math.max(3.0, Math.min(8.5, waterPH - acid * 0.8));
  }

  const waterHco3Frac = carbonateFractions(waterPH).hco3 || 1;
  const initialDicMmol = hco3Mmol / Math.max(waterHco3Frac, 1e-9);
  const initialAlkalinity = hco3Mmol;

  function carbonateAlkalinity(pH) {
    const H = Math.pow(10, -pH);
    const OH = WATER_KW / H;
    const carbonate = carbonateFractions(pH);
    const acid = effectiveAcidMmol(acidProfile, pH);
    const dicMmol = Math.max(0, initialDicMmol - acid * WORKING_SOLUTION_CO2_RELEASE_FACTOR);
    return dicMmol * (carbonate.hco3 + 2 * carbonate.co3) + (OH - H) * 1000;
  }

  function targetAlkalinityAt(pH) {
    return initialAlkalinity - effectiveAcidMmol(acidProfile, pH);
  }

  let lo = 3.0;
  let hi = 9.5;
  let fLo = carbonateAlkalinity(lo) - targetAlkalinityAt(lo);
  let fHi = carbonateAlkalinity(hi) - targetAlkalinityAt(hi);

  if (Math.sign(fLo) === Math.sign(fHi)) {
    let bestPH = waterPH;
    let bestAbs = Infinity;
    for (let pH = lo; pH <= hi; pH += 0.02) {
      const absAlk = Math.abs(carbonateAlkalinity(pH) - targetAlkalinityAt(pH));
      if (absAlk < bestAbs) {
        bestAbs = absAlk;
        bestPH = pH;
      }
    }
    return Math.max(lo, Math.min(hi, bestPH));
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fMid = carbonateAlkalinity(mid) - targetAlkalinityAt(mid);
    if (Math.abs(fMid) < 1e-6) return Math.max(lo, Math.min(hi, mid));
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }

  return Math.max(3.0, Math.min(9.5, (lo + hi) / 2));
}

function effectiveAcidMmol(acidProfile = null, pH = 5.8) {
  if (!acidProfile) return 0;
  const phosphate = phosphateAcidEquivalents(pH);
  return (
    (acidProfile.strong ?? 0) +
    (acidProfile.h3po4 ?? 0) * phosphate.h3po4 +
    (acidProfile.h2po4 ?? 0) * phosphate.h2po4
  );
}

function phosphateAcidEquivalents(pH) {
  const phosphate = phosphateFractions(pH);
  return {
    h3po4: 1 + phosphate.hpo4 + 2 * phosphate.po4,
    h2po4: phosphate.hpo4 + 2 * phosphate.po4
  };
}

function calculateStockPH(totalMmol, acidProfile = null) {
  const hco3Mmol = Number(totalMmol.HCO3) || 0;
  const strongAcid = acidProfile?.strong ?? 0;
  const h3po4 = acidProfile?.h3po4 ?? 0;
  const h2po4 = acidProfile?.h2po4 ?? 0;
  const waterPH = (typeof state.water?.pH === "number" && state.water.pH > 0)
    ? state.water.pH : 7.5;
  const strongExcess = Math.max(0, strongAcid - hco3Mmol);
  if (strongExcess > 0.001) {
    const phosphoricAcid = Math.max(0, h3po4 + h2po4);
    return estimateStrongAcidStockPH(strongExcess, phosphoricAcid);
  }

  const remainingAlkalinity = Math.max(0, hco3Mmol - strongAcid);
  const h3po4Excess = Math.max(0, h3po4 - remainingAlkalinity);
  if (h3po4Excess > 0.001) {
    return estimateStrongAcidStockPH(0, h3po4Excess);
  }

  if (hco3Mmol > 0) {
    const waterHco3Frac = carbonateFractions(waterPH).hco3 || 1;
    const dicMmol = hco3Mmol / Math.max(waterHco3Frac, 1e-9);
    const initialAlkalinity = hco3Mmol;

    const carbonateAlkalinity = (pH) => {
      const H = Math.pow(10, -pH);
      const OH = WATER_KW / H;
      const carbonate = carbonateFractions(pH);
      return dicMmol * (carbonate.hco3 + 2 * carbonate.co3) + (OH - H) * 1000;
    };

    const balance = (pH) =>
      carbonateAlkalinity(pH) - (initialAlkalinity - effectiveAcidMmol(acidProfile, pH));

    const solved = solvePHByBisection(balance, 0.3, 9.5, waterPH);
    if (Number.isFinite(solved)) return clampPH(solved, 0.3, 9.5);
  }

  if (h2po4 > 0.001) {
    return clampPH((PHOSPHORIC_PKA1 + PHOSPHORIC_PKA2) / 2, 3.5, 5.8);
  }

  return calculatePH(totalMmol, acidProfile);
}

function solvePHByBisection(balanceFn, lo, hi, fallbackPH) {
  let fLo = balanceFn(lo);
  let fHi = balanceFn(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) {
    let bestPH = fallbackPH;
    let bestAbs = Infinity;
    for (let pH = lo; pH <= hi; pH += 0.02) {
      const abs = Math.abs(balanceFn(pH));
      if (abs < bestAbs) {
        bestAbs = abs;
        bestPH = pH;
      }
    }
    return bestPH;
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fMid = balanceFn(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }
  return (lo + hi) / 2;
}

function estimateStrongAcidStockPH(strongMmol, phosphoricMmol = 0) {
  const strongMol = Math.max(0, strongMmol) / 1000;
  const phosphateMol = Math.max(0, phosphoricMmol) / 1000;
  if (strongMol <= 0 && phosphateMol <= 0) return 7.0;
  if (phosphateMol <= 0) return clampPH(-Math.log10(Math.max(strongMol, 1e-12)), 0.3, 7.0);

  // Charge balance for strong acid plus the first dissociation of phosphoric acid.
  const balance = (pH) => {
    const h = Math.pow(10, -pH);
    const oh = WATER_KW / h;
    const phosphate = phosphateFractions(pH);
    return h - oh - strongMol - phosphateMol * (phosphate.h2po4 + 2 * phosphate.hpo4 + 3 * phosphate.po4);
  };
  const ph = solvePHByBisection(balance, 0.3, 7.0, 2.0);
  return clampPH(ph, 0.3, 7.0);
}

function clampPH(value, min, max) {
  if (!Number.isFinite(value)) return 7.0;
  return Math.max(min, Math.min(max, value));
}

function mmolToMol(mmolPerLiter) {
  return (Number(mmolPerLiter) || 0) / 1000;
}

function carbonateFractions(pH) {
  const H = Math.pow(10, -pH);
  const denom = H * H + CARBONIC_KA1 * H + CARBONIC_KA1 * CARBONIC_KA2;
  return {
    co2: (H * H) / denom,
    hco3: (CARBONIC_KA1 * H) / denom,
    co3: (CARBONIC_KA1 * CARBONIC_KA2) / denom
  };
}

function phosphateFractions(pH) {
  const H = Math.pow(10, -pH);
  const denom =
    H * H * H +
    PHOSPHORIC_KA1 * H * H +
    PHOSPHORIC_KA1 * PHOSPHORIC_KA2 * H +
    PHOSPHORIC_KA1 * PHOSPHORIC_KA2 * PHOSPHORIC_KA3;
  return {
    h3po4: (H * H * H) / denom,
    h2po4: (PHOSPHORIC_KA1 * H * H) / denom,
    hpo4: (PHOSPHORIC_KA1 * PHOSPHORIC_KA2 * H) / denom,
    po4: (PHOSPHORIC_KA1 * PHOSPHORIC_KA2 * PHOSPHORIC_KA3) / denom
  };
}

function sulfateFractions(pH) {
  const H = Math.pow(10, -pH);
  const so4 = BISULFATE_KA / (H + BISULFATE_KA);
  return { hso4: 1 - so4, so4 };
}

const PRECIPITATION_SYSTEMS = [
  {
    salt: "CaSO4·2H2O",
    counterKey: "S",
    counterLabel: "SO4",
    ksp: 2.4e-5,
    equation: "[Ca2+] x [SO4^2-]",
    ionProduct: "1:1",
    unit: "(mol/L)^2",
    note: "25°C gypsum"
  },
  {
    salt: "Ca3(PO4)2",
    counterKey: "P",
    counterLabel: "PO4",
    ksp: 2.07e-33,
    equation: "[Ca2+]^3 x [PO4^3-]^2",
    ionProduct: "3:2",
    unit: "(mol/L)^5",
    note: "25°C"
  }
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
    compounds: [{ label: "NO3-N", percent: 8.89, element: "NO3-N" }],
    acidContrib: [{ key: "strong", purity: 0.4, molarMass: 63.012 }]
  },
  {
    id: "kh2po4",
    name: "磷酸二氢钾",
    bucket: "B",
    notes: "KH2PO4",
    compounds: [
      { label: "P", percent: 22.76, element: "P" },
      { label: "K", percent: 28.73, element: "K" }
    ],
    acidContrib: [{ key: "h2po4", purity: 1, molarMass: 136.086 }]
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
    compounds: [{ label: "P", percent: 26.89, element: "P" }],
    acidContrib: [{ key: "h3po4", purity: 0.85, molarMass: 97.994 }]
  }
];

// 测试用随机单价，单位：元/kg；后续接入真实原料价格时替换这里即可。
const TEST_FERTILIZER_PRICES = {
  "ca-no3-4h2o": 3.8,
  "mg-no3-6h2o": 5.6,
  can: 2.9,
  cacl2: 1.7,
  kcl: 2.4,
  kno3: 6.8,
  "eddha-fe-11": 78,
  "hno3-40": 2.2,
  kh2po4: 8.5,
  "mgso4-7h2o": 1.9,
  k2so4: 4.2,
  mnso4: 12,
  borax: 5.1,
  znso4: 9.4,
  cuso4: 18,
  na2moo4: 96,
  "h3po4-85": 7.2
};

const DEFAULT_FERTILIZER_PRICE = 10;
const AVERAGE_TEST_FERTILIZER_PRICE =
  Object.values(TEST_FERTILIZER_PRICES).reduce((sum, price) => sum + price, 0) /
  Object.values(TEST_FERTILIZER_PRICES).length;

const DETECTION_RULES = [
  { key: "NO3-N", matchers: [/no3/i, /硝态氮/, /硝酸盐/, /硝氮/] },
  { key: "NH4-N", matchers: [/nh4/i, /铵态氮/, /铵氮/, /氨氮/, /nh3/i] },
  { key: "N", matchers: [/\bn\b/i, /总氮/, /全氮/, /nitrogen/i] },
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

// 单位均为 mmol/L（与目标浓度网格显示单位一致）
// 微量元素参考 Hoagland 改良配方，Fe 以 EDDHA/DTPA 螯合铁计
const TARGET_PRESETS = [
  {
    id: "strawberry-veg",
    name: "草莓苗期",
    values: {
      N: 8.5, P: 1.1, K: 4.8, Ca: 3.8, Mg: 1.4, S: 1.8,
      Fe: 0.018, Mn: 0.007, Zn: 0.003, B: 0.037, Cu: 0.0008, Mo: 0.0005,
      EC: 1450, pH: 5.8
    }
  },
  {
    id: "strawberry-fruit",
    name: "草莓结果期",
    values: {
      N: 9.8, P: 1.25, K: 6.2, Ca: 4.2, Mg: 1.6, S: 2.0,
      Fe: 0.018, Mn: 0.009, Zn: 0.004, B: 0.046, Cu: 0.001, Mo: 0.0005,
      EC: 1650, pH: 5.8
    }
  },
  {
    id: "tomato-standard",
    name: "番茄标准",
    values: {
      N: 12.0, P: 1.4, K: 7.2, Ca: 4.5, Mg: 1.7, S: 2.4,
      Fe: 0.02, Mn: 0.009, Zn: 0.004, B: 0.046, Cu: 0.001, Mo: 0.0005,
      EC: 2100, pH: 5.9
    }
  },
  {
    id: "leafy-green",
    name: "叶菜通用",
    values: {
      N: 10.5, P: 1.0, K: 5.0, Ca: 3.5, Mg: 1.3, S: 1.6,
      Fe: 0.015, Mn: 0.007, Zn: 0.003, B: 0.037, Cu: 0.0008, Mo: 0.0005,
      EC: 1400, pH: 6.0
    }
  }
];

let CALC_MODE = "forward";
let APP_MODE = 0;
let _recalcTimer = null;
let _statusHoldUntil = 0;
const state = {
  water: Object.fromEntries(ELEMENT_META.map((item) => [item.key, 0])),
  targets: Object.fromEntries(ELEMENT_META.map((item) => [item.key, null])),
  inventory: Object.fromEntries(FERTILIZER_CATALOG.map((item) => [item.id, true])),
  reverseSuggestions: [],
  selectedReverseIndex: null,
  bucketA: [],
  bucketB: []
};

const waterGrid = document.querySelector("#waterGrid");
const bucketAList = document.querySelector("#bucketAList");
const bucketBList = document.querySelector("#bucketBList");
const summaryA = document.querySelector("#summaryA");
const summaryB = document.querySelector("#summaryB");
const elementTotalsGrid = document.querySelector("#elementTotalsGrid");
const targetGrid = document.querySelector("#targetGrid");
const inventoryGrid = document.querySelector("#inventoryGrid");
const selectAllInventoryBtn = document.querySelector("#selectAllInventory");
const clearAllInventoryBtn = document.querySelector("#clearAllInventory");
const kpiGrid = document.querySelector("#kpiGrid");
const irrigationBody = document.querySelector("#irrigationBody");
const precipList = document.querySelector("#precipList");
const reverseSuggestionsEl = document.querySelector("#reverseSuggestions");
const reportStatus = document.querySelector("#reportStatus");
const reportFile = document.querySelector("#reportFile");
const targetFile = document.querySelector("#targetFile");
const formulaFile = document.querySelector("#formulaFile");
const targetImportStatus = document.querySelector("#targetImportStatus");
const formulaImportStatus = document.querySelector("#formulaImportStatus");

init();

function init() {
  state.bucketA = [buildRow("A"), buildRow("A")];
  state.bucketB = [buildRow("B"), buildRow("B")];
  renderWaterTable();
  renderTargetTable();
  renderInventoryGrid();
  renderTargetPresets();
  renderBucket("A");
  renderBucket("B");
  bindStaticEvents();
  bindModeEvents();
  setMode(0);
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

  selectAllInventoryBtn?.addEventListener("click", () => setInventorySelection(true));
  clearAllInventoryBtn?.addEventListener("click", () => setInventorySelection(false));

  ["aTankVolume", "aDilution", "bTankVolume", "bDilution"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", recalculate);
  });

  reportFile.addEventListener("change", handleReportUpload);
  targetFile?.addEventListener("change", handleTargetUpload);
  formulaFile?.addEventListener("change", handleFormulaUpload);

  // 同步 DOM 初始值（浏览器可能记住了上次的选择）
  CALC_MODE = document.querySelector("#calcMode")?.value ?? "forward";
  document.querySelector("#calcMode")?.addEventListener("change", (e) => {
    CALC_MODE = e.target.value;
  });

  document.querySelector("#startCalc")?.addEventListener("click", () => {
    if (CALC_MODE === "reverse") {
      calculateReverse();
    } else {
      recalculate();
    }
  });

  document.querySelector("#targetPreset")?.addEventListener("change", (event) => {
    applyTargetPreset(event.target.value);
  });

  document.querySelector("#clearTargets")?.addEventListener("click", () => {
    clearReverseSelection();
    clearTargets();
    document.querySelector("#targetPreset").value = "";
    renderTargetTable();
    recalculate();
  });

  document.querySelector("#exportResults")?.addEventListener("click", exportResults);
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
  waterGrid.innerHTML = ELEMENT_META.map((item) => `
    <label class="water-cell">
      <span class="el">${item.key}</span>
      <input data-water-key="${item.key}" type="number" step="0.001"
        value="${toInputValue(state.water[item.key])}" />
      <span class="unit">${item.unit || ""}</span>
    </label>
  `).join("");

  waterGrid.querySelectorAll("[data-water-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const key = event.target.dataset.waterKey;
      clearReverseSelection();
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
    .map((item) => `<option value="${item.id}">${item.name} · ${item.notes}</option>`)
    .join("");

  if (rows.length === 0) {
    list.innerHTML = `<div class="empty">点击「添加肥料」开始配置</div>`;
    return;
  }

  list.innerHTML = rows.map((row) => {
    const fertilizer = getFertilizer(row.fertilizerId);
    const chips = fertilizer.compounds
      .map((c) => `<span class="compound-chip">${c.label} ${formatPercent(c.percent)}</span>`)
      .join("");
    return `
      <div class="mix-item" data-row-id="${row.id}">
        <div class="mix-main">
          <select data-role="fertilizer">${options}</select>
          <div class="grams">
            <input data-role="amount" type="number" min="0" step="0.001" value="${toInputValue(row.amount)}" />
            <select data-role="unit" class="unit-sel">
              <option value="g">g</option>
              <option value="kg">kg</option>
            </select>
          </div>
          <button class="del" data-role="remove" type="button">✕</button>
        </div>
        ${chips ? `<div class="compound-chips">${chips}</div>` : ""}
      </div>
    `;
  }).join("");

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
      const raw = toNumber(event.target.value);
      row.amount = Math.max(0, raw);
      if (raw < 0) event.target.value = 0;
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
  const grids = [targetGrid, document.getElementById("mode2TargetGrid")].filter(Boolean);
  if (!grids.length) return;
  const html = ELEMENT_META.map((item) => `
    <label class="water-cell">
      <span class="el">${item.key}</span>
      <input data-target-key="${item.key}" type="number" step="0.001"
        value="${toInputValue(state.targets[item.key])}" />
      <span class="unit">${getDisplayUnit(item.key)}</span>
    </label>
  `).join("");
  grids.forEach((grid) => {
    grid.innerHTML = html;
    grid.querySelectorAll("[data-target-key]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const key = event.target.dataset.targetKey;
        clearReverseSelection();
        state.targets[key] = toNullableNumber(event.target.value);
        document.querySelectorAll(`[data-target-key="${key}"]`).forEach((el) => {
          if (el !== event.target) el.value = toInputValue(state.targets[key]);
        });
        recalculate();
      });
    });
  });
}

function renderInventoryGrid() {
  if (!inventoryGrid) return;
  inventoryGrid.innerHTML = FERTILIZER_CATALOG.map((item) => `
    <label class="inventory-item">
      <input data-inventory-id="${item.id}" type="checkbox" ${state.inventory[item.id] ? "checked" : ""} />
      <div>
        <b>${item.name}</b>
        <span>${item.bucket} · ${item.notes}</span>
      </div>
    </label>
  `).join("");

  inventoryGrid.querySelectorAll("[data-inventory-id]").forEach((input) => {
    input.addEventListener("change", (event) => {
      clearReverseSelection();
      state.inventory[event.target.dataset.inventoryId] = event.target.checked;
      recalculate();
    });
  });
}

function setInventorySelection(checked) {
  clearReverseSelection();
  FERTILIZER_CATALOG.forEach((item) => {
    state.inventory[item.id] = checked;
  });
  inventoryGrid?.querySelectorAll("[data-inventory-id]").forEach((input) => {
    input.checked = checked;
  });
  recalculate();
}

function renderTargetPresets() {
  const html = `<option value="">目标预设</option>` +
    TARGET_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join("");
  ["#targetPreset", "#targetPreset2"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = html;
  });
}

function applyTargetPreset(presetId) {
  const preset = TARGET_PRESETS.find((item) => item.id === presetId);
  if (!preset) return;
  clearReverseSelection();
  clearTargets();
  Object.entries(preset.values).forEach(([key, value]) => {
    state.targets[key] = value;
  });
  renderTargetTable();
  recalculate();
}

function clearTargets() {
  Object.keys(state.targets).forEach((key) => { state.targets[key] = null; });
}

function applyDefaultTargetPH() {
  if (!(typeof state.targets.pH === "number" && Number.isFinite(state.targets.pH) && state.targets.pH > 0)) {
    state.targets.pH = DEFAULT_TARGET_PH;
  }
}

function recalculate() {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(_doRecalculate, 150);
}

function _doRecalculate() {
  if (APP_MODE === 2) {
    if (state.selectedReverseIndex == null) {
      calculateReverse();
    } else {
      renderCurrentCalculation();
    }
    return;
  }
  renderCurrentCalculation();
}

function renderCurrentCalculation() {
  const statusEl = document.querySelector("#calcStatus");
  try {
    const bucketAResult = calculateBucket(state.bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
    const bucketBResult = calculateBucket(state.bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));

    renderSummary(summaryA, bucketAResult, "A");
    renderSummary(summaryB, bucketBResult, "B");
    renderElementTotals(bucketAResult, bucketBResult);
    renderIrrigation(bucketAResult, bucketBResult);
    renderKpiCards(bucketAResult, bucketBResult);
    renderPrecipitation(bucketAResult, bucketBResult);

    if (statusEl && Date.now() > _statusHoldUntil) {
      const hasData = Object.values(bucketAResult.totals).some(v => v > 0) || Object.values(bucketBResult.totals).some(v => v > 0);
      statusEl.textContent = hasData ? "计算完成" : "";
    }
  } catch (err) {
    console.error('FertiCal recalculate error:', err);
    if (statusEl) statusEl.textContent = "错误: " + err.message;
  }
}

function calculateBucket(rows, tankVolume, dilutionFactor) {
  const totals = emptyElementMap();
  const acidTotals = emptyAcidProfile();

  rows.forEach((row) => {
    const fertilizer = getFertilizer(row.fertilizerId);
    const amountInGrams = row.unit === "kg" ? row.amount * 1000 : row.amount;
    fertilizer.compounds.forEach((compound) => {
      const mass = amountInGrams * (compound.percent / 100);
      totals[compound.element] += mass;
    });
    fertilizer.acidContrib?.forEach((acid) => {
      acidTotals[acid.key] += amountInGrams * acid.purity / acid.molarMass;
    });
  });

  totals.N = totals["NO3-N"] + totals["NH4-N"];

  const perLiter = emptyElementMap();
  const irrigation = emptyElementMap();
  const perLiterMmol = emptyElementMap();
  const irrigationMmol = emptyElementMap();
  const acidPerLiter = emptyAcidProfile();
  const acidIrrigation = emptyAcidProfile();

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

  Object.keys(acidTotals).forEach((key) => {
    if (!tankVolume || !dilutionFactor) return;
    acidPerLiter[key] = acidTotals[key] * 1000 / tankVolume;
    acidIrrigation[key] = acidPerLiter[key] / dilutionFactor;
  });

  return { totals, perLiter, irrigation, perLiterMmol, irrigationMmol, acidTotals, acidPerLiter, acidIrrigation };
}

function renderSummary(target, bucketResult, bucketName) {
  const chipsEl = target.querySelector(".chips");
  const leadKeys = ["N", "P", "K", "Ca", "Mg", "S", "Fe"];
  const html = leadKeys
    .map((key) => {
      const amount = bucketResult.totals[key];
      if (!amount) return "";
      return `<span class="chip">${key} <span class="val">${formatNumber(amount)} g</span></span>`;
    })
    .join("");

  if (html) {
    target.style.display = "";
    if (chipsEl) chipsEl.innerHTML = html;
  } else {
    target.style.display = "none";
  }
}

function renderElementTotals(bucketAResult, bucketBResult) {
  if (!elementTotalsGrid) return;
  const html = ELEMENT_META
    .filter((item) => !["EC", "pH"].includes(item.key))
    .map((item) => {
      const aValue = bucketAResult.totals[item.key] ?? 0;
      const bValue = bucketBResult.totals[item.key] ?? 0;
      if (!aValue && !bValue && !["N", "P", "K", "Ca", "Mg", "S"].includes(item.key)) return "";
      return `
        <div class="grams-row">
          <span><b>${item.key}</b></span>
          <span class="vals">
            <span class="a">A ${formatNumber(aValue)}</span>
            <span class="b">B ${formatNumber(bValue)}</span>
          </span>
        </div>
      `;
    })
    .join("");
  elementTotalsGrid.innerHTML = html || `<div style="color:var(--muted);font-size:13px;grid-column:1/-1">尚未配置肥料</div>`;
}

function buildTotalMmol(bucketAResult, bucketBResult) {
  const totalMmol = emptyElementMap();
  ELEMENT_META.forEach((item) => {
    if (!MOLAR_MASS[item.key]) return;
    totalMmol[item.key] =
      (toMmolPerLiter(item.key, state.water[item.key] ?? 0) ?? 0) +
      (bucketAResult.irrigationMmol[item.key] ?? 0) +
      (bucketBResult.irrigationMmol[item.key] ?? 0);
  });
  return totalMmol;
}

function buildTotalAcidProfile(bucketAResult, bucketBResult, source = "acidIrrigation") {
  return mergeAcidProfiles(bucketAResult?.[source], bucketBResult?.[source]);
}

function buildWaterMmol() {
  const waterMmol = emptyElementMap();
  ELEMENT_META.forEach((item) => {
    if (!MOLAR_MASS[item.key]) return;
    waterMmol[item.key] = toMmolPerLiter(item.key, state.water[item.key] ?? 0) ?? 0;
  });
  return waterMmol;
}

function renderKpiCards(bucketAResult, bucketBResult) {
  if (!kpiGrid) return;
  const totalMmol = buildTotalMmol(bucketAResult, bucketBResult);
  const acidProfile = buildTotalAcidProfile(bucketAResult, bucketBResult);
  const ecValue = calculateEC(totalMmol);
  const phValue = calculatePH(totalMmol, acidProfile);
  const cards = [
    { key: "EC", label: "EC", value: ecValue, unit: "uS/cm" },
    { key: "pH", label: "pH", value: phValue, unit: "" },
    { key: "N", label: "总氮", value: totalMmol.N ?? 0, unit: "mmol/L" },
    { key: "K", label: "钾", value: totalMmol.K ?? 0, unit: "mmol/L" },
    { key: "Ca", label: "钙", value: totalMmol.Ca ?? 0, unit: "mmol/L" },
    { key: "Mg", label: "镁", value: totalMmol.Mg ?? 0, unit: "mmol/L" }
  ];

  kpiGrid.innerHTML = cards.map((card) => {
    const targetValue = state.targets[card.key];
    const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
    const ratio = hasTarget && targetValue !== 0 ? (card.value - targetValue) / targetValue : null;
    const cls = deviationClass(ratio, card.key);
    const targetText = hasTarget ? `目标 ${formatNumber(targetValue)}${card.unit ? " " + card.unit : ""}` : "未设目标";
    return `
      <div class="kpi-card">
        <div class="kpi-label ${card.key === "pH" ? "keep-case" : ""}">${card.label}</div>
        <div class="kpi-value ${cls}">${card.key === "pH" ? card.value.toFixed(2) : formatNumber(card.value)}</div>
        <div class="kpi-meta">${targetText}${ratio === null ? "" : ` · ${formatDeviation(ratio)}`}</div>
      </div>
    `;
  }).join("");
}

function formatAcidContribution(profile, pH) {
  const acid = effectiveAcidMmol(profile, Number.isFinite(pH) ? pH : 5.8);
  return acid > 0 ? `酸 ${formatNumber(acid)}` : "-";
}

function renderIrrigation(bucketAResult, bucketBResult) {
  try {
    if (!irrigationBody) {
      console.error('FertiCal: irrigationBody DOM element not found');
      return;
    }
    const isConvertible = (key) => Boolean(MOLAR_MASS[key]);

    const totalMmol = buildTotalMmol(bucketAResult, bucketBResult);
    const acidProfile = buildTotalAcidProfile(bucketAResult, bucketBResult);
    const waterMmol = buildWaterMmol();

    irrigationBody.innerHTML = ELEMENT_META.map((item) => {
      if (item.key === "EC") {
        const ecValue = calculateEC(totalMmol);
        const waterEC = state.water.EC ?? 0;
        const totalEC = ecValue;
        const targetValue = state.targets.EC;
        const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
        const deviationRatio = hasTarget && targetValue !== 0 ? (totalEC - targetValue) / targetValue : null;
        const devCls = deviationClass(deviationRatio, "EC");
        return `
          <tr>
            <td>EC</td>
            <td>${item.unit}</td>
            <td>${formatNumber(waterEC)}</td>
            <td>-</td><td>-</td>
            <td class="${devCls}">${formatNumber(totalEC)}</td>
            <td>${hasTarget ? formatNumber(targetValue) : "-"}</td>
            <td class="${devCls}">${formatDeviation(deviationRatio)}</td>
          </tr>
        `;
      }

      if (item.key === "pH") {
        const phValue = calculatePH(totalMmol, acidProfile);
        const waterVal = state.water.pH ?? 0;
        const displayPH = Number.isFinite(phValue) ? phValue : waterVal;
        const targetValue = state.targets.pH;
        const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
        const deviationRatio = hasTarget && targetValue !== 0 ? (displayPH - targetValue) / targetValue : null;
        const devCls = deviationClass(deviationRatio, "pH");
        return `
          <tr>
            <td>pH</td>
            <td>${item.unit}</td>
            <td>${formatNumber(waterVal)}</td>
            <td>${formatAcidContribution(bucketAResult.acidIrrigation, displayPH)}</td>
            <td>${formatAcidContribution(bucketBResult.acidIrrigation, displayPH)}</td>
            <td class="${devCls}">${displayPH.toFixed(2)}</td>
            <td>${hasTarget ? formatNumber(targetValue) : "-"}</td>
            <td class="${devCls}">${formatDeviation(deviationRatio)}</td>
          </tr>
        `;
      }

      const isConverted = isConvertible(item.key);
      const waterValue = isConverted ? waterMmol[item.key] ?? 0 : (state.water[item.key] ?? 0);
      const aValue = isConverted ? (bucketAResult.irrigationMmol[item.key] ?? 0) : (bucketAResult.irrigation[item.key] ?? 0);
      const bValue = isConverted ? (bucketBResult.irrigationMmol[item.key] ?? 0) : (bucketBResult.irrigation[item.key] ?? 0);
      const total = waterValue + aValue + bValue;
      const unit = getDisplayUnit(item.key);
      const targetValue = state.targets[item.key];
      const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
      const deviationRatio = hasTarget && targetValue !== 0 ? (total - targetValue) / targetValue : null;
      const devCls = deviationClass(deviationRatio, item.key);

      return `
        <tr>
          <td>${item.label}</td>
          <td>${unit}</td>
          <td>${formatNumber(waterValue)}</td>
          <td>${formatNumber(aValue)}</td>
          <td>${formatNumber(bValue)}</td>
          <td class="${devCls}">${formatNumber(total)}</td>
          <td>${hasTarget ? formatNumber(targetValue) : "-"}</td>
          <td class="${devCls}">${formatDeviation(deviationRatio)}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error('renderIrrigation ERROR:', err.message, err.stack);
    irrigationBody.innerHTML = `<tr><td colspan="8" style="color:red">renderIrrigation错误: ${err.message}</td></tr>`;
  }
}

function renderPrecipitation(bucketAResult, bucketBResult) {
  if (!precipList) return;
  const title = document.querySelector("#precipTitle");
  const items = [
    ...buildPrecipitationRows("A", bucketAResult),
    ...buildPrecipitationRows("B", bucketBResult)
  ];

  if (items.length === 0) {
    if (title) title.innerHTML = "析出风险";
    precipList.innerHTML = `<li class="precip-row"><span style="color:var(--muted)">尚未配置肥料</span></li>`;
    return;
  }

  const hasDanger = items.some((r) => r.risk === "bad");
  if (title) title.innerHTML = `析出风险 <span style="color:${hasDanger ? "var(--bad)" : "var(--good)"}">${hasDanger ? "⚠" : "✓"}</span>`;
  precipList.innerHTML = items.map((r) => `
    <li class="precip-row">
      <span><span class="dot dot-${r.risk}"></span><b>${r.bucket} 桶</b>
        <span style="color:var(--muted);margin-left:6px">${r.salt}</span></span>
      <span class="precip-meta">pH ${r.pH.toFixed(2)} · ${r.equation} · IP ${formatScientific(r.ip)} ${r.unit} · Ksp ${formatScientific(r.ksp)} ${r.unit}</span>
    </li>
  `).join("");
}

function buildPrecipitationRows(bucketName, bucketResult) {
  const stockMmol = buildStockMmol(bucketResult);
  const stockPH = calculateStockPH(stockMmol, bucketResult.acidPerLiter);
  const caMol = mmolToMol(stockMmol.Ca ?? 0);
  return PRECIPITATION_SYSTEMS.map((system) => {
    let counterMol = 0;
    if (system.counterKey === "P") {
      const phosphate = phosphateFractions(stockPH);
      counterMol = mmolToMol(stockMmol.P ?? 0) * phosphate.po4;
    } else if (system.counterKey === "S") {
      const sulfate = sulfateFractions(stockPH);
      counterMol = mmolToMol(stockMmol.S ?? 0) * sulfate.so4;
    } else {
      counterMol = mmolToMol(stockMmol[system.counterKey] ?? 0);
    }
    const ip = system.ionProduct === "1:1"
      ? caMol * counterMol
      : Math.pow(caMol, 3) * Math.pow(counterMol, 2);
    const risk = ip > system.ksp ? "bad" : ip > system.ksp / 4 ? "warn" : "good";
    return {
      bucket: bucketName,
      salt: system.salt,
      ip,
      ksp: system.ksp,
      risk,
      pH: stockPH,
      equation: system.equation,
      unit: system.unit,
      note: system.note
    };
  });
}

function buildStockMmol(bucketResult) {
  const stockMmol = emptyElementMap();
  ELEMENT_META.forEach((item) => {
    if (!MOLAR_MASS[item.key]) return;
    stockMmol[item.key] =
      (toMmolPerLiter(item.key, state.water[item.key] ?? 0) ?? 0) +
      (bucketResult.perLiterMmol[item.key] ?? 0);
  });
  return stockMmol;
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

async function handleReportUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  reportStatus.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseWorkbook(workbook);
    Object.assign(state.water, parsed.values);
    clearReverseSelection();
    syncWaterTotalN();
    renderWaterTable();
    recalculate();
    reportStatus.textContent = `已导入 ${file.name}，识别到 ${parsed.hitCount} 个指标，来源工作表：${parsed.sheetName}`;
  } catch (error) {
    console.error(error);
    reportStatus.textContent = `文件读取失败：${error?.message || "请确认 Excel 文件可正常打开"}`;
  }
}

async function handleTargetUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusEl = APP_MODE === 2
    ? (document.getElementById("mode2TargetStatus") ?? targetImportStatus)
    : targetImportStatus;
  statusEl.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await apiFetch("/api/import/target", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name)
      },
      body: buffer
    });
    clearTargets();
    Object.entries(parsed.values || {}).forEach(([key, value]) => {
      if (key in state.targets && Number.isFinite(Number(value))) {
        state.targets[key] = Number(value);
      }
    });
    applyDefaultTargetPH();
    ["#targetPreset", "#targetPreset2"].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.value = "";
    });
    clearReverseSelection();
    renderTargetTable();
    recalculate();
    statusEl.textContent = `已导入 ${file.name}，识别到 ${Object.keys(parsed.values || {}).length} 个目标指标`;
  } catch (error) {
    console.error(error);
    const message = error?.message === "Not Found"
      ? "后端接口不存在，请停止旧后端后重新运行 backend/start.sh"
      : (error?.message || "请确认后端已启动，并安装解析依赖");
    statusEl.textContent = `目标文件解析失败：${message}`;
  } finally {
    event.target.value = "";
  }
}

async function handleFormulaUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  formulaImportStatus.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await parseFormulaFile(file, buffer);
    if (!parsed.bucketA.length && !parsed.bucketB.length) {
      throw new Error("未识别到 A桶/B桶肥料行");
    }

    state.bucketA = parsed.bucketA.length ? parsed.bucketA : [buildRow("A")];
    state.bucketB = parsed.bucketB.length ? parsed.bucketB : [buildRow("B")];
    clearReverseSelection();

    if (parsed.aVolume) document.querySelector("#aTankVolume").value = parsed.aVolume;
    if (parsed.bVolume) document.querySelector("#bTankVolume").value = parsed.bVolume;

    renderBucket("A");
    renderBucket("B");
    recalculate();
    formulaImportStatus.textContent =
      `已导入 ${file.name}，A桶 ${parsed.bucketA.length} 项，B桶 ${parsed.bucketB.length} 项，来源工作表：${parsed.sheetName}`;
  } catch (error) {
    console.error(error);
    const message = error?.message === "Not Found"
      ? "后端接口不存在，请停止旧后端后重新运行 backend/start.sh"
      : (error?.message || "请确认文件包含 A桶/B桶、名称、kg/100L");
    formulaImportStatus.textContent = `配方文件解析失败：${message}`;
  } finally {
    event.target.value = "";
  }
}

async function parseFormulaFile(file, buffer) {
  if (isSpreadsheetFile(file.name)) {
    const workbook = XLSX.read(buffer, { type: "array" });
    return parseFormulaWorkbook(workbook);
  }

  const parsed = await apiFetch("/api/import/formula", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name)
    },
    body: buffer
  });

  return {
    ...parsed,
    bucketA: (parsed.bucketA || []).map((row) => ({ ...row, id: crypto.randomUUID() })),
    bucketB: (parsed.bucketB || []).map((row) => ({ ...row, id: crypto.randomUUID() })),
    sheetName: parsed.source || file.name
  };
}

function isSpreadsheetFile(fileName) {
  return /\.(xlsx|xls|csv)$/i.test(fileName);
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

function parseFormulaWorkbook(workbook) {
  let best = { bucketA: [], bucketB: [], aVolume: 100, bVolume: 100, sheetName: workbook.SheetNames[0], score: 0 };

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const parsed = parseFormulaRows(rows, sheetName);
    const score = parsed.bucketA.length + parsed.bucketB.length;
    if (score > best.score) best = { ...parsed, score };
  });

  return best;
}

function parseFormulaRows(rows, sheetName) {
  const result = { bucketA: [], bucketB: [], aVolume: 100, bVolume: 100, sheetName };
  let currentBucket = null;
  let nameCol = -1;
  let amountCol = -1;
  let pendingVolume = null;

  rows.forEach((row) => {
    if (!Array.isArray(row)) return;
    const rowText = row.map((cell) => String(cell ?? "")).join(" ");

    if (/A\s*桶/i.test(rowText)) {
      currentBucket = "A";
      nameCol = -1;
      amountCol = -1;
    } else if (/B\s*桶/i.test(rowText)) {
      currentBucket = "B";
      nameCol = -1;
      amountCol = -1;
    }

    const volumeMatch = rowText.match(/kg\s*\/\s*(\d+(?:\.\d+)?)\s*L/i);
    if (volumeMatch) {
      pendingVolume = Number(volumeMatch[1]);
      if (currentBucket === "A") result.aVolume = pendingVolume;
      if (currentBucket === "B") result.bVolume = pendingVolume;
    }

    row.forEach((cell, index) => {
      const text = String(cell ?? "").trim();
      if (/名称|肥料/.test(text)) nameCol = index;
      if (isFormulaAmountHeader(text)) amountCol = index;
    });

    if (!currentBucket) return;

    const nameIndex = nameCol >= 0 ? nameCol : row.findIndex((cell) => findFertilizerByName(cell, currentBucket));
    if (nameIndex < 0) return;

    const fertilizer = findFertilizerByName(row[nameIndex], currentBucket);
    if (!fertilizer) return;

    const amount = amountCol >= 0
      ? toPositiveNumber(row[amountCol])
      : row.map(toPositiveNumber).find((value) => value > 0) ?? 0;

    if (amount <= 0) return;

    const targetRows = currentBucket === "A" ? result.bucketA : result.bucketB;
    targetRows.push({
      id: crypto.randomUUID(),
      fertilizerId: fertilizer.id,
      amount,
      unit: "kg"
    });
  });

  return result;
}

function isFormulaAmountHeader(text) {
  return /用量|质量/.test(text) || /^(?:kg|公斤|千克)\s*\/\s*\d+(?:\.\d+)?\s*l$/i.test(text);
}

function findFertilizerByName(source, bucket) {
  if (source == null) return null;
  const text = normalizeFormulaName(source);
  if (!text) return null;

  const candidates = getCatalogByBucket(bucket);
  const exactMatch = candidates.find((item) => {
    const names = [item.name, item.notes, ...getFertilizerAliases(item)].map(normalizeFormulaName).filter(Boolean);
    return names.some((name) => name === text);
  });
  if (exactMatch) return exactMatch;

  const aliasMatch = candidates.find((item) =>
    getFertilizerAliases(item)
      .map(normalizeFormulaName)
      .filter(Boolean)
      .some((alias) => text.includes(alias))
  );
  if (aliasMatch) return aliasMatch;

  return candidates.find((item) => {
    const catalogText = normalizeFormulaName(`${item.name} ${item.notes}`);
    return catalogText && text.includes(catalogText);
  }) ?? null;
}

function getFertilizerAliases(item) {
  const aliases = {
    "ca-no3-4h2o": ["硝酸钙", "四水硝酸钙", "Ca(NO3)2"],
    "mg-no3-6h2o": ["硝酸镁", "六水硝酸镁", "Mg(NO3)2"],
    can: ["硝酸铵钙", "CAN"],
    cacl2: ["氯化钙", "CaCl2"],
    kcl: ["氯化钾", "KCl"],
    kno3: ["硝酸钾", "KNO3"],
    "eddha-fe-11": ["EDDHAFe", "EDDHA-Fe", "铁肥"],
    "hno3-40": ["硝酸", "HNO3"],
    kh2po4: ["磷酸二氢钾", "KH2PO4"],
    "mgso4-7h2o": ["七水硫酸镁", "五水硫酸镁", "硫酸镁", "MgSO4"],
    k2so4: ["硫酸钾", "K2SO4"],
    mnso4: ["硫酸锰", "MnSO4"],
    borax: ["硼砂", "四水八硼", "Na2B4O7"],
    znso4: ["硫酸锌", "ZnSO4"],
    cuso4: ["五水硫酸铜", "硫酸铜", "CuSO4"],
    na2moo4: ["钼酸钠", "MoNa2O4", "Na2MoO4"],
    "h3po4-85": ["磷酸", "H3PO4"]
  };
  return aliases[item.id] ?? [];
}

function normalizeFormulaName(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[（）()·•，,、\-—_]/g, "")
    .replace(/[₀-₉]/g, (char) => "₀₁₂₃₄₅₆₇₈₉".indexOf(char))
    .toLowerCase();
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
  if (totalFromForms > 0) {
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

function mergeAcidProfiles(...profiles) {
  const merged = emptyAcidProfile();
  profiles.forEach((profile) => {
    if (!profile) return;
    Object.entries(profile).forEach(([key, value]) => {
      merged[key] += Number(value) || 0;
    });
  });
  return merged;
}

function emptyElementMap() {
  return Object.fromEntries(ELEMENT_META.map((item) => [item.key, 0]));
}

function emptyAcidProfile() {
  return { strong: 0, h3po4: 0, h2po4: 0 };
}

function getDisplayUnit(key) {
  return MOLAR_MASS[key] ? "mmol/L" : (ELEMENT_META.find((item) => item.key === key)?.unit ?? "");
}

function toMmolPerLiter(key, mgPerLiter) {
  if (mgPerLiter == null) return null;
  const molarMass = MOLAR_MASS[key];
  if (!molarMass) return mgPerLiter;
  return mgPerLiter / molarMass;
}

function getFertilizer(fertilizerId) {
  return FERTILIZER_CATALOG.find((item) => item.id === fertilizerId) ?? FERTILIZER_CATALOG[0];
}

function getNumericField(id) {
  const el = document.querySelector(`#${id}`);
  const isPosOnly = id.includes("Volume") || id.includes("Dilution");
  return isPosOnly ? toPositiveNumber(el.value) : toNumber(el.value);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function toNullableNumber(value) {
  if (value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toInputValue(value) {
  return value == null || value === 0 ? "" : value;
}

function deviationClass(ratio, key = "") {
  if (ratio === null) return "";
  const abs = Math.abs(ratio);
  const badThreshold = ["S", "Cl"].includes(key) ? 0.50 : 0.30;
  const goodThreshold = ["S", "Cl"].includes(key) ? 0.30 : 0.15;
  if (abs <= goodThreshold) return "dev-good";
  if (abs <= badThreshold) return "dev-warn";
  return "dev-bad";
}

function formatDeviation(ratio) {
  if (ratio === null) return "-";
  return `${ratio >= 0 ? "+" : ""}${formatNumber(ratio * 100)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function formatScientific(value) {
  if (!value) return "0";
  return Number(value).toExponential(3);
}

function exportResults() {
  const rows = Array.from(irrigationBody?.querySelectorAll("tr") ?? []).map((tr) =>
    Array.from(tr.children).map((td) => td.textContent.trim())
  );
  if (!rows.length) {
    alert("当前还没有可导出的计算结果");
    return;
  }

  const header = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent.trim());
  const summary = [
    ["导出时间", new Date().toLocaleString("zh-CN")],
    ["A 桶体积 L", document.querySelector("#aTankVolume")?.value || ""],
    ["A 桶稀释倍数", document.querySelector("#aDilution")?.value || ""],
    ["B 桶体积 L", document.querySelector("#bTankVolume")?.value || ""],
    ["B 桶稀释倍数", document.querySelector("#bDilution")?.value || ""],
    []
  ];
  const data = [...summary, header, ...rows];

  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "理论灌溉液");
    XLSX.writeFile(wb, `FertiCal-${dateStamp()}.xlsx`);
    return;
  }

  const csv = data.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `FertiCal-${dateStamp()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSelectedFormula() {
  const selected = state.reverseSuggestions[state.selectedReverseIndex];
  if (!selected) {
    alert("请先采用一个配方方案");
    return;
  }

  const volume = Number(document.querySelector("#formulaExportVolume")?.value || 100);
  const format = document.querySelector("#formulaExportFormat")?.value || "xlsx";
  const rows = buildFormulaExportRows(selected, volume);

  if (format === "pdf") {
    exportFormulaPdf(selected, volume, rows);
  } else {
    exportFormulaWorkbook(selected, volume, rows);
  }

  state.reverseSuggestions = [selected];
  state.selectedReverseIndex = 0;
  renderReverseSuggestions(state.reverseSuggestions);
  const statusEl = document.querySelector("#calcStatus");
  if (statusEl) statusEl.textContent = `已导出「${selected.name}」，未选方案已收起`;
}

function buildFormulaExportRows(suggestion, volume) {
  const aBase = getNumericField("aTankVolume") || 100;
  const bBase = getNumericField("bTankVolume") || 100;
  const buildRows = (bucket, sourceRows, baseVolume) => sourceRows.map((row) => {
    const fertilizer = getFertilizer(row.fertilizerId);
    const sourceAmount = row.unit === "kg" ? row.amount : row.amount / 1000;
    const scaledKg = sourceAmount * volume / baseVolume;
    return {
      bucket,
      fertilizer: fertilizer.name,
      amountKg: scaledKg,
      amountText: `${formatNumber(scaledKg)} kg`,
      notes: fertilizer.notes
    };
  });

  return [
    ...buildRows("A", suggestion.bucketA, aBase),
    ...buildRows("B", suggestion.bucketB, bBase)
  ];
}

function exportFormulaWorkbook(suggestion, volume, rows) {
  const data = [
    ["FertiCal 配方导出"],
    ["方案", suggestion.name],
    ["AB肥配制量", `${volume} L`],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    [],
    ["桶", "肥料", "用量 kg", "备注"],
    ...rows.map((row) => [row.bucket, row.fertilizer, Number(row.amountKg.toFixed(4)), row.notes])
  ];

  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "配方");
    XLSX.writeFile(wb, `FertiCal-配方-${suggestion.id}-${volume}L-${dateStamp()}.xlsx`);
    return;
  }

  const csv = data.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadTextFile(`FertiCal-配方-${suggestion.id}-${volume}L-${dateStamp()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

function exportFormulaPdf(suggestion, volume, rows) {
  const html = `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>FertiCal 配方 - ${escapeHtml(suggestion.name)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #111827; }
          h1 { font-size: 22px; margin: 0 0 8px; }
          p { color: #4b5563; margin: 0 0 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
          th { background: #f3f4f6; }
          @media print { body { padding: 20mm; } }
        </style>
      </head>
      <body>
        <h1>FertiCal 配方导出</h1>
        <p>方案：${escapeHtml(suggestion.name)} · AB肥配制量：${volume} L · ${escapeHtml(new Date().toLocaleString("zh-CN"))}</p>
        <table>
          <thead><tr><th>桶</th><th>肥料</th><th>用量</th><th>备注</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.bucket)}</td>
                <td>${escapeHtml(row.fertilizer)}</td>
                <td>${escapeHtml(row.amountText)}</td>
                <td>${escapeHtml(row.notes)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <script>window.addEventListener("load", () => window.print());<\/script>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    downloadTextFile(`FertiCal-配方-${suggestion.id}-${volume}L-${dateStamp()}.html`, html, "text/html;charset=utf-8");
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadTextFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dateStamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("");
}

function calculateReverse() {
  const statusEl = document.querySelector("#calcStatus");
  if (statusEl) statusEl.textContent = "正在生成配方建议...";
  clearMode2CalculationResult();

  const suggestions = generateReverseSuggestions();
  state.reverseSuggestions = suggestions;
  state.selectedReverseIndex = null;
  if (!suggestions.length) {
    if (statusEl) statusEl.textContent = "请先设置至少一个高于原水背景的目标浓度";
    renderReverseSuggestions([]);
    return;
  }

  renderReverseSuggestions(suggestions);
  _statusHoldUntil = Date.now() + 2500;
  if (statusEl) statusEl.textContent = `已生成 ${suggestions.length} 个配方建议，请选择一个采用`;
}

function generateReverseSuggestions() {
  const profiles = [
    { id: "fit", name: "目标贴合优先", note: "尽量贴近主要目标元素", exclude: [], rowPenalty: 0.0005 },
    { id: "low-cl-s", name: "低氯低硫优先", note: "优先避开氯化盐，允许用硫酸镁补足镁", exclude: ["cacl2", "kcl", "k2so4"], rowPenalty: 0.0005 },
    { id: "low-cost", name: "原料成本最低", note: "按测试单价优先选择低成本组合", exclude: [], rowPenalty: 0.0004, costPenalty: 0.0018 }
  ];

  const suggestions = profiles
    .map((profile) => buildReverseSuggestion(profile))
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  suggestions.forEach((suggestion) => {
    const signature = [...suggestion.bucketA, ...suggestion.bucketB]
      .map((row) => `${row.fertilizerId}:${row.amount}`)
      .sort()
      .join("|");
    if (signature && !seen.has(signature)) {
      seen.add(signature);
      unique.push(suggestion);
    }
  });

  return unique.sort((a, b) => a.score - b.score).slice(0, 3);
}

function buildReverseSuggestion(profile) {
  const targetElements = ["N", "P", "K", "Ca", "Mg", "S", "Cl", "Fe", "Mn", "Zn", "B", "Cu", "Mo"];
  const activeTargets = targetElements
    .filter((key) =>
      !LOW_CONTENT_KEYS.has(key) &&
      typeof state.targets[key] === "number" &&
      Number.isFinite(state.targets[key])
    )
    .map((key) => {
      const waterValue = toMmolPerLiter(key, state.water[key] ?? 0) ?? 0;
      return {
        key,
        need: Math.max(0, state.targets[key] - waterValue),
        target: state.targets[key],
        weight: reverseTargetWeight(key)
      };
    })
    .filter((item) => item.need > 0);

  if (!activeTargets.length) return null;

  const aTank = getNumericField("aTankVolume");
  const aDilution = getNumericField("aDilution");
  const bTank = getNumericField("bTankVolume");
  const bDilution = getNumericField("bDilution");

  if (!aTank || !aDilution || !bTank || !bDilution) {
    return null;
  }

  const variables = [
    ...getCatalogByBucket("A").map((fertilizer) => ({ fertilizer, bucket: "A" })),
    ...getCatalogByBucket("B").map((fertilizer) => ({ fertilizer, bucket: "B" }))
  ].filter((variable) =>
    state.inventory[variable.fertilizer.id] &&
    !profile.exclude.includes(variable.fertilizer.id) &&
    !isAcidFertilizer(variable.fertilizer)
  );

  const matrix = activeTargets.map((target) =>
    variables.map((variable) => contributionPerKg(variable, target.key, { aTank, aDilution, bTank, bDilution }) * target.weight)
  );
  const target = activeTargets.map((item) => item.need * item.weight);

  if (profile.rowPenalty) {
    variables.forEach((_, index) => {
      const row = Array(variables.length).fill(0);
      row[index] = profile.rowPenalty;
      matrix.push(row);
      target.push(0);
    });
  }

  if (profile.costPenalty) {
    variables.forEach((variable, index) => {
      const row = Array(variables.length).fill(0);
      row[index] = profile.costPenalty * normalizedFertilizerPrice(variable.fertilizer.id);
      matrix.push(row);
      target.push(0);
    });
  }

  const solution = solveNonNegativeLeastSquares(matrix, target);
  if (!solution) return null;

  const bucketA = [];
  const bucketB = [];
  solution.forEach((amount, index) => {
    const rounded = roundAmount(amount);
    if (rounded <= 0.001) return;
    const row = {
      id: crypto.randomUUID(),
      fertilizerId: variables[index].fertilizer.id,
      amount: rounded,
      unit: "kg"
    };
    if (variables[index].bucket === "A") {
      bucketA.push(row);
    } else {
      bucketB.push(row);
    }
  });

  applyPHTargetAdjustment(profile, bucketA, bucketB);

  if (!bucketA.length && !bucketB.length) return null;

  return evaluateReverseSuggestion(profile, bucketA, bucketB);
}

function contributionPerKg(variable, key, config) {
  const tankVolume = variable.bucket === "A" ? config.aTank : config.bTank;
  const dilution = variable.bucket === "A" ? config.aDilution : config.bDilution;
  let mmol = 0;
  variable.fertilizer.compounds.forEach((compound) => {
    if (key === "S" && isTraceSulfateFertilizer(variable.fertilizer.id)) return;
    if (key === "N" && ["NO3-N", "NH4-N", "N"].includes(compound.element)) {
      mmol += compoundPercentToMmol(compound, tankVolume, dilution);
    } else if (compound.element === key) {
      mmol += compoundPercentToMmol(compound, tankVolume, dilution);
    }
  });
  return mmol;
}

function isTraceSulfateFertilizer(fertilizerId) {
  return ["mnso4", "znso4", "cuso4"].includes(fertilizerId);
}

function isAcidFertilizer(fertilizer) {
  return ["hno3-40", "h3po4-85"].includes(fertilizer?.id);
}

function compoundPercentToMmol(compound, tankVolume, dilution) {
  if (!MOLAR_MASS[compound.element]) return 0;
  const gramsElement = 1000 * (compound.percent / 100);
  const mgPerLiter = gramsElement * 1000 / tankVolume / dilution;
  return mgPerLiter / MOLAR_MASS[compound.element];
}

function reverseTargetWeight(key) {
  if (["Fe", "Mn", "Zn", "B", "Cu", "Mo"].includes(key)) return 1.4;
  return 1;
}

function getFertilizerPrice(fertilizerId) {
  return TEST_FERTILIZER_PRICES[fertilizerId] ?? DEFAULT_FERTILIZER_PRICE;
}

function normalizedFertilizerPrice(fertilizerId) {
  return getFertilizerPrice(fertilizerId) / AVERAGE_TEST_FERTILIZER_PRICE;
}

function solveNonNegativeLeastSquares(matrix, target) {
  const m = matrix.length;
  const n = matrix[0]?.length ?? 0;
  if (!m || !n) return null;

  const x = Array(n).fill(0);
  const columnNorms = Array(n).fill(1);
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < m; i++) sum += matrix[i][j] * matrix[i][j];
    columnNorms[j] = Math.max(sum, 1e-12);
  }

  for (let iter = 0; iter < 900; iter++) {
    for (let j = 0; j < n; j++) {
      let residualDot = 0;
      for (let i = 0; i < m; i++) {
        let predicted = 0;
        for (let k = 0; k < n; k++) {
          if (k !== j) predicted += matrix[i][k] * x[k];
        }
        residualDot += matrix[i][j] * (target[i] - predicted);
      }
      x[j] = Math.max(0, residualDot / columnNorms[j]);
    }
  }
  return x;
}

function evaluateReverseSuggestion(profile, bucketA, bucketB) {
  const aResult = calculateBucket(bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
  const bResult = calculateBucket(bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));
  const totalMmol = buildTotalMmol(aResult, bResult);
  const acidProfile = buildTotalAcidProfile(aResult, bResult);
  const phValue = calculatePH(totalMmol, acidProfile);
  const phTarget = state.targets.pH;
  const phDeviation = typeof phTarget === "number" && Number.isFinite(phTarget) && phTarget > 0
    ? {
        key: "pH",
        actual: phValue,
        target: phTarget,
        ratio: (phValue - phTarget) / phTarget,
        delta: phValue - phTarget,
        cls: deviationClass((phValue - phTarget) / phTarget, "pH")
      }
    : null;
  const trackedKeys = ["N", "P", "K", "Ca", "Mg", "S", "Cl", "Fe", "Mn", "Zn", "B", "Cu", "Mo"];
  const deviations = trackedKeys
    .filter((key) => typeof state.targets[key] === "number" && state.targets[key] > 0)
    .map((key) => {
      const actual = totalMmol[key] ?? 0;
      const target = state.targets[key];
      const ratio = (actual - target) / target;
      return { key, actual, target, ratio, cls: deviationClass(ratio, key) };
    });

  const estimatedCost = calculateSuggestionCost(bucketA, bucketB);
  const costScore = profile.costPenalty ? Math.min(estimatedCost / 180, 3) : 0;
  const score = deviations.reduce((sum, item) => {
    if (LOW_CONTENT_KEYS.has(item.key)) {
      return sum + lowContentScore(item.key, item.actual, item.target);
    }
    const tolerance = 0.3;
    return sum + Math.min(Math.abs(item.ratio) / tolerance, 4);
  }, 0) +
    lowContentScoreForUntargeted(totalMmol) +
    (phDeviation ? Math.min(Math.abs(phDeviation.delta) / 0.3, 4) : 0) +
    (bucketA.length + bucketB.length) * 0.04 +
    costScore;

  return {
    id: profile.id,
    name: profile.name,
    note: profile.note,
    bucketA,
    bucketB,
    ec: calculateEC(totalMmol),
    pH: phValue,
    deviations,
    phDeviation,
    estimatedCost,
    score
  };
}

function calculateSuggestionCost(bucketA, bucketB) {
  return [...bucketA, ...bucketB].reduce((sum, row) => {
    return sum + (Number(row.amount) || 0) * getFertilizerPrice(row.fertilizerId);
  }, 0);
}

function lowContentScoreForUntargeted(totalMmol) {
  return Array.from(LOW_CONTENT_KEYS).reduce((sum, key) => {
    const hasTarget = typeof state.targets[key] === "number" && state.targets[key] > 0;
    return hasTarget ? sum : sum + lowContentScore(key, totalMmol[key] ?? 0, null);
  }, 0);
}

function lowContentScore(key, actual, target = null) {
  const benchmark = LOW_CONTENT_BENCHMARK[key] ?? 1;
  const weight = LOW_CONTENT_WEIGHT[key] ?? 0.5;
  const baseline = Math.min((actual || 0) / benchmark, 6) * weight;
  if (!(typeof target === "number" && Number.isFinite(target) && target > 0)) {
    return baseline;
  }
  const excessRatio = Math.max(0, ((actual || 0) - target) / target);
  return baseline + Math.min(excessRatio / 0.3, 5);
}

function applyPHTargetAdjustment(profile, bucketA, bucketB) {
  const targetPH = state.targets.pH;
  if (!(typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0)) return;

  const currentPH = estimateSuggestionPH(bucketA, bucketB);
  if (!Number.isFinite(currentPH) || currentPH <= targetPH + 0.03) return;

  const candidates = [
    { fertilizerId: "hno3-40", bucket: "A" },
    { fertilizerId: "h3po4-85", bucket: "B" }
  ].filter((candidate) => {
    const fertilizer = getFertilizer(candidate.fertilizerId);
    return state.inventory[candidate.fertilizerId] &&
      !profile.exclude.includes(candidate.fertilizerId) &&
      getCatalogByBucket(candidate.bucket).some((item) => item.id === fertilizer.id);
  });

  let bestAdjustment = null;

  for (const candidate of candidates) {
    const rows = candidate.bucket === "A" ? bucketA : bucketB;
    const existing = rows.find((row) => row.fertilizerId === candidate.fertilizerId);
    const baseAmount = existing?.unit === "kg" ? existing.amount : 0;
    let high = Math.max(0.05, baseAmount || 0.05);

    while (high <= 20) {
      const testRows = withAdjustedFertilizer(rows, candidate.fertilizerId, high);
      const testPH = candidate.bucket === "A"
        ? estimateSuggestionPH(testRows, bucketB)
        : estimateSuggestionPH(bucketA, testRows);
      if (Number.isFinite(testPH) && testPH <= targetPH) break;
      high *= 2;
    }

    if (high > 20) continue;

    let low = baseAmount;
    for (let i = 0; i < 28; i++) {
      const mid = (low + high) / 2;
      const testRows = withAdjustedFertilizer(rows, candidate.fertilizerId, mid);
      const testPH = candidate.bucket === "A"
        ? estimateSuggestionPH(testRows, bucketB)
        : estimateSuggestionPH(bucketA, testRows);
      if (testPH > targetPH) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const adjustedAmount = roundAmount(high);
    const adjustedRows = withAdjustedFertilizer(rows, candidate.fertilizerId, adjustedAmount);
    const adjustedBucketA = candidate.bucket === "A" ? adjustedRows : bucketA;
    const adjustedBucketB = candidate.bucket === "B" ? adjustedRows : bucketB;
    const stockPH = estimateBucketStockPH(candidate.bucket, adjustedRows);
    if (!Number.isFinite(stockPH) || stockPH < MIN_AUTO_ACID_STOCK_PH) continue;

    const finalPH = estimateSuggestionPH(adjustedBucketA, adjustedBucketB);
    const cost = Math.abs(finalPH - targetPH) + Math.max(0, MIN_AUTO_ACID_STOCK_PH + 0.4 - stockPH) * 0.5;
    if (!bestAdjustment || cost < bestAdjustment.cost) {
      bestAdjustment = { candidate, adjustedAmount, cost };
    }
  }

  if (!bestAdjustment) return;

  const rows = bestAdjustment.candidate.bucket === "A" ? bucketA : bucketB;
  const existing = rows.find((row) => row.fertilizerId === bestAdjustment.candidate.fertilizerId);
  if (existing) {
    existing.amount = bestAdjustment.adjustedAmount;
    existing.unit = "kg";
  } else {
    rows.push({
      id: crypto.randomUUID(),
      fertilizerId: bestAdjustment.candidate.fertilizerId,
      amount: bestAdjustment.adjustedAmount,
      unit: "kg"
    });
  }
}

function estimateBucketStockPH(bucket, rows) {
  const tankVolume = getNumericField(bucket === "A" ? "aTankVolume" : "bTankVolume");
  const dilution = getNumericField(bucket === "A" ? "aDilution" : "bDilution");
  const result = calculateBucket(rows, tankVolume, dilution);
  return calculateStockPH(buildStockMmol(result), result.acidPerLiter);
}

function withAdjustedFertilizer(rows, fertilizerId, amount) {
  const cloned = rows.map((row) => ({ ...row }));
  const existing = cloned.find((row) => row.fertilizerId === fertilizerId);
  if (existing) {
    existing.amount = amount;
    existing.unit = "kg";
  } else {
    cloned.push({ id: crypto.randomUUID(), fertilizerId, amount, unit: "kg" });
  }
  return cloned;
}

function estimateSuggestionPH(bucketA, bucketB) {
  const aResult = calculateBucket(bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
  const bResult = calculateBucket(bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));
  const totalMmol = buildTotalMmol(aResult, bResult);
  const acidProfile = buildTotalAcidProfile(aResult, bResult);
  return calculatePH(totalMmol, acidProfile);
}

function roundAmount(value) {
  if (value >= 10) return Number(value.toFixed(1));
  if (value >= 1) return Number(value.toFixed(2));
  return Number(value.toFixed(3));
}

function renderReverseSuggestions(suggestions) {
  if (!reverseSuggestionsEl) return;
  state.reverseSuggestions = suggestions;
  if (!suggestions.length) {
    reverseSuggestionsEl.classList.remove("is-visible");
    reverseSuggestionsEl.innerHTML = "";
    return;
  }

  reverseSuggestionsEl.classList.add("is-visible");
  reverseSuggestionsEl.innerHTML = `
    <div class="suggestion-head">
      <h3>配方建议</h3>
      <span class="muted">点击方案会写入 A/B 桶并计算，三套方案会保留用于比较</span>
    </div>
    <div class="suggestion-grid">
      ${suggestions.map((suggestion, index) => renderSuggestionCard(suggestion, index)).join("")}
    </div>
    ${renderSuggestionExportControls(suggestions)}
  `;

  reverseSuggestionsEl.querySelectorAll("[data-apply-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.applySuggestion);
      applyReverseSuggestion(suggestions[index], index);
    });
  });

  reverseSuggestionsEl.querySelector("[data-export-selected-formula]")?.addEventListener("click", exportSelectedFormula);
}

function renderSuggestionCard(suggestion, index) {
  const isSelected = state.selectedReverseIndex === index;
  const mainDeviations = suggestion.deviations
    .filter((item) => ["N", "P", "K", "Ca", "Mg", "S", "Cl"].includes(item.key))
    .slice(0, 7)
    .map((item) => `<span class="${item.cls}">${item.key} ${formatDeviation(item.ratio)}</span>`)
    .join(" · ");
  const phText = suggestion.phDeviation
    ? ` · <span class="${suggestion.phDeviation.cls}">pH ${suggestion.phDeviation.delta >= 0 ? "+" : ""}${suggestion.phDeviation.delta.toFixed(2)}</span>`
    : "";

  return `
    <div class="suggestion-card${isSelected ? " is-selected" : ""}">
      <h4>
        <span>${suggestion.name}</span>
        <span>${Math.max(0, Math.round(100 - suggestion.score * 8))}分</span>
      </h4>
      <div class="suggestion-meta">
        ${suggestion.note}<br>
        EC ${formatNumber(suggestion.ec)} uS/cm · pH ${suggestion.pH.toFixed(2)} · 估算原料 ¥${formatCurrency(suggestion.estimatedCost)}<br>
        ${mainDeviations || "目标偏差待计算"}${phText}
      </div>
      <div class="suggestion-buckets">
        ${renderSuggestionBucket("A", suggestion.bucketA)}
        ${renderSuggestionBucket("B", suggestion.bucketB)}
      </div>
      <button class="${isSelected ? "btn-ghost" : "btn-a"}" type="button" data-apply-suggestion="${index}">
        ${isSelected ? "已采用，重新计算" : "采用方案"}
      </button>
    </div>
  `;
}

function renderSuggestionExportControls(suggestions) {
  if (state.selectedReverseIndex == null || !suggestions[state.selectedReverseIndex]) return "";
  return `
    <div class="suggestion-export">
      <label>
        <span>AB肥配制量</span>
        <select id="formulaExportVolume">
          <option value="100">100 L</option>
          <option value="1000">1000 L</option>
        </select>
      </label>
      <label>
        <span>导出格式</span>
        <select id="formulaExportFormat">
          <option value="xlsx">Excel</option>
          <option value="pdf">PDF</option>
        </select>
      </label>
      <button class="btn-a" type="button" data-export-selected-formula>导出配方</button>
    </div>
  `;
}

function renderSuggestionBucket(bucketName, rows) {
  const items = rows.length
    ? rows.map((row) => `<li>${getFertilizer(row.fertilizerId).name} ${formatNumber(row.amount)} ${row.unit}</li>`).join("")
    : `<li>无需添加</li>`;
  return `
    <div class="suggestion-bucket">
      <b>${bucketName} 桶</b>
      <ul>${items}</ul>
    </div>
  `;
}

function applyReverseSuggestion(suggestion, index = null) {
  if (!suggestion) return;
  state.selectedReverseIndex = index;
  state.bucketA = suggestion.bucketA.length
    ? suggestion.bucketA.map((row) => ({ ...row, id: crypto.randomUUID() }))
    : [buildRow("A")];
  state.bucketB = suggestion.bucketB.length
    ? suggestion.bucketB.map((row) => ({ ...row, id: crypto.randomUUID() }))
    : [buildRow("B")];

  renderBucket("A");
  renderBucket("B");

  if (APP_MODE === 2) {
    showMode2CalculationResult(true);
    renderCurrentCalculation();
    renderReverseSuggestions(state.reverseSuggestions);
    _statusHoldUntil = Date.now() + 2500;
    const statusEl = document.querySelector("#calcStatus");
    if (statusEl) statusEl.textContent = `已采用「${suggestion.name}」，可继续点其他方案比较`;
    return;
  }

  clearTimeout(_recalcTimer);
  _doRecalculate();
  const statusEl = document.querySelector("#calcStatus");
  _statusHoldUntil = Date.now() + 2500;
  if (statusEl) statusEl.textContent = `已采用「${suggestion.name}」`;
}

function clearReverseSelection() {
  state.selectedReverseIndex = null;
}

function showMode2CalculationResult(visible) {
  ["kpiGrid", "tableWrap", "resultGrid"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  });
}

function clearMode2CalculationResult() {
  if (APP_MODE !== 2) return;
  showMode2CalculationResult(false);
  if (kpiGrid) kpiGrid.innerHTML = "";
  if (irrigationBody) irrigationBody.innerHTML = "";
  if (elementTotalsGrid) elementTotalsGrid.innerHTML = "";
  if (precipList) precipList.innerHTML = "";
}

// ═══════════════════════════════════════════════════════════════════
// 本地数据库 API（对接 backend/main.py，http://127.0.0.1:8765）
// ═══════════════════════════════════════════════════════════════════
const API_BASE = "http://127.0.0.1:8765";

async function apiFetch(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════
// 应用模式管理（0: 未选择 / 1: 计算浓度 / 2: 设计配方）
// ═══════════════════════════════════════════════════════════════════

function setMode(mode) {
  APP_MODE = mode;

  document.querySelector("#modeBtn1")?.classList.toggle("is-active", mode === 1);
  document.querySelector("#modeBtn2")?.classList.toggle("is-active", mode === 2);

  const anyMode = mode > 0;
  const isMode1 = mode === 1;
  const isMode2 = mode === 2;

  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  };

  show("waterSection",        anyMode);
  show("importPanel",         isMode1);
  show("bucketGrid",          isMode1);
  show("mode2TargetSection",  isMode2);
  show("resultsSection",      anyMode);

  show("resultsModeBar",   isMode1);
  show("targetDetails",    isMode1);
  show("inventoryDetails", isMode1);
  show("kpiGrid",          isMode1);
  show("tableWrap",        isMode1);
  show("resultGrid",       isMode1);

  const heroText = document.querySelector("#heroText");
  if (heroText) {
    if (isMode1) {
      heroText.innerHTML = '上传水质检测报告，导入或手动配置 <span class="a-text">A 桶</span> 与 <span class="b-text">B 桶</span> 施肥配方。实时计算灌溉液元素浓度，可选填目标值查看偏差。';
    } else if (isMode2) {
      heroText.innerHTML = '上传水质检测报告，设定各元素目标浓度，系统自动推荐 3 套施肥配方供选择。采用任一方案后可直接比较最终工作液浓度，再导出选中的配方。';
    } else {
      heroText.textContent = "请选择左侧功能模式开始使用。";
    }
  }

  const title    = document.getElementById("resultsPanelTitle");
  const subtitle = document.getElementById("resultsPanelSubtitle");
  const badge    = document.getElementById("resultsBadge");
  const kicker   = document.getElementById("resultsKicker");
  if (isMode2) {
    if (title)    title.textContent    = "配方方案建议";
    if (subtitle) subtitle.textContent = "根据目标浓度与原水背景，自动推荐最优施肥方案";
    if (badge)    badge.textContent    = "03";
    if (kicker)   kicker.textContent   = "Step 03";
  } else {
    if (title)    title.textContent    = "理论灌溉液结果";
    if (subtitle) subtitle.textContent = "原水背景 + A/B 桶稀释贡献 = 进入根区的理论浓度";
    if (badge)    badge.textContent    = "04";
    if (kicker)   kicker.textContent   = "Step 04";
  }

  const sugEl = document.getElementById("reverseSuggestions");
  if (sugEl) { sugEl.innerHTML = ""; sugEl.classList.remove("is-visible"); }
  if (isMode2) renderTargetTable();

  if (anyMode) recalculate();
}

function bindModeEvents() {
  document.querySelector("#modeBtn1")?.addEventListener("click", () => setMode(1));
  document.querySelector("#modeBtn2")?.addEventListener("click", () => setMode(2));

  document.querySelector("#targetFileM2")?.addEventListener("change", handleTargetUpload);

  document.querySelector("#targetPreset2")?.addEventListener("change", (e) => {
    applyTargetPreset(e.target.value);
    const p1 = document.querySelector("#targetPreset");
    if (p1) p1.value = e.target.value;
  });

  document.querySelector("#clearTargets2")?.addEventListener("click", () => {
    clearReverseSelection();
    clearTargets();
    ["#targetPreset", "#targetPreset2"].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.value = "";
    });
    renderTargetTable();
    recalculate();
  });
}
