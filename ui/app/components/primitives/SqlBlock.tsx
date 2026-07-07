import { useMemo } from "react";

// Keywords SqlBlock highlights — one per line so adding/removing a keyword is a
// clean single-line diff. Compiled once into a word-boundary alternation regex.
const SQL_KEYWORDS = [
  // clauses
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  // joins
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "ON",
  // logical / set
  "AS",
  "AND",
  "OR",
  "DISTINCT",
  // functions
  "SUM",
  "COUNT",
  "COALESCE",
  "LOWER",
  "UPPER",
  "INITCAP",
  "TRIM",
  "CAST",
  "DATE_TRUNC",
  "MAX",
  "MIN",
];
const SQL_KEYWORD_RE = new RegExp(`\\b(${SQL_KEYWORDS.join("|")})\\b`, "g");

/**
 * Render a SQL string as read-only, syntax-highlighted markup.
 *
 * Input contract: `sql` is backend-sourced catalog SQL (trusted). HTML is
 * escaped first in the transform pipeline so injected `<span>` tags are safe.
 * User-controlled SQL is NOT accepted here — callers must not pass arbitrary
 * user input.
 *
 * Highlighting is a left-to-right pipeline of string→string transforms, each
 * taking the partially-highlighted string and returning the next. Order
 * matters: HTML is escaped first so the `<span>` tags injected by later steps
 * (dbt refs, string literals, keywords) are not themselves escaped.
 *
 * `isDense` applies a tighter layout via the `dense` modifier class.
 */
export function SqlBlock({ sql, isDense }: { sql: string; isDense?: boolean }) {
  const html = useMemo(() => {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wrapDbtRefs = (s: string) =>
      s.replace(
        /(\{\{\s*ref\([^}]*\)\s*\}\})/g,
        '<span class="sql-ref">$1</span>',
      );
    const wrapStringLiterals = (s: string) =>
      s.replace(/('[^']*')/g, '<span class="sql-str">$1</span>');
    const wrapKeywords = (s: string) =>
      s.replace(SQL_KEYWORD_RE, '<span class="sql-kw">$1</span>');

    const pipeline = [
      escapeHtml,
      wrapDbtRefs,
      wrapStringLiterals,
      wrapKeywords,
    ];
    return pipeline.reduce((acc, transform) => transform(acc), sql);
  }, [sql]);
  return (
    <pre className={"sql-block" + (isDense ? " dense" : "")}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
