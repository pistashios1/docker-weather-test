# Weather API

A Docker-ready Flask API that returns current weather for a latitude and
longitude using [Open-Meteo](https://open-meteo.com/).

## Quick start

### Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python weather_app.py
```

The API starts on plain HTTP at `http://localhost:5000`. Try the health check:

```powershell
curl.exe http://localhost:5000/healthz
```

Then request current conditions:

```powershell
curl.exe "http://localhost:5000/weather?latitude=40.71&longitude=-74.01"
```

Open `http://localhost:5000/` in a browser to search for a city or region.
The app automatically requests browser location permission on load. If
permission is unavailable or denied, it loads New York as the default. Use
**Use my location** to retry permission later.

Port `5000` is not configured for TLS. Use `http://`, not `https://`; sending
an HTTPS request to this port produces a `400 Bad request version` message
because Flask receives TLS handshake bytes where it expects an HTTP request.

### Run with Docker

```powershell
docker build -t weather-api:local .
docker run --rm -p 5000:5000 weather-api:local
```

The image runs Gunicorn with two workers and includes a Docker health check.

## Request flow

```text
Client
  |
  | GET /weather?latitude=40.71&longitude=-74.01
  v
Flask API
  |-- Parse and validate coordinates
  |-- Request current conditions from Open-Meteo
  |-- Return a normalized JSON response
  v
Client
```

The application is stateless, stores no weather data, and does not require an
API key. For each weather request, it:

1. Parses `latitude` and `longitude` as numbers.
2. Validates their geographic ranges.
3. Requests temperature and wind speed from Open-Meteo.
4. Returns the upstream coordinates and current conditions.
5. Reports upstream request failures as a `502` response.

## API reference

### `GET /healthz`

Returns:

```json
{"status": "ok"}
```

This endpoint is used by the Docker health check.

`/healthz` is a dependency-free liveness check. It should not be used to
restart the container when an external weather provider is unavailable.

### `GET /readyz`

Returns:

```json
{"status": "ready"}
```

This endpoint indicates that the application process has loaded successfully.
Provider calls remain request-driven, so a provider outage is reported as a
`502` from `/weather` or `/location` rather than making health probes depend on
third-party availability.

### `GET /weather`

#### Query parameters

| Name | Type | Required | Valid range |
| --- | --- | --- | --- |
| `latitude` | number | Yes | `-90` to `90` |
| `longitude` | number | Yes | `-180` to `180` |

#### Success response

```json
{
  "latitude": 40.71,
  "longitude": -74.01,
  "current": {
    "temperature_2m": 72.5,
    "wind_speed_10m": 4.2,
    "weather_code": 1,
    "rain": 0
  },
  "hourly": {
    "time": ["2026-11-12T12:00"],
    "temperature_2m": [72.5],
    "weather_code": [1]
  },
  "source": "Open-Meteo"
}
```

The API requests temperature in Fahrenheit, wind speed in miles per hour, and
Open-Meteo WMO weather codes for current conditions and the next 24 hours.
The frontend maps those codes to labels such as **Clear**, **Partly cloudy**,
**Rain**, **Snow**, and **Thunderstorm**. Open-Meteo supports these fields;
incomplete upstream forecast payloads are rejected with a stable `502` error.
Precipitation is reported in millimeters, humidity as a percentage, and UV
index as a numeric value. Precipitation is `0` when no rain is occurring.

#### Error responses

| Status | Condition | Response |
| --- | --- | --- |
| `400` | Missing, non-numeric, or out-of-range coordinates | JSON `error` message |
| `502` | Open-Meteo request fails | `{"error": "weather service unavailable"}` |
| `429` | Per-process request limit exceeded | JSON `error` message and `Retry-After` header |

Successful weather responses are cached for 30 seconds by default. Coordinates
are rounded to three decimal places for cache keys, and the cache is bounded
to 256 entries.

### `GET /search?q=<name>`

Searches the Open-Meteo geocoding catalog and returns up to twenty matching
cities or regions worldwide, including one-character queries. Pass the current
`latitude` and `longitude` to rank results using a weighted score:
`0.55 * relevance + 0.15 * proximity + 0.20 * popularity + 0.10 * user
affinity`. Relevance favors the typed characters at the start of the city
name, followed by word-start and substring matches. The optional `affinity`
parameter accepts recently selected city names and helps personalize results.
Results are cached for five minutes by default.

```json
{
  "results": [
    {
      "name": "Paris",
      "context": "Ile-de-France, France",
      "latitude": 48.8566,
      "longitude": 2.3522
    }
  ]
}
```

### `GET /reverse-location`

Resolves browser coordinates to a city name for the initial weather display.
The endpoint uses OpenStreetMap Nominatim and accepts `latitude` and
`longitude` query parameters. If reverse geocoding is unavailable, weather
still loads with a generic location label.

## Configuration

The development server listens for plain HTTP on `0.0.0.0:5000` by default.
Override the port with the `PORT` environment variable:

```powershell
$env:PORT = "8000"
python weather_app.py
```

The following environment variables are available:

| Variable | Default | Description |
| --- | --- | --- |
| `OPEN_METEO_URL` | Open-Meteo forecast URL | Weather provider URL |
| `IP_LOCATION_URL` | ipapi.co JSON URL | IP location provider URL |
| `GEOCODING_URL` | Open-Meteo geocoding URL | City and region search provider URL |
| `REVERSE_GEOCODING_URL` | Nominatim reverse URL | Browser-coordinate city lookup URL |
| `SEARCH_CACHE_TTL` | `300` | Search-result cache lifetime in seconds |
| `UPSTREAM_TIMEOUT` | `5` | Upstream request timeout in seconds |
| `TEMPERATURE_UNIT` | `fahrenheit` | `celsius` or `fahrenheit` |
| `WIND_SPEED_UNIT` | `mph` | `kmh`, `mph`, or `ms` |
| `WEATHER_CACHE_TTL` | `30` | Cache lifetime in seconds |
| `WEATHER_CACHE_SIZE` | `256` | Maximum cached coordinate keys |
| `RATE_LIMIT` | `60` | Requests per client per rate window |
| `RATE_WINDOW` | `60` | Rate-limit window in seconds |

The service adds an `X-Request-ID` response header, accepts a caller-provided
request ID, and logs method, path, status, duration, and request ID. It does
not log provider payloads by default.

Caching and rate limiting are process-local. They are suitable for a single
container, but are not global when Gunicorn or the deployment uses multiple
replicas. For scaled deployments, enforce global limits and shared caching at
an API gateway or with a shared store such as Redis.

The Docker image always publishes port `5000` and uses Gunicorn to serve
`weather_app:app` over HTTP. Put TLS termination in a reverse proxy if HTTPS is
required.

## Development

### Run tests

```powershell
pip install -r requirements-dev.txt
python -m pytest
```

The test suite covers successful weather responses, coordinate validation,
upstream failures, and the health endpoint.

### Inspect Docker health

```powershell
docker ps
docker inspect --format='{{json .State.Health}}' <container-id>
```

### Tag an image

```powershell
docker tag weather-api:local weather-api:1.0.0
docker image ls weather-api
```

To publish the image, replace the image name with your registry namespace,
run `docker login`, and use `docker push`.
