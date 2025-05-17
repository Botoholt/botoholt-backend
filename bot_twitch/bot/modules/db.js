import { MongoClient } from 'mongodb'
import { createClient } from 'redis'
import 'dotenv/config'

const mongourl = process.env.MONGO_URL
const redisurl = process.env.REDIS_URL

const client = await new MongoClient(mongourl).connect()
const redisClient = createClient({ url: redisurl })
await redisClient.connect()
const redisClientPS = createClient({ url: redisurl })
await redisClientPS.connect()
// await new rClient().open(redisurl)

export { client, redisClient, redisClientPS }
