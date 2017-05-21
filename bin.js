const version = require('./package.json').version;
const harCachingProxy = require('./');
const program = require('commander');
const url = require('url');

const defaultPort = 3001;

program
	.version(version)
	.option('-u, --url <url>', 'Remote server to proxy (e.g. https://network:8080)')
	.option('-p, --port [n]', 'Port for the local proxy server (Default: ' + defaultPort + ')', parseInt)
	.option('-i, --inputfile [path]', 'Load an existing HAR file and hydrate the cache')
	.option('-o, --outputfile [path]', 'Output all cached routes to a new HAR file')
	.parse(process.argv);

if (!program.url) {
	program.outputHelp();
} else {
	let remoteServerUrl = program.url;
	let proxyPort = program.port || defaultPort;
	let inputHarFile = program.inputfile;
	let outputHarFile = program.outputfile; // TODO
	let cacheBustingParam = '_'; // TODO: Make this a list passed arg

	harCachingProxy({
		remoteServerUrl,
		inputHarFile,
		outputHarFile,
		proxyPort,
		cacheBustingParam
	}, true).start();
}
