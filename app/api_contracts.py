from typing import Any

from flask import jsonify


class InvalidUpstreamPayload(ValueError):
    pass


def health_response():
    return jsonify({"status": "ok"})


def error_response(message: str, status_code: int, headers: dict[str, str] | None = None):
    response = jsonify({"error": message})
    response.status_code = status_code
    if headers:
        response.headers.update(headers)
    return response


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float))


def _parse_coordinates(data: dict[str, Any], label: str) -> tuple[float, float]:
    """Read and range-check data["latitude"] and data["longitude"].

    `label` names the payload in the error message ("location", "weather").
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


def validate_search_response(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("location search payload is invalid")
    if "results" not in data:
        if "error" not in data:
            return []
        raise InvalidUpstreamPayload("location search payload is invalid")
    if not isinstance(data["results"], list):
        raise InvalidUpstreamPayload("location search payload is invalid")
    results = []
    for item in data["results"][:10]:
        if not isinstance(item, dict):
            continue
        try:
            latitude = float(item["latitude"])
            longitude = float(item["longitude"])
            name = str(item["name"]).strip()
            population = float(item.get("population") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if (
            not name
            or population < 0
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            continue
        context = ", ".join(
            str(item[field]).strip()
            for field in ("admin1", "country")
            if item.get(field)
        )
        results.append(
            {
                "name": name,
                "context": context,
                "latitude": latitude,
                "longitude": longitude,
                "population": population,
            }
        )
    return results


def validate_reverse_location_response(data: Any) -> dict[str, str]:
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
    "temperature_2m",
    "wind_speed_10m",
    "weather_code",
    "rain",
    "relative_humidity_2m",
    "uv_index",
)

# The hourly series are cut to this many points (two days of hourly data).
MAX_HOURLY_POINTS = 48


def _validate_current(data: dict[str, Any]) -> dict[str, Any]:
    current = data.get("current")
    if not isinstance(current, dict):
        raise InvalidUpstreamPayload("weather current data is missing")
    for field in CURRENT_FIELDS:
        if field not in current or not _is_number(current[field]):
            raise InvalidUpstreamPayload(f"weather field {field} is invalid")
    return current


def _require_numbers(values: list[Any], message: str) -> None:
    if not all(_is_number(value) for value in values):
        raise InvalidUpstreamPayload(message)


def _validate_hourly(data: dict[str, Any]) -> dict[str, list[Any]]:
    hourly = data.get("hourly")
    if not isinstance(hourly, dict):
        raise InvalidUpstreamPayload("weather hourly data is missing")
    times = hourly.get("time")
    temperatures = hourly.get("temperature_2m")
    weather_codes = hourly.get("weather_code")
    if not all(isinstance(series, list) for series in (times, temperatures, weather_codes)):
        raise InvalidUpstreamPayload("weather hourly data is invalid")
    if not times or len(times) != len(temperatures) or len(times) != len(weather_codes):
        raise InvalidUpstreamPayload("weather hourly data is incomplete")
    _require_numbers(temperatures, "weather hourly temperatures are invalid")
    _require_numbers(weather_codes, "weather hourly codes are invalid")
    return {
        "time": times[:MAX_HOURLY_POINTS],
        "temperature_2m": temperatures[:MAX_HOURLY_POINTS],
        "weather_code": weather_codes[:MAX_HOURLY_POINTS],
    }


def _timezone_or_utc(data: dict[str, Any]) -> str:
    timezone = data.get("timezone")
    if isinstance(timezone, str) and timezone.strip():
        return timezone
    return "UTC"


def validate_weather_response(data: Any) -> dict[str, Any]:
    """Check an Open-Meteo forecast and return only the fields the API serves.

    The checks run in a fixed order (current, hourly, coordinates) and the first
    failure is the one reported.
    """
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("weather payload is not an object")
    current = _validate_current(data)
    hourly = _validate_hourly(data)
    latitude, longitude = _parse_coordinates(data, "weather")
    return {
        "latitude": latitude,
        "longitude": longitude,
        "timezone": _timezone_or_utc(data),
        "current": current,
        "hourly": hourly,
    }


def weather_response(data: dict[str, Any]):
    return jsonify(
        {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "timezone": data["timezone"],
            "current": data["current"],
            "hourly": data["hourly"],
            "source": "Open-Meteo",
        }
    )
