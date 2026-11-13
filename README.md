# Weather Lookup

An easy-to-use weather dashboard for checking current conditions and the next
twelve hours for any city or your current location.

- Search for a city or use your browser's location.
- See temperature, wind, precipitation, humidity, UV index, and an hourly
  forecast.
- Switch between °F/mph and °C/km/h; your choice is remembered in the browser.
- Run it locally with Python or Docker. No account or API key is required.

![Weather Lookup dashboard showing current New York conditions, a twelve-hour forecast, and the city search controls](docs/dashboard.png)
*The dashboard running locally (New York shown).*

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
pip install -r requirements.txt
python -m app.weather_app
```

Windows (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
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
| See the weather where you are | Allow the browser's location prompt when the page opens, or click the **Use my location** link next to the search box later. |
| See the weather somewhere else | Type a city in the search box and press **Search**, or pick a suggestion. Arrow keys move through suggestions, **Enter** picks one, **Esc** closes the list. |
| Switch units | Use the **°F · mph** / **°C · km/h** toggle. Your choice is remembered in this browser. |
| Stop the moving background | Turn off **Animate background** at the bottom of the page. It is also off automatically if your system asks for reduced motion. |

If you deny the location prompt, the dashboard shows **New York** so there is
always something on screen. While the permission prompt is open, the dashboard
continues waiting for your choice. After a successful location lookup, the
coordinates and resolved name are cached in this browser as `user-location`;
later uses and refreshes reuse that client-side location without requesting
permission again.

Search results are ranked using what you typed, how close each place is to the
place you are viewing, how large it is, and the places you picked before. Your
recent picks are stored only in your browser.

### What the numbers mean

- **Temperature and wind** are current readings for the chosen coordinates.
- **Precipitation** is rain falling now, in millimetres.
- **Humidity** is relative humidity, as a percentage.
- **UV index** is the current ultraviolet index (0 is none, 11 and above is extreme).
- **Checked** is the time your browser last fetched the data, not the time the
  weather station measured it. The server caches results for 30 seconds.
- **Hourly forecast** shows the next twelve hours, starting with **Now**.

## How it works

```text
Browser (app/static/ + app/templates/)
   |
   |  GET /search           find a city by name
   |  GET /weather          current conditions + hourly forecast
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

Current conditions and the next hours of forecast for a point.

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
  "current": {
    "temperature_2m": 64.0,
    "wind_speed_10m": 8.4,
    "weather_code": 2,
    "rain": 0.0,
    "relative_humidity_2m": 58,
    "uv_index": 2.6
  },
  "hourly": {
    "time": ["2026-11-12T13:00", "2026-11-12T14:00"],
    "temperature_2m": [64.0, 64.0],
    "weather_code": [2, 2]
  },
  "source": "Open-Meteo"
}
```

- Units follow the server configuration. The defaults are °F and mph; rain is
  in millimetres.
- `weather_code` is a [WMO weather code](https://open-meteo.com/en/docs#weathervariables).
  The dashboard turns it into a label such as *Clear*, *Rain* or *Thunderstorm*.
- `hourly` holds up to 24 hours. The dashboard shows the first 12.

### `GET /search`

Finds places by name. Returns up to 10 matches.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `q` | string | yes | At least one character. |
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
      "population": 2138551
    }
  ]
}
```

Results are ordered by a weighted score: 55% how well the name matches, 15%
proximity, 20% population and 10% affinity. They are cached for five minutes.

### `GET /reverse-location`

Turns coordinates into a place name. Takes `latitude` and `longitude`, and
returns `{"name": "New York, New York, United States"}`. If the lookup fails the
dashboard still shows the weather, labelled **Your location**.

### `GET /location`

Estimates your coordinates from your IP address. Returns `latitude`,
`longitude`, `name` and `source`. The dashboard does not call this; it is kept
for scripts and other clients. IP-based locations are approximate.

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
| `TEMPERATURE_UNIT` | `fahrenheit` | `fahrenheit` or `celsius`. See the note below. |
| `WIND_SPEED_UNIT` | `mph` | `mph`, `kmh` or `ms`. See the note below. |
| `WEATHER_CACHE_TTL` | `30` | Seconds to cache a weather result. |
| `WEATHER_CACHE_SIZE` | `256` | Most locations kept in the weather cache. |
| `SEARCH_CACHE_TTL` | `300` | Seconds to cache search results. |
| `UPSTREAM_TIMEOUT` | `5` | Seconds to wait for a provider. |
| `RATE_LIMIT` | `60` | Requests allowed per client in each window. |
| `RATE_WINDOW` | `60` | Length of the rate-limit window, in seconds. |
| `OPEN_METEO_URL` | Open-Meteo forecast | Weather provider URL. |
| `GEOCODING_URL` | Open-Meteo geocoding | City search provider URL. |
| `REVERSE_GEOCODING_URL` | Nominatim | Place-name provider URL. |
| `IP_LOCATION_URL` | ipapi.co | IP location provider URL. |

> **Keep the unit defaults if you use the dashboard.** The page expects °F and
> mph from the API and does the metric conversion itself. If you set
> `TEMPERATURE_UNIT=celsius` or `WIND_SPEED_UNIT=kmh`, the dashboard will show
> wrong numbers. These settings are for people who call the API directly.

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

**The page shows New York instead of my location.** The browser's location
permission was denied or dismissed. Allow location for the site and press **Use
my location**. Location needs a secure context: `http://localhost` works, but a
plain-HTTP address on another machine does not.

**"Weather service unavailable" (`502`).** The server could not reach the
provider, or got an unexpected reply. Check the server's internet access and
read its log; then press **Try again**.

**"Too many requests" (`429`).** One client sent more than `RATE_LIMIT`
requests in `RATE_WINDOW` seconds. Wait the number of seconds shown, or raise
the limit.

**Temperatures look wrong.** Check that `TEMPERATURE_UNIT` and
`WIND_SPEED_UNIT` are not set (see [Configuration](#configuration)).

**The page is unstyled or blank.** The CSS and JavaScript load from `/static`.
If you build your own image, make sure it includes the `app/static` folder.

## Development

### Project layout

```text
app/
  weather_app.py           Flask app: routes, caching, rate limiting
  api_contracts.py         Validation of provider responses and API shapes
  templates/
    weather_dashboard.html Page markup
  static/
    css/dashboard.css      Styles and design tokens
    js/dashboard.js        Page logic
    js/search-box.js       Accessible city search (ARIA combobox)
    js/format.js           Units, weather-code labels, number formatting
    js/storage.js          Safe localStorage wrapper
    img/world-map.svg      Background map (generated, see below)
    fonts/                 Space Grotesk (self-hosted) and its licence
scripts/
  build-world-map.mjs      Generates the map from Natural Earth data
tests/test_app.py         Test suite
docs/                     Screenshot, design handoff spec, design system
```

### Run the tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The tests cover every endpoint, input validation, provider failures, caching,
rate limiting, security headers, the page and its static files. They use mocked providers, so
they run offline. GitHub Actions runs them on every push and pull request.

### Change the background map

`app/static/img/world-map.svg` is an outline of real coastlines (Natural Earth
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
`style=` attributes, and self-host any new font or image.

## Deploying

The image runs Gunicorn with two workers on port 5000 and has a Docker health
check on `/healthz`.

```bash
docker run -d --name weather-lookup -p 5000:5000 --restart unless-stopped weather-lookup
docker inspect --format='{{json .State.Health}}' weather-lookup
```

Things to know before putting it on the internet:

- **TLS:** the container serves plain HTTP. Terminate HTTPS in a reverse proxy.
- **Rate limiting is per process and per client address.** Behind a reverse
  proxy every visitor can look like the proxy's address, so enforce limits at
  the proxy or gateway as well.
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
| IP location (`/location` only) | [ipapi.co](https://ipapi.co/) | Rate limited on the free tier. |
| Background map | [Natural Earth](https://www.naturalearthdata.com/) | Public domain, via the `world-atlas` package. |
| Typeface | [Space Grotesk](https://github.com/floriankarsten/space-grotesk) | SIL Open Font License 1.1, self-hosted from `app/static/fonts` so the page makes no font requests to third parties. The page title uses Times New Roman. |

This project is released under the license in [`LICENSE`](LICENSE).
