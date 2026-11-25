# Weather Lookup design system

The tokens and components behind the dashboard. Everything lives in
[`public/static/css/dashboard.css`](../public/static/css/dashboard.css); the layout,
states and
interaction spec is in [`design-handoff.md`](design-handoff.md). Dark mode is
automatic (`prefers-color-scheme`), and every token below has a dark value.

## Principles

1. **Tokens first.** Colours, spacing, type sizes and motion come from custom
   properties on `:root`. Components do not invent values.
2. **One column.** The header, search card and result card share one width
   (`--column-width`) so their edges line up.
3. **Accessible by construction.** Text is 4.5:1 or better, control borders
   3:1 or better, touch targets 44 px or larger, motion can be paused.
4. **Glass, kept slight.** Cards and small controls are frosted glass: about half
   see-through, with a 4 px blur, so the map shows through faintly. Anything
   that carries long text or must stay readable at a glance (menus, the toast, the
   hero) is opaque or nearly so. Glass turns opaque when the visitor asks for
   reduced transparency.

## Tokens

### Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#eef4f8` | `#0f1720` | Page background |
| `--color-surface` | `#ffffff` | `#18232e` | Cards |
| `--color-surface-sunken` | `#f3f7fa` | `#121c25` | Inputs, forecast cards |
| `--color-text` | `#17212b` | `#e8eef3` | Body text |
| `--color-muted` | `#52606d` | `#9fb0bf` | Secondary text |
| `--color-border` | `#c4d1db` | `#2e3f4e` | Decorative dividers only |
| `--color-border-strong` | `#7a8995` | `#6b7f90` | Control boundaries (3:1) |
| `--color-primary` / `-hover` | `#1769aa` / `#12578f` | `#5eb1f0` / `#82c3f5` | Buttons, selection, focus |
| `--color-on-primary` | `#ffffff` | `#08202f` | Text on primary |
| `--color-danger` / `-bg` | `#b42318` / `#fef3f2` | `#ff9a8f` / `#3a1a17` | Error text and panel |
| `--color-focus-ring` | 60 % `#1769aa` | 60 % `#82c3f5` | Every focus ring: 3 px outline |
| `--color-map-line` | 12 % ink | 16 % ink | Background map outline |
| `--color-glass` | white 54 % | `#18232e` 52 % | Cards, unit toggle, switch |
| `--color-glass-strong` | white 97 % | `#18232e` 97 % | Toast |
| `--color-glass-edge` | white 75 % | white 14 % | 1 px card edge and top highlight |
| `--color-glass-sheen` | white 40 % | white 6 % | Diagonal sheen on the top-left of a card |
| `--color-field` | `#f3f7fa` 80 % | `#121c25` 80 % | Search field |
| `--glass-blur` | `blur(4px) saturate(130%)` | same | Backdrop of every glass surface |
| `--shadow-glass` | card shadow + 1 px top highlight | darker shadow, 14 % highlight | Glass card elevation |
| `--color-night-shade` | navy `#080c20` at 40 % | same | Shade over the hero tone at night |
| `--color-on-hero` | `#ffffff` | same | Hero text on every tone |
| `--color-marker` / `--color-marker-halo` | `#1769aa` / 22 % blue | `#ffffff` / 18 % white | Location marker dot and ring |
| `--marker-opacity` | 0.9 | 0.45 | Marker opacity (see "Glass and contrast") |

### Hero palette

The result panel's gradient is set by two attributes written by `render.js`:
`data-tone` (temperature: freezing, cool, mild, warm, hot) and
`data-condition` (clear, cloudy, rain, snow, storm, fog). The condition wins
when both are present. Each defines `--tone-a` and `--tone-b`. White text on
every stop is at least 4.9:1 on its own; keep that when you add or change one.

`data-daylight` (from Open-Meteo's `is_day`) switches between two treatments of
the same tone:

| | Day | Night |
| --- | --- | --- |
| Layers | sun glow (12 % white, top right, behind the high/low) over the tone | 4 faint stars and a moon (16 % white disc, 5 % halo, at 64 % / 30 %, clear of the high/low) over `--color-night-shade` over the tone |
| Worst white-text contrast, at the glow or moon centre | 4.0:1 (warm `#a65f06`, cool `#237b82`) | 5.9:1 |

The day glow's centre is below 4.5:1 on the two lightest stops. The only text in
the top-right corner is the high/low (`.hero-range`). It is large text
(`--text-lg`, 600, so 21.6 px bold), which needs 3:1, and 4.0:1 clears that. Keep
small text out of that corner. A missing `is_day` keeps the day look.

### Type

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 0.75rem | Forecast condition captions |
| `--text-sm` | 0.9rem | Labels, meta, small controls, detail sub-lines, feels-like line |
| `--text-md` | 1.15rem | Condition, detail values, forecast temperature, forecast heading |
| `--text-lg` | 1.35rem | Location name, hero high/low, single-number detail values (`.detail-big`) |
| `--text-xl` | 1.5rem | Wind value |

Weights: 400 (body and detail sub-lines), 600 (headings, condition, detail
values, the title), 700 (buttons, temperature, wind value, forecast
temperatures). The `300 700` in the `@font-face` rules is just the variable
font's available range; no rule uses 300.

Display sizes (the page title and the temperature) use a fluid `clamp()` so
they scale with the viewport. `--font-sans` is Space Grotesk Variable
(self-hosted); `--font-title` is Newsreader 600 (self-hosted, Latin subset, about
24 KB) with Iowan Old Style, Palatino and Georgia as fallbacks, and is used for
the `h1` only.

### Glass and contrast

Text on glass is measured against the worst case behind it, not against the
page colour. The probe hides every glyph, captures what is behind each text
element at 100 positions of the scrolling map, and takes the lowest contrast
against the text token. The marker is the worst offender (a bright dot behind
muted text), which is why it is dimmer in dark mode.

| Mode | Lowest text contrast measured | Limiting element |
| --- | --- | --- |
| Light | 4.6:1 | Subtitle on the bare page (a map line passes behind it) |
| Dark | 4.8:1 | Location line on glass with the marker behind it |

Before this change the dark-mode figure with a full-strength marker was 3.0:1.
If you change `--color-glass`, `--glass-blur` or `--marker-opacity`, measure
again; the floor is 4.5:1.

### Spacing, shape, motion

| Token | Value |
| --- | --- |
| `--space-1` … `--space-6` | 0.25, 0.5, 0.75, 1, 1.5, 2.5 rem |
| `--radius-sm` / `-md` / `-pill` | 0.4rem / 0.75rem / 999px |
| `--column-width` | 56rem |
| `--shadow-card` | Card elevation |
| `--shadow-glass` | Glass card elevation (shadow plus top highlight) |
| `--fade-size` | 2.5rem, width of the forecast's scroll-edge fade |
| `--motion-fast` / `--motion-base` | 150 ms / 250 ms |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)`, used by every transition and animation except the map's linear scroll |

## Components

| Component | Class or id | Variants | States covered |
| --- | --- | --- | --- |
| Page header | `.page-header` | one | stacks under 36rem |
| Button | `.btn` | primary, `.secondary` | hover, active (moves down 1 px), focus-visible, disabled |
| Link button | `.link-button` | one | 70 % opacity; 100 % on hover and focus; disabled 45 % |
| Segmented control | `.segmented` | units (2 options) | checked, focus-visible |
| Switch | `.switch` | one | on, off, focus-visible |
| Search combobox | `.search-input`, `.search-popup`, `.search-option` | one | closed, recent places, searching (keeps old results), results with matched-text underline and distance, no matches, error |
| Card | `.card` | search, result | n/a |
| Result panel | `#panel[data-state]` | empty, locating, loading, error, ready | five states |
| Hero | `.hero`, `.hero-side`, `.hero-range` | tone × condition × day/night | high/low top right ("H: 66°, L: 48°"), wind bottom right; on narrow the high/low stays in the corner and the wind wraps below |
| Details grid | `.details` | 8 tiles, plus Snowfall when snow is falling or expected today | value (`--text-md`, or `.detail-big` at `--text-lg` for single numbers), sub-line (`.detail-sub`), hidden rows, `--` for a missing value; no rule between the grid and the forecast (last-row lines clipped) |
| Daylight bar | `.daylight-track`, `.daylight-fill` | one | shown while the sun is up, filled to the share of daylight gone (`--daylight`, 0–1); hidden before sunrise, after sunset and when times are missing |
| Forecast card | `.forecast-card` | one | n/a |
| Forecast edge fade | `.forecast[data-fade-start]`, `[data-fade-end]` | one | start, middle, end of the scroll; absent when nothing overflows |
| Toast | `.toast`, `#toast` | one | shown, dismissed (button or after 8 s); close button hover |
| Footer | `footer` | one | credits and the animation switch; credits wrap under 36rem |
| Skeleton | `.skeleton` | big, default, short | gentle pulse, appears after 300 ms; stopped under reduced motion |

### Accessibility notes per component

- **Search combobox:** `role="combobox"` with `aria-controls`,
  `aria-expanded` and `aria-activedescendant`. Arrow keys move, Enter picks,
  Escape closes; focus never leaves the input.
- **Result panel:** `aria-busy` while loading; the error block is
  `role="alert"`; a separate `role="status"` region announces results.
- **Switch:** `role="switch"` with `aria-checked`; the choice is remembered.
- **Background map:** `aria-hidden`, paused by the switch, off when the visitor
  prefers reduced motion. On desktop, the location marker sits inside the map
  track, uses the weather response coordinates, and is hidden below 36rem. There
  is one marker per repeat of the world (8), so wide screens never show a bare
  copy.
- **Forecast strip:** a side fades only while there is more to scroll that way.
  A mask would clip the strip's own focus ring, so the ring is drawn on the
  surrounding section (`:has()`), with the strip's own outline as the fallback.
- **Glass:** opaque under `prefers-reduced-transparency: reduce`, and wherever
  the browser cannot blur the backdrop.
- **Focus:** every focusable element, search options included, shows the same
  3 px `--color-focus-ring` outline.
- **Details grid:** a `dl`; a tile with a sub-line uses one `dt` and several
  `dd`s. Hidden rows use the `hidden` attribute, so they are skipped by screen
  readers too. The wind arrow is `aria-hidden`; the direction is read from the
  text ("from SW").
- **Hero high/low:** the "H:" and "L:" letters are `aria-hidden`, and visually
  hidden "High" / "Low" words stand in, so it reads "High 66°, Low 48°".
- **Daylight bar:** `aria-hidden`; the sub-line ("4 h 30 min of daylight left")
  carries the same information as text.

## Print

`@media print` at the end of `dashboard.css` overrides the colour tokens to
black on white and turns off blur and shadows, so the page prints the same in
light and dark mode. The map, marker, search card, unit toggle, subtitle,
toast, animation switch and **Try again** are hidden. The hero loses its
gradient (day or night), because browsers skip backgrounds by default and its
white text would vanish, and gets a top and bottom rule instead.

The goal is one quiet sheet that fits a single A4 or Letter page:

| Element | Print treatment |
| --- | --- |
| Page | `@page { margin: 15mm }`; root type at 87.5% |
| Result card | No border, radius or shadow; the page margin is the frame |
| Title | Indented `--space-5` to line up with the card content |
| Hero | Smaller block padding (`--space-4`), temperature at 4rem |
| Details | 4 fixed columns, no dividers |
| Forecast | Even 6 × 2 grid; dividers between columns only (none at a row start) |

## Do and don't

### Do

- Add a token before a second use of a new value.
- Use `--color-border-strong` on controls.
- Check white-on-gradient contrast when editing hero stops.
- Keep new cards in `--column-width`.
- Use `--color-surface` (opaque) for menus that open over content, as the search
  list does; at 97 % even large text behind a menu still ghosts through.
- Give a new glass card a higher `z-index` if it opens a menu: `backdrop-filter`
  makes each card its own stacking context (see `.search-card`).

### Don't

- Hard-code a hex colour in a component.
- Use `--color-border` on a control edge.
- Lighten a stop without re-measuring.
- Give a card its own max-width.
- Put a mask on a focusable element without moving its focus ring.
- Make the hero translucent: its white text only just clears 4.5:1.

## Known gaps

- Hero stops are literal hex values on the `data-tone` and `data-condition`
  selectors, not named tokens. The night hero's star and moon alphas are
  literal too.
- The day glow's centre is 4.0:1 on the lightest hero stops (see Hero palette).
- Two one-off values stay literal under the "token before a second use" rule:
  the segmented control's 2 px inset and the skeleton's 0.2 s / 2 s timings.
- Display font sizes are `clamp()` values rather than tokens.
- The disabled "Use my location" link is not contrast-checked (disabled
  controls are exempt from WCAG 1.4.3).
