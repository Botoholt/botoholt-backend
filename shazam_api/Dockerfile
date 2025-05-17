FROM python:3.11-bookworm

WORKDIR /usr/src/app

RUN pip install flask[async] streamlink aiohttp==3.8.2 asyncio shazamio waitress python-dotenv
RUN apt update && apt install ffmpeg -y

COPY shazam_api.py ./shazam_api.py
COPY .env ./.env


CMD [ "waitress-serve", "--port=5000", "shazam_api:app" ]
