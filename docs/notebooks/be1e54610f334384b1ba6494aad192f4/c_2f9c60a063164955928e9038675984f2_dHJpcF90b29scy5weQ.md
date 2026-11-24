# `mcp_tools/trip_tools.py` 代码精讲学习手册

> **阅读指南**：本文档是一份**完全独立（Self-Contained）**的源码精讲手册。文档内已 **100% 完整嵌入 `mcp_tools/trip_tools.py` 的全部 295 行源代码**，并从四层架构定位、核心前置知识（动态 SQL 条件拼接、Milvus 向量+标量混合检索 RAG、事务扣减库存对比、统一 JSON 返回规范）、调用链全景图、逐函数精讲与沙盘推演（Dry Run）到潜在 Bug 诊断进行了全方位剖析，无需打开源码文件即可独立学习。

---

## 一、文件定位与核心前置知识精讲

### 1.1 在四层架构中的位置

`mcp_tools/trip_tools.py` 是行程管家领域（租车、跟团游、旅行保险）的**纯业务逻辑层（第 3 层）**。它是整个 `mcp_tools` 中**技术栈最丰富**的一个文件——同时对接了 **MySQL 关系型数据库**、**阿里云 DashScope Embedding 向量化 API** 以及 **Milvus 向量数据库**：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 1 层：A2A Agent 层 (a2a_server/a2a_trip.py)                               │
│   职责：接收主控 Agent 的租车/旅游团/保险请求，通过 MCP 客户端调用行程工具    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ MCP 协议 (Streamable-HTTP)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 2 层：MCP Server 协议层 (mcp_server/mcp_trip.py)                          │
│   职责：通过 FastMCP 暴露 6 个工具（均开启 run_in_thread=True）：             │
│         query_car_rental / query_tour_group / query_insurance /              │
│         order_car_rental / order_tour_group / order_insurance                │
│   旁路：core/tool_init.py 也将这 6 个工具分别注册到 transport / local_life / │
│         info_service 三个业务域中                                            │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Python 函数直接调用
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 3 层：MCP Tools 纯业务逻辑层 (mcp_tools/trip_tools.py) ★ 本文件 ★          │
│   职责：零 MCP 协议依赖！                                                    │
│     1. 租车 & 保险查询 (query_car_rental, query_insurance) ──► 查 MySQL      │
│     2. 旅游团语义搜索 (query_tour_group) ──► 调 Embedding API + 查 Milvus    │
│     3. 租车/旅游团/保险预定 (order_*) ──► 内存模拟下单返回 JSON              │
└───────────┬──────────────────────────────────┬───────────────────────────────┘
            │ [MySQL] MySQLManager             │ [HTTP] + [Milvus]
            ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────────────────┐
│ 第 4 层（关系存储）：MySQL    │  │ 第 4 层（向量检索 RAG）：                 │
│   表：car_rentals (租车表)    │  │   1. DashScope Embedding API (1024维向量) │
│   表：insurances  (保险表)    │  │   2. Milvus 向量库 (COSINE + 标量过滤)    │
└───────────────────────────────┘  └───────────────────────────────────────────┘
```

---

### 1.2 核心前置知识科普

#### （1）为什么“租车/保险”用 MySQL，而“旅游团”要用 Milvus 向量检索（RAG）？
- **结构化精确查询（租车、保险）**：用户查租车时条件非常明确（取车城市=`成都`、还车城市=`成都`、日期=`2026-05-01`、车型=`SUV`），适合用 MySQL 的 `WHERE ... AND ...` 精确匹配。
- **非结构化语义意图查询（旅游团）**：用户搜旅游团时往往说的是自然语言愿望，例如*“想看雪山和古镇的短途轻松旅行”*或*“适合带老人孩子看海的亲子团”*。如果在 MySQL 里用 `LIKE '%轻松%'` 根本查不到（因为数据库里团名可能是*“丽江玉龙雪山+束河古镇3日慢享游”*）。
- **向量语义检索流程（Embedding + Milvus Hybrid Search）**：
  1. **文本转向量 (`get_embedding`)**：调用 DashScope 的 OpenAI 兼容接口（`POST https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`），把用户查询词 `"想看雪山的短途旅行"` 转换为一个长度为 **1024 的浮点数列表（稠密向量）**。
  2. **混合检索 (`_milvus_client.search`)**：
     - **向量召回**：在 Milvus 的 `"embedding"` 向量列上计算 **余弦相似度 (`metric_type="COSINE"`)**，语义越相近，余弦相似度越接近 `1.0`。
     - **标量过滤 (`filter='city == "丽江"'`)**：如果用户同时指定了目的地城市，Milvus 会在做向量比对的同时，先用结构化标量条件过滤出 `city == "丽江"` 的旅游团，兼顾**精确城市限制**与**模糊语义匹配**！

#### （2）两种动态 SQL 拼接模式对比（有必填条件 vs 全可选条件）
在本文件中，你会看到两种典型的动态 SQL 拼接场景：

| 函数 | 必填条件 | 可选条件 | 拼接方式 |
| :--- | :--- | :--- | :--- |
| `query_car_rental` | `pickup_city`, `return_city`, `date` | `car_type` | 基础 SQL 已经带了 `WHERE pickup_city = %s AND return_city = %s AND pickup_date = %s`，因此当 `if car_type:` 为真时，追加 **`" AND car_type = %s"`**，并 `params.append(car_type)`。 |
| `query_insurance` | **无**（全表可查） | `insurance_type` | 基础 SQL 只有 `SELECT ... FROM insurances`（没有 `WHERE`），因此当 `if insurance_type:` 为真时，追加 **`" WHERE insurance_type = %s"`**，并 `params.append(insurance_type)`。<br/>*(注：如果有多个全可选条件，工程上通常在基础 SQL 末尾写 `WHERE 1=1`，后续每个可选条件统一追加 `AND 字段 = %s`)*。 |

#### （3）模拟预定 vs 事务扣减库存（防超卖对比）
与 `ticket_tools.py` 一致，`order_car_rental`、`order_tour_group`、`order_insurance` 目前采用模拟下单返回成功 JSON。
若在生产环境中需要扣减 `car_rentals` 表的 `total_available`（可用车辆数），同样**严禁“先 SELECT 查余量，再 UPDATE 减库存”**，而应采用一条带条件校验的原子 SQL：
```sql
UPDATE car_rentals
SET total_available = total_available - %s
WHERE pickup_city = %s AND pickup_date = %s AND car_type = %s
  AND total_available >= %s
```
利用 InnoDB 行锁与 `AND total_available >= %s` 条件保证并发抢单时 `total_available` 绝不会减成负数。

#### （4）统一 JSON 字符串返回规范
本文件所有暴露给 MCP 的工具函数返回值类型均为 `str`（由 `json.dumps(..., ensure_ascii=False)` 生成）：
- 成功查出数据：`{"status": "success", "data": [...]}`
- 查询结果为空：`{"status": "no_data", "message": "..."}`
- 捕获运行时异常：`{"status": "error", "message": str(e)}`

---

## 二、所有入口与调用链全景图

### 2.1 所有入口与内部辅助函数总览表

```text
入口 / 函数名                                         调用的函数或方法                      最底层外部动作
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
0. 导入 trip_tools 模块                             → _db = MySQLManager()                 → 创建线程安全MySQL管理对象
                                                    → _milvus_client = MilvusClient(...)   → [Milvus] 连接 Milvus 服务
1. get_embedding(text) [辅助]                       → requests.post(CONFIG.EMBEDDING_URL)  → [HTTP] 调 DashScope 生成1024维向量
2. search_tour_groups_in_milvus(q, city, limit)[辅] → get_embedding(query_text)            → [HTTP] 获取查询向量
                                                    → _milvus_client.search(...)           → [Milvus] COSINE检索+标量过滤
3. query_car_rental(pickup, return, date, type)     → _db.fetch_all(sql, params)           → [MySQL] 查 car_rentals 表
4. query_tour_group(query_text, city=None)          → search_tour_groups_in_milvus(...)    → [HTTP] + [Milvus] 语义搜旅游团
5. query_insurance(insurance_type=None)             → _db.fetch_all(sql, params)           → [MySQL] 查 insurances 表
6. order_car_rental(date, car_type, number)         → json.dumps(...)                      → 内存模拟租车下单
7. order_tour_group(date, tour_name, number)        → json.dumps(...)                      → 内存模拟旅游团报名
8. order_insurance(insurance_type, date, number)    → json.dumps(...)                      → 内存模拟买保险
```

### 2.2 全链路执行流程图（Mermaid）

```mermaid
flowchart TD
    subgraph RAG_FLOW ["旅游团 RAG 语义搜索链：query_tour_group"]
        T1["query_tour_group(query_text, city=None)"] --> T2["search_tour_groups_in_milvus(query_text, city, limit=5)"]
        T2 --> T3{"city 是否非空？"}
        T3 -->|Yes| T4["filter_expr = 'city == \"xxx\"'"]
        T3 -->|No| T5["filter_expr = None"]
        T4 --> T6["[HTTP] get_embedding(query_text)<br/>POST DashScope Embedding API → 返回 1024维 float 列表"]
        T5 --> T6
        T6 --> T7["[Milvus] _milvus_client.search()<br/>metric_type='COSINE', nprobe=10, filter=filter_expr"]
        T7 --> T8["遍历 results[0]，提取 entity 字段并计算 similarity = round(distance, 4)"]
        T8 --> T9{"tour_list 非空？"}
        T9 -->|Yes| T10["json.dumps({status:'success', data:tour_list})"]
        T9 -->|No| T11["json.dumps({status:'no_data', message:'未找到匹配的旅游团...'})"]
        T2 -->|异常| T12["json.dumps({status:'error', message:str(e)})"]
    end

    subgraph MYSQL_FLOW ["MySQL 查询链：query_car_rental & query_insurance"]
        M1["接收查询参数"] --> M2["构造基础 SQL + 动态拼接可选参数 (%s + params.append)"]
        M2 --> M3["[MySQL] rows = _db.fetch_all(sql, params)"]
        M3 --> M4{"rows 非空？"}
        M4 -->|Yes| M5["json.dumps({status:'success', data:rows}, cls=DateDecimalToString)"]
        M4 -->|No| M6["json.dumps({status:'no_data', message:'未找到...'})"]
    end
```

---

## 三、完整源码与逐函数深度精讲

### 3.1 完整源代码（100% 原始代码嵌入，共 295 行）

以下是 `mcp_tools/trip_tools.py` 的完整源代码，未做任何删减：

```python
"""行程工具函数 —— 纯业务逻辑，无MCP依赖
包含：租车/旅游团/保险的查询与预定 + embedding向量检索辅助函数

═══════════════════════════════════════════════════════════════════════════
                          辅助函数 — 向量检索链
═══════════════════════════════════════════════════════════════════════════

  get_embedding(text)
       │
       ▼
  HTTP POST ──► Embedding API (dashscope) ──► 返回 1024维向量

  ───────────────────────────────────────

  search_tour_groups_in_milvus(query_text, city, limit=5)
       │
       ├─ 连接 MilvusClient(uri, db_name)
       ├─ 构造 filter_expr ──► city=="xxx" or None
       │
       ▼
  get_embedding(query_text) ──► 文本向量
       │
       ▼
  milvus_client.search(
      data=[向量],
      ann_field="embedding",
      metric_type="COSINE",
      filter=filter_expr,       ← 可选标量过滤
      limit=5
  )
       │
       ▼
  遍历 results[0] ──► [{tour_id, tour_name, city, days, price, similarity}, ...]

═══════════════════════════════════════════════════════════════════════════
"""

import json
import requests
from pymilvus import MilvusClient

from utils import CONFIG
from utils import logger
from utils import MySQLManager
from utils import DateDecimalToString

# 全局数据库实例（模块级复用，避免重复创建连接）
_db = MySQLManager()
# 全局 Milvus 客户端（模块级复用）
_milvus_client = MilvusClient(
    uri=f"http://{CONFIG.DB_MILVUS_HOST}:"
        f"{CONFIG.DB_MILVUS_PORT}",
    db_name=CONFIG.DB_MILVUS_DB_NAME
)

# ========== 向量检索辅助函数 ==========

def get_embedding(text: str) -> list:
    """调用 Embedding API 生成文本向量，用于Milvus语义搜索"""
    # 构建请求头与请求体
    headers = {
        "Authorization": "Bearer " + CONFIG.EMBEDDING_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "model": CONFIG.EMBEDDING_MODEL,
        "input": [text],
        "dimensions": CONFIG.EMBEDDING_DIMENSION
    }
    # 调用 Embedding API，超时 30 秒
    resp = requests.post(
        CONFIG.EMBEDDING_URL,
        headers=headers,
        json=payload,
        timeout=30
    )
    # 提取返回的向量数据
    return resp.json()["data"][0]["embedding"]


def search_tour_groups_in_milvus(
        query_text: str,
        city: str = None,
        limit: int = 5) -> list:
    """在 Milvus 向量库中语义搜索旅游团，返回匹配列表"""
    # 如果指定城市，构建标量过滤表达式
    filter_expr = f'city == "{city}"' if city else None
    # 语义搜索：文本 → embedding → Milvus COSINE 相似度匹配
    results = _milvus_client.search(
        collection_name=CONFIG.DB_MILVUS_COLLECTION,
        data=[get_embedding(query_text)],
        ann_field="embedding",
        search_params={"metric_type": "COSINE", "params": {"nprobe": 10}},
        limit=limit,
        output_fields=[
            "tour_id", "tour_name", "city", "days", "price",
            "total_seats", "remaining_seats", "agency",
            "rating", "departure_dates", "highlights"
        ],
        filter=filter_expr
    )
    # 组装返回结果，distance 即为相似度分数
    tour_list = []
    for hit in results[0]:
        tour_list.append({
            "tour_id": hit["entity"].get("tour_id"),
            "tour_name": hit["entity"].get("tour_name"),
            "city": hit["entity"].get("city"),
            "days": hit["entity"].get("days"),
            "price": hit["entity"].get("price"),
            "similarity": round(hit["distance"], 4),
        })
    logger.info(f'milvus查询结果➡️：{tour_list}')
    return tour_list


# ========== 查询类工具 ==========

def query_car_rental(
        pickup_city: str,
        return_city: str,
        date: str,
        car_type: str = None) -> str:
    """租车查询接口 —— 按取还城市、日期、车型（可选）查询 MySQL 中的租车数据"""
    logger.info("租车查询: %s→%s, date=%s, type=%s",
                pickup_city, return_city, date, car_type)
    try:
        # 基础 SQL：三条件精确匹配
        sql = """
        SELECT id, company, pickup_city, return_city,
        pickup_date, car_type, car_model, price_per_day,
        total_available, transmission, seats, deposit
        FROM car_rentals
        WHERE pickup_city = %s
        AND return_city = %s
        AND pickup_date = %s
        """
        params = [pickup_city, return_city, date]
        # 车型为可选过滤条件
        if car_type:
            sql += " AND car_type = %s"
            params.append(car_type)
        rows = _db.fetch_all(sql, params)
        if rows:
            # DateDecimalToString 处理日期与 Decimal 的 JSON 序列化
            return json.dumps(
                {"status": "success", "data": rows},
                cls=DateDecimalToString,
                ensure_ascii=False
            )
        return json.dumps(
            {
                "status": "no_data",
                "message": "未找到租车数据，请确认查询条件。"
            },
            ensure_ascii=False
        )
    except Exception as e:
        logger.error("租车查询异常: %s", e)
        return json.dumps(
            {"status": "error", "message": str(e)},
            ensure_ascii=False
        )


def query_tour_group(
        query_text: str,
        city: str = None) -> str:
    """旅游团语义搜索接口（Milvus RAG）—— 通过 Embedding 向量匹配相似旅游团"""
    logger.info("旅游团查询: query='%s', city='%s'",
                query_text, city)
    try:
        # 调用 Milvus 语义搜索，最多返回 5 条结果
        tour_list = search_tour_groups_in_milvus(
            query_text, city, limit=5
        )
        if tour_list:
            return json.dumps(
                {"status": "success", "data": tour_list},
                ensure_ascii=False
            )
        # 根据是否有城市过滤给出不同提示
        return json.dumps(
            {
                "status": "no_data",
                "message": "未找到匹配的旅游团。"
                + ("请确认城市名称，" if city else "")
                + "或尝试其他搜索条件。"
            },
            ensure_ascii=False
        )
    except Exception as e:
        logger.error("旅游团RAG查询异常: %s", e)
        return json.dumps(
            {"status": "error", "message": str(e)},
            ensure_ascii=False
        )


def query_insurance(
        insurance_type: str = None) -> str:
    """旅行保险查询接口 —— 按保险类型（可选）查询 MySQL 中的保险产品"""
    logger.info("保险查询: type=%s", insurance_type)
    try:
        # 基础 SQL：查询所有保险产品
        sql = """
        SELECT id, insurance_type, name, company, coverage,
        price, duration_days, max_coverage, medical_coverage,
        baggage_coverage, flight_delay
        FROM insurances
        """
        params = []
        # 保险类型为可选过滤条件
        if insurance_type:
            sql += " WHERE insurance_type = %s"
            params.append(insurance_type)
        rows = _db.fetch_all(sql, params)
        if rows:
            return json.dumps(
                {"status": "success", "data": rows},
                cls=DateDecimalToString,
                ensure_ascii=False
            )
        return json.dumps(
            {
                "status": "no_data",
                "message": "未找到保险数据，请确认查询条件。"
            },
            ensure_ascii=False
        )
    except Exception as e:
        logger.error("保险查询异常: %s", e)
        return json.dumps(
            {"status": "error", "message": str(e)},
            ensure_ascii=False
        )


# ========== 预定类工具（当前为模拟预定逻辑，后续可对接真实三方 API） ==========

def order_car_rental(
        date: str,
        car_type: str,
        number: int) -> str:
    """模拟租车下单预定 —— 直接返回成功响应"""
    logger.info("租车预定: date=%s, type=%s, num=%d",
                date, car_type, number)
    return json.dumps(
        {
            "status": "success",
            "message": f"恭喜，租车预定成功！"
                       f"日期：{date}，"
                       f"车型：{car_type}，"
                       f"数量：{number}辆。"
        },
        ensure_ascii=False
    )


def order_tour_group(
        date: str,
        tour_name: str,
        number: int) -> str:
    """模拟旅游团报名下单"""
    logger.info("旅游团报名: date=%s, tour=%s, num=%d",
                date, tour_name, number)
    return json.dumps(
        {
            "status": "success",
            "message": f"恭喜，旅游团报名成功！"
                       f"团名：{tour_name}，"
                       f"日期：{date}，"
                       f"人数：{number}人。"
        },
        ensure_ascii=False
    )


def order_insurance(
        insurance_type: str,
        date: str,
        number: int) -> str:
    """模拟旅行保险下单购买"""
    logger.info("保险购买: type=%s, date=%s, num=%d",
                insurance_type, date, number)
    return json.dumps(
        {
            "status": "success",
            "message": f"恭喜，旅行保险购买成功！"
                       f"类型：{insurance_type}，"
                       f"日期：{date}，"
                       f"份数：{number}份。"
        },
        ensure_ascii=False
    )
```

---

### 3.2 逐函数深度精讲与沙盘推演（Dry Run）

#### 1. `get_embedding(text: str) -> list`（第 58~78 行）
- **核心职责**：将输入的自然语言文本 `text` 发送给 Embedding 模型服务，获取固定维度的浮点数向量列表。
- **HTTP 请求拆解**：
  - `headers`：`"Authorization": "Bearer " + CONFIG.EMBEDDING_API_KEY`（标准 Bearer Token 认证）。
  - `payload`：`{"model": CONFIG.EMBEDDING_MODEL, "input": [text], "dimensions": CONFIG.EMBEDDING_DIMENSION}`（注意 `input` 传入的是单元素列表 `[text]`，因此响应也是数组，取第 0 个元素 `resp.json()["data"][0]["embedding"]`）。

#### 2. `search_tour_groups_in_milvus(query_text, city=None, limit=5) -> list`（第 81~114 行）
- **核心职责**：在 Milvus 集合（Collection）中进行向量近邻检索（ANN Search）。
- **关键参数解析**：
  - `data=[get_embedding(query_text)]`：支持批量查询多个向量，这里只查 1 个向量，所以外层套一层列表 `[...]`，对应返回结果 `results` 也是二维列表，遍历时取 `results[0]`。
  - `ann_field="embedding"`：指定在 Collection 的哪个向量字段上做相似度检索。
  - `search_params={"metric_type": "COSINE", "params": {"nprobe": 10}}`：使用余弦相似度；`nprobe: 10` 表示在 IVF 类索引中搜索最近的 10 个聚类桶，平衡检索速度与召回率。
  - `filter=filter_expr`：当 `city="丽江"` 时，`filter_expr` 为 `'city == "丽江"'`，只在该城市的文档中做向量搜索。
  - `output_fields=[...]`：要求 Milvus 返回的标量元数据列。注意这里请求了 11 个字段，但在第 105~112 行组装 `tour_list` 时，精简提取了核心的 5 个业务字段（`tour_id, tour_name, city, days, price`）外加四舍五入保留 4 位小数的相似度分数 `similarity: round(hit["distance"], 4)`。

#### 3. `query_tour_group(query_text: str, city: str = None) -> str`（第 166~197 行）
- **沙盘推演（Dry Run）—— `query_tour_group("想看雪山和古镇的短途游", city="丽江")`**：
  1. `search_tour_groups_in_milvus` 生成 `filter_expr = 'city == "丽江"'`。
  2. `get_embedding("想看雪山和古镇的短途游")` 返回 `[0.0231, -0.0412, ..., 0.0198]`（1024 维）。
  3. `_milvus_client.search` 返回 Top 5 命中结果。
  4. `query_tour_group` 将 `tour_list` 序列化为 JSON 字符串返回：
     ```json
     {
       "status": "success",
       "data": [
         {
           "tour_id": "TG_LJ_001",
           "tour_name": "丽江玉龙雪山+蓝月谷+束河古镇3日纯玩团",
           "city": "丽江",
           "days": 3,
           "price": 1680.0,
           "similarity": 0.8742
         }
       ]
     }
     ```
  5. **巧妙的空结果提示语拼接（第 186~188 行）**：
     - 如果传了 `city="铁岭"` 没搜到，返回 `"未找到匹配的旅游团。请确认城市名称，或尝试其他搜索条件。"`
     - 如果没传 `city` 也没搜到，返回 `"未找到匹配的旅游团。或尝试其他搜索条件。"`

#### 4. `query_car_rental(pickup_city, return_city, date, car_type=None) -> str`（第 119~163 行）
- **沙盘推演（Dry Run）—— `query_car_rental("成都", "成都", "2026-05-01", "SUV")`**：
  - **拼接后的 SQL**：
    ```sql
    SELECT id, company, pickup_city, return_city,
    pickup_date, car_type, car_model, price_per_day,
    total_available, transmission, seats, deposit
    FROM car_rentals
    WHERE pickup_city = %s
    AND return_city = %s
    AND pickup_date = %s
     AND car_type = %s
    ```
  - **参数列表 `params`**：`['成都', '成都', '2026-05-01', 'SUV']`
  - **返回 JSON 字符串**：
    ```json
    {
      "status": "success",
      "data": [
        {
          "id": 5,
          "company": "神州租车",
          "pickup_city": "成都",
          "return_city": "成都",
          "pickup_date": "2026-05-01",
          "car_type": "SUV",
          "car_model": "坦克300",
          "price_per_day": "398.00",
          "total_available": 6,
          "transmission": "自动挡",
          "seats": 5,
          "deposit": "3000.00"
        }
      ]
    }
    ```

#### 5. `query_insurance(insurance_type=None) -> str`（第 200~236 行）
- **沙盘推演（Dry Run）**：
  - **场景 A（不传参数 `query_insurance()`）**：
    - `params = []`，直接执行 `SELECT ... FROM insurances`，返回表中所有保险产品。
  - **场景 B（传入类型 `query_insurance("境外型")`）**：
    - SQL 追加 `" WHERE insurance_type = %s"`，`params = ['境外型']`，仅返回境外旅行险。

#### 6. 三个预定工具：`order_car_rental`、`order_tour_group`、`order_insurance`（第 241~295 行）
- 均采用模拟下单逻辑，记录 `logger.info` 后直接返回 `{"status": "success", "message": "恭喜，...成功！..."}`。

---

## 四、代码走读注意点与潜在 Bug / 改进思考

### 1. 【启动可用性隐患】模块顶层直接实例化 `MilvusClient`（第 50~54 行）
- **现象定位**：
  ```python
  _milvus_client = MilvusClient(
      uri=f"http://{CONFIG.DB_MILVUS_HOST}:{CONFIG.DB_MILVUS_PORT}",
      db_name=CONFIG.DB_MILVUS_DB_NAME
  )
  ```
- **后果**：`MilvusClient` 在实例化时会立即发起 gRPC 连接握手。如果在本地开发或部署时，**Milvus 容器尚未启动**，那么哪怕用户只是想调用 `query_car_rental` 或 `query_insurance`（纯 MySQL 查询，根本用不到 Milvus），在 `import mcp_tools.trip_tools` 阶段就会直接因为连接 Milvus 失败而导致整个模块导入崩溃！
- **修复方案**：仿照 `weather_tools.py` 中的 `_get_weather_collector()`，将 `_milvus_client` 改为**懒加载单例函数 `_get_milvus_client()`**，只在真正调用 `search_tour_groups_in_milvus` 时才建立连接。

### 2. 【信息浪费】`search_tour_groups_in_milvus` 查了 11 个字段却丢弃了 6 个（第 95~112 行）
- **现象定位**：在第 95~99 行 `output_fields` 中，特意让 Milvus 查出了 `"total_seats", "remaining_seats", "agency", "rating", "departure_dates", "highlights"` 这 6 个对用户挑选旅游团极有价值的字段（旅行社、评分、出发团期、行程亮点），但在第 105~112 行组装 `tour_list.append({...})` 时却**完全没放进去**！
- **改进建议**：将 `"agency"`, `"rating"`, `"highlights"`, `"remaining_seats"`, `"departure_dates"` 一并放入返回字典中，大模型才能回答诸如“这个团有哪些亮点？旅行社评分多少？”的问题。

### 3. 【安全与健壮性】`filter_expr` 字符串拼接与 `get_embedding` 错误校验
- 第 87 行 `filter_expr = f'city == "{city}"' if city else None`：若传入的 `city` 含有双引号 `"`，会导致 Milvus 布尔表达式语法错误或注入，应做转义 `city.replace('"', '\\"')`。
- 第 78 行 `return resp.json()["data"][0]["embedding"]`：未检查 `resp.status_code == 200` 或调用 `resp.raise_for_status()`。如果 `EMBEDDING_API_KEY` 过期，API 返回错误 JSON（不含 `"data"` 键），会抛出难以直观排查的 `KeyError: 'data'`。

---

## 五、自测思考题（附答案解析）

### 思考题 1：在 `query_car_rental` 中，日期条件写的是 `AND pickup_date = %s`，而在 `ticket_tools.py` 的 `query_train` 中写的是 `AND DATE(departure_time) = %s`。为什么租车查询不需要加 `DATE(...)` 函数？
- **答案解析**：
  - 因为 `car_rentals` 表中的 `pickup_date` 列本身就是 `DATE` 类型（只存 `'YYYY-MM-DD'`，不存时分秒），可以直接与日期字符串 `'2026-05-01'` 精确比对并命中索引；而 `train_tickets` 表的 `departure_time` 是 `DATETIME` 类型（包含发车时分秒），所以才用了 `DATE()` 提取年月日。

### 思考题 2：为什么 `query_car_rental` 和 `query_insurance` 在 `json.dumps` 时都传了 `cls=DateDecimalToString`，而 `query_tour_group` 在 `json.dumps` 时却没有传 `cls=DateDecimalToString`？
- **答案解析**：
  - `query_car_rental` 和 `query_insurance` 的数据来自 MySQL，包含 `datetime.date` 和 `decimal.Decimal` 类型对象。
  - 而 `query_tour_group` 的数据来自 Milvus 向量库，Milvus 存储和返回的标量字段直接就是 Python 原生的 `str`、`int`、`float`（如 `round(hit["distance"], 4)` 是 `float`），不含 `Decimal` 或 `date` 对象，因此原生 `json.dumps` 即可直接序列化。

### 思考题 3：当用户调用 `query_tour_group(query_text="亲子游", city=None)` 时，Milvus 会过滤城市吗？如果 Milvus 中最相似的前 5 条记录虽然和“亲子游”完全无关（比如相似度只有 0.15），`query_tour_group` 会返回 `"no_data"` 还是返回这 5 条记录？
- **答案解析**：
  - 当 `city=None` 时，`filter_expr` 为 `None`，Milvus 不会过滤城市，而是在全量旅游团中做向量检索。
  - 只要 Milvus 集合中有数据，ANN 搜索总会返回距离最近的 Top-K（5 条）记录，即便 `similarity` 很低（如 `0.15`），`tour_list` 依然非空，函数会返回 `"status": "success"` 及这 5 条记录。若要避免低相关度结果干扰大模型，可以在第 104 行遍历 `results[0]` 时增加一个相似度阈值过滤（例如 `if hit["distance"] < 0.4: continue`）。
