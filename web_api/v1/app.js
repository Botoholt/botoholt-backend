require('dotenv').config()
let express = require('express')
let session = require('express-session')
let MongoClient = require('mongodb').MongoClient
let ObjectId = require('mongodb').ObjectId
let redis = require('redis')
let passport = require('passport')
let OAuth2Strategy = require('passport-oauth').OAuth2Strategy
let cors = require('cors')
let { body, validationResult } = require('express-validator')
let objDiff = require('deep-object-diff')
let { Server } = require('socket.io')

let redisClient = redis.createClient({ url: process.env.REDIS_URL })
redisClient.connect()
let redisClientPS = redis.createClient({ url: process.env.REDIS_URL })
redisClientPS.connect()

let dbc = new MongoClient(process.env.MONGOURL)
let app = express()

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000,
        },
    })
)
app.use(passport.initialize())
app.use(passport.session())
app.use(express.json())
app.use(cors())
app.set('base', '/api/v1/')

const timeStamp = (message) => {
    console.log('[' + new Date().toISOString().substring(0, 23) + '] -', message)
}
/**
 * Botoholt admin panel endpoints
 * Authentication and management
 */

OAuth2Strategy.prototype.userProfile = async function (accessToken, done) {
    let options = {
        method: 'GET',
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            Accept: 'application/vnd.twitchtv.v5+json',
            Authorization: 'Bearer ' + accessToken,
        },
    }

    let response = await fetch('https://api.twitch.tv/helix/users', options)
    // console.log(response)
    if (response.ok) {
        done(null, await response.json())
    } else {
        done(await response.json())
    }
}

passport.serializeUser(function (user, done) {
    done(null, user)
})

passport.deserializeUser(function (user, done) {
    done(null, user)
})

passport.use(
    'twitch',
    new OAuth2Strategy(
        {
            authorizationURL: 'https://id.twitch.tv/oauth2/authorize',
            tokenURL: 'https://id.twitch.tv/oauth2/token',
            clientID: process.env.TWITCH_CLIENT_ID,
            clientSecret: process.env.TWITCH_SECRET,
            callbackURL: process.env.CALLBACK_URL,
            state: true,
        },
        async function (accessToken, refreshToken, profile, done) {
            profile = profile.data[0]
            // console.log(profile)
            profile.id = parseInt(profile.id)
            profile.accessToken = accessToken
            // profile.refreshToken = refreshToken

            let channel = await dbc
                .db('botSettings')
                .collection('streams')
                .findOne({ id: profile.id })
            // console.log(channel)
            if (channel) {
                if (channel.channel != profile.login || channel.displayName != profile.display_name) {
                    await dbc
                        .db('botSettings')
                        .collection('streams')
                        .updateOne({ id: profile.id }, { $set: { channel: profile.login,  displayName: profile.display_name } })
                }
                profile.services = channel.services
                profile.lang = channel.lang

                const updateTokens = await dbc.db('botSettings').collection('twTokens').updateOne(
                    { twitchId: profile.id }, 
                    {$set: {accessToken: accessToken, refreshToken: refreshToken, obtainmentTimestamp: Date.now()}}
                )
                if (updateTokens.matchedCount === 0) {
                    await dbc.db('botSettings').collection('twTokens').insertOne({
                        twitchId: profile.id,
                        channel: profile.login,
                        accessToken: accessToken,
                        refreshToken: refreshToken,
                        expiresIn: 0,
                        obtainmentTimestamp: Date.now(),
                    })
                }

            } else {
                timeStamp(`Creating database for ${profile.login}`)
                let newDb = profile.id.toString()
                let collections = await dbc.db('_bholt_def_en').listCollections().toArray()
                // console.log(collections)
                let collectionNames = collections.map((collection) => collection.name)
                for (let collectionName of collectionNames) {
                    let sourceCollection = dbc.db('_bholt_def_en').collection(collectionName)
                    let destinationCollection = dbc.db(newDb).collection(collectionName)

                    let data = await sourceCollection.find({}).toArray()
                    // console.log(data)
                    // Insert data into the destination collection
                    await destinationCollection.insertMany(data)
                }

                timeStamp('All collections copied successfully.')

                await dbc
                    .db('botSettings')
                    .collection('streams')
                    .insertOne({
                        channel: profile.login,
                        db: profile.id.toString(),
                        services: {
                            botoholt: false,
                            pubsub: false,
                            da_api: false,
                        },
                        displayName: profile.display_name,
                        id: profile.id,
                        followersCount: 0,
                        lang: null,
                    })
                await dbc.db('botSettings').collection('twTokens').insertOne({
                    twitchId: profile.id,
                    channel: profile.login,
                    accessToken: accessToken,
                    refreshToken: refreshToken,
                    expiresIn: 0,
                    obtainmentTimestamp: Date.now(),
                })
                profile.services = {
                    botoholt: false,
                    pubsub: false,
                    da_api: false,
                }
                getMainPageStreams().then((data) => {
                    mainPageStreamsData = data
                    timeStamp('Main page data reloaded after registration')
                })
            }

            done(null, profile)
        }
    )
)

function loggedIn(req, res, next) {
    if (req.user) {
        next()
    } else {
        res.status(403).send({ message: 'Unathorized' })
    }
}

app.get(
    '/admin/auth/twitch',
    passport.authenticate('twitch', { scope: ['user_read', 'channel:read:vips', 'moderation:read', 'channel:read:subscriptions'] })
)

app.get(
    '/admin/auth/twitch/callback',
    passport.authenticate('twitch', { failureRedirect: '/login' }),
    function (req, res) {
        res.redirect('/admin')
        //res.send({ message: 'success' })
    }
)

app.get('/admin/auth/logout', function (req, res) {
    req.session.destroy(function () {
        res.redirect('/')
    })
})

app.get('/admin', loggedIn, async function (req, res) {
    let headers = {
        Authorization: `Bearer ${req.user.accessToken}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID,
    }
    let isMod = false
    try {
        let checkMod = await fetch(
            `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${req.user.id}&user_id=${process.env.TWITCH_BOT_ID}`,
            { headers }
        ).then((resp) => resp.json())
        isMod = checkMod.data.length > 0 ? true : false
    } catch (error) {
        timeStamp(error)
    }

    let user = { ...req.user, isTwitchMod: isMod }
    delete user.accessToken
    res.send(user) // req.user
})

app.post('/admin/lang', [body('lang').isString().notEmpty()], loggedIn, async function (req, res) {
    try {
        let errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }
        if (req.body.lang == 'ru') {
            if (!req.user.lang) {
                await dbc.db(req.user.id.toString()).dropCollection('botCommands')
                timeStamp('Dropped')
                let sourceCollection = dbc.db('_bholt_def_ru').collection('botCommands')
                let destinationCollection = dbc.db(req.user.id.toString()).collection('botCommands')

                let data = await sourceCollection.find().toArray()
                // console.log(data)
                // Insert data into the destination collection
                await destinationCollection.insertMany(data)
            }
            await dbc
                .db('botSettings')
                .collection('streams')
                .updateOne({ id: req.user.id }, { $set: { lang: 'ru' } })
            req.user.lang = 'ru'
        } else {
            await dbc
                .db('botSettings')
                .collection('streams')
                .updateOne({ id: req.user.id }, { $set: { lang: 'en' } })
            req.user.lang = 'en'
        }
        res.status(200).json({ lang: req.user.lang })
    } catch (error) {
        timeStamp(error)
        res.status(400).json({ errors: 'something went wrong' })
    }
})

app.get('/admin/services/:service', loggedIn, async function (req, res) {
    let state = await dbc
        .db('botSettings')
        .collection('streams')
        .findOne({ id: req.user.id })

    if (req.params.service == 'botoholt') {
        switch (state.services.botoholt) {
            case false: {
                let actionStatePromise = new Promise((resolve, reject) => {
                    let waitResponse = setTimeout(function () {
                        redisClientPS.unsubscribe('_datalink')
                        reject('Timed out')
                    }, 5000)
                    redisClientPS.subscribe('_datalink', (message, channel) => {
                        message = JSON.parse(message)
                        if (
                            message.action == 'start_success' &&
                            message.service == 'bot_twitch' &&
                            message.channel == req.user.login
                        ) {
                            redisClientPS.unsubscribe('_datalink')
                            clearTimeout(waitResponse)
                            resolve('Success')
                        }
                    })
                })
                redisClient.publish(
                    '_datalink',
                    JSON.stringify({ service: 'bot_twitch', action: 'start', channel: req.user.login })
                )
                await actionStatePromise
                    .then(async (successMessage) => {
                        await dbc
                            .db('botSettings')
                            .collection('streams')
                            .findOneAndUpdate({ id: req.user.id }, [
                                { $set: { 'services.botoholt': { $eq: [false, '$services.botoholt'] } } },
                            ])
                        req.user.services.botoholt = !req.user.services.botoholt
                        res.status(200).json({ message: 'success' })
                        return
                    })
                    .catch((e) => {
                        timeStamp(e)
                        res.status(409).json({ message: 'failure' })
                        return
                    })
                return
            }
            case true: {
                let actionStatePromise = new Promise((resolve, reject) => {
                    redisClientPS.subscribe('_datalink', (message, channel) => {
                        let waitResponse = setTimeout(function () {
                            redisClientPS.unsubscribe('_datalink')
                            reject('Timed out')
                        }, 5000)
                        message = JSON.parse(message)
                        if (
                            message.action == 'stop_success' &&
                            message.service == 'bot_twitch' &&
                            message.channel == req.user.login
                        ) {
                            // console.log('nu da i che')
                            redisClientPS.unsubscribe('_datalink')
                            clearTimeout(waitResponse)
                            resolve('Success')
                        }
                    })
                })
                redisClient.publish(
                    '_datalink',
                    JSON.stringify({ service: 'bot_twitch', action: 'stop', channel: req.user.login })
                )
                await actionStatePromise
                    .then(async (successMessage) => {
                        // console.log('Yay ' + successMessage)
                        await dbc
                            .db('botSettings')
                            .collection('streams')
                            .findOneAndUpdate({ id: req.user.id }, [
                                { $set: { 'services.botoholt': { $eq: [false, '$services.botoholt'] } } },
                            ])
                        req.user.services.botoholt = !req.user.services.botoholt
                        res.status(200).json({ message: 'success' })
                        return
                    })
                    .catch((e) => {
                        timeStamp(e)
                        res.status(409).json({ message: 'failure' })
                        return
                    })
                return
            }
        }
    }
    if (req.params.service == 'donationalerts') {
        let tokenTelo = await dbc
            .db(req.user.id.toString())
            .collection('botSettings')
            .findOne({ settingName: 'daToken' })
        if (tokenTelo.settings.token) {
            switch (state.services.da_api) {
                case false: {
                    let actionStatePromise = new Promise((resolve, reject) => {
                        let waitResponse = setTimeout(function () {
                            redisClientPS.unsubscribe('_datalink')
                            reject('Timed out')
                        }, 5000)
                        redisClientPS.subscribe('_datalink', (message, channel) => {
                            message = JSON.parse(message)
                            if (
                                message.action == 'start_success' &&
                                message.service == 'da_api' &&
                                message.channel == req.user.login
                            ) {
                                redisClientPS.unsubscribe('_datalink')
                                clearTimeout(waitResponse)

                                resolve('Success')
                            }
                        })
                    })
                    redisClient.publish(
                        '_datalink',
                        JSON.stringify({ service: 'da_api', action: 'start', channel: req.user.login })
                    )
                    await actionStatePromise
                        .then(async (successMessage) => {
                            await dbc
                                .db('botSettings')
                                .collection('streams')
                                .findOneAndUpdate({ id: req.user.id }, [
                                    { $set: { 'services.da_api': { $eq: [false, '$services.da_api'] } } },
                                ])
                            req.user.services.da_api = !req.user.services.da_api
                            res.status(200).json({ message: 'success' })
                            return
                        })
                        .catch((e) => {
                            timeStamp(e)
                            res.status(409).json({ message: 'failure' })
                            return
                        })
                    return
                }
                case true: {
                    let actionStatePromise = new Promise((resolve, reject) => {
                        let waitResponse = setTimeout(function () {
                            redisClientPS.unsubscribe('_datalink')
                            reject('Timed out')
                        }, 5000)
                        redisClientPS.subscribe('_datalink', (message, channel) => {
                            message = JSON.parse(message)
                            if (
                                message.action == 'stop_success' &&
                                message.service == 'da_api' &&
                                message.channel == req.user.login
                            ) {
                                redisClientPS.unsubscribe('_datalink')
                                clearTimeout(waitResponse)
                                resolve('Success')
                            }
                        })
                    })
                    redisClient.publish(
                        '_datalink',
                        JSON.stringify({ service: 'da_api', action: 'stop', channel: req.user.login })
                    )
                    await actionStatePromise
                        .then(async (successMessage) => {
                            await dbc
                                .db('botSettings')
                                .collection('streams')
                                .findOneAndUpdate({ id: req.user.id }, [
                                    { $set: { 'services.da_api': { $eq: [false, '$services.da_api'] } } },
                                ])
                            req.user.services.da_api = !req.user.services.da_api
                            res.status(200).json({ message: 'success' })
                            return
                        })
                        .catch((e) => {
                            timeStamp(e)
                            res.status(409).json({ message: 'failure' })
                            return
                        })
                    return
                }
            }

            return
        } else {
            res.status(400).json({ message: "can't change state without DA token" })
            return
        }
    }
    res.status(400).json({ message: 'no such service' })
    return
})

app.get('/admin/commands/default', loggedIn, async function (req, res) {
    let commands = await dbc
        .db(req.user.id.toString())
        .collection('botCommands')
        .find({ function: { $nin: ['bot.commands.custom', 'bot.commands.repeat'] } })
        .toArray()

    res.send(commands)
})

app.get('/admin/commands/custom', loggedIn, async function (req, res) {
    let commands = await dbc
        .db(req.user.id.toString())
        .collection('botCommands')
        .find({ function: { $in: ['bot.commands.custom', 'bot.commands.repeat'] } })
        .toArray()

    res.send(commands)
})

app.put(
    '/admin/commands/default',
    [
        body('_id').isString(),
        body('function')
            .isString()
            .notEmpty()
            .custom((value) => !['bot.commands.custom', 'bot.commands.repeat'].includes(value)),
        body('aliases')
            .isArray({ min: 1 })
            .custom((value) => {
                // Check if all items in the array are strings
                if (value.every((item) => typeof item === 'string' && item.length > 1 && item.startsWith('!'))) {
                    return true
                }
                throw new Error('Invalid "aliases" value')
            }),
        body('cooldown').isAlphanumeric(),
        body('enabled').isBoolean(),
        body('answers').isObject(),
        body('answers.daAnswers')
            .if(body('function').custom((value) => value.startsWith('bot.songs')))
            .isObject(),
        body('answers.shazamAnswers')
            .if(body('function').custom((value) => value.startsWith('bot.songs')))
            .if((value, { req }) => {
                const field1Value = req.body.function
                const allowedValues = ['bot.songs.whichProcess', 'bot.songs.queueProcess']
                return !allowedValues.includes(field1Value)
            })
            .isObject(),
        body('answers.daAnswers.success').if(body('answers.daAnswers').exists()).isObject(),
        body('answers.daAnswers.failure')
            .if(body('answers.daAnswers').exists())
            .if((value, { req }) => {
                const field1Value = req.body.function
                const allowedValues = ['bot.songs.whichProcess', 'bot.songs.queueProcess']
                return allowedValues.includes(field1Value)
            })
            .isObject(),
        body('answers.shazamAnswers.success').if(body('answers.shazamAnswers').exists()).isObject(),
        body('answers.shazamAnswers.failure').if(body('answers.shazamAnswers').exists()).isObject(),
        body('answers.daAnswers.success.answers')
            .if(body('answers.daAnswers.success').exists())
            .isArray({ min: 1 })
            .custom((value) => {
                // Check if all items in the array are strings
                if (value.every((item) => typeof item === 'string' && item.length > 1)) {
                    return true
                }
                throw new Error('Invalid "answers.daAnswers.success.answers" value')
            }),
        body('answers.daAnswers.failure.answers')
            .if(body('answers.daAnswers.failure').exists())
            .isArray({ min: 1 })
            .custom((value) => {
                // Check if all items in the array are strings
                if (value.every((item) => typeof item === 'string' && item.length > 1)) {
                    return true
                }
                throw new Error('Invalid "answers.daAnswers.failure.answers" value')
            }),
        body('answers.shazamAnswers.success.answers')
            .if(body('answers.shazamAnswers.success').exists())
            .isArray({ min: 1 })
            .custom((value) => {
                // Check if all items in the array are strings
                if (value.every((item) => typeof item === 'string' && item.length > 1)) {
                    return true
                }
                throw new Error('Invalid "answers.shazamAnswers.success.answers" value')
            }),
        body('answers.shazamAnswers.failure.answers')
            .if(body('answers.shazamAnswers.failure').exists())
            .isArray({ min: 1 })
            .custom((value) => {
                // Check if all items in the array are strings
                if (value.every((item) => typeof item === 'string' && item.length > 1)) {
                    return true
                }
                throw new Error('Invalid "answers.shazamAnswers.failure.answers" value')
            }),
    ],
    loggedIn,
    async function (req, res) {
        try {
            // console.log(req.body)

            let errors = validationResult(req)
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() })
            }
            req.body._id = ObjectId(req.body._id)
            let command = await dbc
                .db(req.user.id.toString())
                .collection('botCommands')
                .findOne({ _id: req.body._id })

            // console.log(command)
            // console.log(req.body)
            let diff = objDiff.diff(command, req.body)

            if (!Object.keys(diff).length) {
                // console.log('no changes')
            } else if (Object.keys(diff).includes('function') || Object.keys(diff).includes('_id')) {
                res.status(400).json({ errors: 'you are not allowed to change these fields' })
                return
            } else {
                await dbc
                    .db(req.user.id.toString())
                    .collection('botCommands')
                    .replaceOne({ _id: command._id }, req.body)
                // console.log(changed)
                if (req.user.services.botoholt) {
                    redisClient.publish(
                        '_datalink',
                        JSON.stringify({ service: 'bot_twitch', action: 'restart', channel: req.user.login })
                    )
                }

                res.json(req.body)
                return
            }

            // console.log(JSON.stringify(diff))
            // console.log(Object.keys(commands.settings).filter((k) => commands.settings[k].function === req.body.function))
            res.json(command)
        } catch (error) {
            timeStamp(error)
            res.status(400).json({ errors: 'something went wrong' })
        }
    }
)

app.post(
    '/admin/commands/custom',
    [
        body('_id').isString().optional(),
        body('function')
            .isString()
            .notEmpty()
            .custom((value) => ['bot.commands.custom', 'bot.commands.repeat'].includes(value)),
        body('aliases')
            .isArray()
            .custom((value, { req }) => {
                if (req.body.function === 'bot.commands.custom') {
                    if (value.every((item) => typeof item === 'string' && item.length > 1 && item.startsWith('!'))) {
                        return true
                    }
                    throw new Error('Invalid "aliases" value')
                }
                return true
            })
            .custom((value, { req }) => {
                if (req.body.function === 'bot.commands.repeat' && value.length !== 1) {
                    throw new Error('Invalid "aliases" length')
                }
                return true
            }),
        body('cooldown').isAlphanumeric(),
        body('enabled').isBoolean(),
        body('answers').isArray().notEmpty(),
    ],
    loggedIn,
    async function (req, res) {
        try {
            // console.log(req.body)

            let errors = validationResult(req)
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() })
            }

            if (req.body._id) {
                req.body._id = ObjectId(req.body._id)
                let command = await dbc
                    .db(req.user.id.toString())
                    .collection('botCommands')
                    .findOne({ _id: req.body._id })

                // console.log(command)
                // console.log(req.body)
                let diff = objDiff.diff(command, req.body)

                if (!Object.keys(diff).length) {
                    // console.log('no changes')
                } else if (Object.keys(diff).includes('function') || Object.keys(diff).includes('_id')) {
                    res.status(400).json({ errors: 'you are not allowed to change these fields' })
                    return
                } else {
                    await dbc
                        .db(req.user.id.toString())
                        .collection('botCommands')
                        .replaceOne({ _id: command._id }, req.body)
                    // console.log(changed)
                    if (req.user.services.botoholt) {
                        redisClient.publish(
                            '_datalink',
                            JSON.stringify({ service: 'bot_twitch', action: 'restart', channel: req.user.login })
                        )
                    }
                    res.json(req.body)
                    return
                }
            } else {
                await dbc
                    .db(req.user.id.toString())
                    .collection('botCommands')
                    .insertOne(req.body)
                if (req.user.services.botoholt) {
                    redisClient.publish(
                        '_datalink',
                        JSON.stringify({ service: 'bot_twitch', action: 'restart', channel: req.user.login })
                    )
                }
                res.json(req.body)
            }

            // console.log(JSON.stringify(diff))
            // console.log(Object.keys(commands.settings).filter((k) => commands.settings[k].function === req.body.function))
            // res.json(command)
        } catch (error) {
            timeStamp(error)
            res.status(400).json({ errors: 'something went wrong' })
        }
    }
)

app.delete('/admin/commands/custom', [body('_id').isString()], loggedIn, async function (req, res) {
    try {
        // console.log(req.body)

        let errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        req.body._id = ObjectId(req.body._id)
        await dbc
            .db(req.user.id.toString())
            .collection('botCommands')
            .deleteOne({ _id: req.body._id })
        if (req.user.services.botoholt) {
            redisClient.publish(
                '_datalink',
                JSON.stringify({ service: 'bot_twitch', action: 'restart', channel: req.user.login })
            )
        }
        res.json({ message: 'success' })
    } catch (error) {
        timeStamp(error)
        res.status(400).json({ errors: 'something went wrong' })
    }
})

app.get('/admin/donationalerts', loggedIn, async function (req, res) {
    let [daLink, daToken] = await Promise.all([
        dbc
            .db(req.user.id.toString())
            .collection('botSettings')
            .findOne({ settingName: 'songsWebSettings' }),
        dbc
            .db(req.user.id.toString())
            .collection('botSettings')
            .findOne({ settingName: 'daToken' }),
    ])

    res.status(200).json({
        donationLink: daLink.settings.donationLink,
        daToken: daToken.settings.token,
    })
})

function isLink(value) {
    // Regular expression to check for a valid URL format
    const urlPattern = /^(http|https):\/\/[^ "]+$/
    return urlPattern.test(value)
}
function isToken(value) {
    // Regular expressions to check for uppercase, lowercase, and length requirements
    const uppercasePattern = /[A-Z]/
    const lowercasePattern = /[a-z]/
    const lengthRequirement = value.length > 16

    return uppercasePattern.test(value) && lowercasePattern.test(value) && lengthRequirement
}

app.post(
    '/admin/donationalerts',
    [
        body('donationLink').custom(isLink).optional(),
        body('daToken').custom(isToken).optional(),
        // Add more validation rules for other fields if needed
    ],
    loggedIn,
    async function (req, res) {
        try {
            // console.log(req.body)

            let errors = validationResult(req)
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() })
            }

            if (!req.body.token && !req.body.donationLink) {
                res.status(400).json({ message: 'no such field' })
            }

            if (req.body.daToken) {
                await dbc
                    .db(req.user.id.toString())
                    .collection('botSettings')
                    .updateOne({ settingName: 'daToken' }, { $set: { 'settings.token': req.body.daToken } })
                // res.json(req.body)
            }
            if (req.body.donationLink) {
                await dbc
                    .db(req.user.id.toString())
                    .collection('botSettings')
                    .updateOne(
                        { settingName: 'songsWebSettings' },
                        { $set: { 'settings.donationLink': req.body.donationLink } }
                    )
                // res.json(req.body)
            }
            res.status(200).json(req.body)
        } catch (error) {
            timeStamp(error)
            res.status(400).json({ errors: 'wrong value' })
        }
    }
)

/**
 * BOTOHOLT PUBLIC ENDPOINTS FOR STREAMS AND SONGS
 */
let mainPageStreamsData = new Map()
try {
    getMainPageStreams().then((data) => {
        mainPageStreamsData = data
        // timeStamp('Main page data loaded')
    })
} catch (error) {
    timeStamp(error)
}

setInterval(async () => {
    try {
        mainPageStreamsData = await getMainPageStreams()
    } catch (error) {
        timeStamp(error)
    }
}, 60000)

async function getMainPageStreams() {
    let streams = await dbc.db('botSettings').collection('streams').find().toArray()

    const chunkSize = 100,
    chunks = []
    for (let i = 0; i < Math.ceil(streams.length / chunkSize); i++) {
        chunks[i] = streams.slice(i * chunkSize, (i + 1) * chunkSize)
    }

    let map = new Map()
    let fullUserData = [],
        fullChannelData = [],
        fullStreamData = []
    for (let chunk of chunks) {
        // console.log(chunk)
        let idis = chunk.map((a) => a.id)

        let urlUserData = `https://api.twitch.tv/helix/users?id=${idis.join('&id=')}`
        let urlChannelData = `https://api.twitch.tv/helix/channels?broadcaster_id=${idis.join('&broadcaster_id=')}`
        let urlStreamData = `https://api.twitch.tv/helix/streams?user_id=${idis.join('&user_id=')}`

        let headers = {
            Authorization: `Bearer ${process.env.TWITCH_API_AUTH_TOKEN}`,
            'Client-Id': process.env.TWITCH_API_CLIENT_ID,
        }

        let [userData, channelData, streamData] = await Promise.all([
            fetch(urlUserData, { headers }).then((resp) => resp.json()),
            fetch(urlChannelData, { headers }).then((resp) => resp.json()),
            fetch(urlStreamData, { headers }).then((resp) => resp.json()),
        ])

        fullUserData.push(...userData.data)
        fullChannelData.push(...channelData.data)
        fullStreamData.push(...streamData.data)
    }
    fullUserData.forEach((item) => map.set(parseInt(item.id), item))
    streams.forEach((item) => {
        if (map.get(item.id)) {
            map.set(item.id, { ...map.get(item.id), followersCount: item.followersCount })
            let channel = fullChannelData.find((obj) => parseInt(obj['broadcaster_id']) === item.id)
            let unusedZalupa = ['broadcaster_id', 'broadcaster_login', 'broadcaster_name', 'is_branded_content']
            unusedZalupa.forEach((key) => {
                delete channel[key]
            })
            map.set(item.id, { ...map.get(item.id), channelInfo: channel, online: false })
        }
    })

    fullStreamData.forEach((item) =>
        map.set(parseInt(item.user_id), {
            ...map.get(parseInt(item.user_id)),
            online: true,
        })
    )

    return map
}

app.get('/streams/:stream?', async function (req, res) {
    if(req.params.stream){req.params.stream = req.params.stream.toLowerCase()}
    let stream = req.params.stream
    let combinedData = []
    if (stream) {
        for (let [key, value] of mainPageStreamsData.entries()) {
            if (value.login === stream) {
                combinedData.push(Object.assign({}, mainPageStreamsData.get(key)))
                break
            }
        }
        if (combinedData.length == 0) {
            res.status(404).send({
                message: 'not found',
            })
            return
        }
    } else if (req.query.all) {
        combinedData = Array.from(mainPageStreamsData.values())
    } else {
        combinedData = Array.from(mainPageStreamsData.values()).filter((obj) => obj.followersCount >= 100 || obj.online)
    }

    if (combinedData.length == 1) {
        let webSettingsData = await dbc
            .db(combinedData[0].id)
            .collection('botSettings')
            .findOne({ settingName: 'songsWebSettings' })
        combinedData[0].daLink = webSettingsData['settings']['donationLink']
        combinedData[0].socialMedias = webSettingsData['socialMedias']
    }
    res.send(combinedData)
})

app.get('/:stream/songs/top/djs/:period?', async function (req, res) {
    if(req.params.stream){req.params.stream = req.params.stream.toLowerCase()}

    let period = req.params.period || 'alltime'
    let from = 0
    let limit = 50
    if (req.query.limit || req.query.from) {
        req.query.limit = parseInt(req.query.limit)
        req.query.from = parseInt(req.query.from)
        if (
            Number.isInteger(req.query.limit) &&
            Number.isInteger(req.query.from) &&
            req.query.limit >= 0 &&
            req.query.from >= 0
        ) {
            from = req.query.from
            if (req.query.limit <= 200) {
                limit = req.query.limit
            }
        }
    }
    let djsTop = {}
    let aggregationPipeline
    switch (period) {
        default:
            if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                        },
                    },
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            }
            break
        case 'month':
            if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                            },
                        },
                    },
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    {
                        $match: {
                            timeFrom: {
                                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                            },
                        },
                    },
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            }
            break
        case 'week':
            if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                            },
                        },
                    },
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    {
                        $match: {
                            timeFrom: {
                                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                            },
                        },
                    },
                    { $group: { _id: '$requestedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $set: { requestedBy: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            }
            break
    }

    let getStream = await dbc
    .db('botSettings')
    .collection('streams')
    .findOne({ channel: req.params.stream })

    if(!getStream){
        res.status(404).send({
            message: 'not found',
        })
        return
    }

    djsTop = await dbc
        .db(getStream.db)
        .collection('songs')
        .aggregate(aggregationPipeline)
        .toArray()

    if (djsTop.length === 0) {
        djsTop = [
            {
                results: [],
                totalResults: 0,
            },
        ]
    }

    res.send(djsTop)
})

app.get('/:stream/songs/top/:period?', async function (req, res) {
    if(req.params.stream){req.params.stream = req.params.stream.toLowerCase()}

    let period = req.params.period || 'alltime'
    let from = 0
    let limit = 50
    if (req.query.limit || req.query.from) {
        req.query.limit = parseInt(req.query.limit)
        req.query.from = parseInt(req.query.from)
        if (
            Number.isInteger(req.query.limit) &&
            Number.isInteger(req.query.from) &&
            req.query.limit >= 0 &&
            req.query.from >= 0
        ) {
            from = req.query.from
            if (req.query.limit <= 200) {
                limit = req.query.limit
            }
        }
    }
    let songTop = {}
    let aggregationPipeline
    switch (period) {
        default:
            if (req.query.name) {
                aggregationPipeline = [
                    {
                        $match: {
                            mediaName: { $regex: req.query.name, $options: 'i' },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            }
            break
        case 'month':
            if (req.query.name) {
                aggregationPipeline = [
                    {
                        $match: {
                            mediaName: { $regex: req.query.name, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    {
                        $match: {
                            timeFrom: {
                                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            }
            break
        case 'week':
            if (req.query.name) {
                aggregationPipeline = [
                    {
                        $match: {
                            mediaName: { $regex: req.query.name, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else if (req.query.by) {
                aggregationPipeline = [
                    {
                        $match: {
                            requestedBy: { $regex: req.query.by, $options: 'i' },
                            timeFrom: {
                                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 },
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] },
                        },
                    },
                ]
            } else {
                aggregationPipeline = [
                    {
                        $match: {
                            timeFrom: {
                                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$mediaLink',
                            count: { $sum: 1 },
                            mediaName: { $first: '$mediaName' },
                        },
                    },
                    { $sort: { count: -1 } },
                    { $set: { mediaLink: '$_id' } },
                    { $unset: '_id' },
                    {
                        $group: {
                            _id: null,
                            totalResults: { $sum: 1 }, // Count the total results without retrieving all documents
                            results: { $push: '$$ROOT' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            totalResults: 1,
                            results: { $slice: ['$results', from, limit] }, // Apply pagination using from and limit
                        },
                    },
                ]
            }
            break
    }

    let getStream = await dbc
    .db('botSettings')
    .collection('streams')
    .findOne({ channel: req.params.stream })

    if(!getStream){
        res.status(404).send({
            message: 'not found',
        })
        return
    }

    songTop = await dbc
        .db(getStream.db)
        .collection('songs')
        .aggregate(aggregationPipeline)
        .toArray()

    if (songTop.length === 0) {
        songTop = [
            {
                results: [],
                totalResults: 0,
            },
        ]
    }

    res.send(songTop)
})

app.get('/:stream/songs/settings', async function (req, res) {
    if(req.params.stream){req.params.stream = req.params.stream.toLowerCase()}

    let getStream = await dbc
    .db('botSettings')
    .collection('streams')
    .findOne({ channel: req.params.stream })

    if(!getStream){
        res.status(404).send({
            message: 'not found',
        })
        return
    }

    let settings = await dbc
        .db(getStream.db)
        .collection('botSettings')
        .findOne({ settingName: 'songsWebSettings' })
    settings = settings['settings']
    res.send(settings)
})

app.get('/:stream/songs', async function (req, res) {
    if(req.params.stream){req.params.stream = req.params.stream.toLowerCase()}

    let from = 0
    let limit = 50
    if (req.query.limit || req.query.from) {
        req.query.limit = parseInt(req.query.limit)
        req.query.from = parseInt(req.query.from)
        if (
            Number.isInteger(req.query.limit) &&
            Number.isInteger(req.query.from) &&
            req.query.limit >= 0 &&
            req.query.from >= 0
        ) {
            from = req.query.from
            if (req.query.limit <= 200) {
                limit = req.query.limit
            }
        }
    }
    let songHistory

    let getStream = await dbc
    .db('botSettings')
    .collection('streams')
    .findOne({ channel: req.params.stream })

    if(!getStream){
        res.status(404).send({
            message: 'not found',
        })
        return
    }

    if (req.query.by) {
        songHistory = await dbc
            .db(getStream.db)
            .collection('songs')
            .find({ requestedBy: { $regex: req.query.by, $options: 'i' } })
            .sort({ _id: -1 })
            .skip(from)
            .limit(limit)
            .toArray()

        // timeStamp(req.query.by)
        // timeStamp(songHistory)

        songHistory = [
            {
                totalResults: await dbc
                    .db(getStream.db)
                    .collection('songs')
                    .countDocuments({ requestedBy: { $regex: req.query.by, $options: 'i' } }),
                results: songHistory,
            },
        ]
    } else if (req.query.name) {
        songHistory = await dbc
            .db(getStream.db)
            .collection('songs')
            .find({ mediaName: { $regex: req.query.name, $options: 'i' } })
            .sort({ _id: -1 })
            .skip(from)
            .limit(limit)
            .toArray()

        songHistory = [
            {
                totalResults: await dbc
                    .db(getStream.db)
                    .collection('songs')
                    .countDocuments({ mediaName: { $regex: req.query.name, $options: 'i' } }),
                results: songHistory,
            },
        ]
    } else {
        songHistory = await dbc
            .db(getStream.db)
            .collection('songs')
            .find()
            .sort({ _id: -1 })
            .skip(from)
            .limit(limit)
            .toArray()

        songHistory = [
            {
                totalResults: await dbc
                    .db(getStream.db)
                    .collection('songs')
                    .estimatedDocumentCount(),
                results: songHistory,
            },
        ]
    }

    if (songHistory.length === 0) {
        songHistory = [
            {
                results: [],
                totalResults: 0,
            },
        ]
    }

    res.send(songHistory)
})

app.get('/:channel', async function (req, res) {
    if (req.params.channel) {
        res.send(JSON.parse(await redisClient.get(req.params.channel)))
    } else {
        res.send('')
    }
})

app.listen(process.env.PORT, function () {
    timeStamp(`App server listening on port ${process.env.PORT}!`)
})

/**
 * SOCKET BULLSHIT
 */
const io = new Server({
    path: '/api/v1/socket',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
})

redisClientPS.pSubscribe('*', (message, channel) => {
    // timeStamp(channel + ': ' + message)
    io.to(channel).emit('message', { channel, message: message })
})

// Socket.IO server
io.on('connection', (socket) => {
    // timeStamp('Socket.IO client connected')
    // Listen for Redis changes
    socket.on('subscribe', (channel) => {
        // timeStamp(channel)
        socket.join(channel)
    })

    // Stop listening for changes
    socket.on('unsubscribe', (channel) => {
        // timeStamp('Unsubscribed from ' + channel)
        socket.leave(channel)
    })

    // Disconnect event
    socket.on('disconnect', () => {
        // timeStamp('Socket.IO client disconnected')
    })
})
// Start Socket.IO server
const port = process.env.PORT_SOCK // or any desired port number
io.listen(port, () => {
    timeStamp(`Socket.IO server listening on port ${port}`)
})
