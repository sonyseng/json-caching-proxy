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

function isDef (val) {
	return typeof val !== 'undefined';
}

program
	.version(version)
	.option('-c, --config [path]', 'load a config file of options. Command line args will be overridden')
	.option('-u, --url [url]', 'remote server (e.g. https://network:8080)')
	.option('-p, --port [number]', 'port for the local proxy server', parseInt)
	.option('-H, --har [path]', 'load entries from a HAR file and hydrate the cache')
	.option('-b, --bust [list]', 'a list of cache busting query params to ignore. (e.g. --bust _:cacheSlayer:time:dc)', list)
	.option('-e, --exclude [regex]', 'exclude specific routes from cache, (e.g. --exclude "GET /api/keep-alive/.*")')
	.option('-a, --all', 'cache everything from the remote server (Default is to cache just JSON responses)')
	.option('-P, --disablePlayback', 'disables cache playback')
	.option('-R, --disableRecord', 'disables recording to cache')
	.option('-C, --cmdPrefix [prefix]', 'change the prefix for the proxy\'s web admin endpoints')
	.option('-I, --header [header]', 'change the response header property for identifying cached responses')
	.option('-l, --log', 'print log output to console')
	.parse(process.argv);

let configOptions = {};
if (program.config) {
	try {
		let filePath = path.isAbsolute(program.config) ? program.config : path.join(cwd, program.config);
		configOptions = JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
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
let commandPrefix = configOptions.commandPrefix || program.cmdPrefix;
let proxyHeaderIdentifier = configOptions.proxyHeaderIdentifier || program.header;
let cacheEverything = isDef(configOptions.cacheEverything) ? configOptions.cacheEverything : isDef(program.all) ? program.all : false;
let dataPlayback = isDef(configOptions.dataPlayback) ? configOptions.dataPlayback : isDef(program.disablePlayback) ? !program.disablePlayback : true;
let dataRecord = isDef(configOptions.dataRecord) ? configOptions.dataRecord : isDef(program.disableRecord) ? !program.disableRecord : true;
let showConsoleOutput = isDef(configOptions.showConsoleOutput) ? configOptions.showConsoleOutput : isDef(program.log) ? program.log : false;


let excludedRouteMatchers;
if (configOptions.excludedRouteMatchers && configOptions.excludedRouteMatchers.length > 0) {
	excludedRouteMatchers = configOptions.excludedRouteMatchers.map(matcher => new RegExp(matcher));
} else {
	excludedRouteMatchers = program.exclude ? [new RegExp(program.exclude)] : [];
}

let harObject;
if (inputHarFile) {
	try {
		let filePath = path.isAbsolute(inputHarFile) ? inputHarFile : path.join(cwd, inputHarFile);
		harObject = JSON.parse(fs.readFileSync(filePath, "utf8"));
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
