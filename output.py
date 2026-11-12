from typing import Any

from flask import jsonify


def health_response():
    return jsonify({"status": "ok"})


def error_response(message: str, status_code: int):
    return jsonify({"error": message}), status_code


def weather_response(data: dict[str, Any]):
    return jsonify(
        {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "current": data["current"],
            "source": "Open-Meteo",
        }
    )
