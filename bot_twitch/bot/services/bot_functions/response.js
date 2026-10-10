import 'dotenv/config'

//TODO: this should be done from database with same thing as answer processor in songs.js

function sayCommands(client, channel, tags) {
    client.say(
        channel,
        `${tags['display-name']} !s - текущий трек, !q - очередь заказных песен, !который - место вашей песни в очереди, !последний - предыдущий трек или просто иди на bho.lt/${channel}/ `
    )
}

function sayBrooklyn(client, channel, tags) {
    // console.log(tags)
    client.say(
        channel,
        `${tags.get('display-name')} алло, дядя. В Бруклине сейчас ` +
            new Date().toLocaleString('lt-LT', { timeZone: 'America/New_York' }).substring(11, 23)
    )
}

async function sayOld(client, channel, tags) {
    const displayName = tags.get('display-name')
    const targetLogin = String(displayName || '').toLowerCase()
    const channelLogin = String(channel || '').replace(/^#/, '')

    try {
        const response = await fetch('https://gql.twitch.tv/gql', {
            method: 'POST',
            headers: {
                Authorization: process.env.TWITCH_OAUTH_TOKEN_GQL,
                'Client-Id': process.env.TWITCH_CLIENT_ID_GQL,
                'content-type': 'application/json',
            },
            body: JSON.stringify([
                {
                    operationName: 'ViewerCard',
                    variables: {
                        channelID: tags.get('room-id'),
                        channelLogin,
                        hasChannelID: true,
                        giftRecipientLogin: targetLogin,
                        isViewerBadgeCollectionEnabled: false,
                        withStandardGifting: false,
                        badgeSourceChannelLogin: channelLogin,
                    },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: process.env.TWITCH_HASH_GQL,
                        },
                    },
                },
            ]),
        })

        const data = await response.json()
        const earnedBadges = data?.[0]?.data?.channelViewer?.earnedBadges

        if (!Array.isArray(earnedBadges)) {
            console.error('sayOld: no earned badges in GQL response', JSON.stringify(data))
            client.say(channel, `${displayName} я не знаю PoroSad`)
            return
        }

        const subscriberBadge = earnedBadges.find((badge) => badge?.setID === 'subscriber')
        const subscriberBadgeVersion = subscriberBadge ? Number(subscriberBadge.version) : 0

        if (!Number.isInteger(subscriberBadgeVersion) || subscriberBadgeVersion < 0) {
            console.error('sayOld: invalid subscriber badge version', subscriberBadge?.version)
            client.say(channel, `${displayName} я не знаю PoroSad`)
            return
        }

        // Badge versions are milestones, so classify by the next available milestone
        // rather than treating the version as an exact cumulative tenure.
        if (subscriberBadgeVersion < 6) {
            client.say(channel, `${displayName}, ты кто такой сука Casino`)
        } else if (subscriberBadgeVersion < 18) {
            client.say(channel, `${displayName}, ты не олд PoroSad`)
        } else if (subscriberBadgeVersion < 24) {
            client.say(channel, `${displayName}, ты биг smurftvBig`)
        } else if (subscriberBadgeVersion < 42) {
            client.say(channel, `${displayName}, ты ультра биг EZ`)
        } else {
            client.say(channel, `${displayName}, олды на месте POGGIES`)
        }
    } catch (error) {
        console.error('Error:', error)
        client.say(channel, `${displayName} я не знаю PoroSad`)
    }
}

export { sayCommands, sayBrooklyn, sayOld }
