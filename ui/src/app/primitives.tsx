/* UI primitives — icons, layer dot/badge, and the SQL highlighter. */
import {
  ArrowRight,
  Carrot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Combine,
  Cookie,
  Database,
  Donut,
  Download,
  Egg,
  Eye,
  File,
  Filter,
  Folder,
  IceCreamCone,
  Layers,
  LayoutGrid,
  type LucideIcon,
  MessageCircle,
  Pizza,
  Plus,
  RefreshCw,
  Refrigerator,
  Search,
  Send,
  Server,
  Settings,
  Snowflake,
  Sparkles,
  Table,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo } from "react";

import { type AuditTag, type Layer } from "../lib/catalog";
import styles from "./primitives.module.css";

/* ---- app-wide icons ----
   Central index mapping our stable icon names to lucide-react components.
   Components reference icons only by name (via <Icon name="…"/>), so this is
   the single place to update if we switch icon libraries or a glyph disappears
   in a future lucide release. */
const ICON = {
  plus: Plus,
  folder: Folder,
  engine: Server,
  chat: MessageCircle,
  download: Download,
  database: Database,
  clock: Clock,
  gear: Settings,
  refresh: RefreshCw,
  grid: LayoutGrid,
  table: Table,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevD: ChevronDown,
  x: X,
  sparkle: Sparkles,
  flow: Workflow,
  layers: Layers,
  check: Check,
  arrow: ArrowRight,
  send: Send,
  join: Combine,
  filter: Filter,
  eye: Eye,
  search: Search,
  upload: Upload,
  file: File,
  fridge: Refrigerator,
  snow: Snowflake,
  // playful dropzone glyphs (FOODS in upload.jsx)
  donut: Donut,
  egg: Egg,
  carrot: Carrot,
  icecream: IceCreamCone,
  cookie: Cookie,
  pizza: Pizza,
} satisfies Record<string, LucideIcon>;

/** Name of an icon registered in {@link ICON}. */
type IconName = keyof typeof ICON;

/** Audit-tag → icon map for rendering AI-edit / transform tags. Presentation
    metadata read by the chat / detail / audit-log views; not catalog data.
    Keyed by {@link AuditTag} so it is exhaustive — every tag has a glyph and
    callers need no runtime fallback. */
const TAG_ICON: Record<AuditTag, IconName> = {
  create: "plus",
  join: "join",
  filter: "filter",
  grain: "clock",
  measure: "sparkle",
  config: "gear",
  clean: "check",
  fix: "check",
  cast: "refresh",
  shape: "table",
  source: "database",
};

function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  const Glyph = ICON[name];
  if (!Glyph) return null;
  return <Glyph size={size} strokeWidth={1.7} style={style} />;
}

/* Layer-aware primitives. `layer` selects styling via primitives.module.css
   (no DC dependency); `size` feeds the --dot-size custom property. */
function LayerDot({ layer, size = 9 }: { layer: Layer; size?: number }) {
  return (
    <span
      className={`${styles.dot} ${styles[layer] || ""}`}
      style={{ "--dot-size": `${size}px` } as CSSProperties}
    />
  );
}
function LayerBadge({
  layer,
  children,
}: {
  layer?: Layer;
  children?: ReactNode;
}) {
  if (!layer) return null;
  return (
    <span className={`${styles.badge} ${styles[layer] || ""}`}>
      <LayerDot layer={layer} size={7} />
      {children || layer}
    </span>
  );
}

/* ---- SQL syntax highlighter ---- */
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
 * Highlighting is a left-to-right pipeline of string→string transforms, each
 * taking the partially-highlighted string and returning the next. Order
 * matters: HTML is escaped first so the `<span>` tags injected by later steps
 * (dbt refs, string literals, keywords) are not themselves escaped.
 *
 * `isDense` applies a tighter layout via the `dense` modifier class.
 */
function SqlBlock({ sql, isDense }: { sql: string; isDense?: boolean }) {
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

export { Icon, LayerBadge, LayerDot, SqlBlock, TAG_ICON };
export type { IconName };
