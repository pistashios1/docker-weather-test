import os

import requests
from flask import Flask, jsonify, request


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    @app.get("/weather")
    def weather():
        latitude = request.args.get("latitude", type=float)
        longitude = request.args.get("longitude", type=float)

        if latitude is None or longitude is None:
            return jsonify({"error": "latitude and longitude are required numbers"}), 400
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return jsonify({"error": "latitude must be between -90 and 90 and longitude between -180 and 180"}), 400

        try:
            response = requests.get(
                OPEN_METEO_URL,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": "temperature_2m,wind_speed_10m",
                    "temperature_unit": "fahrenheit",
                    "wind_speed_unit": "mph",
                },
                timeout=5,
            )
            response.raise_for_status()
        except requests.RequestException:
            app.logger.exception("Open-Meteo request failed")
            return jsonify({"error": "weather service unavailable"}), 502

        data = response.json()
        return jsonify(
            {
                "latitude": data["latitude"],
                "longitude": data["longitude"],
                "current": data["current"],
                "source": "Open-Meteo",
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
