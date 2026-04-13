# Frontend Acolyte Skill
**Description**: Design methodology and best practices for building accessible, responsive, performant frontend components

---

## COMPONENT API DESIGN

### Principles
- **Single Responsibility** — One component = one thing. If doing multiple things, break it up.
- **Props as Configuration** — All dynamic behavior should be configurable via props/attributes.
- **Sensible Defaults** — Components should work out-of-the-box with smart defaults.
- **Composition Over Inheritance** — Use composition patterns (slots, render props) instead of inheritance.
- **Type Safety** — Use TypeScript for component props to catch errors early.

### API Design Pattern
```typescript
// Props interface should be clear and documented
interface ButtonProps {
  /** The button text or content (required) */
  children: React.ReactNode

  /** Button variant (primary, secondary, danger) */
  variant?: "primary" | "secondary" | "danger"

  /** Button size (small, medium, large) */
  size?: "sm" | "md" | "lg"

  /** Callback when button is clicked */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void

  /** Whether the button is disabled */
  disabled?: boolean

  /** HTML class for custom styling */
  className?: string

  /** Accessible label (used for screen readers if children is not text) */
  ariaLabel?: string
}
```

### Naming Convention
- Use PascalCase for component names (Button, CardHeader, ModalDialog)
- Use camelCase for props (onClick, ariaLabel, isLoading)
- Prefix boolean props with "is" or "has" (isDisabled, hasError, isLoading)
- Callback props should start with "on" (onClick, onChange, onSubmit)

---

## ACCESSIBILITY (WCAG 2.1 AA)

### Semantic HTML
Always use semantic HTML elements for better accessibility:
- Use `<button>` for buttons, not `<div>` or `<a>` styled as buttons
- Use `<nav>`, `<main>`, `<section>`, `<article>` for structure
- Use `<label>` for form fields
- Use `<h1>-<h6>` for headings (proper hierarchy)
- Use `<table>` for tabular data, never for layout

### ARIA (Accessible Rich Internet Applications)
Use ARIA attributes when semantic HTML is insufficient:

```html
<!-- ARIA roles -->
<div role="navigation">...</div>
<div role="dialog" aria-label="Confirm action">...</div>
<div role="button" tabindex="0">...</div>

<!-- ARIA live regions -->
<div aria-live="polite" aria-atomic="true">Loading...</div>

<!-- ARIA labels and descriptions -->
<button aria-label="Close dialog">×</button>
<input aria-describedby="error-msg" />
<span id="error-msg">Password must be 8+ characters</span>

<!-- ARIA states -->
<button aria-pressed="true">Toggle</button>
<div aria-disabled="true">Disabled content</div>
<input aria-invalid="true" aria-errormessage="err" />
```

### Keyboard Navigation
Every interactive element must be keyboard accessible:
- Use `tabindex` only when needed (usually -1 to remove from tab order, 0 for custom widgets)
- Support arrow keys for navigation in complex widgets (menus, tabs, listboxes)
- Support Enter/Space for activation
- Provide visible focus indicators (don't remove default focus outline)

```css
/* Always keep focus visible! */
button:focus,
input:focus {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
}
```

### Color Contrast
- Text: 4.5:1 ratio minimum for normal text, 3:1 for large text (18pt+)
- Components: 3:1 ratio for borders and UI elements
- Use tools: WCAG Contrast Checker, Lighthouse

### Screen Reader Testing
- Test with screen readers: NVDA (Windows), JAWS, VoiceOver (Mac/iOS)
- Verify heading hierarchy (h1 → h2 → h3, no skips)
- Check alt text for images
- Ensure form labels are associated (htmlFor on label)
- Verify skip links for navigation

---

## RESPONSIVE DESIGN

### Mobile-First Approach
Design for mobile first, then enhance for larger screens:

```css
/* Base styles (mobile) */
.card {
  display: block;
  padding: 1rem;
  font-size: 14px;
}

/* Tablet and up */
@media (min-width: 640px) {
  .card {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 1.5rem;
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .card {
    grid-template-columns: repeat(3, 1fr);
    padding: 2rem;
  }
}
```

### Common Breakpoints
- **Mobile (sm)**: 0px – 640px
- **Tablet (md)**: 640px – 1024px
- **Desktop (lg)**: 1024px – 1280px
- **Wide (xl)**: 1280px+

### Fluid Typography
Use relative units (rem, em) instead of fixed pixels:
```css
/* Avoid */
body { font-size: 14px; }
h1 { font-size: 32px; }

/* Prefer */
body { font-size: 0.875rem; } /* 14px */
h1 { font-size: 2rem; } /* 32px, scales with user preferences */
```

### Viewport Meta Tag
Always include in HTML head:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

### Testing Responsive Design
- Test on actual devices (iPhone, Android, iPad, laptop)
- Use Chrome DevTools device emulation for quick checks
- Test at multiple orientations (portrait, landscape)
- Verify touch targets are at least 44x44px (minimum for fingers)

---

## STATE MANAGEMENT

### Local Component State
For simple state, use component-level state:

```typescript
// React example
const [isOpen, setIsOpen] = useState(false)

// Vue example
const isOpen = ref(false)

// Svelte example
let isOpen = false
```

### Shared State Between Components
Use context/provide-inject for component tree:

```typescript
// React Context
const ThemeContext = createContext("light")

// Vue provide/inject
const theme = provide("theme", "light")
const injectedTheme = inject("theme")
```

### Global State
For app-wide state, use a state management library:
- React: Redux, Zustand, Recoil, Jotai
- Vue: Pinia, Vuex
- Svelte: Svelte stores
- General: TanStack Query for server state

### State Management Best Practices
- Keep state as close to components that use it as possible
- Don't over-engineer early — start with local state
- Separate UI state (isOpen) from domain state (user data)
- Normalize shape of state (flat, relational structure)
- Use selectors/derived state for computed values

---

## PERFORMANCE OPTIMIZATION

### Code Splitting & Lazy Loading
Load code/data only when needed:

```typescript
// React lazy loading
const Modal = lazy(() => import("./Modal"))

// Next.js dynamic imports
import dynamic from "next/dynamic"
const HeavyComponent = dynamic(() => import("./Heavy"), {
  loading: () => <div>Loading...</div>,
})
```

### Rendering Performance
Avoid unnecessary re-renders:

```typescript
// React: useMemo, useCallback
const expensiveValue = useMemo(() => compute(), [dep])
const handleClick = useCallback(() => { ... }, [])

// Vue: computed, memoization
const expensive = computed(() => compute())

// Svelte: reactive declarations
$: expensive = compute()
```

### Image Optimization
- Use modern formats: WebP > PNG/JPG
- Use responsive images: srcset, sizes attributes
- Lazy load images: loading="lazy"
- Optimize for web: compress, resize, appropriate dimensions

```html
<img
  src="image.jpg"
  srcset="image-320w.jpg 320w, image-640w.jpg 640w"
  sizes="(max-width: 640px) 320px, 640px"
  alt="Description"
  loading="lazy"
/>
```

### Bundle Size
- Audit with Lighthouse, Bundleanalyzer
- Remove unused dependencies
- Use tree-shaking (ES modules, sideEffects: false)
- Lazy load heavy libraries
- Monitor bundle growth in CI

### CSS Performance
- Use efficient selectors (avoid deep nesting)
- Minimize CSS repaints/reflows
- Use CSS Grid/Flexbox (native layout engine)
- Defer non-critical CSS with media queries

---

## DOCUMENTATION & DX (Developer Experience)

### Component Documentation
Every component should include:

```markdown
# Button Component

## Description
A reusable button component with multiple variants and sizes.

## Props
- `children` (ReactNode, required) — Button text/content
- `variant` ("primary" | "secondary" | "danger") — Button style
- `size` ("sm" | "md" | "lg") — Button size
- `disabled` (boolean) — Whether button is disabled
- `onClick` (function) — Click handler

## Examples

### Basic Button
\`\`\`tsx
<Button>Click me</Button>
\`\`\`

### Primary Button
\`\`\`tsx
<Button variant="primary" onClick={handleSubmit}>
  Submit
</Button>
\`\`\`

## Accessibility
- Always has a label (text or aria-label)
- Keyboard accessible (can be activated with Enter/Space)
- Focus indicator visible
- Color contrast meets WCAG AA (4.5:1)

## CSS Variables (Design Tokens)
- `--button-bg-primary`: Primary background color
- `--button-text-primary`: Primary text color
- `--button-padding`: Internal padding
- `--button-border-radius`: Corner radius
```

### TypeScript JSDoc
Document your types in code:

```typescript
/**
 * Configuration for the Button component.
 *
 * @example
 * <Button variant="primary" size="lg">
 *   Click me
 * </Button>
 */
export interface ButtonProps {
  /** The button text or content (required) */
  children: React.ReactNode

  /** Button variant (default: "primary") */
  variant?: "primary" | "secondary" | "danger"

  /** Size of the button (default: "md") */
  size?: "sm" | "md" | "lg"

  /** Callback fired when button is clicked */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void

  /** Whether the button is disabled (default: false) */
  disabled?: boolean
}
```

### Storybook
Use Storybook for interactive component documentation:

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "./Button"

const meta: Meta<typeof Button> = {
  component: Button,
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Click me",
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Disabled",
  },
}
```

---

## DESIGN TOKENS

### Color Tokens
Define a consistent color palette:

```css
/* Design tokens (CSS variables) */
:root {
  /* Semantic colors */
  --color-primary: #0066cc;
  --color-secondary: #666666;
  --color-danger: #cc0000;
  --color-success: #00cc00;
  --color-warning: #ffaa00;

  /* Grayscale */
  --color-gray-50: #fafafa;
  --color-gray-100: #f3f3f3;
  --color-gray-200: #e0e0e0;
  --color-gray-600: #666666;
  --color-gray-900: #1a1a1a;
}
```

### Typography Tokens
Define font scales and weights:

```css
:root {
  /* Font families */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Monaco", "Menlo", monospace;

  /* Font sizes */
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-2xl: 1.5rem;

  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Line height */
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;
}
```

### Spacing Tokens
Use consistent spacing scale:

```css
:root {
  /* Spacing scale (4px base) */
  --space-0: 0;
  --space-1: 0.25rem;    /* 4px */
  --space-2: 0.5rem;     /* 8px */
  --space-3: 0.75rem;    /* 12px */
  --space-4: 1rem;       /* 16px */
  --space-6: 1.5rem;     /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-12: 3rem;      /* 48px */
}
```

### Using Design Tokens
Apply tokens consistently across components:

```css
.button {
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  background-color: var(--color-primary);
  color: white;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
}

.button:hover {
  background-color: var(--color-primary-dark);
}
```

---

## COMMON PITFALLS & HOW TO AVOID

### 1. Missing Alt Text
❌ `<img src="user.jpg" />`  
✅ `<img src="user.jpg" alt="Profile picture of John Doe" />`

### 2. Removing Focus Outline
❌ `button:focus { outline: none; }`  
✅ Provide visible focus indicator instead

### 3. Using Only Color to Convey Information
❌ "Select the red option" (for color-blind users)  
✅ "Select the marked option" (with icon + color)

### 4. Ignoring Mobile Users
❌ 16px font size (triggers zoom on iOS)  
✅ Use rem units, mobile-first CSS

### 5. Over-Engineering Components
❌ Generic "Box" component with 50 props  
✅ Purpose-built components with clear intent

### 6. Hardcoding Values
❌ `padding: "16px"; color: "#0066cc";`  
✅ Use design tokens: `padding: var(--space-4); color: var(--color-primary);`

### 7. Forgetting Disabled State
❌ Disabled button still has hover effects  
✅ Disabled state has distinct styling, no interaction feedback

---

## RESOURCES & TOOLS

### Accessibility
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [WebAIM](https://webaim.org/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [axe DevTools](https://www.deque.com/axe/devtools/)

### Responsive Design
- [Mobile-First CSS](https://www.w3.org/TR/mobile-bp/)
- [CSS Media Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_Queries)
- [Responsive Design Patterns](https://web.dev/responsive-web-design-basics/)

### Performance
- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse Performance](https://developers.google.com/web/tools/lighthouse)
- [Bundle Analyzer](https://github.com/webpack-bundle-analyzer/webpack-bundle-analyzer)

### Design Systems
- [Storybook](https://storybook.js.org/)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Material Design](https://material.io/)

---

**Last Updated**: 2026-04-13  
**Skill Category**: Frontend Design  
**Skill Difficulty**: Intermediate — Advanced
