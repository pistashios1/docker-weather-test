import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
import requests

from app.weather_app import AppConfig, app, create_app

STATIC_DIR = Path(__file__).resolve().parent.parent / "public" / "static"


@pytest.fixture(autouse=True)
def clear_weather_cache():
    app.extensions["weather_cache"]._items.clear()
    app.extensions["search_cache"]._items.clear()


def test_index_serves_weather_frontend():
    result = app.test_client().get("/")

    assert result.status_code == 200
    assert b"Weather Lookup" in result.data


def test_location_returns_ip_coordinates():
    response = Mock()
    response.json.return_value = {
        "latitude": "40.71",
        "longitude": "-74.01",
        "city": "New York",
        "country_name": "United States",
    }

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        result = app.test_client().get("/location")

    assert result.status_code == 200
    assert result.get_json() == {
        "latitude": 40.71,
        "longitude": -74.01,
        "name": "New York, United States",
        "source": "IP location",
    }
    get.assert_called_once_with("https://ipapi.co/json/", timeout=5)


def test_location_reports_lookup_failure():
    with patch("app.weather_app.requests.Session.get", side_effect=requests.RequestException):
        result = app.test_client().get("/location")

    assert result.status_code == 502
    assert result.get_json() == {"error": "location service unavailable"}


def test_search_returns_comprehensive_location_results():
    response = Mock()
    response.json.return_value = {
        "results": [
            {
                "name": "Paris",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "admin1": "Ile-de-France",
                "country": "France",
            }
        ]
    }

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        result = app.test_client().get("/search?q=Paris")

    assert result.status_code == 200
    assert result.get_json() == {
        "results": [
            {
                "name": "Paris",
                "context": "Ile-de-France, France",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "population": 0.0,
            }
        ]
    }
    get.assert_called_once()


def test_search_rejects_short_queries():
    result = app.test_client().get("/search?q=")

    assert result.status_code == 400
    assert "at least 2" in result.get_json()["error"]


def test_search_returns_no_results_for_unknown_name():
    response = Mock()
    response.json.return_value = {"generationtime_ms": 0.1}

    with patch("app.weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get("/search?q=not-a-real-place")

    assert result.status_code == 200
    assert result.get_json() == {"results": []}


def test_search_scores_relevance_before_proximity_and_population():
    response = Mock()
    response.json.return_value = {
        "results": [
            {
                "name": "Nearby",
                "latitude": 40.72,
                "longitude": -74.01,
                "population": 1000,
            },
            {"name": "N", "latitude": 41.0, "longitude": -74.0, "population": 1000000},
            {"name": "Newark", "latitude": 40.8, "longitude": -74.0, "population": 300000},
        ]
    }

    with patch("app.weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get(
            "/search?q=Ne&latitude=40.71&longitude=-74.01"
        )

    assert [item["name"] for item in result.get_json()["results"]] == [
        "Newark",
        "Nearby",
        "N",
    ]


def test_reverse_location_returns_city_name():
    response = Mock()
    response.json.return_value = {
        "address": {"city": "New York", "state": "New York", "country": "United States"}
    }

    with patch("app.weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get("/reverse-location?latitude=40.71&longitude=-74.01")

    assert result.status_code == 200
    assert result.get_json() == {"name": "New York, New York, United States"}


def test_weather_returns_current_conditions():
    response = Mock()
    response.json.return_value = {
        "latitude": 40.71,
        "longitude": -74.01,
        "timezone": "America/New_York",
        "current": {
            "temperature_2m": 72.5,
            "wind_speed_10m": 4.2,
            "weather_code": 1,
            "rain": 0.4,
            "relative_humidity_2m": 65,
            "uv_index": 2.1,
        },
        "hourly": {
            "time": ["2026-11-12T00:00"],
            "temperature_2m": [70.0],
            "weather_code": [1],
        },
    }

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 200
    assert result.get_json()["current"]["temperature_2m"] == 72.5
    assert result.get_json()["current"]["rain"] == 0.4
    assert result.get_json()["timezone"] == "America/New_York"
    get.assert_called_once()


def test_weather_rejects_out_of_range_coordinates():
    result = app.test_client().get("/weather?latitude=91&longitude=0")

    assert result.status_code == 400
    assert "between" in result.get_json()["error"]


def test_weather_reports_upstream_failure():
    with patch("app.weather_app.requests.Session.get", side_effect=requests.RequestException):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_weather_reports_invalid_upstream_json():
    response = Mock()
    response.json.side_effect = ValueError

    with patch("app.weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_healthz():
    result = app.test_client().get("/healthz")

    assert result.status_code == 200
    assert result.get_json() == {"status": "ok"}


def test_readyz():
    result = app.test_client().get("/readyz")

    assert result.status_code == 200
    assert result.get_json() == {"status": "ready"}


def test_response_has_request_id_and_security_headers():
    result = app.test_client().get("/healthz", headers={"X-Request-ID": "test-request"})

    assert result.headers["X-Request-ID"] == "test-request"
    assert result.headers["X-Content-Type-Options"] == "nosniff"
    assert result.headers["X-Frame-Options"] == "DENY"


def test_weather_reports_invalid_upstream_schema():
    response = Mock()
    response.json.return_value = {
        "latitude": 40.71,
        "longitude": -74.01,
        "current": {"temperature_2m": 72.5, "wind_speed_10m": 4.2},
    }

    with patch("app.weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_weather_uses_cache():
    response = Mock()
    response.json.return_value = {
        "latitude": 40.71,
        "longitude": -74.01,
        "current": {
            "temperature_2m": 72.5,
            "wind_speed_10m": 4.2,
            "weather_code": 1,
            "rain": 0,
            "relative_humidity_2m": 65,
            "uv_index": 2.1,
        },
        "hourly": {
            "time": ["2026-11-12T00:00"],
            "temperature_2m": [70.0],
            "weather_code": [1],
        },
    }

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        client = app.test_client()
        assert client.get("/weather?latitude=40.71&longitude=-74.01").status_code == 200
        assert client.get("/weather?latitude=40.71&longitude=-74.01").status_code == 200

    get.assert_called_once()


def test_rate_limit_returns_retry_after():
    with patch.object(app.extensions["rate_limiter"], "limit", 0):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 429
    assert result.headers["Retry-After"] == "60"


def test_configuration_can_be_overridden():
    configured = AppConfig(upstream_timeout=2, cache_ttl=10, rate_limit=5)
    configured_app = create_app(configured)

    assert configured_app.test_client().get("/readyz").status_code == 200


def test_index_links_dashboard_assets():
    page = app.test_client().get("/").get_data(as_text=True)

    assert re.search(r"/static/css/dashboard\.css\?v=[0-9a-zA-Z_-]+", page)
    assert re.search(r"/static/js/dashboard\.js\?v=[0-9a-zA-Z_-]+", page)
    assert "data-map-marker" in page
    assert "<style>" not in page
    assert "<script>" not in page


@pytest.mark.parametrize(
    ("path", "content_type"),
    [
        ("css/dashboard.css", "text/css"),
        ("css/map-marker.css", "text/css"),
        ("js/dashboard.js", "javascript"),
        ("js/map-marker.js", "javascript"),
        ("js/format.js", "javascript"),
        ("js/search-box.js", "javascript"),
        ("js/storage.js", "javascript"),
        ("img/world-map.svg", "image/svg+xml"),
        ("fonts/space-grotesk-latin-wght-normal.woff2", "font/woff2"),
        ("fonts/space-grotesk-latin-ext-wght-normal.woff2", "font/woff2"),
    ],
)
def test_dashboard_assets_are_served(path, content_type):
    result = app.test_client().get(f"/static/{path}")

    assert result.status_code == 200
    assert content_type in result.headers["Content-Type"]
    result.close()


def test_static_assets_are_not_rate_limited():
    with patch.object(app.extensions["rate_limiter"], "limit", 0):
        result = app.test_client().get("/static/css/dashboard.css")

    assert result.status_code == 200
    result.close()


def test_static_assets_are_cached_until_server_restart():
    result = app.test_client().get("/static/css/dashboard.css")

    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "public, max-age=86400, immutable"
    result.close()


def test_javascript_module_imports_resolve():
    modules = sorted((STATIC_DIR / "js").glob("*.js"))
    assert modules

    for module in modules:
        for target in re.findall(r'from\s+"(\./[^"]+)"', module.read_text(encoding="utf-8")):
            assert (module.parent / target).is_file(), f"{module.name} imports missing {target}"


def test_dashboard_versions_its_dynamic_module_imports():
    dashboard = (STATIC_DIR / "js" / "dashboard.js").read_text(encoding="utf-8")

    assert "import.meta.url" in dashboard
    assert "encodeURIComponent(assetVersion)" in dashboard


def test_world_map_is_a_seamless_outline():
    root = ElementTree.parse(STATIC_DIR / "img" / "world-map.svg").getroot()

    # One unit per degree: exactly 360 degrees of longitude, so copies tile with no seam.
    assert root.attrib["viewBox"].split()[:3:2] == ["0", "360"]
    paths = [element.attrib.get("d", "") for element in root.iter("{http://www.w3.org/2000/svg}path")]
    assert max(len(path) for path in paths) > 10_000


def test_responses_carry_a_content_security_policy():
    result = app.test_client().get("/")

    policy = result.headers["Content-Security-Policy"]
    assert "default-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert "unsafe-inline" not in policy


def test_page_has_no_inline_styles_or_scripts():
    html = app.test_client().get("/").get_data(as_text=True)

    assert " style=" not in html
    assert not re.search(r"<script(?![^>]*\bsrc=)", html)


def _client_with_limit(limit, **overrides):
    configured = create_app(AppConfig(rate_limit=limit, **overrides))
    return configured.test_client()


def test_vercel_client_ip_header_gives_each_visitor_their_own_limit():
    client = _client_with_limit(1, trust_vercel_client_ip=True)
    proxy = {"REMOTE_ADDR": "10.0.0.1"}  # every request arrives from Vercel's proxy

    first = client.get("/readyz-not-exempt", headers={"X-Vercel-Forwarded-For": "203.0.113.5"}, environ_overrides=proxy)
    second = client.get("/readyz-not-exempt", headers={"X-Vercel-Forwarded-For": "203.0.113.6"}, environ_overrides=proxy)
    repeat = client.get("/readyz-not-exempt", headers={"X-Vercel-Forwarded-For": "203.0.113.5"}, environ_overrides=proxy)

    assert first.status_code == 404  # not rate limited (the route does not exist)
    assert second.status_code == 404  # a different visitor has a fresh allowance
    assert repeat.status_code == 429  # the same visitor is limited


def test_vercel_client_ip_header_is_ignored_unless_trusted():
    client = _client_with_limit(1)
    proxy = {"REMOTE_ADDR": "10.0.0.1"}

    first = client.get("/nope", headers={"X-Vercel-Forwarded-For": "203.0.113.5"}, environ_overrides=proxy)
    spoofed = client.get("/nope", headers={"X-Vercel-Forwarded-For": "203.0.113.6"}, environ_overrides=proxy)

    assert first.status_code == 404
    assert spoofed.status_code == 429  # a client cannot dodge the limit by changing the header


@pytest.mark.parametrize("value", ["", "not-an-ip", "203.0.113.5:80"])
def test_bad_vercel_client_ip_falls_back_to_connection_address(value):
    client = _client_with_limit(1, trust_vercel_client_ip=True)
    proxy = {"REMOTE_ADDR": "10.0.0.1"}

    client.get("/nope", headers={"X-Vercel-Forwarded-For": value}, environ_overrides=proxy)
    second = client.get("/nope", headers={"X-Vercel-Forwarded-For": value}, environ_overrides=proxy)

    assert second.status_code == 429


def test_vercel_client_ip_is_trusted_automatically_on_vercel(monkeypatch):
    monkeypatch.delenv("TRUST_VERCEL_CLIENT_IP", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    assert AppConfig.from_env().trust_vercel_client_ip is True

    monkeypatch.delenv("VERCEL")
    assert AppConfig.from_env().trust_vercel_client_ip is False

    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("TRUST_VERCEL_CLIENT_IP", "false")
    assert AppConfig.from_env().trust_vercel_client_ip is False

    monkeypatch.setenv("TRUST_VERCEL_CLIENT_IP", "maybe")
    with pytest.raises(ValueError):
        AppConfig.from_env()


def test_rate_limiter_forgets_idle_clients():
    from app.weather_app import RateLimiter

    limiter = RateLimiter(limit=1, window=60)
    limiter.MAX_CLIENTS = 3
    with patch("app.weather_app.time.monotonic", return_value=0.0):
        for client in ("a", "b", "c"):
            limiter.allowed(client)
    with patch("app.weather_app.time.monotonic", return_value=1000.0):
        limiter.allowed("d")

    assert set(limiter._requests) == {"d"}


def test_asset_version_is_stable_across_restarts(monkeypatch):
    monkeypatch.delenv("ASSET_VERSION", raising=False)
    first = create_app(AppConfig()).config["ASSET_VERSION"]
    second = create_app(AppConfig()).config["ASSET_VERSION"]

    assert first == second
    assert re.fullmatch(r"[0-9a-f]{32}", first)


def test_asset_version_can_be_set_explicitly(monkeypatch):
    monkeypatch.setenv("ASSET_VERSION", "release-7")

    assert create_app(AppConfig()).config["ASSET_VERSION"] == "release-7"


def test_vercel_config_serves_static_files_with_cache_headers():
    import json

    root = Path(__file__).resolve().parent.parent
    config = json.loads((root / "vercel.json").read_text())
    rule = next(rule for rule in config["headers"] if rule["source"] == "/static/(.*)")
    headers = {item["key"]: item["value"] for item in rule["headers"]}

    assert "max-age=86400" in headers["Cache-Control"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert (root / "public" / "static" / "css" / "dashboard.css").is_file()


def test_production_dependencies_are_patched_and_consistent():
    root = Path(__file__).resolve().parent.parent
    pins = dict(
        line.split("==")
        for line in (root / "requirements.txt").read_text().split()
        if "==" in line
    )
    pyproject = (root / "pyproject.toml").read_text()

    def version(text):
        return tuple(int(part) for part in text.split("."))

    assert version(pins["Flask"]) >= (3, 1, 3)
    assert f"Flask=={pins['Flask']}" in pyproject
    assert f"requests=={pins['requests']}" in pyproject


def test_scrollable_forecast_is_keyboard_focusable():
    page = app.test_client().get("/").get_data(as_text=True)

    assert re.search(r'id="forecast"[^>]*tabindex="0"', page)


def test_font_preload_matches_the_url_the_stylesheet_requests():
    page = app.test_client().get("/").get_data(as_text=True)
    preload = re.search(r'rel="preload" href="([^"]+\.woff2)[^"]*"', page).group(1)

    assert "?" not in preload
    assert f"url(\"../fonts/{preload.rsplit('/', 1)[1]}\")" in (
        STATIC_DIR / "css" / "dashboard.css"
    ).read_text(encoding="utf-8")


def test_footer_text_is_not_faded_below_contrast_requirements():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")
    footer_paragraph = re.search(r"footer p \{[^}]*\}", css).group(0)

    assert "opacity" not in footer_paragraph


def test_reverse_location_identifies_the_app_to_nominatim():
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"address": {"city": "Paris", "country": "France"}}

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        result = create_app(AppConfig()).test_client().get(
            "/reverse-location?latitude=48.85&longitude=2.35"
        )

    assert result.status_code == 200
    user_agent = get.call_args.kwargs["headers"]["User-Agent"]
    assert user_agent.startswith("weather-lookup/") and "github.com/pistashios1" in user_agent
