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
  { key: "CO3", label: "碳酸根 CO3--", unit: "mg/L" },
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
  CO3: 60.0089,
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
const TRACE_FERTILIZER_KEYS = new Set(["Fe", "Mn", "Zn", "B", "Cu", "Mo"]);
const MAIN_ELEMENT_KEYS = new Set(["NO3-N", "NH4-N", "N", "P", "K", "Ca", "Mg", "S"]);
const DISPLAY_ELEMENT_GROUPS = [
  { title: "大中量元素", keys: MAIN_ELEMENT_KEYS },
  { title: "微量元素", keys: TRACE_FERTILIZER_KEYS },
  { title: "其他指标", keys: null }
];
const UNDERSHOOT_ALLOWED_KEYS = new Set(["S", "Cl", "Na"]);
const NH4_SHARE_LIMITS = {
  tomato: { warn: 0.10, bad: 0.15 },
  default: { warn: 0.15, bad: 0.20 }
};
const DEFAULT_TARGET_PH = 6;
const PH_TARGET_SAFE_DELTA = 0.3;
const PH_TARGET_WARN_DELTA = 0.5;
const PH_TARGET_REJECT_DELTA = 0.8;
const MIN_AUTO_ACID_STOCK_PH = 1.0;
const WORKING_SOLUTION_CO2_RELEASE_FACTOR = 0.7;
const TARGET_RESIDUAL_HCO3_MMOL = 0.75;
const ACID_PREFEED_MIN_MMOL = 0.02;
const NITRIC_ACID_REGULATORY_PENALTY_PER_KG = 0.35;
const P_TO_P2O5_FACTOR = (2 * MOLAR_MASS.P + 5 * 15.999) / (2 * MOLAR_MASS.P);
const K_TO_K2O_FACTOR = (2 * MOLAR_MASS.K + 15.999) / (2 * MOLAR_MASS.K);

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
  const neutralN = totalMmol["neutral-N"] ?? 0;
  const unaccountedN = Math.max(0, totalN - no3 - nh4 - neutralN);
  if (unaccountedN > 0) {
    ec += unaccountedN * EC_COEFFICIENTS["NO3-N"];
  }
  return ec * EC_ACTIVITY_FACTOR;
}

function calculatePH(totalMmol, acidProfile = null) {
  try {
    const rawPH = calculatePHImpl(totalMmol, acidProfile);
    return applyPHCalibration(rawPH);
  } catch (error) {
    console.warn("pH estimate fell back to neutral", error);
    return 7.0;
  }
}

function applyPHCalibration(rawPH) {
  const calibration = state?.phCalibration;
  if (!calibration?.enabled || !Number.isFinite(rawPH)) return rawPH;

  const minPH = Number(calibration.min_predicted_ph);
  const maxPH = Number(calibration.max_predicted_ph);
  if (Number.isFinite(minPH) && Number.isFinite(maxPH)) {
    const margin = 0.5;
    if (rawPH < minPH - margin || rawPH > maxPH + margin) return rawPH;
  }

  const correction = (Number(calibration.intercept) || 0) + (Number(calibration.slope) || 0) * rawPH;
  const limit = Number(calibration.max_correction) || 0.25;
  return clampPH(rawPH + clamp(correction, -limit, limit), 0.3, 9.5);
}

function calculatePHImpl(totalMmol, acidProfile = null) {
  const initialAlkalinity = carbonateAlkalinityFromMmol(totalMmol);
  const waterPH = (typeof state.water?.pH === "number" && state.water.pH > 0)
    ? state.water.pH : 7.5;

  if (initialAlkalinity <= 0) {
    const acid = effectiveAcidMmol(acidProfile);
    const phosphateBuffer = (acidProfile?.h2po4 ?? 0) + (acidProfile?.h3po4 ?? 0);
    if (phosphateBuffer > 0) return Math.max(2.5, Math.min(7.2, 6.2 - acid / phosphateBuffer));
    return Math.max(3.0, Math.min(8.5, waterPH - acid * 0.8));
  }

  const initialDicMmol = carbonateDicFromMmol(totalMmol, waterPH);

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

function carbonateAlkalinityFromMmol(totalMmol, pH = null) {
  const hco3 = Number(totalMmol?.HCO3) || 0;
  const co3 = Number(totalMmol?.CO3) || 0;
  const waterTerm = Number.isFinite(pH)
    ? (WATER_KW / Math.pow(10, -pH) - Math.pow(10, -pH)) * 1000
    : 0;
  return Math.max(0, hco3 + 2 * co3 + waterTerm);
}

function carbonateDicFromMmol(totalMmol, pH) {
  const hco3 = Number(totalMmol?.HCO3) || 0;
  const co3 = Number(totalMmol?.CO3) || 0;
  const fractions = carbonateFractions(pH);
  const knownSpecies = hco3 + co3;
  const knownFraction = fractions.hco3 + fractions.co3;
  if (knownSpecies > 0 && knownFraction > 1e-9) return knownSpecies / knownFraction;
  return carbonateAlkalinityFromMmol(totalMmol, pH);
}

function phosphateAcidEquivalents(pH) {
  const phosphate = phosphateFractions(pH);
  return {
    h3po4: 1 + phosphate.hpo4 + 2 * phosphate.po4,
    h2po4: phosphate.hpo4 + 2 * phosphate.po4
  };
}

function calculateStockPH(totalMmol, acidProfile = null) {
  const initialAlkalinity = carbonateAlkalinityFromMmol(totalMmol);
  const strongAcid = acidProfile?.strong ?? 0;
  const h3po4 = acidProfile?.h3po4 ?? 0;
  const h2po4 = acidProfile?.h2po4 ?? 0;
  const waterPH = (typeof state.water?.pH === "number" && state.water.pH > 0)
    ? state.water.pH : 7.5;
  const strongExcess = Math.max(0, strongAcid - initialAlkalinity);
  if (strongExcess > 0.001) {
    const phosphoricAcid = Math.max(0, h3po4 + h2po4);
    return estimateStrongAcidStockPH(strongExcess, phosphoricAcid);
  }

  const remainingAlkalinity = Math.max(0, initialAlkalinity - strongAcid);
  const h3po4Excess = Math.max(0, h3po4 - remainingAlkalinity);
  if (h3po4Excess > 0.001) {
    return estimateStrongAcidStockPH(0, h3po4Excess);
  }

  if (initialAlkalinity > 0) {
    const dicMmol = carbonateDicFromMmol(totalMmol, waterPH);

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

  return calculatePHImpl(totalMmol, acidProfile);
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
    salt: "CaHPO4·2H2O",
    counterKey: "P",
    counterLabel: "HPO4",
    counterSpecies: "hpo4",
    ksp: 2.56e-7,
    equation: "[Ca2+] x [HPO4^2-]",
    ionProduct: "1:1",
    unit: "(mol/L)^2",
    note: "25°C CaHPO4·2H2O (DCPD)"
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
    bucket: "AB",
    notes: "Mg(NO3)2·6H2O · 11-0-0+15.7MgO",
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
    id: "edta-fe-13",
    name: "EDTA-铁（13%Fe）",
    bucket: "A",
    notes: "EDTA-Fe 13% · pH 4.0-6.5",
    compounds: [{ label: "Fe", percent: 13, element: "Fe" }]
  },
  {
    id: "dtpa-fe-11",
    name: "DTPA-铁（11%Fe）",
    bucket: "A",
    notes: "DTPA-Fe 11% · pH 4.0-7.5",
    compounds: [{ label: "Fe", percent: 11, element: "Fe" }]
  },
  {
    id: "eddha-fe-6",
    name: "EDDHA-铁（6%Fe）",
    bucket: "A",
    notes: "EDDHA-Fe 6% · pH 4.0-9.0",
    compounds: [{ label: "Fe", percent: 6, element: "Fe" }]
  },
  {
    id: "edta-mn-13",
    name: "EDTA-锰（13%Mn）",
    bucket: "AB",
    notes: "EDTA-Mn 13%",
    compounds: [{ label: "Mn", percent: 13, element: "Mn" }]
  },
  {
    id: "edta-zn-15",
    name: "EDTA-锌（15%Zn）",
    bucket: "AB",
    notes: "EDTA-Zn 15%",
    compounds: [{ label: "Zn", percent: 15, element: "Zn" }]
  },
  {
    id: "edta-cu-15",
    name: "EDTA-铜（15%Cu）",
    bucket: "AB",
    notes: "EDTA-Cu 15%",
    compounds: [{ label: "Cu", percent: 15, element: "Cu" }]
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
    id: "na-octaborate-4h2o",
    name: "四水八硼（20.5%B）",
    bucket: "AB",
    notes: "Na2B8O13·4H2O",
    compounds: [
      { label: "B", percent: 20.5, element: "B" },
      { label: "Na", percent: 10.9, element: "Na" }
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
  },
  {
    id: "urea",
    name: "尿素（46%N）",
    bucket: "AB",
    nonIonicNitrogen: true,
    notes: "CO(NH2)2 · 46% 酰胺态氮",
    compounds: [{ label: "N", percent: 46, element: "N" }]
  },
  {
    id: "ammonium-sulfate",
    name: "硫酸铵",
    bucket: "B",
    notes: "(NH4)2SO4 · 21.2% NH4-N · 24.3% S · 生理酸性肥料",
    compounds: [
      { label: "NH4-N", percent: 21.2, element: "NH4-N" },
      { label: "S", percent: 24.3, element: "S" }
    ]
  },
  {
    id: "urea-phosphate",
    name: "磷酸脲",
    bucket: "B",
    nonIonicNitrogen: true,
    notes: "CO(NH2)2·H3PO4 · 17.7% N · 44.9% P2O5 · 酸性肥料",
    compounds: [
      { label: "N", percent: 17.7, element: "N" },
      { label: "P", percent: 19.6, element: "P" }
    ],
    acidContrib: [{ key: "h3po4", purity: 1, molarMass: 158.05 }]
  }
];

// 暂用行情价，单位：元/kg。后续若接入采购报价，只需要替换这张表。
const MARKET_PRICE_BY_FERTILIZER = {
  "ca-no3-4h2o": 3.8,
  "mg-no3-6h2o": 5.6,
  can: 2.9,
  cacl2: 1.7,
  kcl: 2.4,
  kno3: 6.8,
  "edta-fe-13": 34,
  "dtpa-fe-11": 48,
  "eddha-fe-6": 82,
  "edta-mn-13": 42,
  "edta-zn-15": 38,
  "edta-cu-15": 48,
  "hno3-40": 2.2,
  kh2po4: 8.5,
  "mgso4-7h2o": 1.9,
  k2so4: 4.2,
  mnso4: 12,
  borax: 5.1,
  "na-octaborate-4h2o": 9.2,
  znso4: 9.4,
  cuso4: 18,
  na2moo4: 96,
  "h3po4-85": 7.2,
  urea: 2.6,
  "ammonium-sulfate": 1.5,
  "urea-phosphate": 7.8
};

const DEFAULT_FERTILIZER_PRICE = 10;
const WATER_FERTILIZER_IDS = new Set(
  FERTILIZER_CATALOG.filter((item) => !item.soilOnly).map((item) => item.id)
);
const WATER_FERTILIZER_PRICES = Object.entries(MARKET_PRICE_BY_FERTILIZER)
  .filter(([id]) => WATER_FERTILIZER_IDS.has(id))
  .map(([, price]) => price);
const AVERAGE_FERTILIZER_PRICE =
  WATER_FERTILIZER_PRICES.reduce((sum, price) => sum + price, 0) /
  WATER_FERTILIZER_PRICES.length;
const CHELATED_TRACE_PREFERRED_IDS = {
  Mn: "edta-mn-13",
  Zn: "edta-zn-15",
  Cu: "edta-cu-15"
};
const TRACE_SULFATE_FALLBACK_IDS = {
  Mn: "mnso4",
  Zn: "znso4",
  Cu: "cuso4"
};
const PREFERRED_BORON_FERTILIZER_ID = "na-octaborate-4h2o";
const BORAX_FALLBACK_ID = "borax";
const IRON_CHELATE_OPTIONS = [
  { id: "edta-fe-13", minPH: 4.0, maxPH: 6.5, fallbackOrder: 1 },
  { id: "dtpa-fe-11", minPH: 4.0, maxPH: 7.5, fallbackOrder: 2 },
  { id: "eddha-fe-6", minPH: 4.0, maxPH: 9.0, fallbackOrder: 3 }
];

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
  { key: "CO3", matchers: [/(^|[^h])co3/i, /碳酸根/] },
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
    cropType: "tomato",
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
let recalcTimer = null;
let statusHoldUntil = 0;
const state = {
  water: Object.fromEntries(ELEMENT_META.map((item) => [item.key, 0])),
  targets: Object.fromEntries(ELEMENT_META.map((item) => [item.key, null])),
  inventory: Object.fromEntries(FERTILIZER_CATALOG.map((item) => [item.id, true])),
  reverseSuggestions: [],
  selectedReverseIndex: null,
  soilSuggestions: [],
  selectedSoilIndex: null,
  soilAdjustedRows: [],
  cropType: null,
  isRoWater: false,
  lastWaterSource: "",
  lastFormulaSource: "",
  phCalibration: null,
  reversePreferences: {
    ironStrategy: "adaptive",
    traceChelate: "prefer",
    costPriority: "balanced",
    nitricAcid: "avoid",
    phosphoricAcid: "allow"
  },
  bucketA: [],
  bucketB: []
};
let latestCalculation = null;

const waterGrid = document.querySelector("#waterGrid");
const bucketAList = document.querySelector("#bucketAList");
const bucketBList = document.querySelector("#bucketBList");
const summaryA = document.querySelector("#summaryA");
const summaryB = document.querySelector("#summaryB");
const bucketATotalWeight = document.querySelector("#bucketATotalWeight");
const bucketBTotalWeight = document.querySelector("#bucketBTotalWeight");
const elementTotalsGrid = document.querySelector("#elementTotalsGrid");
const targetGrid = document.querySelector("#targetGrid");
const inventoryGrid = document.querySelector("#inventoryGrid");
const selectAllInventoryBtn = document.querySelector("#selectAllInventory");
const clearAllInventoryBtn = document.querySelector("#clearAllInventory");
const irrigationBody = document.querySelector("#irrigationBody");
const precipList = document.querySelector("#precipList");
const reverseSuggestionsEl = document.querySelector("#reverseSuggestions");
const reportStatus = document.querySelector("#reportStatus");
const reportFile = document.querySelector("#reportFile");
const roWaterBtn = document.querySelector("#roWater");
const targetFile = document.querySelector("#targetFile");
const formulaFile = document.querySelector("#formulaFile");
const targetImportStatus = document.querySelector("#targetImportStatus");
const formulaImportStatus = document.querySelector("#formulaImportStatus");
const calcStatus = document.querySelector("#calcStatus");
const targetPreset = document.querySelector("#targetPreset");
const targetPreset2 = document.querySelector("#targetPreset2");
const measuredEcInput = document.querySelector("#measuredEc");
const measuredPhInput = document.querySelector("#measuredPh");
const titrationNotesInput = document.querySelector("#titrationNotes");
const saveTitrationBtn = document.querySelector("#saveTitration");
const calibrationStatus = document.querySelector("#calibrationStatus");
const calibrationReadout = document.querySelector("#calibrationReadout");
const preferenceInputs = {
  ironStrategy: document.querySelector("#prefIronStrategy"),
  traceChelate: document.querySelector("#prefTraceChelate"),
  costPriority: document.querySelector("#prefCostPriority"),
  nitricAcid: document.querySelector("#prefNitricAcid"),
  phosphoricAcid: document.querySelector("#prefPhosphoricAcid")
};

init();

function init() {
  renderWaterTable();
  renderTargetTable();
  renderInventoryGrid();
  renderTargetPresets();
  renderBucket("A");
  renderBucket("B");
  bindStaticEvents();
  bindCollapsibleModules();
  bindModeEvents();
  setMode(0);
  setTimeout(loadPHCalibration, 0);
}

function setStatus(message, holdMs = 0) {
  if (!calcStatus) return;
  calcStatus.textContent = message;
  statusHoldUntil = holdMs ? Date.now() + holdMs : 0;
}

function resetWaterValues() {
  Object.keys(state.water).forEach((key) => {
    state.water[key] = 0;
  });
}

function resetTargetPresetSelects() {
  [targetPreset, targetPreset2].forEach((select) => {
    if (select) select.value = "";
  });
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
  roWaterBtn?.addEventListener("click", applyRoWater);
  targetFile?.addEventListener("change", handleTargetUpload);
  formulaFile?.addEventListener("change", handleFormulaUpload);
  saveTitrationBtn?.addEventListener("click", saveCurrentTitration);
  bindReversePreferenceInputs();

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

  targetPreset?.addEventListener("change", (event) => {
    applyTargetPreset(event.target.value);
  });

  document.querySelector("#clearTargets")?.addEventListener("click", () => {
    clearReverseSelection();
    clearTargets();
    if (targetPreset) targetPreset.value = "";
    renderTargetTable();
    recalculate();
  });

  document.querySelector("#exportResults")?.addEventListener("click", exportResults);
  document.querySelector("#exportSelectedFormula")?.addEventListener("click", exportSelectedFormula);
}

function bindReversePreferenceInputs() {
  Object.entries(preferenceInputs).forEach(([key, input]) => {
    if (!input) return;
    state.reversePreferences[key] = input.value || state.reversePreferences[key];
    input.addEventListener("change", (event) => {
      state.reversePreferences[key] = event.target.value;
      clearReverseSelection();
      if (APP_MODE === 2) calculateReverse();
    });
  });
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
  return FERTILIZER_CATALOG.filter((item) =>
    !item.soilOnly && (item.bucket === bucket || item.bucket === "AB")
  );
}

function renderWaterTable() {
  const visibleItems = state.isRoWater
    ? ELEMENT_META.filter((item) => item.key !== "pH")
    : ELEMENT_META;

  roWaterBtn?.classList.toggle("is-active", state.isRoWater);

  waterGrid.innerHTML = renderGroupedElementCells(visibleItems, (item) => `
    <label class="water-cell">
      <span class="el">${item.key}</span>
      <input data-water-key="${item.key}" type="number" step="0.1"
        value="${state.isRoWater ? "0" : toInputValue(state.water[item.key])}" />
      <span class="unit">${item.unit || ""}</span>
    </label>
  `);

  waterGrid.querySelectorAll("[data-water-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const key = event.target.dataset.waterKey;
      clearReverseSelection();
      state.water[key] = toNumber(event.target.value);
      const shouldRestorePh = state.isRoWater;
      if (shouldRestorePh) state.isRoWater = false;
      if (key === "NO3-N" || key === "NH4-N") {
        syncWaterTotalN();
        renderWaterTable();
      } else if (shouldRestorePh) {
        renderWaterTable();
      }
      recalculate();
    });
  });
}

function applyRoWater() {
  resetWaterValues();
  state.isRoWater = true;
  clearReverseSelection();
  renderWaterTable();
  recalculate();
  reportStatus.textContent = "已选择 RO水灌溉 · 水中各元素浓度按 0 计算";
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
            <input data-role="amount" type="number" min="0" step="0.1" value="${toInputValue(row.amount)}" />
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
      const index = targetRows.findIndex((item) => item.id === row.id);
      targetRows.splice(index, 1);
      renderBucket(bucket);
      recalculate();
    });
  });
}

function renderTargetTable() {
  const grids = [
    targetGrid,
    document.getElementById("mode2TargetGrid"),
    document.getElementById("importTargetGrid")
  ].filter(Boolean);
  if (!grids.length) return;
  const html = renderGroupedElementCells(ELEMENT_META, (item) => `
    <label class="water-cell">
      <span class="el">${item.key}</span>
      <input data-target-key="${item.key}" type="number" step="0.1"
        value="${toTargetInputValue(item.key, state.targets[item.key])}" />
      <span class="unit">${getTargetInputUnit(item.key)}</span>
    </label>
  `);
  grids.forEach((grid) => {
    grid.innerHTML = html;
    grid.querySelectorAll("[data-target-key]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const key = event.target.dataset.targetKey;
        clearReverseSelection();
        state.targets[key] = fromTargetInputValue(key, event.target.value);
        syncTargetTotalN(key);
        document.querySelectorAll(`[data-target-key="${key}"]`).forEach((el) => {
          if (el !== event.target) el.value = toTargetInputValue(key, state.targets[key]);
        });
        recalculate();
      });
    });
  });
}

function renderInventoryGrid() {
  if (!inventoryGrid) return;
  inventoryGrid.innerHTML = FERTILIZER_CATALOG.filter((item) => !item.soilOnly).map((item) => `
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
  state.cropType = preset.cropType || null;
  Object.entries(preset.values).forEach(([key, value]) => {
    state.targets[key] = value;
  });
  renderTargetTable();
  recalculate();
}

function clearTargets() {
  Object.keys(state.targets).forEach((key) => {
    state.targets[key] = null;
  });
  state.cropType = null;
}

function applyDefaultTargetPH() {
  if (!(typeof state.targets.pH === "number" && Number.isFinite(state.targets.pH) && state.targets.pH > 0)) {
    state.targets.pH = DEFAULT_TARGET_PH;
  }
}

function recalculate() {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(recalculateNow, 150);
}

function recalculateNow() {
  if (APP_MODE === 3) {
    generateSoilFormulas();
    return;
  }
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
  try {
    const bucketAResult = calculateBucket(state.bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
    const bucketBResult = calculateBucket(state.bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));
    const totalMmol = buildTotalMmol(bucketAResult, bucketBResult);
    const acidProfile = buildTotalAcidProfile(bucketAResult, bucketBResult);
    latestCalculation = {
      bucketAResult,
      bucketBResult,
      totalMmol,
      acidProfile,
      predictedEc: calculateEC(totalMmol),
      predictedPh: calculatePH(totalMmol, acidProfile)
    };

    renderSummary(summaryA, bucketAResult, "A");
    renderSummary(summaryB, bucketBResult, "B");
    renderBucketTotalWeight(bucketATotalWeight, bucketAResult);
    renderBucketTotalWeight(bucketBTotalWeight, bucketBResult);
    renderElementTotals(bucketAResult, bucketBResult);
    renderIrrigation(bucketAResult, bucketBResult);
    renderPrecipitation(bucketAResult, bucketBResult);
    renderCalibrationReadout();

    if (calcStatus && Date.now() > statusHoldUntil) {
      const hasData = Object.values(bucketAResult.totals).some(v => v > 0) || Object.values(bucketBResult.totals).some(v => v > 0);
      calcStatus.textContent = hasData ? "计算完成" : "";
    }
  } catch (err) {
    console.error("Calculation failed", err);
    setStatus(`计算出错：${err.message}`);
  }
}

function calculateBucket(rows, tankVolume, dilutionFactor) {
  const totals = emptyElementMap();
  const acidTotals = emptyAcidProfile();
  let totalFertilizerGrams = 0;
  let neutralNitrogenGrams = 0;

  rows.forEach((row) => {
    const fertilizer = getFertilizer(row.fertilizerId);
    const amountInGrams = row.unit === "kg" ? row.amount * 1000 : row.amount;
    totalFertilizerGrams += amountInGrams;
    fertilizer.compounds.forEach((compound) => {
      const mass = amountInGrams * (compound.percent / 100);
      totals[compound.element] += mass;
      if (fertilizer.nonIonicNitrogen && compound.element === "N") {
        neutralNitrogenGrams += mass;
      }
    });
    fertilizer.acidContrib?.forEach((acid) => {
      acidTotals[acid.key] += amountInGrams * acid.purity / acid.molarMass;
    });
  });

  totals.N = totals.N + totals["NO3-N"] + totals["NH4-N"];

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

  const neutralNitrogenPerLiterMmol = tankVolume
    ? neutralNitrogenGrams * 1000 / tankVolume / MOLAR_MASS.N
    : 0;
  const neutralNitrogenIrrigationMmol = dilutionFactor
    ? neutralNitrogenPerLiterMmol / dilutionFactor
    : 0;

  return {
    totals, perLiter, irrigation, perLiterMmol, irrigationMmol,
    acidTotals, acidPerLiter, acidIrrigation, totalFertilizerGrams,
    neutralNitrogenPerLiterMmol, neutralNitrogenIrrigationMmol
  };
}

function renderSummary(target, bucketResult, bucketName) {
  const chipsEl = target.querySelector(".chips");
  const hasFertilizer = (bucketResult.totalFertilizerGrams ?? 0) > 0;
  const stockMmol = buildStockMmol(bucketResult);
  const stockEcMs = calculateEC(stockMmol) / 1000;
  const stockPh = calculateStockPH(stockMmol, bucketResult.acidPerLiter);
  const html = `
    <div class="stock-readouts">
      <div class="stock-readout">
        <span class="name">EC</span>
        <span class="value">${formatNumber(stockEcMs)}</span>
        <span class="unit">mS/cm</span>
      </div>
      <div class="stock-readout">
        <span class="name">pH</span>
        <span class="value">${stockPh.toFixed(2)}</span>
      </div>
    </div>
  `;

  if (hasFertilizer) {
    target.style.display = "";
    if (chipsEl) chipsEl.innerHTML = html;
  } else {
    target.style.display = "none";
  }
}

function renderBucketTotalWeight(target, bucketResult) {
  if (!target) return;
  target.textContent = formatWeight(bucketResult.totalFertilizerGrams ?? 0);
}

function formatWeight(grams) {
  if (!Number.isFinite(grams) || grams <= 0) return "0 g";
  if (grams >= 1000) return `${formatNumber(grams / 1000)} kg`;
  return `${formatNumber(grams)} g`;
}

function renderElementTotals(bucketAResult, bucketBResult) {
  if (!elementTotalsGrid) return;
  const keys = ["N", "P", "K", "Ca", "Mg"];
  const buckets = [
    { name: "A 桶", cls: "a", result: bucketAResult },
    { name: "B 桶", cls: "b", result: bucketBResult }
  ];
  const hasConfiguredFertilizer = buckets.some((bucket) =>
    keys.some((key) => (bucket.result.perLiterMmol[key] ?? 0) > 0)
  );

  if (!hasConfiguredFertilizer) {
    elementTotalsGrid.innerHTML = `<div style="color:var(--muted);font-size:13px;grid-column:1/-1">尚未配置肥料</div>`;
    return;
  }

  const grade = calculateNpkOxideGrade(bucketAResult, bucketBResult);
  const bucketHtml = buckets.map((bucket) => `
    <div class="bucket-mol-card ${bucket.cls}">
      <h4>${bucket.name}</h4>
      ${keys.map((key) => `
        <div class="grams-row">
          <span><b>${key}</b></span>
          <span class="vals">${formatNumber(molPer100LStock(bucket.result, key))} mol</span>
        </div>
      `).join("")}
    </div>
  `).join("");

  const gradeHtml = grade
    ? `
      <div class="bucket-mol-card npk-grade">
        <h4>A+B 合计 N-P2O5-K2O</h4>
        <div class="npk-grade-value">${formatNpkGradeValue(grade)}</div>
        <div class="grams-row">
          <span><b>N</b></span>
          <span class="vals">${formatNumber(grade.n)} kg / 100kg肥</span>
        </div>
        <div class="grams-row">
          <span><b>P2O5</b></span>
          <span class="vals">${formatNumber(grade.p2o5)} kg / 100kg肥</span>
        </div>
        <div class="grams-row">
          <span><b>K2O</b></span>
          <span class="vals">${formatNumber(grade.k2o)} kg / 100kg肥</span>
        </div>
      </div>
    `
    : "";

  elementTotalsGrid.innerHTML = bucketHtml + gradeHtml;
}

function molPer100LStock(bucketResult, key) {
  return (bucketResult.perLiterMmol[key] ?? 0) * 0.1;
}

function calculateNpkOxideGrade(bucketAResult, bucketBResult) {
  const totalFertilizerGrams =
    (bucketAResult.totalFertilizerGrams ?? 0) +
    (bucketBResult.totalFertilizerGrams ?? 0);
  if (!Number.isFinite(totalFertilizerGrams) || totalFertilizerGrams <= 0) {
    return null;
  }

  const combinedTotals = {
    N: (bucketAResult.totals.N ?? 0) + (bucketBResult.totals.N ?? 0),
    P: (bucketAResult.totals.P ?? 0) + (bucketBResult.totals.P ?? 0),
    K: (bucketAResult.totals.K ?? 0) + (bucketBResult.totals.K ?? 0)
  };

  return {
    n: combinedTotals.N / totalFertilizerGrams * 100,
    p2o5: combinedTotals.P * P_TO_P2O5_FACTOR / totalFertilizerGrams * 100,
    k2o: combinedTotals.K * K_TO_K2O_FACTOR / totalFertilizerGrams * 100
  };
}

function formatNpkGradeValue(grade) {
  return [grade.n, grade.p2o5, grade.k2o].map((value) => formatNumber(value)).join("-");
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
  totalMmol["neutral-N"] =
    (bucketAResult.neutralNitrogenIrrigationMmol ?? 0) +
    (bucketBResult.neutralNitrogenIrrigationMmol ?? 0);
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

function formatAcidContribution(profile, pH) {
  const acid = effectiveAcidMmol(profile, Number.isFinite(pH) ? pH : 5.8);
  return acid > 0 ? `酸 ${formatNumber(acid)}` : "-";
}

function renderIrrigation(bucketAResult, bucketBResult) {
  try {
    if (!irrigationBody) {
      console.warn("Irrigation result table is missing");
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
      const unit = getConcentrationDisplayUnit(item.key);
      const targetValue = state.targets[item.key];
      const hasTarget = typeof targetValue === "number" && Number.isFinite(targetValue);
      const deviationRatio = hasTarget && targetValue !== 0 ? (total - targetValue) / targetValue : null;
      const devCls = deviationClass(deviationRatio, item.key);

      return `
        <tr>
          <td>${item.label}</td>
          <td>${unit}</td>
          <td>${formatNumber(toConcentrationDisplayValue(item.key, waterValue))}</td>
          <td>${formatNumber(toConcentrationDisplayValue(item.key, aValue))}</td>
          <td>${formatNumber(toConcentrationDisplayValue(item.key, bValue))}</td>
          <td class="${devCls}">${formatNumber(toConcentrationDisplayValue(item.key, total))}</td>
          <td>${hasTarget ? formatNumber(toConcentrationDisplayValue(item.key, targetValue)) : "-"}</td>
          <td class="${devCls}">${formatDeviation(deviationRatio)}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Irrigation table failed to render", err);
    irrigationBody.innerHTML = `<tr><td colspan="8" style="color:red">结果表渲染失败：${escapeHtml(err.message)}</td></tr>`;
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
      counterMol = mmolToMol(stockMmol.P ?? 0) * phosphate[system.counterSpecies ?? "po4"];
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
  stockMmol["neutral-N"] = bucketResult.neutralNitrogenPerLiterMmol ?? 0;
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

  if (!(await ensureBackendReadyForPdf(file, reportStatus))) {
    event.target.value = "";
    return;
  }

  reportStatus.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await parseWaterReportFile(file, buffer);
    resetWaterValues();
    Object.assign(state.water, parsed.values);
    state.isRoWater = false;
    state.lastWaterSource = parsed.sheetName || file.name;
    clearReverseSelection();
    syncWaterTotalN();
    renderWaterTable();
    recalculate();
    setModuleCollapsed(document.getElementById("waterSection"), false);
    reportStatus.textContent = `已导入 ${file.name}，识别到 ${parsed.hitCount} 个指标，来源：${parsed.sheetName}`;
  } catch (error) {
    console.warn("Water report import failed", error);
    const message = error?.message === "Not Found"
      ? "后端接口不存在，请停止旧后端后重新运行 backend/start.sh"
      : (error?.message || "请确认文件可正常打开；PDF/图片需启动本地后端并安装 OCR 依赖");
    reportStatus.textContent = `水质报告解析失败：${message}`;
  } finally {
    event.target.value = "";
  }
}

async function parseWaterReportFile(file, buffer) {
  if (isSpreadsheetFile(file.name)) {
    const workbook = XLSX.read(buffer, { type: "array" });
    return parseWorkbook(workbook);
  }

  const parsed = await apiFetch("/api/import/water", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name)
    },
    body: buffer
  });

  return {
    values: parsed.values || {},
    hitCount: Object.keys(parsed.values || {}).length,
    sheetName: parsed.source || file.name
  };
}

async function handleTargetUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusEl = APP_MODE === 2
    ? (document.getElementById("mode2TargetStatus") ?? targetImportStatus)
    : targetImportStatus;
  if (!(await ensureBackendReadyForPdf(file, statusEl))) {
    event.target.value = "";
    return;
  }

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
    syncTargetTotalN();
    applyDefaultTargetPH();
    resetTargetPresetSelects();
    clearReverseSelection();
    renderTargetTable();
    recalculate();
    setModuleCollapsed(
      document.getElementById(APP_MODE === 2 ? "mode2TargetSection" : "importPanel"),
      false
    );
    statusEl.textContent = `已导入 ${file.name}，识别到 ${Object.keys(parsed.values || {}).length} 个目标指标`;
  } catch (error) {
    console.warn("Target import failed", error);
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

  if (!(await ensureBackendReadyForPdf(file, formulaImportStatus))) {
    event.target.value = "";
    return;
  }

  formulaImportStatus.textContent = `正在解析 ${file.name} ...`;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await parseFormulaFile(file, buffer);
    if (!parsed.bucketA.length && !parsed.bucketB.length) {
      throw new Error("未识别到 A桶/B桶肥料行");
    }

    state.bucketA = parsed.bucketA;
    state.bucketB = parsed.bucketB;
    state.lastFormulaSource = parsed.sheetName || file.name;
    clearReverseSelection();

    if (parsed.aVolume) document.querySelector("#aTankVolume").value = parsed.aVolume;
    if (parsed.bVolume) document.querySelector("#bTankVolume").value = parsed.bVolume;

    renderBucket("A");
    renderBucket("B");
    recalculate();
    setModuleCollapsed(document.getElementById("importPanel"), false);
    document.querySelectorAll("#bucketGrid .module-panel").forEach((panel) => {
      setModuleCollapsed(panel, false);
    });
    formulaImportStatus.textContent =
      `已导入 ${file.name}，A桶 ${parsed.bucketA.length} 项，B桶 ${parsed.bucketB.length} 项，来源工作表：${parsed.sheetName}`;
  } catch (error) {
    console.warn("Formula import failed", error);
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

function isPdfFile(fileName) {
  return /\.pdf$/i.test(fileName);
}

async function ensureBackendReadyForPdf(file, statusEl) {
  if (!isPdfFile(file.name)) return true;
  statusEl.textContent = `检测到 PDF：正在检查本地后台 ...`;

  try {
    const res = await fetch(`${API_BASE}/api/ping`, { cache: "no-store" });
    if (res.ok) return true;
  } catch (error) {
    console.info("Backend ping failed before PDF import", error);
  }

  statusEl.textContent =
    `检测到 PDF，但后台服务暂时不可用。本地运行请先启动 backend/start.sh；服务器部署请检查 fertical systemd 服务和 /api 代理，然后重新上传 ${file.name}`;
  return false;
}

function parseWorkbook(workbook) {
  let best = { values: emptyElementMap(), hitCount: 0, sheetName: workbook.SheetNames[0] };

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const sourceWater = parseSourceWaterRows(rows);
    if (sourceWater.hits.size > best.hitCount) {
      best = { values: sourceWater.values, hitCount: sourceWater.hits.size, sheetName };
      return;
    }

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
    "mg-no3-6h2o": ["硝酸镁", "六水硝酸镁", "硝酸镁六水合物", "Magnesium nitrate", "Mg(NO3)2", "Mg(NO3)2·6H2O", "11-0-0+16MgO"],
    can: ["硝酸铵钙", "CAN"],
    cacl2: ["氯化钙", "CaCl2"],
    kcl: ["氯化钾", "KCl"],
    kno3: ["硝酸钾", "KNO3"],
    "edta-fe-13": ["EDTA-铁", "EDTA铁", "螯合铁13", "铁13", "铁-13", "EDTA-Fe", "EDTAFe"],
    "dtpa-fe-11": ["DTPA-铁", "DTPA铁", "螯合铁11", "铁11", "铁-11", "DTPA-Fe", "DTPAFe", "铁肥"],
    "eddha-fe-6": ["EDDHA-铁", "EDDHA铁", "螯合铁6", "铁6", "铁-6", "EDDHA-Fe", "EDDHAFe", "EDDHA-Fe-11"],
    "edta-mn-13": ["EDTA-锰", "EDTA锰", "螯合锰", "螯合猛", "锰螯合", "EDTA-Mn", "EDTAMn"],
    "edta-zn-15": ["EDTA-锌", "EDTA锌", "螯合锌", "锌螯合", "EDTA-Zn", "EDTAZn"],
    "edta-cu-15": ["EDTA-铜", "EDTA铜", "螯合铜", "铜螯合", "EDTA-Cu", "EDTACu"],
    "hno3-40": ["硝酸", "HNO3"],
    kh2po4: ["磷酸二氢钾", "KH2PO4"],
    "mgso4-7h2o": ["七水硫酸镁", "五水硫酸镁", "硫酸镁", "MgSO4"],
    k2so4: ["硫酸钾", "K2SO4"],
    mnso4: ["硫酸锰", "MnSO4"],
    borax: ["硼砂", "十水硼砂", "Na2B4O7", "Na2B4O7·10H2O"],
    "na-octaborate-4h2o": ["四水八硼", "四水八硼酸钠", "八硼酸钠", "Solubor", "速乐硼", "Na2B8O13", "Na2B8O13·4H2O"],
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

function parseSourceWaterRows(rows) {
  const result = emptyElementMap();
  const hits = new Set();

  rows.forEach((headerRow, headerIndex) => {
    if (hits.size > 0 || !Array.isArray(headerRow)) return;
    const headerKeys = headerRow.map(detectWaterReportHeaderKey);
    if (headerKeys.filter(Boolean).length < 5) return;

    const sourceRow = rows
      .slice(headerIndex + 1, headerIndex + 121)
      .find((row) => Array.isArray(row) && row.some(isSourceWaterCell));
    if (!sourceRow) return;

    headerKeys.forEach((elementKey, index) => {
      if (!elementKey || hits.has(elementKey) || index >= sourceRow.length) return;
      const parsedValue = convertValue(elementKey, sourceRow[index], String(headerRow[index] ?? ""));
      if (Number.isFinite(parsedValue)) {
        result[elementKey] = parsedValue;
        hits.add(elementKey);
      }
    });
  });

  return { values: result, hits };
}

function isSourceWaterCell(cell) {
  const text = String(cell ?? "").replace(/\s+/g, "");
  if (!text) return false;
  if (/出水|废水|污水|排水|回水|尾水|进液|回液|标准|限值|方法|单位|项目|指标|编号/.test(text)) {
    return false;
  }
  return /原水|水样|水质|灌溉水|井水|地下水|自来水|水源|取样/i.test(text)
    || /rawwater|sourcewater|waterquality|watersample/i.test(text);
}

function detectWaterReportHeaderKey(cell) {
  const text = String(cell ?? "").replace(/\s+/g, "");
  const lower = text.toLowerCase();
  if (!text) return null;
  if (/%|k2o|cao|mgo|fe2o3|al2o3|na2o|含水率|有机|碳氮比/i.test(lower)) {
    return null;
  }
  if (/n[-－]?no3|no3[-－]?n|硝/i.test(lower)) return "NO3-N";
  if (/n[-－]?nh4|nh4[-－]?n|铵|氨氮/i.test(lower)) return "NH4-N";
  if (/n[-－]?tn|总氮|全氮/i.test(lower)) return "N";
  if (/hco3|碳酸氢/i.test(lower)) return "HCO3";
  if (/(^|[^h])co3|碳酸根/i.test(lower)) return "CO3";
  if (/(^|[^a-z])ec(?:[^a-z]|$)|电导/i.test(lower)) return "EC";
  if (/\bph\b|酸碱/i.test(lower)) return "pH";
  if (/cl[-－]?|氯/i.test(lower)) return "Cl";

  const cleaned = lower
    .replace(/(?:mg\/l|mg\/kg|mmol\/l|μg\/l|ug\/l|µg\/l|\(.+?\)|（.+?）)/g, "")
    .replace(/[^a-z]/g, "");
  return {
    b: "B",
    ca: "Ca",
    cu: "Cu",
    fe: "Fe",
    k: "K",
    mg: "Mg",
    mn: "Mn",
    mo: "Mo",
    na: "Na",
    p: "P",
    s: "S",
    si: "Si",
    zn: "Zn"
  }[cleaned] ?? null;
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

function syncTargetTotalN(changedKey = "") {
  if (changedKey && !["NO3-N", "NH4-N", "N"].includes(changedKey)) return;
  if (changedKey === "N") return;

  const no3 = typeof state.targets["NO3-N"] === "number" ? state.targets["NO3-N"] : 0;
  const nh4 = typeof state.targets["NH4-N"] === "number" ? state.targets["NH4-N"] : 0;
  if (no3 > 0 || nh4 > 0) {
    state.targets.N = no3 + nh4;
    document.querySelectorAll(`[data-target-key="N"]`).forEach((el) => {
      el.value = toTargetInputValue("N", state.targets.N);
    });
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

function renderGroupedElementCells(items, renderCell) {
  const assignedKeys = new Set();
  const sections = DISPLAY_ELEMENT_GROUPS.map((group) => {
    const groupItems = items.filter((item) => {
      if (group.keys) return group.keys.has(item.key);
      return !assignedKeys.has(item.key);
    });
    groupItems.forEach((item) => assignedKeys.add(item.key));
    return { title: group.title, items: groupItems };
  }).filter((group) => group.items.length);

  return sections.map((group) => `
    <div class="water-group-title">${group.title}</div>
    ${group.items.map(renderCell).join("")}
  `).join("");
}

function getDisplayUnit(key) {
  return MOLAR_MASS[key] ? "mmol/L" : (ELEMENT_META.find((item) => item.key === key)?.unit ?? "");
}

function getConcentrationDisplayUnit(key) {
  return TRACE_FERTILIZER_KEYS.has(key) ? "µmol/L" : getDisplayUnit(key);
}

function toConcentrationDisplayValue(key, value) {
  return TRACE_FERTILIZER_KEYS.has(key) ? Number(value || 0) * 1000 : Number(value || 0);
}

function getTargetInputUnit(key) {
  return getConcentrationDisplayUnit(key);
}

function toTargetInputValue(key, value) {
  if (value == null || value === 0) return "";
  const displayValue = TRACE_FERTILIZER_KEYS.has(key) ? Number(value) * 1000 : Number(value);
  return formatInputNumber(displayValue);
}

function fromTargetInputValue(key, value) {
  const numeric = toNullableNumber(value);
  if (numeric == null) return null;
  return TRACE_FERTILIZER_KEYS.has(key) ? numeric / 1000 : numeric;
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
  return value == null || value === 0 ? "" : formatInputNumber(value);
}

function formatInputNumber(value, maxDecimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(maxDecimals).replace(/\.?0+$/, "");
}

function deviationClass(ratio, key = "") {
  if (ratio === null) return "";
  if (key === "EC") return "";
  return reverseDeviationBand({ key, ratio });
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

function renderCalibrationReadout() {
  if (!calibrationReadout) return;
  if (!latestCalculation) {
    calibrationReadout.innerHTML = "";
    return;
  }
  calibrationReadout.innerHTML = `
    <span>理论 EC ${formatNumber(latestCalculation.predictedEc)} uS/cm</span>
    <span>理论 pH ${latestCalculation.predictedPh.toFixed(2)}</span>
    <span>原水 HCO3 ${formatNumber(state.water.HCO3)} mg/L</span>
    ${state.phCalibration?.enabled ? `<span>pH校准 ${state.phCalibration.count} 组</span>` : ""}
  `;
}

async function loadPHCalibration() {
  try {
    const calibration = await apiFetch("/api/calibration/ph");
    state.phCalibration = calibration?.enabled ? calibration : null;
    renderCurrentCalculation();
  } catch (error) {
    state.phCalibration = null;
    console.warn("pH calibration is unavailable", error);
  }
}

async function saveCurrentTitration() {
  if (!saveTitrationBtn || !calibrationStatus) return;
  if (!latestCalculation) renderCurrentCalculation();

  const measuredEc = toNullableNumber(measuredEcInput?.value ?? "");
  const measuredPh = toNullableNumber(measuredPhInput?.value ?? "");
  if (measuredEc == null || measuredPh == null) {
    calibrationStatus.textContent = "请先填写本次实测 EC 和 pH。";
    return;
  }
  if (measuredPh <= 0 || measuredPh > 14) {
    calibrationStatus.textContent = "实测 pH 需要在 0-14 之间。";
    return;
  }

  saveTitrationBtn.disabled = true;
  calibrationStatus.textContent = "正在保存本次校准数据...";

  try {
    const waterPayload = buildWaterReportPayload();
    const formulaPayload = buildFormulaPayload();
    const [waterRecord, formulaRecord] = await Promise.all([
      apiFetch("/api/water-reports", { method: "POST", body: JSON.stringify(waterPayload) }),
      apiFetch("/api/formulas", { method: "POST", body: JSON.stringify(formulaPayload) })
    ]);

    const payload = {
      formula_id: formulaRecord.id,
      water_report_id: waterRecord.id,
      measured_at: new Date().toISOString(),
      measured_ec: measuredEc,
      measured_ph: measuredPh,
      predicted_ec: latestCalculation.predictedEc,
      predicted_ph: latestCalculation.predictedPh,
      element_actuals: {},
      water_snapshot: cleanNumericMap(state.water),
      formula_snapshot: formulaPayload,
      total_mmol: cleanNumericMap(latestCalculation.totalMmol),
      acid_profile: cleanNumericMap(latestCalculation.acidProfile),
      notes: titrationNotesInput?.value?.trim() || null
    };
    await apiFetch("/api/titrations", { method: "POST", body: JSON.stringify(payload) });

    const ecDelta = measuredEc - latestCalculation.predictedEc;
    const phDelta = measuredPh - latestCalculation.predictedPh;
    calibrationStatus.textContent =
      `已保存。EC 偏差 ${ecDelta >= 0 ? "+" : ""}${formatNumber(ecDelta)} uS/cm，pH 偏差 ${phDelta >= 0 ? "+" : ""}${phDelta.toFixed(2)}。`;
    await loadPHCalibration();
  } catch (error) {
    console.warn("Titration save failed", error);
    calibrationStatus.textContent = `保存失败：${error?.message || "请确认本地后端已启动"}`;
  } finally {
    saveTitrationBtn.disabled = false;
  }
}

function buildWaterReportPayload() {
  return {
    name: state.lastWaterSource ? `原水-${state.lastWaterSource}` : `原水-${formatDateTimeForName()}`,
    tested_at: new Date().toISOString().slice(0, 10),
    no3_n: state.water["NO3-N"] || 0,
    nh4_n: state.water["NH4-N"] || 0,
    n: state.water.N || 0,
    p: state.water.P || 0,
    k: state.water.K || 0,
    ca: state.water.Ca || 0,
    mg: state.water.Mg || 0,
    s: state.water.S || 0,
    cl: state.water.Cl || 0,
    fe: state.water.Fe || 0,
    mn: state.water.Mn || 0,
    zn: state.water.Zn || 0,
    b: state.water.B || 0,
    cu: state.water.Cu || 0,
    mo: state.water.Mo || 0,
    na: state.water.Na || 0,
    si: state.water.Si || 0,
    hco3: state.water.HCO3 || 0,
    ec: state.water.EC || 0,
    ph: state.water.pH || 0,
    notes: state.isRoWater ? "RO水灌溉模式保存" : null
  };
}

function buildFormulaPayload() {
  return {
    name: state.lastFormulaSource ? `配方-${state.lastFormulaSource}` : `配方-${formatDateTimeForName()}`,
    description: "由功能1实测校准记录自动保存",
    a_tank_volume: getNumericField("aTankVolume") || 100,
    a_dilution: getNumericField("aDilution") || 100,
    b_tank_volume: getNumericField("bTankVolume") || 100,
    b_dilution: getNumericField("bDilution") || 100,
    a_rows: serializeBucketRows(state.bucketA),
    b_rows: serializeBucketRows(state.bucketB)
  };
}

function serializeBucketRows(rows) {
  return rows.map((row) => ({
    fertilizerId: row.fertilizerId,
    amount: Number(row.amount) || 0,
    unit: row.unit || "kg"
  }));
}

function cleanNumericMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function formatDateTimeForName() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
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
  const npkGrade = latestCalculation
    ? calculateNpkOxideGrade(latestCalculation.bucketAResult, latestCalculation.bucketBResult)
    : null;
  const summary = [
    ["导出时间", new Date().toLocaleString("zh-CN")],
    ["A 桶体积 L", document.querySelector("#aTankVolume")?.value || ""],
    ["A 桶稀释倍数", document.querySelector("#aDilution")?.value || ""],
    ["B 桶体积 L", document.querySelector("#bTankVolume")?.value || ""],
    ["B 桶稀释倍数", document.querySelector("#bDilution")?.value || ""],
    ["A+B 每100kg肥 N-P2O5-K2O", npkGrade ? formatNpkGradeValue(npkGrade) : ""],
    ["N kg/100kg肥", npkGrade ? Number(npkGrade.n.toFixed(4)) : ""],
    ["P2O5 kg/100kg肥", npkGrade ? Number(npkGrade.p2o5.toFixed(4)) : ""],
    ["K2O kg/100kg肥", npkGrade ? Number(npkGrade.k2o.toFixed(4)) : ""],
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
  const context = getFormulaExportContext();
  if (!context) return;

  const volume = Number(document.querySelector("#formulaExportVolume")?.value || 100);
  const format = document.querySelector("#formulaExportFormat")?.value || "xlsx";
  const { selected, currentFormula } = context;
  const rows = buildFormulaExportRows(currentFormula, volume);
  recordFormulaAdjustment(selected, currentFormula, APP_MODE);

  if (format === "pdf") {
    exportFormulaPdf(currentFormula, volume, rows);
  } else {
    exportFormulaWorkbook(currentFormula, volume, rows);
  }

  setStatus(`已导出当前微调后的「${currentFormula.name}」`);
  const exportStatus = document.querySelector("#formulaExportStatus");
  if (exportStatus) exportStatus.textContent = "已保存本次微调配方；功能 2、3 的下次推荐会参考这项偏好。";
}

function getFormulaExportContext() {
  if (APP_MODE === 3) {
    const selected = state.soilSuggestions[state.selectedSoilIndex];
    if (!selected) {
      alert("请先采用一个土壤施肥方案，再微调并导出");
      return null;
    }
    syncSoilAdjustedRowsFromEditor();
    return {
      selected: soilSuggestionToFormula(selected),
      currentFormula: {
        id: `${selected.id}-soil-adjusted`,
        name: `${selected.name}（微调后）`,
        sourceSuggestionId: selected.id,
        sourceSuggestionName: selected.name,
        baseAmount: selected.batch,
        amountUnit: "kg",
        bucketA: soilRowsToFormulaRows(state.soilAdjustedRows.filter((row) => row.bucket === "A")),
        bucketB: soilRowsToFormulaRows(state.soilAdjustedRows.filter((row) => row.bucket === "B"))
      }
    };
  }

  if (APP_MODE === 2) {
    const selected = state.reverseSuggestions[state.selectedReverseIndex];
    if (!selected) {
      alert("请先采用一个配方方案");
      return null;
    }
    return { selected, currentFormula: buildCurrentFormulaSnapshot(selected) };
  }

  if (APP_MODE === 1) {
    if (!state.bucketA.length && !state.bucketB.length) {
      alert("请先添加或导入 A/B 桶配方");
      return null;
    }
    const selected = {
      id: "mode1-current",
      name: state.lastFormulaSource || "当前配方",
      bucketA: state.bucketA.map((row) => ({ ...row })),
      bucketB: state.bucketB.map((row) => ({ ...row }))
    };
    return { selected, currentFormula: buildCurrentFormulaSnapshot(selected) };
  }
  return null;
}

function buildCurrentFormulaSnapshot(selected) {
  return {
    id: `${selected.id || "custom"}-adjusted`,
    name: `${selected.name}（微调后）`,
    sourceSuggestionId: selected.id,
    sourceSuggestionName: selected.name,
    bucketA: state.bucketA.map((row) => ({ ...row })),
    bucketB: state.bucketB.map((row) => ({ ...row }))
  };
}

function buildFormulaExportRows(formula, volume) {
  const aBase = formula.baseAmount || getNumericField("aTankVolume") || 100;
  const bBase = formula.baseAmount || getNumericField("bTankVolume") || 100;
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
    ...buildRows("A", formula.bucketA, aBase),
    ...buildRows("B", formula.bucketB, bBase)
  ];
}

function exportFormulaWorkbook(formula, volume, rows) {
  const volumeUnit = formula.amountUnit === "kg" ? "kg" : "L";
  const data = [
    ["FertiCal 配方导出"],
    ["方案", formula.name],
    ["来源建议", formula.sourceSuggestionName || formula.name],
    [formula.amountUnit === "kg" ? "配方总量" : "AB肥配制量", `${volume} ${volumeUnit}`],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    [],
    ["桶", "肥料", "用量 kg", "备注"],
    ...rows.map((row) => [row.bucket, row.fertilizer, Number(row.amountKg.toFixed(4)), row.notes])
  ];

  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "配方");
    XLSX.writeFile(wb, `FertiCal-配方-${formula.id}-${volume}${volumeUnit}-${dateStamp()}.xlsx`);
    return;
  }

  const csv = data.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadTextFile(`FertiCal-配方-${formula.id}-${volume}${volumeUnit}-${dateStamp()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

function exportFormulaPdf(formula, volume, rows) {
  const volumeUnit = formula.amountUnit === "kg" ? "kg" : "L";
  const html = `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>FertiCal 配方 - ${escapeHtml(formula.name)}</title>
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
        <p>方案：${escapeHtml(formula.name)} · 来源建议：${escapeHtml(formula.sourceSuggestionName || formula.name)} · ${formula.amountUnit === "kg" ? "配方总量" : "AB肥配制量"}：${volume} ${volumeUnit} · ${escapeHtml(new Date().toLocaleString("zh-CN"))}</p>
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
    downloadTextFile(`FertiCal-配方-${formula.id}-${volume}${volumeUnit}-${dateStamp()}.html`, html, "text/html;charset=utf-8");
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function recordFormulaAdjustment(suggestion, formula, mode = APP_MODE) {
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    suggestionId: suggestion.id,
    suggestionName: suggestion.name,
    mode,
    cropType: state.cropType,
    tanks: {
      aVolume: getNumericField("aTankVolume"),
      aDilution: getNumericField("aDilution"),
      bVolume: getNumericField("bTankVolume"),
      bDilution: getNumericField("bDilution")
    },
    targets: { ...state.targets },
    water: { ...state.water },
    suggested: {
      bucketA: normalizeFormulaRows(suggestion.bucketA),
      bucketB: normalizeFormulaRows(suggestion.bucketB)
    },
    final: {
      bucketA: normalizeFormulaRows(formula.bucketA),
      bucketB: normalizeFormulaRows(formula.bucketB)
    },
    differences: [
      ...compareFormulaRows("A", suggestion.bucketA, formula.bucketA),
      ...compareFormulaRows("B", suggestion.bucketB, formula.bucketB)
    ]
  };

  try {
    const key = "fertical-formula-adjustments-v1";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.push(record);
    localStorage.setItem(key, JSON.stringify(existing.slice(-200)));
  } catch (error) {
    console.warn("Formula adjustment record was not saved", error);
  }
}

function readFormulaAdjustmentRecords() {
  try {
    const records = JSON.parse(localStorage.getItem("fertical-formula-adjustments-v1") || "[]");
    return Array.isArray(records) ? records : [];
  } catch (error) {
    console.warn("Formula preference records could not be read", error);
    return [];
  }
}

function getLearnedFertilizerPreferences(targetMode) {
  const scores = new Map();
  readFormulaAdjustmentRecords().slice(-100).forEach((record) => {
    const rows = [...(record.final?.bucketA || []), ...(record.final?.bucketB || [])];
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.amountKg) || 0), 0) || 1;
    rows.forEach((row) => {
      const share = Math.max(0, Number(row.amountKg) || 0) / total;
      scores.set(row.fertilizerId, (scores.get(row.fertilizerId) || 0) + Math.min(share, 0.5));
    });
    (record.differences || []).forEach((diff) => {
      const scale = Math.max(0.05, Number(diff.suggestedKg) || Number(diff.finalKg) || 0.05);
      const signal = Math.max(-1, Math.min(1, (Number(diff.deltaKg) || 0) / scale));
      scores.set(diff.fertilizerId, (scores.get(diff.fertilizerId) || 0) + signal * 0.35);
    });
  });
  const divisor = targetMode === 3 ? 5 : 6;
  scores.forEach((value, key) => scores.set(key, Math.max(-1, Math.min(1, value / divisor))));
  return scores;
}

function normalizeFormulaRows(rows) {
  return rows.map((row) => ({
    fertilizerId: row.fertilizerId,
    fertilizer: getFertilizer(row.fertilizerId).name,
    amountKg: row.unit === "kg" ? Number(row.amount || 0) : Number(row.amount || 0) / 1000
  }));
}

function compareFormulaRows(bucket, suggestedRows, finalRows) {
  const suggested = mapFormulaAmounts(suggestedRows);
  const final = mapFormulaAmounts(finalRows);
  const ids = new Set([...suggested.keys(), ...final.keys()]);
  return Array.from(ids).map((fertilizerId) => {
    const suggestedKg = suggested.get(fertilizerId) || 0;
    const finalKg = final.get(fertilizerId) || 0;
    const deltaKg = finalKg - suggestedKg;
    return {
      bucket,
      fertilizerId,
      fertilizer: getFertilizer(fertilizerId).name,
      suggestedKg,
      finalKg,
      deltaKg,
      deltaRatio: suggestedKg > 0 ? deltaKg / suggestedKg : null
    };
  }).filter((item) => Math.abs(item.deltaKg) > 0.000001);
}

function mapFormulaAmounts(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const amountKg = row.unit === "kg" ? Number(row.amount || 0) : Number(row.amount || 0) / 1000;
    map.set(row.fertilizerId, (map.get(row.fertilizerId) || 0) + amountKg);
  });
  return map;
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
  setStatus("正在生成配方建议...");
  clearMode2CalculationResult();

  const suggestions = generateReverseSuggestions();
  state.reverseSuggestions = suggestions;
  state.selectedReverseIndex = null;
  updateBucketGridVisibility();
  if (!suggestions.length) {
    setStatus(getActiveReverseTargets().length
      ? "当前目标与库存约束下暂未生成可用配方，请调整目标或开放更多原料"
      : "请先设置至少一个高于原水背景的目标浓度");
    renderReverseSuggestions([]);
    return;
  }

  renderReverseSuggestions(suggestions);
  setStatus(`已生成 ${suggestions.length} 个配方建议，请选择一个采用`, 2500);
}

function generateReverseSuggestions() {
  const profiles = buildReverseProfiles();

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

function buildReverseProfiles() {
  const preferences = state.reversePreferences;
  const learnedPreferences = getLearnedFertilizerPreferences(2);
  const common = {
    exclude: getPreferenceExcludedFertilizers(preferences),
    acidPenalty: getPreferenceAcidPenalty(preferences),
    tracePreference: preferences.traceChelate,
    ironStrategy: preferences.ironStrategy,
    phFloor: preferences.ironStrategy === "high-ph" ? 6.5 : null,
    learnedPreferences
  };
  const costMultiplier = preferences.costPriority === "low"
    ? 1.8
    : preferences.costPriority === "quality" ? 0.45 : 1;
  const rowPenaltyMultiplier = preferences.costPriority === "quality" ? 1.15 : 1;

  return [
    {
      ...common,
      id: "fit",
      name: "目标贴合优先",
      note: buildPreferenceNote("尽量贴近主要目标元素", preferences),
      rowPenalty: 0.0005 * rowPenaltyMultiplier
    },
    {
      ...common,
      id: "low-cl-s",
      name: "低氯低硫优先",
      note: buildPreferenceNote("优先避开氯化盐和硫酸钾", preferences),
      exclude: [...common.exclude, "cacl2", "kcl", "k2so4"],
      rowPenalty: 0.0005 * rowPenaltyMultiplier
    },
    {
      ...common,
      id: "low-cost",
      name: "原料成本最低",
      note: buildPreferenceNote("按测试单价优先选择低成本组合", preferences),
      rowPenalty: 0.0004,
      costPenalty: 0.0018 * costMultiplier
    }
  ];
}

function getPreferenceExcludedFertilizers(preferences) {
  const exclude = [];
  if (preferences.nitricAcid === "unavailable") exclude.push("hno3-40");
  if (preferences.phosphoricAcid === "unavailable") exclude.push("h3po4-85");
  return exclude;
}

function getPreferenceAcidPenalty(preferences) {
  return {
    nitric: preferences.nitricAcid === "avoid" ? 1.2 : 0,
    phosphoric: preferences.phosphoricAcid === "avoid" ? 0.45 : 0
  };
}

function buildPreferenceNote(base, preferences) {
  const parts = [base];
  if (preferences.traceChelate === "prefer") parts.push("微量元素优先螯合态");
  if (preferences.ironStrategy === "high-ph") {
    parts.push("铁源优先铁-6并尽量保留 pH ≥ 6.5");
  } else {
    parts.push("铁源按 pH 选择铁-13/铁-11/铁-6");
  }
  if (preferences.nitricAcid === "avoid") parts.push("尽量不用硝酸");
  if (preferences.nitricAcid === "unavailable") parts.push("不使用硝酸");
  if (preferences.phosphoricAcid === "avoid") parts.push("尽量不用磷酸");
  if (preferences.phosphoricAcid === "unavailable") parts.push("不使用磷酸");
  return parts.join("，");
}

function buildReverseSuggestion(profile) {
  const acidPlans = buildAcidPrefeedPlans(profile);
  const suggestions = acidPlans
    .map((acidPlan) => buildReverseSuggestionWithAcidPlan(profile, acidPlan))
    .filter(Boolean);

  return suggestions.sort((a, b) => a.score - b.score)[0] ?? null;
}

function buildReverseSuggestionWithAcidPlan(profile, acidPlan) {
  const activeTargets = getActiveReverseTargets(acidPlan.nutrients);

  if (!activeTargets.length) {
    const bucketA = acidPlan.bucketA.map((row) => ({ ...row }));
    const bucketB = acidPlan.bucketB.map((row) => ({ ...row }));
    applyPHTargetAdjustment(profile, bucketA, bucketB);
    return bucketA.length || bucketB.length
      ? evaluateReverseSuggestion(profile, bucketA, bucketB)
      : null;
  }

  const aTank = getNumericField("aTankVolume");
  const aDilution = getNumericField("aDilution");
  const bTank = getNumericField("bTankVolume");
  const bDilution = getNumericField("bDilution");

  if (!aTank || !aDilution || !bTank || !bDilution) {
    return null;
  }

  const variables = prioritizeReverseFertilizerVariables([
    ...getCatalogByBucket("A").map((fertilizer) => ({ fertilizer, bucket: "A" })),
    ...getCatalogByBucket("B").map((fertilizer) => ({ fertilizer, bucket: "B" }))
  ].filter((variable) =>
    state.inventory[variable.fertilizer.id] &&
    !profile.exclude.includes(variable.fertilizer.id) &&
    !isAcidFertilizer(variable.fertilizer)
  ), profile);

  const matrix = activeTargets.map((target) =>
    variables.map((variable) => contributionPerKg(variable, target.key, { aTank, aDilution, bTank, bDilution }) * target.weight)
  );
  const target = activeTargets.map((item) => item.need * item.weight);

  if (profile.rowPenalty) {
    variables.forEach((variable, index) => {
      const row = Array(variables.length).fill(0);
      row[index] = profile.rowPenalty * learnedPreferenceMultiplier(profile, variable.fertilizer.id);
      matrix.push(row);
      target.push(0);
    });
  }

  if (profile.costPenalty) {
    variables.forEach((variable, index) => {
      const row = Array(variables.length).fill(0);
      row[index] = profile.costPenalty * normalizedFertilizerPrice(variable.fertilizer.id) *
        learnedPreferenceMultiplier(profile, variable.fertilizer.id);
      matrix.push(row);
      target.push(0);
    });
  }

  const solution = solveNonNegativeLeastSquares(matrix, target);
  if (!solution) return null;

  const bucketA = acidPlan.bucketA.map((row) => ({ ...row }));
  const bucketB = acidPlan.bucketB.map((row) => ({ ...row }));
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

function buildAcidPrefeedPlans(profile) {
  const acidDemand = estimateAlkalinityAcidDemand();
  const emptyPlan = {
    bucketA: [],
    bucketB: [],
    nutrients: emptyElementMap(),
    fertilizerIds: new Set()
  };

  if (!(acidDemand > ACID_PREFEED_MIN_MMOL)) return [emptyPlan];

  const nitricAvailable = isAcidAvailableForPrefeed("hno3-40", "A", profile);
  const phosphoricAvailable = isAcidAvailableForPrefeed("h3po4-85", "B", profile);
  if (!nitricAvailable && !phosphoricAvailable) return [emptyPlan];

  const targetNo3 = getNitricAcidNutrientSpace();
  const targetP = getTargetNutrientSpace("P");
  const phosphoricLimit = phosphoricAvailable ? getPhosphoricPrefeedLimit(acidDemand, targetNo3, targetP) : 0;
  const nitricSplits = new Set();

  if (nitricAvailable && phosphoricAvailable) {
    const minimumNitric = roundMmol(Math.max(0, acidDemand - phosphoricLimit));
    for (let i = 0; i <= 12; i++) {
      nitricSplits.add(roundMmol(minimumNitric + (acidDemand - minimumNitric) * i / 12));
    }
    [
      minimumNitric,
      targetNo3,
      acidDemand - phosphoricLimit,
      (targetNo3 + acidDemand - targetP) / 2
    ].forEach((value) => nitricSplits.add(roundMmol(clamp(value, 0, acidDemand))));
  } else {
    nitricSplits.add(nitricAvailable ? roundMmol(acidDemand) : 0);
  }

  const plans = [...nitricSplits]
    .map((nitricMmol) => createAcidPrefeedPlan(
      nitricAvailable ? clamp(nitricMmol, 0, acidDemand) : 0,
      phosphoricAvailable ? Math.min(phosphoricLimit, acidDemand - clamp(nitricMmol, 0, acidDemand)) : 0
    ))
    .filter((plan) => plan.bucketA.length || plan.bucketB.length);

  return plans.length ? plans : [emptyPlan];
}

function getPhosphoricPrefeedLimit(acidDemand, targetNo3, targetP) {
  if (!(targetP > 0)) return 0;
  return clamp(targetP, 0, acidDemand);
}

function isAcidAvailableForPrefeed(fertilizerId, bucket, profile) {
  return state.inventory[fertilizerId] &&
    !profile.exclude.includes(fertilizerId) &&
    getCatalogByBucket(bucket).some((item) => item.id === fertilizerId);
}

function createAcidPrefeedPlan(nitricMmol, phosphoricMmol) {
  const plan = {
    bucketA: [],
    bucketB: [],
    nutrients: emptyElementMap(),
    fertilizerIds: new Set()
  };

  if (nitricMmol > ACID_PREFEED_MIN_MMOL) {
    const amount = acidMmolToKg("hno3-40", "A", nitricMmol);
    if (amount > 0) {
      plan.bucketA.push({ id: crypto.randomUUID(), fertilizerId: "hno3-40", amount, unit: "kg" });
      plan.nutrients["NO3-N"] += nitricMmol;
      plan.nutrients.N += nitricMmol;
      plan.fertilizerIds.add("hno3-40");
    }
  }

  if (phosphoricMmol > ACID_PREFEED_MIN_MMOL) {
    const amount = acidMmolToKg("h3po4-85", "B", phosphoricMmol);
    if (amount > 0) {
      plan.bucketB.push({ id: crypto.randomUUID(), fertilizerId: "h3po4-85", amount, unit: "kg" });
      plan.nutrients.P += phosphoricMmol;
      plan.fertilizerIds.add("h3po4-85");
    }
  }

  return plan;
}

function acidMmolToKg(fertilizerId, bucket, mmolPerLiter) {
  const fertilizer = getFertilizer(fertilizerId);
  const acid = fertilizer.acidContrib?.[0];
  const tankVolume = getNumericField(bucket === "A" ? "aTankVolume" : "bTankVolume");
  const dilution = getNumericField(bucket === "A" ? "aDilution" : "bDilution");
  if (!acid || !tankVolume || !dilution) return 0;
  const kg = mmolPerLiter * tankVolume * dilution * acid.molarMass / acid.purity / 1e6;
  return roundAmount(kg);
}

function estimateAlkalinityAcidDemand() {
  const targetPH = state.targets.pH;
  if (!(typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0)) return 0;

  const waterMmol = buildWaterMmol();
  const sourceAlkalinity = carbonateAlkalinityFromMmol(waterMmol, state.water?.pH);
  if (sourceAlkalinity <= TARGET_RESIDUAL_HCO3_MMOL) return 0;

  const waterPH = (typeof state.water?.pH === "number" && Number.isFinite(state.water.pH) && state.water.pH > 0)
    ? state.water.pH : 7.5;
  if (waterPH <= targetPH + 0.03) return 0;

  const residualDemand = Math.max(0, sourceAlkalinity - TARGET_RESIDUAL_HCO3_MMOL);
  let low = 0;
  let high = Math.max(residualDemand, sourceAlkalinity * 0.25, ACID_PREFEED_MIN_MMOL);

  for (let i = 0; i < 16 && calculatePH(waterMmol, { strong: high, h3po4: 0, h2po4: 0 }) > targetPH; i++) {
    high *= 1.5;
    if (high >= sourceAlkalinity) {
      high = sourceAlkalinity;
      break;
    }
  }

  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2;
    if (calculatePH(waterMmol, { strong: mid, h3po4: 0, h2po4: 0 }) > targetPH) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return roundMmol(clamp(Math.max(high, residualDemand), 0, sourceAlkalinity));
}

function getNitricAcidNutrientSpace() {
  if (typeof state.targets["NO3-N"] === "number" && Number.isFinite(state.targets["NO3-N"])) {
    return getTargetNutrientSpace("NO3-N");
  }
  return getTargetNutrientSpace("N");
}

function getTargetNutrientSpace(key) {
  const target = state.targets[key];
  if (!(typeof target === "number" && Number.isFinite(target) && target > 0)) return 0;
  const waterValue = toMmolPerLiter(key, state.water[key] ?? 0) ?? 0;
  return Math.max(0, target - waterValue);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function roundMmol(value) {
  return Number((Number(value) || 0).toFixed(4));
}

function getActiveReverseTargets(prefeedMmol = null) {
  return getReverseTargetElements()
    .filter((key) =>
      typeof state.targets[key] === "number" &&
      Number.isFinite(state.targets[key])
    )
    .map((key) => {
      const waterValue = toMmolPerLiter(key, state.water[key] ?? 0) ?? 0;
      const prefeedValue = prefeedMmol?.[key] ?? 0;
      return {
        key,
        need: Math.max(0, state.targets[key] - waterValue - prefeedValue),
        target: state.targets[key],
        weight: reverseTargetWeight(key)
      };
    })
    .filter((item) => item.need > 0);
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

function prioritizeReverseFertilizerVariables(variables, profile) {
  const availableIds = new Set(variables.map((variable) => variable.fertilizer.id));
  const preferredIronId = selectPreferredIronChelateId(availableIds, getReverseDesignPH(profile), profile);

  return variables.filter((variable) => {
    const fertilizerId = variable.fertilizer.id;
    if (isIronChelate(fertilizerId)) {
      return fertilizerId === preferredIronId;
    }

    const traceElement = getTraceSulfateElement(fertilizerId);
    if (traceElement && profile.tracePreference !== "any") {
      const preferredId = CHELATED_TRACE_PREFERRED_IDS[traceElement];
      return !availableIds.has(preferredId);
    }

    if (
      profile.tracePreference !== "any" &&
      fertilizerId === BORAX_FALLBACK_ID &&
      availableIds.has(PREFERRED_BORON_FERTILIZER_ID)
    ) {
      return false;
    }

    if (isPreferredChelatedTrace(fertilizerId) && variable.bucket === "A") {
      return !variables.some((item) =>
        item.bucket === "B" &&
        item.fertilizer.id === fertilizerId
      );
    }

    return true;
  });
}

function getReverseDesignPH(profile = null) {
  const targetPH = state.targets.pH;
  if (typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0) {
    return profile?.phFloor ? Math.max(targetPH, profile.phFloor) : targetPH;
  }
  const waterPH = state.water.pH;
  if (typeof waterPH === "number" && Number.isFinite(waterPH) && waterPH > 0) {
    return profile?.phFloor ? Math.max(waterPH, profile.phFloor) : waterPH;
  }
  return profile?.phFloor ? Math.max(DEFAULT_TARGET_PH, profile.phFloor) : DEFAULT_TARGET_PH;
}

function getEffectivePHTarget(profile = null) {
  const targetPH = state.targets.pH;
  if (!(typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0)) {
    return null;
  }
  return profile?.phFloor ? Math.max(targetPH, profile.phFloor) : targetPH;
}

function selectPreferredIronChelateId(availableIds, pH, profile = null) {
  const availableOptions = IRON_CHELATE_OPTIONS.filter((option) => availableIds.has(option.id));
  if (!availableOptions.length) return null;

  if (profile?.ironStrategy === "high-ph" && availableIds.has("eddha-fe-6")) {
    return "eddha-fe-6";
  }

  const inRange = availableOptions.filter((option) => pH >= option.minPH && pH <= option.maxPH);
  if (inRange.length) {
    if (pH <= 6.5) {
      return findFirstAvailableIronId(inRange, ["edta-fe-13", "dtpa-fe-11", "eddha-fe-6"]);
    }
    if (pH <= 7.5) {
      return findFirstAvailableIronId(inRange, ["dtpa-fe-11", "eddha-fe-6", "edta-fe-13"]);
    }
    return findFirstAvailableIronId(inRange, ["eddha-fe-6", "dtpa-fe-11", "edta-fe-13"]);
  }

  return findFirstAvailableIronId(availableOptions, ["eddha-fe-6", "dtpa-fe-11", "edta-fe-13"]);
}

function findFirstAvailableIronId(options, orderedIds) {
  const optionIds = new Set(options.map((option) => option.id));
  return orderedIds.find((id) => optionIds.has(id)) ?? options[0]?.id ?? null;
}

function isIronChelate(fertilizerId) {
  return IRON_CHELATE_OPTIONS.some((option) => option.id === fertilizerId);
}

function getTraceSulfateElement(fertilizerId) {
  return Object.entries(TRACE_SULFATE_FALLBACK_IDS)
    .find(([, id]) => id === fertilizerId)?.[0] ?? null;
}

function isPreferredChelatedTrace(fertilizerId) {
  return Object.values(CHELATED_TRACE_PREFERRED_IDS).includes(fertilizerId);
}

function getReverseTargetElements() {
  const hasSpecificNitrogen =
    typeof state.targets["NO3-N"] === "number" ||
    typeof state.targets["NH4-N"] === "number";
  const nitrogenKeys = hasSpecificNitrogen ? ["NO3-N", "NH4-N"] : ["N"];
  return [...nitrogenKeys, "P", "K", "Ca", "Mg", "S", "Cl", "Fe", "Mn", "Zn", "B", "Cu", "Mo"];
}

function isTraceSulfateFertilizer(fertilizerId) {
  return Object.values(TRACE_SULFATE_FALLBACK_IDS).includes(fertilizerId);
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
  return MARKET_PRICE_BY_FERTILIZER[fertilizerId] ?? DEFAULT_FERTILIZER_PRICE;
}

function normalizedFertilizerPrice(fertilizerId) {
  return getFertilizerPrice(fertilizerId) / AVERAGE_FERTILIZER_PRICE;
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
  const phTarget = getEffectivePHTarget(profile);
  const phAssessment = assessPHDeviation(phValue, phTarget);
  const phDeviation = typeof phTarget === "number" && Number.isFinite(phTarget) && phTarget > 0
    ? {
        key: "pH",
        actual: phValue,
        target: phTarget,
        ratio: (phValue - phTarget) / phTarget,
        delta: phValue - phTarget,
        cls: phAssessment?.cls || deviationClass((phValue - phTarget) / phTarget, "pH")
      }
    : null;
  const trackedKeys = getReverseTargetElements();
  const deviations = trackedKeys
    .filter((key) => typeof state.targets[key] === "number" && state.targets[key] > 0)
    .map((key) => {
      const actual = totalMmol[key] ?? 0;
      const target = state.targets[key];
      const ratio = (actual - target) / target;
      if (key === "NH4-N") {
        const totalNitrogen = (totalMmol["NO3-N"] ?? 0) + (totalMmol["NH4-N"] ?? 0);
        const share = totalNitrogen > 0 ? actual / totalNitrogen : 0;
        return {
          key,
          actual,
          target,
          ratio,
          nh4Share: share,
          displayText: `NH4-N 占N ${formatNumber(share * 100)}%`,
          cls: nh4ShareClass(actual, share)
        };
      }
      return { key, actual, target, ratio, cls: deviationClass(ratio, key) };
    });

  const estimatedCost = calculateSuggestionCost(bucketA, bucketB);
  const costScore = profile.costPenalty ? Math.min(estimatedCost / 180, 3) : 0;
  const score = deviations.reduce((sum, item) => {
    return sum + reverseDeviationScore(item);
  }, 0) +
    (phAssessment?.penalty ?? 0) +
    (bucketA.length + bucketB.length) * 0.04 +
    nitricAcidRegulatoryScore(bucketA, bucketB) +
    preferenceAcidScore(profile, bucketA, bucketB) +
    learnedFormulaPreferenceScore(profile, bucketA, bucketB) +
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
    phLimit: phAssessment,
    estimatedCost,
    score
  };
}

function learnedPreferenceMultiplier(profile, fertilizerId) {
  const preference = profile.learnedPreferences?.get(fertilizerId) || 0;
  return Math.max(0.7, Math.min(1.25, 1 - preference * 0.3));
}

function learnedFormulaPreferenceScore(profile, bucketA, bucketB) {
  const rows = [...bucketA, ...bucketB];
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount) || 0), 0) || 1;
  return rows.reduce((score, row) => {
    const preference = profile.learnedPreferences?.get(row.fertilizerId) || 0;
    return score - preference * Math.min((Number(row.amount) || 0) / total, 0.5) * 0.8;
  }, 0);
}

function nitricAcidRegulatoryScore(bucketA, bucketB) {
  return [...bucketA, ...bucketB].reduce((sum, row) => {
    if (row.fertilizerId !== "hno3-40") return sum;
    return sum + (Number(row.amount) || 0) * NITRIC_ACID_REGULATORY_PENALTY_PER_KG;
  }, 0);
}

function preferenceAcidScore(profile, bucketA, bucketB) {
  const acidPenalty = profile.acidPenalty || {};
  return [...bucketA, ...bucketB].reduce((sum, row) => {
    const amount = Number(row.amount) || 0;
    if (row.fertilizerId === "hno3-40") return sum + amount * (acidPenalty.nitric || 0);
    if (row.fertilizerId === "h3po4-85") return sum + amount * (acidPenalty.phosphoric || 0);
    return sum;
  }, 0);
}

function reverseDeviationScore(item) {
  if (item.key === "NH4-N") return nh4ShareScore(item.actual, item.nh4Share);
  const thresholds = reverseDeviationThresholds(item.key);
  if (thresholds.freeUndershoot && item.ratio <= 0) return 0;
  if (item.ratio >= thresholds.safeLow && item.ratio <= thresholds.safeHigh) return 0;

  const excess = item.ratio < thresholds.safeLow
    ? thresholds.safeLow - item.ratio
    : item.ratio - thresholds.safeHigh;
  const warnSpan = item.ratio < thresholds.safeLow
    ? thresholds.safeLow - thresholds.warnLow
    : thresholds.warnHigh - thresholds.safeHigh;

  if (warnSpan > 0 && excess <= warnSpan) {
    return Math.min(excess / warnSpan, 1);
  }
  return 1 + Math.min((excess - warnSpan) / 0.25, 4);
}

function nh4ShareLimits() {
  return state.cropType === "tomato" ? NH4_SHARE_LIMITS.tomato : NH4_SHARE_LIMITS.default;
}

function nh4ShareClass(actual, share) {
  if (!(actual > 0)) return "dev-bad";
  const limits = nh4ShareLimits();
  if (share > limits.bad) return "dev-bad";
  if (share > limits.warn) return "dev-warn";
  return "dev-good";
}

function nh4ShareScore(actual, share) {
  if (!(actual > 0)) return 4;
  const limits = nh4ShareLimits();
  if (share <= limits.warn) return 0;
  if (share <= limits.bad) return (share - limits.warn) / (limits.bad - limits.warn);
  return 1 + Math.min((share - limits.bad) / 0.1, 4);
}

function reverseDeviationBand(item) {
  const thresholds = reverseDeviationThresholds(item.key);
  if (thresholds.freeUndershoot && item.ratio <= 0) return "dev-good";
  if (item.ratio >= thresholds.safeLow && item.ratio <= thresholds.safeHigh) return "dev-good";
  if (item.ratio >= thresholds.warnLow && item.ratio <= thresholds.warnHigh) return "dev-warn";
  return "dev-bad";
}

function reverseDeviationThresholds(key) {
  if (TRACE_FERTILIZER_KEYS.has(key)) {
    return {
      safeLow: -0.10,
      safeHigh: 0.15,
      warnLow: -0.20,
      warnHigh: 0.25,
      freeUndershoot: false
    };
  }

  return {
    safeLow: -0.15,
    safeHigh: 0.15,
    warnLow: -0.25,
    warnHigh: 0.25,
    freeUndershoot: UNDERSHOOT_ALLOWED_KEYS.has(key)
  };
}

function assessPHDeviation(phValue, phTarget) {
  if (!(Number.isFinite(phValue) && Number.isFinite(phTarget) && phTarget > 0)) return null;
  const delta = phValue - phTarget;
  const absDelta = Math.abs(delta);
  if (absDelta > PH_TARGET_REJECT_DELTA) {
    return {
      cls: "dev-bad",
      text: `pH 偏离目标 ${formatSigned(delta)}，超过 ${PH_TARGET_REJECT_DELTA.toFixed(1)}，需调酸复核`,
      penalty: 8 + Math.min((absDelta - PH_TARGET_REJECT_DELTA) / 0.4, 4)
    };
  }
  if (absDelta > PH_TARGET_WARN_DELTA) {
    return {
      cls: "dev-warn",
      text: `pH 偏离目标 ${formatSigned(delta)}，超过 ${PH_TARGET_WARN_DELTA.toFixed(1)}`,
      penalty: 2 + Math.min((absDelta - PH_TARGET_WARN_DELTA) / (PH_TARGET_REJECT_DELTA - PH_TARGET_WARN_DELTA), 1) * 4
    };
  }
  if (absDelta > PH_TARGET_SAFE_DELTA) {
    return {
      cls: "dev-good",
      penalty: Math.min((absDelta - PH_TARGET_SAFE_DELTA) / (PH_TARGET_WARN_DELTA - PH_TARGET_SAFE_DELTA), 1)
    };
  }
  return { cls: "dev-good", penalty: 0 };
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function calculateSuggestionCost(bucketA, bucketB) {
  return [...bucketA, ...bucketB].reduce((sum, row) => {
    return sum + (Number(row.amount) || 0) * getFertilizerPrice(row.fertilizerId);
  }, 0);
}

function applyPHTargetAdjustment(profile, bucketA, bucketB) {
  const targetPH = getEffectivePHTarget(profile);
  if (!(typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0)) return;

  const currentPH = estimateSuggestionPH(bucketA, bucketB);
  if (!Number.isFinite(currentPH) || currentPH <= targetPH + 0.03) return;

  const candidates = [
    { fertilizerId: "h3po4-85", bucket: "B" },
    { fertilizerId: "hno3-40", bucket: "A" }
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

    let adjustedAmount = high <= 20
      ? findAcidAmountForTargetPH(candidate, rows, bucketA, bucketB, baseAmount, high, targetPH)
      : findMaxSafeAcidAmount(candidate, rows, baseAmount);
    adjustedAmount = capAcidAdjustmentAmount(candidate, adjustedAmount);
    if (!(adjustedAmount > baseAmount)) continue;

    let adjustedRows = withAdjustedFertilizer(rows, candidate.fertilizerId, adjustedAmount);
    let adjustedBucketA = candidate.bucket === "A" ? adjustedRows : bucketA;
    let adjustedBucketB = candidate.bucket === "B" ? adjustedRows : bucketB;
    let stockPH = estimateBucketStockPH(candidate.bucket, adjustedRows);
    if (!Number.isFinite(stockPH) || stockPH < MIN_AUTO_ACID_STOCK_PH) {
      adjustedAmount = findMaxSafeAcidAmount(candidate, rows, baseAmount);
      if (!(adjustedAmount > baseAmount)) continue;
      adjustedRows = withAdjustedFertilizer(rows, candidate.fertilizerId, adjustedAmount);
      adjustedBucketA = candidate.bucket === "A" ? adjustedRows : bucketA;
      adjustedBucketB = candidate.bucket === "B" ? adjustedRows : bucketB;
      stockPH = estimateBucketStockPH(candidate.bucket, adjustedRows);
    }
    if (!Number.isFinite(stockPH) || stockPH < MIN_AUTO_ACID_STOCK_PH) continue;

    const finalPH = estimateSuggestionPH(adjustedBucketA, adjustedBucketB);
    if (!Number.isFinite(finalPH) || finalPH >= currentPH - 0.02) continue;
    const cost = Math.abs(finalPH - targetPH) +
      Math.max(0, Math.abs(finalPH - targetPH) - PH_TARGET_SAFE_DELTA) * 2 +
      Math.max(0, MIN_AUTO_ACID_STOCK_PH + 0.4 - stockPH) * 0.5 +
      acidAdjustmentNutrientPenalty(adjustedBucketA, adjustedBucketB) +
      nitricAcidRegulatoryScore(adjustedBucketA, adjustedBucketB);
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

  applySupplementalPhosphoricAcid(profile, bucketA, bucketB);
}

function applySupplementalPhosphoricAcid(profile, bucketA, bucketB) {
  const targetPH = getEffectivePHTarget(profile);
  const targetP = state.targets.P;
  if (!(typeof targetPH === "number" && Number.isFinite(targetPH) && targetPH > 0)) return;
  if (!(typeof targetP === "number" && Number.isFinite(targetP) && targetP > 0)) return;
  if (!state.inventory["h3po4-85"] || profile.exclude.includes("h3po4-85")) return;

  const current = summarizeAcidAdjustment(bucketA, bucketB);
  if (!Number.isFinite(current.pH) || current.pH <= targetPH + 0.03) return;
  if (!Number.isFinite(current.total.P) || current.total.P >= targetP * 1.15) return;

  const existing = bucketB.find((row) => row.fertilizerId === "h3po4-85");
  const baseAmount = existing?.unit === "kg" ? existing.amount : 0;
  const maxAmount = acidMmolToKg(
    "h3po4-85",
    "B",
    getPhosphoricPrefeedLimit(
      estimateAlkalinityAcidDemand(),
      getNitricAcidNutrientSpace(),
      getTargetNutrientSpace("P")
    )
  );
  if (!(maxAmount > baseAmount)) return;
  let high = Math.max(baseAmount + 0.05, 0.05);
  let bestAmount = baseAmount;

  for (let i = 0; i < 18 && high <= Math.min(20, maxAmount); i++) {
    const candidateRows = withAdjustedFertilizer(bucketB, "h3po4-85", high);
    const candidate = summarizeAcidAdjustment(bucketA, candidateRows);
    if (
      !Number.isFinite(candidate.pH) ||
      !Number.isFinite(candidate.stockBPH) ||
      candidate.stockBPH < MIN_AUTO_ACID_STOCK_PH ||
      candidate.total.P > targetP * 1.15
    ) break;

    bestAmount = high;
    if (candidate.pH <= targetPH + PH_TARGET_SAFE_DELTA) break;
    high = Math.min(maxAmount, high * 2);
  }

  let low = bestAmount;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const candidateRows = withAdjustedFertilizer(bucketB, "h3po4-85", mid);
    const candidate = summarizeAcidAdjustment(bucketA, candidateRows);
    const valid = Number.isFinite(candidate.pH) &&
      Number.isFinite(candidate.stockBPH) &&
      candidate.stockBPH >= MIN_AUTO_ACID_STOCK_PH &&
      candidate.total.P <= targetP * 1.15;
    if (valid) {
      low = mid;
    } else {
      high = mid;
    }
  }

  let adjustedAmount = Math.floor(low * 1000) / 1000;
  while (adjustedAmount > baseAmount) {
    const candidate = summarizeAcidAdjustment(bucketA, withAdjustedFertilizer(bucketB, "h3po4-85", adjustedAmount));
    if (Number.isFinite(candidate.total.P) && candidate.total.P <= targetP * 1.15) break;
    adjustedAmount = Number((adjustedAmount - 0.001).toFixed(3));
  }
  if (adjustedAmount <= baseAmount) return;

  const adjustedRows = withAdjustedFertilizer(bucketB, "h3po4-85", adjustedAmount);
  const adjusted = summarizeAcidAdjustment(bucketA, adjustedRows);
  if (!Number.isFinite(adjusted.pH) || adjusted.pH >= current.pH - 0.02) return;

  bucketB.splice(0, bucketB.length, ...adjustedRows);
}

function summarizeAcidAdjustment(bucketA, bucketB) {
  const aResult = calculateBucket(bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
  const bResult = calculateBucket(bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));
  const total = buildTotalMmol(aResult, bResult);
  const acidProfile = buildTotalAcidProfile(aResult, bResult);
  return {
    total,
    pH: calculatePH(total, acidProfile),
    stockBPH: estimateBucketStockPH("B", bucketB)
  };
}

function acidAdjustmentNutrientPenalty(bucketA, bucketB) {
  const aResult = calculateBucket(bucketA, getNumericField("aTankVolume"), getNumericField("aDilution"));
  const bResult = calculateBucket(bucketB, getNumericField("bTankVolume"), getNumericField("bDilution"));
  const totalMmol = buildTotalMmol(aResult, bResult);
  return ["NO3-N", "NH4-N", "N", "P", "K", "Ca", "Mg", "S"].reduce((sum, key) => {
    const target = state.targets[key];
    if (!(typeof target === "number" && Number.isFinite(target) && target > 0)) return sum;
    if (key === "NH4-N") {
      const totalNitrogen = (totalMmol["NO3-N"] ?? 0) + (totalMmol["NH4-N"] ?? 0);
      const share = totalNitrogen > 0 ? (totalMmol["NH4-N"] ?? 0) / totalNitrogen : 0;
      return sum + nh4ShareScore(totalMmol["NH4-N"] ?? 0, share) * 2;
    }
    if (UNDERSHOOT_ALLOWED_KEYS.has(key) && (totalMmol[key] ?? 0) <= target) return sum;
    const ratio = ((totalMmol[key] ?? 0) - target) / target;
    return sum + reverseDeviationScore({ key, ratio }) * 2;
  }, 0);
}

function findAcidAmountForTargetPH(candidate, rows, bucketA, bucketB, low, high, targetPH) {
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
  return roundAmount(high);
}

function capAcidAdjustmentAmount(candidate, amount) {
  if (candidate.fertilizerId !== "h3po4-85") return amount;
  const acidDemand = estimateAlkalinityAcidDemand();
  const limitMmol = getPhosphoricPrefeedLimit(
    acidDemand,
    getNitricAcidNutrientSpace(),
    getTargetNutrientSpace("P")
  );
  if (!(limitMmol > 0)) return 0;
  return Math.min(amount, acidMmolToKg("h3po4-85", "B", limitMmol));
}

function findMaxSafeAcidAmount(candidate, rows, baseAmount) {
  let low = baseAmount;
  let high = Math.max(baseAmount + 0.05, 0.05);
  while (high <= 20) {
    const stockPH = estimateBucketStockPH(candidate.bucket, withAdjustedFertilizer(rows, candidate.fertilizerId, high));
    if (!Number.isFinite(stockPH) || stockPH < MIN_AUTO_ACID_STOCK_PH) break;
    low = high;
    high *= 2;
  }

  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2;
    const stockPH = estimateBucketStockPH(candidate.bucket, withAdjustedFertilizer(rows, candidate.fertilizerId, mid));
    if (Number.isFinite(stockPH) && stockPH >= MIN_AUTO_ACID_STOCK_PH) {
      low = mid;
    } else {
      high = mid;
    }
  }

  let safeAmount = roundAmount(low);
  while (safeAmount > baseAmount) {
    const stockPH = estimateBucketStockPH(
      candidate.bucket,
      withAdjustedFertilizer(rows, candidate.fertilizerId, safeAmount)
    );
    if (Number.isFinite(stockPH) && stockPH >= MIN_AUTO_ACID_STOCK_PH) return safeAmount;
    const step = safeAmount >= 1 ? 0.01 : 0.001;
    safeAmount = Number(Math.max(baseAmount, safeAmount - step).toFixed(3));
  }

  return baseAmount;
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
      <span class="muted">采用方案后可在 A/B 桶继续微调，再导出当前配方</span>
    </div>
    <div class="suggestion-grid">
      ${suggestions.map((suggestion, index) => renderSuggestionCard(suggestion, index)).join("")}
    </div>
  `;

  reverseSuggestionsEl.querySelectorAll("[data-apply-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.applySuggestion);
      applyReverseSuggestion(suggestions[index], index);
    });
  });
}

function renderSuggestionCard(suggestion, index) {
  const isSelected = state.selectedReverseIndex === index;
  const mainDeviations = suggestion.deviations
    .filter((item) => ["NO3-N", "NH4-N", "N", "P", "K", "Ca", "Mg", "S", "Cl"].includes(item.key))
    .slice(0, 7)
    .map((item) => `<span class="${item.cls}">${item.displayText || `${item.key} ${formatDeviation(item.ratio)}`}</span>`)
    .join(" · ");
  const phText = suggestion.phDeviation
    ? ` · <span class="${suggestion.phDeviation.cls}">pH ${suggestion.phDeviation.delta >= 0 ? "+" : ""}${suggestion.phDeviation.delta.toFixed(2)}</span>`
    : "";
  const phLimitText = suggestion.phLimit?.text
    ? ` · <span class="${suggestion.phLimit.cls}">${suggestion.phLimit.text}</span>`
    : "";

  return `
    <div class="suggestion-card${isSelected ? " is-selected" : ""}">
      <h4>
        <span>${suggestion.name}</span>
        <span>${Math.max(0, Math.round(100 - suggestion.score * 8))}分</span>
      </h4>
      <div class="suggestion-meta">
        ${suggestion.note}<br>
        EC ${formatNumber(suggestion.ec)} uS/cm · pH ${suggestion.pH.toFixed(2)}（估算，受水温、CO2逸出速度等影响） · 估算原料 ¥${formatCurrency(suggestion.estimatedCost)}<br>
        ${mainDeviations || "目标偏差待计算"}${phText}${phLimitText}
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
    : [];
  state.bucketB = suggestion.bucketB.length
    ? suggestion.bucketB.map((row) => ({ ...row, id: crypto.randomUUID() }))
    : [];

  renderBucket("A");
  renderBucket("B");
  updateBucketGridVisibility();
  positionModePanels();

  if (APP_MODE === 2) {
    document.querySelectorAll("#bucketGrid .module-panel").forEach((panel) => {
      setModuleCollapsed(panel, false);
    });
    setModuleCollapsed(document.getElementById("formulaExportPanel"), false);
    showMode2CalculationResult(true);
    renderCurrentCalculation();
    renderReverseSuggestions(state.reverseSuggestions);
    setStatus(`已采用「${suggestion.name}」，可继续点其他方案比较`, 2500);
    return;
  }

  clearTimeout(recalcTimer);
  recalculateNow();
  setStatus(`已采用「${suggestion.name}」`, 2500);
}

function clearReverseSelection() {
  state.selectedReverseIndex = null;
  updateBucketGridVisibility();
  positionModePanels();
}

function showMode2CalculationResult(visible) {
  ["tableWrap", "resultGrid"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  });
}

function setModuleCollapsed(panel, collapsed) {
  if (!panel) return;
  panel.classList.toggle("is-collapsed", collapsed);
  const toggle = panel.querySelector("[data-module-toggle]");
  if (toggle) {
    toggle.textContent = collapsed ? "展开" : "收起";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
}

function bindCollapsibleModules() {
  document.querySelectorAll("[data-module-toggle]").forEach((button) => {
    const panel = button.closest(".module-panel");
    if (!panel) return;
    button.setAttribute("aria-expanded", String(!panel.classList.contains("is-collapsed")));
    button.addEventListener("click", () => {
      setModuleCollapsed(panel, !panel.classList.contains("is-collapsed"));
    });
  });
}

function openModeModules(mode) {
  document.querySelectorAll(".module-panel").forEach((panel) => {
    setModuleCollapsed(panel, true);
  });

  const modeModules = mode === 1
    ? ["resultsSection", "calibrationSection"]
    : mode === 2
      ? ["resultsSection"]
      : mode === 3
        ? ["mode3ResultsSection"]
        : [];

  modeModules.forEach((id) => {
    setModuleCollapsed(document.getElementById(id), false);
  });

  if (mode === 1) {
    document.querySelectorAll("#bucketGrid .module-panel").forEach((panel) => {
      setModuleCollapsed(panel, false);
    });
    setModuleCollapsed(document.getElementById("formulaExportPanel"), false);
  } else if (mode === 2 && state.selectedReverseIndex != null) {
    document.querySelectorAll("#bucketGrid .module-panel").forEach((panel) => {
      setModuleCollapsed(panel, false);
    });
    setModuleCollapsed(document.getElementById("formulaExportPanel"), false);
  } else if (mode === 3 && state.selectedSoilIndex != null) {
    setModuleCollapsed(document.getElementById("formulaExportPanel"), false);
  }
}

function updateBucketGridVisibility() {
  const bucketGrid = document.getElementById("bucketGrid");
  const formulaExportPanel = document.getElementById("formulaExportPanel");
  if (!bucketGrid) return;
  const shouldShow = APP_MODE === 1 || (APP_MODE === 2 && state.selectedReverseIndex != null);
  bucketGrid.style.display = shouldShow ? "" : "none";
  if (formulaExportPanel) {
    const showExport = APP_MODE === 1 ||
      (APP_MODE === 2 && state.selectedReverseIndex != null) ||
      (APP_MODE === 3 && state.selectedSoilIndex != null);
    formulaExportPanel.style.display = showExport ? "" : "none";
  }
  renderFormulaAdjustmentEditor();
}

function positionModePanels() {
  const bucketGrid = document.getElementById("bucketGrid");
  const formulaExportPanel = document.getElementById("formulaExportPanel");
  const mode2TargetSection = document.getElementById("mode2TargetSection");
  const resultsSection = document.getElementById("resultsSection");
  const reverseSuggestions = document.getElementById("reverseSuggestions");
  const resultGrid = document.getElementById("resultGrid");
  const mode3ResultsSection = document.getElementById("mode3ResultsSection");
  if (!bucketGrid || !formulaExportPanel || !mode2TargetSection || !resultsSection) return;

  if (APP_MODE === 2) {
    if (reverseSuggestions) reverseSuggestions.after(bucketGrid);
    if (resultGrid) resultGrid.before(formulaExportPanel);
  } else if (APP_MODE === 3) {
    if (mode3ResultsSection) mode3ResultsSection.after(formulaExportPanel);
  } else {
    mode2TargetSection.before(bucketGrid);
    bucketGrid.after(formulaExportPanel);
  }
}

function clearMode2CalculationResult() {
  if (APP_MODE !== 2) return;
  showMode2CalculationResult(false);
  if (irrigationBody) irrigationBody.innerHTML = "";
  if (elementTotalsGrid) elementTotalsGrid.innerHTML = "";
  if (precipList) precipList.innerHTML = "";
}

// 本地打开页面时直连后端；线上部署时让 /api 走同源反代。
const API_BASE = (() => {
  const host = window.location.hostname;
  const isLocalPage = window.location.protocol === "file:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "";
  return isLocalPage ? "http://127.0.0.1:8765" : "";
})();

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

const SOIL_FORMULA_PROFILES = [
  {
    id: "natural-acid",
    name: "天然酸性优先",
    note: "磷酸脲配合硝酸钾，尽量保留硫酸铵的生理酸性作用",
    sources: ["urea-phosphate", "kno3", "k2so4", "urea"],
    ammoniumNShare: 0.25
  },
  {
    id: "kh2po4",
    name: "磷酸二氢钾优先",
    note: "以 KH₂PO₄ 同时供应磷钾，配方直观、低氯",
    sources: ["kh2po4", "k2so4", "urea", "kno3"],
    ammoniumNShare: 0.20
  },
  {
    id: "economy",
    name: "经济简洁方案",
    note: "优先减少成本与原料品种；允许氯时可采用氯化钾",
    sources: ["kh2po4", "kcl", "kno3", "urea", "k2so4"]
  }
];

function getSoilInput(id) {
  return Math.max(0, Number(document.getElementById(id)?.value) || 0);
}

function soilNpkContent(fertilizer) {
  const content = { N: 0, p2o5: 0, k2o: 0, S: 0, Cl: 0 };
  fertilizer.compounds.forEach((compound) => {
    if (["N", "NO3-N", "NH4-N"].includes(compound.element)) content.N += compound.percent;
    if (compound.element === "P") content.p2o5 += compound.percent * P_TO_P2O5_FACTOR;
    if (compound.element === "K") content.k2o += compound.percent * K_TO_K2O_FACTOR;
    if (compound.element === "S") content.S += compound.percent;
    if (compound.element === "Cl") content.Cl += compound.percent;
  });
  return content;
}

function getSoilFertilizerBucket(fertilizer) {
  const elements = new Set(fertilizer.compounds.map((compound) => compound.element));
  const hasCalcium = elements.has("Ca");
  const hasSulfateOrPhosphate = elements.has("S") || elements.has("P");
  if (hasCalcium && hasSulfateOrPhosphate) return null;
  if (hasCalcium) return "A";
  if (hasSulfateOrPhosphate) return "B";
  return "A";
}

function generateSoilFormulas() {
  const targets = {
    N: getSoilInput("soilTargetN"),
    p2o5: getSoilInput("soilTargetP2O5"),
    k2o: getSoilInput("soilTargetK2O")
  };
  const batch = getSoilInput("soilBatchWeight");
  const applicationRate = getSoilInput("soilApplicationRate");
  const chloridePreference = document.getElementById("soilChloridePreference")?.value || "avoid";
  const status = document.getElementById("soilFormulaStatus");
  const root = document.getElementById("soilFormulaSuggestions");
  const resultsPanel = document.getElementById("mode3ResultsSection");
  if (!root || !status) return;

  if (!batch || !applicationRate || !(targets.N + targets.p2o5 + targets.k2o)) {
    state.soilSuggestions = [];
    state.selectedSoilIndex = null;
    state.soilAdjustedRows = [];
    updateBucketGridVisibility();
    root.innerHTML = "";
    status.textContent = "请填写配制总量、每吨水施肥量和至少一个 NPK 目标。";
    if (resultsPanel) resultsPanel.style.display = "none";
    return;
  }

  if (resultsPanel) {
    resultsPanel.style.display = "";
    setModuleCollapsed(resultsPanel, false);
  }

  const learnedPreferences = getLearnedFertilizerPreferences(3);
  const suggestions = SOIL_FORMULA_PROFILES
    .map((profile) => solveSoilFormula(profile, targets, batch, applicationRate, chloridePreference))
    .filter(Boolean)
    .sort((a, b) => soilLearnedPreferenceScore(b, learnedPreferences) - soilLearnedPreferenceScore(a, learnedPreferences));

  if (!suggestions.length) {
    state.soilSuggestions = [];
    state.selectedSoilIndex = null;
    state.soilAdjustedRows = [];
    updateBucketGridVisibility();
    root.innerHTML = "";
    status.textContent = "当前原水、投肥量与原料约束下，没有方案能进入目标 ±20% 范围。请调整目标、提高投肥量或开放含氯方案。";
    return;
  }

  const sourceText = state.lastWaterSource ? ` · 原水：${state.lastWaterSource}` : " · 原水：手动录入";
  state.soilSuggestions = suggestions;
  state.selectedSoilIndex = null;
  state.soilAdjustedRows = [];
  updateBucketGridVisibility();
  status.textContent = `目标 ${formatSoilGrade(targets)} · ${formatNumber(applicationRate)} kg肥/吨水 · 按 ${formatNumber(batch)} kg 配制${sourceText}`;
  root.innerHTML = suggestions.map((suggestion, index) => renderSoilFormulaCard(suggestion, index)).join("");
  root.querySelectorAll("[data-apply-soil-suggestion]").forEach((button) => {
    button.addEventListener("click", () => applySoilSuggestion(Number(button.dataset.applySoilSuggestion)));
  });
}

function soilLearnedPreferenceScore(suggestion, preferences) {
  const total = suggestion.rows.reduce((sum, row) => sum + row.amount, 0) || 1;
  return suggestion.rows.reduce((score, row) =>
    score + (preferences.get(row.fertilizer.id) || 0) * Math.min(row.amount / total, 0.5), 0);
}

function getRawWaterNpkKg(batch, applicationRate) {
  const waterTonnes = batch / applicationRate;
  const totalN = state.water.N > 0
    ? state.water.N
    : (state.water["NO3-N"] || 0) + (state.water["NH4-N"] || 0);
  return {
    N: totalN * waterTonnes * 0.001,
    p2o5: (state.water.P || 0) * P_TO_P2O5_FACTOR * waterTonnes * 0.001,
    k2o: (state.water.K || 0) * K_TO_K2O_FACTOR * waterTonnes * 0.001
  };
}

function solveSoilFormula(profile, targets, batch, applicationRate, chloridePreference) {
  const preferredShare = Math.max(0, Number(profile.ammoniumNShare) || 0);
  const candidateShares = preferredShare > 0
    ? [1, 0.75, 0.5, 0.25, 0].map((ratio) => preferredShare * ratio)
    : [0];
  for (const ammoniumNShare of candidateShares) {
    const suggestion = solveSoilFormulaAtAmmoniumShare(
      profile, targets, batch, applicationRate, chloridePreference, ammoniumNShare
    );
    if (suggestion) return suggestion;
  }
  return null;
}

function solveSoilFormulaAtAmmoniumShare(
  profile, targets, batch, applicationRate, chloridePreference, ammoniumNShare
) {
  let sourceIds = [...profile.sources];
  if (chloridePreference === "avoid") sourceIds = sourceIds.filter((id) => id !== "kcl");
  const rawWaterKg = getRawWaterNpkKg(batch, applicationRate);
  const targetKg = [
    Math.max(0, targets.N * batch / 100 - rawWaterKg.N),
    Math.max(0, targets.p2o5 * batch / 100 - rawWaterKg.p2o5),
    Math.max(0, targets.k2o * batch / 100 - rawWaterKg.k2o)
  ];
  const fixedRows = [];
  if (ammoniumNShare > 0 && targetKg[0] > 0) {
    const fertilizer = getFertilizer("ammonium-sulfate");
    const nitrogenFraction = soilNpkContent(fertilizer).N / 100;
    const amount = targetKg[0] * ammoniumNShare / nitrogenFraction;
    fixedRows.push({ fertilizer, amount });
    targetKg[0] -= amount * nitrogenFraction;
  }
  const sources = sourceIds.map(getFertilizer);
  const matrix = ["N", "p2o5", "k2o"].map((key) =>
    sources.map((fertilizer) => soilNpkContent(fertilizer)[key] / 100)
  );
  const solution = solveNonNegativeLeastSquares(matrix, targetKg);
  if (!solution) return null;

  const rows = fixedRows.concat(solution
    .map((amount, index) => ({ fertilizer: sources[index], amount: Math.max(0, amount) }))
    .filter((row) => row.amount >= 0.005))
    .map((row) => ({ ...row, bucket: getSoilFertilizerBucket(row.fertilizer) }));
  if (rows.some((row) => !row.bucket)) return null;
  const used = rows.reduce((sum, row) => sum + row.amount, 0);
  if (used > batch + 0.05) return null;

  const actualKg = {
    N: rawWaterKg.N,
    p2o5: rawWaterKg.p2o5,
    k2o: rawWaterKg.k2o,
    S: 0,
    Cl: 0
  };
  rows.forEach((row) => {
    const content = soilNpkContent(row.fertilizer);
    Object.keys(actualKg).forEach((key) => {
      actualKg[key] += row.amount * content[key] / 100;
    });
  });
  const actual = Object.fromEntries(
    Object.entries(actualKg).map(([key, value]) => [key, value / batch * 100])
  );
  const deviation = {};
  ["N", "p2o5", "k2o"].forEach((key) => {
    deviation[key] = targets[key] > 0 ? (actual[key] - targets[key]) / targets[key] : 0;
  });
  const maxDeviation = Math.max(...Object.values(deviation).map(Math.abs));
  if (maxDeviation > 0.200001) return null;

  const filler = Math.max(0, batch - used);
  const cost = rows.reduce((sum, row) => sum + row.amount * getFertilizerPrice(row.fertilizer.id), 0);
  const acidIndex = rows.reduce((sum, row) => {
    const factor = row.fertilizer.id === "ammonium-sulfate" ? 2
      : row.fertilizer.id === "urea-phosphate" ? 1.5
        : row.fertilizer.id === "kh2po4" ? 0.7
          : row.fertilizer.id === "urea" ? 0.35 : 0;
    return sum + row.amount * factor;
  }, 0) / batch;
  const acidTendency = acidIndex >= 0.35 ? "较强" : acidIndex >= 0.12 ? "中等" : "温和";

  const rawWaterGrade = Object.fromEntries(
    Object.entries(rawWaterKg).map(([key, value]) => [key, value / batch * 100])
  );
  return {
    ...profile,
    rows,
    filler,
    actual,
    deviation,
    rawWaterGrade,
    cost,
    acidTendency,
    batch,
    applicationRate
  };
}

function formatSoilGrade(values) {
  return `${formatNumber(values.N)}-${formatNumber(values.p2o5)}-${formatNumber(values.k2o)}`;
}

function renderSoilBucket(suggestion, bucket) {
  const bucketRows = suggestion.rows.filter((row) => row.bucket === bucket);
  const bucketWeight = bucketRows.reduce((sum, row) => sum + row.amount, 0);
  const dose = bucketWeight / suggestion.batch * suggestion.applicationRate;
  const title = bucket === "A" ? "A 桶 · 钙/氮组" : "B 桶 · 磷/硫/钾组";
  const items = bucketRows.length
    ? bucketRows.map((row) => `
        <tr><td>${escapeHtml(row.fertilizer.name)}</td><td>${formatNumber(row.amount)} kg</td></tr>
      `).join("")
    : '<tr><td colspan="2">本方案无需额外原料</td></tr>';
  return `
    <div class="suggestion-bucket">
      <b>${title}</b>
      <span class="muted">折合 ${formatNumber(dose)} kg/吨水</span>
      <table class="soil-formula-table">
        <thead><tr><th>原料</th><th>每批用量</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
    </div>
  `;
}

function renderSoilFormulaCard(suggestion, index) {
  const fillerText = suggestion.filler > 0.005
    ? `配方余量 ${formatNumber(suggestion.filler)} kg 由载体或母液水补足，不作为肥盐加入同一浓缩桶。`
    : "本方案无需载体余量。";
  const deviationText = [
    ["N", "N"],
    ["p2o5", "P₂O₅"],
    ["k2o", "K₂O"]
  ].map(([key, label]) => {
    const value = suggestion.deviation[key] * 100;
    return `${label} ${value >= 0 ? "+" : ""}${formatNumber(value)}%`;
  }).join(" · ");
  const rawWaterText = formatSoilGrade(suggestion.rawWaterGrade);
  const rawPhText = state.water.pH > 0 ? ` · 原水 pH ${formatNumber(state.water.pH)}` : "";
  return `
    <article class="suggestion-card${state.selectedSoilIndex === index ? " is-selected" : ""}">
      <h4><span>${escapeHtml(suggestion.name)}</span><span class="soil-grade">${formatSoilGrade(suggestion.actual)}</span></h4>
      <div class="suggestion-meta">${escapeHtml(suggestion.note)}</div>
      <div class="suggestion-buckets">
        ${renderSoilBucket(suggestion, "A")}
        ${renderSoilBucket(suggestion, "B")}
      </div>
      <div class="suggestion-meta">
        <b>A、B 浓缩液必须分开配制和注入。</b> ${fillerText}<br>
        偏差：<span class="soil-grade">${deviationText}</span><br>
        原水折算贡献 ${rawWaterText} · S ${formatNumber(suggestion.actual.S)}% · Cl ${formatNumber(suggestion.actual.Cl)}%<br>
        酸化倾向：${suggestion.acidTendency}${rawPhText} · 估算原料 ¥${formatCurrency(suggestion.cost)}
      </div>
      <button class="${state.selectedSoilIndex === index ? "btn-ghost" : "btn-a"}" type="button" data-apply-soil-suggestion="${index}">
        ${state.selectedSoilIndex === index ? "已采用，可在下方微调" : "采用并微调"}
      </button>
    </article>
  `;
}

function applySoilSuggestion(index) {
  const suggestion = state.soilSuggestions[index];
  if (!suggestion) return;
  state.selectedSoilIndex = index;
  state.soilAdjustedRows = suggestion.rows.map((row) => ({
    bucket: row.bucket,
    fertilizerId: row.fertilizer.id,
    amount: Number(row.amount) || 0
  }));
  const root = document.getElementById("soilFormulaSuggestions");
  if (root) {
    root.innerHTML = state.soilSuggestions.map((item, itemIndex) => renderSoilFormulaCard(item, itemIndex)).join("");
    root.querySelectorAll("[data-apply-soil-suggestion]").forEach((button) => {
      button.addEventListener("click", () => applySoilSuggestion(Number(button.dataset.applySoilSuggestion)));
    });
  }
  updateBucketGridVisibility();
  positionModePanels();
  renderFormulaAdjustmentEditor();
  setModuleCollapsed(document.getElementById("formulaExportPanel"), false);
  setStatus(`已采用「${suggestion.name}」，可微调用量后导出`, 2500);
}

function soilRowsToFormulaRows(rows) {
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    fertilizerId: row.fertilizerId,
    amount: Number(row.amount) || 0,
    unit: "kg"
  }));
}

function soilSuggestionToFormula(suggestion) {
  return {
    id: suggestion.id,
    name: suggestion.name,
    bucketA: soilRowsToFormulaRows(suggestion.rows.filter((row) => row.bucket === "A").map((row) => ({ ...row, fertilizerId: row.fertilizer.id }))),
    bucketB: soilRowsToFormulaRows(suggestion.rows.filter((row) => row.bucket === "B").map((row) => ({ ...row, fertilizerId: row.fertilizer.id })))
  };
}

function renderFormulaAdjustmentEditor() {
  const editor = document.getElementById("formulaAdjustmentEditor");
  const label = document.getElementById("formulaExportVolumeLabel");
  const description = document.getElementById("formulaExportDescription");
  if (!editor) return;
  if (APP_MODE !== 3 || state.selectedSoilIndex == null) {
    editor.innerHTML = "";
    if (label) label.textContent = "AB肥配制量";
    if (description) description.textContent = "确认 A/B 桶微调后的用量，导出当前配方并记录为后续推荐偏好";
    return;
  }
  if (label) label.textContent = "配方总量";
  if (description) description.textContent = "微调土壤配方各原料用量，导出后记录为后续推荐偏好";
  editor.innerHTML = `
    <div class="table-wrap">
      <table class="soil-formula-table">
        <thead><tr><th>桶</th><th>原料</th><th>每批用量 (kg)</th></tr></thead>
        <tbody>${state.soilAdjustedRows.map((row, index) => `
          <tr>
            <td>${escapeHtml(row.bucket)}</td>
            <td>${escapeHtml(getFertilizer(row.fertilizerId).name)}</td>
            <td><input data-soil-adjustment="${index}" type="number" min="0" step="0.01" value="${Number(row.amount).toFixed(4)}"></td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>`;
}

function syncSoilAdjustedRowsFromEditor() {
  document.querySelectorAll("[data-soil-adjustment]").forEach((input) => {
    const row = state.soilAdjustedRows[Number(input.dataset.soilAdjustment)];
    if (row) row.amount = Math.max(0, Number(input.value) || 0);
  });
}

function setMode(mode) {
  APP_MODE = mode;

  document.querySelector("#modeBtn1")?.classList.toggle("is-active", mode === 1);
  document.querySelector("#modeBtn2")?.classList.toggle("is-active", mode === 2);
  document.querySelector("#modeBtn3")?.classList.toggle("is-active", mode === 3);

  const isMode1 = mode === 1;
  const isMode2 = mode === 2;
  const isMode3 = mode === 3;
  const usesWater = isMode1 || isMode2 || isMode3;
  const showsLiquidResults = isMode1 || isMode2;

  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  };

  show("waterSection",        usesWater);
  show("importPanel",         isMode1);
  updateBucketGridVisibility();
  positionModePanels();
  renderFormulaAdjustmentEditor();
  show("mode2TargetSection",  isMode2);
  show("mode3SoilSection",    isMode3);
  show("mode3ResultsSection", isMode3 && state.soilSuggestions.length > 0);
  show("resultsSection",      showsLiquidResults);
  show("calibrationSection",  isMode1);

  show("resultsModeBar",   isMode1);
  show("targetDetails",    isMode1);
  show("inventoryDetails", isMode1);
  show("tableWrap",        isMode1);
  show("resultGrid",       isMode1);
  openModeModules(mode);

  const heroText = document.querySelector("#heroText");
  if (heroText) {
    if (isMode1) {
      heroText.innerHTML = '请上传最近一次灌溉用水成分分析报告，导入或手动配置 <span class="a-text">A 桶</span> 与 <span class="b-text">B 桶</span> 施肥配方。实时计算灌溉液元素浓度，可选填目标值查看偏差。';
    } else if (isMode2) {
      heroText.innerHTML = '请上传最近一次灌溉用水成分分析报告，设定各元素目标浓度，系统自动推荐 3 套施肥配方供选择。采用任一方案后可直接比较最终工作液浓度，再导出选中的配方。';
    } else if (isMode3) {
      heroText.innerHTML = '上传原水检测报告，以目标 N-P₂O₅-K₂O 百分比代替逐元素浓度，生成适合土壤种植的多套方案；最终结果允许 ±20% 偏差。';
    } else {
      heroText.textContent = "请选择适合当前任务的功能：核算已有施肥配方、按目标元素设计水肥配方，或按 N-P₂O₅-K₂O 生成土壤施肥方案。";
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
  if (usesWater) recalculate();
}

function bindModeEvents() {
  document.querySelector("#modeBtn1")?.addEventListener("click", () => setMode(1));
  document.querySelector("#modeBtn2")?.addEventListener("click", () => setMode(2));
  document.querySelector("#modeBtn3")?.addEventListener("click", () => setMode(3));
  document.querySelector("#generateSoilFormulas")?.addEventListener("click", generateSoilFormulas);

  document.querySelector("#targetFileM2")?.addEventListener("change", handleTargetUpload);

  targetPreset2?.addEventListener("change", (e) => {
    applyTargetPreset(e.target.value);
    if (targetPreset) targetPreset.value = e.target.value;
  });

  document.querySelector("#clearTargets2")?.addEventListener("click", () => {
    clearReverseSelection();
    clearTargets();
    resetTargetPresetSelects();
    renderTargetTable();
    recalculate();
  });
}
