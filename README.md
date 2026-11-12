# Weather API

A Docker-ready Flask API that returns current weather for a latitude and
longitude using [Open-Meteo](https://open-meteo.com/).

## Quick start

### Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

The API starts on plain HTTP at `http://localhost:5000`. Try the health check:

```powershell
curl.exe http://localhost:5000/healthz
```

Then request current conditions:

```powershell
curl.exe "http://localhost:5000/weather?latitude=40.71&longitude=-74.01"
```

Open `http://localhost:5000/` in a browser to use the weather form. Select **Use my location** to let the browser estimate your coordinates and
load the weather automatically. The browser will ask for location permission.
If browser location is unavailable or denied, the app falls back to an
approximate IP-based location through the `/location` endpoint. IP-based
coordinates are less precise; enter coordinates manually when accuracy matters.

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
    "wind_speed_10m": 4.2
  },
  "source": "Open-Meteo"
}
```

The API requests temperature in Fahrenheit and wind speed in miles per hour.

#### Error responses

| Status | Condition | Response |
| --- | --- | --- |
| `400` | Missing, non-numeric, or out-of-range coordinates | JSON `error` message |
| `502` | Open-Meteo request fails | `{"error": "weather service unavailable"}` |

## Configuration

The development server listens for plain HTTP on `0.0.0.0:5000` by default.
Override the port with the `PORT` environment variable:

```powershell
$env:PORT = "8000"
python app.py
```

The Docker image always publishes port `5000` and uses Gunicorn to serve
`app:app` over HTTP. Put TLS termination in a reverse proxy if HTTPS is
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
