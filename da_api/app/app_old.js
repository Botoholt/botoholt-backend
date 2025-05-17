import { client as cdb, redisClient, redisClientPS } from './modules/db.js'
import { timeStamp, sleep, randInt } from './modules/tools.js'
import { EventName, DASocket } from 'donationalerts-api'
import { parse, toSeconds } from 'iso8601-duration'

let openedSocketFlags = {}
let pingers = {}
let conCheck = {}
let dasockets = {}
let reconnectInt = {}
let streams = await cdb.db('botSettings').collection('streams').distinct('channel', { 'services.da_api': true })
let streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())

streamsOnline.forEach(async (stream) => {
    if (stream.online && streams.includes(stream.login)) {
        try {
            await sleep(randInt(2, 8) * 1000)
            await createSocketInstance(stream.login, stream.id)
        } catch (error) {
            timeStamp(error)
        }
    }
})

setInterval(async () => {
    try {
        streams = await cdb.db('botSettings').collection('streams').distinct('channel', { 'services.da_api': true })
        streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())
    } catch (error) {
        timeStamp(error)
        return
    }
    streamsOnline.forEach(async (stream) => {
        // timeStamp(stream)
        // timeStamp(Object.keys(dasockets))
        if (stream.online && streams.includes(stream.login) && !Object.keys(dasockets).includes(stream.login)) {
            try {
                await sleep(randInt(2, 8) * 1000)
                await createSocketInstance(stream.login, stream.id)
            } catch (error) {
                timeStamp(error)
            }
        }
        if (!stream.online && streams.includes(stream.login) && Object.keys(dasockets).includes(stream.login)) {
            try {
                // timeStamp('WTF???')
                await dropSocketInstance(stream.login)
            } catch (error) {
                timeStamp(error)
            }
        }
    })
}, 60 * 1000)

// streams.forEach(async (stream) => {
//     try {
//         await sleep(randInt(2, 8)*1000)
//         await createSocketInstance(stream, true)
//     } catch (error) {
//         timeStamp(error)
//     }
// })

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
                await dropSocketInstance(message.channel)
                await createSocketInstance(message.channel, getStream.db)
            } catch (error) {
                timeStamp(error)
            }
            return
        }
        if (message.action == 'start') {
            try {
                await createSocketInstance(message.channel, getStream.db)
            } catch (error) {
                timeStamp(error)
            }
            return
        }
        if (message.action == 'stop') {
            try {
                await dropSocketInstance(message.channel)
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

async function createSocketInstance(channel, chanDb) {
    let token = await cdb.db(chanDb).collection('botSettings').findOne({ settingName: 'daToken' })
    let savedInfo = await redisClient.get(channel)
    if (!savedInfo) {
        await redisClient.set(
            channel,
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
    try {
        await createSocket(channel, token['settings']['token'], chanDb)

        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'start_success', channel: channel })
        )

        reconnectInt[channel] = setInterval(() => {
            if (!openedSocketFlags[channel]) {
                timeStamp(`DA socket for ${channel} trying to reconnect`)
                createSocket(channel, token['settings']['token'])
            } else {
                // timeStamp(`DA socket for ${channel} seems fine`)
            }
        }, 180000)
    } catch (error) {
        timeStamp(error)
        redisClient.publish(
            '_datalink',
            JSON.stringify({ service: 'da_api', action: 'start_failure', channel: channel })
        )
    }
}

async function dropSocketInstance(channel) {
    if (Object.keys(dasockets).includes(channel)) {
        clearTimeout(pingers[channel])
        clearInterval(reconnectInt[channel])
        clearInterval(conCheck[channel])
        await dasockets[channel].disconnect()
        delete dasockets[channel]
    }
    redisClient.publish('_datalink', JSON.stringify({ service: 'da_api', action: 'stop_success', channel: channel }))
    timeStamp(`Socket cleared for ${channel}`)
}

async function createSocket(channel, token, chanDb) {
    let infa = JSON.parse(await redisClient.get(channel))
    let socketUpdateTimeout
    let songPlaytime = 0

    let targetWidget = 'https://www.donationalerts.com/widget/lastdonations?token=' + token

    let wsLink = await extractWebSocketLink(targetWidget)

    if (wsLink && wsLink == 'WebSocket link not found') {
        timeStamp(`WebSocket link not found for channel ${channel}`)
        return
    }

    dasockets[channel] = new DASocket(token, {
        socketUrl: wsLink,
        autoConnect: false,
    })

    // setInterval(() => {redisClient.publish(channel, 'UPDATE')}, 15000)

    await dasockets[channel].connect()
    timeStamp('Socket created for ' + channel)

    dasockets[channel].on(EventName.Media, (mediaEvent) => {
        timeStamp(channel + ' ' + mediaEvent)
        openedSocketFlags[channel] = true
        clearTimeout(pingers[channel])
        if (mediaEvent.raw.action) {
            clearTimeout(socketUpdateTimeout)

            if (mediaEvent.raw.action == 'add') {
                try {
                    getSongDuration(JSON.parse(mediaEvent.raw.media.additional_data).video_id).then((songDuration) => {
                        infa.queueList.push({
                            mediaId: mediaEvent.raw.media.media_id,
                            mediaName: mediaEvent.raw.media.title,
                            mediaLink: JSON.parse(mediaEvent.raw.media.additional_data).url,
                            requestedBy: JSON.parse(mediaEvent.raw.media.additional_data).owner,
                            startFrom:
                                JSON.parse(mediaEvent.raw.media.additional_data).start_from >= songDuration
                                    ? 0
                                    : JSON.parse(mediaEvent.raw.media.additional_data).start_from,
                            duration: songDuration,
                        })
                    })
                } catch (error) {
                    timeStamp(`Can't add ${mediaEvent.raw}, skipping`)
                }
            } else if (mediaEvent.raw.action == 'play') {
                let startedPlayingId = infa.queueList.findIndex((object) => {
                    return object.mediaId == mediaEvent.raw.media.media_id
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
                    infa.nowPlayingName = mediaEvent.raw.media.title
                    infa.nowPlayingLink = mediaEvent.raw.media.additional_data.url
                    infa.nowPlayingStartsFrom = mediaEvent.raw.media.additional_data.start_from
                    infa.nowPlayingDuration = null
                    infa.nowPlayingOwner = mediaEvent.raw.media.additional_data.owner
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
            } else if (mediaEvent.raw.action == 'receive-current-media') {
                infa.isPlaying = !mediaEvent.raw.is_paused
                infa.nowPlayingName = mediaEvent.raw.media.title
                infa.nowPlayingLink = mediaEvent.raw.media.additional_data.url
                infa.nowPlayingStartsFrom = mediaEvent.raw.media.additional_data.start_from
                infa.nowPlayingDuration = null
                infa.nowPlayingOwner = mediaEvent.raw.media.additional_data.owner
            } else if (mediaEvent.raw.action == 'skip') {
                let skippedId = infa.queueList.findIndex((object) => {
                    return object.mediaId == mediaEvent.raw.media.media_id
                })
                if (skippedId !== -1) {
                    infa.queueList.splice(0, skippedId + 1)
                }
            } else if (mediaEvent.raw.action == 'end') {
                infa.isPlaying = false
                let endedId = infa.queueList.findIndex((object) => {
                    return object.mediaId == mediaEvent.raw.media.media_id
                })
                if (endedId !== -1) {
                    infa.queueList.splice(0, endedId + 1)
                }
            } else if (mediaEvent.raw.action == 'pause') {
                infa.isPlaying = false
            } else if (mediaEvent.raw.action == 'unpause') {
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

            if (!(mediaEvent.raw.action == 'receive-pause-state' || mediaEvent.raw.action == 'get-pause-state')) {
                songPlaytime = 0
            }
        }
    })

    conCheck[channel] = setInterval(() => {
        if (songPlaytime < 840) {
            songPlaytime += 120
        } else {
            if (infa.isPlaying == true) {
                infa.isPlaying = false
                redisClient.set(channel, JSON.stringify(infa))
            }
        }
        dasockets[channel].mediaGetPauseState()
        pingers[channel] = setTimeout(() => {
            timeStamp(`DA socket for ${channel} disconnected`)
            openedSocketFlags[channel] = false
            dasockets[channel].disconnect()
            clearInterval(conCheck[channel])
        }, '10000')
        //     console.log(dasocket.connected + ` ${username}`)
        //     console.log(token.token)
        //     if (!dasocket.connected) {
        //         clearInterval(conCheck)
        //         console.log('DA RECONNECT')
        //         createSocket(username, token)
        //     }
    }, 120000)
}

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
