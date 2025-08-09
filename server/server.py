import os
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Generator, List, Tuple, Optional
import pandas as pd

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

from data_utils import ensure_data_dir, generate_fake_data, load_dataframes
from memory_utils import ensure_memory_file, remember_users, create_memory_blueprint


load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MEMORY_PATH = os.path.join(DATA_DIR, "memory.json")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

def ensure_memory_file_local() -> None:
    ensure_memory_file(MEMORY_PATH)

def ensure_data_dir():
    from data_utils import ensure_data_dir as _edd
    _edd()
    
ensure_data_dir()
ensure_memory_file_local()
generate_fake_data()
dfs = load_dataframes()


app.register_blueprint(create_memory_blueprint(MEMORY_PATH))



OPENAI_TOOLS: List[Dict[str, Any]] = [
    {"type": "function",
     "function": {
         "name": "chartjs_data",
         "description": "Return Chart.js-ready spec by aggregating a table (bar or line).",
         "parameters": {
             "type": "object",
             "properties": {
                 "table": {"type": "string", "enum": ["users", "events", "purchases"]},
                 "kind": {"type": "string", "enum": ["bar", "line"]},
                 "x": {"type": "string", "description": "Dimension on X axis (category or date)"},
                 "y": {"type": "string", "description": "Numeric value column to aggregate"},
                 "op": {"type": "string", "enum": ["count", "sum", "mean", "max", "min"]},
                 "filters": {"type": "array", "items": {"type": "object"}},
                 "limit": {"type": "integer", "minimum": 1, "maximum": 200}
             },
             "required": ["table", "kind", "x", "y", "op"]
         }
     }
    },
    {"type": "function",
     "function": {
         "name": "sql_tutor",
         "description": "Provide SQL guidance and example queries over users/events/purchases (DuckDB-compatible).",
         "parameters": {
             "type": "object",
             "properties": {
                 "question": {"type": "string", "description": "What the user wants to fetch with SQL"}
             },
             "required": ["question"]
         }
     }
    },
    {"type": "function",
     "function": {
         "name": "business_insight",
         "description": "Summarize an analysis result table into a direct answer and brief narrative. Can also accept a 'question' to infer a quick summary from in-memory data.",
         "parameters": {
             "type": "object",
             "properties": {
                 "result": {
                     "type": "object",
                     "properties": {
                         "columns": {"type": "array", "items": {"type": "string"}},
                         "rows": {"type": "array", "items": {"type": "object"}}
                     },
                     "required": ["columns", "rows"]
                 },
                 "question": {"type": "string"},
                 "note": {"type": "string"}
             }
         }
     }
    },
    {"type": "function",
     "function": {
         "name": "stakeholder_suggest",
         "description": "Suggest relevant stakeholders (PM/Marketing/Sales/etc.) with fake contacts and ask if the user wants an intro.",
         "parameters": {
             "type": "object",
             "properties": {
                 "roles": {"type": "array", "items": {"type": "string"}, "description": "Preferred roles to suggest (e.g., product_manager, marketing, sales)"},
                 "note": {"type": "string", "description": "Optional context to include in the suggestion."}
             }
         }
     }
    }
]


# Minimal arg stabilization for tools used here
def _stabilize_tool_args(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    updated = json.loads(json.dumps(args))
    if name == "chartjs_data":
        table = updated.get("table")
        if table not in dfs:
            updated["table"] = "events" if "events" in dfs else list(dfs.keys())[0]
        updated["kind"] = (updated.get("kind") or "bar").lower()
        updated["op"] = (updated.get("op") or "sum").lower()
        # Clamp limit
        if "limit" in updated:
            try:
                lim = int(updated["limit"])
            except Exception:
                lim = 20
            updated["limit"] = max(1, min(lim, 200))
    return updated


def _apply_simple_filters(df: pd.DataFrame, filters: Optional[List[Dict[str, Any]]]) -> pd.DataFrame:
    if not filters:
        return df
    out = df.copy()
    for f in filters:
        col = f.get("column")
        op = (f.get("op") or "").lower()
        val = f.get("value")
        if col not in out.columns:
            continue
        try:
            if op in ("eq", "="):
                out = out[out[col] == val]
            elif op == "in" and isinstance(val, list):
                out = out[out[col].isin(val)]
            elif op == "contains" and isinstance(val, str) and out[col].dtype == object:
                out = out[out[col].str.contains(val, case=False, na=False)]
        except Exception:
            continue
    return out


def tool_chartjs_data(args: Dict[str, Any]) -> Dict[str, Any]:
    table = args["table"]
    kind = args.get("kind", "bar").lower()
    x = args["x"]
    y = args["y"]
    op = args.get("op", "sum").lower()
    limit = max(1, min(int(args.get("limit", 20)), 200))

    df = _apply_simple_filters(dfs[table], args.get("filters"))

    # Ensure numeric for y unless op is count
    if op != "count" and not (y in df.columns and pd.api.types.is_numeric_dtype(df[y])):
        return {"error": f"Column {y} is not numeric for op {op}"}

    # Handle time x axis
    if x in df.columns and ("date" in x or "time" in x or x.endswith("_at") or x.endswith("timestamp")):
        x_series = pd.to_datetime(df[x], errors="coerce", utc=True).dt.date.astype(str)
        df = df.assign(_x=x_series)
        xcol = "_x"
    else:
        xcol = x

    if op == "count":
        grouped = df.groupby(xcol).size().reset_index(name="value")
        label = f"count({y})"
    else:
        grouped = getattr(df.groupby(xcol)[y], op)().reset_index(name="value")
        label = f"{op}({y})"

    grouped = grouped.sort_values("value", ascending=False).head(limit)
    labels = grouped[xcol].astype(str).tolist()
    values = grouped["value"].tolist()

    palette = ["#6C5CE7", "#00B894", "#0984E3", "#E17055", "#E84393"]
    spec = {
        "type": kind,
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "label": label,
                    "data": values,
                    "backgroundColor": palette[0] if kind == "bar" else "rgba(108,92,231,0.2)",
                    "borderColor": palette[0],
                    "fill": False if kind == "line" else True,
                    "tension": 0.25 if kind == "line" else 0,
                }
            ],
        },
        "options": {"responsive": True, "plugins": {"legend": {"display": True}}},
    }
    return {"chartjs": spec}


def tool_sql_tutor(args: Dict[str, Any]) -> Dict[str, Any]:
    q = (args.get("question") or "").strip().lower()
    schema_cols = {tbl: list(df.columns) for tbl, df in dfs.items()}

    tips = [
        "Join users to events/purchases via user_id when you need names/emails.",
        "Use GROUP BY for aggregates; ORDER BY to sort; LIMIT to cap rows.",
        "Use DATE_TRUNC on timestamps (cast strings to TIMESTAMP in DuckDB as needed).",
    ]

    examples: List[str] = []
    if any(k in q for k in ["click", "page", "event", "session"]):
        examples.append(
            """
SELECT page, SUM(clicks) AS total_clicks
FROM events
GROUP BY page
ORDER BY total_clicks DESC
LIMIT 10;
""".strip()
        )
        examples.append(
            """
SELECT e.user_id, u.name, SUM(e.clicks) AS clicks
FROM events e
LEFT JOIN users u ON e.user_id = u.id
GROUP BY 1,2
ORDER BY clicks DESC
LIMIT 10;
""".strip()
        )
    if any(k in q for k in ["purchase", "revenue", "amount", "sales"]):
        examples.append(
            """
SELECT DATE_TRUNC('day', CAST(p.purchased_at AS TIMESTAMP)) AS day,
       SUM(p.total_amount) AS revenue
FROM purchases p
GROUP BY 1
ORDER BY day;
""".strip()
        )
        examples.append(
            """
SELECT p.user_id, u.name, SUM(p.total_amount) AS revenue
FROM purchases p
LEFT JOIN users u ON p.user_id = u.id
GROUP BY 1,2
ORDER BY revenue DESC
LIMIT 10;
""".strip()
        )
    if not examples:
        examples.append(
            """
SELECT location, COUNT(*) AS users
FROM users
GROUP BY location
ORDER BY users DESC
LIMIT 10;
""".strip()
        )

    return {"tips": tips, "schema": schema_cols, "examples": examples}


def _resolve_table_column(col: str) -> Tuple[pd.DataFrame, str]:
    # Support qualified columns like users.name; otherwise search source-then-joins context later
    parts = col.split(".")
    if len(parts) == 2 and parts[0] in dfs:
        table, cname = parts
        return dfs[table], cname
    # Fallback: return first table containing the column
    for tname, df in dfs.items():
        if col in df.columns:
            return df, col
    raise KeyError(f"Unknown column: {col}")


def tool_run_analysis_plan(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        source = args.get("source")
        if source not in dfs:
            return {"error": f"Unknown source table: {source}"}
        df = dfs[source].copy()

        # joins (only safe join supported: events/purchases.user_id -> users.id)
        for j in (args.get("joins") or []):
            jtable = j.get("table")
            if jtable not in dfs:
                continue
            left_on = right_on = None
            on = j.get("on") or {}
            # Accept either explicit mapping or implicit by convention
            if on:
                # pick first pair
                lk, rk = next(iter(on.items()))
                left_on = lk.split(".")[-1]
                right_on = rk.split(".")[-1]
            else:
                # conventions
                if "user_id" in df.columns and "id" in dfs[jtable].columns:
                    left_on, right_on = "user_id", "id"
            if left_on and right_on:
                df = df.merge(dfs[jtable], left_on=left_on, right_on=right_on, how="left")

        # filters
        for f in (args.get("filters") or []):
            col = f.get("column"); op = (f.get("op") or "").lower(); val = f.get("value")
            if col not in df.columns:
                # try qualified resolution
                _, cname = _resolve_table_column(col)
                col = cname if cname in df.columns else None
            if not col:
                continue
            try:
                if op in ("eq","="):
                    df = df[df[col] == val]
                elif op == "in" and isinstance(val, list):
                    df = df[df[col].isin(val)]
                elif op == "contains" and isinstance(val, str) and df[col].dtype == object:
                    df = df[df[col].str.contains(val, case=False, na=False)]
                elif op in ("gt","gte","lt","lte"):
                    if op == "gt": df = df[df[col] > val]
                    if op == "gte": df = df[df[col] >= val]
                    if op == "lt": df = df[df[col] < val]
                    if op == "lte": df = df[df[col] <= val]
            except Exception:
                continue

        # group & metrics
        group_by = args.get("group_by") or []
        metrics = args.get("metrics") or []
        if metrics:
            agg_kwargs: Dict[str, Tuple[str, str]] = {}
            for m in metrics:
                col = m.get("column"); op = (m.get("op") or "").lower(); alias = m.get("alias")
                if not col or col not in df.columns:
                    continue
                name = alias or f"{op}_{col}"
                agg_kwargs[name] = (col, op)
            if group_by:
                out = df.groupby(group_by).agg(**agg_kwargs).reset_index()
            else:
                out = df.agg({v[0]: v[1] for v in agg_kwargs.values()}).to_frame().T
                out.columns = list(agg_kwargs.keys())
        else:
            out = df

        # select
        select = args.get("select") or []
        if select:
            keep = [c for c in select if c in out.columns]
            if keep:
                out = out[keep]

        # order & limit
        for ob in (args.get("order_by") or []):
            col = ob.get("column"); direction = (ob.get("dir") or "desc").lower()
            if col in out.columns:
                out = out.sort_values(col, ascending=(direction == "asc"))
        if args.get("limit"):
            try:
                lim = int(args.get("limit"))
                out = out.head(max(1, min(lim, 1000)))
            except Exception:
                pass

        result = {"columns": list(out.columns), "rows": out.to_dict(orient="records")}

        # Optional: emit Python code
        if args.get("include_code"):
            code_lines: List[str] = ["# Generated analysis plan using pandas", "df = dfs['" + source + "'].copy()"]
            for j in (args.get("joins") or []):
                jtable = j.get("table");
                if jtable in dfs:
                    code_lines.append(f"df = df.merge(dfs['{jtable}'], left_on='user_id', right_on='id', how='left')  # adjust if needed")
            for f in (args.get("filters") or []):
                code_lines.append(f"# filter: {f}")
            if metrics:
                if group_by:
                    code_lines.append(f"out = df.groupby({group_by}).agg({...}).reset_index()  # fill metrics")
                else:
                    code_lines.append("out = df.agg({...}).to_frame().T  # fill metrics")
            else:
                code_lines.append("out = df")
            if select:
                code_lines.append(f"out = out[{select}]  # select columns")
            if args.get("order_by"):
                code_lines.append(f"out = out.sort_values('{args['order_by'][0].get('column','')}', ascending={(args['order_by'][0].get('dir','desc')=='asc')})")
            if args.get("limit"):
                code_lines.append(f"out = out.head({args.get('limit')})")
            result["python_code"] = "\n".join(code_lines)

        return result
    except Exception as e:
        return {"error": str(e)}



def tool_stakeholder_suggest(args: Dict[str, Any]) -> Dict[str, Any]:
    roles = [r.lower() for r in (args.get("roles") or [])]
    base = [
        {"role": "product_manager", "name": "Avery Kim", "email": "avery.kim@example.com"},
        {"role": "marketing", "name": "Jordan Lee", "email": "jordan.lee@example.com"},
        {"role": "sales", "name": "Casey Patel", "email": "casey.patel@example.com"},
        {"role": "customer_success", "name": "Riley Chen", "email": "riley.chen@example.com"},
    ]
    suggestions = [c for c in base if not roles or c["role"] in roles]
    prompt = (
        "Would you like me to loop in one of these stakeholders to review or act on the findings? "
        "Reply with the role (e.g., 'product_manager' or 'marketing') and I’ll draft an intro note."
    )
    if args.get("note"):
        prompt += f" Context noted: {args['note']}"
    return {"suggestions": suggestions, "prompt": prompt}



def tool_business_insight(args: Dict[str, Any]) -> Dict[str, Any]:
    """Summarize an analysis result into a concise narrative and optional direct answer.

    Accepts either:
      - args["result"]: {"columns": [...], "rows": [...]} from run_analysis_plan (preferred)
      - args["question"]: free-text fallback for quick heuristics using global dfs
    """
    result = args.get("result")
    note = (args.get("note") or "").strip()
    question = (args.get("question") or "").strip().lower()

    insight_text: str = ""
    table_cols: List[str] = []
    table_rows: List[Dict[str, Any]] = []
    direct_answer: Optional[str] = None

    try:
        # Preferred: summarize the provided result table
        if isinstance(result, dict) and isinstance(result.get("columns"), list) and isinstance(result.get("rows"), list):
            table_cols = list(result.get("columns", []))
            table_rows = list(result.get("rows", []))

            if not table_rows:
                return {
                    "insight": "No rows returned to summarize.",
                    "columns": table_cols,
                    "rows": table_rows,
                }

            first = table_rows[0]

            # Heuristics for common analytics patterns
            if "total_amount" in table_cols:
                name_like = first.get("name") or first.get("user_id") or first.get("email") or "top user"
                amt = first.get("total_amount")
                if isinstance(amt, (int, float)):
                    direct_answer = f"Top buyer: {name_like} with ${amt:,.0f} revenue"
                insight_text = "Top buyers by total revenue."
            elif "clicks" in table_cols:
                name_like = first.get("name") or first.get("user_id") or "top user"
                clicks_val = first.get("clicks")
                if isinstance(clicks_val, (int, float)):
                    direct_answer = f"Top user: {name_like} with {int(clicks_val)} clicks"
                insight_text = "Top users by total clicks."
            # Also handle already-joined buyer summaries with top N rows
            if "total_amount" in table_cols and len(table_rows) > 1:
                # When multiple rows are present, produce a concise list summary
                preview = []
                for r in table_rows[:5]:
                    nm = r.get("name") or r.get("user_id")
                    amt = r.get("total_amount")
                    if isinstance(amt, (int, float)):
                        preview.append(f"{nm}: ${amt:,.0f}")
                if preview:
                    insight_text = "Top buyers by total revenue."
                    direct_answer = "; ".join(preview)
            else:
                # Generic summary
                numeric_cols = [c for c in table_cols if all(isinstance(r.get(c), (int, float)) for r in table_rows if r is not None)]
                if numeric_cols:
                    focus = numeric_cols[0]
                    insight_text = f"Summary by {focus}."
                else:
                    insight_text = "Summary of the result table."

            if note:
                insight_text += f" {note}".strip()

            return {
                "insight": insight_text,
                "columns": table_cols,
                "rows": table_rows,
                **({"direct_answer": direct_answer} if direct_answer else {}),
            }

        # Fallback: quick heuristics based on a natural-language question
        wants_top = any(k in question for k in ["top", "best", "highest"]) if question else False
        asks_who = ("who" in question) if question else False
        # Parse explicit N in phrases like "top 5"
        requested_n: Optional[int] = None
        if wants_top:
            import re
            m = re.search(r"top\s+(\d+)", question)
            if m:
                try:
                    requested_n = max(1, min(50, int(m.group(1))))
                except Exception:
                    requested_n = None

        if question and ("purchase" in question or "revenue" in question or "amount" in question or "buyer" in question or (wants_top and "users" in question)):
            if "purchases" in dfs and not dfs["purchases"].empty:
                p = dfs["purchases"].copy()
                grp = p.groupby("user_id")["total_amount"].sum().reset_index().sort_values("total_amount", ascending=False)
                if "users" in dfs:
                    keep = [c for c in ("id", "name", "email") if c in dfs["users"].columns]
                    grp = grp.merge(dfs["users"][keep], left_on="user_id", right_on="id", how="left").drop(columns=[c for c in ("id",) if c in grp.columns])
                # Determine how many rows to show: explicit 'top N' overrides; if asking 'who' without N, return 1; else default 5
                top_n = requested_n if requested_n is not None else (1 if asks_who and not wants_top else 5)
                top_rows = grp.head(top_n)
                table_cols = list(top_rows.columns)
                table_rows = top_rows.to_dict(orient="records")
                if not top_rows.empty:
                    first = top_rows.iloc[0].to_dict()
                    nm = first.get("name") or first.get("user_id")
                    amt = first.get("total_amount")
                    if isinstance(amt, (int, float)):
                        direct_answer = f"Top buyer: {nm} with ${amt:,.0f} revenue"
                insight_text = "Top buyers by total revenue."
            else:
                insight_text = "No purchases data available."
        elif question and ("click" in question or "session" in question or "event" in question or (wants_top and "user" in question)):
            e = dfs.get("events")
            if e is not None and not e.empty:
                metric = "clicks" if "clicks" in e.columns else None
                if metric is None:
                    insight_text = "Events data available, but no clicks column found."
                else:
                    grp = e.groupby("user_id")[metric].sum().reset_index().sort_values(metric, ascending=False)
                    if "users" in dfs:
                        keep = [c for c in ("id", "name", "email") if c in dfs["users"].columns]
                        grp = grp.merge(dfs["users"][keep], left_on="user_id", right_on="id", how="left").drop(columns=[c for c in ("id",) if c in grp.columns])
                    top_n = requested_n if requested_n is not None else (1 if asks_who and not wants_top else 5)
                    top_rows = grp.head(top_n)
                    table_cols = list(top_rows.columns)
                    table_rows = top_rows.to_dict(orient="records")
                    if not top_rows.empty:
                        first = top_rows.iloc[0].to_dict()
                        nm = first.get("name") or first.get("user_id")
                        val = first.get(metric)
                        if isinstance(val, (int, float)):
                            direct_answer = f"Top user: {nm} with {int(val)} {metric}"
                    insight_text = f"Top users by total {metric}."
            else:
                insight_text = "No events data available."
        else:
            u = dfs.get("users")
            if u is not None and not u.empty:
                top_locs = (
                    u.groupby("location").size().reset_index(name="users").sort_values("users", ascending=False).head(5)
                )
                insight_text = "Here’s a quick look at top user locations. (Tell me what to focus on next.)"
                table_cols = ["location", "users"]
                table_rows = top_locs.to_dict(orient="records")
            else:
                insight_text = "No users data available."
    except Exception as e:
        return {"error": f"insight error: {e}"}

    out: Dict[str, Any] = {
        "insight": insight_text,
        "columns": table_cols,
        "rows": table_rows,
    }
    if direct_answer:
        out["direct_answer"] = direct_answer
    return out


# Tool registry (excluding run_analysis_plan per request)
TOOLS_IMPL: Dict[str, Any] = {
    "chartjs_data": tool_chartjs_data,
    "sql_tutor": tool_sql_tutor,
    "stakeholder_suggest": tool_stakeholder_suggest,
    "business_insight": tool_business_insight,
}

def build_data_context(max_rows_per_table: int = 25, top_k: int = 10) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {}
    try:
        ctx["counts"] = {tbl: int(len(df)) for tbl, df in dfs.items()}
        ctx["schema"] = {tbl: list(df.columns) for tbl, df in dfs.items()}
        # Samples (head) for each table
        ctx["samples"] = {tbl: df.head(max_rows_per_table).to_dict(orient="records") for tbl, df in dfs.items()}
        # Helpful aggregates commonly requested
        if "purchases" in dfs and not dfs["purchases"].empty:
            p = dfs["purchases"][[c for c in ["user_id", "total_amount"] if c in dfs["purchases"].columns]].copy()
            if not p.empty and "total_amount" in p.columns:
                top_buyers = p.groupby("user_id")["total_amount"].sum().reset_index().sort_values("total_amount", ascending=False)
                if "users" in dfs:
                    keep = [c for c in ("id", "name", "email") if c in dfs["users"].columns]
                    top_buyers = top_buyers.merge(dfs["users"][keep], left_on="user_id", right_on="id", how="left").drop(columns=[c for c in ("id",) if c in top_buyers.columns])
                ctx["top_buyers_by_revenue"] = top_buyers.head(top_k).to_dict(orient="records")
        if "events" in dfs and not dfs["events"].empty and "clicks" in dfs["events"].columns:
            e = dfs["events"][[c for c in ["user_id", "clicks"] if c in dfs["events"].columns]].copy()
            top_clicks = e.groupby("user_id")["clicks"].sum().reset_index().sort_values("clicks", ascending=False)
            if "users" in dfs:
                keep = [c for c in ("id", "name", "email") if c in dfs["users"].columns]
                top_clicks = top_clicks.merge(dfs["users"][keep], left_on="user_id", right_on="id", how="left").drop(columns=[c for c in ("id",) if c in top_clicks.columns])
            ctx["top_users_by_clicks"] = top_clicks.head(top_k).to_dict(orient="records")
    except Exception as e:
        ctx["error"] = f"context build error: {e}"
    return ctx

def as_sse(text_chunks: Generator[str, None, None]) -> Generator[str, None, None]:
    """Wrap plain text chunks as Server-Sent Events (SSE)."""
    for chunk in text_chunks:
        if chunk is None:
            continue
        lines = str(chunk).splitlines() or [""]
        for line in lines:
            yield f"data: {line}\n"
        yield "\n"


def _agent_loop_stream(messages: List[Dict[str, str]], session_id: str = "default") -> Generator[str, None, None]:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception as e:
        yield json.dumps({"type": "final", "text": f"OpenAI init error: {e}"})
        return

    system_prompt = (
        """Understand the user's question and use the available tools appropriately:
- business_insight: Prefer calling this directly with {question} to compute a quick summary and direct answer from in-memory data (users/events/purchases).
- chartjs_data: Only when the user explicitly asks for a chart/graph/visualization; returns Chart.js-ready spec.
- sql_tutor: Only if the user asks how to write SQL.
- stakeholder_suggest: Optionally after you've answered, if follow-ups make sense.
Do not use or request 'run_analysis_plan'. Keep answers short and final after one or two tool calls.
"""
    )

    chat_history: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}, *messages]

    # (Optional) lightweight guard state to avoid obvious repeats
    last_tool_name: Optional[str] = None
    last_tool_args_str: Optional[str] = None

    max_steps = 10
    for _ in range(max_steps):
        try:
            completion = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=chat_history,
                tools=OPENAI_TOOLS,
                tool_choice="auto",
                temperature=0.1,
            )
        except Exception as e:
            yield json.dumps({"type": "final", "text": f"Model error: {e}"})
            return

        choice = completion.choices[0]
        msg = choice.message
        tool_calls = msg.tool_calls or []

        if tool_calls:
            assistant_tool_calls_payload = []
            for tc in tool_calls:
                assistant_tool_calls_payload.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments or "{}",
                    },
                })
            chat_history.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": assistant_tool_calls_payload,
            })

            for tc in tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                yield json.dumps({"type": "tool_call", "name": name, "args": args})
                
                stabilized_args = _stabilize_tool_args(name, args)
                if stabilized_args != args:
                    yield json.dumps({
                        "type": "query_update",
                        "tool": name,
                        "original_args": args,
                        "updated_args": stabilized_args,
                    })
                if name == "chartjs_data":
                    last_user_msg = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "").lower()
                    viz_markers = ["chart", "graph", "plot", "visual", "visualize", "visualise", "bar chart", "line chart", "trend", "timeseries", "show a chart", "draw"]
                    allowed = any(marker in last_user_msg for marker in viz_markers)
                    if not allowed:
                        tool_result = {
                            "skipped": True,
                            "reason": "Charts are generated on request. Say 'show a chart' or specify a chart type to visualize this.",
                        }
                        yield json.dumps({"type": "tool_result", "name": name, "result": tool_result})
                        # Must still append a tool message for this tool_call_id to satisfy API contract
                        chat_history.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": json.dumps(tool_result),
                        })
                        continue
                # Track for simple de-duplication
                current_args_str = None
                try:
                    current_args_str = json.dumps(stabilized_args, sort_keys=True)
                except Exception:
                    current_args_str = str(stabilized_args)

                impl = TOOLS_IMPL.get(name)
                if not impl:
                    tool_result = {"error": f"Unknown tool {name}"}
                else:
                    try:
                        tool_result = impl(stabilized_args)
                    except Exception as e:
                        tool_result = {"error": str(e)}
                yield json.dumps({"type": "tool_result", "name": name, "result": tool_result})
                
                if name == "lookup_users" and isinstance(tool_result, dict):
                    rows = tool_result.get("rows")
                    if isinstance(rows, list):
                        remember_users(MEMORY_PATH, session_id, rows)

                # Update loop guard state
                last_tool_name = name
                last_tool_args_str = current_args_str
                chat_history.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(tool_result),
                })

                # Immediately finalize after returning a chart spec to avoid extra streaming
                if name == "chartjs_data":
                    try:
                        chart_spec = tool_result.get("chartjs") if isinstance(tool_result, dict) else None
                    except Exception:
                        chart_spec = None
                    final_payload: Dict[str, Any] = {"type": "final", "text": "Chart ready."}
                    if chart_spec is not None:
                        final_payload["chartjs"] = chart_spec
                    yield json.dumps(final_payload)
                    return
            
            continue

        
        final_text = msg.content or ""
        yield json.dumps({"type": "final", "text": final_text})
        return

    yield json.dumps({"type": "final", "text": "Max steps reached. Refine your question."})


def _agent_loop(messages: List[Dict[str, str]], session_id: str = "default") -> Generator[str, None, None]:
    """Alias for compatibility with references to `_agent_loop`.

    Delegates to `_agent_loop_stream` to preserve existing behavior.
    """
    yield from _agent_loop_stream(messages, session_id=session_id)


@app.post("/agent-chat")
def agent_chat() -> Response:
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    session_id = data.get("session_id", "default")
    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages is required"}), 400

    def stream_json_events() -> Generator[str, None, None]:
        for frame in _agent_loop_stream(messages, session_id=session_id):
            yield frame

    return Response(stream_with_context(as_sse(stream_json_events())), mimetype="text/event-stream")


@app.get("/health")
def health() -> Response:
    return jsonify({
        "status": "ok",
        "users": len(dfs["users"]),
        "events": len(dfs["events"]),
        "gpt_enabled": bool(OPENAI_API_KEY),
    })



def create_app() -> Flask:
    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)


