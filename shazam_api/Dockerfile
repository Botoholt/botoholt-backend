FROM python:3.11-slim-bookworm

WORKDIR /usr/src/app

RUN pip install flask[async] streamlink aiohttp==3.8.2 asyncio shazamio waitress python-dotenv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY shazam_api.py ./shazam_api.py

CMD [ "waitress-serve", "--port=5000", "shazam_api:app" ]
