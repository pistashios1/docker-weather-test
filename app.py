import os

import requests
from flask import Flask, render_template, request

from output import error_response, health_response, weather_response


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
IP_LOCATION_URL = "https://ipapi.co/json/"


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/location")
    def location():
        try:
            response = requests.get(IP_LOCATION_URL, timeout=5)
            response.raise_for_status()
            data = response.json()
            latitude = float(data["latitude"])
            longitude = float(data["longitude"])
        except (requests.RequestException, ValueError, KeyError, TypeError):
            app.logger.exception("IP location request failed")
            return error_response("location service unavailable", 502)

        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            app.logger.error("IP location service returned invalid coordinates")
            return error_response("Location service returned invalid coordinates", 502)

        return {"latitude": latitude, "longitude": longitude, "source": "IP location"}

    @app.get("/healthz")
    def healthz():
        return health_response()

    @app.get("/weather")
    def weather():
        latitude = request.args.get("latitude", type=float)
        longitude = request.args.get("longitude", type=float)

        if latitude is None or longitude is None:
            return error_response("latitude and longitude are required numbers", 400)
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return error_response(
                "latitude must be between -90 and 90 and longitude between -180 and 180",
                400,
            )

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
            data = response.json()
        except (requests.RequestException, ValueError):
            app.logger.exception("Open-Meteo request failed")
            return error_response("weather service unavailable", 502)

        return weather_response(data)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
