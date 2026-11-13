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


def validate_location_response(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("location payload is not an object")
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidUpstreamPayload("location coordinates are invalid") from error
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InvalidUpstreamPayload("location coordinates are out of range")
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
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
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


def validate_weather_response(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise InvalidUpstreamPayload("weather payload is not an object")
    current = data.get("current")
    if not isinstance(current, dict):
        raise InvalidUpstreamPayload("weather current data is missing")
    for field in (
        "temperature_2m",
        "wind_speed_10m",
        "weather_code",
        "rain",
        "relative_humidity_2m",
        "uv_index",
    ):
        if field not in current or not isinstance(current[field], (int, float)):
            raise InvalidUpstreamPayload(f"weather field {field} is invalid")
    hourly = data.get("hourly")
    if not isinstance(hourly, dict):
        raise InvalidUpstreamPayload("weather hourly data is missing")
    times = hourly.get("time")
    temperatures = hourly.get("temperature_2m")
    weather_codes = hourly.get("weather_code")
    if not isinstance(times, list) or not isinstance(temperatures, list) or not isinstance(
        weather_codes, list
    ):
        raise InvalidUpstreamPayload("weather hourly data is invalid")
    if not times or len(times) != len(temperatures) or len(times) != len(weather_codes):
        raise InvalidUpstreamPayload("weather hourly data is incomplete")
    if any(not isinstance(value, (int, float)) for value in temperatures):
        raise InvalidUpstreamPayload("weather hourly temperatures are invalid")
    if any(not isinstance(value, (int, float)) for value in weather_codes):
        raise InvalidUpstreamPayload("weather hourly codes are invalid")
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidUpstreamPayload("weather coordinates are invalid") from error
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InvalidUpstreamPayload("weather coordinates are out of range")
    return {
        "latitude": latitude,
        "longitude": longitude,
        "current": current,
        "hourly": {
            "time": times[:24],
            "temperature_2m": temperatures[:24],
            "weather_code": weather_codes[:24],
        },
    }


def weather_response(data: dict[str, Any]):
    return jsonify(
        {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "current": data["current"],
            "hourly": data["hourly"],
            "source": "Open-Meteo",
        }
    )
