/* Barrel — re-exports all UI primitives from their focused sub-modules.
   Importers use `from "../primitives"` or `from "./primitives"` unchanged.

   Sub-modules:
   - primitives/Icon.tsx      — icon registry, <Icon>, TAG_ICON
   - primitives/LayerBadge.tsx — <LayerDot>, <LayerBadge>
   - primitives/SqlBlock.tsx  — <SqlBlock> SQL highlighter
*/
export type { IconName } from "./primitives/Icon";
export { Icon, TAG_ICON } from "./primitives/Icon";
export { LayerBadge, LayerDot } from "./primitives/LayerBadge";
export { SqlBlock } from "./primitives/SqlBlock";
