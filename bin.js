#!/usr/bin/env node

const version = require('./package.json').version;
const harCachingProxy = require('./');
const program = require('commander');
const url = require('url');

const defaultPort = 3001;

function list (val) {
	return val.split(':').map(item => item.trim());
}

program
	.version(version)
	.option('-u, --url <url>', 'Remote server to proxy (e.g. https://network:8080)')
	.option('-p, --port [n]', 'Port for the local proxy server (Default: ' + defaultPort + ')', parseInt)
	.option('-i, --inputfile [path]', 'Load an existing HAR file and hydrate the cache')
	.option('-b, --bust [items]', 'A list of Cache Busting Query Params to ignore. e.g. --bust _:cacheSlayer:time:dc', list)
	.option('-z, --everything', 'Try to cache everything in addition to JSON')
	.parse(process.argv);

if (!program.url) {
	program.outputHelp();
} else {
	let remoteServerUrl = program.url;
	let proxyPort = program.port || defaultPort;
	let inputHarFile = program.inputfile;
	let cacheBustingParams = program.bust;
	let cacheEverything = !!program.everything;

	harCachingProxy({
		remoteServerUrl,
		inputHarFile,
		proxyPort,
		cacheEverything,
		cacheBustingParams
	}, true).start();
}

// TODO: Fix Tests