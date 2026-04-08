# CSS Modules & Domain Language Guide

This project uses **CSS Modules with Tailwind's `@apply` directive** to create a consistent, maintainable styling system with semantic, domain-specific class names.

## Table of Contents

- [Philosophy: Domain Language](#philosophy-domain-language)
- [Architecture](#architecture)
- [Naming Conventions](#naming-conventions)
- [Semantic Design Tokens](#semantic-design-tokens)
- [Common UI Patterns](#common-ui-patterns)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)

---

## Philosophy: Domain Language

**CSS Modules enable us to create a domain-specific language for UI components.** Instead of using utility-style class names that describe *how* things look, we use semantic names that describe *what* components *are* in our application's domain.

### ❌ Avoid Utility-Style Naming
```css
/* Don't name classes after their visual properties */
.blueButton { }
.p4BorderGray { }
.flexRowGap2 { }
```

### ✅ Use Domain-Specific Naming
```css
/* Name classes after their purpose and meaning */
.actionPrimary { }        /* A primary call-to-action button */
.filterCard { }           /* A card displaying filter information */
.settingsButton { }       /* Button to open settings */
.transformName { }        /* Name of a transform */
.statusIndicator { }      /* Visual indicator of status */
```

**Benefits:**
- **Clarity:** Code readers understand *what* elements are, not just how they look
- **Maintainability:** Visual changes don't require renaming classes throughout the codebase
- **Flexibility:** Changing a primary button from blue to green doesn't require renaming from `blueButton` to `greenButton`
- **Abstraction:** UI patterns become reusable semantic concepts

---

## Architecture

### File Structure

Each component has its own CSS module file:

```
src/lib/ui/
├── common.module.css                    # Shared UI patterns
├── components/
│   ├── ChatPanel/
│   │   └── ChatPanel.module.css         # ChatPanel-specific styles
│   ├── TablePanel/
│   │   ├── TablePanel.module.css        # TablePanel-specific styles
│   │   ├── Pagination/
│   │   │   └── Pagination.module.css
│   │   └── ActiveFilters/
│   │       └── ActiveFilters.module.css
│   ├── TransformSettings/
│   │   └── TransformSettings.module.css
│   └── TransformList/
│       ├── TransformList.module.css
│       └── TransformCard.module.css
```

### CSS Module Pattern

All CSS modules follow this pattern:

```css
/* ============================================
   Component Name Styles
   ============================================

   Brief description of component purpose.
*/

/* Semantic class name with domain meaning */
.componentElement {
  @apply tailwind-utility-classes;
  /* Custom CSS properties when needed */
  color: #custom-value;
}
```

### Import Pattern

```tsx
// Component.tsx
import styles from "./Component.module.css";

export function Component() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Title</h1>
    </div>
  );
}
```

---

## Naming Conventions

### Class Name Structure

Class names follow a **semantic hierarchy**:

```
{domain}{Element}{Modifier}
```

**Examples:**
- `filterCard` - A card in the filter domain
- `filterCardActive` - Active state modifier
- `transformName` - Name within a pipeline
- `actionPrimary` - Primary action button
- `statusIndicator` - Status indicator
- `statusIndicatorActive` - Active status modifier

### Domain Categories

Our application uses these domain categories:

#### 1. **Actions** - Interactive elements
- `actionPrimary` - Primary CTA button
- `actionSecondary` - Secondary action button
- `actionIcon` - Icon-only button
- `actionLink` - Text link
- `actionToggle` - Toggle switch

#### 2. **Surfaces** - Containers and backgrounds
- `surfaceContainer` - Top-level container
- `surfacePanel` - Major panel/section
- `surfaceCard` - Content card
- `surfaceSection` - Logical section

#### 3. **Indicators** - Status and state displays
- `indicatorBadge` - General badge
- `indicatorActive` - Active state
- `indicatorError` - Error state
- `indicatorDot` - Status dot
- `indicatorLoading` - Loading state

#### 4. **Typography** - Text styles
- `textTitle` - Page/panel title
- `textHeading` - Section heading
- `textBody` - Body text
- `textMuted` - Secondary text
- `textCode` - Monospace code

#### 5. **Layout** - Structural patterns
- `layoutRow` - Horizontal flex layout
- `layoutColumn` - Vertical flex layout
- `layoutFullHeight` - Full height container
- `layoutScrollable` - Scrollable area

### Modifier Naming

State and variant modifiers use consistent suffixes:

- **State:** `Active`, `Inactive`, `Disabled`, `Loading`, `Error`
- **Size:** `Small`, `Medium`, `Large`
- **Position:** `Left`, `Right`, `Top`, `Bottom`
- **Emphasis:** `Primary`, `Secondary`, `Tertiary`

**Examples:**
```css
.filterCard { }              /* Base */
.filterCardActive { }        /* State modifier */
.actionToggleKnobActive { }  /* Nested element with state */
```

---

## Semantic Design Tokens

Tailwind config is enhanced with semantic color tokens that support the domain language:

### Color Tokens

Located in `tailwind.config.js`:

```javascript
colors: {
  // Primary actions (blue scale)
  primary: {
    DEFAULT: '#3b82f6',
    hover: '#2563eb',
    light: '#dbeafe',
    dark: '#1e40af',
  },

  // Surfaces (gray scale)
  surface: {
    DEFAULT: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
    border: '#e5e7eb',
    muted: '#9ca3af',
    emphasis: '#1f2937',
  },

  // Accent (green - active/success)
  accent: {
    DEFAULT: '#10b981',
    light: '#d1fae5',
    lighter: '#ecfdf5',
    dark: '#047857',
  },

  // Semantic colors
  semantic: {
    success: '#10b981',
    'success-bg': '#d1fae5',
    error: '#ef4444',
    'error-bg': '#fee2e2',
    warning: '#f59e0b',
    'warning-bg': '#fef3c7',
    info: '#3b82f6',
    'info-bg': '#dbeafe',
  },
}
```

### Using Design Tokens

```css
/* Use semantic tokens instead of hardcoded colors */
.actionPrimary {
  @apply bg-primary text-white;
  @apply hover:bg-primary-hover;
}

.surfaceCard {
  @apply border border-surface-border bg-white;
}

.indicatorActive {
  @apply text-accent-dark bg-accent-light;
}

.errorMessage {
  @apply text-semantic-error;
}
```

---

## Common UI Patterns

We provide a shared library of common UI patterns in `src/lib/ui/common.module.css`.

### Using Common Patterns

```tsx
import commonStyles from "@/lib/ui/common.module.css";

function MyComponent() {
  return (
    <div className={commonStyles.surfaceCard}>
      <button className={commonStyles.actionPrimary}>
        Submit
      </button>
      <span className={commonStyles.indicatorActive}>
        Active
      </span>
    </div>
  );
}
```

### Available Patterns

Refer to `src/lib/ui/common.module.css` for the complete list. Key patterns include:

- **Actions:** `actionPrimary`, `actionSecondary`, `actionIcon`, `actionToggle`
- **Surfaces:** `surfaceCard`, `surfacePanel`, `surfaceSection`
- **Indicators:** `indicatorBadge`, `indicatorActive`, `indicatorDot`
- **Typography:** `textTitle`, `textHeading`, `textMuted`, `textCode`
- **Layout:** `layoutRow`, `layoutColumn`, `layoutScrollable`

---

## Best Practices

### 1. Always Use CSS Modules

**❌ Don't use inline Tailwind classes:**
```tsx
<div className="flex items-center gap-2 p-4 bg-white border rounded-lg">
```

**✅ Use CSS modules with semantic names:**
```tsx
<div className={styles.cardHeader}>
```

```css
.cardHeader {
  @apply flex items-center gap-2 p-4 bg-white border rounded-lg;
}
```

### 2. Choose Semantic Names

**Think about what the element IS, not how it looks.**

❌ Bad:
```css
.blueText { }
.flexContainer { }
.mb4 { }
```

✅ Good:
```css
.transformName { }
.cardHeader { }
.settingsSection { }
```

### 3. Prefer Common Patterns

**Before creating new styles, check if a common pattern exists:**

```tsx
// ✅ Reuse common pattern
import commonStyles from "@/lib/ui/common.module.css";
<button className={commonStyles.actionPrimary}>

// ⚠️ Only create custom style if truly component-specific
import styles from "./MyComponent.module.css";
<button className={styles.customSpecialButton}>
```

### 4. Use Conditional Classes Clearly

```tsx
// ✅ Clear conditional styling with template literals
<div className={`${styles.filterCard} ${
  isActive ? styles.filterCardActive : styles.filterCardInactive
}`}>

// ✅ Alternative: Use a utility function for complex conditions
const cardClassName = [
  styles.filterCard,
  isActive ? styles.filterCardActive : styles.filterCardInactive,
  isHighlighted && styles.filterCardHighlighted
].filter(Boolean).join(' ');

<div className={cardClassName}>
```

### 5. Keep Styles Colocated

Each component's styles should live in a CSS module next to the component:

```
TransformCard.tsx
TransformCard.module.css  ← Styles for TransformCard
```

### 6. Document Complex Components

Add comments to CSS modules for complex components:

```css
/* ============================================
   Pipeline Card Styles
   ============================================

   Card component for individual transform display.

   States:
   - Active: Green border and background tint
   - Inactive: Gray border and white background
*/

.filterCard {
  @apply border rounded-lg p-4 transition-all;
}
```

### 7. Use Semantic Design Tokens

Always prefer semantic tokens over raw Tailwind colors:

```css
/* ❌ Avoid hardcoded colors */
.button {
  @apply bg-blue-500 hover:bg-blue-600;
}

/* ✅ Use semantic tokens */
.button {
  @apply bg-primary hover:bg-primary-hover;
}
```

---

## Migration Guide

### Converting Inline Tailwind to CSS Modules

**Step 1:** Create a CSS module file
```bash
touch src/lib/ui/components/MyComponent/MyComponent.module.css
```

**Step 2:** Extract inline classes to semantic names

Before:
```tsx
<div className="border rounded-lg p-4 bg-white">
  <h3 className="font-medium text-gray-900">Title</h3>
  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
    Click me
  </button>
</div>
```

After - CSS Module:
```css
.card {
  @apply border rounded-lg p-4 bg-white;
}

.cardTitle {
  @apply font-medium text-gray-900;
}

.primaryAction {
  @apply px-4 py-2 bg-primary text-white rounded-lg;
  @apply hover:bg-primary-hover;
}
```

After - Component:
```tsx
import styles from "./MyComponent.module.css";

<div className={styles.card}>
  <h3 className={styles.cardTitle}>Title</h3>
  <button className={styles.primaryAction}>
    Click me
  </button>
</div>
```

**Step 3:** Use semantic design tokens

Replace color utilities with semantic tokens:
- `bg-blue-600` → `bg-primary`
- `text-gray-500` → `text-surface-muted`
- `bg-green-500` → `bg-accent`
- `text-red-600` → `text-semantic-error`

---

## Summary

**Key Principles:**
1. ✅ Always use CSS modules - no inline Tailwind
2. ✅ Use semantic, domain-specific class names
3. ✅ Leverage semantic design tokens (`primary`, `surface`, `accent`, `semantic`)
4. ✅ Reuse common patterns from `common.module.css`
5. ✅ Think "what is this?" not "how does it look?"

**Benefits:**
- Consistent styling across the application
- Maintainable code with clear intent
- Flexible design system that's easy to update
- Semantic naming that improves code readability
- Domain language that aligns with business concepts

For questions or to propose new common patterns, discuss with the team or open an issue.
