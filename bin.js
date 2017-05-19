const jsonCachingProxy = require('./');
const program = require('commander');
const url = require('url');

const defaultPort = 3001;
const defaultCacheDir = 'cache';

program
	.version('1.0.8')
	.option('-u, --url <url>', 'Remote server to proxy (e.g. https://network:8080)')
	.option('-p, --port [n]', 'Port for the local proxy server (Default: ' + defaultPort + ')', parseInt)
	.option('-d, --dir [path]', 'Local Directory to store JSON responses (Default: "' + defaultCacheDir + '")')
	.parse(process.argv);

if (!program.url) {
	program.outputHelp();
} else {
	let remoteServerUrl = program.url;
	let proxyPort = program.port || defaultPort;
	let cacheDataDirectory = program.dir || defaultCacheDir; // Directory relative to this file
	let cacheBustingParam = '_';

	jsonCachingProxy({
		remoteServerUrl,
		proxyPort,
		cacheDataDirectory,
		cacheBustingParam
	}, true).start();
}
