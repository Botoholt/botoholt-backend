import { timeStamp } from '../../modules/tools.js'
import 'dotenv/config'

let repeats = {}

async function custom(client, channel, tags, message, commandInfo) {
    // console.log(commandInfo)
    answerProcessor({
        channel: channel,
        userName: tags.get('display-name'),
        answers: commandInfo['answers'],
    }).then((answer) => {
        client.say(channel, answer)
    })
}

async function answerProcessor({ channel, answers, userName } = {}) {
    let chars = {
        _userName: userName,
        _bholtLink: `${process.env.BHOLT_BASE}/${channel}/`,
    }

    let random = Math.floor(Math.random() * answers.length)
    let answer = answers[random]
    // timeStamp(chars)
    answer = answer.replace(/_userName|_bholtLink/gi, (x) => chars[x])
    return answer
}

export { custom }
