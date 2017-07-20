const package = require('./package.json');
const stream = require('stream');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const express = require('express');
const proxy = require('express-http-proxy');
const bodyParser = require('body-parser');
const request = require('request');
const urlUtil = require('url');
const chalk = require('chalk');

function jsonCachingProxy (options, isOutputVisible) {
	let {
		// Get all the options passed to the function
		remoteServerUrl,
		inputHarFile,
		outputHarFile,
		proxyPort,
		middlewareList,
		commandPrefix='proxy',
		proxyHeaderIdentifier='cached-proxy-playback',
		cacheBustingParams=[],
		cacheEverything=false,
		dataPlayback=true,
		dataRecord=true
		} = options;

	let app = express();
	let currentWorkingDir = process.cwd();
	let server, printLog, printError;

	let excludedParamMap = cacheBustingParams.reduce((map, param) => { map[param] = true; return map }, {});
	let routeCache = {};

	if (isOutputVisible) {
		printLog = console.log;
		printError = console.error;
	} else {
		printLog = () => false;
		printError = () => false;
	}

	function convertToNameValueList (obj) {
		return typeof obj === 'object' ? Object.keys(obj).map(key => { return { name: key, value: obj[key] }; }) : [];
	}

	function genKeyFromHarReq (harEntryReq, excludedParamMap) {
		let { method, url, queryString=[], postData={text: ''} } = harEntryReq;
		let uri = urlUtil.parse(url).pathname;
		let postParams = postData.text;

		queryString = queryString.filter(param => !excludedParamMap[param.name]);

		let plainText = `${method} ${uri} ${JSON.stringify(queryString)} ${postParams}`;
		let hash = crypto.createHash('md5').update(plainText).digest("hex");
		let key = `${method} ${uri} ${hash}`;

		return {key, hash};
	}

	function genKeyFromExpressReq (req, excludedParamMap) {
		let queryString = convertToNameValueList(req.query);
		return genKeyFromHarReq({
			method: req.method,
			url: req.url,
			queryString: queryString,
			postData: { text: req.body.length > 0 ? req.body.toString('utf8') : '' }
		}, excludedParamMap);
	}

	// Create a HAR from a proxied express request and response
	function createHarEntry (startedDateTime, req, res, data) {
		let reqMimeType = req.get('Content-Type');
		let resMimeType = res.get('Content-Type') || 'text/plain';
		let encoding = (/^text\/|^application\/(javascript|json)/).test(resMimeType) ? 'utf8' : 'base64';

		let entry = {
			request: {
				startedDateTime: startedDateTime,
				method: req.method.toUpperCase(),
				url: req.url,
				cookies: convertToNameValueList(req.cookies),
				headers: convertToNameValueList(req.headers),
				queryString: convertToNameValueList(req.query),
				headersSize: -1,
				bodySize: -1
			},
			response: {
				status: res.statusCode,
				statusText: res.statusMessage,
				cookies: convertToNameValueList(res.cookies),
				headers: convertToNameValueList(res._headers).filter(header => header.name.toLowerCase() !== 'content-encoding'), // Not  compressed
				content: {
					size: -1,
					mimeType: resMimeType,
					text: data.toString(encoding),
					encoding: encoding
				},
				headersSize: -1,
				bodySize: -1
			}
		};

		if (req.postData && req.postData.length > 0) {
			entry.request.postData = {
				mimeType: reqMimeType,
				text: req.postData.toString(encoding)
			}
		}

		return entry;
	}

	// These are not really restful because the GET is changing state. But it's easier to use in a browser
	app.get(`/${commandPrefix}/playback`, function (req, res) {
		dataPlayback = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : dataPlayback;
		printLog(chalk.blue(`Replay from cache: ${dataPlayback}`));
		res.send(`Replay from cache: ${dataPlayback}`);
	});

	app.get(`/${commandPrefix}/record`, function (req, res) {
		dataRecord = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : dataRecord;
		printLog(chalk.blue('Saving to cache: ' + dataRecord));
		res.send(`Saving to cache: ${dataRecord}`);
	});

	app.get(`/${commandPrefix}/clear`, function (req, res) {
		routeCache = {};
		printLog(chalk.blue('Cleared cache'));
		res.send('Cleared cache');
	});

	app.get(`/${commandPrefix}/har`, function (req, res) {
		printLog(chalk.blue('Generating har file'));

		let har = {
			log: {
				version: "1.2",
				creator: {
					name: package.name,
					version: package.version
				},
				entries: []
			}
		};

		Object.keys(routeCache).forEach(key => har.log.entries.push(routeCache[key]));

		res.json(har);
	});

	// User supplied middleware to handle special cases (browser-sync middleware options)
	if (middlewareList && middlewareList.length > 0) {
		middlewareList.forEach((mw) => {
			if (mw.route) {
				app.use(mw.route, mw.handle);
			} else {
				app.use(mw.handle);
			}
		});
	}

	if (inputHarFile) {
		let harObject = JSON.parse(fs.readFileSync(inputHarFile, "utf8"));
		harObject.log.entries.forEach(function (entry) {
			let {key, hash} = genKeyFromHarReq(entry.request, excludedParamMap);

			// Only cache things that have content. Some times HAR files generated elsewhere will be missing this parameter
			if (entry.response.content.text) {
				let mimeType = entry.response.content.mimeType;

				if (entry.response.headers && (cacheEverything || !cacheEverything && mimeType && mimeType.indexOf('application/json') >= 0)) {
					// Remove content-encoding. gzip compression won't be used
					entry.response.headers = convertToNameValueList(entry.response.headers).filter(header => header.name.toLowerCase() !== 'content-encoding');
					routeCache[key] = entry;
					printLog(chalk.yellow('Saved to Cache', hash, chalk.bold(entry.request.url)));
				}
			}
		});
	}

	app.use(bodyParser.raw({type: '*/*'}));

	// Read from the cache if possible for any routes not being handled by previous middleware
	app.use('/', function (req, res, next) {
		if (!dataPlayback) {
			next();
		} else {
			let {key, hash} = genKeyFromExpressReq(req, excludedParamMap);
			let entry = routeCache[key];

			if (!(entry && entry.response && entry.response.content)) {
				next();
			} else {
				let response = entry.response;
				let headerList = response.headers || [];
				let text = response.content.text || '';
				let encoding = response.content.encoding || 'utf8';

				headerList.forEach(function (header) {
					res.set(header.name, header.value);
				});

				// TODO: Handle redirects properly
				if (text.length === 0) {
					res.sendStatus(response.status);
				} else {
					if (encoding === 'base64') {
						let bin = new Buffer(text, 'base64');
						res.writeHead(response.status, {
							'Content-Type': response.content.mimeType,
							'Content-Length': bin.length
						});
						res.end(bin);
					} else {
						res.status(response.status);
						res.type(response.content.mimeType);
						res.send(text);
					}
				}

				printLog(chalk.green('Reading From Cache', hash, chalk.bold(entry.request.url)));
			}

		}
	});

	// Handle the proxy response by writing the response to cache if possible and altering location redirects if needed
	app.use('/', proxy(remoteServerUrl, {
		userResDecorator: function (rsp, rspData, req, res) {
			if (!dataRecord) {
				printLog(chalk.gray('Proxied Resource', req.path));
			} else {

				let location = res.get('location');
				if (location) {
					// Handle Redirects
					res.location(urlUtil.parse(location).path);
				}

				let mimeType = res._headers['content-type'];

				if (cacheEverything || !cacheEverything && mimeType && mimeType.indexOf('application/json') >= 0) {
					let {key, hash} = genKeyFromExpressReq(req, excludedParamMap);
					let entry = createHarEntry(new Date().toISOString(), req, res, rspData);
					routeCache[key] = entry;
					printLog(chalk.yellow('Saved to Cache', hash, chalk.bold(entry.request.url)));
				} else {
					printLog(chalk.gray('Proxied Resource', req.path));
				}
			}

			return rspData;
		}
	}));

	return {
		start: function () {
			server = app.listen(proxyPort);
			printLog(chalk.bold(`\nStarting Proxy Server:`));
			printLog(chalk.gray(`======================\n`));

			printLog(`Remote Server URL: ${chalk.bold(remoteServerUrl)}`);
			printLog(`Proxy running on port: ${chalk.bold(proxyPort)}`);

			inputHarFile && printLog(`HAR input: ${chalk.bold(path.join(currentWorkingDir, inputHarFile))}`);
			outputHarFile && printLog(`HAR output: ${chalk.bold(path.join(currentWorkingDir, outputHarFile))}`);

			printLog(`Replay cache: ${chalk.bold(dataPlayback)}`);
			printLog(`Save to cache: ${chalk.bold(dataRecord)}`);
			printLog(`Command prefix: ${chalk.bold(commandPrefix)}`);
			printLog(`Proxy response header: ${chalk.bold(proxyHeaderIdentifier)}`);
			printLog(`Try to cache all responses: ${chalk.bold(cacheEverything)}`);

			cacheBustingParams.length > 0 && printLog(`Ignoring query parameters: ${chalk.bold(cacheBustingParams)}`);

			printLog('\n');

			return app;
		},

		stop: function () {
			if (server) {
				server.close();
				printLog(chalk.bold('\nStopping Proxy Server'));
			}
		},

		getServer: function () {
			return server;
		},

		getExpressApp: function () {
			return app;
		},

		isReplaying: function () {
			return dataPlayback
		},

		isRecording: function () {
			return dataRecord;
		}
	}
}

module.exports = jsonCachingProxy;



