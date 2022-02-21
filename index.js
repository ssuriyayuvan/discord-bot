require('dotenv').config();
const { Client, Intents } = require('discord.js');
const _ = require('lodash');
const bot = new Client({ partials: ["CHANNEL"], intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.DIRECT_MESSAGES] });
const { google } = require('googleapis');
const keys = require('./key.json');
const redis = require('./redis');
const PREFIX = "!join-";
redis.connect();

// googleapi auth
// allow to access google spreadsheets

const client = new google.auth.JWT(
    keys.client_email, null, keys.private_key, ["https://www.googleapis.com/auth/spreadsheets"]
);

// spreadsheet connection
client.authorize((err, token) => {
    if (err) {
        return;
    } else {
        console.log('connected');
        // gsrun(client)
    }
})

// discord bot login with token
bot.login(process.env.BOT_TOKEN);

// noifiy after successfull login
bot.on('ready', () => {
    console.log(`Logged in as ${bot.user.username}!`);
});

// whenever the message typed on server it will catch that message
bot.on("messageCreate", async (message) => {

    // check for DM message
    if (message.channel.type === 'DM') {
        // if DM reply was our bot
        if (message.author.bot == true) return;
        // mail updating process
        findAndUpdateByMail(client, message.content, message)
    } else {
        // check !join prefix and DM to the user
        if (message.content.startsWith(PREFIX)) {
            channelSearch(client, message.content.substring(PREFIX.length), message)
        }
    }
})

/**
 * 
 * @param {Google client} cl 
 * @param {clan name of user entered} clan_name 
 * @param {bot message instance} message 
 */

async function channelSearch(cl, clan_name, message) {
    try {
    const channelSheet = google.sheets({ version: 'v4', auth: cl });
    let opts = {
        spreadsheetId: process.env.SPREAD_SHEET_ID,
        range: 'clan',
    };

    let { data: { values } } = await channelSheet.spreadsheets.values.get(opts);
    let data = restructuring(values)
    let searchedValue = searchValue(data, clan_name, 'Clan');
    // if clan was found on spread sheet
    if (!_.isEmpty(searchedValue)) {
        let isEnabled = (searchedValue['Enabled/Disabled']);
        if (isEnabled === 'YES') {
            // add enterd clan name into redis to find out after successfull email verification
            await redis.set(`${message.author.id}`, clan_name);
            message.channel.send(`${message.author} ,Please check your DM to verify your ID?`);
            message.author.send(`Please provide your emaild id?`);
        } else {
            // adminssion closed message
            message.channel.send(`${message.author} Sorry admission has been closed..!`);
            console.log(`${message.author} Sorry admission has been closed..!`)
        }
    } else {
        // if clan not found on the sheet
        message.channel.send(`${message.author} Clan not found`);
    }
    } catch (error) {
        console.log('channelSearch: ',error.message, error.stack)
    }
    
}

/**
 * 
 * @param {Google client} cl 
 * @param {user enterd DM email} email 
 * @param {bot message instance} message 
 */
async function findAndUpdateByMail(cl, email, message) {
    try {
        
        // get registerd clan in bot channel
        let clan_name = await redis.get(`${message.author.id}`);

        if (!_.isEmpty(clan_name)) {
            const channelSheet = google.sheets({ version: 'v4', auth: cl });
            let opts = {
                spreadsheetId: process.env.SPREAD_SHEET_ID,
                range: 'clan',
            }

            // search clan in spreed sheet where user registerd on bot channel
            let { data: { values } } = await channelSheet.spreadsheets.values.get(opts);
            let data = restructuring(values); // restruturing spread sheet data
            console.log(' *************** Clan search finished ***************');

            // search registerd clan in restructed data
            let searchedValue = searchValue(data, clan_name, 'Clan');

            // search mail id in spread sheet
            const mailSheet = google.sheets({ version: 'v4', auth: cl });
            let { data: { values: mailData } } = await mailSheet.spreadsheets.values.get({
                spreadsheetId: searchedValue['Sheet Id'],
                range: 'joined'
            });

            let mailrestructingData = restructuring(mailData);
            console.log(' *************** Mail search finished ***************');

            let isuserExists = searchValue(mailrestructingData, email, 'email');
            // check if email id exists or not.
            if (isuserExists) {
                let { data: { values: mailValue } } = await mailSheet.spreadsheets.values.update({
                    spreadsheetId: searchedValue['Sheet Id'],
                    range: `joined!B${isuserExists.index}:C`,
                    valueInputOption: "USER_ENTERED",
                    resource: {
                        values: [[searchedValue['ChannelID'], searchedValue['Role Id']]],
                    },
                });
                await redis.del(`${message.author.id}`);
                console.log(' *************** Mail update finished ***************');

                message.channel.send('Please give me a minute I am checking out your details');
                message.channel.send(`Welcome to the clan. Now you can move to ${clan_name} and start discussion here`);
                bot.channels.cache.get(process.env.PRIVATE_CHANNEL_ID).send(`Welcome to the clan ${message.author}`);

                // add user to private channel --> pending
                /*
                let role = message.guild.roles.cache.find(r => r.name === "admin");
                let member = message.member;
                member.roles.add(role).catch(console.error);
                message.channels.cache.get('944945541819797555').send(`Text`);
                */
            } else {
                // email not found
                message.channel.send('Sorry this email is not registered with us. please enter a valid email address with which you registered! Type the command again in bot channel to start verification process again.')
            }
        } else {
            // remove from redis to register agin
            await redis.del(`${message.author.id}`);
            // if clan name was not found then allow him to register again
            message.channel.send('Type the command in bot channel to start verification process');
        }
    } catch (error) {
        console.log('findAndUpdateByMail :', error.message, error.stack)
    }

}

// find the clan name and email in array of objects
function searchValue(data, value, key) {
    return data.find((ele, i) => {
        if (ele[key] === value) {
            ele.index = i + 2;
            return ele
        }
    });
}

// formatting two array of data into array of objects
function restructuring(arrayData) {
    let formattedArray = []
    let header = arrayData[0];
    for (let i = 1; i < arrayData.length; i++) {
        let arr = arrayData[i]
        let key = {}
        for (let j = 0; j < arr.length; j++) {
            key[header[j]] = arrayData[i][j]
        }
        formattedArray.push(key)
    }
    return formattedArray
}