# CLAUDE.md

Weather Lookup: a Flask app (`app/`) with a plain ES-module dashboard (`public/static/`, no build step). It runs on gunicorn in Docker and as a Vercel function.

Read these before working here:
- [README.md](README.md): features, API reference, env vars, layout, deploy checklist.
- [docs/design-system.md](docs/design-system.md): tokens, components, contrast numbers.
- [docs/design-handoff.md](docs/design-handoff.md): layout, states, keyboard and accessibility spec.

## Commands

`python` and `ruff` are not on PATH. Use the venv binaries. These forms work in Git Bash and in PowerShell.

```bash
.venv/Scripts/python -m pytest                     # add --cov for the 95% coverage floor CI enforces
.venv/Scripts/ruff check .
node --test "tests/js/*.test.mjs"
cd tests/e2e && npx playwright test
cd tests/e2e && npx playwright install chromium   # first run or after a Playwright bump
.venv/Scripts/python -m app.weather_app           # dev server on :5000, PORT overrides
```

- Playwright starts the app with `.venv`'s Python on port 5055. `E2E_PORT` overrides the port; in PowerShell set it with `$env:E2E_PORT = "5070"`.
- Don't use port 5060 or 5061: Chromium refuses them with `ERR_UNSAFE_PORT`.

## Gotchas

**Backend**
- Every provider payload is validated in `app/api_contracts.py`. A bad payload means a 502.
  - `OPTIONAL_CURRENT_FIELDS` may be null, and the page shows `--` for them.
  - `_is_number` rejects bools.
- The backend always requests °F and mph. The browser converts units in `format.js`.
- Adding a current field: update the `current=` string in `weather_app.py` and `CURRENT_FIELDS` or `OPTIONAL_CURRENT_FIELDS` in `api_contracts.py`.
- Adding a daily field: add it to `DAILY_FIELDS` only, because the request is built from that tuple.
- For either kind of field, also update the Python tests, `weatherPayload` in `tests/e2e/helpers.mjs`, the rendering in `render.js`, and the README's `/weather` example.
- Keep the two import lists in `weather_app.py` (`if __package__` / `else`) identical.
- Keep `requirements.txt` and `pyproject.toml` versions identical (a test enforces it). `gunicorn` lives only in `requirements.txt`, because Vercel doesn't use it.
- Caches and the rate limiter are in memory, per process. They aren't shared between workers or Vercel instances.

**Frontend**
- The CSP is strict (`default-src 'self'`).
  - No inline `<script>` or `<style>`, and no `style=` attributes.
  - Set dynamic values from JS with `el.style.setProperty("--var", …)`.
  - Self-host every font and image.
- Search box: a place is picked only by clicking or tapping an option, pressing Enter, or the Search button. Blur, a tap elsewhere, or a scroll never picks one.
- After every await in the location flow, check `attempt !== locationAttempt`, so a stale lookup can't overwrite a newer pick.
- localStorage keys and lifetimes:
  - `last-location`: 30 days.
  - `user-location`: 15 minutes.
  - `recent-places`: 5 entries.
  - `weather-units` and `weather-map-animation`.

**Tests**
- Python tests patch `app.weather_app.requests.Session.get`. Use `create_app(AppConfig(...))` for config variants.
- E2E `mockApi(page, { location, weather })` mocks the app's own `/weather`, `/search` and `/location` routes, not the providers. `/reverse-location` is not mocked.
- Time: `page.clock.setFixedTime` freezes it. Anything that ticks needs `page.clock.install` plus `runFor`.
- `print.spec.mjs` asserts one A4 page and one Letter page. Re-run it after any layout change.

## Workflow and design

- Branch flow: feature branch → PR into `dev` → PR `dev` → `main`. Never commit to `main`. Delete feature branches after they merge.
- Vercel deploys `main` to https://docker-weather-test.vercel.app. Deploys from `dev` are turned off.
- WCAG 2.1 AA:
  - 4.5:1 for text and 3:1 for large text and control borders.
  - 44 px touch targets.
  - A 3 px `--color-focus-ring` on everything focusable.
- Add a token before a value's second use. Never hard-code hex in components.
- The hero stays opaque. Only large text goes in its top-right corner, which drops to 4.0:1 on day tones.
- Glass needs its fallbacks for `prefers-reduced-transparency` and for browsers without `backdrop-filter`.
- When the look changes, refresh `docs/dashboard.png`. The README explains how.
