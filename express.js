const http = require('http');
const path = require('path');
const objectId = require('mongodb').ObjectId;
const express = require('express');
const doT = require('express-dot');
const subdomain = require('express-subdomain');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const request = require('async-request');
const log = require('npmlog');
const session = require('client-sessions');
const database = require('./database.js');
const constants = require('./constants.js');
const expressFunctions = require('./express-functions.js');
const songs = require('./songs.js');
const cache = require('./cache.js');
const twitch = require('./twitch.js');

const app = express();
const router = new express.Router();
const server = http.createServer(app);
const port = process.env.PORT ? process.env.PORT : 3000;
let dbConstants;

async function start() {
	dbConstants = await database.constants();
	setupApp();
	await setupRoutes();
	server.listen(port, () => {
		log.info('Web server running on port ' + port);
	});
}

function setupApp() {
	app.set('views', path.join(__dirname, '/views'));
	app.set('view engine', 'dot');
	app.engine('html', doT.__express);
	app.use(subdomain('docs', router));
	app.use('/css', express.static(path.join(__dirname, '/public/css')));
	app.use('/img', express.static(path.join(__dirname, '/public/img')));
	app.use('/js', express.static(path.join(__dirname, '/public/js')));
	app.use('/favicon.ico', express.static('public/img/favicon.ico'));
	app.use(cookieParser());
	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({extended: true}));
	app.use(session({
		cookieName: 'session',
		secret: dbConstants.sessionKey,
		duration: 600 * 60 * 1000,
		activeDuration: 5 * 60 * 1000
	}));
}

async function setupRoutes() {
	app.get('/', [expressFunctions.wwwRedirect, expressFunctions.checkUserLoginStatus], async (req, res) => {
		let templateData;
		const nav = await expressFunctions.includeFile('./views/nav.html', null, null);
		if (constants.testMode) {
			templateData = {title: 'SkedogBot', apiKey: dbConstants.twitchTestClientID, postURL: constants.testPostURL, nav, leftbar: ''};
		} else {
			templateData = {title: 'SkedogBot', apiKey: dbConstants.twitchClientID, postURL: constants.postURL, nav, leftbar: ''};
		}
		res.render('index.html', templateData);
	});

	app.get('/login', async (req, res) => {
		let templateData;
		const nav = await expressFunctions.includeFile('./views/nav.html', null, null);
		if (constants.testMode) {
			templateData = {title: 'Logging in...', apiKey: dbConstants.twitchTestClientID, postURL: constants.testPostURL, nav, leftbar: ''};
		} else {
			templateData = {title: 'Logging in...', apiKey: dbConstants.twitchClientID, postURL: constants.postURL, nav, leftbar: ''};
		}
		res.render('login.html', templateData);
	});

	app.get('/logout', (req, res) => {
		req.session.reset();
		res.render('logout.html', {title: 'Logging out...'});
	});

	const pages = ['dashboard', 'mobile', 'song-settings', 'contact'];

	for (const page in pages) {
		if (Object.prototype.hasOwnProperty.call(pages, page)) {
			app.get('/' + pages[page], [expressFunctions.checkUserLoginStatus]);
		}
	}

	const pagesThatTakeChannels = ['commands', 'songs', 'blacklist', 'chatlog', 'songcache', 'player'];

	for (const page in pagesThatTakeChannels) {
		if (Object.prototype.hasOwnProperty.call(pagesThatTakeChannels, page)) {
			app.get('/' + pagesThatTakeChannels[page] + '/:channel*?', [expressFunctions.checkUserLoginStatus]);
		}
	}

	app.get('/moderation/:channel*?', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			const includes = await getIncludes(req);
			res.render('moderation.html', {nav: includes[0], leftbar: includes[1]});
		} else {
			res.redirect('/dashboard');
		}
	}, (req, res) => {
		res.redirect('/logout');
	});

	app.get('/currentsonginfo/:channel*?', (req, res) => {
		res.render('currentsonginfo.html', {showText: req.query.showText, layout: false});
	});

	app.post('/getsonglist', async (req, res) => {
		const cachedSonglist = await cache.get(req.body.channel + 'songlist');
		if (cachedSonglist === undefined) {
			const propsForSelect = {
				table: 'songs',
				query: {channel: req.body.channel}
			};
			const results = await database.select(propsForSelect);
			await cache.set(req.body.channel + 'songlist', results);
			res.send(results);
		} else {
			res.send(cachedSonglist);
		}
	});

	app.post('/getblacklist', async (req, res) => {
		const cachedBlacklist = await cache.get(req.body.channel + 'blacklist');
		if (cachedBlacklist === undefined) {
			const propsForSelect = {
				table: 'songblacklist',
				query: {channel: req.body.channel}
			};
			const results = await database.select(propsForSelect);
			await cache.set(req.body.channel + 'blacklist', results);
			res.send(results);
		} else {
			res.send(cachedBlacklist);
		}
	});

	app.post('/getsongcache', async (req, res) => {
		const cachedCache = await cache.get(req.body.channel + 'songcache');
		if (cachedCache === undefined) {
			const propsForSelect = {
				table: 'songcache',
				query: {channel: req.body.channel}
			};
			const results = await database.select(propsForSelect);
			await cache.set(req.body.channel + 'songcache', results);
			res.send(results);
		} else {
			res.send(cachedCache);
		}
	});

	app.post('/getchatlogs', async (req, res) => {
		const propsForSelect = {
			table: 'chatlog',
			query: {
				channel: req.body.channel,
				timestamp: {
					$gte: (req.body.timestampStart * 1000),
					$lte: (req.body.timestampEnd * 1000)
				}
			}
		};
		const results = await database.select(propsForSelect);
		await cache.set(req.body.channel + 'chatlog' + req.body.timestampStart + req.body.timestampEnd, results);
		res.send(results);
	});

	app.post('/getmusicstatus', async (req, res) => {
		const results = await expressFunctions.getChannelInfo(req);
		if (results) {
			res.send(results);
		}
	});

	app.post('/getvolume', async (req, res) => {
		const results = await expressFunctions.getChannelInfo(req);
		if (results) {
			res.send(results);
		}
	});

	app.post('/getnotifications', async (req, res) => {
		const propsForSelect = {
			table: 'notifications'
		};
		const results = await database.select(propsForSelect);
		if (results) {
			res.send(results);
		}
		res.send('');
	});

	app.post('/removenotification', async (req, res) => {
		const dataToUse = {};
		const propsForSelect = {
			table: 'notifications',
			query: {_id: objectId(req.body.id)}
		};
		const results = await database.select(propsForSelect);
		if (results) {
			const originalExclusionList = results[0].exclusionList;
			originalExclusionList.push(req.body.channel);
			dataToUse.exclusionList = originalExclusionList;
			propsForSelect.dataToUse = dataToUse;
			await database.update(propsForSelect);
			res.send('removed');
		}
	});

	app.post('/getsettings', async (req, res) => {
		const results = await expressFunctions.getChannelInfo(req);
		if (results) {
			res.send(results);
		}
	});

	app.post('/checkifinchannel', async (req, res) => {
		const results = await expressFunctions.getChannelInfo(req);
		if (results) {
			res.send(results[0].inChannel);
		} else {
			res.send(false);
		}
	});

	app.post('/dashboardstats', async (req, res) => {
		const cachedStats = await cache.get(req.body.channel + 'stats');
		if (cachedStats === undefined) {
			try {
				let propsForCount;
				propsForCount = {
					table: 'songs',
					query: {channel: req.body.channel}
				};
				const numberOfSongs = await database.count(propsForCount);

				const propsForSelect = {
					table: 'chatmessages',
					query: {channel: req.body.channel}
				};
				const numberOfChatMessages = await database.select(propsForSelect);

				propsForCount = {
					table: 'commands',
					query: {channel: req.body.channel}
				};
				const numberOfCommands = await database.count(propsForCount);

				propsForCount = {
					table: 'chatusers',
					query: {channel: req.body.channel}
				};
				const numberOfChatUsers = await database.count(propsForCount);
				await cache.set(req.body.channel + 'stats', [numberOfSongs, numberOfChatMessages[0].counter, numberOfCommands, numberOfChatUsers], 300);
				res.send([numberOfSongs, numberOfChatMessages[0].counter, numberOfCommands, numberOfChatUsers]);
			} catch (err) {
				res.send('no stats');
			}
		} else {
			res.send(cachedStats);
		}
	});

	app.post('/topchatters', async (req, res) => {
		const cachedChatters = await cache.get(req.body.channel + 'chatters');
		if (cachedChatters === undefined) {
			const propsForSelect = {
				table: 'chatusers',
				query: {channel: req.body.channel, userName: {$ne: 'skedogbot'}},
				sortBy: {numberOfChatMessages: -1},
				limit: 5
			};
			const topChatters = await database.select(propsForSelect);
			await cache.set(req.body.channel + 'chatters', topChatters, 300);
			res.send(topChatters);
		} else {
			res.send(cachedChatters);
		}
	});

	app.post('/updatemusicstatus', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			const fakeUserstate = [];
			fakeUserstate['display-name'] = 'skippedfromweb';
			if (req.body.musicStatus === 'play') {
				const propsForPlay = {
					channel: req.body.channel,
					userstate: fakeUserstate,
					messageParams: ['!play']
				};
				await songs.play(propsForPlay);
				res.send('');
			} else if (req.body.musicStatus === 'pause') {
				const propsForPause = {
					channel: req.body.channel,
					userstate: fakeUserstate,
					messageParams: ['!pause']
				};
				await songs.pause(propsForPause);
				res.send('');
			}
		} else {
			res.send('error');
		}
	});

	app.post('/updatesettings', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			const dataToUse = {};
			dataToUse.duplicateSongDelay = parseInt(req.body.duplicateSongDelay, 10);
			dataToUse.songNumberLimit = parseInt(req.body.songNumberLimit, 10);
			dataToUse.maxSongLength = parseInt(req.body.maxSongLength, 10);
			dataToUse.ChannelCountry = req.body.channelCountry;
			const propsForUpdate = {
				table: 'channels',
				query: {ChannelName: req.body.channel},
				dataToUse
			};
			await database.update(propsForUpdate);
			res.send('updated');
		} else {
			res.send('error');
		}
	});

	app.post('/joinchannel', async (req, res) => {
		await twitch.joinSingleChannel(req.body.channel);
		res.send('joined');
	});

	app.post('/partchannel', async (req, res) => {
		await twitch.leaveSingleChannel(req.body.channel);
		res.send('parted');
	});

	app.post('/promotesong', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			let channel;
			if (req.params.channel) {
				if (req.body.loggedInChannel.includes('#')) {
					channel = req.body.loggedInChannel;
				} else {
					channel = '#' + req.body.loggedInChannel;
				}
			} else if (req.body.channel.includes('#')) {
				channel = req.body.channel;
			} else {
				channel = '#' + req.body.channel;
			}
			const messageParams = ['', req.body.songToPromote];
			const fakeUserstate = [];
			fakeUserstate['display-name'] = 'skippedfromweb';
			const propsForPromote = {
				channel,
				messageParams,
				userstate: fakeUserstate
			};
			await songs.promote(propsForPromote);
			res.send('song promoted');
		} else {
			res.send('error');
		}
	});

	app.post('/removesong', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			let channel;
			if (req.params.channel) {
				if (req.params.channel.includes('#')) {
					channel = req.params.channel;
				} else {
					channel = '#' + req.params.channel;
				}
			} else if (req.body.channel.includes('#')) {
				channel = req.body.channel;
			} else {
				channel = '#' + req.body.channel;
			}
			const messageParams = ['', req.body.songToRemove];
			const fakeUserstate = [];
			fakeUserstate['display-name'] = 'skippedfromweb';
			const propsForRemove = {
				channel,
				messageParams,
				userstate: fakeUserstate
			};
			await songs.remove(propsForRemove);
			res.send('song removed');
		} else {
			res.send('error');
		}
	});

	app.post('/updatevolume', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			const messageParams = ['', req.body.volume];
			const fakeUserstate = [];
			fakeUserstate['display-name'] = 'skippedfromweb';
			const propsForVolumeUpdate = {
				channel: req.body.channel,
				messageParams,
				userstate: fakeUserstate
			};
			await songs.updateVolume(propsForVolumeUpdate);
			res.send('');
		} else {
			res.send('error');
		}
	});

	app.post('/handlelogin', async (req, res) => {
		// This whole post request is for handling initial logins
		const token = req.body.token;
		req.session.token = token;
		const getUserDetails = await request('https://api.twitch.tv/kraken/user/?oauth_token=' + token);
		const body = JSON.parse(getUserDetails.body);
		const props = {
			userEmail: body.email,
			twitchUserID: body._id,
			userLogo: body.logo,
			ChannelName: body.name,
			token
		};
		const userDetails = props.userEmail + ',' + props.userLogo + ',#' + props.ChannelName + ',' + props.twitchUserID;
		// Set the userDetails as a cookie
		req.session.userDetails = userDetails;
		const returnVal = await expressFunctions.handleLogin(props);
		res.send(returnVal);
	});

	app.post('/getcommands', async (req, res) => {
		const propsForSelect = {
			table: 'commands',
			query: {channel: req.body.channel}
		};
		const results = await database.select(propsForSelect);
		res.send(results);
	});

	app.post('/loadnextsong', async (req, res) => {
		const results = await expressFunctions.checkModStatus(req);
		if (results) {
			const fakeUserstate = [];
			fakeUserstate['display-name'] = 'skippedfromweb';
			const propsForSkip = {
				channel: req.body.channel,
				userstate: fakeUserstate,
				messageParams: ['!skipsong']
			};
			await songs.skip(propsForSkip);
			const propsForSelect = {
				table: 'songs',
				query: {channel: req.body.channel}
			};
			const songResults = await database.select(propsForSelect);
			if (songResults) {
				res.send(songResults[0].songID);
			}
		}
	});

	app.use(async (req, res) => {
		const err = new Error('Not Found');
		err.status = 404;
		res.status(err.status || 500);
		log.error(err.status + ' ' + err + ' ' + req.originalUrl);
		const includes = await getIncludes(req);
		res.render('error.html', {
			message: err.message,
			status: err.status,
			error: {},
			nav: includes[0],
			leftbar: includes[1]
		});
	});

	// Documentation routes
	router.get('/', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('getting-started.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/default-commands', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('default-commands.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/privacy-policy', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('privacy.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/default-commands/8ball', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('default-commands/8ball.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/default-commands/bf4stats', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('default-commands/bf4stats.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/default-commands/blacklist', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('default-commands/blacklist.html', {leftbar: includes[2], nav: ''});
	});

	router.get('/default-commands/commands', async (req, res) => {
		const includes = await getIncludes(req);
		res.render('default-commands/commands.html', {leftbar: includes[2], nav: ''});
	});
}

async function getIncludes(req) {
	let userDetails = null;
	let passedChannel = null;
	let nav;
	let leftbar;
	let docnav;
	if (req.session) {
		if (req.session.userDetails) {
			// User is logged in, but got an error page
			userDetails = req.session.userDetails.split(',');
		}
	}
	if (req.params.channel) {
		passedChannel = req.params.channel;
	} else if (userDetails) {
		passedChannel = userDetails[2].slice(1);
	}
	if (userDetails) {
		nav = await expressFunctions.includeFile('./views/loggedinnav.html', userDetails, passedChannel);
		leftbar = await expressFunctions.includeFile('./views/leftbar.html', userDetails, passedChannel);
		docnav = await expressFunctions.includeFile('./views/docnav.html', userDetails, passedChannel);
	} else {
		nav = await expressFunctions.includeFile('./views/nav.html', null, null);
		leftbar = '';
		docnav = await expressFunctions.includeFile('./views/docnav.html', null, null);
	}
	return [nav, leftbar, docnav];
}

module.exports.server = server;
module.exports.start = start;
