"""Characterization tests for app/api_contracts.py.

They pin down what the validators accept, reject and return, one branch at a
time, so the code can be restructured without changing behavior. Messages are
asserted exactly: they are logged, and /weather returns a generic error to the
client, so these strings are the only place a bad upstream payload is described.
"""

import copy

import pytest

from app.api_contracts import (
    InvalidUpstreamPayload,
    error_response,
    health_response,
    validate_location_response,
    validate_reverse_location_response,
    validate_search_response,
    validate_weather_response,
    weather_response,
)
from app.weather_app import app

CURRENT_FIELDS = (
    "time",
    "temperature_2m",
    "wind_speed_10m",
    "weather_code",
    "rain",
    "relative_humidity_2m",
)


def _weather(**overrides):
    payload = {
        "latitude": 40.7128,
        "longitude": -74.006,
        "timezone": "America/New_York",
        "current": {
            "time": 1794625200,
            "temperature_2m": 37.4,
            "wind_speed_10m": 8.2,
            "weather_code": 3,
            "rain": 0.0,
            "relative_humidity_2m": 71,
            "uv_index": 0.0,
        },
        "hourly": {
            "time": [1794625200, 1794628800, 1794632400],
            "temperature_2m": [37.4, 36.8, 36.1],
            "weather_code": [3, 3, 2],
        },
    }
    payload.update(overrides)
    return payload


def _rejects(payload, message):
    with pytest.raises(InvalidUpstreamPayload) as error:
        validate_weather_response(payload)
    assert str(error.value) == message


# ---------------------------------------------------------------------------
# validate_weather_response
# ---------------------------------------------------------------------------


def test_weather_accepts_a_complete_payload_and_returns_only_the_known_fields():
    payload = _weather(extra_top_level="ignored")
    payload["hourly"]["unused_series"] = [1, 2, 3]

    result = validate_weather_response(payload)

    assert set(result) == {"latitude", "longitude", "timezone", "current", "hourly", "daily"}
    assert result["daily"] is None  # optional; this payload has none
    assert result["latitude"] == 40.7128
    assert result["longitude"] == -74.006
    assert result["timezone"] == "America/New_York"
    assert set(result["hourly"]) == {"time", "temperature_2m", "weather_code"}
    assert result["hourly"]["time"] == payload["hourly"]["time"]


def test_weather_keeps_every_current_field_including_ones_it_does_not_check():
    result = validate_weather_response(_weather())

    assert result["current"]["time"] == 1794625200
    assert result["current"]["temperature_2m"] == 37.4


@pytest.mark.parametrize("payload", [None, [], "weather", 42])
def test_weather_rejects_a_payload_that_is_not_an_object(payload):
    _rejects(payload, "weather payload is not an object")


@pytest.mark.parametrize("current", [None, [], "now", 7])
def test_weather_rejects_missing_or_non_object_current_data(current):
    _rejects(_weather(current=current), "weather current data is missing")
    payload = _weather()
    del payload["current"]
    _rejects(payload, "weather current data is missing")


@pytest.mark.parametrize("field", CURRENT_FIELDS)
def test_weather_rejects_a_missing_current_field(field):
    payload = _weather()
    del payload["current"][field]

    _rejects(payload, f"weather field {field} is invalid")


@pytest.mark.parametrize("field", CURRENT_FIELDS)
@pytest.mark.parametrize("value", [None, "12", [1], {"v": 1}, True])
def test_weather_rejects_a_non_numeric_current_field(field, value):
    payload = _weather()
    payload["current"][field] = value

    _rejects(payload, f"weather field {field} is invalid")


def test_weather_reports_the_first_bad_current_field_in_a_fixed_order():
    payload = _weather()
    payload["current"]["uv_index"] = None
    payload["current"]["temperature_2m"] = None

    _rejects(payload, "weather field temperature_2m is invalid")


@pytest.mark.parametrize("hourly", [None, [], "later"])
def test_weather_rejects_missing_or_non_object_hourly_data(hourly):
    _rejects(_weather(hourly=hourly), "weather hourly data is missing")


@pytest.mark.parametrize("series", ["time", "temperature_2m", "weather_code"])
@pytest.mark.parametrize("value", [None, "abc", {"a": 1}, 5])
def test_weather_rejects_an_hourly_series_that_is_not_a_list(series, value):
    payload = _weather()
    payload["hourly"][series] = value

    _rejects(payload, "weather hourly data is invalid")


@pytest.mark.parametrize("series", ["time", "temperature_2m", "weather_code"])
def test_weather_rejects_a_missing_hourly_series(series):
    payload = _weather()
    del payload["hourly"][series]

    _rejects(payload, "weather hourly data is invalid")


def test_weather_rejects_empty_hourly_series():
    payload = _weather(hourly={"time": [], "temperature_2m": [], "weather_code": []})

    _rejects(payload, "weather hourly data is incomplete")


@pytest.mark.parametrize("series", ["time", "temperature_2m", "weather_code"])
def test_weather_rejects_hourly_series_of_different_lengths(series):
    payload = _weather()
    payload["hourly"][series] = payload["hourly"][series][:-1]

    _rejects(payload, "weather hourly data is incomplete")


def test_weather_rejects_a_non_numeric_hourly_temperature():
    payload = _weather()
    payload["hourly"]["temperature_2m"][1] = "cold"

    _rejects(payload, "weather hourly temperatures are invalid")


def test_weather_rejects_a_non_numeric_hourly_timestamp():
    payload = _weather()
    payload["hourly"]["time"][1] = "2026-11-14T04:00"

    _rejects(payload, "weather hourly timestamps are invalid")


def test_weather_rejects_a_non_numeric_hourly_weather_code():
    payload = _weather()
    payload["hourly"]["weather_code"][2] = None

    _rejects(payload, "weather hourly codes are invalid")


def test_weather_checks_hourly_temperatures_before_hourly_codes():
    payload = _weather()
    payload["hourly"]["temperature_2m"][0] = "x"
    payload["hourly"]["weather_code"][0] = "y"

    _rejects(payload, "weather hourly temperatures are invalid")


@pytest.mark.parametrize("field", ["latitude", "longitude"])
@pytest.mark.parametrize("value", [None, "north", [], {}])
def test_weather_rejects_unreadable_coordinates(field, value):
    _rejects(_weather(**{field: value}), "weather coordinates are invalid")


@pytest.mark.parametrize("field", ["latitude", "longitude"])
def test_weather_rejects_missing_coordinates(field):
    payload = _weather()
    del payload[field]

    _rejects(payload, "weather coordinates are invalid")


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [(90.01, 0), (-90.01, 0), (0, 180.01), (0, -180.01), (float("nan"), 0), (0, float("nan"))],
)
def test_weather_rejects_out_of_range_coordinates(latitude, longitude):
    _rejects(
        _weather(latitude=latitude, longitude=longitude),
        "weather coordinates are out of range",
    )


@pytest.mark.parametrize(("latitude", "longitude"), [(90, 180), (-90, -180), (0, 0)])
def test_weather_accepts_coordinates_on_the_boundary(latitude, longitude):
    result = validate_weather_response(_weather(latitude=latitude, longitude=longitude))

    assert (result["latitude"], result["longitude"]) == (latitude, longitude)


def test_weather_reads_numeric_strings_as_coordinates():
    result = validate_weather_response(_weather(latitude="40.5", longitude="-74"))

    assert (result["latitude"], result["longitude"]) == (40.5, -74.0)


@pytest.mark.parametrize("timezone", [None, "", "   ", 5, ["UTC"]])
def test_weather_falls_back_to_utc_for_a_missing_or_blank_timezone(timezone):
    assert validate_weather_response(_weather(timezone=timezone))["timezone"] == "UTC"


def test_weather_falls_back_to_utc_when_the_timezone_key_is_absent():
    payload = _weather()
    del payload["timezone"]

    assert validate_weather_response(payload)["timezone"] == "UTC"


def test_weather_keeps_at_most_48_hourly_points():
    count = 60
    payload = _weather(
        hourly={
            "time": [1794625200 + i * 3600 for i in range(count)],
            "temperature_2m": list(range(count)),
            "weather_code": [0] * count,
        }
    )

    hourly = validate_weather_response(payload)["hourly"]

    assert len(hourly["time"]) == len(hourly["temperature_2m"]) == len(hourly["weather_code"]) == 48
    assert hourly["time"][-1] == 1794625200 + 47 * 3600
    assert hourly["temperature_2m"][-1] == 47


def test_weather_does_not_modify_the_payload_it_validates():
    payload = _weather()
    before = copy.deepcopy(payload)

    validate_weather_response(payload)

    assert payload == before


def test_weather_checks_current_before_hourly_before_coordinates():
    payload = _weather(latitude=999, hourly=None)
    payload["current"]["rain"] = None
    _rejects(payload, "weather field rain is invalid")

    payload["current"]["rain"] = 0.0
    _rejects(payload, "weather hourly data is missing")

    payload["hourly"] = _weather()["hourly"]
    _rejects(payload, "weather coordinates are out of range")


def test_invalid_upstream_payload_is_a_value_error():
    # weather_app catches ValueError, so this must stay true.
    assert issubclass(InvalidUpstreamPayload, ValueError)


# ---------------------------------------------------------------------------
# validate_location_response
# ---------------------------------------------------------------------------


def _location_rejects(payload, message):
    with pytest.raises(InvalidUpstreamPayload) as error:
        validate_location_response(payload)
    assert str(error.value) == message


@pytest.mark.parametrize("payload", [None, [], "here"])
def test_location_rejects_a_payload_that_is_not_an_object(payload):
    _location_rejects(payload, "location payload is not an object")


@pytest.mark.parametrize(
    "payload",
    [{}, {"latitude": 1}, {"longitude": 1}, {"latitude": "x", "longitude": 1}, {"latitude": None, "longitude": 1}],
)
def test_location_rejects_missing_or_unreadable_coordinates(payload):
    _location_rejects(payload, "location coordinates are invalid")


@pytest.mark.parametrize(("latitude", "longitude"), [(91, 0), (0, 181), (-91, 0), (0, -181)])
def test_location_rejects_out_of_range_coordinates(latitude, longitude):
    _location_rejects(
        {"latitude": latitude, "longitude": longitude},
        "location coordinates are out of range",
    )


@pytest.mark.parametrize(("latitude", "longitude"), [(90, 180), (-90, -180), (0, 0)])
def test_location_accepts_coordinates_on_the_boundary(latitude, longitude):
    result = validate_location_response({"latitude": latitude, "longitude": longitude})

    assert (result["latitude"], result["longitude"]) == (latitude, longitude)


def test_location_builds_a_name_from_the_parts_it_has():
    full = {"latitude": "40.71", "longitude": "-74.01", "city": "New York",
            "region": "New York", "country_name": "United States"}

    assert validate_location_response(full) == {
        "latitude": 40.71,
        "longitude": -74.01,
        "name": "New York, New York, United States",
    }
    assert validate_location_response({**full, "region": None})["name"] == "New York, United States"
    assert validate_location_response({**full, "city": "", "region": 5})["name"] == "United States"


def test_location_without_any_name_parts_is_called_an_approximate_location():
    result = validate_location_response({"latitude": 1, "longitude": 2})

    assert result["name"] == "Approximate location"


# ---------------------------------------------------------------------------
# validate_search_response
# ---------------------------------------------------------------------------


def _place(**overrides):
    place = {"name": "Paris", "latitude": 48.85, "longitude": 2.35, "population": 2000000,
             "admin1": "Ile-de-France", "country": "France"}
    place.update(overrides)
    return place


def _search_rejects(payload):
    with pytest.raises(InvalidUpstreamPayload) as error:
        validate_search_response(payload)
    assert str(error.value) == "location search payload is invalid"


@pytest.mark.parametrize("payload", [None, [], "paris"])
def test_search_rejects_a_payload_that_is_not_an_object(payload):
    _search_rejects(payload)


def test_search_treats_a_payload_without_results_or_error_as_no_results():
    assert validate_search_response({}) == []
    assert validate_search_response({"generationtime_ms": 0.4}) == []


def test_search_rejects_an_error_payload_without_results():
    _search_rejects({"error": True, "reason": "rate limited"})


@pytest.mark.parametrize("results", [None, {}, "Paris", 3])
def test_search_rejects_results_that_are_not_a_list(results):
    _search_rejects({"results": results})


def test_search_returns_normalized_places():
    [result] = validate_search_response({"results": [_place(name="  Paris ")]})

    assert result == {
        "name": "Paris",
        "context": "Ile-de-France, France",
        "latitude": 48.85,
        "longitude": 2.35,
        "population": 2000000.0,
        "country_code": "",
    }


def test_search_context_uses_only_the_parts_present():
    results = validate_search_response(
        {"results": [_place(admin1=None), _place(country=""), _place(admin1="", country=None)]}
    )

    assert [r["context"] for r in results] == ["France", "Ile-de-France", ""]


def test_search_defaults_a_missing_population_to_zero():
    results = validate_search_response(
        {"results": [_place(population=None), {k: v for k, v in _place().items() if k != "population"}]}
    )

    assert [r["population"] for r in results] == [0.0, 0.0]


@pytest.mark.parametrize(
    "bad",
    [
        "not an object",
        None,
        {"latitude": 1, "longitude": 2},  # no name
        _place(name="   "),
        _place(name=""),
        _place(latitude="x"),
        _place(longitude=None),
        _place(population="lots"),
        _place(population=-1),
        _place(latitude=91),
        _place(latitude=-91),
        _place(longitude=181),
        _place(longitude=-181),
    ],
)
def test_search_skips_entries_it_cannot_use_and_keeps_the_rest(bad):
    results = validate_search_response({"results": [bad, _place(name="Rome")]})

    assert [r["name"] for r in results] == ["Rome"]


@pytest.mark.parametrize(("latitude", "longitude"), [(90, 180), (-90, -180)])
def test_search_keeps_places_on_the_coordinate_boundary(latitude, longitude):
    results = validate_search_response(
        {"results": [_place(latitude=latitude, longitude=longitude)]}
    )

    assert [(r["latitude"], r["longitude"]) for r in results] == [(latitude, longitude)]


def test_search_keeps_a_place_with_zero_population():
    assert validate_search_response({"results": [_place(population=0)]})[0]["population"] == 0.0


def test_search_keeps_every_valid_entry_for_the_caller_to_rank():
    # /search ranks all upstream matches before trimming, so nothing is cut here.
    entries = [{"nope": True}] * 5 + [
        _place(name=f"City {i}", country_code=" fr ") for i in range(15)
    ]

    results = validate_search_response({"results": entries})

    assert [r["name"] for r in results] == [f"City {i}" for i in range(15)]
    assert results[0]["country_code"] == "FR"


# ---------------------------------------------------------------------------
# validate_reverse_location_response
# ---------------------------------------------------------------------------


def _reverse_rejects(payload, message):
    with pytest.raises(InvalidUpstreamPayload) as error:
        validate_reverse_location_response(payload)
    assert str(error.value) == message


@pytest.mark.parametrize("payload", [None, [], "x", {}, {"address": None}, {"address": []}])
def test_reverse_location_rejects_a_payload_without_an_address_object(payload):
    _reverse_rejects(payload, "reverse location payload is invalid")


@pytest.mark.parametrize("address", [{}, {"state": "Texas"}, {"city": ""}, {"city": None}])
def test_reverse_location_rejects_an_address_without_a_place_name(address):
    _reverse_rejects({"address": address}, "reverse location name is missing")


def test_reverse_location_prefers_city_then_town_then_village_then_municipality():
    address = {"municipality": "M", "village": "V", "town": "T", "city": "C"}

    for field, expected in [("city", "C"), ("town", "T"), ("village", "V"), ("municipality", "M")]:
        assert validate_reverse_location_response({"address": address}) == {"name": expected}
        address = {k: v for k, v in address.items() if k != field}


def test_reverse_location_appends_state_and_country_when_present():
    base = {"city": "Austin", "state": "Texas", "country": "United States"}

    assert validate_reverse_location_response({"address": base})["name"] == "Austin, Texas, United States"
    assert validate_reverse_location_response({"address": {**base, "state": ""}})["name"] == "Austin, United States"
    assert validate_reverse_location_response({"address": {"city": "Austin"}})["name"] == "Austin"


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def test_error_response_carries_the_status_and_message():
    with app.test_request_context():
        response = error_response("nope", 418)

    assert response.status_code == 418
    assert response.get_json() == {"error": "nope"}


def test_error_response_adds_extra_headers():
    with app.test_request_context():
        response = error_response("slow down", 429, {"Retry-After": "60"})

    assert response.headers["Retry-After"] == "60"
    assert response.status_code == 429


def test_health_response_reports_ok():
    with app.test_request_context():
        assert health_response().get_json() == {"status": "ok"}


def test_weather_response_labels_the_source():
    validated = validate_weather_response(_weather())

    with app.test_request_context():
        body = weather_response(validated).get_json()

    assert body.pop("source") == "Open-Meteo"
    assert body == validated


# ---------------------------------------------------------------------------
# AppConfig.from_env defaults (UPSTREAM_TIMEOUT was read with a non-str default)
# ---------------------------------------------------------------------------

CONFIG_VARS = (
    "UPSTREAM_TIMEOUT", "WEATHER_CACHE_TTL", "WEATHER_CACHE_SIZE", "RATE_LIMIT",
    "RATE_WINDOW", "SEARCH_CACHE_TTL",
    "TRUST_VERCEL_CLIENT_IP", "VERCEL",
)


@pytest.fixture
def clean_env(monkeypatch):
    for name in CONFIG_VARS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_config_defaults_when_nothing_is_set(clean_env):
    from app.weather_app import AppConfig

    config = AppConfig.from_env()

    assert config.upstream_timeout == 5.0
    assert isinstance(config.upstream_timeout, float)
    assert (config.cache_ttl, config.cache_size) == (30, 256)
    assert (config.rate_limit, config.rate_window, config.search_cache_ttl) == (60, 60, 300)


def test_config_reads_a_fractional_timeout(clean_env):
    from app.weather_app import AppConfig

    clean_env.setenv("UPSTREAM_TIMEOUT", "2.5")

    assert AppConfig.from_env().upstream_timeout == 2.5


@pytest.mark.parametrize("name", ["UPSTREAM_TIMEOUT", "RATE_LIMIT", "WEATHER_CACHE_TTL"])
@pytest.mark.parametrize("value", ["0", "-1"])
def test_config_rejects_non_positive_numbers(clean_env, name, value):
    from app.weather_app import AppConfig

    clean_env.setenv(name, value)

    with pytest.raises(ValueError, match=name):
        AppConfig.from_env()


@pytest.mark.parametrize("name", ["UPSTREAM_TIMEOUT", "RATE_WINDOW"])
def test_config_rejects_text_where_a_number_is_expected(clean_env, name):
    from app.weather_app import AppConfig

    clean_env.setenv(name, "soon")

    with pytest.raises(ValueError):
        AppConfig.from_env()


# ---------------------------------------------------------------------------
# Optional current details and daily summaries
# ---------------------------------------------------------------------------

DAILY = {
    "time": [1794603600, 1794690000, 1794776400],
    "temperature_2m_max": [41.2, 44.0, 45.1],
    "temperature_2m_min": [30.1, 33.5, 35.0],
    "sunrise": [1794628800, 1794715260, 1794801720],
    "sunset": [1794664200, 1794750540, 1794836880],
    "uv_index_max": [2.5, None, 3.0],
    "precipitation_sum": [1.2, 0.0, 0.0],
    "precipitation_probability_max": [40, 10, 5],
    "snowfall_sum": [0.0, 0.0, 0.0],
}


def test_weather_keeps_optional_current_details_and_allows_null():
    payload = _weather()
    payload["current"].update(apparent_temperature=31.0, visibility=None, is_day=1)

    current = validate_weather_response(payload)["current"]

    assert current["apparent_temperature"] == 31.0
    assert current["visibility"] is None
    assert current["is_day"] == 1


@pytest.mark.parametrize("value", ["12", [1], True])
def test_weather_rejects_an_optional_current_detail_that_is_not_a_number(value):
    payload = _weather()
    payload["current"]["pressure_msl"] = value
    _rejects(payload, "weather field pressure_msl is invalid")


def test_weather_daily_is_trimmed_to_two_days_and_keeps_nulls():
    daily = validate_weather_response(_weather(daily=copy.deepcopy(DAILY)))["daily"]

    assert daily["time"] == DAILY["time"][:2]
    assert daily["uv_index_max"] == [2.5, None]
    assert daily["precipitation_probability_max"] == [40, 10]


def test_weather_daily_drops_unknown_series_and_allows_missing_ones():
    daily = {"time": DAILY["time"], "sunrise": DAILY["sunrise"], "unknown": [1, 2, 3]}

    result = validate_weather_response(_weather(daily=daily))["daily"]

    assert set(result) == {"time", "sunrise"}


@pytest.mark.parametrize("daily", [[], "today", {"time": []}, {"time": "x"}])
def test_weather_rejects_a_malformed_daily_block(daily):
    _rejects(_weather(daily=daily), "weather daily data is invalid")


def test_weather_rejects_a_daily_series_of_the_wrong_length_or_type():
    _rejects(
        _weather(daily={**DAILY, "sunrise": DAILY["sunrise"][:2]}),
        "weather daily sunrise is invalid",
    )
    _rejects(
        _weather(daily={**DAILY, "sunset": ["6pm", None, None]}),
        "weather daily sunset is invalid",
    )


def test_weather_keeps_the_current_uv_index_and_allows_null():
    payload = _weather()
    payload["current"]["uv_index"] = 3.1
    assert validate_weather_response(payload)["current"]["uv_index"] == 3.1
    payload["current"]["uv_index"] = None
    assert validate_weather_response(payload)["current"]["uv_index"] is None
