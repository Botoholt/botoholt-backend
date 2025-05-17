import { client as cdb } from '../../modules/db.js'

function timeout(client, channel, tags, message) {
    cdb.db(channel + '_db')
        .collection('botSettings')
        .findOne({ settingName: 'svinPolicemans' })
        .then((result) => {
            if (result.settings.mods.includes(tags.username)) {
                // && parseInt(message[2]) <= 86400
                cdb.db(channel + '_db')
                    .collection('timeouts')
                    .findOne({ name: message[1] })
                    .then((isTimedOut) => {
                        if (isTimedOut) {
                            if (Date.now() > isTimedOut['timeTo']) {
                                client
                                    .timeout(
                                        channel,
                                        message[1],
                                        600,
                                        `Таймаут от свинполицая ${tags.username}: ${message.slice(2).join(' ')}`
                                    )
                                    .then((data) => {
                                        console.log(data.seconds)
                                    })
                                    .catch((err) => {
                                        console.log(err)
                                    })
                            }
                        } else {
                            client
                                .timeout(
                                    channel,
                                    message[1],
                                    600,
                                    `Таймаут от свинполицая ${tags.username}: ${message.slice(2).join(' ')}`
                                )
                                .then((data) => {
                                    console.log(data.seconds)
                                })
                                .catch((err) => {
                                    console.log(err)
                                })
                        }
                    })
            }
        })
}

export { timeout }
