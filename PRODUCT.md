# Product

## Register

product

## Users
The users are structural analysts in a shipyard's structural-analysis lab: engineers and researchers who read BDF models, F06 results and long PPTX/XLSX/PDF reports every day. They work on office desktop monitors (1366–1920px, often at 125% Windows scaling) in company Chrome over the intranet.

Their jobs are:
- Find a past analysis by hull number, title, zone or a phrase buried in a report ("the 9999 mooring review from last summer").
- Preview it without leaving the page.
- File their own new results into the shared archive (upload, then confirm).

Sessions are short and frequent (search, glance, copy path), with occasional long reading of a report or a table.

## Product Purpose
Logbook ("구조해석 항해일지") is the team's single archive for structural-analysis files and reports. The share folder is the source of truth and the app is the way in. Success means an engineer finds the right past analysis in seconds, trusts where it came from, and never has to dig through personal PCs or network folders again.

## Brand Personality
Precise, trustworthy, confident. The UI carries the HD Hyundai signature colours with real presence: the app chrome (top bar and side nav) is one continuous Trust Blue navy surface, and the white working surface sits inset inside it. Inside that surface the content (hull numbers, titles, report text, file paths) stays the hero, and navy appears only where it means something: primary actions, selection, and hull identity (navy hull chips, the large navy hull number). Heritage Green is reserved for "confirmed / connected". The tone is calm expert confidence: short Korean labels, no marketing voice, and numbers and IDs set in monospace with tabular figures. The login screen is the one signature moment: a navy brand panel beside a white form.

## Anti-references
- Legacy in-house enterprise systems: gray gradients, rows of tiny icons, nested modals, full-page reloads, dense unstyled tables.
- Generic SaaS dashboard templates: hero metrics with big numbers, identical card grids, gradient accents, glassmorphism.
- Consumer-app playfulness: bouncy motion, emoji, illustrations everywhere.

Reference feel: Linear / Vercel dashboard for density and keyboard flow, but with a committed brand-coloured shell instead of a gray one. Crisp typography, dense but well-spaced lists, clear focus and selection states, keyboard-first.

## Design Principles
1. **Search is the product.** The search box and the result list get the best typography and the clearest hierarchy; everything else supports them.
2. **Navy frame, clear content.** The chrome carries the brand as one navy surface. Inside the white surface, navy is used for selection, focus, primary actions and hull identity only.
3. **Density with hierarchy.** Engineers scan a lot of rows, so keep lists compact but make title → hull → metadata → snippet clearly stepped.
4. **Look without leaving.** Previews open in place (right panel, inline editing) instead of navigating away or stacking modals.
5. **Provenance is visible.** Entry IDs, hull numbers, who uploaded it, when, and exact file locations are always one glance away.

## Accessibility & Inclusion
- WCAG 2.1 AA contrast for all text, including placeholders and muted metadata.
- Full keyboard use: Ctrl+K search, ↑/↓/Enter in results and the file tree, visible focus rings.
- Status is never color-only (color + text + dot).
- Respect `prefers-reduced-motion`.
- Korean-first copy.
