from unittest.mock import Mock, patch

import requests

from app import app


def test_index_serves_weather_frontend():
    result = app.test_client().get("/")

    assert result.status_code == 200
    assert b"Current Weather" in result.data


def test_location_returns_ip_coordinates():
    response = Mock()
    response.json.return_value = {"latitude": "40.71", "longitude": "-74.01"}

    with patch("app.requests.get", return_value=response) as get:
        result = app.test_client().get("/location")

    assert result.status_code == 200
    assert result.get_json() == {
        "latitude": 40.71,
        "longitude": -74.01,
        "source": "IP location",
    }
    get.assert_called_once_with("https://ipapi.co/json/", timeout=5)


def test_location_reports_lookup_failure():
    with patch("app.requests.get", side_effect=requests.RequestException):
        result = app.test_client().get("/location")

    assert result.status_code == 502
    assert result.get_json() == {"error": "location service unavailable"}


def test_weather_returns_current_conditions():
    response = Mock()
    response.json.return_value = {
        "latitude": 40.71,
        "longitude": -74.01,
        "current": {"temperature_2m": 72.5, "wind_speed_10m": 4.2},
    }

    with patch("app.requests.get", return_value=response) as get:
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 200
    assert result.get_json()["current"]["temperature_2m"] == 72.5
    get.assert_called_once()


def test_weather_rejects_out_of_range_coordinates():
    result = app.test_client().get("/weather?latitude=91&longitude=0")

    assert result.status_code == 400
    assert "between" in result.get_json()["error"]


def test_weather_reports_upstream_failure():
    with patch("app.requests.get", side_effect=requests.RequestException):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_weather_reports_invalid_upstream_json():
    response = Mock()
    response.json.side_effect = ValueError

    with patch("app.requests.get", return_value=response):
        result = app.test_client().get("/weather?latitude=40.71&longitude=-74.01")

    assert result.status_code == 502
    assert result.get_json() == {"error": "weather service unavailable"}


def test_healthz():
    result = app.test_client().get("/healthz")

    assert result.status_code == 200
    assert result.get_json() == {"status": "ok"}
