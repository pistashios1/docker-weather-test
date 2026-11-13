# Handoff spec: weather dashboard

Design handoff for `templates/weather_dashboard.html`, with `static/css/dashboard.css`
and `static/js/*`. It describes what the page must do so a change can be checked
against it.

## Overview

A single page where a person looks up the weather for a place: search for a
city or use their location, then read current conditions and the next twelve
hours. One column, no navigation. The result is the point of the page, so the
controls are kept to one row and the result sits directly below them.

## Layout

| Breakpoint | Layout |
| --- | --- |
| Wide, 36rem and up | Header: title left, unit toggle right. Search row: field, **Search**, **Use my location** link on one line. Details: three equal columns. Forecast: 12 cards in one row from 52rem, scrolls sideways below that. |
| Narrow, under 36rem | Header stacks. Search field is on its own line, **Search** and the **Use my location** link share the next. Details stack in one column. Hero wind aligns left. Forecast scrolls sideways. |

- Page content is at most 64rem wide. Cards are 40rem, the search card 52rem and the result panel 64rem, all centred.
- After a successful lookup, if the result starts in the lower part of the screen (below 55% of the viewport height) it is scrolled into view. It uses an instant jump when the system asks for reduced motion.

## Design tokens

Defined as CSS custom properties at the top of `dashboard.css`. Use tokens, not values.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | #eef4f8 | #0f1720 | Page |
| `--color-surface` | #ffffff | #18232e | Cards |
| `--color-surface-sunken` | #f3f7fa | #121c25 | Inputs, forecast cards |
| `--color-text` | #17212b | #e8eef3 | Body |
| `--color-muted` | #52606d | #9fb0bf | Secondary text |
| `--color-border` | #c4d1db | #2e3f4e | Decorative dividers only |
| `--color-border-strong` | #7a8995 | #6b7f90 | Control boundaries (3:1 or better) |
| `--color-primary` | #1769aa | #5eb1f0 | Primary button, links, selected toggle |
| `--color-danger` | #b42318 | #ff9a8f | Errors |
| `--color-map-line` | 12% ink | 16% light | Background map lines |
| `--space-1` to `--space-6` | 0.25, 0.5, 0.75, 1, 1.5, 2.5 rem | | Spacing scale |
| `--radius-sm`, `-md`, `-pill` | 0.4rem, 0.75rem, 999px | | Radii. Buttons and toggles are pills. |
| `--motion-fast`, `--motion-base` | 150ms, 250ms | | Transitions |

Type: Space Grotesk (variable, self-hosted from `static/fonts`, with a system
fallback) for everything except the page title, which is Times New Roman
(`--font-title`). The title is `clamp(1.75rem, 5vw, 2.25rem)`; the temperature is
`clamp(3.5rem, 16vw, 5.5rem)`, bold, with tabular numbers. The accented-character
subset loads only when a place name needs it.

## Components and states

### Result panel

One element whose `data-state` selects what is visible.

| State | Shows | Announced |
| --- | --- | --- |
| `empty` | "No weather loaded yet" and a hint | |
| `locating` | "Finding your location…" and a permission hint (static, no animation) | "Requesting your location…" |
| `loading` | Skeleton blocks, fading in only after 300ms so quick responses never flash | "Loading weather…" |
| `error` | Message in danger colours and a **Try again** button | Immediately (`role="alert"`) |
| `ready` | Place, hero, details, forecast | "Weather loaded for {place}: {temperature}, {condition}, wind {speed}." |

Error text comes from the server as a short lowercase phrase and is shown as a
sentence ("Weather service unavailable."). Timeouts show "The request timed
out. Check your connection and try again."

### Hero

White text on a gradient chosen by `data-condition` (clear, cloudy, rain, snow,
storm, fog), falling back to `data-tone` by temperature (freezing 32°F and
below, cool to 55, mild to 75, warm to 90, hot above). Left: label, condition,
temperature. Right: wind. Every gradient stop, including the decorative glow,
keeps white text at 4.7:1 or better.

### Search (ARIA combobox)

| Element | State | Behaviour |
| --- | --- | --- |
| Field | Typing | After 250ms without typing, search. Popup shows "Searching places…". |
| Popup | Results | Up to 10 options: name, then region and country in small text. |
| Popup | No results | "No matching places found." |
| Popup | Failure | "Search is unavailable right now. Try again in a moment." |
| Option | Highlighted | Background change and a 2px focus-colour outline. Hover also changes the background. |
| Search button | Disabled while weather is loading | Cursor shows progress. |

A new search cancels the previous one. Picking an option fills the field with the place name and loads its weather.

### Other controls

- **Use my location**: a text link, not a button. No border, underlined, 70% opacity in the text colour (not the blue, which would drop to 3.2:1; the text colour keeps 5.7:1 or better). Full opacity on hover and keyboard focus, and 44px tall. Falls back to New York if permission is denied or unanswered for 8 seconds.
- **Unit toggle**: radio group styled as a segmented pill. Remembered in `localStorage` (`weather-units`). Converting is done in the browser from °F and mph.
- **Animate background**: switch (`role="switch"`) in the footer. Remembered (`weather-map-animation`). Hidden when the system asks for reduced motion.

## Interactions

| Input | Result |
| --- | --- |
| Enter in the field | Search now (or pick the highlighted option) |
| Down or Up arrow | Open the popup if it has results, and move the highlight (wraps) |
| Escape | Close the popup, focus stays in the field |
| Click outside the popup | Close it |
| Change units | Re-render immediately with no new request |

## Motion

| Element | Trigger | Animation | Duration | Easing |
| --- | --- | --- | --- | --- |
| Background map | Always, unless paused or reduced motion | Slides left by one map width | 300s, linear, repeating | linear |
| Skeleton | Loading longer than 300ms | Fade in, then slow opacity pulse | 200ms in, 2s pulse | ease-out, ease-in-out |
| Toggle and switch | Change | Colour and knob move | 150ms | `--ease` |
| Hero background | Condition change | Gradient transition | 250ms | `--ease` |

Under `prefers-reduced-motion: reduce`, animations and transitions are
effectively instant and the map does not move.

## Background map

`static/img/world-map.svg`: coastlines from Natural Earth 1:110m, equirectangular,
360° of longitude by 142° of latitude (84°N to 58°S, Antarctica omitted), with a
graticule every 30° and the equator and tropics dashed. It is used as a CSS mask
so the line colour follows the theme. The track is one map wider than the
viewport and slides by exactly one map width, so the loop is seamless. Rebuild it
with `scripts/build-world-map.mjs`.

## Edge cases

- **Long place names** wrap (`overflow-wrap: anywhere`).
- **Missing hourly data**: the forecast shows "Hourly forecast unavailable."
- **Unknown weather code**: shown as "Weather" with a thermometer icon and a tone gradient.
- **Rain, humidity and UV** are clamped to zero or more.
- **Incomplete weather payload**: shows "The weather service returned incomplete data."
- **Rate limited**: "Too many requests. Try again in N seconds."
- **Storage blocked or empty**: every `localStorage` call is wrapped, and the page works without it.
- **No JavaScript**: a notice explains the page needs it.

## Accessibility

- Landmarks: header, main, footer. The result panel is a labelled section with a hidden heading.
- Focus order: unit toggle, search field, **Search**, **Use my location**, then (when shown) **Try again**, then the background switch.
- Focus is always visible: a 3px outline in `--color-focus`.
- All interactive controls are at least 44px tall (WCAG 2.5.5).
- Contrast: text meets 4.5:1 everywhere measured, including muted text over the faintest map line (4.6:1 light, 5.2:1 dark). Control borders are 3:1 or better.
- The map is `aria-hidden`, cannot be focused or clicked, and can be paused (WCAG 2.2.2).
- Status messages go through one polite live region; errors use `role="alert"`. Nothing is announced twice.
- Automated check: axe-core (WCAG 2.0, 2.1 A and AA, plus best practices) reports zero violations in light and dark, with the popup closed and open. Contrast over the map and gradients cannot be computed by axe, so it was measured by hand. It has not been tested with a screen reader.
