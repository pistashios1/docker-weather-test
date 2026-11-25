"""API contracts for validating upstream API responses.

This module provides validation functions that check and normalize data from external APIs,
particularly Open-Meteo weather data and geocoding services.
"""

from typing import Any

from flask import jsonify


class InvalidUpstreamPayload(ValueError):
    """Custom exception raised when an upstream API response is invalid.

    Validates payloads from external services to ensure they meet expected schemas.
    Raises this exception with a descriptive message when validation fails, allowing
    clients to log the exact error message.
    """
    pass


def health_response():
    """Return HTTP health check response.

    Returns a JSON response indicating the service is operational.

    Returns:
        flask.Response: HTTP 200 response with {"status": "ok"} body.
    """
    return jsonify({"status": "ok"})


def error_response(message: str, status_code: int, headers: dict[str, str] | None = None):
    """Create an HTTP error response with optional custom headers.

    Builds a JSON error body and configures the HTTP status code and headers.

    Args:
        message: Error message to display to the client.
        status_code: HTTP status code (e.g., 400, 429, 500).
        headers: Optional dict of additional headers to apply.

    Returns:
        flask.Response: HTTP response with error JSON body and configured status/code.
    """
    response = jsonify({"error": message})
    response.status_code = status_code
    if headers:
        response.headers.update(headers)
    return response


def _is_number(value: Any) -> bool:
    """Check if a value is a JSON number.

    Accepts int and float values. Strings and booleans (which Python counts as
    ints) are rejected.

    Args:
        value: The value to check.

    Returns:
        bool: True if the value is an int or float but not a bool, False otherwise.
    """
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _parse_coordinates(data: dict[str, Any], label: str) -> tuple[float, float]:
    """Extract and validate latitude and longitude from payload data.

    Reads the latitude and longitude fields, converts them to floats, and checks
    that they fall within valid geographic ranges. The `label` parameter is used
    in error messages to identify which data source failed validation.

    Args:
        data: Payload dict containing "latitude" and "longitude" keys.
        label: Human-readable name for the data source (e.g., "location", "weather").

    Returns:
        tuple[float, float]: The parsed latitude and longitude as floats.

    Raises:
        InvalidUpstreamPayload: If coordinates are missing, malformed, or out of range.
    """
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidUpstreamPayload(f"{label} coordinates are invalid") from error
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InvalidUpstreamPayload(f"{label} coordinates are out of range")
    return latitude, longitude


def validate_location_response(data: Any) -> dict[str, Any]:
    """Validate and normalize a geocoding response payload.

    Checks that the payload is a dictionary with valid latitude/longitude, then
    constructs a normalized response including optional city, region, and country data.

    Args:
        data: Payload from a geocoding API (must be a dict).

    Returns:
        dict[str, Any]: Normalized location dict with "latitude", "longitude", and "name".

    Raises:
        InvalidUpstreamPayload: If the payload is not a dict or coordinates are invalid.
    """
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("location payload is not an object")
    latitude, longitude = _parse_coordinates(data, "location")
    city = data.get("city")
    region = data.get("region")
    country = data.get("country_name")
    location_parts = [part for part in (city, region, country) if isinstance(part, str) and part]
    return {
        "latitude": latitude,
        "longitude": longitude,
        "name": ", ".join(location_parts) or "Approximate location",
    }


# /search ranks every valid upstream match, then returns at most this many.
MAX_SEARCH_RESULTS = 10


def _parse_search_item(item: Any) -> dict[str, Any] | None:
    """Parse and validate a single place item from search results.

    Extracts latitude, longitude, name, and population from an item, performing
    strict type checks and range validations to ensure the place is usable.

    Args:
        item: A dictionary representing a place from search results.

    Returns:
        dict[str, Any] | None: Normalized place data if valid, None otherwise.
    """
    if not isinstance(item, dict):
        return None
    try:
        latitude = float(item["latitude"])
        longitude = float(item["longitude"])
        name = str(item["name"]).strip()
        population = float(item.get("population") or 0)
    except (KeyError, TypeError, ValueError):
        return None
    in_range = -90 <= latitude <= 90 and -180 <= longitude <= 180
    if not name or population < 0 or not in_range:
        return None
    context = ", ".join(
        str(item[field]).strip() for field in ("admin1", "country") if item.get(field)
    )
    return {
        "name": name,
        "context": context,
        "latitude": latitude,
        "longitude": longitude,
        "population": population,
        "country_code": str(item.get("country_code") or "").strip().upper(),
    }


def validate_search_response(data: Any) -> list[dict[str, Any]]:
    """Validate and normalize a geocoding search response payload.

    Checks the payload structure and keeps every valid place. The caller ranks them
    and trims the list (the provider is already asked for a bounded number).

    Args:
        data: Payload from a geocoding search API (must have "results" key).

    Returns:
        list[dict[str, Any]]: List of normalized place dicts, empty if no valid places.

    Raises:
        InvalidUpstreamPayload: If the payload is not a dict or results are invalid.
    """
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("location search payload is invalid")
    if "results" not in data:
        if "error" not in data:
            return []
        raise InvalidUpstreamPayload("location search payload is invalid")
    if not isinstance(data["results"], list):
        raise InvalidUpstreamPayload("location search payload is invalid")
    parsed = (_parse_search_item(item) for item in data["results"])
    return [result for result in parsed if result is not None]


def validate_reverse_location_response(data: Any) -> dict[str, str]:
    """Validate and normalize a reverse geocoding response payload.

    Extracts the place name from an address object (preferring city over town etc.)
    and appends state/country context when available.

    Args:
        data: Payload from a reverse geocoding API (must have "address" dict).

    Returns:
        dict[str, str]: Dict with a single "name" key containing the place string.

    Raises:
        InvalidUpstreamPayload: If the payload structure or name is invalid.
    """
    if not isinstance(data, dict) or not isinstance(data.get("address"), dict):
        raise InvalidUpstreamPayload("reverse location payload is invalid")
    address = data["address"]
    name = next(
        (address.get(field) for field in ("city", "town", "village", "municipality") if address.get(field)),
        None,
    )
    if not name:
        raise InvalidUpstreamPayload("reverse location name is missing")
    context = ", ".join(
        str(address[field]).strip()
        for field in ("state", "country")
        if address.get(field)
    )
    return {"name": f"{name}, {context}" if context else str(name)}


# Fields /weather needs from Open-Meteo's "current" block. All must be numbers.
CURRENT_FIELDS = (
    "time",
    "temperature_2m",
    "wind_speed_10m",
    "weather_code",
    "rain",
    "relative_humidity_2m",
)

# Extra "current" details. Some models leave a value out or send null; the page
# then shows "--" for that one detail instead of failing the whole request.
OPTIONAL_CURRENT_FIELDS = (
    "apparent_temperature",
    "wind_direction_10m",
    "precipitation",
    "snowfall",
    "dew_point_2m",
    "pressure_msl",
    "visibility",
    "is_day",
    "uv_index",
)

# Daily summaries. "time" is each day's local midnight as a Unix timestamp.
DAILY_FIELDS = (
    "weather_code",
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "sunrise",
    "sunset",
    "uv_index_max",
    "precipitation_sum",
    "precipitation_probability_max",
    "snowfall_sum",
    "wind_speed_10m_max",
)

# The hourly series are cut to this many points (two days of hourly data).
MAX_HOURLY_POINTS = 48

# A week from today, matching forecast_days.
MAX_DAILY_POINTS = 7


def _validate_current(data: dict[str, Any]) -> dict[str, Any]:
    """Validate Open-Meteo current weather data.

    Checks that the "current" block contains all required numeric fields.

    Args:
        data: Weather payload containing the "current" object.

    Returns:
        dict[str, Any]: The validated "current" dict.

    Raises:
        InvalidUpstreamPayload: If "current" is missing or any required field is invalid.
    """
    current = data.get("current")
    if not isinstance(current, dict):
        raise InvalidUpstreamPayload("weather current data is missing")
    for field in CURRENT_FIELDS:
        if field not in current or not _is_number(current[field]):
            raise InvalidUpstreamPayload(f"weather field {field} is invalid")
    for field in OPTIONAL_CURRENT_FIELDS:
        if current.get(field) is not None and not _is_number(current[field]):
            raise InvalidUpstreamPayload(f"weather field {field} is invalid")
    return current


def _require_numbers(values: list[Any], message: str) -> None:
    """Ensure all values in a list are numeric.

    Checks types only; there is no range check.

    Args:
        values: List of values to validate (e.g., hourly temperatures).
        message: Error message to raise if validation fails.

    Raises:
        InvalidUpstreamPayload: If any value is not numeric.
    """
    if not all(_is_number(value) for value in values):
        raise InvalidUpstreamPayload(message)


def _require_numbers_or_null(values: list[Any], message: str) -> None:
    """Like _require_numbers, but null entries are allowed."""
    _require_numbers([value for value in values if value is not None], message)


def _validate_hourly(data: dict[str, Any]) -> dict[str, list[Any]]:
    """Validate and trim Open-Meteo hourly weather data.

    Checks that the "hourly" block contains non-empty, matching lists for
    timestamps, temperatures, and weather codes, limits them to the configured
    two-day window, then validates the numeric values in that window.

    Args:
        data: Weather payload containing the "hourly" object.

    Returns:
        dict[str, list[Any]]: Hourly timestamps and weather values, limited to
        48 points.

    Raises:
        InvalidUpstreamPayload: If "hourly" is missing, malformed, incomplete,
        or contains invalid numeric series.
    """
    hourly = data.get("hourly")
    if not isinstance(hourly, dict):
        raise InvalidUpstreamPayload("weather hourly data is missing")
    times = hourly.get("time")
    temperatures: list[float] = hourly.get("temperature_2m")
    weather_codes: list[int] = hourly.get("weather_code")
    if not all(isinstance(series, list) for series in (times, temperatures, weather_codes)):
        raise InvalidUpstreamPayload("weather hourly data is invalid")
    if not times or len(times) != len(temperatures) or len(times) != len(weather_codes):
        raise InvalidUpstreamPayload("weather hourly data is incomplete")
    # Only the served hours are checked: the request covers a week, so a bad
    # value in an hour that is cut off must not fail the lookup.
    times = times[:MAX_HOURLY_POINTS]
    temperatures = temperatures[:MAX_HOURLY_POINTS]
    weather_codes = weather_codes[:MAX_HOURLY_POINTS]
    _require_numbers(times, "weather hourly timestamps are invalid")
    # A model can leave single hours empty (null); the page shows "--" for those.
    _require_numbers_or_null(temperatures, "weather hourly temperatures are invalid")
    _require_numbers_or_null(weather_codes, "weather hourly codes are invalid")
    return {
        "time": times,
        "temperature_2m": temperatures,
        "weather_code": weather_codes,
    }


def _validate_daily(data: dict[str, Any]) -> dict[str, list[Any]] | None:
    """Validate Open-Meteo daily summaries, if the payload has them.

    Missing daily data is allowed (the page shows "--" for those details).
    When present, "time" must be a non-empty list of numbers, and each known
    series must be a list of the same length holding numbers or nulls.

    Raises:
        InvalidUpstreamPayload: If the daily block is present but malformed.
    """
    daily = data.get("daily")
    if daily is None:
        return None
    if not isinstance(daily, dict):
        raise InvalidUpstreamPayload("weather daily data is invalid")
    times = daily.get("time")
    if not isinstance(times, list) or not times:
        raise InvalidUpstreamPayload("weather daily data is invalid")
    _require_numbers(times, "weather daily dates are invalid")
    result = {"time": times[:MAX_DAILY_POINTS]}
    for field in DAILY_FIELDS:
        series = daily.get(field)
        if series is None:
            continue
        if not isinstance(series, list) or len(series) != len(times):
            raise InvalidUpstreamPayload(f"weather daily {field} is invalid")
        if not all(value is None or _is_number(value) for value in series):
            raise InvalidUpstreamPayload(f"weather daily {field} is invalid")
        result[field] = series[:MAX_DAILY_POINTS]
    return result


def _timezone_or_utc(data: dict[str, Any]) -> str:
    timezone = data.get("timezone")
    if isinstance(timezone, str) and timezone.strip():
        return timezone
    return "UTC"


def validate_weather_response(data: Any) -> dict[str, Any]:
    """Check an Open-Meteo forecast and return only the fields the API serves.

    The checks run in a fixed order (current, hourly, daily, coordinates) and the first
    failure is the one reported.
    """
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("weather payload is not an object")
    current = _validate_current(data)
    hourly = _validate_hourly(data)
    daily = _validate_daily(data)
    latitude, longitude = _parse_coordinates(data, "weather")
    return {
        "latitude": latitude,
        "longitude": longitude,
        "timezone": _timezone_or_utc(data),
        "current": current,
        "hourly": hourly,
        "daily": daily,
    }


def weather_response(data: dict[str, Any]):
    """Create an HTTP response for Open-Meteo weather data.

    Validates the input and wraps validated weather data in a JSON response
    with metadata including coordinates, timezone, current conditions, hourly
    forecast, and the data source.

    Args:
        data: A dict containing validated weather data from validate_weather_response.
               Must have "latitude", "longitude", "timezone", "current" and "hourly"
               keys; "daily" may be missing or None.

    Returns:
        flask.Response: HTTP 200 response with weather JSON body including "source" field.

    Example:
        >>> payload = {"latitude": 40, "longitude": -75, "timezone": "UTC", ...}
        >>> response = weather_response(payload)
        >>> response.get_json()
        {"latitude": 40, "longitude": -75, ..., "source": "Open-Meteo"}
    """
    return jsonify(
        {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "timezone": data["timezone"],
            "current": data["current"],
            "hourly": data["hourly"],
            "daily": data.get("daily"),
            "source": "Open-Meteo",
        }
    )
