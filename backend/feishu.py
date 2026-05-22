"""
飞书多维表格 (Bitable) API 客户端
支持：获取访问令牌、翻页拉取所有记录、字段名模糊匹配元素 key
"""

import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, parse_qs

import httpx

FEISHU_BASE = "https://open.feishu.cn/open-apis"

# ── 字段名 → 元素 key 的匹配规则（与 app.js DETECTION_RULES 保持同步）────────
DETECTION_RULES: list[tuple[str, list[str]]] = [
    ("NO3-N", [r"no3",   r"硝态氮", r"硝酸盐", r"硝氮"]),
    ("NH4-N", [r"nh4",   r"铵态氮", r"铵氮",   r"氨氮",  r"nh3"]),
    ("N",     [r"\bn\b", r"总氮",   r"全氮"]),
    ("P",     [r"\bp\b", r"以p计",  r"磷"]),
    ("K",     [r"\bk\b", r"以k计",  r"钾"]),
    ("Ca",    [r"\bca\b",r"钙"]),
    ("Mg",    [r"\bmg\b",r"镁"]),
    ("S",     [r"\bs\b", r"以s计",  r"硫"]),
    ("Cl",    [r"\bcl\b",r"氯"]),
    ("Fe",    [r"\bfe\b",r"铁"]),
    ("Mn",    [r"\bmn\b",r"锰"]),
    ("Zn",    [r"\bzn\b",r"锌"]),
    ("B",     [r"\bb\b", r"硼"]),
    ("Cu",    [r"\bcu\b",r"铜"]),
    ("Mo",    [r"\bmo\b",r"钼"]),
    ("Na",    [r"\bna\b",r"钠"]),
    ("Si",    [r"\bsi\b",r"硅"]),
    ("HCO3",  [r"hco3",  r"碳酸氢根",r"重碳酸根"]),
    ("EC",    [r"\bec\b",r"电导率"]),
    ("pH",    [r"\bph\b"]),
]

ALL_ELEMENT_KEYS = [k for k, _ in DETECTION_RULES]


def detect_element_key(text: str) -> Optional[str]:
    """将飞书字段名模糊匹配到元素 key，匹配失败返回 None"""
    text = str(text).strip()
    for key, patterns in DETECTION_RULES:
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return key
    return None


def is_date_field(text: str) -> bool:
    return bool(re.search(r"日期|date|时间|检测时间|采样时间", str(text), re.IGNORECASE))


def is_source_field(text: str) -> bool:
    return bool(re.search(r"地点|来源|source|location|基地|水源|站点|取样", str(text), re.IGNORECASE))


# ── 飞书认证 ──────────────────────────────────────────────────────────────────
async def get_tenant_access_token(app_id: str, app_secret: str) -> str:
    """用 App ID + Secret 换取 tenant_access_token（有效期 2 小时）"""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            f"{FEISHU_BASE}/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
        )
        data = res.json()
        if data.get("code") != 0:
            raise ValueError(f"飞书认证失败（code {data.get('code')}）：{data.get('msg', '未知错误')}")
        return data["tenant_access_token"]


# ── 拉取记录（自动翻页）────────────────────────────────────────────────────────
async def list_all_records(token: str, app_token: str, table_id: str) -> list[dict]:
    """拉取多维表格所有记录，自动处理翻页"""
    records: list[dict] = []
    page_token: Optional[str] = None

    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            params: dict = {"page_size": 100}
            if page_token:
                params["page_token"] = page_token

            res = await client.get(
                f"{FEISHU_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            data = res.json()
            if data.get("code") != 0:
                raise ValueError(
                    f"获取记录失败（code {data.get('code')}）：{data.get('msg', '未知错误')}\n"
                    "常见原因：多维表格未添加该应用为协作者，或权限不足。"
                )

            batch = data.get("data", {}).get("items", [])
            records.extend(batch)

            if not data.get("data", {}).get("has_more"):
                break
            page_token = data["data"].get("page_token")

    return records


# ── URL 解析 ──────────────────────────────────────────────────────────────────
def parse_bitable_url(url: str) -> tuple[Optional[str], Optional[str]]:
    """
    从多维表格 URL 中提取 app_token 和 table_id
    支持格式：
      https://xxx.feishu.cn/base/{app_token}?table={table_id}&view=...
      https://xxx.feishu.cn/wiki/...  （wiki 内嵌 Base 暂不支持）
    """
    parsed = urlparse(url.strip())
    path_parts = [p for p in parsed.path.split("/") if p]

    app_token: Optional[str] = None
    table_id: Optional[str] = None

    # /base/{app_token} 路径
    if "base" in path_parts:
        idx = path_parts.index("base")
        if idx + 1 < len(path_parts):
            app_token = path_parts[idx + 1]

    query = parse_qs(parsed.query)
    table_id = query.get("table", [None])[0]

    return app_token, table_id


# ── 记录 → water_report 字典 ──────────────────────────────────────────────────
def _parse_feishu_date(value) -> Optional[str]:
    """飞书日期字段可能是毫秒时间戳或字符串，统一转为 YYYY-MM-DD"""
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            return None
    if isinstance(value, str) and value:
        # 取前 10 个字符（兼容 "2026-05-01T00:00:00" 格式）
        return value[:10]
    return None


def _to_float(value) -> Optional[float]:
    """将飞书字段值转为浮点数，失败返回 None"""
    if value is None:
        return None
    try:
        num = float(str(value).replace(",", "").strip())
        return num if num >= 0 else None
    except (ValueError, TypeError):
        return None


def records_to_water_reports(records: list[dict]) -> list[dict]:
    """
    将飞书多维表格记录列表转换为 water_report 字典列表。
    每个字典包含所有元素字段（默认 0）+ feishu_record_id / name / tested_at。
    """
    results: list[dict] = []

    for record in records:
        fields: dict = record.get("fields", {})
        report: dict = {
            "feishu_record_id": record.get("record_id"),
            "name": None,
            "tested_at": None,
            **{k: 0.0 for k in ALL_ELEMENT_KEYS},
        }

        for field_name, raw_value in fields.items():
            # 跳过空值
            if raw_value is None or raw_value == "":
                continue

            # 日期字段
            if is_date_field(field_name):
                parsed_date = _parse_feishu_date(raw_value)
                if parsed_date:
                    report["tested_at"] = parsed_date
                continue

            # 来源/地点字段 → 报告名称
            if is_source_field(field_name):
                # 飞书文本字段有时是 [{"text":"..."}] 格式
                if isinstance(raw_value, list):
                    raw_value = "".join(item.get("text", "") for item in raw_value if isinstance(item, dict))
                report["name"] = str(raw_value).strip() or report["name"]
                continue

            # 元素字段
            el_key = detect_element_key(field_name)
            if el_key:
                val = _to_float(raw_value)
                if val is not None:
                    report[el_key] = val

        # 兜底名称
        if not report["name"]:
            report["name"] = report["tested_at"] or f"飞书记录 {report['feishu_record_id']}"

        results.append(report)

    return results
