const npmPackage = require('./package.json');
const crypto = require('crypto');
const express = require('express');
const proxy = require('express-http-proxy');
const bodyParser = require('body-parser');
const urlUtil = require('url');
const chalk = require('chalk');

/** The caching proxy server. */
class JsonCachingProxy {
	/**
	 * Ctor
	 * @param {Object} options - Options passed into the ctor will override defaults if defined
	 */
	constructor (options) {
		let defaults = {
			remoteServerUrl: 'http://localhost:8080',
			proxyPort: 3001,
			harObject: null,
			commandPrefix: 'proxy',
			proxyHeaderIdentifier: 'caching-proxy-playback',
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

		this.server = null; // Will be set when the app starts
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

	/**
	 * Returns an Object's own  properties into an array of name-value pair objects
	 * @param {Object} obj
	 * @returns {Object[]}
	 */
	convertToNameValueList (obj) {
		return typeof obj === 'object' ? Object.keys(obj).map(key => { return { name: key, value: obj[key] }; }) : [];
	}

	/**
	 * Generate a unique hash key from a har file entry's request object
	 * @param {Object} harEntryReq - HAR request object
	 * @returns {Object} A unique key, hash tuple that identifies the request
	 */
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

	/**
	 * Takes a generic express request and convert it into a HAR request so that a unique key can be generated
	 * @param {Object} req - An express IncomingMessage request
	 * @returns {string} A unique hash key that identifies the request
	 */
	genKeyFromExpressReq (req) {
		let queryString = this.convertToNameValueList(req.query);
		return this.genKeyFromHarReq({
			method: req.method,
			url: req.url,
			queryString: queryString,
			postData: { text: req.body && req.body.length > 0 ? req.body.toString('utf8') : '' }
		});
	}

	/**
	 * Build a HAR entry object from an express Request and response
	 * @param {string} startedDateTime - An ISO Datetime String
	 * @param {Object} req - An express IncomingMessage request
	 * @param {Object} res - An express ServerResponse response
	 * @param {Object} data - An express response body (the content)
	 * @returns {Object} A HAR entry object
	 */
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

	/**
	 * Check to see if the pieces of a request are excluded. This checks only the method and the uri. It uses the list
	 * of regExp matchers to test
	 * @param {string} method - e.g. GET, POST, PUT, etc.
	 * @param {string} uri - e.g. http://www.api.com/rest/accounts
	 * @returns {boolean} Whether the test is true for some matcher
	 */
	isRouteExcluded (method, uri) {
		return this.options.excludedRouteMatchers.some(regExp => regExp.test(`${method} ${uri}`))
	}

	/**
	 * Add express routes for each entry in a harObject. The harObject would have been read in from a har file at some point
	 * @param {Object} harObject - A standard HAR file object that contains a collection of entries
	 * @returns {JsonCachingProxy}
	 */
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

		return this;
	}

	/**
	 * Add the admin express routes for controlling the proxy server through a browser. Allows one to make GET requests to clear
	 * the cache, disable/enable playback/recording, and generate a har file of the cache to download for later use.
	 * @returns {JsonCachingProxy}
	 */
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

		return this;
	}

	/**
	 * Add user supplied middleware routes to express in order to handle special cases (browser-sync middleware options)
	 * @param {Object[]} middlewareList - A list of route/handler pairs
	 * @returns {JsonCachingProxy}
	 */
	addMiddleWareRoutes (middlewareList) {
		middlewareList.forEach(mw => {
			if (mw.route) {
				this.app.use(mw.route, mw.handle);
			} else {
				this.app.use(mw.handle);
			}
		});

		return this;
	}

	/**
	 * Add Request body parsing into RAW if there is actual body content
	 * @returns {JsonCachingProxy}
	 */
	addBodyParser () {
		this.app.use(bodyParser.raw({type: '*/*'}));

		// Remove the body if there is no body content. Some sites check for malformed requests
		this.app.use((req, res, next) => {
			if (!req.headers['content-length']) {
				delete req.body;
			}

			next();
		});

		return this;
	}

	/**
	 * An express route that reads from the cache if possible for any routes persisted in cache memory
	 * Makes sure to modify redirect urls so that the hostname matches the proxy server host name.
	 * @returns {JsonCachingProxy}
	 */
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

		return this;
	}

	/**
	 * Add the proxy route that makes the actual request to the target server and cache the response when it comes back
	 * @returns {JsonCachingProxy}
	 */
	addProxyRoute () {
		this.app.use('/', proxy(this.options.remoteServerUrl, {
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

		return this;
	}

	/**
	 * Start the server and generate any log output if needed
	 * @returns {JsonCachingProxy}
	 */
	start () {
		this.server = this.app.listen(this.options.proxyPort);

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

		return this;
	}

	/**
	 * Stops the proxy server
	 * @returns {JsonCachingProxy}
	 */
	stop () {
		if (server) {
			server.close();
			this.log(chalk.bold('\nStopping Proxy Server'));
		}

		return this;
	}

	getOptions () { return this.options; }
	getApp () { return this.app; }
	getRouteCache () { return this.routeCache; }
	getExcludedParamMap () { return this.excludedParamMap; }
}

module.exports = JsonCachingProxy;
