FROM python:3.11-slim-bookworm

WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y --no-install-recommends gcc build-essential python3-dev ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install flask[async] streamlink aiohttp==3.8.2 asyncio shazamio waitress python-dotenv


COPY shazam_api.py ./shazam_api.py

CMD [ "waitress-serve", "--port=5000", "shazam_api:app" ]
