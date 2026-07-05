from flask import Flask, jsonify
from shazamio import Shazam
from subprocess import DEVNULL, STDOUT, check_call
import re
import time
import logging
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

logging.basicConfig(format='%(asctime)s - %(message)s', level=logging.INFO)

# Twitch login names: letters, digits and underscores only.
STREAM_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_]{1,32}$')


def is_valid_stream(stream):
    return bool(STREAM_NAME_PATTERN.match(stream))


def capture_stream_audio(file_name, stream_full):
    """Capture a short audio sample of the stream with streamlink and
    boost its volume with ffmpeg. Arguments are passed as lists (no shell)
    so stream names can't inject shell commands."""

    auth_header = os.getenv('TWITCH_API_HEADER')

    streamlink_cmd = [
        'streamlink', '-f', '-o', file_name, stream_full, 'audio_only',
        '--twitch-disable-hosting',
        f'--twitch-api-header=Authorization=OAuth {auth_header}',
        '--twitch-disable-ads',
        '--twitch-low-latency',
        '--hls-duration', '5s',
    ]
    check_call(streamlink_cmd, stdout=DEVNULL, stderr=STDOUT)
    check_call(['ffmpeg', '-y', '-i', file_name, '-filter:a',
                'volume=2', 'vol_' + file_name], stdout=DEVNULL, stderr=STDOUT)


@app.route("/shazam/<platform>/<stream>", methods=['GET'])
async def solo_shazam(platform, stream):
    if not is_valid_stream(stream):
        return jsonify({"song": "unknown"}), 400

    start_time = time.time()
    logging.info(f'shazaming for {stream}')
    stream_full = 'https://www.twitch.tv/' + stream
    file_name = stream + '.ts'
    song_name = 'unknown'

    try:
        song_name = await solo_shazaming(file_name, stream_full)
        if song_name == 'unknown':
            logging.info(f'second try for {stream}')
            song_name = await solo_shazaming(file_name, stream_full)

    except Exception as e:
        logging.info(f'could not success for {stream}, error: {e}')
        return jsonify({"song": song_name})

    time_taken = time.time() - start_time

    logging.info(f'execution took {time_taken}')

    return jsonify({"song": song_name})


async def solo_shazaming(file_name, stream_full):
    """Find a song capturing part of the twitch stream
    with streamlink and increasing volume with ffmpeg."""

    capture_stream_audio(file_name, stream_full)

    shazam = Shazam()
    out = await shazam.recognize_song('vol_' + file_name)
    return out


@app.route("/<stream>", methods=['GET'])
async def shazam(stream):
    if not is_valid_stream(stream):
        return jsonify({"song": "unknown"}), 400

    start_time = time.time()
    logging.info(f'shazaming for {stream}')
    stream_full = 'https://www.twitch.tv/' + stream
    file_name = stream + '.ts'
    song_name = 'unknown'

    try:
        song_name = await shazaming(file_name, stream_full)
        if song_name == 'unknown':
            logging.info(f'second try for {stream}')
            song_name = await shazaming(file_name, stream_full)

    except Exception as e:
        logging.info(f'could not success for {stream}, error: {e}')
        return jsonify({"song": song_name})

    time_taken = time.time() - start_time

    logging.info(f'execution took {time_taken}')

    return jsonify({"song": song_name})


async def shazaming(file_name, stream_full):
    """Find a song capturing part of the twitch stream
    with streamlink and increasing volume with ffmpeg."""

    capture_stream_audio(file_name, stream_full)

    shazam = Shazam()
    out = await shazam.recognize_song('vol_' + file_name)
    if len(out['matches']):
        song = out['track']
        logging.info(f"{out['track']['title']} {out['track']['subtitle']}")
        return song['subtitle'] + ' - ' + song['title']
    return 'unknown'
