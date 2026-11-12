import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from math import asin, cos, log1p, radians, sin, sqrt
from threading import Lock
from typing import Any

import requests
from flask import Flask, g, jsonify, render_template, request
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from api_contracts import (
    InvalidUpstreamPayload,
    error_response,
    health_response,
    validate_location_response,
    validate_reverse_location_response,
    validate_search_response,
    validate_weather_response,
    weather_response,
)


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
IP_LOCATION_URL = "https://ipapi.co/json/"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
REVERSE_GEOCODING_URL = "https://nominatim.openstreetmap.org/reverse"


@dataclass(frozen=True)
class AppConfig:
    open_meteo_url: str = OPEN_METEO_URL
    ip_location_url: str = IP_LOCATION_URL
    geocoding_url: str = GEOCODING_URL
    reverse_geocoding_url: str = REVERSE_GEOCODING_URL
    upstream_timeout: float = 5
    cache_ttl: int = 30
    cache_size: int = 256
    rate_limit: int = 60
    rate_window: int = 60
    temperature_unit: str = "fahrenheit"
    wind_speed_unit: str = "mph"
    search_cache_ttl: int = 300

    @classmethod
    def from_env(cls):
        def positive_int(name: str, default: int) -> int:
            value = int(os.environ.get(name, default))
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero")
            return value

        timeout = float(os.environ.get("UPSTREAM_TIMEOUT", 5))
        if timeout <= 0:
            raise ValueError("UPSTREAM_TIMEOUT must be greater than zero")
        temperature_unit = os.environ.get("TEMPERATURE_UNIT", "fahrenheit")
        wind_speed_unit = os.environ.get("WIND_SPEED_UNIT", "mph")
        if temperature_unit not in {"celsius", "fahrenheit"}:
            raise ValueError("TEMPERATURE_UNIT must be celsius or fahrenheit")
        if wind_speed_unit not in {"kmh", "mph", "ms"}:
            raise ValueError("WIND_SPEED_UNIT must be kmh, mph, or ms")
        return cls(
            open_meteo_url=os.environ.get("OPEN_METEO_URL", OPEN_METEO_URL),
            ip_location_url=os.environ.get("IP_LOCATION_URL", IP_LOCATION_URL),
            geocoding_url=os.environ.get("GEOCODING_URL", GEOCODING_URL),
            reverse_geocoding_url=os.environ.get(
                "REVERSE_GEOCODING_URL", REVERSE_GEOCODING_URL
            ),
            upstream_timeout=timeout,
            cache_ttl=positive_int("WEATHER_CACHE_TTL", 30),
            cache_size=positive_int("WEATHER_CACHE_SIZE", 256),
            rate_limit=positive_int("RATE_LIMIT", 60),
            rate_window=positive_int("RATE_WINDOW", 60),
            temperature_unit=temperature_unit,
            wind_speed_unit=wind_speed_unit,
            search_cache_ttl=positive_int("SEARCH_CACHE_TTL", 300),
        )


class TTLCache:
    def __init__(self, max_size: int):
        self._items = OrderedDict()
        self._max_size = max_size
        self._lock = Lock()

    def get(self, key: tuple[Any, ...], ttl: int) -> Any:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            created, value = item
            if time.monotonic() - created >= ttl:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return value

    def set(self, key: tuple[Any, ...], value: Any) -> None:
        with self._lock:
            self._items[key] = (time.monotonic(), value)
            self._items.move_to_end(key)
            while len(self._items) > self._max_size:
                self._items.popitem(last=False)


class RateLimiter:
    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window
        self._requests = {}
        self._lock = Lock()

    def allowed(self, client: str) -> bool:
        now = time.monotonic()
        with self._lock:
            timestamps = [
                timestamp
                for timestamp in self._requests.get(client, [])
                if now - timestamp < self.window
            ]
            if len(timestamps) >= self.limit:
                self._requests[client] = timestamps
                return False
            timestamps.append(now)
            self._requests[client] = timestamps
            return True


def _session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=2,
        backoff_factor=0.2,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    latitude_delta = radians(latitude_b - latitude_a)
    longitude_delta = radians(longitude_b - longitude_a)
    value = (
        sin(latitude_delta / 2) ** 2
        + cos(radians(latitude_a))
        * cos(radians(latitude_b))
        * sin(longitude_delta / 2) ** 2
    )
    return 6371 * 2 * asin(sqrt(value))


SEARCH_WEIGHTS = {
    "relevance": 0.55,
    "proximity": 0.15,
    "popularity": 0.20,
    "affinity": 0.10,
}


def _relevance_score(name: str, query: str) -> float:
    normalized_name = name.casefold()
    normalized_query = query.casefold()
    if normalized_name == normalized_query:
        return 1.0
    if normalized_name.startswith(normalized_query):
        return 0.95
    if any(part.startswith(normalized_query) for part in normalized_name.split()):
        return 0.75
    if normalized_query in normalized_name:
        return 0.35
    return 0.0


def _proximity_score(distance_km: float) -> float:
    return 1 / (1 + distance_km / 250)


def _popularity_score(population: float, maximum_population: float) -> float:
    if maximum_population <= 0:
        return 0.0
    return log1p(population) / log1p(maximum_population)


def _search_score(
    result: dict[str, Any],
    query: str,
    latitude: float,
    longitude: float,
    maximum_population: float,
    affinity: set[str],
) -> float:
    distance = _distance_km(latitude, longitude, result["latitude"], result["longitude"])
    affinity_score = 1.0 if result["name"].casefold() in affinity else 0.0
    return (
        SEARCH_WEIGHTS["relevance"] * _relevance_score(result["name"], query)
        + SEARCH_WEIGHTS["proximity"] * _proximity_score(distance)
        + SEARCH_WEIGHTS["popularity"]
        * _popularity_score(result["population"], maximum_population)
        + SEARCH_WEIGHTS["affinity"] * affinity_score
    )


def create_app(config: AppConfig | None = None) -> Flask:
    app = Flask(__name__)
    config = config or AppConfig.from_env()
    session = _session()
    cache = TTLCache(config.cache_size)
    limiter = RateLimiter(config.rate_limit, config.rate_window)
    search_cache = TTLCache(config.cache_size)
    app.extensions["weather_cache"] = cache
    app.extensions["rate_limiter"] = limiter
    app.extensions["search_cache"] = search_cache

    @app.get("/")
    def index():
        return render_template("weather_dashboard.html")

    @app.before_request
    def before_request():
        g.request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        g.request_started = time.monotonic()
        if request.endpoint not in {"healthz", "readyz"} and not limiter.allowed(
            request.remote_addr or "unknown"
        ):
            return error_response(
                "rate limit exceeded",
                429,
                {"Retry-After": str(config.rate_window)},
            )

    @app.after_request
    def after_request(response):
        response.headers["X-Request-ID"] = g.get("request_id", "")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        app.logger.info(
            "request method=%s path=%s status=%s duration_ms=%.2f request_id=%s",
            request.method,
            request.path,
            response.status_code,
            (time.monotonic() - g.request_started) * 1000,
            g.request_id,
        )
        return response

    @app.get("/location")
    def location():
        try:
            response = session.get(config.ip_location_url, timeout=config.upstream_timeout)
            response.raise_for_status()
            coordinates = validate_location_response(response.json())
        except (requests.RequestException, ValueError, TypeError, InvalidUpstreamPayload):
            app.logger.exception("IP location request failed")
            return error_response("location service unavailable", 502)
        return jsonify({**coordinates, "source": "IP location"})

    @app.get("/healthz")
    def healthz():
        return health_response()

    @app.get("/readyz")
    def readyz():
        return jsonify({"status": "ready"})

    @app.get("/search")
    def search():
        query = request.args.get("q", "").strip()
        if not query:
            return error_response("search query must contain at least 1 character", 400)
        latitude = request.args.get("latitude", type=float)
        longitude = request.args.get("longitude", type=float)
        affinity = {
            value.strip().casefold()
            for value in request.args.get("affinity", "").split(",")[:10]
            if value.strip()
        }
        if latitude is None and longitude is None:
            latitude, longitude = 40.7128, -74.0060
        elif latitude is None or longitude is None:
            return error_response("latitude and longitude must be provided together", 400)
        assert latitude is not None and longitude is not None
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return error_response("search coordinates are invalid", 400)
        cache_key = (
            query.casefold(),
            round(latitude, 2),
            round(longitude, 2),
            tuple(sorted(affinity)),
        )
        cached = search_cache.get(cache_key, config.search_cache_ttl)
        if cached is not None:
            return jsonify({"results": cached})
        try:
            response = session.get(
                config.geocoding_url,
                params={"name": query, "count": 20, "language": "en", "format": "json"},
                timeout=min(config.upstream_timeout, 3),
            )
            response.raise_for_status()
            results = validate_search_response(response.json())
        except (requests.RequestException, ValueError, TypeError, InvalidUpstreamPayload):
            app.logger.exception("Location search request failed")
            return error_response("location search unavailable", 502)
        maximum_population = max(
            (result["population"] for result in results),
            default=0,
        )
        ordered = sorted(
            results,
            key=lambda result: _search_score(
                result,
                query,
                latitude,
                longitude,
                maximum_population,
                affinity,
            ),
            reverse=True,
        )
        search_cache.set(cache_key, ordered)
        return jsonify({"results": ordered})

    @app.get("/reverse-location")
    def reverse_location():
        latitude = request.args.get("latitude", type=float)
        longitude = request.args.get("longitude", type=float)
        if (
            latitude is None
            or longitude is None
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            return error_response("valid latitude and longitude are required", 400)
        try:
            response = session.get(
                config.reverse_geocoding_url,
                params={"lat": latitude, "lon": longitude, "format": "json"},
                headers={"User-Agent": "docker-weather-test/1.0"},
                timeout=config.upstream_timeout,
            )
            response.raise_for_status()
            location_name = validate_reverse_location_response(response.json())
        except (requests.RequestException, ValueError, TypeError, InvalidUpstreamPayload):
            app.logger.exception("Reverse location request failed")
            return error_response("reverse location unavailable", 502)
        return jsonify(location_name)

    @app.get("/weather")
    def weather():
        latitude = request.args.get("latitude", type=float)
        longitude = request.args.get("longitude", type=float)

        if latitude is None or longitude is None:
            return error_response("latitude and longitude are required numbers", 400)
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return error_response(
                "latitude must be between -90 and 90 and longitude between -180 and 180",
                400,
            )

        cache_key = (round(latitude, 3), round(longitude, 3))
        cached = cache.get(cache_key, config.cache_ttl)
        if cached is not None:
            return jsonify(cached)

        try:
            response = session.get(
                config.open_meteo_url,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": (
                        "temperature_2m,wind_speed_10m,weather_code,rain,"
                        "relative_humidity_2m,uv_index"
                    ),
                    "hourly": "temperature_2m,weather_code",
                    "forecast_days": 1,
                    "timezone": "auto",
                    "temperature_unit": config.temperature_unit,
                    "wind_speed_unit": config.wind_speed_unit,
                },
                timeout=config.upstream_timeout,
            )
            response.raise_for_status()
            data = validate_weather_response(response.json())
        except (requests.RequestException, ValueError, TypeError, InvalidUpstreamPayload):
            app.logger.exception("Open-Meteo request failed")
            return error_response("weather service unavailable", 502)

        result = weather_response(data).get_json()
        cache.set(cache_key, result)
        return jsonify(result)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
