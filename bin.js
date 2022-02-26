#!/usr/bin/env node

import { program } from "commander";
import fs from "fs";
import path from "path";
import stripJsonComments from "strip-json-comments";

import JsonCachingProxy from "./index.js";

const npmPackage = JSON.parse(fs.readFileSync('./package.json'));
const version = npmPackage.version;
const cwd = process.cwd();

function list (val) {
	return val.split(':').map(item => item.trim());
}

function isDef (val) {
	return typeof val !== 'undefined';
}

program
	.storeOptionsAsProperties()
	.version(version)
	.option('-c, --config [path]', 'load a config file of options. Command line args will be overridden')
	.option('-u, --url [url]', 'set target server (e.g. https://network:8080)')
	.option('-p, --port [number]', 'set port for the local proxy server', parseInt)
	.option('-H, --har [path]', 'load entries from a HAR file and hydrate the cache')
	.option('-b, --bust [list]', 'set cache busting query params to ignore. (e.g. --bust _:cacheSlayer:time:dc)', list)
	.option('-e, --exclude [regex]', 'exclude specific routes from cache, (e.g. --exclude "GET /api/keep-alive/.*")')
	.option('-S, --excludeStatus [regex]', 'exclude specific status from cache, (e.g. --excludeStatus "503|404")')
	.option('-a, --all', 'cache everything from the remote server (Default is to cache just JSON responses)')
	.option('-P, --disablePlayback', 'disables cache playback')
	.option('-R, --disableRecord', 'disables recording to cache')
	.option('-C, --cmdPrefix [prefix]', 'change the prefix for the proxy\'s web admin endpoints')
	.option('-I, --header [header]', 'change the response header property for identifying cached responses')
	.option('-l, --log', 'print log output to console')
	.option('-t, --timeout [number]', 'proxy timeout in milliseconds', parseInt)
	.option('-d, --deleteCookieDomain', 'remove the Domain portion of all cookies')
	.option('-o, --overrideCors [url]', 'override Access-Control-Allow-Origin')
	.option('-z, --useCorsCredentials', 'set Access-Control-Allow-Credentials to true')
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
let proxyTimeout = configOptions.proxyTimeout ? parseInt(configOptions.proxyTimeout, 10) : program.timeout;
let deleteCookieDomain = isDef(configOptions.deleteCookieDomain) ? configOptions.deleteCookieDomain : isDef(program.deleteCookieDomain) ? program.deleteCookieDomain : false;
let overrideCors = isDef(configOptions.overrideCors) ? configOptions.overrideCors : isDef(program.overrideCors) ? program.overrideCors : false;
let useCorsCredentials = isDef(configOptions.useCorsCredentials) ? configOptions.useCorsCredentials : isDef(program.useCorsCredentials) ? program.useCorsCredentials : false;

if (overrideCors === true) {
	overrideCors = '*';
}

let excludedRouteMatchers;
if (configOptions.excludedRouteMatchers && configOptions.excludedRouteMatchers.length > 0) {
	excludedRouteMatchers = configOptions.excludedRouteMatchers.map(matcher => new RegExp(matcher));
} else {
	excludedRouteMatchers = program.exclude ? [new RegExp(program.exclude)] : [];
}

let excludedStatusMatchers;
if (configOptions.excludedStatusMatchers && configOptions.excludedStatusMatchers.length > 0) {
	excludedStatusMatchers = configOptions.excludedStatusMatchers.map(matcher => new RegExp(matcher));
} else {
	excludedStatusMatchers = program.excludeStatus ? [new RegExp(program.excludeStatus)] : [];
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
	excludedStatusMatchers,
	dataPlayback,
	dataRecord,
	commandPrefix,
	proxyHeaderIdentifier,
	showConsoleOutput,
	proxyTimeout,
	deleteCookieDomain,
	overrideCors,
	useCorsCredentials
});

jsonCachingProxy.start();
