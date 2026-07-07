/* App-wide icon registry — maps stable icon names to lucide-react components.
   Components reference icons only by name (via <Icon name="…"/>), so this is
   the single place to update if we switch icon libraries or a glyph disappears
   in a future lucide release. */
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
  LogOut,
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
import { type CSSProperties } from "react";

import { type AuditTag } from "../../catalog";

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
  logout: LogOut,
  file: File,
  fridge: Refrigerator,
  snow: Snowflake,
  // playful empty-state glyphs (the cold-storage FOODS)
  donut: Donut,
  egg: Egg,
  carrot: Carrot,
  icecream: IceCreamCone,
  cookie: Cookie,
  pizza: Pizza,
} satisfies Record<string, LucideIcon>;

/** Name of an icon registered in {@link ICON}. */
export type IconName = keyof typeof ICON;

/** Audit-tag → icon map for rendering AI-edit / transform tags. Presentation
    metadata read by the chat / detail / audit-log views; not catalog data.
    Keyed by {@link AuditTag} so it is exhaustive — every tag has a glyph and
    callers need no runtime fallback. */
export const TAG_ICON: Record<AuditTag, IconName> = {
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

export function Icon({
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
