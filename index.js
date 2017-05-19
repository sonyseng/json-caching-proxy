const fs = require('fs');
const rimraf = require('rimraf');
const path = require('path');
const mkdirp = require('mkdirp');
const express = require('express');
const bodyParser = require('body-parser');
const proxy = require('express-http-proxy');
const request = require('request');
const urlUtil = require('url');
const chalk = require('chalk');

// TODO: Write HAR File

function jsonCachingProxy (options, isOutputVisible) {
	let {
		// Get all the options passed to the function
		remoteServerUrl,
		proxyPort,
		cacheDataDirectory,
		middlewareList,
		commandPrefix='proxy',
		proxyHeaderIdentifier = 'json-cached-proxy-playback',
		harFilePath,
		cacheBustingParam,

		dataPlayback = true,
		dataRecord = true
		} = options;

	let app = express();
	let currentWorkingDir = process.cwd();
	let server, printLog, printError;

	let routeCache = {};

	if (isOutputVisible) {
		printLog = console.log;
		printError = console.error;
	} else {
		printLog = () => false;
		printError = () => false;
	}

	function genKeyFromHarReq (harEntryReq, cacheBustingParam) {
		let { method, url, queryString=[], postData={} } = harEntryReq;
		let uri = urlUtil.parse(url).pathname;
		let postParams = postData.text;

		if (cacheBustingParam) {
			queryString = queryString.filter(param => param.name !== cacheBustingParam);
		}
		return `${method} ${uri} ${JSON.stringify(queryString)} ${postParams}`;
	}

	function genKeyFromExpressReq (req, cacheBustingParam) {
		let queryString = Object.keys(req.query).map(key => {
			return { name: key, value: req.query[key] }
		});

		return genKeyFromHarReq({
			method: req.method,
			url: req.url,
			queryString: queryString,
			postData: { text: req.body && req.body.length > 0 ? req.body : '' }
		}, cacheBustingParam);
	}

	// Create a HAR from a proxied express request and response
	function createHarEntry (startedDateTime, req, res, data) {
		let reqMimeType = req.get('Content-Type');
		let resMimeType = res.get('Content-Type') || 'text/plain';
		let encoding = (/^text\/|^application\/(javascript|json)/).test(resMimeType) ? 'utf8' : 'base64';
		let convertToNameValueList = (obj) => typeof obj === 'object' ? Object.keys(obj).map(key => { return { name: key, value: obj[key] }; }) : [];

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
				headers: convertToNameValueList(res._headers),
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

		if (req.body && req.body.length > 0) {
			entry.request.postData = {
				mimeType: reqMimeType,
				text: req.body
			}
		}

		return entry;
	}
	//
	//function persistResponseData (directory, fileName, responseStr) {
	//	let responseFilePath = path.join(directory, fileName);
	//
	//	printLog(chalk.yellow('Saving to File Cache', chalk.bold(responseFilePath)));
	//
	//	mkdirp(directory, function (err) {
	//		if (err) {
	//			printError(chalk.red(err));
	//		} else {
	//			fs.writeFile(responseFilePath, responseStr, function (err) {
	//				if (err) {
	//					printError(chalk.red(err));
	//					return;
	//				}
	//			});
	//		}
	//	});
	//}
	//
	//function readResponseData (directory, callback) {
	//	let responseFilePath = path.join(directory, responseFileName);
	//
	//	printLog(chalk.green('Reading From Cache', chalk.bold(responseFilePath)));
	//
	//	fs.readFile(responseFilePath, 'utf-8', function read (err, responseData) {
	//		if (!err) {
	//			callback && callback(responseData);
	//		}
	//	});
	//}

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

		//rimraf(path.join(currentWorkingDir, cacheDataDirectory), function () {});
	});

	//app.use(bodyParser.json());
	//app.use(bodyParser.urlencoded({ extended: true }));
	app.use(bodyParser.text({ type: '*/*' }));

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

	// TODO: Load har {harFilePath} JSON into the har object
	//let har = {};
	//har.log.entries.forEach(function (entry) {
	//	cache[genKeyFromHarReq(entry.request, cacheBustingParam)] = entry;
	//});

	// Read from the cache if possible for any routes not being handled by previous middleware
	app.use('/', function readFromRouteCache (req, res, next) {
		if (dataPlayback) {
			let key = genKeyFromExpressReq(req, cacheBustingParam);
			let entry = routeCache[key];

			if (entry && entry.response && entry.response.content && entry.response.content.text) {
				let response = entry.response;
				let headerList = response.headers || [];

				headerList.forEach(function (header) {
					res.set(header.name, header.value);
				});

				if (response.content.encoding === 'base64') {
					let bin = new Buffer(response.content.text, 'base64');

					// TODO: Handle redirects properly
					res.writeHead(response.status, {
						'Content-Type': response.content.mimeType,
						'Content-Length': bin.length
					});

					res.end(bin);
				} else {
					// TODO: Handle redirects properly
					res.status(response.status);
					res.type(response.content.mimeType);
					res.send(response.content.text);
				}

				printLog(chalk.green('Reading From Cache', chalk.bold(entry.request.url)));
			} else {
				printLog(chalk.gray('Proxied Resource', req.path));
				next();
			}
		} else {
			printLog(chalk.gray('Cache Disabled - Proxied Resource', req.path));
			next();
		}
	});

	// Handle the proxied response by writing the response to cache if possible and altering location redirects if needed
	app.use('/', proxy(remoteServerUrl, {
		userResDecorator: function (rsp, rspData, req, res) {
			if (dataRecord) {
				// TODO: pass cache busting argument to ignore in this method

				// Handle Redirects
				let location = res.get('location');
				if (location) {
					res.location(urlUtil.parse(location).path);
				}

				let key = genKeyFromExpressReq(req, cacheBustingParam);
				let entry = createHarEntry(new Date().toISOString(), req, res, rspData);

				routeCache[key] = entry;
				printLog(chalk.yellow('Saved to Cache', chalk.bold(entry.request.url)));
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
			printLog(`Persisting JSON to: ${chalk.bold(path.join(currentWorkingDir, cacheDataDirectory))}`);
			printLog(`Cached Playback: ${chalk.bold(dataPlayback)}`);
			printLog(`Cache persistence: ${chalk.bold(dataRecord)}`);
			printLog(`Command Prefix: ${chalk.bold(commandPrefix)}`);
			printLog(`Response header ID: ${chalk.bold(proxyHeaderIdentifier)}\n`);
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



