const npmPackage = require('./package.json');
const crypto = require('crypto');
const express = require('express');
const proxy = require('express-http-proxy');
const bodyParser = require('body-parser');
const urlUtil = require('url');
const chalk = require('chalk');

/**
 *
 *
 */
class Bayon {
	constructor (options) {
		let defaults = {
			remoteServerUrl: 'http://localhost:8080',
			proxyPort: 3001,
			harObject: null,
			commandPrefix: 'bayon-proxy',
			proxyHeaderIdentifier: 'bayon-cache-playback',
			middlewareList: [],
			excludedRouteMatchers: [],
			cacheBustingParams: [],
			cacheEverything: false,
			dataPlayback: true,
			dataRecord: true,
			showConsoleOutput: false
		};

		// Ignore undefined values and combine the options with defaults
		this.options = Object.assign({},
			defaults,
			Object.keys(options).reduce(function (passedOpts, key) {
				if (options[key] === null || typeof options[key] !== 'undefined') passedOpts[key] = options[key];
				return passedOpts;
			}, {}));

		this.app = express();
		this.routeCache = {};

		this.excludedParamMap = this.options.cacheBustingParams.reduce((map, param) => { map[param] = true; return map }, {});

		if (this.options.showConsoleOutput) {
			this.log = console.log;
			this.err = console.error;
		} else {
			this.log = () => false;
			this.err = () => false;
		}
	}

	convertToNameValueList (obj) {
		return typeof obj === 'object' ? Object.keys(obj).map(key => { return { name: key, value: obj[key] }; }) : [];
	}

	genKeyFromHarReq (harEntryReq) {
		let { method, url, queryString=[], postData={text: ''} } = harEntryReq;
		let uri = urlUtil.parse(url).pathname;
		let postParams = postData.text;

		queryString = queryString.filter(param => !this.excludedParamMap[param.name]);

		let plainText = `${method} ${uri} ${JSON.stringify(queryString)} ${postParams}`;
		let hash = crypto.createHash('md5').update(plainText).digest("hex");
		let key = `${method} ${uri} ${hash}`;

		return {key, hash};
	}

	genKeyFromExpressReq (req) {
		let queryString = this.convertToNameValueList(req.query);
		return this.genKeyFromHarReq({
			method: req.method,
			url: req.url,
			queryString: queryString,
			postData: { text: req.body && req.body.length > 0 ? req.body.toString('utf8') : '' }
		});
	}

	// Create a HAR from a proxied express request and response
	createHarEntry (startedDateTime, req, res, data) {
		let reqMimeType = req.get('Content-Type');
		let resMimeType = res.get('Content-Type') || 'text/plain';
		let encoding = (/^text\/|^application\/(javascript|json)/).test(resMimeType) ? 'utf8' : 'base64';

		let entry = {
			request: {
				startedDateTime: startedDateTime,
				method: req.method.toUpperCase(),
				url: req.url,
				cookies: this.convertToNameValueList(req.cookies),
				headers: this.convertToNameValueList(req.headers),
				queryString: this.convertToNameValueList(req.query),
				headersSize: -1,
				bodySize: -1
			},
			response: {
				status: res.statusCode,
				statusText: res.statusMessage,
				cookies: this.convertToNameValueList(res.cookies),
				headers: this.convertToNameValueList(res._headers).filter(header => header.name.toLowerCase() !== 'content-encoding'), // Not  compressed
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

	isRouteExcluded (method, uri) {
		return this.options.excludedRouteMatchers.some(regExp => regExp.test(`${method} ${uri}`))
	}

	addHarEntryRoutes (harObject) {
		if (harObject) {
			harObject.log.entries.forEach(entry => {
				let {key, hash} = this.genKeyFromHarReq(entry.request);

				if (this.isRouteExcluded(entry.request.method, entry.request.url)) {
					this.log(chalk.red('Excluded from Cache', hash, chalk.bold(entry.request.method, entry.request.url)));
					return;
				}

				// Only cache things that have content. Some times HAR files generated elsewhere will be missing this parameter
				if (entry.response.content.text) {
					let mimeType = entry.response.content.mimeType;

					if (entry.response.headers && (this.options.cacheEverything || !this.options.cacheEverything && mimeType && mimeType.indexOf('application/json') >= 0)) {
						// Remove content-encoding. gzip compression won't be used
						entry.response.headers = this.convertToNameValueList(entry.response.headers).filter(header => header.name.toLowerCase() !== 'content-encoding');
						this.routeCache[key] = entry;
						this.log(chalk.yellow('Saved to Cache', hash, chalk.bold(entry.request.method, entry.request.url)));
					}
				}
			});
		}

		return this.routeCache;
	}

	addAdminRoutes () {
		// These are not really restful because the GET is changing state. But it's easier to use in a browser
		this.app.get(`/${this.options.commandPrefix}/playback`, (req, res) => {
			this.options.dataPlayback = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : this.options.dataPlayback;
			this.log(chalk.blue(`Replay from cache: ${this.options.dataPlayback}`));
			res.send(`Replay from cache: ${this.options.dataPlayback}`);
		});

		this.app.get(`/${this.options.commandPrefix}/record`, (req, res) => {
			this.options.dataRecord = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : this.options.dataRecord;
			this.log(chalk.blue('Saving to cache: ' + this.options.dataRecord));
			res.send(`Saving to cache: ${this.options.dataRecord}`);
		});

		this.app.get(`/${this.options.commandPrefix}/clear`, (req, res) => {
			this.routeCache = {};
			this.log(chalk.blue('Cleared cache'));
			res.send('Cleared cache');
		});

		this.app.get(`/${this.options.commandPrefix}/har`, (req, res) => {
			this.log(chalk.blue('Generating har file'));

			let har = {
				log: {
					version: "1.2",
					creator: {
						name: npmPackage.name,
						version: npmPackage.version
					},
					entries: []
				}
			};

			Object.keys(this.routeCache).forEach(key => har.log.entries.push(this.routeCache[key]));

			res.json(har);
		});

		return this.app;
	}

	// User supplied middleware to handle special cases (browser-sync middleware options)
	addMiddleWareRoutes (middlewareList) {
		middlewareList.forEach(mw => {
			if (mw.route) {
				this.app.use(mw.route, mw.handle);
			} else {
				this.app.use(mw.handle);
			}
		});

		return this.app;
	}

	addBodyParser () {
		this.app.use(bodyParser.raw({type: '*/*'}));

		// Remove the body if there is no body content. Some sites check for malformed requests
		this.app.use((req, res, next) => {
			if (!req.headers['content-length']) {
				delete req.body;
			}

			next();
		});

		return this.app;
	}

	// Read from the cache if possible for any routes not being handled by previous middleware
	addCachingRoute () {
		this.app.use('/', (req, res, next) => {
			if (!this.options.dataPlayback) {
				next();
			} else {
				let {key, hash} = this.genKeyFromExpressReq(req);
				let entry = this.routeCache[key];

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

					this.log(chalk.green('Reading From Cache', hash, chalk.bold(entry.request.url)));
				}

			}
		});

		return this.app;
	}

	// Handle the proxy response by writing the response to cache if possible and altering location redirects if needed
	addProxyRoute () {
		this.app.use('/', proxy(this.options.remoteServerUrl, {
			//proxyReqBodyDecorator: (body, req) => {
			//	this.log(req.headers['content-length']);
			//	if (!req.headers['content-length']) {
			//		return [];
			//	}
			//
			//	return body;
			//},

			userResDecorator: (rsp, rspData, req, res) => {
				if (!this.options.dataRecord) {
					this.log(chalk.gray('Proxied Resource', req.path));
				} else {

					// Handle Redirects
					let location = res.get('location');
					if (location) {
						res.location(urlUtil.parse(location).path);
					}

					let mimeType = res._headers['content-type'];

					if (this.options.cacheEverything || !this.options.cacheEverything && mimeType && mimeType.indexOf('application/json') >= 0) {
						let {key, hash} = this.genKeyFromExpressReq(req);
						let entry = this.createHarEntry(new Date().toISOString(), req, res, rspData);
						this.routeCache[key] = entry;
						this.log(chalk.yellow('Saved to Cache', hash, chalk.bold(entry.request.url)));
					} else {
						this.log(chalk.gray('Proxied Resource', req.path));
					}
				}

				return rspData;
			}
		}));

		return this.app;
	}

	start () {
		let server = this.app.listen(this.options.proxyPort);

		this.log(chalk.bold(`\nBayon Started:`));
		this.log(chalk.gray(`==============\n`));
		this.log(`Remote server url: \t${chalk.bold(this.options.remoteServerUrl)}`);
		this.log(`Proxy running on port: \t${chalk.bold(this.options.proxyPort)}`);
		this.log(`Replay cache: \t\t${chalk.bold(this.options.dataPlayback)}`);
		this.log(`Save to cache: \t\t${chalk.bold(this.options.dataRecord)}`);
		this.log(`Command prefix: \t${chalk.bold(this.options.commandPrefix)}`);
		this.log(`Proxy response header: \t${chalk.bold(this.options.proxyHeaderIdentifier)}`);
		this.log(`Cache all: \t\t${chalk.bold(this.options.cacheEverything)}`);
		this.log(`Cache busting params: \t${chalk.bold(this.options.cacheBustingParams)}`);
		this.log(`Excluded routes: `);
		this.options.excludedRouteMatchers.forEach((regExp) => {
			this.log(`\t\t\t${chalk.bold(regExp)}`)
		});

		this.log('\nListening...\n');

		// The order of these routes is important
		this.addHarEntryRoutes(this.options.harObject);
		this.addAdminRoutes();
		this.addMiddleWareRoutes(this.options.middlewareList);
		this.addBodyParser();
		this.addCachingRoute();
		this.addProxyRoute();

		return () => {
			if (server) {
				server.close();
				this.log(chalk.bold('\nStopping Proxy Server'));
			}
		};

	}
}

module.exports = Bayon;
