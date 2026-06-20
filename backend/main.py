"""
FertiCal 本地后端
运行方式：python main.py
默认监听 http://127.0.0.1:8765
"""

import json
import os
import re
import sqlite3
from datetime import datetime
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 路径配置 ────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "..", "fertical.db")

# ── FastAPI 初始化 ───────────────────────────────────────────────────────────
app = FastAPI(title="FertiCal API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # 本地使用，允许所有来源
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 数据库工具 ───────────────────────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS water_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            tested_at        DATE,
            no3_n  REAL DEFAULT 0, nh4_n REAL DEFAULT 0, n  REAL DEFAULT 0,
            p      REAL DEFAULT 0, k     REAL DEFAULT 0, ca REAL DEFAULT 0,
            mg     REAL DEFAULT 0, s     REAL DEFAULT 0, cl REAL DEFAULT 0,
            fe     REAL DEFAULT 0, mn    REAL DEFAULT 0, zn REAL DEFAULT 0,
            b      REAL DEFAULT 0, cu    REAL DEFAULT 0, mo REAL DEFAULT 0,
            na     REAL DEFAULT 0, si    REAL DEFAULT 0, hco3 REAL DEFAULT 0,
            ec     REAL DEFAULT 0, ph    REAL DEFAULT 0,
            notes            TEXT,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS formulas (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            description      TEXT,
            a_tank_volume    REAL DEFAULT 100,
            a_dilution       REAL DEFAULT 100,
            b_tank_volume    REAL DEFAULT 100,
            b_dilution       REAL DEFAULT 100,
            a_rows           TEXT DEFAULT '[]',
            b_rows           TEXT DEFAULT '[]',
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS titration_results (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            formula_id       INTEGER REFERENCES formulas(id) ON DELETE SET NULL,
            water_report_id  INTEGER REFERENCES water_reports(id) ON DELETE SET NULL,
            measured_at      DATETIME,
            measured_ec      REAL,
            measured_ph      REAL,
            predicted_ec     REAL,
            predicted_ph     REAL,
            element_actuals  TEXT DEFAULT '{}',
            water_snapshot   TEXT DEFAULT '{}',
            formula_snapshot TEXT DEFAULT '{}',
            total_mmol       TEXT DEFAULT '{}',
            acid_profile     TEXT DEFAULT '{}',
            notes            TEXT,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    ensure_columns(conn, "titration_results", {
        "predicted_ec": "REAL",
        "predicted_ph": "REAL",
        "water_snapshot": "TEXT DEFAULT '{}'",
        "formula_snapshot": "TEXT DEFAULT '{}'",
        "total_mmol": "TEXT DEFAULT '{}'",
        "acid_profile": "TEXT DEFAULT '{}'",
    })
    conn.commit()
    conn.close()
    print(f"[FertiCal] 数据库已就绪：{os.path.abspath(DB_PATH)}")


def ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]):
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


init_db()


# ── Pydantic 模型 ────────────────────────────────────────────────────────────
class FormulaSave(BaseModel):
    name: str
    description: Optional[str] = None
    a_tank_volume: Optional[float] = 100
    a_dilution: Optional[float] = 100
    b_tank_volume: Optional[float] = 100
    b_dilution: Optional[float] = 100
    a_rows: list = []
    b_rows: list = []


class WaterReportSave(BaseModel):
    name: str
    tested_at: Optional[str] = None
    no3_n: float = 0;  nh4_n: float = 0;  n:  float = 0
    p:     float = 0;  k:     float = 0;  ca: float = 0
    mg:    float = 0;  s:     float = 0;  cl: float = 0
    fe:    float = 0;  mn:    float = 0;  zn: float = 0
    b:     float = 0;  cu:    float = 0;  mo: float = 0
    na:    float = 0;  si:    float = 0;  hco3: float = 0
    ec:    float = 0;  ph:    float = 0
    notes: Optional[str] = None


class TitrationSave(BaseModel):
    formula_id: Optional[int] = None
    water_report_id: Optional[int] = None
    measured_at: Optional[str] = None
    measured_ec: Optional[float] = None
    measured_ph: Optional[float] = None
    predicted_ec: Optional[float] = None
    predicted_ph: Optional[float] = None
    element_actuals: dict = {}
    water_snapshot: dict = {}
    formula_snapshot: dict = {}
    total_mmol: dict = {}
    acid_profile: dict = {}
    notes: Optional[str] = None


TARGET_ORDER = [
    "EC", "NH4-N", "K", "Ca", "Mg", "NO3-N", "Cl", "S", "P", "HCO3", "CO3",
    "Fe", "Mn", "Zn", "B", "Cu", "Mo",
]

MICRO_TARGET_KEYS = {"Fe", "Mn", "Zn", "B", "Cu", "Mo"}

DETECTION_RULES: list[tuple[str, list[str]]] = [
    ("NO3-N", [r"no3", r"硝态氮", r"硝酸盐", r"硝氮"]),
    ("NH4-N", [r"nh4", r"铵态氮", r"铵氮", r"氨氮", r"nh3"]),
    ("N", [r"\bn\b", r"总氮", r"全氮"]),
    ("P", [r"\bp\b", r"以p计", r"磷"]),
    ("K", [r"\bk\b", r"以k计", r"钾"]),
    ("Ca", [r"\bca\b", r"钙"]),
    ("Mg", [r"\bmg\b", r"镁"]),
    ("S", [r"\bs\b", r"以s计", r"硫"]),
    ("Cl", [r"\bcl\b", r"氯"]),
    ("Fe", [r"\bfe\b", r"铁"]),
    ("Mn", [r"\bmn\b", r"锰"]),
    ("Zn", [r"\bzn\b", r"锌"]),
    ("B", [r"\bb\b", r"硼"]),
    ("Cu", [r"\bcu\b", r"铜"]),
    ("Mo", [r"\bmo\b", r"钼"]),
    ("Na", [r"\bna\b", r"钠"]),
    ("Si", [r"\bsi\b", r"硅"]),
    ("HCO3", [r"hco3", r"碳酸氢根", r"重碳酸根"]),
    ("CO3", [r"(^|[^h])co3", r"碳酸根"]),
    ("EC", [r"\bec\b", r"电导率"]),
    ("pH", [r"\bph\b"]),
]


def detect_element_key(text: str) -> Optional[str]:
    text = str(text).strip()
    for key, patterns in DETECTION_RULES:
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
            return key
    return None


def _to_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        num = float(str(value).replace(",", "").strip())
        return num if num >= 0 else None
    except (TypeError, ValueError):
        return None

FERTILIZER_ALIASES = {
    "ca-no3-4h2o": ["硝酸钙", "四水硝酸钙", "Ca(NO3)2"],
    "mg-no3-6h2o": ["硝酸镁", "六水硝酸镁", "硝酸镁六水合物", "Magnesium nitrate", "Mg(NO3)2", "Mg(NO3)2·6H2O", "11-0-0+16MgO"],
    "can": ["硝酸铵钙", "Calcium Ammonium Nitrate"],
    "cacl2": ["氯化钙", "CaCl2"],
    "kcl": ["氯化钾", "KCl"],
    "kno3": ["硝酸钾", "KNO3"],
    "edta-fe-13": ["EDTA-铁", "EDTA铁", "螯合铁13", "铁13", "铁-13", "EDTA-Fe", "EDTAFe"],
    "dtpa-fe-11": ["DTPA-铁", "DTPA铁", "螯合铁11", "铁11", "铁-11", "DTPA-Fe", "DTPAFe", "铁肥"],
    "eddha-fe-6": ["EDDHA-铁", "EDDHA铁", "螯合铁6", "铁6", "铁-6", "EDDHA-Fe", "EDDHAFe", "EDDHA-Fe-11"],
    "edta-mn-13": ["EDTA-锰", "EDTA锰", "螯合锰", "螯合猛", "锰螯合", "EDTA-Mn", "EDTAMn"],
    "edta-zn-15": ["EDTA-锌", "EDTA锌", "螯合锌", "锌螯合", "EDTA-Zn", "EDTAZn"],
    "edta-cu-15": ["EDTA-铜", "EDTA铜", "螯合铜", "铜螯合", "EDTA-Cu", "EDTACu"],
    "hno3-40": ["硝酸", "HNO3"],
    "kh2po4": ["磷酸二氢钾", "KH2PO4"],
    "mgso4-7h2o": ["七水硫酸镁", "五水硫酸镁", "硫酸镁", "MgSO4"],
    "k2so4": ["硫酸钾", "K2SO4"],
    "ammonium-sulfate": ["硫酸铵", "硫铵", "Ammonium sulfate", "(NH4)2SO4"],
    "urea": ["尿素", "Urea", "CO(NH2)2"],
    "urea-phosphate": ["磷酸脲", "尿素磷酸盐", "Urea phosphate", "CO(NH2)2·H3PO4"],
    "mnso4": ["硫酸锰", "MnSO4"],
    "borax": ["硼砂", "十水硼砂", "Na2B4O7", "Na2B4O7·10H2O"],
    "na-octaborate-4h2o": ["四水八硼", "四水八硼酸钠", "八硼酸钠", "Solubor", "速乐硼", "Na2B8O13", "Na2B8O13·4H2O"],
    "znso4": ["硫酸锌", "ZnSO4"],
    "cuso4": ["五水硫酸铜", "硫酸铜", "CuSO4"],
    "na2moo4": ["钼酸钠", "MoNa2O4", "Na2MoO4"],
    "h3po4-85": ["磷酸", "H3PO4"],
}


# ── 健康检查 ─────────────────────────────────────────────────────────────────
@app.get("/api/ping")
def ping():
    return {"ok": True, "version": "1.0.0"}


# ── 文件导入接口 ──────────────────────────────────────────────────────────────
@app.post("/api/import/target")
async def import_target(request: Request):
    try:
        from urllib.parse import unquote

        filename = unquote(request.headers.get("x-filename", "target"))
        content = await request.body()
        text = extract_upload_text(filename, content)
        values = parse_target_text(text)
        if not values:
            raise ValueError("未识别到目标配方数据行")
        return {"values": values, "source": filename}
    except Exception as exc:
        raise HTTPException(400, f"目标文件解析失败：{exc}")


@app.post("/api/import/water")
async def import_water(request: Request):
    try:
        from urllib.parse import unquote

        filename = unquote(request.headers.get("x-filename", "water-report"))
        content = await request.body()
        text = extract_upload_text(filename, content)
        values = parse_water_text(text)
        if not values:
            raise ValueError("未识别到水质指标数据行")
        return {"values": values, "source": filename}
    except Exception as exc:
        raise HTTPException(400, f"水质报告解析失败：{exc}")


@app.post("/api/import/target-pdf")
async def import_target_pdf(request: Request):
    return await import_target(request)


@app.post("/api/import/formula")
async def import_formula(request: Request):
    try:
        from urllib.parse import unquote

        filename = unquote(request.headers.get("x-filename", "formula"))
        content = await request.body()
        text = extract_upload_text(filename, content)
        parsed = parse_formula_text(text)
        if not parsed["bucketA"] and not parsed["bucketB"]:
            raise ValueError("未识别到 A桶/B桶肥料行")
        return parsed | {"source": filename}
    except Exception as exc:
        raise HTTPException(400, f"配方文件解析失败：{exc}")


def extract_upload_text(filename: str, content: bytes) -> str:
    import csv
    import io
    import os

    ext = os.path.splitext(filename.lower())[1]

    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    if ext in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}:
        try:
            from PIL import Image
            import pytesseract
            image = Image.open(io.BytesIO(content))
            return pytesseract.image_to_string(image, lang=get_tesseract_lang())
        except ImportError:
            raise ValueError(
                "图片 OCR 需要安装 Pillow：pip install pillow"
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "tesseract" in msg or "not installed" in msg or "no such file" in msg:
                raise ValueError(
                    "图片 OCR 需要安装 Tesseract 系统程序及中文语言包：\n"
                    "  Mac：brew install tesseract tesseract-lang\n"
                    "  Ubuntu：sudo apt install tesseract-ocr tesseract-ocr-chi-sim\n"
                    "  Windows：https://github.com/tesseract-ocr/tesseract/releases"
                )
            raise ValueError(f"图片解析失败：{exc}")

    if ext in {".xlsx", ".xlsm"}:
        import openpyxl

        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        blocks: list[str] = []
        for sheet in workbook.worksheets:
            blocks.append(sheet.title)
            for row in sheet.iter_rows(values_only=True):
                blocks.append("\t".join("" if cell is None else str(cell) for cell in row))
        return "\n".join(blocks)

    if ext in {".csv", ".tsv"}:
        text = decode_text(content)
        delimiter = "\t" if ext == ".tsv" else ","
        rows = csv.reader(io.StringIO(text), delimiter=delimiter)
        return "\n".join("\t".join(row) for row in rows)

    if ext in {".txt", ".text", ".md"}:
        return decode_text(content)

    raise ValueError("暂不支持该文件格式")


def get_tesseract_lang() -> str:
    try:
        import pytesseract

        langs = set(pytesseract.get_languages(config=""))
        if "chi_sim" in langs and "eng" in langs:
            return "chi_sim+eng"
        if "chi_sim" in langs:
            return "chi_sim"
    except Exception:
        pass
    return "eng"


def decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def parse_target_text(text: str) -> dict:
    """
    通用目标浓度解析：支持宽表格（表头行 + 数值行）、长表格（每行一个元素）两种格式。
    使用通用元素识别规则进行元素名称模糊匹配，不依赖特定文档格式。
    """
    values: dict[str, float] = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return values

    def split_row(line: str) -> list[str]:
        cells = [cell.strip() for cell in re.split(r"[\t,;|，]+", line) if cell.strip()]
        if len(cells) > 1:
            return cells
        # PDF/OCR 文本和部分 Excel 复制文本会用空白分列；先保留上面的显式分隔，
        # 再退回到空白分隔，避免把普通中文短语过早切碎。
        return [cell.strip() for cell in re.split(r"\s+", line) if cell.strip()]

    def extract_first_number(text_value: str) -> float | None:
        for match in re.finditer(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", str(text_value)):
            # 跳过化学式下标，如 NO3、H2PO4 中的 3/2/4。
            if match.start() > 0 and str(text_value)[match.start() - 1].isalpha():
                continue
            val = _to_float(match.group())
            if val is not None:
                return val
        return None

    def detect_target_header(token: str) -> str | None:
        compact = re.sub(r"[\s＋+﹢⁺－−﹣-]+", "", str(token), flags=re.I)
        lowered = compact.lower()
        ion_map = {
            "nh4": "NH4-N",
            "no3": "NO3-N",
            "hco3": "HCO3",
            "co3": "CO3",
            "h2po4": "P",
            "po4": "P",
            "so4": "S",
            "ec": "EC",
            "ph": "pH",
        }
        if lowered in ion_map:
            return ion_map[lowered]
        compact = re.sub(r"(?:2|3)?$", "", compact)
        return detect_element_key(compact)

    def extract_numbers_after_date(line: str) -> list[float]:
        match = re.search(r"\d{4}\s*/\s*\d{1,2}\s*/\s*\d{1,2}", line)
        payload = line[match.end():] if match else line
        values_found: list[float] = []
        for number in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", payload):
            val = _to_float(number)
            if val is not None:
                values_found.append(val)
        return values_found

    # ── 策略 0：PDF 表头断行表格──────────────────────────────────────────
    # 兼容类似「NH4」和「+」、「Ca2」和「+」被拆成多行/多 token 的表格。
    for i, line in enumerate(lines):
        if not re.search(r"\d+\s*号配方", line) or not re.search(r"\d{4}\s*/\s*\d{1,2}\s*/\s*\d{1,2}", line):
            continue
        header_text = " ".join(lines[max(0, i - 12):i])
        headers: list[str] = []
        for token in split_row(header_text):
            key = detect_target_header(token)
            if key and (not headers or headers[-1] != key):
                headers.append(key)
        row_numbers = extract_numbers_after_date(line)
        if len(headers) >= 5 and len(row_numbers) >= 5:
            row_vals = {}
            for key, value in zip(headers, row_numbers):
                row_vals[key] = value / 1000 if key in MICRO_TARGET_KEYS else value
            return _post_process_targets(row_vals)

    # ── 策略 A：宽表格（表头行 + 数据行）────────────────────────────────────
    # 找到 ≥3 列能匹配到元素 key 的行作为表头，紧接着的第一个数值行作为数据行
    for i, line in enumerate(lines):
        cols = split_row(line)
        detected = [detect_element_key(c) for c in cols]
        n_keys = sum(1 for d in detected if d is not None)
        if n_keys < 3:
            continue
        # 在接下来 5 行里寻找数据行（含 ≥ n_keys/2 个数字的行）
        for j in range(i + 1, min(i + 6, len(lines))):
            data_cols = split_row(lines[j])
            row_vals: dict[str, float] = {}
            for pos, key in enumerate(detected):
                if key is None or pos >= len(data_cols):
                    continue
                val = _to_float(data_cols[pos])
                if val is not None:
                    row_vals[key] = val
            if len(row_vals) >= max(2, n_keys // 2):
                values.update(row_vals)
                return _post_process_targets(values)
        break  # 找到表头但没找到数据行，停止宽表格尝试

    # ── 策略 B：同一行多组「元素 数值」─────────────────────────────────────
    # 兼容 PDF/OCR 常见输出：N 8.5 P 1.1 K 4.8 Ca 3.8 ...
    for line in lines:
        cols = split_row(line)
        if len(cols) < 4:
            continue
        row_vals: dict[str, float] = {}
        for idx, col in enumerate(cols[:-1]):
            key = detect_element_key(col)
            if key is None or key in values or key in row_vals:
                continue
            val = _to_float(cols[idx + 1])
            if val is not None:
                row_vals[key] = val
        if len(row_vals) >= 2:
            values.update(row_vals)

    # ── 策略 C：长表格（每行包含元素名 + 数值）───────────────────────────────
    for line in lines:
        cols = split_row(line)
        # 找该行中第一个匹配到元素 key 的列
        key = next((detect_element_key(c) for c in cols if detect_element_key(c)), None)
        if key is None:
            continue
        if key in values:
            continue  # 第一次出现的值优先
        # 先尝试直接从 tab/逗号分隔的列取数值
        found = False
        for col in cols:
            val = _to_float(col)
            if val is not None:
                values[key] = val
                found = True
                break
        # 若未找到（如空格分隔的整行），从整行中提取第一个独立数字
        # 过滤掉紧跟在字母之后的数字（化学式里的下标，如 NO3 里的 3）
        if not found:
            val = extract_first_number(line)
            if val is not None:
                values[key] = val

    return _post_process_targets(values)


def _post_process_targets(values: dict) -> dict:
    """EC 单位自动换算（< 20 → 乘 1000 mS→µS），微量元素单位换算（> 100 → 除 1000 mg→mmol）"""
    if "EC" in values and values["EC"] < 20:
        values["EC"] = values["EC"] * 1000
    # 如果同时有 NO3-N 和 NH4-N，补全总 N
    if ("NO3-N" in values or "NH4-N" in values) and "N" not in values:
        values["N"] = values.get("NO3-N", 0) + values.get("NH4-N", 0)
    return values


parse_target_pdf_text = parse_target_text


def parse_water_text(text: str) -> dict:
    wide_row_values = parse_water_report_wide_source_rows(text)
    if wide_row_values:
        return _post_process_targets(wide_row_values)

    table_values = parse_water_report_table_columns(text)
    if table_values:
        return _post_process_targets(table_values)

    for candidate in iter_water_report_candidate_texts(text):
        row_values = parse_water_report_rows(candidate)
        if row_values:
            return _post_process_targets(row_values)

    row_values = parse_water_report_rows(text)
    if row_values:
        return _post_process_targets(row_values)
    return parse_target_text(text)


def split_report_row(line: str) -> list[str]:
    text = str(line).strip()
    if "\t" in line:
        return [cell.strip() for cell in line.split("\t")]
    cells = [cell.strip() for cell in re.split(r"[,;|，；]+", line)]
    cells = [cell for cell in cells if cell]
    if len(cells) > 1:
        return cells
    cells = [cell.strip() for cell in re.split(r"\s{2,}", text) if cell.strip()]
    if len(cells) > 1:
        return cells
    loose_cells = [cell.strip() for cell in re.split(r"\s+", text) if cell.strip()]
    if len(loose_cells) >= 3 and (
        any(score_water_source_cell(cell) > 0 for cell in loose_cells)
        or len(re.findall(r"-?\d+(?:[.．]\d+)?", text)) >= 2
    ):
        return loose_cells
    return [text] if text else []


def score_water_source_cell(cell: str) -> int:
    compact = re.sub(r"\s+", "", str(cell))
    lowered = compact.lower()
    if not compact:
        return 0
    if re.search(r"出水|废水|污水|排水|回水|尾水|标准|限值|方法|单位|项目|指标|编号", compact):
        return 0
    score = 0
    if "原水" in compact:
        score += 8
    if re.search(r"水样|样品|水质|灌溉水|井水|地下水|自来水|水源|取样", compact):
        score += 4
    if re.search(r"\bwater\b|rawwater|sourcewater", lowered):
        score += 4
    if compact == "水" or lowered == "water":
        score += 1
    return score


def find_water_source_column(cells: list[str]) -> Optional[int]:
    scored = [(score_water_source_cell(cell), index) for index, cell in enumerate(cells)]
    scored = [item for item in scored if item[0] > 0]
    if not scored:
        return None
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][1]


def detect_water_report_header_key(cell: str) -> Optional[str]:
    compact = re.sub(r"\s+", "", str(cell))
    lowered = compact.lower()
    if not compact:
        return None
    if re.search(r"%|k2o|cao|mgo|fe2o3|al2o3|na2o|含水率|有机|碳氮比", lowered):
        return None
    if re.search(r"n[-－]?no3|no3[-－]?n|硝", lowered):
        return "NO3-N"
    if re.search(r"n[-－]?nh4|nh4[-－]?n|铵|氨氮", lowered):
        return "NH4-N"
    if re.search(r"n[-－]?tn|总氮|全氮", lowered):
        return "N"
    if re.search(r"hco3|碳酸氢", lowered):
        return "HCO3"
    if re.search(r"(^|[^h])co3|碳酸根", lowered):
        return "CO3"
    if re.search(r"(^|[^a-z])ec(?:[^a-z]|$)|电导", lowered):
        return "EC"
    if re.search(r"\bph\b|酸碱", lowered):
        return "pH"
    if re.search(r"cl[-－]?|氯", lowered):
        return "Cl"

    cleaned = re.sub(r"(?:mg/l|mg/kg|mmol/l|μg/l|ug/l|µg/l|\(.+?\)|（.+?）)", "", lowered)
    cleaned = re.sub(r"[^a-z]", "", cleaned)
    return {
        "b": "B", "ca": "Ca", "cu": "Cu", "fe": "Fe", "k": "K",
        "mg": "Mg", "mn": "Mn", "mo": "Mo", "na": "Na", "p": "P",
        "s": "S", "si": "Si", "zn": "Zn",
    }.get(cleaned)


def row_has_water_source(cells: list[str]) -> bool:
    return any(score_water_source_cell(cell) >= 4 for cell in cells)


def parse_water_report_wide_source_rows(text: str) -> dict:
    values: dict[str, float] = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        header_cells = split_report_row(line)
        header_keys = [detect_water_report_header_key(cell) for cell in header_cells]
        if sum(1 for key in header_keys if key) < 5:
            continue

        for row in lines[index + 1:index + 120]:
            row_cells = split_report_row(row)
            if not row_has_water_source(row_cells):
                continue

            for position, key in enumerate(header_keys):
                if not key or key in values or position >= len(row_cells):
                    continue
                value = parse_float_from_cell(row_cells[position])
                if value is None:
                    continue
                values[key] = normalize_water_cell_value(value, header_cells[position], key)
            if values:
                return values

    return values


def is_report_descriptor_header(cell: str) -> bool:
    compact = re.sub(r"\s+", "", str(cell))
    return bool(re.search(r"序号|编号|项目|指标|名称|参数|单位|方法|检测结果|检验结果", compact))


def water_result_ordinal(header_cells: list[str], source_col: int) -> int:
    ordinal = 0
    for cell in header_cells[:source_col]:
        if cell and not is_report_descriptor_header(cell):
            ordinal += 1
    return ordinal


def parse_float_from_cell(cell: str) -> Optional[float]:
    match = re.search(r"<?\s*-?\d+(?:[.．]\s*\d+)?(?:[eE][+-]?\d+)?", str(cell))
    if not match:
        return None
    raw = re.sub(r"\s+", "", match.group()).replace("．", ".").lstrip("<")
    return _to_float(raw)


def extract_indexed_report_number(line: str, ordinal: int) -> Optional[float]:
    numeric_tokens: list[float] = []
    row_no_match = re.match(r"^\s*(\d{1,2})\b", line)
    row_no_end = row_no_match.end() if row_no_match else 0

    for match in re.finditer(r"<?-?\d+(?:[.．]\s*\d+)?(?:[eE][+-]?\d+)?", line):
        if match.start() < row_no_end:
            continue
        if match.start() > 0 and str(line)[match.start() - 1].isalpha():
            continue
        raw = match.group().replace("．", ".").lstrip("<")
        value = _to_float(raw)
        if value is not None:
            numeric_tokens.append(value)

    if ordinal < len(numeric_tokens):
        return numeric_tokens[ordinal]
    return None


def normalize_water_cell_value(value: float, row_text: str, key: str) -> float:
    if key == "EC":
        return value * 1000 if value < 20 else value
    if key in {"Cu", "Fe", "Mn", "Zn", "B", "Mo", "Si"} and re.search(r"μg|ug|µg", row_text, re.I):
        return value / 1000
    return value


def parse_water_report_table_columns(text: str) -> dict:
    values: dict[str, float] = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        header_cells = split_report_row(line)
        if len(header_cells) < 2:
            continue

        source_col = find_water_source_column(header_cells)
        if source_col is None:
            continue
        source_ordinal = water_result_ordinal(header_cells, source_col)

        for row in lines[index + 1:index + 40]:
            row_cells = split_report_row(row)

            row_text = "\t".join(row_cells)
            key = detect_water_report_key(row_text)
            if not key or key in values:
                continue

            value = parse_float_from_cell(row_cells[source_col]) if source_col < len(row_cells) else None
            if value is None:
                value = extract_indexed_report_number(row_text, source_ordinal)
            if value is None:
                continue

            values[key] = normalize_water_cell_value(value, row_text, key)

    return values


def is_water_report_context_line(line: str) -> bool:
    compact = re.sub(r"\s+", "", str(line))
    lowered = compact.lower()
    if re.search(r"原水|水样|水质|灌溉水|井水|地下水|自来水|水源|取样", compact):
        return True
    return bool(re.search(r"rawwater|sourcewater|waterquality|watersample", lowered))


def iter_water_report_candidate_texts(text: str):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    seen: set[tuple[int, int]] = set()

    for index, line in enumerate(lines):
        if not is_water_report_context_line(line):
            continue
        start = index
        end = min(len(lines), index + 40)
        key = (start, end)
        if key in seen:
            continue
        seen.add(key)
        yield "\n".join(lines[start:end])


def parse_water_report_rows(text: str) -> dict:
    values: dict[str, float] = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        key = detect_water_report_key(line)
        if not key or key in values:
            continue

        value = extract_water_report_value(line, key)
        if value is not None:
            values[key] = value

    return values


def detect_water_report_key(line: str) -> Optional[str]:
    text = str(line)
    compact = re.sub(r"\s+", "", text, flags=re.I)
    lowered = compact.lower()
    leading_no = re.match(r"^\s*(\d{1,2})\b", text)
    row_no = int(leading_no.group(1)) if leading_no else None

    if re.search(r"nh\s*4?\s*[-－]?\s*n|nhn|铵", lowered, re.I):
        return "NH4-N"
    if re.search(r"no\s*[3:：;]?\s*[-－]?\s*n|硝", lowered, re.I):
        return "NO3-N"
    if re.search(r"hco\s*[3:：;]?", lowered, re.I) or "碳酸氢" in compact:
        return "HCO3"
    if re.search(r"(^|[^h])co\s*[3:：;]?", lowered, re.I) or "碳酸盐" in compact or "碳酸根" in compact:
        return "CO3"
    if re.search(r"so\s*[4:：.;]?\s*[-－]?\s*s", lowered, re.I) or "硫酸" in compact:
        return "S"
    if re.search(r"\(\s*c?k\s*\)|\bk\b|钾", lowered, re.I):
        return "K"
    if re.search(r"\bph\b|酸碱", lowered, re.I):
        return "pH"
    if re.search(r"\bec\b|电导", lowered, re.I):
        return "EC"

    for symbol, key in {
        "ca": "Ca", "mg": "Mg", "na": "Na", "cl": "Cl", "cu": "Cu",
        "fe": "Fe", "mn": "Mn", "zn": "Zn", "mo": "Mo", "si": "Si",
        "p": "P", "b": "B",
    }.items():
        if re.search(rf"\(\s*{symbol}\s*\)", lowered, re.I):
            return key

    key = detect_element_key(text)
    if key:
        return key

    serial_map = {
        1: "NH4-N", 2: "NO3-N", 3: "P", 4: "HCO3", 5: "S",
        6: "Cl", 7: "Ca", 8: "Mg", 9: "Na", 10: "K",
        11: "Cu", 12: "Fe", 13: "Mn", 14: "Zn", 15: "B",
        16: "Mo", 17: "Si", 19: "pH", 20: "EC",
    }
    return serial_map.get(row_no)


def extract_water_report_value(line: str, key: str) -> Optional[float]:
    numeric_tokens: list[tuple[float, int, bool]] = []
    for match in re.finditer(r"<?\s*-?\d+(?:[.．]\s*\d+)?(?:[eE][+-]?\d+)?", line):
        raw = re.sub(r"\s+", "", match.group()).replace("．", ".")
        is_threshold = raw.startswith("<")
        value = _to_float(raw.lstrip("<"))
        if value is None:
            continue
        numeric_tokens.append((value, match.start(), is_threshold))

    if not numeric_tokens:
        return None

    # 跳过最左侧序号；PDF/OCR 常把序号和检测值放在同一行。
    row_no_match = re.match(r"^\s*(\d{1,2})\b", line)
    if row_no_match:
        row_no_end = row_no_match.end()
        numeric_tokens = [item for item in numeric_tokens if item[1] >= row_no_end]

    if not numeric_tokens:
        return None

    value = numeric_tokens[-1][0]
    if key == "EC":
        return value * 1000 if value < 20 else value
    if key in {"Cu", "Fe", "Mn", "Zn", "B", "Mo", "Si"} and len(numeric_tokens) >= 2:
        return value / 1000
    return value


def parse_formula_text(text: str) -> dict:
    import re

    result = {"bucketA": [], "bucketB": [], "aVolume": 100, "bVolume": 100}
    current_bucket: Optional[str] = None
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        compact = line.replace(" ", "")
        if re.search(r"A桶|A罐|A液|A槽|A池", compact, re.I):
            current_bucket = "A"
        elif re.search(r"B桶|B罐|B液|B槽|B池", compact, re.I):
            current_bucket = "B"

        volume_match = re.search(r"kg\s*/\s*(\d+(?:\.\d+)?)\s*L", line, re.I)
        if not volume_match:
            volume_match = re.search(r"[AB]\s*(?:桶|罐|液|槽|池)[（(]\s*(\d+(?:\.\d+)?)\s*(?:升|L|l)", line)
        if volume_match:
            volume = float(volume_match.group(1))
            if current_bucket == "A":
                result["aVolume"] = volume
            elif current_bucket == "B":
                result["bVolume"] = volume

        if not current_bucket:
            continue

        fertilizer_id = detect_fertilizer_id(line)
        if not fertilizer_id:
            continue

        amount = detect_formula_amount(line, fertilizer_id)
        if amount <= 0:
            continue

        row = {"id": "", "fertilizerId": fertilizer_id, "amount": amount, "unit": "kg"}
        if current_bucket == "A":
            result["bucketA"].append(row)
        else:
            result["bucketB"].append(row)

    if not result["bucketA"] and not result["bucketB"]:
        result = parse_formula_list_without_bucket_order(lines, result)

    return result


def parse_formula_list_without_bucket_order(lines: list[str], base: dict) -> dict:
    import re
    result = {"bucketA": [], "bucketB": [], "aVolume": base.get("aVolume", 100), "bVolume": base.get("bVolume", 100)}

    for line in lines:
        volume_match = re.search(r"([AB])\s*(?:桶|罐|液|槽|池)[（(]\s*(\d+(?:\.\d+)?)\s*(?:升|L|l)", line)
        if volume_match:
            if volume_match.group(1).upper() == "A":
                result["aVolume"] = float(volume_match.group(2))
            else:
                result["bVolume"] = float(volume_match.group(2))

    formula_rows = []
    for line in lines:
        fertilizer_id = detect_fertilizer_id(line)
        if not fertilizer_id:
            continue
        amount = detect_formula_amount(line, fertilizer_id)
        if amount <= 0:
            continue
        formula_rows.append({
            "id": "",
            "fertilizerId": fertilizer_id,
            "amount": amount,
            "unit": "kg"
        })

    split_index = next((i for i, row in enumerate(formula_rows) if row["fertilizerId"] in {"kh2po4", "mgso4-7h2o", "k2so4", "mnso4", "borax", "na-octaborate-4h2o", "znso4", "cuso4", "na2moo4"}), None)
    if split_index is None:
        split_index = len(formula_rows)

    result["bucketA"] = formula_rows[:split_index]
    result["bucketB"] = formula_rows[split_index:]
    return result


def detect_fertilizer_id(text: str) -> Optional[str]:
    import re

    parts = [part for part in re.split(r"[\t,， ]+", text) if part]
    matches: list[tuple[int, int, str]] = []
    for index, part in enumerate(parts):
        normalized_part = normalize_formula_name(part)
        for fertilizer_id, aliases in FERTILIZER_ALIASES.items():
            for alias in aliases:
                normalized_alias = normalize_formula_name(alias)
                if normalized_alias and normalized_alias in normalized_part:
                    matches.append((index, -len(normalized_alias), fertilizer_id))

    if not matches:
        return None

    matches.sort()
    return matches[0][2]


def detect_formula_amount(text: str, fertilizer_id: Optional[str] = None) -> float:
    import re

    parts = [part for part in re.split(r"[\t,， ]+", text) if part]
    if fertilizer_id:
        aliases = FERTILIZER_ALIASES.get(fertilizer_id, [])
        alias_index = -1
        for index, part in enumerate(parts):
            normalized = normalize_formula_name(part)
            if any(normalize_formula_name(alias) in normalized for alias in aliases):
                alias_index = index
                break
        if alias_index >= 0:
            trailing_parts = parts[alias_index + 1:]
            for index, part in enumerate(trailing_parts):
                next_part = trailing_parts[index + 1] if index + 1 < len(trailing_parts) else None
                amount = parse_amount_token(part, next_part)
                if amount > 0:
                    return amount

    match = re.search(r"(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克)", text, re.I)
    if match:
        return normalize_amount_unit(float(match.group(1)), match.group(2))

    for index, part in enumerate(parts):
        next_part = parts[index + 1] if index + 1 < len(parts) else None
        amount = parse_amount_token(part, next_part)
        if amount > 0:
            return amount
    return 0


def parse_amount_token(token: str, next_token: Optional[str] = None) -> float:
    import re

    match = re.fullmatch(r"(\d+(?:\.\d+)?)(kg|公斤|千克|g|克)?", token, re.I)
    if not match:
        return 0
    unit = match.group(2) or (next_token if next_token and re.fullmatch(r"kg|公斤|千克|g|克", next_token, re.I) else None)
    return normalize_amount_unit(float(match.group(1)), unit)


def normalize_amount_unit(value: float, unit: Optional[str]) -> float:
    if unit and unit.lower() in {"g", "克"}:
        return value / 1000
    return value


def normalize_formula_name(value: str) -> str:
    import re

    subscript_map = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
    text = str(value).translate(subscript_map).lower()
    return re.sub(r"[\s（）()·•，,、\-—_]", "", text)


# ── 配方接口 ─────────────────────────────────────────────────────────────────
@app.get("/api/formulas")
def list_formulas():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, description, updated_at FROM formulas ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/formulas", status_code=201)
def create_formula(formula: FormulaSave):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO formulas
               (name, description, a_tank_volume, a_dilution,
                b_tank_volume, b_dilution, a_rows, b_rows)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (formula.name, formula.description,
         formula.a_tank_volume, formula.a_dilution,
         formula.b_tank_volume, formula.b_dilution,
         json.dumps(formula.a_rows, ensure_ascii=False),
         json.dumps(formula.b_rows, ensure_ascii=False)),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id, "name": formula.name}


@app.get("/api/formulas/{formula_id}")
def get_formula(formula_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM formulas WHERE id = ?", (formula_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="配方不存在")
    result = dict(row)
    result["a_rows"] = json.loads(result["a_rows"] or "[]")
    result["b_rows"] = json.loads(result["b_rows"] or "[]")
    return result


@app.put("/api/formulas/{formula_id}")
def update_formula(formula_id: int, formula: FormulaSave):
    conn = get_db()
    if not conn.execute("SELECT id FROM formulas WHERE id = ?", (formula_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="配方不存在")
    conn.execute(
        """UPDATE formulas
           SET name=?, description=?, a_tank_volume=?, a_dilution=?,
               b_tank_volume=?, b_dilution=?, a_rows=?, b_rows=?,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=?""",
        (formula.name, formula.description,
         formula.a_tank_volume, formula.a_dilution,
         formula.b_tank_volume, formula.b_dilution,
         json.dumps(formula.a_rows, ensure_ascii=False),
         json.dumps(formula.b_rows, ensure_ascii=False),
         formula_id),
    )
    conn.commit()
    conn.close()
    return {"id": formula_id, "name": formula.name}


@app.delete("/api/formulas/{formula_id}")
def delete_formula(formula_id: int):
    conn = get_db()
    conn.execute("DELETE FROM formulas WHERE id = ?", (formula_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── 原水报告接口 ──────────────────────────────────────────────────────────────
@app.get("/api/water-reports")
def list_water_reports():
    conn = get_db()
    rows = conn.execute(
        """SELECT id, name, tested_at, ec, ph, created_at
           FROM water_reports
           ORDER BY tested_at DESC, created_at DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/water-reports", status_code=201)
def create_water_report(report: WaterReportSave):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO water_reports
               (name, tested_at, no3_n, nh4_n, n, p, k, ca, mg, s, cl,
                fe, mn, zn, b, cu, mo, na, si, hco3, ec, ph, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (report.name, report.tested_at,
         report.no3_n, report.nh4_n, report.n, report.p, report.k,
         report.ca, report.mg, report.s, report.cl, report.fe, report.mn,
         report.zn, report.b, report.cu, report.mo, report.na, report.si,
         report.hco3, report.ec, report.ph, report.notes),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id, "name": report.name}


@app.get("/api/water-reports/{report_id}")
def get_water_report(report_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM water_reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="水质报告不存在")
    return dict(row)


@app.delete("/api/water-reports/{report_id}")
def delete_water_report(report_id: int):
    conn = get_db()
    conn.execute("DELETE FROM water_reports WHERE id = ?", (report_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── 滴定结果接口 ──────────────────────────────────────────────────────────────
@app.get("/api/titrations")
def list_titrations():
    conn = get_db()
    rows = conn.execute(
        """SELECT t.id, t.measured_at, t.measured_ec, t.measured_ph,
                  t.predicted_ec, t.predicted_ph, t.notes,
                  f.name AS formula_name, w.name AS water_name
           FROM titration_results t
           LEFT JOIN formulas f ON f.id = t.formula_id
           LEFT JOIN water_reports w ON w.id = t.water_report_id
           ORDER BY t.measured_at DESC, t.created_at DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/titrations", status_code=201)
def create_titration(titration: TitrationSave):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO titration_results
               (formula_id, water_report_id, measured_at,
                measured_ec, measured_ph, predicted_ec, predicted_ph,
                element_actuals, water_snapshot, formula_snapshot,
                total_mmol, acid_profile, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (titration.formula_id, titration.water_report_id,
         titration.measured_at or datetime.now().isoformat(),
         titration.measured_ec, titration.measured_ph,
         titration.predicted_ec, titration.predicted_ph,
         json.dumps(titration.element_actuals, ensure_ascii=False),
         json.dumps(titration.water_snapshot, ensure_ascii=False),
         json.dumps(titration.formula_snapshot, ensure_ascii=False),
         json.dumps(titration.total_mmol, ensure_ascii=False),
         json.dumps(titration.acid_profile, ensure_ascii=False),
         titration.notes),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id}


@app.get("/api/calibration/ph")
def get_ph_calibration():
    conn = get_db()
    rows = conn.execute(
        """SELECT predicted_ph, measured_ph
           FROM titration_results
           WHERE predicted_ph IS NOT NULL
             AND measured_ph IS NOT NULL
             AND predicted_ph > 0
             AND measured_ph > 0
             AND predicted_ph <= 14
             AND measured_ph <= 14
           ORDER BY measured_at DESC, created_at DESC
           LIMIT 200"""
    ).fetchall()
    conn.close()

    points = [
        {
            "predicted_ph": float(row["predicted_ph"]),
            "measured_ph": float(row["measured_ph"]),
            "residual": float(row["measured_ph"]) - float(row["predicted_ph"]),
        }
        for row in rows
    ]
    if not points:
        return {
            "enabled": False,
            "count": 0,
            "slope": 0,
            "intercept": 0,
            "max_correction": 0,
            "min_predicted_ph": None,
            "max_predicted_ph": None,
            "mae": None,
            "strategy": "none",
        }

    xs = [p["predicted_ph"] for p in points]
    ys = [p["residual"] for p in points]
    count = len(points)
    mean_x = sum(xs) / count
    mean_y = sum(ys) / count
    denom = sum((x - mean_x) ** 2 for x in xs)

    if count >= 2 and denom > 1e-6:
        slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
        intercept = mean_y - slope * mean_x
        strategy = "linear_residual"
    else:
        slope = 0
        intercept = mean_y
        strategy = "mean_residual"

    fitted_errors = [
        abs(y - (intercept + slope * x))
        for x, y in zip(xs, ys)
    ]
    max_correction = 0.25 if count < 10 else 0.35

    return {
        "enabled": True,
        "count": count,
        "slope": slope,
        "intercept": intercept,
        "max_correction": max_correction,
        "min_predicted_ph": min(xs),
        "max_predicted_ph": max(xs),
        "mae": sum(fitted_errors) / count,
        "strategy": strategy,
    }


# ── 启动 ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("FertiCal 本地后端启动中...")
    print("API 文档：http://127.0.0.1:8765/docs")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
