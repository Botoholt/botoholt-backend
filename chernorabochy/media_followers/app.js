require('dotenv').config()
let MongoClient = require('mongodb').MongoClient
let dbc = new MongoClient(process.env.MONGO_URL)

const timeStamp = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`)
}

async function syncSocials(streams){
    timeStamp(`syncSocials: start, ${streams.length} stream(s)`)
    let updated = 0,
        failed = 0

    let urlSocialsData = `https://gql.twitch.tv/gql`

    for (let stream of streams) {
        try {
            let bodySocialsData = [{
                "extensions": {
                    "persistedQuery": {
                        "sha256Hash": process.env.TWITCH_SOCIALS_HASH,
                        "version": 1
                    }
                },
                "operationName": "HomeOfflineCarousel",
                "variables": {
                    "channelLogin": stream.channel,
                    "includeTrailerUpsell": false,
                    "trailerUpsellVideoID": "601884311"
                }
            }]

            let socials = await fetch(urlSocialsData, {method: 'post', body: JSON.stringify(bodySocialsData), headers: {
                'Content-Type': 'application/json',
                'Client-Id': process.env.TWITCH_SOCIALS_CLIENT_ID,
                }})

            if (!socials.ok) {
                timeStamp(`syncSocials: ${stream.channel} — GQL request failed with HTTP ${socials.status}`)
                failed++
                continue
            }

            socials = await socials.json()

            let socialMedias = socials?.[0]?.data?.user?.channel?.socialMedias
            if (!socialMedias) {
                timeStamp(
                    `syncSocials: ${stream.channel} — no socialMedias in response (persisted query hash may be stale): ${JSON.stringify(socials).slice(0, 300)}`
                )
                failed++
                continue
            }

            await dbc
            .db(stream.db)
            .collection('botSettings')
            .findOneAndUpdate({settingName: 'songsWebSettings'}, {$set: {socialMedias: socialMedias}})
            timeStamp(`syncSocials: ${stream.channel} — updated ${socialMedias.length} social link(s)`)
            updated++

    } catch (error) {
        timeStamp(`syncSocials: ${stream.channel} — error: ${error.message}`)
        failed++
        continue
    }

    }

    timeStamp(`syncSocials: done, ${updated} updated, ${failed} failed`)
}


async function syncFollowers(streams){
    timeStamp(`syncFollowers: start, ${streams.length} stream(s)`)
    let updated = 0,
        failed = 0

    let urlFollowersData = `https://api.twitch.tv/helix/channels/followers?broadcaster_id=$id&first=1`
    let headers = {
        Authorization: process.env.TWITCH_AUTHORIZATION,
        'Client-Id': process.env.TWITCH_CLIENT_ID_TMP,
    }
    for (let stream of streams){
        try {
            let response = await fetch(urlFollowersData.replace('$id', stream.id), { headers })
            let followersCnt = await response.json()
            // Only write when we actually got a number — an expired TWITCH_AUTHORIZATION
            // used to wipe followersCount to null for every channel.
            if (typeof followersCnt.total !== 'number') {
                timeStamp(
                    `syncFollowers: ${stream.channel} — no total, skipping (HTTP ${response.status}): ${JSON.stringify(followersCnt).slice(0, 300)}`
                )
                failed++
                continue
            }
            await dbc.db('botSettings').collection('streams').findOneAndUpdate({id: stream.id}, {$set: {followersCount: followersCnt.total}})
            timeStamp(`syncFollowers: ${stream.channel} — ${followersCnt.total} followers`)
            updated++
        } catch (error) {
            timeStamp(`syncFollowers: ${stream.channel} — error: ${error.message}`)
            failed++
        }
    }

    timeStamp(`syncFollowers: done, ${updated} updated, ${failed} failed`)
}

async function ids(streams){
    let urlStreamData = `https://api.twitch.tv/helix/users?login=${streams.join('&login=')}`

    let headers = {
        Authorization: process.env.TWITCH_AUTHORIZATION,
        'Client-Id': process.env.TWITCH_CLIENT_ID_TMP,
    }

    let streamy = await fetch(urlStreamData, { headers })
    streamy = await streamy.json()

    if (!Array.isArray(streamy.data)) {
        timeStamp(`ids: unexpected Helix response: ${JSON.stringify(streamy).slice(0, 300)}`)
        return
    }

    for (let stream of streamy.data){
        await dbc
        .db('botSettings')
        .collection('streams')
        .findOneAndUpdate({channel: stream.login}, {$set: {id: parseInt(stream.id), displayName: stream.display_name}})
        timeStamp(`ids: ${stream.login} → id ${stream.id}`)
    }

}

async function main(){
    const requiredEnv = ['MONGO_URL', 'TWITCH_AUTHORIZATION', 'TWITCH_CLIENT_ID_TMP', 'TWITCH_SOCIALS_HASH', 'TWITCH_SOCIALS_CLIENT_ID']
    const missing = requiredEnv.filter((name) => !process.env[name])
    if (missing.length) {
        timeStamp(`main: WARNING — missing env vars: ${missing.join(', ')}`)
    }

    let streams = await dbc.db('botSettings').collection('streams').find().toArray()
    timeStamp(`main: loaded ${streams.length} stream(s) from DB`)

    const chunkSize = 100,
        chunks = []
    for (let i = 0; i < Math.ceil(streams.length / chunkSize); i++) {
        chunks[i] = streams.slice(i * chunkSize, (i + 1) * chunkSize)
    }

    for (streams of chunks) {
        await syncSocials(streams)
        await syncFollowers(streams)
    }

    timeStamp('main: done')
    dbc.close()
}

main().catch((error) => {
    timeStamp(`main: fatal error: ${error.message}`)
    process.exitCode = 1
})
