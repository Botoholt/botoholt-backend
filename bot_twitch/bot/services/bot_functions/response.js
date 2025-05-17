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
    try {
        const response = await fetch('https://gql.twitch.tv/gql', {
            method: 'POST',
            headers: {
                authorization: `OAuth ${process.env.TWITCH_OAUTH_TOKEN_GQL}`,
                'client-id': process.env.TWITCH_CLIENT_ID_GQL,
                'content-type': 'application/json',
            },
            body: JSON.stringify([
                {
                    operationName: 'ViewerCard',
                    variables: {
                        channelID: tags.get('room-id'),
                        channelLogin: channel,
                        hasChannelID: true,
                        giftRecipientLogin: tags.get('display-name'),
                        isViewerBadgeCollectionEnabled: false,
                        withStandardGifting: false,
                        badgeSourceChannelLogin: channel,
                    },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: process.env.TWITCH_HASH_GQL,
                        },
                    },
                },
            ]),
        });

        const data = await response.json();

        if (data[0].data.targetUser.relationship.cumulativeTenure.months == 0) {
            client.say(channel, `${tags.get('display-name')}, ты миниписька SUBprise`);
        } else if (data[0].data.targetUser.relationship.cumulativeTenure.months <= 1) {
        client.say(
            channel,
            `${tags.get('display-name')} алло, дядя. Ты микрохуй BloodTrail`);
        } else if (data[0].data.targetUser.relationship.cumulativeTenure.months <= 6) {
            client.say(channel, `${tags.get('display-name')}, ты среднехуй BloodTrail`);
        } else if (data[0].data.targetUser.relationship.cumulativeTenure.months <= 12) {
            client.say(channel, `${tags.get('display-name')}, ты хуй BloodTrail`);
        } else if (data[0].data.targetUser.relationship.cumulativeTenure.months <= 24) {
            client.say(channel, `${tags.get('display-name')}, ты мегахуй BloodTrail`);
        } else if (data[0].data.targetUser.relationship.cumulativeTenure.months <= 36) {
            client.say(channel, `${tags.get('display-name')}, ты гигахуй BloodTrail`);
        } else {
            client.say(channel, `${tags.get('display-name')}, ты альфахуй BloodTrail`);
        }
    } catch (error) {
        console.error('Error:', error);
        client.say(channel, `${tags.get('display-name')} я не знаю PoroSad`);
    }
}

export { sayCommands, sayBrooklyn, sayOld }
