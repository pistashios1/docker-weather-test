# Handoff spec: weather dashboard

Design handoff for `app/templates/weather_dashboard.html`, with
`public/static/css/dashboard.css` and `public/static/js/*`. It describes what the page
must do so a change can be checked
against it.

## Overview

A single page where a person looks up the weather for a place: search for a
city or use their location, then read current conditions, today's summary
(high and low, chance of rain, UV peak, sunrise and sunset) and the next twelve
hours. One column, no navigation. The result is the point of the page, so the
controls are kept to one row and the result sits directly below them.

## Layout

| Breakpoint | Layout |
| --- | --- |
| Wide, 36rem and up | Header: title left, unit toggle right. Search row: field, **Search**, **Use my location** link on one line. Details: tiles at least 11rem wide, as many columns as fit (4 at the full 56rem column, so 7 tiles make rows of 4 and 3). Forecast: 12 cards in one row from 52rem, scrolls sideways below that. |
| Narrow, under 36rem | Header stacks. Search field is on its own line, **Search** and the **Use my location** link share the next. Details: tiles at least 8.5rem wide, so two columns on a phone. Hero wind aligns left and sits below the temperature. Forecast scrolls sideways. |

- Header, search card and result card share one column, at most 56rem wide (`--column-width`), centred.
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
| `--color-focus-ring` | #1769aa at 60% | #82c3f5 at 60% | Every focus ring (3px outline) |
| `--color-night-shade` | #080c20 at 40% | same | Shade over the hero at night |
| `--color-map-line` | 12% ink | 16% light | Background map lines |
| `--color-glass` | white 54% | #18232e 52% | Cards and small controls (frosted, 4px blur) |
| `--color-glass-strong` | white 97% | #18232e 97% | Toast (the search menu is opaque `--color-surface`) |
| `--color-marker` | #1769aa | #ffffff | Location marker (opacity 0.9 / 0.45) |
| `--space-1` to `--space-6` | 0.25, 0.5, 0.75, 1, 1.5, 2.5 rem | | Spacing scale |
| `--radius-sm`, `-md`, `-pill` | 0.4rem, 0.75rem, 999px | | Radii. Buttons and toggles are pills. |
| `--motion-fast`, `--motion-base` | 150ms, 250ms | | Transitions |

Type: Space Grotesk (variable, self-hosted from `public/static/fonts`, with a system
fallback) for everything except the page title, which is Newsreader 600 (self-hosted)
(`--font-title`). The title is `clamp(1.75rem, 5vw, 2.25rem)`; the temperature is
`clamp(3.5rem, 16vw, 5.5rem)`, bold, with tabular numbers. The accented-character
subset loads only when a place name needs it.

## Components and states

### Result panel

One element whose `data-state` selects what is visible.

| State | Shows | Announced |
| --- | --- | --- |
| `empty` | "No weather loaded yet" and a hint | |
| `locating` | "Finding your location…" and a permission hint (static, no animation); shown when the browser permission prompt is open | "Requesting your location…" |
| `loading` | Skeleton blocks, fading in only after 300ms so quick responses never flash | "Loading weather…" |
| `error` | Message in danger colours and a **Try again** button | Immediately (`role="alert"`) |
| `ready` | Place, hero (with feels-like, high/low, wind direction), details grid, forecast | "Weather loaded for {place}: {temperature}, {condition}, wind {speed}." |

Error text comes from the server as a short lowercase phrase and is shown as a
sentence ("Weather service unavailable."). Timeouts show "The request timed
out. Check your connection and try again."

### Hero

White text on a gradient chosen by `data-condition` (clear, cloudy, rain, snow,
storm, fog), falling back to `data-tone` by temperature (freezing 32°F and
below, cool to 55, mild to 75, warm to 90, hot above).

| Side | Content | Example |
| --- | --- | --- |
| Left | Label, condition (icon and name), temperature, then one `--text-sm` line | "Feels like 58° · High 66° · Low 48°" |
| Right (below on narrow) | "Wind", speed, then an arrow and direction in `--text-sm` | "7.0 mph", "↗ from SW" |

- **Feels like** is `apparent_temperature`. **High / Low** are today's `temperature_2m_max` / `_min`. All three follow the unit toggle.
- **Wind direction** is where the wind comes from, as one of 16 compass points ("from SW"). The arrow points the opposite way, which is where the wind is blowing. It is rotated by `--wind-rotate` (set by `dashboard.js`), is `aria-hidden`, and is hidden when the direction is missing.
- **Day and night** follow Open-Meteo's `is_day` (`data-daylight="day"` or `"night"` on `#panel`; missing means day).
  - **Day:** the tone gradient with a soft sun glow at the top right.
  - **Night:** the same tone shaded 40% toward navy (`--color-night-shade`), a moon (a 16% white disc with a 5% halo) where the sun glow was, and four 1px stars in the top-right corner.
  - Night only makes white text more readable: the worst case is 5.9:1, even on the moon. On day, each stop is 4.9:1 or better on its own, but the sun glow's centre drops the two lightest stops to 4.0:1. Keep text out of the top-right corner.

### Details grid

A `dl` of tiles below the hero. Each tile has a label (`dt`, `--text-sm`,
muted), a value (`dd`, `--text-md`, 600, tabular numbers) and optional
sub-lines (`dd.detail-sub`, `--text-sm`, 400, muted). Padding is
`--space-3` × `--space-5` (`--space-4` sideways on narrow). Tiles are divided by
1px `--color-border` lines on their left and bottom. A part-filled last row
leaves blank space, not a broken line.

"Today" is the daily row whose start (local midnight) is the last one at or
before the current time.

| Order | Label | Value | Sub-lines | Units (°F · mph / °C · km/h) | Source | Shown |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Precipitation | "40% chance" | "1.2 mm today"; "Raining now: 0.4 mm" | mm in both | daily `precipitation_probability_max`, `precipitation_sum` (rain, showers and snow combined); current `rain` | Always. The "Raining now" line only when current `rain` is above 0 |
| 2 | Snowfall | "2.1 cm today", or "0.3 cm now" if there's no daily total | none | cm in both | daily `snowfall_sum`, current `snowfall` | Only when either is above 0 |
| 3 | Humidity | "55%" | none | % | current `relative_humidity_2m` | Always |
| 4 | Dew point | "45°" | none | °F / °C | current `dew_point_2m` | Always |
| 5 | Pressure | "29.92 inHg" / "1,013 hPa" | none | inHg (2 decimals) / hPa (whole) | current `pressure_msl` (sea level) | Always |
| 6 | Visibility | "15 mi" / "24 km" | none | mi / km; 1 decimal under 10, whole from 10 | current `visibility` (metres) | Always |
| 7 | UV index | "3.1 / 5.0": current in the value style, "/ 5.0" muted (400) | "Now / today's max · Moderate" (WHO level of the current reading, rounded to a whole number first as the WHO scale is: Low 0–2, Moderate 3–5, High 6–7, Very high 8–10, Extreme 11+) | none | current `uv_index`, daily `uv_index_max` | Always; a missing side shows `--`, and the level is left off when the current reading is missing |
| 8 | Sunrise and sunset | "Sunrise 7:00 AM" | "Sunset 4:30 PM" | the place's local time | daily `sunrise`, `sunset` (Unix, shown in the response's `timezone`) | Always |

**Why these choices:**
- Precipitation leads with the chance of rain because that's what people act on. The total underneath is the whole day's precipitation, snow included.
- "Raining now" appears only while it rains, so a dry day has one less line.
- UV shows the current reading next to today's peak: the current value alone reads 0 all night, while the peak says what the day will bring.
- Precipitation and snow stay in mm and cm under both settings because the unit toggle's labels name only temperature and wind.

### Search (ARIA combobox)

| Element | State | Behaviour |
| --- | --- | --- |
| Field | Empty, focused or clicked | Popup lists up to 5 **Recent places** (`recent-places` in `localStorage`), if there are any. |
| Field | 1 character | Popup closes. No message: one letter is not an error. |
| Field | Typing 2+ characters | After 250ms without typing, search. The first time, the popup shows "Searching places…". Later searches keep the previous results on screen until the new ones arrive, so the list doesn't flicker. |
| Popup | Results | Up to 10 options. Each option has the name in 600 weight, with the typed part underlined (case- and accent-insensitive: "sao" marks "São"). Below it is the region and country in `--text-sm` muted. The distance from the place being viewed ("716 mi" / "1,153 km", following the unit toggle) is muted on the right. Options are at least 44px tall. |
| Popup | No results | `No places match "…". Check the spelling, or add a region or country, like "Paris, France".` |
| Popup | Failure | "Search is unavailable right now. Try again in a moment." |
| Popup | Scrolled | Scrolling stays inside the list (`overscroll-behavior: contain`). On phones it is at most `min(20rem, 45dvh)` tall, which leaves room for the keyboard. |
| Option | Highlighted | Background change and the 3px `--color-focus-ring` outline used everywhere else. Hover also changes the background. |
| Search button | Disabled while weather is loading | Cursor shows progress. |

A place is picked only by a deliberate action: clicking or tapping an option, Enter, or **Search**. Pressing or tapping anywhere else closes the popup and picks nothing. A swipe that scrolls the list never picks, because browsers send no click after a scroll. Picking clears the field, since the place name already heads the result card, so the next search starts from an empty field. After a tap, focus leaves the field so the phone keyboard closes and the weather is visible. The field is a normal text field: tapping places the caret, and nothing selects or wipes the text.

A new search cancels the previous one. The field turns off autocorrect, auto-capitalisation and spellcheck, and sets `enterkeyhint="search"`.

### Other controls

- **Use my location**: a text link, not a button. No border, underlined, 70% opacity in the text colour (not the blue, which would drop to 3.2:1; the text colour keeps 5.7:1 or better). Full opacity on hover and keyboard focus, and 44px tall. The first successful lookup is cached as `user-location`; later uses and refreshes reuse it without reopening the permission prompt. The last place picked (search or this link) is kept for 30 days as `last-location` and opens first on a return visit. Otherwise the start-up order is: a silent IP-based estimate (`/location`, shown with the normal loading skeleton and no extra message); if that fails, the browser permission prompt straight away; if permission is denied or the position is not found, New York plus a dismissible toast saying only "Location permission was denied." (or "Your location could not be found."). Clicking this link goes straight to the permission prompt. If it is denied or fails, the same toast appears, and the place already on screen (usually the IP estimate) stays. With nothing on screen it falls back to the IP estimate, and New York only when that is unavailable too.
- **Unit toggle**: radio group styled as a segmented pill. Remembered in `localStorage` (`weather-units`). Converting is done in the browser from °F and mph.
- **Animate background**: switch (`role="switch"`) in the footer. Remembered (`weather-map-animation`). Hidden when the system asks for reduced motion.

## Interactions

| Input | Result |
| --- | --- |
| Enter in the field, or **Search** | Pick the highlighted option; otherwise pick the best match, waiting for the results if they have not arrived yet |
| Down or Up arrow | Open the popup if it has results, and move the highlight (wraps) |
| Escape | Close the popup, focus stays in the field. If it is already closed, clear the field. |
| Press or tap outside the popup | Close it without picking anything |
| Tab out of the field | Close the popup. Closing a phone keyboard leaves it open so the results can be read. |
| Change units | Re-render the hero, every detail and the forecast immediately, with no new request |

## Motion

| Element | Trigger | Animation | Duration | Easing |
| --- | --- | --- | --- | --- |
| Background map | Always, unless paused or reduced motion | Slides left by one map width | 300s, linear, repeating | linear |
| Skeleton | Loading longer than 300ms | Fade in, then slow opacity pulse | 200ms in, 2s pulse | `--ease` |
| Toggle and switch | Change | Colour and knob move | 150ms | `--ease` |
| Button | Press | Moves down 1px | instant | n/a |
| Hero background | Condition or day/night change | Swaps instantly. CSS cannot animate between gradients, so the 250ms `background` transition has no visible effect. | n/a | n/a |

Under `prefers-reduced-motion: reduce`, animations and transitions are
effectively instant and the map does not move.

## Background map

`public/static/img/world-map.svg`: coastlines from Natural Earth 1:110m, equirectangular,
360° of longitude by 142° of latitude (84°N to 58°S, Antarctica omitted), with a
graticule every 30° and the equator and tropics dashed. It is used as a CSS mask
so the line colour follows the theme. The track is one map wider than the
viewport and slides by exactly one map width, so the loop is seamless. Rebuild it
with `scripts/build-world-map.mjs`. On desktop, a marker is projected into the
same track from the latitude and longitude returned by the weather response:
`x = (longitude + 180) / 360` and `y = (84 - latitude) / 142`, clamped to the
tile bounds. The tile has a fixed size (`--tile-height: 44rem` on `.map-track`),
independent of the viewport, so resizing the window or a browser prompt never
rescales or re-seeks the map. The script only publishes the two ratios as
`--marker-x` / `--marker-y`; CSS places the marker with `left = x * --tile-width`
and `top = y * --tile-height`, the same variables the map is drawn with, so the
two cannot drift apart. It appears after a successful weather load inside the map track,
scrolls with the map, and pauses with it. The marker is hidden below 36rem. It is
a dot with a soft halo: blue in light mode, a dimmer white in dark mode (so text
on the glass above it keeps 4.5:1). The map repeats every 360°, so
`map-marker.js` adds one marker per repeat (`MARKER_COPIES = 8`, enough for about
14,000 CSS pixels of width); each is offset by `--marker-index` tiles in CSS.
The projection and marker lifecycle live in `public/static/js/map-marker.js`; its
visual treatment is isolated in `public/static/css/map-marker.css`.

## Glass, edge fade and focus

Cards and small controls are frosted glass over the map (see
[`design-system.md`](design-system.md#glass-and-contrast) for the numbers). The
hourly forecast fades at a side only while it can scroll that way:
`scroll-fade.js` sets `data-fade-start` / `data-fade-end` from the scroll
position, the strip's size and its content, and CSS masks the strip. The strip's
visible width is `offsetWidth`, not `clientWidth`, because the reserved scrollbar
gutter would otherwise leave the end fade on. When the strip is focused, the
focus ring is drawn around the whole forecast section.

## Edge cases

- **Long place names** wrap (`overflow-wrap: anywhere`).
- **Missing hourly data**: the forecast shows "Hourly forecast unavailable."
- **Unknown weather code**: shown as "Weather" with a thermometer icon and a tone gradient.
- **Precipitation, snow, humidity, visibility and UV** are clamped to zero or more.
- **A missing or null detail** (some weather models leave out visibility, the daily block or `is_day`) shows `--` for that detail only. The weather still loads. Snowfall and "Raining now" stay hidden.
- **Long sub-lines** ("Raining now: 12.4 mm") wrap inside their tile.
- **Wind direction missing**: the arrow is hidden and the text reads `--`.
- **Rate limited**: "Too many requests. Try again in N seconds."
- **Storage blocked or empty**: every `localStorage` call is wrapped, and the page works without it.
- **No JavaScript**: a notice explains the page needs it.
- **Printing**: one A4 or Letter page, black on white with no backgrounds, 15mm margins, type at 87.5%. The map, marker, glass, search card, unit toggle, subtitle and animation switch are hidden. There is no card frame: the title, place, hero, details and forecast share one left edge, with single rules above and below the hero and above the forecast. Details are 4 plain columns with no dividers. The forecast is an even 6 × 2 grid with dividers only between columns. Day and night print the same.

## Accessibility

- Landmarks: header, main, footer. The result panel is a labelled section with a hidden heading.
- Focus order: unit toggle, search field, **Search**, **Use my location**, then (when shown) **Try again**, then the background switch.
- Focus is always visible: a 3px outline in `--color-focus-ring`, on every control and search option.
- All interactive controls are at least 44px tall (WCAG 2.5.5).
- Contrast: text meets 4.5:1 everywhere measured, including muted text over the faintest map line (4.6:1 light, 5.2:1 dark). Control borders are 3:1 or better.
- The map is `aria-hidden`, cannot be focused or clicked, and can be paused (WCAG 2.2.2).
- Status messages go through one polite live region; errors use `role="alert"`. Nothing is announced twice.
- Automated check: axe-core (WCAG 2.0, 2.1 A and AA, plus best practices) reports zero violations in light and dark, with the popup closed and open. Contrast over the map and gradients cannot be computed by axe, so it was measured by hand. It has not been tested with a screen reader.
