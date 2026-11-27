# Weather Lookup

A Flask-based weather dashboard application that displays current conditions
and hourly forecasts from Open-Meteo API for any city or your current location.

**Live demo: <https://docker-weather-test.vercel.app/>**

- Starts with an approximate location from your IP address, so there is no
  permission prompt unless it is needed, or search for any city. Returning
  visitors land on the last place they picked.
- See the temperature with feels-like and today's high and low, wind speed and
  direction, chance of rain and precipitation, snowfall when it applies,
  humidity, dew point, visibility, pressure, UV now and today's peak, sunrise
  and sunset with a live daylight countdown, a twelve-hour forecast, and a
  7-day forecast.
- The banner follows the time of day at that place, with a night look after
  sunset.
- Switch between °F/mph and °C/km/h; your choice is remembered in the browser.
- Prints cleanly on one page (Ctrl+P / Cmd+P).
- Runs locally with Python or Docker. No account or API key is required.

![Weather Lookup dashboard for Budapest on a snowy day: the hero banner with temperature, feels-like, today's high and low in the top-right corner and wind direction, a grid of weather details including today's snowfall, sunrise, and a sunset daylight countdown with its progress bar, a twelve-hour forecast moving from drizzle to snow, a 7-day forecast with snow and rain chances, and the city search controls](docs/dashboard.png)
*The dashboard (New York in the afternoon, dark mode).*

## Try it in two minutes

```bash
docker build -t weather-lookup .
docker run --rm -p 5000:5000 weather-lookup
```

Open **<http://localhost:5000>** in your browser. For the Python option and
other ways to run the project, see [Quick start](#quick-start).

## Contents

- [Quick start](#quick-start)
- [Using the dashboard](#using-the-dashboard)
- [How it works](#how-it-works)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Deploying](#deploying)
- [Data sources and credits](#data-sources-and-credits)

## Quick start

You need either Docker, or Python 3.13 (the version the tests and the Docker
image use). Either way you are looking at the dashboard in about two minutes.

### Option 1: Docker

```bash
docker build -t weather-lookup .
docker run --rm -p 5000:5000 weather-lookup
```

### Option 2: Python

macOS or Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python -m app.weather_app
```

Windows (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
python -m app.weather_app
```

### Open it

Go to **<http://localhost:5000>** in your browser. Use `http://`, not
`https://`: the app does not serve TLS (see [Troubleshooting](#troubleshooting)).

To check that the server itself is up without a browser:

```bash
curl http://localhost:5000/healthz
# {"status":"ok"}
```

The server needs internet access, because the weather, city search and place
names come from public services (see [Data sources](#data-sources-and-credits)).

## Using the dashboard

| You want to | Do this |
| --- | --- |
| See the weather where you are | The page starts with an approximate spot based on your network. For a precise one, click **Use my location** next to the search box and allow the browser's prompt. |
| See the weather somewhere else | Type a city and press **Enter** or **Search** to go straight to the best match, or pick a suggestion. Each suggestion shows its region, country and distance from the place you are viewing. Add a region or country after a comma to narrow the list (`Paris, Texas`). Arrow keys move through suggestions; **Esc** closes the list, and pressing it again clears the field. |
| Go back to a place you looked at | Click or tap the empty search box: your last five picks are listed under **Recent places**. |
| Switch units | Use the **°F · mph** / **°C · km/h** toggle. Your choice is remembered in this browser. |
| Stop the moving background | Turn off **Animate background** at the bottom of the page. It is also off automatically if your system asks for reduced motion. |
| Print or save as PDF | Use your browser's print command. You get one page with the weather card as it looks on screen in the light theme (even if you use dark mode): the place, current conditions, details, all twelve hours and the 7-day forecast, without the map, search box or toggles. |

When the page opens it works out roughly where you are, in this order:

1. **IP estimate.** The server estimates your location from your IP address
   (city-level, and wrong for some VPNs and mobile networks). Nothing is shown
   about this step; weather simply appears.
2. **Browser permission.** If the estimate is not available, the page asks the
   browser for your location straight away.
3. **New York.** If you deny the prompt, or your position cannot be found, the
   dashboard shows New York and a short message ("Location permission was
   denied.") that you can dismiss.

Clicking **Use my location** skips step 1 and asks the browser for permission
directly. If you deny it (or the browser has location blocked), you get the same
message and the dashboard keeps the place it was already showing, usually the
IP estimate. With nothing on screen yet it uses the IP estimate, and New York
only when that is unavailable too. After a
successful lookup, the coordinates and resolved name are cached in this
browser for 15 minutes as `user-location`; later uses and refreshes reuse that
client-side location without asking again.

**Returning visitors.** The last place you picked, from search or **Use my
location**, is kept in this browser for 30 days as `last-location`. On your
next visit the dashboard opens there and skips all three steps above. The IP
estimate and New York are never saved, so they don't replace a place you chose.

Search results are ranked using what you typed, how close each place is to the
place you are viewing, how large it is, and the places you picked before. Your
recent picks are stored only in your browser.

### What the numbers mean

- **Temperature and wind** are current readings for the chosen coordinates.
  **Feels like** adds the effect of wind and humidity. **H: / L:** in the
  banner's top-right corner are today's high and low. The arrow shows which way
  the wind blows; the text says
  where it comes from ("from SW").
- **Precipitation** leads with today's highest hourly chance of rain, then
  today's total of rain, showers and snow in millimetres. "Raining now" appears
  only while it is raining.
- **Snowfall** appears only when snow is falling or expected today, in
  centimetres.
- **Humidity** is relative humidity; **Dew point** is the temperature at which
  the air would be saturated.
- **Pressure** is sea-level pressure, in inHg (°F · mph) or hPa (°C · km/h).
- **Visibility** is in miles or kilometres.
- **UV index** shows the current reading and today's peak, as "3.1 / 5.0", with the
  current level on the WHO scale (Low, Moderate, High, Very high or Extreme).
- **Sunrise** and **Sunset** are in the place's local time. Sunrise also shows
  today's day length. Sunset counts down the daylight that is left, with a bar
  showing how much of the day has gone. After dark it counts down to the next
  sunrise. The countdown keeps moving while the page is open.
- The hero banner switches to a **night** look (darker, with a moon) after
  sunset at that place.
- **Hourly forecast** shows the next twelve hours, starting with **Now**.
- **7-day forecast** lists today and the next six days. Each day shows an
  icon, the chance of precipitation on rainy or snowy days, the average
  temperature followed by the low and high, and the day's top wind speed and
  UV index.
- Any one value the weather model doesn't provide shows `--`. The server caches
  weather for 30 seconds.

## How it works

```text
Browser (public/static/ + app/templates/)
   |
   |  GET /location         approximate position from the visitor's IP
   |  GET /search           find a city by name
   |  GET /weather          current conditions, 7-day daily summary, hourly forecast
   |  GET /reverse-location turn browser coordinates into a place name
   v
Flask app (app/weather_app.py)  --  validates input, caches, rate limits
   |
   |--> Open-Meteo forecast   weather
   |--> Open-Meteo geocoding  city search
   |--> OpenStreetMap Nominatim   place name for browser coordinates
   v
JSON validated by app/api_contracts.py, then returned to the browser
```

The app is stateless and stores no weather data. Responses from the providers
are checked against a strict shape before they are passed on; if a provider
returns something unexpected, the app answers `502` instead of passing it
through.

## API reference

The dashboard uses these endpoints, and you can call them directly. All
responses are JSON. Errors look like `{"error": "message"}`.

### `GET /weather`

Current conditions, today's and tomorrow's summary, and the next hours of
forecast for a point.

| Parameter | Type | Required | Range |
| --- | --- | --- | --- |
| `latitude` | number | yes | -90 to 90 |
| `longitude` | number | yes | -180 to 180 |

```bash
curl "http://localhost:5000/weather?latitude=40.71&longitude=-74.01"
```

```json
{
  "latitude": 40.71,
  "longitude": -74.01,
  "timezone": "America/New_York",
  "current": {
    "time": 1794672000,
    "temperature_2m": 64.0,
    "apparent_temperature": 62.1,
    "wind_speed_10m": 8.4,
    "wind_direction_10m": 225,
    "weather_code": 2,
    "precipitation": 0.0,
    "rain": 0.0,
    "snowfall": 0.0,
    "relative_humidity_2m": 58,
    "dew_point_2m": 49.0,
    "pressure_msl": 1016.4,
    "visibility": 24140,
    "is_day": 1,
    "uv_index": 2.4
  },
  "hourly": {
    "time": [1794672000, 1794675600],
    "temperature_2m": [64.0, 64.0],
    "weather_code": [2, 2]
  },
  "daily": {
    "time": [1794632400, 1794718800],
    "weather_code": [2, 61],
    "temperature_2m_mean": [59.1, 55.4],
    "temperature_2m_max": [66.2, 61.0],
    "temperature_2m_min": [52.3, 49.8],
    "sunrise": [1794657600, 1794744060],
    "sunset": [1794693960, 1794780300],
    "uv_index_max": [3.1, 2.4],
    "precipitation_sum": [0.4, 0.0],
    "precipitation_probability_max": [20, 5],
    "snowfall_sum": [0.0, 0.0],
    "wind_speed_10m_max": [11.4, 15.2]
  },
  "source": "Open-Meteo"
}
```

- Temperatures are in °F, wind in mph, precipitation in millimetres, snowfall
  in centimetres, pressure in hPa and visibility in metres. The dashboard
  converts to metric itself.
- Times are Unix timestamps in seconds. `daily.time` is each day's local
  midnight, and `timezone` says which zone to show times in.
- `current` always has `time`, `temperature_2m`, `wind_speed_10m`,
  `weather_code`, `rain` and `relative_humidity_2m`. The other current fields,
  and `daily` as a whole, can be missing or `null` when the weather model
  doesn't provide them.
- `weather_code` is a [WMO weather code](https://open-meteo.com/en/docs#weathervariables).
  The dashboard turns it into a label such as *Clear*, *Rain* or *Thunderstorm*.
- `daily` holds up to 7 days, starting today (the example shows two).
- `hourly` holds up to 48 hours so the dashboard can show 12 consecutive
  hours even when the forecast crosses midnight.

### `GET /search`

Finds places by name. Returns up to 10 matches.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `q` | string | yes | A place name of at least two characters, optionally followed by one or more comma-separated regions, countries or two-letter country codes (`Paris, Texas`, `Paris, FR`, `Springfield, Illinois, US`). |
| `latitude`, `longitude` | number | no | Rank nearby places higher. Send both or neither. Defaults to New York. |
| `affinity` | string | no | Comma-separated names to favour, such as recent picks (first 10 are used). |

```bash
curl "http://localhost:5000/search?q=paris"
```

```json
{
  "results": [
    {
      "name": "Paris",
      "context": "Ile-de-France, France",
      "latitude": 48.85341,
      "longitude": 2.3488,
      "population": 2138551,
      "country_code": "FR",
      "distance_km": 5837
    }
  ]
}
```

`distance_km` is measured from `latitude`/`longitude` (New York by default),
rounded to whole kilometres.

How results are chosen and ordered:

1. Open-Meteo is asked for up to 20 places matching the name. Every valid
   match is ranked, not just the provider's first 10.
2. Each part after a comma must match the place's country code exactly, or the
   start of a word in its region or country: `Paris, tex` finds Texas, but
   `Moscow, us` does not match Russia. With several parts
   (`Springfield, Illinois, US`) all must match. If no place matches, the parts
   are ignored instead of returning nothing.
3. Each place gets a weighted score: 55% how well the name matches, 15%
   proximity, 20% population and 10% affinity. Name matching ignores case and
   accents, so `sao paulo` matches *São Paulo* exactly.
4. Places with the same name and region are listed once, and the best 10 are
   returned.

The provider's answer is cached for five minutes per name and shared by every
visitor. The ranking is worked out for each request, so it still reflects your
position and recent picks.

### `GET /reverse-location`

Turns coordinates into a place name. Takes `latitude` and `longitude`, and
returns `{"name": "New York, New York, United States"}`. Names are cached for an
hour for coordinates within about 100 m of each other, as Nominatim's usage
policy asks. If the lookup fails the dashboard still shows the weather, labelled
**Your location**.

### `GET /location`

Estimates the caller's coordinates from their IP address. Returns `latitude`,
`longitude`, `name` and `source`. The dashboard calls this when it opens.

- **On Vercel** the position comes from the `X-Vercel-IP-*` headers Vercel adds
  to each request, so no outside service is called and nothing is sent
  anywhere.
- **Elsewhere** the caller's public address is sent to the IP location provider
  (see [Data sources](#data-sources-and-credits)) and results are cached in
  memory for an hour per address. Local and private addresses (such as
  `127.0.0.1`) cannot be located and return `404`. IP-based locations are
  approximate.

### `GET /healthz` and `GET /readyz`

Return `{"status": "ok"}` and `{"status": "ready"}`. Neither calls an external
service, so a provider outage never makes a health check fail. The Docker image
uses `/healthz` for its health check.

### Errors

| Status | Meaning |
| --- | --- |
| `400` | A missing, non-numeric or out-of-range parameter. |
| `429` | Too many requests from one client. The `Retry-After` header says how many seconds to wait. |
| `502` | A weather, search or location provider failed or returned an unexpected response. |

Every response carries an `X-Request-ID` header. Send your own to trace a
request through the logs.

## Configuration

Set environment variables before starting the app. All are optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5000` | Port for `python -m app.weather_app` only. The Docker image always listens on 5000. |
| `WEATHER_CACHE_TTL` | `30` | Seconds to cache a weather result. |
| `WEATHER_CACHE_SIZE` | `256` | Most entries kept in each in-memory cache (weather, search, IP locations and place names). |
| `SEARCH_CACHE_TTL` | `300` | Seconds to cache search results. |
| `UPSTREAM_TIMEOUT` | `5` | Seconds to wait for a provider. A failed or rate-limited call is retried once. |
| `RATE_LIMIT` | `60` | Requests allowed per client in each window. |
| `RATE_WINDOW` | `60` | Length of the rate-limit window, in seconds. |
| `TRUST_VERCEL_CLIENT_IP` | `true` on Vercel, otherwise `false` | Identify visitors by Vercel's `X-Vercel-Forwarded-For` header when rate limiting. Leave it off anywhere else: a client could forge the header. |
| `ASSET_VERSION` | hash of `public/static` | Label added to asset URLs (`?v=`) to refresh browser caches. Set it only to force a refresh. |
| `OPEN_METEO_URL` | Open-Meteo forecast | Weather provider URL. |
| `GEOCODING_URL` | Open-Meteo geocoding | City search provider URL. |
| `REVERSE_GEOCODING_URL` | Nominatim | Place-name provider URL. |
| `IP_LOCATION_URL` | `https://ipapi.co/{ip}/json/` | IP location provider URL. `{ip}` is replaced with the visitor's public address. A URL without `{ip}` is used as it is. |

Static dashboard assets are served with a one-day browser cache and
`immutable` caching. Their URLs include a version taken from the files'
contents, so browsers fetch new assets as soon as one changes and keep reusing
them otherwise, including across restarts and serverless cold starts.

Example:

```bash
# macOS or Linux
PORT=8000 RATE_LIMIT=120 python -m app.weather_app
```

```powershell
# Windows (PowerShell)
$env:PORT = "8000"
$env:RATE_LIMIT = "120"
python -m app.weather_app
```

The server also sends `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` and `Content-Security-Policy` headers, and logs one line per request (method, path, status,
duration and request ID) without logging provider responses.

## Troubleshooting

**The browser says "Bad request version" or the connection fails on `https://`.**
Port 5000 is plain HTTP. Use `http://localhost:5000`. To serve HTTPS, put a
reverse proxy in front.

**"Address already in use" on startup.** Something else is using port 5000
(AirPlay Receiver on macOS is a common one). Start the app on another port:
`PORT=8000 python -m app.weather_app`, or `docker run -p 8000:5000 weather-lookup`.

**The page shows New York, or the wrong city, when it opens.** If it is a place
you picked before, that is your remembered last place (kept for 30 days):
search or press **Use my location** to replace it. Otherwise the page starts
from a silent IP-based estimate. New York means the IP estimate was unavailable
(for example on a private network) and you denied the browser's permission
prompt, or your position could not be found. A wrong city is normal for VPNs and mobile networks. Press **Use my location**
and allow the browser prompt for a precise position. If you denied it earlier,
allow location for the site in your browser settings first. Location needs a
secure context: `http://localhost` works, but a plain-HTTP address on another
machine does not.

**"Weather service unavailable" (`502`).** The server could not reach the
provider, or got an unexpected reply. Check the server's internet access and
read its log; then press **Try again**.

**"Too many requests" (`429`).** One client sent more than `RATE_LIMIT`
requests in `RATE_WINDOW` seconds. Wait the number of seconds shown, or raise
the limit.

**The page is unstyled or blank.** The CSS and JavaScript load from `/static`.
If you build your own image, make sure it copies the `public` folder (the Dockerfile does).

## Development

### Project layout

```text
app/
  weather_app.py           Flask app: routes, caching, rate limiting
  api_contracts.py         Validation of provider responses and API shapes
  search_ranking.py        Search result ranking (relevance, distance, population, recent picks)
  templates/
    weather_dashboard.html Page markup
public/static/             Served at /static (by Vercel's CDN, or by Flask locally)
  css/dashboard.css        Styles, design tokens and print layout
  css/map-marker.css       Location marker on the background map
  js/dashboard.js          Page logic: state, location flow, search, units
  js/render.js             Writes a /weather payload into the hero, details and forecast
  js/search-box.js         Accessible city search (ARIA combobox)
  js/format.js             Units, compass points, weather-code labels, number and time formatting
  js/map-marker.js         Places the marker on the map from the weather coordinates
  js/scroll-fade.js        Fades the forecast's edges while it can scroll
  js/storage.js            Safe localStorage wrapper
  img/world-map.svg        Background map (generated, see below)
  fonts/                   Space Grotesk and Newsreader (self-hosted) and their licences
vercel.json                Vercel function and static-file cache settings
pyproject.toml             Python version, dependencies and Vercel entrypoint
scripts/
  build-world-map.mjs      Generates the map from Natural Earth data
tests/
  test_app.py              Endpoints, caching, rate limiting, headers, page and static files
  test_api_contracts.py    What the provider-response validators accept and reject
  js/                      Unit tests for the ES modules (node --test)
  e2e/                     Playwright browser tests, providers mocked
docs/                      Screenshot, design handoff spec, design system
```

### Run the tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The tests cover every endpoint, input validation, provider failures, caching,
rate limiting, security headers, the page and its static files. They use mocked providers, so
they run offline. GitHub Actions runs them on every push and pull request.

Frontend and browser tests (Node 20+):

```bash
ruff check .                          # lint
node --test "tests/js/*.test.mjs"     # unit tests for the ES modules, no dependencies
cd tests/e2e && npm ci && npx playwright install chromium
npx playwright test                   # map, location, weather details and print tests; providers are mocked
CONTRAST=1 npx playwright test contrast   # slow contrast probe over the map (PowerShell: $env:CONTRAST = "1")
```

The browser tests start the app with `.venv`'s Python when that folder exists,
otherwise with the `python` on your PATH. Set `E2E_NO_SANDBOX=1` when Chromium
runs as root inside a container.

### Change the background map

`public/static/img/world-map.svg` is an outline of real coastlines (Natural Earth
1:110m data, equirectangular projection, 84°N to 58°S) that scrolls slowly
behind the page. It is generated, not drawn. To rebuild it:

```bash
cd scripts
npm install
npm run build-map
```

### Design notes

- [`docs/design-handoff.md`](docs/design-handoff.md) describes the layout,
  states, keyboard behaviour and accessibility requirements for the dashboard.
- [`docs/design-system.md`](docs/design-system.md) lists the colour, type,
  spacing and motion tokens and the components built from them. Add a token
  there and in `dashboard.css` before using a new value twice.

The page loads nothing from other sites, so the Content Security Policy is
strict (`default-src 'self'`). Keep it that way: no inline `<script>` or
`style=` attributes in the HTML, and self-host any new font or image. Setting
styles from JavaScript through `element.style` (as the map marker and wind
arrow do) is allowed.

To refresh `docs/dashboard.png`, take a 994 px wide screenshot of the page in
dark mode down to the bottom of the result card. Any browser's screenshot tool
or Playwright works; no special tooling is needed.

## Deploying

The image runs Gunicorn with two workers of four threads each on port 5000 and has a Docker health
check on `/healthz`.

```bash
docker run -d --name weather-lookup -p 5000:5000 --restart unless-stopped weather-lookup
docker inspect --format='{{json .State.Health}}' weather-lookup
```

### Deploying to Vercel

The repository deploys to Vercel as it is: `pyproject.toml` names the entrypoint
(`app.weather_app:app`), `vercel.json` sets static-file headers, and everything
in `public/` is served from Vercel's CDN, so CSS, JavaScript, fonts and the map
never start the Flask function. No environment variables are required.

- **Rate limiting uses the visitor's address.** On Vercel the app reads
  `X-Vercel-Forwarded-For`, which Vercel sets itself, so each visitor gets
  their own limit instead of everyone sharing the proxy's. The header is
  trusted only when `VERCEL=1` (set by Vercel) or `TRUST_VERCEL_CLIENT_IP=true`.
- **Limits are per function instance.** The cache and limiter live in memory,
  and Vercel can run several instances, so the limit is approximate. That is
  fine for a small personal site; use a shared store if you need exact limits.
- **Keep static files in `public/static`.** Flask's own static route is only for
  local use and Docker.
- **The IP lookup uses Vercel's own location headers** (`X-Vercel-IP-Latitude`,
  `-Longitude`, `-City`, `-Country-Region`, `-Country`), so it needs no outside
  service, no API key and adds no delay. If those headers are missing, the app
  falls back to ipapi.co using the visitor's address (the same trusted header as
  rate limiting).

Before each deploy:

- [ ] `python -m pytest` passes and CI is green on the branch.
- [ ] `requirements.txt` and `pyproject.toml` list the same versions.
- [ ] Deploy a preview, then check `/healthz`, search for a city, and load the
      weather for a place.
- [ ] In the browser's network tab, `/static/...` files come from the CDN
      (`x-vercel-cache` is present) and have `Cache-Control: public, max-age=86400, immutable`.
- [ ] Promote to production, watch the runtime logs for 5xx and 429 responses
      for a few minutes.
- [ ] Rollback: promote the previous deployment from the Vercel dashboard
      (Deployments, then Promote), or revert the commit.

### Deploying with Docker

Things to know before putting it on the internet:

- **TLS:** the container serves plain HTTP. Terminate HTTPS in a reverse proxy.
- **Rate limiting is per process and per client address.** Behind a reverse
  proxy every visitor can look like the proxy's address, so enforce limits at
  the proxy or gateway as well. Do not set `TRUST_VERCEL_CLIENT_IP` here.
- **The cache and rate limiter are in memory.** They are not shared between
  Gunicorn workers or between containers. Use a shared store such as Redis if
  you scale out.
- **Public providers have usage terms.** See below.

GitHub Actions also builds the image and, on pushes to `main` and version tags,
publishes it to the GitHub Container Registry.

## Data sources and credits

| What | Provider | Notes |
| --- | --- | --- |
| Weather, city search | [Open-Meteo](https://open-meteo.com/) | Free for non-commercial use, no key. Attribution is shown on the page. Check their terms for commercial use. |
| Place name for browser coordinates | [OpenStreetMap Nominatim](https://nominatim.org/) | Public instance with a strict usage policy. For heavy use run your own and set `REVERSE_GEOCODING_URL`. |
| Approximate location from the visitor's IP address | Vercel request headers; otherwise [ipapi.co](https://ipapi.co/) | On Vercel nothing leaves the deployment. Elsewhere the visitor's public IP address is sent to ipapi.co when the page opens (rate limited on the free tier). If both are unavailable the browser is asked for permission instead. |
| Background map | [Natural Earth](https://www.naturalearthdata.com/) | Public domain, via the `world-atlas` package. |
| Typeface | [Space Grotesk](https://github.com/floriankarsten/space-grotesk) | SIL Open Font License 1.1, self-hosted from `public/static/fonts` so the page makes no font requests to third parties. |
| Title typeface | [Newsreader](https://github.com/productiontype/Newsreader) | SIL Open Font License 1.1, self-hosted (one weight, Latin subset, about 24 KB). Used for the page title only. |

This project is released under the MIT license in [`LICENSE`](LICENSE).
