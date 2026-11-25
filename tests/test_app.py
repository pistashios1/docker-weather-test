import re
from pathlib import Path
from unittest.mock import Mock, patch
from xml.etree import ElementTree

import pytest
import requests

from app.weather_app import AppConfig, app, create_app

STATIC_DIR = Path(__file__).resolve().parent.parent / "public" / "static"


@pytest.fixture(autouse=True)
def clear_weather_cache():
    app.extensions["weather_cache"]._items.clear()
    app.extensions["search_cache"]._items.clear()
    app.extensions["location_cache"]._items.clear()


def test_index_serves_weather_frontend():
    result = app.test_client().get("/")

    assert result.status_code == 200
    assert b"Weather Lookup" in result.data


def _ip_location_response():
    response = Mock()
    response.json.return_value = {
        "latitude": "40.71",
        "longitude": "-74.01",
        "city": "New York",
        "country_name": "United States",
    }
    return response


def _location_client(**overrides):
    return create_app(AppConfig(**overrides)).test_client()


def test_location_looks_up_the_visitors_address():
    with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
        result = _location_client().get("/location", environ_overrides={"REMOTE_ADDR": "8.8.8.8"})

    assert result.status_code == 200
    assert result.get_json() == {
        "latitude": 40.71,
        "longitude": -74.01,
        "name": "New York, United States",
        "source": "IP location",
    }
    get.assert_called_once_with("https://ipapi.co/8.8.8.8/json/", timeout=5)


def test_location_uses_the_vercel_client_ip_when_trusted():
    client = _location_client(trust_vercel_client_ip=True)

    with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
        client.get(
            "/location",
            headers={"X-Vercel-Forwarded-For": "1.1.1.1"},
            environ_overrides={"REMOTE_ADDR": "10.0.0.1"},
        )

    get.assert_called_once_with("https://ipapi.co/1.1.1.1/json/", timeout=5)


def test_location_ignores_a_forged_forwarded_header_when_not_trusted():
    with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
        _location_client().get(
            "/location",
            headers={"X-Vercel-Forwarded-For": "1.1.1.1"},
            environ_overrides={"REMOTE_ADDR": "8.8.8.8"},
        )

    get.assert_called_once_with("https://ipapi.co/8.8.8.8/json/", timeout=5)


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "192.168.0.9", "::1", "169.254.1.1"])
def test_location_does_not_look_up_private_addresses(address):
    with patch("app.weather_app.requests.Session.get") as get:
        result = _location_client().get("/location", environ_overrides={"REMOTE_ADDR": address})

    assert result.status_code == 404
    assert result.get_json() == {"error": "location unavailable for this address"}
    get.assert_not_called()


def test_location_is_cached_per_address():
    client = _location_client()

    with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
        for _ in range(3):
            client.get("/location", environ_overrides={"REMOTE_ADDR": "8.8.8.8"})
        client.get("/location", environ_overrides={"REMOTE_ADDR": "8.8.4.4"})

    assert get.call_count == 2


def test_location_supports_a_fixed_provider_url_without_a_placeholder():
    client = _location_client(ip_location_url="https://example.test/where")

    with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
        result = client.get("/location")

    assert result.status_code == 200
    get.assert_called_once_with("https://example.test/where", timeout=5)


def test_location_reports_lookup_failure():
    with patch("app.weather_app.requests.Session.get", side_effect=requests.RequestException):
        result = _location_client().get("/location", environ_overrides={"REMOTE_ADDR": "8.8.8.8"})

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
                "country_code": "FR",
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
                "country_code": "FR",
                "distance_km": 5837,  # from the default origin, New York
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
            "time": 1794625200,
            "temperature_2m": 72.5,
            "wind_speed_10m": 4.2,
            "weather_code": 1,
            "rain": 0.4,
            "relative_humidity_2m": 65,
            "uv_index": 2.1,
        },
        "hourly": {
            "time": [1794625200],
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
    upstream_params = get.call_args.kwargs["params"]
    assert "is_day" in upstream_params["current"]
    assert "uv_index" in upstream_params["current"].split(",")
    assert "uv_index_max" in upstream_params["daily"].split(",")
    assert "precipitation_probability_max" in upstream_params["daily"].split(",")
    assert upstream_params["timezone"] == "auto"
    assert upstream_params["timeformat"] == "unixtime"


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
            "time": 1794625200,
            "temperature_2m": 72.5,
            "wind_speed_10m": 4.2,
            "weather_code": 1,
            "rain": 0,
            "relative_humidity_2m": 65,
            "uv_index": 2.1,
        },
        "hourly": {
            "time": [1794625200],
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
    assert 'id="map-track"' in page  # map-marker.js adds the markers to it
    assert "<style>" not in page
    assert "<script>" not in page


@pytest.mark.parametrize(
    ("path", "content_type"),
    [
        ("css/dashboard.css", "text/css"),
        ("css/map-marker.css", "text/css"),
        ("js/dashboard.js", "javascript"),
        ("js/map-marker.js", "javascript"),
        ("js/scroll-fade.js", "javascript"),
        ("js/format.js", "javascript"),
        ("js/search-box.js", "javascript"),
        ("js/storage.js", "javascript"),
        ("img/world-map.svg", "image/svg+xml"),
        ("fonts/space-grotesk-latin-wght-normal.woff2", "font/woff2"),
        ("fonts/space-grotesk-latin-ext-wght-normal.woff2", "font/woff2"),
        ("fonts/newsreader-latin-600-normal.woff2", "font/woff2"),
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


def test_map_tile_size_does_not_depend_on_the_viewport():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")
    track = re.search(r"\.map-track\s*\{(.*?)\n\}", css, re.DOTALL)

    assert track, ".map-track rule not found"
    tile_height = re.search(r"--tile-height:\s*([^;]+);", track.group(1))
    assert tile_height, "--tile-height not declared on .map-track"
    # A vh/vw/% based tile rescales on resize while the marker keeps stale pixels.
    assert not re.search(r"\d(vh|vw|vmin|vmax|svh|lvh|dvh)\b|%", tile_height.group(1))


def test_map_marker_is_placed_from_the_maps_own_css_variables():
    script = (STATIC_DIR / "js" / "map-marker.js").read_text(encoding="utf-8")
    css = (STATIC_DIR / "css" / "map-marker.css").read_text(encoding="utf-8")

    # JS hands over ratios only; it must not measure the DOM or write pixel positions.
    assert "getBoundingClientRect" not in script
    assert "style.left" not in script and "style.top" not in script
    assert "--marker-x" in script and "--marker-y" in script
    # CSS positions the marker with the same variables that size the map tile.
    assert "var(--marker-x" in css and "var(--tile-width)" in css
    assert "var(--marker-y" in css and "var(--tile-height)" in css


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


def test_font_preloads_match_the_urls_the_stylesheet_requests():
    page = app.test_client().get("/").get_data(as_text=True)
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")
    preloads = re.findall(r'rel="preload" href="([^"]+\.woff2)[^"]*"', page)

    assert len(preloads) == 2  # body font and title font
    for preload in preloads:
        assert "?" not in preload
        assert f"url(\"../fonts/{preload.rsplit('/', 1)[1]}\")" in css


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


def _dashboard_script():
    return (STATIC_DIR / "js" / "dashboard.js").read_text(encoding="utf-8")


def test_startup_tries_the_ip_lookup_before_asking_for_permission():
    script = _dashboard_script()
    start = script[script.index("/* ---------- Start ---------- */"):]
    lookup = script[script.index("const useApproximateLocation"):script.index("// Show the weather that is already loaded")]

    assert "useApproximateLocation()" in start
    assert "getCurrentPosition" not in start
    # Permission is asked for only when the IP lookup found nothing...
    assert "else requestPreciseLocation()" in lookup
    # ...or when the visitor clicks "Use my location".
    assert script.count("getCurrentPosition(") == 1
    assert script.count("requestPreciseLocation()") == 2  # the call above and useMyLocation
    assert 'locationButton.addEventListener("click"' in script
    assert "announce(" not in lookup  # the IP lookup itself stays silent


def test_denied_permission_falls_back_with_only_a_denial_message():
    script = _dashboard_script()

    assert 'const MESSAGE_DENIED = "Location permission was denied.";' in script
    assert "useFallbackLocation(error && error.code === 1 ? MESSAGE_DENIED" in script
    # Keep the place on screen, else the IP estimate, else New York (see the e2e tests).
    fallback = script[script.index("const useFallbackLocation"):script.index("const readSavedLocation")]
    assert fallback.index("shownLocation && lastData") < fallback.index("fetchApproximateLocation()")
    assert "applyLocation(location || DEFAULT_LOCATION)" in fallback
    assert "Still showing" not in script


def test_page_has_a_dismissible_toast():
    page = app.test_client().get("/").get_data(as_text=True)

    assert re.search(r'id="toast"[^>]*role="alert"', page)
    assert 'id="toast-close"' in page


def test_location_uses_vercel_geolocation_headers_without_an_outside_call():
    client = _location_client(trust_vercel_client_ip=True)
    headers = {
        "X-Vercel-IP-Latitude": "41.8781",
        "X-Vercel-IP-Longitude": "-87.6298",
        "X-Vercel-IP-City": "S%C3%A3o%20Paulo",
        "X-Vercel-IP-Country-Region": "SP",
        "X-Vercel-IP-Country": "BR",
    }

    with patch("app.weather_app.requests.Session.get") as get:
        result = client.get("/location", headers=headers, environ_overrides={"REMOTE_ADDR": "10.0.0.1"})

    assert result.status_code == 200
    assert result.get_json() == {
        "latitude": 41.8781,
        "longitude": -87.6298,
        "name": "São Paulo, SP, BR",
        "source": "Vercel IP geolocation",
    }
    get.assert_not_called()


def test_location_ignores_vercel_geolocation_headers_unless_trusted():
    headers = {"X-Vercel-IP-Latitude": "1", "X-Vercel-IP-Longitude": "2"}

    with patch("app.weather_app.requests.Session.get") as get:
        result = _location_client().get("/location", headers=headers)  # local address

    assert result.status_code == 404
    get.assert_not_called()


def test_location_falls_back_to_the_ip_provider_when_vercel_headers_are_missing_or_bad():
    for headers in ({}, {"X-Vercel-IP-Latitude": "x", "X-Vercel-IP-Longitude": "y"}):
        client = _location_client(trust_vercel_client_ip=True)
        with patch("app.weather_app.requests.Session.get", return_value=_ip_location_response()) as get:
            result = client.get(
                "/location",
                headers={**headers, "X-Vercel-Forwarded-For": "8.8.8.8"},
                environ_overrides={"REMOTE_ADDR": "10.0.0.1"},
            )
        assert result.status_code == 200
        get.assert_called_once_with("https://ipapi.co/8.8.8.8/json/", timeout=5)


def test_title_font_is_self_hosted_and_licensed():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")

    assert "Times New Roman" not in css
    assert re.search(r"--font-title:\s*\"Newsreader\"", css)
    assert (STATIC_DIR / "fonts" / "OFL-newsreader.txt").is_file()


def test_glass_surfaces_fall_back_to_opaque_when_transparency_is_unwanted():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")

    assert "--color-glass:" in css and "--glass-blur:" in css
    reduced = re.search(r"@media \(prefers-reduced-transparency: reduce\) \{(.*?)\n\}", css, re.DOTALL)
    assert reduced and "--color-glass: var(--color-surface)" in reduced.group(1)
    assert "--glass-blur: none" in reduced.group(1)
    assert "@supports not ((backdrop-filter: blur(1px))" in css


def test_search_card_stays_above_the_result_card():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")
    rule = re.search(r"\.search-card \{(.*?)\}", css, re.DOTALL)

    # backdrop-filter gives each card its own stacking context; without a higher
    # z-index the suggestion list would be painted under the result card.
    assert rule and "position: relative" in rule.group(1)
    assert re.search(r"z-index:\s*[1-9]", rule.group(1))


def test_every_repeat_of_the_map_gets_a_marker():
    script = (STATIC_DIR / "js" / "map-marker.js").read_text(encoding="utf-8")
    css = (STATIC_DIR / "css" / "map-marker.css").read_text(encoding="utf-8")

    assert re.search(r"MARKER_COPIES = [4-9]|MARKER_COPIES = \d{2}", script)
    assert "--marker-index" in script and "var(--marker-index" in css


def test_forecast_edge_fade_is_masked_and_keeps_a_visible_focus_ring():
    css = (STATIC_DIR / "css" / "dashboard.css").read_text(encoding="utf-8")

    assert 'data-fade-start="true"' in css and 'data-fade-end="true"' in css
    assert re.search(r"\.forecast \{[^}]*mask-image: linear-gradient", css, re.DOTALL)
    # A mask clips the strip's own outline, so the ring moves to the section.
    assert ".forecast-section:has(.forecast:focus-visible)" in css


def test_search_reuses_the_provider_answer_for_other_visitors():
    response = Mock()
    response.json.return_value = {
        "results": [
            {"name": "Paris", "latitude": 48.86, "longitude": 2.35, "country": "France"},
            {"name": "Paris", "latitude": 33.66, "longitude": -95.56, "country": "United States"},
        ]
    }

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        client = app.test_client()
        near_france = client.get("/search?q=Paris&latitude=48.8&longitude=2.3").get_json()
        near_texas = client.get("/search?q=paris&latitude=33.6&longitude=-95.5").get_json()

    get.assert_called_once()
    assert near_france["results"][0]["context"] == "France"
    assert near_texas["results"][0]["context"] == "United States"


def test_reverse_location_is_cached_for_nearby_coordinates():
    response = Mock()
    response.json.return_value = {"address": {"city": "Paris", "country": "France"}}

    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        client = app.test_client()
        first = client.get("/reverse-location?latitude=48.85661&longitude=2.35222")
        second = client.get("/reverse-location?latitude=48.85664&longitude=2.35218")

    get.assert_called_once()
    assert first.get_json() == second.get_json() == {"name": "Paris, France"}


def _search_with(places, query, **params):
    response = Mock()
    response.json.return_value = {"results": places}
    with patch("app.weather_app.requests.Session.get", return_value=response) as get:
        result = app.test_client().get("/search", query_string={"q": query, **params})
    return result.get_json()["results"], get


def _city(name, latitude, longitude, population, admin1="", country="", country_code=""):
    return {"name": name, "latitude": latitude, "longitude": longitude, "population": population,
            "admin1": admin1, "country": country, "country_code": country_code}


def test_search_ranks_every_upstream_match_not_just_the_first_ten():
    # The exact match arrives 15th from the provider; it must still come first.
    places = [_city(f"Springfield Heights {i}", 40, -74, 100) for i in range(14)]
    places.append(_city("Springfield", 39.8, -89.65, 114000, "Illinois", "United States", "US"))

    results, _ = _search_with(places, "Springfield")

    assert results[0]["name"] == "Springfield"
    assert len(results) == 10


def test_search_matches_names_without_accents():
    places = [
        _city("Saopolis", -23.5, -46.6, 5_000_000),
        _city("São Paulo", -23.55, -46.63, 12_000_000, "São Paulo", "Brazil", "BR"),
    ]

    results, _ = _search_with(places, "sao paulo")

    assert results[0]["name"] == "São Paulo"


def test_search_text_after_a_comma_narrows_by_region_or_country():
    places = [
        _city("Paris", 48.85, 2.35, 2_100_000, "Ile-de-France", "France", "FR"),
        _city("Paris", 33.66, -95.56, 25_000, "Texas", "United States", "US"),
    ]

    texas, get = _search_with(places, "Paris, Texas")
    by_code, _ = _search_with(places, "paris, us")

    assert [r["context"] for r in texas] == ["Texas, United States"]
    assert [r["context"] for r in by_code] == ["Texas, United States"]
    assert get.call_args.kwargs["params"]["name"] == "Paris"  # only the name goes upstream


def test_search_ignores_a_qualifier_that_matches_nothing():
    places = [_city("Paris", 48.85, 2.35, 2_100_000, "Ile-de-France", "France", "FR")]

    results, _ = _search_with(places, "Paris, Atlantis")

    assert [r["name"] for r in results] == ["Paris"]


def test_search_drops_duplicate_places_and_adds_a_distance():
    places = [
        _city("Oslo", 59.91, 10.75, 580_000, "Oslo", "Norway", "NO"),
        _city("Oslo", 59.92, 10.74, 0, "Oslo", "Norway", "NO"),
    ]

    results, _ = _search_with(places, "Oslo", latitude=59.91, longitude=10.75)

    assert len(results) == 1
    assert results[0]["distance_km"] == 0


def test_search_qualifier_matches_word_starts_not_any_substring():
    places = [
        _city("Moscow", 55.75, 37.62, 12_000_000, "Moscow", "Russia", "RU"),
        _city("Moscow", 46.73, -117.0, 25_000, "Idaho", "United States", "US"),
    ]

    us, _ = _search_with(places, "Moscow, us")
    unit, _ = _search_with(places, "Moscow, unit")

    assert [r["context"] for r in us] == ["Idaho, United States"]  # not "Russia"
    assert [r["context"] for r in unit] == ["Idaho, United States"]


def test_search_every_part_after_a_comma_must_match():
    places = [
        _city("Springfield", 39.8, -89.65, 114_000, "Illinois", "United States", "US"),
        _city("Springfield", 37.2, -93.3, 169_000, "Missouri", "United States", "US"),
    ]

    results, get = _search_with(places, "Springfield, Illinois, US")

    assert [r["context"] for r in results] == ["Illinois, United States"]
    assert get.call_args.kwargs["params"]["name"] == "Springfield"


def test_provider_retries_ignore_retry_after():
    # An uncapped Retry-After (e.g. 3600 s) would hold a worker thread for its whole length.
    from app.weather_app import _session

    retry = _session().get_adapter("https://example.com").max_retries
    assert retry.total == 1
    assert retry.respect_retry_after_header is False
