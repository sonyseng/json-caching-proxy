#!/usr/bin/env node

const version = require('./package.json').version;
const JsonCachingProxy = require('./');

const fs = require('fs');
const url = require('url');
const path = require('path');
const program = require('commander');
const stripJsonComments = require('strip-json-comments');

const cwd = process.cwd();

function list (val) {
	return val.split(':').map(item => item.trim());
}

// Get a default value
function def (valToCheck, defaultVal, isBoolean=true) {
	if (typeof valToCheck !== 'undefined') {
		return isBoolean ? !!valToCheck : valToCheck;
	}
	return defaultVal;
}

program
	.version(version)
	.option('-c, --config [path]', 'Load a config file of options. (Command line args will be overridden')
	.option('-u, --url [url]', 'Remote server to proxy (e.g. https://network:8080)')
	.option('-p, --port [number]', 'Port for the local proxy server', parseInt)
	.option('-h, --har [path]', 'Load entries from a HAR file and hydrate the cache')
	.option('-b, --bust [list]', 'A list of cache busting query params to ignore. (e.g. --bust _:cacheSlayer:time:dc)', list)
	.option('-e, --exclude [regex]', 'Exclude specific routes from cache, (e.g. --exclude "GET /api/keep-alive/.*")')
	.option('-a, --all', 'Try to cache everything in addition to JSON (Overrided by --exclude argument)')
	.option('-dp, --playback', 'Disable cache playback')
	.option('-dr, --record', 'Disable caching')
	.option('-cp, --prefix', 'Prefix for controlling proxy')
	.option('-phi, --header', 'Prefix for controlling proxy')
	.option('-l, --log', 'Show log output to console')
	.parse(process.argv);

let configOptions = {};
if (program.config) {
	try {
		configOptions = JSON.parse(stripJsonComments(fs.readFileSync(path.join(cwd, program.config), "utf8")));
	} catch (err) {
		console.error('Could not read config file', err.path);
		process.exit(1);
	}
}

let remoteServerUrl = configOptions.remoteServerUrl || program.url;

// Required Remote URL
if (!remoteServerUrl) {
	program.outputHelp();
	process.exit(1);
}

let proxyPort = configOptions.proxyPort ? parseInt(configOptions.proxyPort, 10) : program.port;
let inputHarFile = configOptions.inputHarFile || program.har;
let cacheBustingParams = configOptions.cacheBustingParams ? configOptions.cacheBustingParams : program.bust;
let cacheEverything = def(configOptions.cacheEverything, def(program.all, false));
let dataPlayback = def(configOptions.dataPlayback, def(program.playback, true));
let dataRecord = def(configOptions.dataRecord, def(program.record, true));
let showConsoleOutput = def(configOptions.showConsoleOutput, def(program.log, false));
let commandPrefix = configOptions.commandPrefix || program.prefix;
let proxyHeaderIdentifier = configOptions.proxyHeaderIdentifier || program.header;

let excludedRouteMatchers;
if (configOptions.excludedRouteMatchers && configOptions.excludedRouteMatchers.length > 0) {
	excludedRouteMatchers = configOptions.excludedRouteMatchers.map(matcher => new RegExp(matcher));
} else {
	excludedRouteMatchers = program.exclude ? [new RegExp(program.exclude)] : [];
}

let harObject;
if (inputHarFile) {
	try {
		harObject = JSON.parse(fs.readFileSync(path.join(cwd, inputHarFile), "utf8"));
	} catch (err) {
		console.error('Could not read har file', err.path);
	}
}

let jsonCachingProxy = new JsonCachingProxy({
	remoteServerUrl,
	harObject,
	proxyPort,
	cacheEverything,
	cacheBustingParams,
	excludedRouteMatchers,
	dataPlayback,
	dataRecord,
	commandPrefix,
	proxyHeaderIdentifier,
	showConsoleOutput
});

jsonCachingProxy.start();

/**
 * EXAMPLE CONFIG JSON
 *
 * {
 *		"remoteServerUrl": "https://www.google.com",
 *		"proxyPort": 3001,
 *		"inputHarFile": "test.har",
 *		"cacheEverything": true,
 *		"cacheBustingParams": ["_", "dc", "cacheSlayer"],
 *		"excludedRouteMatchers": ["/traffic/.*js", "audience"],
 *		"showConsoleOutput": true,
 *		"dataPlayback": true,
 *		"dataRecord": true,
 *		"commandPrefix": "proxy",
 *		"proxyHeaderIdentifier": "bayon-cache-playback"
 * }
 *
 *
 */