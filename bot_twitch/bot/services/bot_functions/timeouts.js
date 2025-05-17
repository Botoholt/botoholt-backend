import { client as cdb } from '../../modules/db.js'
import { timeStamp } from '../../modules/tools.js'

async function timeout(apiClient, channel, message, time, vipsEnabled) {
    let user
    let [streamerTokens, botTokens] = await Promise.all([
        cdb.db('botSettings').collection('twTokens').findOne({ channel: channel }),
        cdb.db('botSettings').collection('twTokens').findOne({ channel: 'botoholt' }),
    ])

    try {
        user = await apiClient.users.getUserByName(message[0])
        if (!user) {
            return
        }
        if (!vipsEnabled) {
            let isVip = await apiClient.channels.checkVipForUser(streamerTokens['twitchId'], user)
            if (isVip) {
                return
            }
        }
    } catch (error) {
        timeStamp(error)
        return
    }

    try {
        let banStatus = await apiClient.moderation.getBannedUsers(streamerTokens['twitchId'], { userId: user.id })

        if (banStatus.data[0]) {
            if (
                banStatus.data[0]['moderatorId'] == botTokens['twitchId'] &&
                banStatus.data[0].expiryDate != null &&
                (new Date(banStatus.data[0].expiryDate) - new Date()) / 1000 < time
            ) {
                try {
                    await apiClient.asUser(botTokens['twitchId'], async (ctx) => {
                        await ctx.moderation.banUser(streamerTokens['twitchId'], botTokens['twitchId'], {
                            duration: time,
                            user: user.id,
                        })
                    })
                } catch (innerError) {
                    timeStamp(`Inner error in banUser: ${innerError.message}`)
                    throw innerError 
                }
            }
        } else {
            try {
                await apiClient.asUser(botTokens['twitchId'], async (ctx) => {
                    await ctx.moderation.banUser(streamerTokens['twitchId'], {
                        duration: time,
                        user: user.id,
                    })
                })
            } catch (innerError) {
                timeStamp(`Inner error in banUser: ${innerError.message}`)
                throw innerError
            }
        }
    } catch (error) {
        timeStamp(`Error in timeout function: ${error.message}`)
        timeStamp(`Stack trace: ${error.stack}`)
        return
    }
}

async function untimeout(apiClient, channel, message, time) {
    let user
    let [streamerTokens, botTokens] = await Promise.all([
        cdb.db('botSettings').collection('twTokens').findOne({ channel: channel }),
        cdb.db('botSettings').collection('twTokens').findOne({ channel: 'botoholt' }),
    ])

    try {
        user = await apiClient.users.getUserByName(message[0])
        if (!user) {
            return
        }
    } catch (error) {
        timeStamp(error)
        return
    }


    try {
        let banStatus = await apiClient.moderation.getBannedUsers(streamerTokens['twitchId'], { userId: user.id })

        if (banStatus.data[0]) {
            if (
                banStatus.data[0]['moderatorId'] == botTokens['twitchId'] &&
                banStatus.data[0].expiryDate != null &&
                (new Date(banStatus.data[0].expiryDate) - new Date()) / 1000 < time
            ) {
                try {
                    await apiClient.asUser(botTokens['twitchId'], async ctx => {
                        ctx.moderation.unbanUser(streamerTokens['twitchId'], user.id)
                    })
                } catch (innerError) {
                    timeStamp(`Inner error in unbanUser: ${innerError.message}`)
                    throw innerError
                }
            }
        }
    } catch (error) {
        timeStamp(error)
        return
    }

}


export { timeout, untimeout }
