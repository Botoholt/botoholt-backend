import 'dotenv/config'
import { ApiClient } from '@twurple/api'
import { ChatClient } from '@twurple/chat'
// import { PubSubClient } from '@twurple/pubsub'
// import { EventSubWsListener } from '@twurple/eventsub-ws'
import { StaticAuthProvider, RefreshingAuthProvider } from '@twurple/auth'
import { client as cdb, redisClient, redisClientPS } from './modules/db.js'
import { timeStamp, delay, randInt } from './modules/tools.js'
import * as bot from './services/bot_functions/index.js'

// Twitch credentials
const clientId = process.env.TWITCH_CLIENT_ID
const clientSecret = process.env.TWITCH_SECRET
const accessToken = process.env.TWITCH_ACCESS_TOKEN

const authProviderChat = new StaticAuthProvider(clientId, accessToken)
const authProviderApi = new RefreshingAuthProvider({
    clientId,
    clientSecret,
})

authProviderApi.onRefresh(async (twitchId, newTokenData) => {
    try {
        await cdb
            .db('botSettings')
            .collection('twTokens')
            .updateOne(
                { twitchId: parseInt(twitchId) },
                {
                    $set: {
                        accessToken: newTokenData['accessToken'],
                        expiresIn: newTokenData['expiresIn'],
                        obtainmentTimestamp: newTokenData['obtainmentTimestamp'],
                    },
                }
            )
    } catch (e) {
        timeStamp(e)
    }
})

const chatClient = new ChatClient({ authProvider: authProviderChat, rejoinChannelsOnReconnect: true })
const apiClient = new ApiClient({ authProvider: authProviderApi })
// const pubSubClient = new PubSubClient({ authProvider: authProviderApi })
// const eventListener = new EventSubWsListener({ apiClient })

let botCommands = {}
let botRewards = {}
let cooldown = {}

// Connect the chat client
chatClient.connect()
// eventListener.start()

let botTokens = await cdb.db('botSettings').collection('twTokens').findOne({ channel: 'botoholt' })
await authProviderApi.addUser(botTokens['twitchId'], botTokens)

let streams = await cdb.db('botSettings').collection('streams').distinct('channel', { 'services.botoholt': true })
let streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())
// timeStamp(streams)
// createBotInstance('smurf_tv')
streamsOnline.forEach((stream) => {
    if (stream.online && streams.includes(stream.login)) {
        createBotInstance(stream.login)
    }
    // const onlineSubscription = eventListener.onStreamOnline(userId, e => {
    //     console.log(`${e.broadcasterDisplayName} just went live!`);
    // });

    // const offlineSubscription = listener.onStreamOffline(userId, e => {
    //     console.log(`${e.broadcasterDisplayName} just went offline!`);
    // });
})

setInterval(async () => {
    try {
        streams = await cdb.db('botSettings').collection('streams').distinct('channel', { 'services.botoholt': true })
        streamsOnline = await fetch('http://172.18.0.20:3000/streams?all=true').then((resp) => resp.json())
    } catch (error) {
        timeStamp(error)
        return
    }

    streamsOnline.forEach((stream) => {
        // timeStamp(stream)
        // timeStamp(Object.keys(botCommands))
        if (stream.online && streams.includes(stream.login) && !Object.keys(botCommands).includes(stream.login)) {
            createBotInstance(stream.login)
        }
        if (!stream.online && streams.includes(stream.login) && Object.keys(botCommands).includes(stream.login)) {
            dropBotInstance(stream.login)
        }
    })
}, 60 * 1000)

redisClientPS.subscribe('_datalink', async (message) => {
    message = JSON.parse(message)
    timeStamp(message)
    /*
    message = {
        service: bot_twitch, da_api, web_api,
        action: restart, stop, start,
        channel: channel name,
    }
    */
    // console.log(message.service)
    if (message.service == 'bot_twitch') {
        if (message.action == 'restart') {
            await dropBotInstance(message.channel)
            await createBotInstance(message.channel)
            return
        }
        if (message.action == 'start') {
            if (Object.keys(botCommands).includes(message.channel)) {
                await createBotInstance(message.channel)
            }
            redisClient.publish(
                '_datalink',
                JSON.stringify({ service: 'bot_twitch', action: 'start_success', channel: message.channel })
            )
            return
        }
        if (message.action == 'stop') {
            if (Object.keys(botCommands).includes(message.channel)) {
                await dropBotInstance(message.channel)
            }
            redisClient.publish(
                '_datalink',
                JSON.stringify({ service: 'bot_twitch', action: 'stop_success', channel: message.channel })
            )
            return
        }
    }
})

async function createBotInstance(stream) {
    let botSettings = await cdb.db('botSettings').collection('streams').findOne({ channel: stream })

    timeStamp(`Creating bot instance for ${stream}`)

    // if (botSettings['services']['botoholt']) {
    let commands = await cdb.db(botSettings.db).collection('botCommands').find().toArray()

    botCommands[stream] = {
        commands: commands.reduce((result, obj) => {
            obj.aliases.forEach((alias) => {
                if (obj.enabled && obj.function != 'bot.commands.repeat') {
                    result[alias.toLowerCase()] = obj
                }
            })
            return result
        }, {}),
        repeat: commands.reduce((result, obj) => {
            if (obj.enabled && obj.function == 'bot.commands.repeat') {
                result.push(
                    setInterval(function () {
                        let random = Math.floor(Math.random() * obj.answers.length)
                        let answer = obj.answers[random]
                        chatClient.say(stream, answer)
                    }, obj.cooldown * 1000)
                )
            }
            return result
        }, []),
    }

    // timeStamp(`Bot instance created for ${stream}`)
    // } else {
    //     botCommands[stream] = { commands: {} }
    // }

    if (botSettings['services']['pubsub']) {
        botRewards[stream] = {
            rewards: await cdb.db(botSettings.db).collection('botSettings').findOne({ settingName: 'rewards' }),
        }

        let streamerTokens = await cdb.db('botSettings').collection('twTokens').findOne({ channel: stream })
        await authProviderApi.addUser(streamerTokens['twitchId'], streamerTokens)
        // let scopes = await authProviderApi.getCurrentScopesForUser(streamerTokens['twitchId'])
        // console.log(scopes)
    } else {
        botRewards[stream] = { rewards: {} }
    }
    cooldown[stream] = []

    // if (botSettings['services']['pubsub'] || botSettings['services']['botoholt']) {
    chatClient.join(stream).then(() => {
        timeStamp(`Joined ${stream}`)
    })
    // }
}

async function dropBotInstance(stream) {
    timeStamp(`Stopping bot instance for ${stream}`)
    try {
        chatClient.part(stream)
        if (botCommands.stream) {
            if (botCommands.stream.repeat) {
                botCommands[stream]['repeat'].forEach((intervalId) => {
                    clearInterval(intervalId)
                })
            }
        }
        delete botCommands[stream]
        delete botRewards[stream]
        delete cooldown[stream]
    } catch (error) {
        timeStamp(error)
        return
    }

    timeStamp(`Bot instance stopped for ${stream}`)
}

function commandCooldown(channel, command, cdTime) {
    cooldown[channel].push(command)
    setTimeout(() => {
        let index = cooldown[channel].indexOf(command)
        try {
            cooldown[channel].splice(index, 1)
        } catch (error) {
            timeStamp(error)
        }
    }, cdTime * 1000)
}

chatClient.onMessage(async (channel, user, messageRaw, msg) => {
    // timeStamp(`[#${channel}] ${user}: ${messageRaw}`)
    if (user === 'botoholt') return // Prevent the bot from responding to its own messages
    const message = messageRaw.trim().toLowerCase().replace('@', '').split(' ')

    if (msg.tags.has('custom-reward-id')) {
        if (botRewards[channel].rewards.settings) {
            if (Object.keys(botRewards[channel]['rewards']['settings']).includes(msg.tags.get('custom-reward-id'))) {
                // console.log(tags)
                let processReward = botRewards[channel]['rewards']['settings'][msg.tags.get('custom-reward-id')]
                console.log(processReward)
                switch (processReward.function) {
                    case 'bot.rewards.timeout':
                        bot.timeouts.timeout(apiClient, channel, message, processReward['time'], processReward['vips'])
                        break
                    case 'bot.rewards.untimeout':
                        bot.timeouts.untimeout(apiClient, channel, message, processReward['time'])
                        break
                }
            }
        }
        return
    }

    if (message.length >= 2) {
        if (message[1].includes('!')) {
            ;[message[0], message[1]] = [message[1], message[0]]
            msg.tags.set('display-name', message[1])
            // tags.username = message[1]
        }
    }

    if (message[0].includes('!')) {
        if (botCommands[channel].commands) {
            if (Object.keys(botCommands[channel]['commands']).includes(message[0])) {
                let processMessage = botCommands[channel]['commands'][message[0]]['function']
                if (cooldown[channel].includes(processMessage)) {
                    return
                } else {
                    commandCooldown(channel, processMessage, botCommands[channel]['commands'][message[0]]['cooldown'])
                    let answers = botCommands[channel]['commands'][message[0]]['answers']
                    switch (processMessage) {
                        case 'bot.songs.songProcess':
                            bot.songs.songProcess(chatClient, channel, msg.tags, message, answers)
                            break
                        case 'bot.songs.whichProcess':
                            bot.songs.whichProcess(chatClient, channel, msg.tags, message, answers)
                            break
                        case 'bot.songs.queueProcess':
                            bot.songs.queueProcess(chatClient, channel, msg.tags, message, answers)
                            break
                        case 'bot.songs.lastSong':
                            bot.songs.lastSong(chatClient, channel, msg.tags, message, answers)
                            break
                        case 'bot.commands.custom':
                            bot.commands.custom(
                                chatClient,
                                channel,
                                msg.tags,
                                message,
                                botCommands[channel]['commands'][message[0]]
                            )
                            break
                        case 'bot.response.brooklyn':
                            bot.response.sayBrooklyn(chatClient, channel, msg.tags)
                            break
                        case 'bot.response.sayOld':
                            bot.response.sayOld(chatClient, channel, msg.tags)
                            break
                        // case 'bot.svinpolice.timeout':
                        //     bot.svinpolice.timeout(chatClient, channel, msg.tags, message)
                        //     break
                    }
                }
            }
        }
    }
})
