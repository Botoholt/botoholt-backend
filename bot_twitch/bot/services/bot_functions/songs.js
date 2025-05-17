import { client as cdb, redisClient } from '../../modules/db.js'
import 'dotenv/config'
import { timeStamp } from '../../modules/tools.js'

let lastGuess = {}

async function songRequestInfo(channel) {
    let savedInfo = await redisClient.get(channel)

    if (savedInfo) {
        return JSON.parse(savedInfo)
    } else {
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
        return JSON.parse(await redisClient.get(channel))
    }
}

async function songProcess(client, channel, tags, message, answersList) {
    let requestInfo = await songRequestInfo(channel)

    if (!requestInfo['isPlaying']) {
        shazamSong(channel).then((dataToSend) => {
            if (dataToSend !== 'unknown') {
                answerProcessor({
                    channel: channel,
                    commandName: 'shazamAnswers',
                    commandType: 'success',
                    userName: tags.get('display-name'),
                    answers: answersList,
                    songName: dataToSend,
                    bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
                }).then((answer) => {
                    client.say(channel, answer)
                })
                lastGuess[channel] = dataToSend
            } else {
                answerProcessor({
                    channel: channel,
                    commandName: 'shazamAnswers',
                    commandType: 'failure',
                    userName: tags.get('display-name'),
                    answers: answersList,
                    bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
                }).then((answer) => {
                    client.say(channel, answer)
                })
            }
        })
    } else {
        let hatetepass = requestInfo['nowPlayingLink']
        if (requestInfo['nowPlayingLink']) {
            hatetepass = 'youtu.be/' + requestInfo['nowPlayingLink'].split('=')[1]
        }
        answerProcessor({
            channel: channel,
            commandName: 'daAnswers',
            commandType: 'success',
            userName: tags.get('display-name'),
            answers: answersList,
            songName: requestInfo['nowPlayingName'],
            mediaLink: hatetepass,
            requestedBy: requestInfo['nowPlayingOwner'],
            bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
        }).then((answer) => {
            client.say(channel, answer)
        })
    }
}

async function whichProcess(client, channel, tags, message, answersList) {
    let requestInfo = await songRequestInfo(channel)
    let nickname
    let timeToNearestSong = 0
    let songsInQueue = []

    if (!requestInfo['isPlaying'] && requestInfo['queueList'].length == 0) {
        answerProcessor({
            channel: channel,
            commandName: 'daAnswers',
            commandType: 'failure',
            userName: tags.get('display-name'),
            answers: answersList,
            bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
        }).then((answer) => {
            client.say(channel, answer)
        })
    } else {
        if (message.length >= 2) {
            nickname = message.slice(1).join(' ').toLowerCase()
        } else {
            nickname = tags.get('display-name').toLowerCase()
        }
        for (let i = 0; i < requestInfo['queueList'].length; i++) {
            if (requestInfo['queueList'][i].requestedBy.toLowerCase() === nickname) {
                songsInQueue.push(i + 1)
            }
            if (songsInQueue.length === 0) {
                timeToNearestSong += requestInfo['queueList'][i]['duration']
            }
        }
        if (songsInQueue.length === 0) {
            answerProcessor({
                channel: channel,
                commandName: 'daAnswers',
                commandType: 'failure',
                userName: tags.get('display-name'),
                answers: answersList,
                bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
            }).then((answer) => {
                client.say(channel, answer)
            })
        } else {
            timeToNearestSong =
                ('0' + (Math.floor(timeToNearestSong / 3600) % 72)).slice(-2) +
                ':' +
                ('0' + (Math.floor(timeToNearestSong / 60) % 60)).slice(-2) +
                ':' +
                ('0' + (timeToNearestSong % 60)).slice(-2)
            answerProcessor({
                channel: channel,
                commandName: 'daAnswers',
                commandType: 'success',
                userName: tags.get('display-name'),
                answers: answersList,
                songsInQueue: songsInQueue.join(', '),
                timeToNearestSong: timeToNearestSong,
                bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
            }).then((answer) => {
                client.say(channel, answer)
            })
        }
    }
}

async function queueProcess(client, channel, tags, message, answersList) {
    let requestInfo = await songRequestInfo(channel)
    // console.log(requestInfo)
    if (!requestInfo['isPlaying'] && requestInfo['queueList'].length == 0) {
        answerProcessor({
            channel: channel,
            commandName: 'daAnswers',
            commandType: 'failure',
            userName: tags.get('display-name'),
            answers: answersList,
            bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
        }).then((answer) => {
            client.say(channel, answer)
        })
    } else if (!requestInfo['isPlaying'] && requestInfo['queueList'].length > 0) {
        let queueDurationCount = requestInfo['queueList'].reduce(function (acc, obj) {
            return acc + obj.duration - obj.startFrom
        }, 0)
        queueDurationCount =
            ('0' + (Math.floor(queueDurationCount / 3600) % 72)).slice(-2) +
            ':' +
            ('0' + (Math.floor(queueDurationCount / 60) % 60)).slice(-2) +
            ':' +
            ('0' + (queueDurationCount % 60)).slice(-2)
        answerProcessor({
            channel: channel,
            commandName: 'daAnswers',
            commandType: 'failure',
            userName: tags.get('display-name'),
            answers: answersList,
            queueLength: requestInfo['queueList'].length,
            queueDuration: queueDurationCount,
            bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
        }).then((answer) => {
            client.say(channel, answer)
        })
    } else {
        let queueDurationCount = requestInfo['queueList'].reduce(function (acc, obj) {
            return acc + obj.duration
        }, 0)
        queueDurationCount =
            ('0' + (Math.floor(queueDurationCount / 3600) % 72)).slice(-2) +
            ':' +
            ('0' + (Math.floor(queueDurationCount / 60) % 60)).slice(-2) +
            ':' +
            ('0' + (queueDurationCount % 60)).slice(-2)
        answerProcessor({
            channel: channel,
            commandName: 'daAnswers',
            commandType: 'success',
            userName: tags.get('display-name'),
            answers: answersList,
            queueLength: requestInfo['queueList'].length,
            queueDuration: queueDurationCount,
            bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
        }).then((answer) => {
            client.say(channel, answer)
        })
    }
}

async function lastSong(client, channel, tags, message, answersList) {
    let requestInfo = await songRequestInfo(channel)
    if (!requestInfo['isPlaying']) {
        if (lastGuess[channel]) {
            answerProcessor({
                channel: channel,
                commandName: 'shazamAnswers',
                commandType: 'success',
                userName: tags.get('display-name'),
                answers: answersList,
                lastSong: lastGuess[channel],
                bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
            }).then((answer) => {
                client.say(channel, answer)
            })
        } else {
            answerProcessor({
                channel: channel,
                commandName: 'shazamAnswers',
                commandType: 'failure',
                userName: tags.get('display-name'),
                answers: answersList,
                bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
            }).then((answer) => {
                client.say(channel, answer)
            })
        }
    } else {
        // timeStamp(tags)
        cdb.db(tags.get('room-id'))
            .collection('songs')
            .find()
            .sort({ _id: -1 })
            .limit(2)
            .toArray()
            .then((result) => {
                answerProcessor({
                    channel: channel,
                    commandName: 'daAnswers',
                    commandType: 'success',
                    userName: tags.get('display-name'),
                    answers: answersList,
                    lastSong: result[1]['mediaName'],
                    bholtLink: `${process.env.BHOLT_BASE}/${channel}/h`,
                }).then((answer) => {
                    client.say(channel, answer)
                })
            })
            .catch((err) => {
                timeStamp(err)
            })
    }
}

async function answerProcessor({
    channel,
    commandName,
    commandType,
    answers,
    userName,
    songName,
    mediaLink,
    bholtLink,
    requestedBy,
    songsInQueue,
    timeToNearestSong,
    queueLength,
    queueDuration,
    lastSong,
} = {}) {
    let chars = {
        _userName: userName,
        _songName: songName,
        _mediaLink: mediaLink,
        _bholtLink: bholtLink,
        _requestedBy: requestedBy,
        _songsInQueue: songsInQueue,
        _timeToNearestSong: timeToNearestSong,
        _queueLength: queueLength,
        _queueDuration: queueDuration,
        _lastSong: lastSong,
    }
    let botAnswers = answers[commandName][commandType]['answers']
    let random = Math.floor(Math.random() * botAnswers.length)
    let answer = botAnswers[random]
    // timeStamp(chars)
    answer = answer.replace(
        /_userName|_songName|_mediaLink|_bholtLink|_requestedBy|_songsInQueue|_timeToNearestSong|_queueLength|_queueDuration|_lastSong/gi,
        (x) => chars[x]
    )
    return answer
}

// async function getAnswers(channel, answersName, commandType) {
//     let botAnswers = await cdb
//         .db(channel + '_db')
//         .collection('botCommands')
//         .findOne({ settingName: answersName })
//     return botAnswers['settings'][commandType]
// }

async function shazamSong(stream) {
    let urlShazam = process.env.SONGS_BACKEND + stream
    let dataToSend = 'unknown'
    let getSong = await (await fetch(urlShazam)).json()
    if (getSong.song !== 'unknown') {
        dataToSend = getSong.song
    }
    return dataToSend
}

export { songProcess, whichProcess, queueProcess, lastSong }
