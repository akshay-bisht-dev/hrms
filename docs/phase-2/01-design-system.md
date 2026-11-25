# 01 — Design System

The brand palette comes from the brief. Every text/background pair below was chosen to meet **WCAG 2.2 AA** (4.5:1 for body text, 3:1 for large text and UI boundaries). Some brief colors fail as small text on white, so each one gets a darker **text shade** for that use:

## 1. Color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-primary` | `#2563EB` | `#3B82F6` | Primary buttons, links, focus ring, selected nav |
| `--color-primary-hover` | `#1D4ED8` | `#60A5FA` | |
| `--color-primary-soft` | `#EFF6FF` | `#172554` | Selected rows, info banners |
| `--color-secondary` | `#0F172A` | `#E2E8F0` | Headings, sidebar background (light theme: sidebar stays white, text secondary) |
| `--color-bg` | `#F8FAFC` | `#0B1120` | App background |
| `--color-surface` | `#FFFFFF` | `#111827` | Cards, tables, dialogs |
| `--color-border` | `#E2E8F0` | `#1F2937` | Dividers, card borders |
| `--color-border-strong` | `#94A3B8` | `#475569` | Input borders (3:1 against surface) |
| `--color-text` | `#0F172A` | `#F1F5F9` | Body text |
| `--color-text-muted` | `#475569` | `#94A3B8` | Secondary text (7.5:1 on white) |
| `--color-success` | `#16A34A` | `#22C55E` | Fills, icons, dots |
| `--color-success-text` | `#15803D` | `#4ADE80` | Success text on white/soft (5.0:1) |
| `--color-success-soft` | `#F0FDF4` | `#052E16` | |
| `--color-warning` | `#F59E0B` | `#FBBF24` | Fills, dots; **never** as text on white (2.1:1) |
| `--color-warning-text` | `#B45309` | `#FCD34D` | Warning text (5.0:1) |
| `--color-warning-soft` | `#FFFBEB` | `#451A03` | |
| `--color-danger` | `#DC2626` | `#F87171` | Destructive buttons, errors (4.8:1) |
| `--color-danger-soft` | `#FEF2F2` | `#450A0A` | |

Status must never be shown by color alone: every status badge has a text label, and live presence dots come with a label (`Working`, `On break`, `Idle`, `Offline`).

### Data visualization
- Categorical series, in order: `#2563EB`, `#F59E0B`, `#0D9488`, `#7C3AED`, `#DB2777`, `#64748B`. Blue and orange first, because they differ in lightness, not only hue.
- Work timeline: working = primary, break = warning, idle = slate `#94A3B8` hatched, disconnected = empty with dashed outline. Pattern + color, not color alone.

## 2. Typography

- Font: **Inter** (variable, self-hosted in production; tabular numbers `font-feature-settings: "tnum"` for timers, money and tables).
- Scale (rem at 16 px root): 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30 / 36.
- Weights: 400 body, 500 labels/buttons, 600 headings, 700 big numbers.
- Line height: 1.5 body, 1.25 headings.
- Scripts beyond Latin fall back to Noto Sans families (Devanagari, Arabic, CJK) loaded per locale.

## 3. Spacing, radius, elevation

- 4-px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: 6 (inputs, buttons), 10 (cards), 16 (dialogs), 999 (pills).
- Elevation: one card shadow (`0 1px 2px rgb(15 23 42 / .06)`) plus a border. One overlay shadow for menus and dialogs. No other shadows.
- Layout: sidebar 248 px + fluid content, max content width 1280 px, 24 px gutters (16 px under 640 px). The sidebar becomes a drawer below 1024 px.

## 4. Components (shadcn/ui, JavaScript)

Base: shadcn/ui configured with `"tsx": false`, so it generates `.jsx`. Components are themed only through the tokens above.

| Component | Variants / notes |
|---|---|
| Button | primary, secondary (outline), ghost, destructive; sizes sm 32 px, md 40 px, lg 44 px. Touch screens use ≥ 44 px targets. Loading state keeps the width and shows a spinner + "Saving…" |
| Badge | neutral, info, success, warning, danger; always text, optional dot |
| Status pill (presence) | Working / On break / Idle / Disconnected / Offline / Not checked in |
| Location badge | Office, WFH, Hybrid, Remote, Client site, Travel (icon + text) |
| Monitoring indicator | Always visible during monitored sessions. Three states: ON (with next-capture time), PAUSED (reason), OFF. It links to the policy text |
| Input, Select, Combobox, Date/Time picker, Textarea | Label always visible (no placeholder-only labels), help text, error text linked with `aria-describedby` |
| Data table | Sortable headers, sticky header, row selection, column visibility, cursor pagination, horizontal scroll container under 768 px |
| Card / Stat tile | Title, value (tabular), comparison line with words ("+4 vs last week"), never a bare arrow |
| Stepper | For multi-step workflows such as payroll runs, onboarding and the monitoring activation checklist |
| Approval inbox item | Who, what, when, policy check results, Approve / Reject / Request changes |
| Timeline | Work session segments, screenshot markers, events |
| Dialog / Sheet | Confirm destructive actions by stating the consequence ("Finalize payroll for 142 employees? This cannot be undone.") |
| Toast | Success and info only; errors that need action stay inline |
| Empty state | Icon, one sentence on what goes here, one primary action |
| Skeleton | Matches the final layout to avoid layout shift |

## 5. Required states (every data view)

| State | Pattern |
|---|---|
| Loading | Skeleton of the final layout. After 10 s: "Still loading…" plus a retry link |
| Empty | Explains what will appear and how to create the first item. Separate wording for "no results for these filters" with a clear-filters action |
| Error | Inline banner: what failed, whether data was saved, a retry action. Shows the `requestId` for support |
| Success | Toast for quick actions; inline confirmation for multi-step flows |
| Permission denied | Lock icon and "You don't have access to screenshots for this team. Ask a Company Admin for the *View team screenshots* permission." Never a blank page |
| Offline | Top banner "You're offline. Your work session is paused until you reconnect." The work timer stops counting as soon as the client knows it is offline |

## 6. Accessibility (WCAG 2.2 AA)

- Full keyboard support; visible 2-px focus ring in primary with 2-px offset.
- Real `<button>` / `<a>` / `<label>` elements; icon-only buttons have `aria-label`.
- Live regions: the work timer is **not** announced every second. Only state changes are announced ("Break started").
- `prefers-reduced-motion` turns off animated transitions.
- Minimum target size 24 × 24 px (2.5.8); 44 × 44 on touch layouts.
- Charts have a table view.

## 7. Internationalization & RTL

- No hard-coded strings; ICU messages with plurals.
- Use logical CSS only (`ms-*`, `me-*`, `ps-*`, `start-*`, `text-start`). An ESLint rule bans `ml-*`, `mr-*`, `left-*`, `right-*` and `text-left` in app code.
- Allow about 40% longer text in buttons and labels (German, Finnish). Never use fixed-width buttons.
- Show times in the viewer's time zone and label it when it differs from the employee's ("09:02 IST · 04:32 your time").
- Format money with `Intl.NumberFormat` and the currency code; never assume a symbol.

## 8. Writing style

- Plain, specific sentences. Use the action name on buttons ("Start work session", not "Submit").
- Monitoring copy is factual and never alarming or hidden: what is captured, when, who can see it, and how long it is kept.
- Never call activity data "productivity". Use neutral terms: "active time", "idle time", "app categories".
