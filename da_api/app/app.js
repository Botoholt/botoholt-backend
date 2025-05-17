import { client as cdb, redisClient, redisClientPS } from './modules/db.js'
import { timeStamp, sleep, randInt } from './modules/tools.js'
import io from 'socket.io-client'
import { parse, toSeconds } from 'iso8601-duration'

let da_debug = false
let alerts_array = {}
let moderated_alerts = {}
let socketConnections = new Map() // Map to store channel -> socket connection
let conCheck = {}
// let streamsEnabled = await cdb.db('botSettings').collection('streams').distinct('channel', { 'services.da_api': true })
// let streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())

async function getSongDuration(songId) {
    let url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${songId}&key=${process.env.GOOGLE_API_KEY}`
    let songDuration = await fetch(url)
    songDuration = await songDuration.json()
    //TODO: max song length from db?
    if (toSeconds(parse(songDuration.items[0].contentDetails.duration)) > 899) {
        songDuration = 300
    } else {
        songDuration = toSeconds(parse(songDuration.items[0].contentDetails.duration))
    }
    return songDuration
}

async function extractWebSocketLink(url) {
    try {
        // Fetch the source code
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)
        const sourceCode = await response.text()

        // Split source code into lines
        const lines = sourceCode.split('\n')

        // Find the line with the socket.io connection and extract the link
        for (const line of lines) {
            if (line.includes("socket = io('wss://")) {
                // Use regex to extract the WebSocket URL
                const match = line.match(/wss:\/\/[^']+/)
                if (match) {
                    return match[0] // Returns wss://socket11.donationalerts.com:443
                }
            }
        }

        return 'WebSocket link not found'
    } catch (error) {
        console.error('Error fetching URL:', error.message)
        return null
    }
}

async function createSocketConnection(channel, token, chanDb) {
    let targetWidget = 'https://www.donationalerts.com/widget/lastdonations?token=' + token

    let wsLink = await extractWebSocketLink(targetWidget)

    if (wsLink && wsLink == 'WebSocket link not found') {
        timeStamp(`WebSocket link not found for channel ${channel}`)
        return
    }

    timeStamp(`WebSocket link found for channel ${channel}: ${wsLink}`)

    const socket = io(wsLink, {
        reconnection: true,
        reconnectionDelayMax: 15000,
        reconnectionDelay: 10000,
        // transports: ["websocket"]
    })

    let infa = JSON.parse(await redisClient.get(channel))
    let socketUpdateTimeout
    let songPlaytime = 0
    conCheck[channel] = setInterval(() => {
        if (songPlaytime < 840) {
            songPlaytime += 120
        } else {
            if (infa.isPlaying == true) {
                infa.isPlaying = false
                redisClient.set(channel, JSON.stringify(infa))
            }
        }
    }, 120000)

    socket.on('connect', function (msg) {
        timeStamp(`WS: connected for channel ${channel}`)
        socket.emit('add-user', { token: token, type: 'alert_widget' })
        if (da_debug) console.log(`Connected to WS server for channel ${channel}`)
    })

    socket.on('connect_error', function (msg) {
        timeStamp(`WS: connection_error for channel ${channel}`)
        console.log(msg)
        if (da_debug) console.log(`Could not connect to WS server for channel ${channel}`)
    })

    socket.on('connect_timeout', function (msg) {
        console.log(`WS: connection_timeout for channel ${channel}`)
        if (da_debug) console.log(`Connection to WS server is timed out for channel ${channel}`)
    })

    socket.on('reconnect', function (msg) {
        timeStamp(`WS: reconnected for channel ${channel}`)
        if (da_debug) console.log(`Reconnected to WS server for channel ${channel}`)
    })

    socket.on('donation', function (msg) {
        if (da_debug) console.log(`Received new donation for channel ${channel}`)
        const new_donation = JSON.parse(msg)
        console.log('New donation: ' + JSON.stringify(new_donation, null, 2))

        try {
            if (typeof new_donation.is_shown !== 'undefined' && parseInt(new_donation.is_shown) === 1) {
                return
            }
        } catch (err) {}
    })

    socket.on('media', function (msg) {
        if (da_debug) console.log(`Received new media for channel ${channel}`)
        const raw = JSON.parse(msg)
        console.log('Media action for channel ' + channel + ': ' + JSON.stringify(raw, null, 2))
        if (raw.action) {
            clearTimeout(socketUpdateTimeout)
            if (raw.action == 'add') {
                try {
                    getSongDuration(JSON.parse(raw.media.additional_data).video_id).then((songDuration) => {
                        infa.queueList.push({
                            mediaId: raw.media.media_id,
                            mediaName: raw.media.title,
                            mediaLink: JSON.parse(raw.media.additional_data).url,
                            requestedBy: JSON.parse(raw.media.additional_data).owner,
                            startFrom:
                                JSON.parse(raw.media.additional_data).start_from >= songDuration
                                    ? 0
                                    : JSON.parse(raw.media.additional_data).start_from,
                            duration: songDuration,
                        })
                    })
                } catch (error) {
                    timeStamp(`Can't add ${mediaEvent.raw}, skipping`)
                }
            } else if (raw.action == 'play') {
                let startedPlayingId = infa.queueList.findIndex((object) => {
                    return object.mediaId == raw.media.media_id
                })
                if (startedPlayingId !== -1) {
                    infa.isPlaying = true
                    infa.nowPlayingName = infa.queueList[startedPlayingId].mediaName
                    infa.nowPlayingLink = infa.queueList[startedPlayingId].mediaLink
                    infa.nowPlayingStartsFrom = infa.queueList[startedPlayingId].startFrom
                    infa.nowPlayingDuration = infa.queueList[startedPlayingId].duration
                    infa.nowPlayingOwner = infa.queueList[startedPlayingId].requestedBy
                    cdb.db(chanDb)
                        .collection('songs')
                        .insertOne(
                            {
                                mediaName: infa.nowPlayingName,
                                timeFrom: new Date(),
                                requestedBy: infa.nowPlayingOwner.toLowerCase(),
                                mediaLink: infa.nowPlayingLink,
                            },
                            () => {}
                        )
                    infa.queueList.splice(0, startedPlayingId + 1)
                } else {
                    infa.isPlaying = true
                    infa.nowPlayingName = raw.media.title
                    infa.nowPlayingLink = raw.media.additional_data.url
                    infa.nowPlayingStartsFrom = raw.media.additional_data.start_from
                    infa.nowPlayingDuration = null
                    infa.nowPlayingOwner = raw.media.additional_data.owner
                    cdb.db(chanDb)
                        .collection('songs')
                        .insertOne(
                            {
                                mediaName: infa.nowPlayingName,
                                timeFrom: new Date(),
                                requestedBy: infa.nowPlayingOwner.toLowerCase(),
                                mediaLink: infa.nowPlayingLink,
                            },
                            () => {}
                        )
                }
            } else if (raw.action == 'receive-current-media') {
                infa.isPlaying = !raw.is_paused
                infa.nowPlayingName = raw.media.title
                infa.nowPlayingLink = raw.media.additional_data.url
                infa.nowPlayingStartsFrom = raw.media.additional_data.start_from
                infa.nowPlayingDuration = null
                infa.nowPlayingOwner = raw.media.additional_data.owner
            } else if (raw.action == 'skip') {
                let skippedId = infa.queueList.findIndex((object) => {
                    return object.mediaId == raw.media.media_id
                })
                if (skippedId !== -1) {
                    infa.queueList.splice(0, skippedId + 1)
                }
            } else if (raw.action == 'end') {
                infa.isPlaying = false
                let endedId = infa.queueList.findIndex((object) => {
                    return object.mediaId == raw.media.media_id
                })
                if (endedId !== -1) {
                    infa.queueList.splice(0, endedId + 1)
                }
            } else if (raw.action == 'pause') {
                infa.isPlaying = false
            } else if (raw.action == 'unpause') {
                infa.isPlaying = true
                if (!infa.nowPlayingName) {
                    dasockets[channel].mediaGetCurrent()
                }
            }
            socketUpdateTimeout = setTimeout(() => {
                // io.emit('notification', 'UPDATE')
                redisClient.set(channel, JSON.stringify(infa))
                redisClient.publish(channel, 'UPDATE')
            }, 5000)

            if (!(raw.action == 'receive-pause-state' || raw.action == 'get-pause-state')) {
                songPlaytime = 0
            }
        }
    })

    return socket
}

async function initWsConnection(stream) {
    // let streams = await cdb.db('botSettings').collection('streams').find({ 'services.da_api': true }).toArray()
    // console.log('Found streams:', streams);

    // for (let stream of streams) {
    //  if (stream.channel === 'smurf_tv' || stream.channel === 'urbinholt') {
    // console.log(`Looking up token for channel ${stream.channel}`);
    let token = await cdb.db(stream.db).collection('botSettings').findOne({ settingName: 'daToken' })
    // console.log(`Raw token data for ${stream.channel}:`, JSON.stringify(token, null, 2));

    if (token && token.settings && token.settings.token) {
        await sleep(2000)
        let savedInfo = await redisClient.get(stream.channel)
        if (!savedInfo) {
            await redisClient.set(
                stream.channel,
                JSON.stringify({
                    isPlaying: false,
                    nowPlayingName: null,
                    nowPlayingLink: null,
                    nowPlayingStartsFrom: null,
                    nowPlayingDuration: null,
                    nowPlayingOwner: null,
                    queueList: [],
                })
            )
        }
        // console.log(`Found valid token for ${stream.channel}: ${token.settings.token}`);
        const socket = await createSocketConnection(stream.channel, token.settings.token, stream.db)
        console.log(`Created socket connection for channel ${stream.channel}`)
        socketConnections.set(stream.channel, socket)
        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'start_success', channel: stream.channel })
        )
    } else {
        console.log(`Invalid or missing token for ${stream.channel}. Token object:`, token)
        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'start_failure', channel: stream.channel })
        )
    }
    // }
    // }
}

async function dropWsConnection(channel) {
    const socket = socketConnections.get(channel)
    if (socket) {
        socket.disconnect()
        socketConnections.delete(channel)
        clearInterval(conCheck[channel])
        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'stop_success', channel: channel })
        )
        return true
    }
    return false
}

async function startupInit(recheck) {
    let streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())
    let streamsEnabled = await cdb.db('botSettings').collection('streams').find({ 'services.da_api': true }).toArray()

    if (!recheck) {
        for (let stream of streamsEnabled) {
            if (
                streamsOnline.find((s) => s.login === stream.channel) &&
                streamsOnline.find((s) => s.login === stream.channel).online
            ) {
                await initWsConnection(stream)
            }
        }
    } else {
        for (let stream of streamsEnabled) {
            if (socketConnections.has(stream.channel)) {
                if (
                    streamsOnline.find((s) => s.login === stream.channel) &&
                    !streamsOnline.find((s) => s.login === stream.channel).online
                ) {
                    await dropWsConnection(stream.channel)
                }
            } else {
                if (
                    streamsOnline.find((s) => s.login === stream.channel) &&
                    streamsOnline.find((s) => s.login === stream.channel).online
                ) {
                    await initWsConnection(stream)
                }
            }
        }
    }
}

redisClientPS.subscribe('_datalink', async (message) => {
    message = JSON.parse(message)
    let getStream
    // timeStamp(message)
    /*
    message = {
        service: bot_twitch, da_api, web_api,
        action: restart, stop, start,
        channel: channel name,
    }
    */

    if (message.service == 'da_api') {
        try {
            getStream = await cdb.db('botSettings').collection('streams').findOne({ channel: message.channel })
        } catch (error) {
            timeStamp(error)
            timeStamp(`Can't find channel ${message.channel}`)
            return
        }

        if (message.action == 'restart') {
            try {
                await dropWsConnection(message.channel)
                await initWsConnection(getStream)
            } catch (error) {
                timeStamp(error)
            }
            return
        }
        if (message.action == 'start') {
            try {
                await initWsConnection(getStream)
            } catch (error) {
                timeStamp(error)
            }
            return
        }
        if (message.action == 'stop') {
            try {
                await dropWsConnection(message.channel)
            } catch (error) {
                timeStamp(error)
                redisClient.publish(
                    '_datalink',
                    JSON.stringify({ service: 'da_api', action: 'stop_failure', channel: message.channel })
                )
            }
            return
        }
    }
})

// Handle cleanup on process exit
process.on('SIGINT', async () => {
    for (let [channel, socket] of socketConnections) {
        socket.disconnect()
        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'stop_success', channel: channel })
        )
        clearInterval(conCheck[channel])
    }
    process.exit()
})

startupInit()
setInterval(async () => {
    startupInit(true)
}, 60 * 1000)
