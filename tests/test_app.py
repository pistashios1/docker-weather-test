from unittest.mock import Mock, patch

import pytest
import requests

from weather_app import AppConfig, app, create_app


@pytest.fixture(autouse=True)
def clear_weather_cache():
    app.extensions["weather_cache"]._items.clear()
    app.extensions["search_cache"]._items.clear()


def test_index_serves_weather_frontend():
    result = app.test_client().get("/")

    assert result.status_code == 200
    assert b"Website Lookup" in result.data


def test_location_returns_ip_coordinates():
    response = Mock()
    response.json.return_value = {
        "latitude": "40.71",
        "longitude": "-74.01",
        "city": "New York",
        "country_name": "United States",
    }

    with patch("weather_app.requests.Session.get", return_value=response) as get:
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
    with patch("weather_app.requests.Session.get", side_effect=requests.RequestException):
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

    with patch("weather_app.requests.Session.get", return_value=response) as get:
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
    assert "at least 1" in result.get_json()["error"]


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

    with patch("weather_app.requests.Session.get", return_value=response):
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

    with patch("weather_app.requests.Session.get", return_value=response):
        result = app.test_client().get("/reverse-location?latitude=40.71&longitude=-74.01")

    assert result.status_code == 200
    assert result.get_json() == {"name": "New York, New York, United States"}


def test_weather_returns_current_conditions():
    response = Mock()
    response.json.return_value = {
        "latitude": 40.71,
        "longitude": -74.01,
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

    with patch("weather_app.requests.Session.get", return_value=response) as get:
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 200
    assert result.get_json()["current"]["temperature_2m"] == 72.5
    assert result.get_json()["current"]["rain"] == 0.4
    get.assert_called_once()


def test_weather_rejects_out_of_range_coordinates():
    result = app.test_client().get("/weather?latitude=91&longitude=0")

    assert result.status_code == 400
    assert "between" in result.get_json()["error"]


def test_weather_reports_upstream_failure():
    with patch("weather_app.requests.Session.get", side_effect=requests.RequestException):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_weather_reports_invalid_upstream_json():
    response = Mock()
    response.json.side_effect = ValueError

    with patch("weather_app.requests.Session.get", return_value=response):
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

    with patch("weather_app.requests.Session.get", return_value=response):
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

    with patch("weather_app.requests.Session.get", return_value=response) as get:
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
