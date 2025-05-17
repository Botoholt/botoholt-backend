require('dotenv').config()
let MongoClient = require('mongodb').MongoClient
let dbc = new MongoClient(process.env.MONGOURL)

async function syncSocials(streams){
    
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

            socials = await socials.json()

            console.log(stream.channel)
            // console.log(socials[0]['data']['user']['channel']['socialMedias'])


            await dbc
            .db(stream.db)
            .collection('botSettings')
            .findOneAndUpdate({settingName: 'songsWebSettings'}, {$set: {socialMedias: socials[0]['data']['user']['channel']['socialMedias']}})
            // dbc.close()
        
    } catch {
        continue
    }

    }

}


async function syncFollowers(streams){
    let urlFollowersData = `https://api.twitch.tv/helix/channels/followers?broadcaster_id=$id&first=1`
    let headers = {
        Authorization: process.env.TWITCH_AUTHORIZATION,
        'Client-Id': process.env.TWITCH_CLIENT_ID_TMP,
    }
    for (let stream of streams){
        // let streamchik = await dbc.db('botSettings').collection('streams').findOne({channel: stream.login})
        let followersCnt = await fetch(urlFollowersData.replace('$id', stream.id), { headers })
        followersCnt = await followersCnt.json()
        // console.log(followersCnt)
        await dbc.db('botSettings').collection('streams').findOneAndUpdate({id: stream.id}, {$set: {followersCount: followersCnt.total}})
        // dbc.close()
    }
    // dbc.close()
}

async function ids(streams){
    let urlStreamData = `https://api.twitch.tv/helix/users?login=${streams.join('&login=')}`

    let headers = {
        Authorization: process.env.TWITCH_AUTHORIZATION,
        'Client-Id': process.env.TWITCH_CLIENT_ID_TMP,
    }

    let streamy = await fetch(urlStreamData, { headers })
    streamy = await streamy.json()

    for (let stream of streamy.data){
        await dbc
        .db('botSettings')
        .collection('streams')
        .findOneAndUpdate({channel: stream.login}, {$set: {id: parseInt(stream.id), displayName: stream.display_name}})
    }
    console.log(streamy)

}

async function main(){
    let streams = await dbc.db('botSettings').collection('streams').find().toArray()
    const chunkSize = 100,
        chunks = []
    for (let i = 0; i < Math.ceil(streams.length / chunkSize); i++) {
        chunks[i] = streams.slice(i * chunkSize, (i + 1) * chunkSize)
    }

    for (streams of chunks) {
        await syncSocials(streams)
        await syncFollowers(streams)
    }

    dbc.close()
}

main()