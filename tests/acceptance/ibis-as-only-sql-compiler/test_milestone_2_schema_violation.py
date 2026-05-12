"""Milestone-2 (MR-3) input-surface contract — schema-layer rejection of free-form expressions.

Drives the schema-violation scenario from
``docs/feature/ibis-as-only-sql-compiler/distill/milestone-2-report-ibis-compiler.feature``:

    Scenario: A measure-creation call carrying a free-form expression field
        is rejected at the agent's tool-schema layer before reaching the
        backend

Per ADR-026 §"Decision outcome" items 2 and 3 (and DWD-4) the closure
mechanism for free-form SQL on the analyst's tool surface is **absence of
the field**, not content-level refinement. The agent's Zod tool schemas
must drop ``createReport.sqlDefinition``, ``addDimension.expr``, and
``addMeasure.expr`` and apply ``.strict()`` so an LLM call carrying any of
the three dropped fields fails ``.safeParse`` with an
``unrecognized_keys`` issue before the agent ever reaches the backend.

Contracts pinned by this test:
  1. **Source-shape contract** — within the Zod ``z.object({...})`` bodies
     of ``createReport.parameters``, ``addDimension.parameters``, and
     ``addMeasure.parameters`` in ``agent/lib/chat/reportToolDefinitions.ts``,
     the substrings ``sqlDefinition`` and ``expr:`` MUST NOT appear. The
     field does not exist; passing it cannot be syntactically expressed.
  2. **Parse-time contract** (optional, ``@real_io`` subprocess) — a Node
     subprocess that imports ``getReportTools`` and calls ``safeParse`` on
     each of the three rejection cases must report ``success === false``
     with an ``unrecognized_keys`` issue path naming the dropped field. The
     subprocess is skipped cleanly when Node is not on PATH so this suite
     remains runnable in environments without a Node toolchain.

Per DWD-1 Strategy C, the file-content contract is the primary RED gate;
it does not require the compose stack. The optional subprocess hardens the
contract by exercising the live Zod schema against three concrete payloads.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

pytestmark = [pytest.mark.milestone_2]

REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_DEFS = REPO_ROOT / "agent" / "lib" / "chat" / "reportToolDefinitions.ts"


# --------------------------------------------------------------------------- #
# Helpers — extract the body slice of a named tool's z.object({...}) schema   #
# --------------------------------------------------------------------------- #


_PARAMETERS_ZOBJECT_RE = re.compile(
    # Match `parameters: z.object({` allowing the agent's two formatting
    # styles:
    #   1. `parameters: z.object({`                     (single-line)
    #   2. `parameters: z\n        .object({`           (chained newline)
    r"parameters\s*:\s*z\s*\.\s*object\s*\(\s*\{",
)


def _locate_parameters_zobject(source: str, tool_name: str) -> tuple[int, int]:
    """Locate the ``z.object({...})`` for ``<toolName>.parameters``.

    Returns ``(open_brace_idx, close_brace_idx)`` — the indices of the
    matching outer ``{`` and ``}`` of the schema body. The caller can slice
    the body (exclusive) or inspect the suffix after the closing brace.
    """
    tool_pattern = re.compile(
        rf"^\s*{re.escape(tool_name)}\s*:\s*tool\s*\(\s*\{{",
        re.MULTILINE,
    )
    tool_match = tool_pattern.search(source)
    assert tool_match, f"could not locate tool declaration for {tool_name!r}"

    # The first `parameters: z.object({` after the tool's opening brace is
    # always THIS tool's schema — Zod nested objects appear inside the body
    # rather than at the `parameters:` level.
    params_match = _PARAMETERS_ZOBJECT_RE.search(source, pos=tool_match.end())
    assert params_match, f"could not locate parameters block for {tool_name!r}"

    open_idx = params_match.end() - 1  # index of the opening `{`
    depth = 0
    for i in range(open_idx, len(source)):
        ch = source[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return open_idx, i
    raise AssertionError(f"unterminated z.object body for {tool_name!r}")


def _extract_parameters_body(source: str, tool_name: str) -> str:
    """Return the text inside the ``z.object({...})`` of ``<toolName>.parameters``.

    The agent file is hand-written and stable — each tool is declared as
    ``<name>: tool({ ... parameters: z.object({ <BODY> }) ... })``. We slice
    the BODY by locating the tool's name at the start of a line and walking
    matched braces from the opening ``z.object({`` to its matching ``})``.
    The slice excludes comments outside the schema block, which keeps the
    contract precise: the field must not appear *inside the Zod schema*.
    """
    open_idx, close_idx = _locate_parameters_zobject(source, tool_name)
    return source[open_idx + 1 : close_idx]


# --------------------------------------------------------------------------- #
# Contract 1 — source-shape (file-content) check                              #
# --------------------------------------------------------------------------- #


def test_create_report_schema_does_not_offer_sql_definition() -> None:
    source = TOOL_DEFS.read_text(encoding="utf-8")
    body = _extract_parameters_body(source, "createReport")
    assert "sqlDefinition" not in body, (
        "createReport.parameters still declares a 'sqlDefinition' field; "
        "ADR-026 §Decision-outcome item 2 requires the field to be removed "
        "from the agent's tool surface (closure by absence, not by content "
        f"refinement). z.object body slice:\n{body}"
    )


def test_add_dimension_schema_does_not_offer_expr() -> None:
    source = TOOL_DEFS.read_text(encoding="utf-8")
    body = _extract_parameters_body(source, "addDimension")
    # Match on the field key 'expr:' to avoid false positives on 'express',
    # 'expression', or 'expr' appearing in a describe() string.
    assert "expr:" not in body, (
        "addDimension.parameters still declares an 'expr' field; "
        "ADR-026 §Decision-outcome item 3 requires the field to be removed "
        f"from the agent's tool surface. z.object body slice:\n{body}"
    )


def test_add_measure_schema_does_not_offer_expr() -> None:
    source = TOOL_DEFS.read_text(encoding="utf-8")
    body = _extract_parameters_body(source, "addMeasure")
    assert "expr:" not in body, (
        "addMeasure.parameters still declares an 'expr' field; "
        "ADR-026 §Decision-outcome item 3 requires the field to be removed "
        f"from the agent's tool surface. z.object body slice:\n{body}"
    )


def test_affected_schemas_apply_strict_unknown_key_policy() -> None:
    """Closure-by-absence works only if Zod treats unknown keys as errors.

    By default Zod silently strips unknown keys, which would mean an LLM
    sending ``{name, sqlDefinition: 'X', ...}`` would parse successfully
    with ``sqlDefinition`` invisibly discarded — defeating the contract.
    ``.strict()`` flips the policy so an unknown key produces an
    ``unrecognized_keys`` issue at parse time, surfacing the violation.
    """
    source = TOOL_DEFS.read_text(encoding="utf-8")
    for tool_name in ("createReport", "addDimension", "addMeasure"):
        _open_idx, close_idx = _locate_parameters_zobject(source, tool_name)
        # The slice after the closing `}` of the schema body should be
        # `)` (closing the `z.object(` call) followed by an optional chain
        # break (whitespace/newline) and then `.strict(`. We allow the
        # chain break so both `z.object({...}).strict()` and
        # `z\n  .object({...})\n  .strict()` formats are accepted.
        suffix = source[close_idx + 1 : close_idx + 64]
        assert re.match(r"\)\s*\.\s*strict\s*\(", suffix), (
            f"{tool_name}.parameters' z.object is not closed with .strict(); "
            "unknown keys would be silently stripped, defeating the "
            f"closure-by-absence contract. suffix={suffix!r}"
        )


# --------------------------------------------------------------------------- #
# Contract 2 — parse-time subprocess check (optional, @real_io)                #
# --------------------------------------------------------------------------- #


@pytest.mark.real_io
def test_zod_schema_rejects_dropped_fields_via_subprocess(tmp_path: Path) -> None:
    """Spawn Node, import ``getReportTools``, and verify ``.safeParse``
    rejects each dropped field with an ``unrecognized_keys`` issue.

    Skipped cleanly when Node is not on PATH (Strategy C: prefer skip over
    fail when the substrate is missing). The static checks above remain
    enforceable in every environment.
    """
    node_bin = shutil.which("node")
    if node_bin is None:
        pytest.skip("node not on PATH; subprocess parse-time check skipped")

    # The probe script loads the live tool definitions, runs safeParse on
    # each rejection payload, and prints a JSON report we assert against.
    # tsx is the project's TypeScript runner (devDependency on the agent
    # workspace, hoisted to the root node_modules). We accept either the
    # workspace-local bin or the hoisted root bin.
    tsx_candidates = [
        REPO_ROOT / "node_modules" / ".bin" / "tsx",
        REPO_ROOT / "agent" / "node_modules" / ".bin" / "tsx",
    ]
    tsx_bin = next((c for c in tsx_candidates if c.exists()), None)
    if tsx_bin is None:
        pytest.skip(
            "tsx not found in node_modules/.bin; run `npm install` to "
            "enable the subprocess parse-time check"
        )

    probe = tmp_path / "probe.mjs"
    tool_defs_abs = (REPO_ROOT / "agent" / "lib" / "chat" / "reportToolDefinitions.ts").resolve()
    probe_src = textwrap.dedent(
        f"""
        import {{ getReportTools }} from "file://{tool_defs_abs}";

        const tools = getReportTools();
        const cases = [
          {{
            tool: "createReport",
            payload: {{
              name: "loose_revenue",
              sqlDefinition: "SELECT 1",
              reportType: "fact",
              sourceRefs: [{{ id: "ds-1", type: "dataset" }}],
              domain: "Finance",
            }},
            rejectedField: "sqlDefinition",
          }},
          {{
            tool: "addDimension",
            payload: {{ name: "region", semanticType: "categorical", expr: "lower(region)" }},
            rejectedField: "expr",
          }},
          {{
            tool: "addMeasure",
            payload: {{ name: "tax_adjusted_revenue", semanticType: "sum", expr: "revenue * tax_rate" }},
            rejectedField: "expr",
          }},
        ];

        const results = cases.map(({{ tool, payload, rejectedField }}) => {{
          const schema = tools[tool].parameters;
          const parsed = schema.safeParse(payload);
          const issues = parsed.success ? [] : parsed.error.issues;
          const names = issues.flatMap((i) => i.keys ?? []).concat(
            issues.flatMap((i) => i.path ?? []),
          );
          return {{
            tool,
            rejectedField,
            success: parsed.success,
            issueCodes: issues.map((i) => i.code),
            rejectedNames: names,
          }};
        }});
        process.stdout.write(JSON.stringify(results));
        """
    ).strip()
    probe.write_text(probe_src, encoding="utf-8")

    completed = subprocess.run(
        [str(tsx_bin), str(probe)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode == 0, (
        f"probe script failed: stderr={completed.stderr!r} stdout={completed.stdout!r}"
    )
    results = json.loads(completed.stdout)
    by_tool = {r["tool"]: r for r in results}

    for tool_name in ("createReport", "addDimension", "addMeasure"):
        r = by_tool[tool_name]
        assert r["success"] is False, (
            f"{tool_name}.parameters.safeParse accepted a payload carrying "
            f"the dropped '{r['rejectedField']}' field; the field must be "
            f"rejected by absence + .strict()"
        )
        assert "unrecognized_keys" in r["issueCodes"], (
            f"{tool_name} rejection did not raise an 'unrecognized_keys' "
            f"issue; got codes={r['issueCodes']!r}. The schema must be "
            "closed via .strict()."
        )
        assert r["rejectedField"] in r["rejectedNames"], (
            f"{tool_name} unrecognized_keys issue did not name the dropped "
            f"field {r['rejectedField']!r}; got names={r['rejectedNames']!r}"
        )
