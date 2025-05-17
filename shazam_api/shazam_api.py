from flask import Flask, jsonify
from shazamio import Shazam
from subprocess import DEVNULL, STDOUT, check_call
import time
import logging
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

logging.basicConfig(format='%(asctime)s - %(message)s', level=logging.INFO)

@app.route("/shazam/<platform>/<stream>", methods=['GET'])
async def solo_shazam(platform, stream):
    start_time = time.time()
    logging.info(f'shazaming for {stream}')
    stream_full = 'https://www.twitch.tv/'+stream
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

    time_taken = time.time()-start_time

    logging.info(f'execution took {time_taken}')

    return jsonify({"song": song_name})

async def solo_shazaming(file_name, stream_full):
    """Find a song capturing part of the twitch stream
    with streamlink and increasing volume with ffmpeg."""

    auth_header = os.getenv('TWITCH_API_HEADER')

    streamlink_req = f'streamlink -f -o {file_name} {stream_full} audio_only \
        --twitch-disable-hosting \
        --twitch-api-header=Authorization="OAuth {auth_header}" \
        --twitch-disable-ads \
        --twitch-low-latency \
        --hls-duration 5s'
    check_call(streamlink_req, shell=True, stdout=DEVNULL, stderr=STDOUT)
    check_call(['ffmpeg', '-y', '-i', file_name, '-filter:a',
                'volume=2', 'vol_'+file_name], stdout=DEVNULL, stderr=STDOUT)

    shazam = Shazam()
    out = await shazam.recognize_song('vol_'+file_name)
    return out
    # if len(out['matches']):
    #     song = out['track']
    #     print(out['track']['title'], out['track']['subtitle'])
    #     return song['subtitle'] + ' - ' + song['title']
    # return 'unknown'

@app.route("/<stream>", methods=['GET'])
async def shazam(stream):
    start_time = time.time()
    logging.info(f'shazaming for {stream}')
    stream_full = 'https://www.twitch.tv/'+stream
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

    time_taken = time.time()-start_time

    logging.info(f'execution took {time_taken}')

    return jsonify({"song": song_name})


async def shazaming(file_name, stream_full):
    """Find a song capturing part of the twitch stream
    with streamlink and increasing volume with ffmpeg."""

    auth_header = os.getenv('TWITCH_API_HEADER')
    print(auth_header)

    streamlink_req = f'streamlink -f -o {file_name} {stream_full} audio_only \
        --twitch-disable-hosting \
        --twitch-api-header=Authorization="OAuth {auth_header}" \
        --twitch-disable-ads \
        --twitch-low-latency \
        --hls-duration 5s'
    check_call(streamlink_req, shell=True, stdout=DEVNULL, stderr=STDOUT)
    check_call(['ffmpeg', '-y', '-i', file_name, '-filter:a',
                'volume=2', 'vol_'+file_name], stdout=DEVNULL, stderr=STDOUT)

    shazam = Shazam()
    out = await shazam.recognize_song('vol_'+file_name)
    if len(out['matches']):
        song = out['track']
        print(out['track']['title'], out['track']['subtitle'])
        return song['subtitle'] + ' - ' + song['title']
    return 'unknown'
