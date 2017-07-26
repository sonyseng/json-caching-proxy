# json-caching-proxy [![Build Status](https://travis-ci.org/sonyseng/json-caching-proxy.svg?branch=master)](https://travis-ci.org/sonyseng/json-caching-proxy) [![NPM Version](http://img.shields.io/npm/v/json-caching-proxy.svg?style=flat)](https://www.npmjs.org/package/json-caching-proxy) [![NPM Downloads](https://img.shields.io/npm/dm/json-caching-proxy.svg?style=flat)](https://www.npmjs.org/package/json-caching-proxy)

NodeJs caching HTTP proxy built on top of [express-http-proxy](https://github.com/villadora/express-http-proxy). Caches requests and responses to an in-memory [HAR-like](http://www.softwareishard.com/blog/har-12-spec/) data structure. Caches JSON content-type responses by default with the ability to cache an entire site; including content-types describing images.

## Installation

Command line tool:
```
$ npm install -g json-caching-proxy
```

Programmatic:
```
$ npm install -D json-caching-proxy
```

## Command line usage

```
  Usage: json-caching-proxy [options]

  Options:

    -h, --help             output usage information
    -V, --version          output the version number
    -c, --config [path]    load a config file of options. Command line args will be overridden
    -u, --url [url]        remote server (e.g. https://network:8080)
    -p, --port [number]    port for the local proxy server
    -h, --har [path]       load entries from a HAR file and hydrate the cache
    -b, --bust [list]      a list of cache busting query params to ignore. (e.g. -b _:time:dc)
    -e, --exclude [regex]  exclude specific routes from cache, (e.g. --exclude "GET /api/keep-alive/.*")
    -a, --all              cache everything from the remote server (Default is to cache just JSON responses)
    -dp, --playback        disables cache playback
    -dr, --record          disables recording to cache
    -cp, --prefix          change the prefix for the proxy's web admin endpoints
    -phi, --header         change the response header property for identifying cached responses
    -l, --log              print log output to console
```

#### Example - basic arguments
* Routes requests to `http://remote:8080`
* Runs the proxy on port `3001` on the host machine
* Removes matching query parameters `time` or `dc`. (e.g. /rest/status?time=1234567). `:` is the delimiter
* Excludes any `/keepalive` requests from the proxy. Any valid js regular expression works here
* Loads an existing HAR file and hydrates the cache. Supports any HAR file that conforms to HAR spec 1.2
* Caches everything. This includes JSON as well as other content-types such as images. It's essentially a site backup.
* Logs output to the console

```
$ json-caching-proxy -u http://remote:8080 -p 3001 -b time:dc -e '/keepalive' -h hydrate.har -a -l
```

#### Example - loading a config file

The example below will load the options from a config.json file that may look like this:

```js
// Complete list of config.json options for the caching proxy
{
  "remoteServerUrl": "http://wikimapia.org",
  "proxyPort": 3001,
  "inputHarFile": "./test/test.har",
  "cacheEverything": true,
  "cacheBustingParams": ["_", "dc", "cacheSlayer"],
  "excludedRouteMatchers": ["/*.js", "/*.png"],
  "showConsoleOutput": true,
  "dataPlayback": true,
  "dataRecord": true,
  "commandPrefix": "proxy",
  "proxyHeaderIdentifier": "proxy-cache-playback"
}
```
```
$ json-caching-proxy --config config.js
```

#### Example - print log to the console
Setting the `showConsoleOut` value to `true` will start showing the requests being made through the proxy. If the request is cacheable, it will also show the hash key for each request:

![Console output](http://sonyseng.github.io/json-caching-proxy/images/caching-proxy1.png)

![Console output](http://sonyseng.github.io/json-caching-proxy/images/caching-proxy2.png)

## Programmatic Usage

API docs can be found here: [JsonCachingProxy doc](http://sonyseng.github.io/json-caching-proxy/jsdoc/JsonCachingProxy.html)

```js
const JsonCachingProxy = require('json-caching-proxy');

// Complete list of options
let jsonCachingProxy = new JsonCachingProxy({
    remoteServerUrl: 'http://localhost:8080',
    proxyPort: 3001,
    harObject: null,
    commandPrefix: 'proxy',
    proxyHeaderIdentifier: 'caching-proxy-playback',
    middlewareList: [{ route: '/browser-sync', handle: (req, res, next) => res.send('bypass proxy')}],
    excludedRouteMatchers: [new RegExp('/site/*.js')],
    cacheBustingParams: ['time', 'dc'],
    cacheEverything: false,
    dataPlayback: true,
    dataRecord: true,
    showConsoleOutput: false
});

jsonCachingProxy.start();
```

#### Example - passing in a HAR object
If you have a method of generating a HAR object. The proxy can load the HAR entries and hydrate the cache. The proxy has a commandline
utility for loading HAR files but you may want to load your own or modify the objects before passing them into the proxy. More info can be found
here: [HAR 1.2 spec](http://www.softwareishard.com/blog/har-12-spec/)

```js
// Example HAR object
let harObject = {
  log: {
    version: '1.2',
    creator: {
      name: npmPackage.name,
      version: npmPackage.version
    },
    entries: [{
      request: {
        startedDateTime: '',
        method: 'GET',
        url: '/test',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: 200,
        cookies: [],
        headers: [],
        content: {
          size: -1,
          mimeType: 'application/json; charset=utf-8',
          text: '{"a":1,"b":"Some Value"}',
          encoding: 'utf8'
        },
        headersSize: -1,
        bodySize: -1
      }
    },
      {
        request: {
          startedDateTime: '',
          method: 'GET',
          url: '/another',
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: 200,
          cookies: [],
          headers: [],
          content: {
            size: -1,
            mimeType: 'application/json; charset=utf-8',
            text: '{"a":1,"b":"Some Value"}',
            encoding: 'utf8'
          },
          headersSize: -1,
          bodySize: -1
        }
      }]
  }
};
```

#### Example - using special middleware
Bypasses the remote server and allow your own middleware to be executed:
```js
let middlewareList = [
  { route: '/what', handle: (req, res, next) => res.send('what') },
  { route: '/hello', handle: (req, res, next) => res.send('hello') }
];
```

#### Example - excluding specific routes
You can specify a list of regular expressions to match against. Currently supports matching against the method and the uri:
```js
excludedRouteMatchers: [new RegExp('/site/*.js'), new RegExp('GET /site/*.gif'), new RegExp('POST /account/666')]
```

#### Example - cache busting
Many times, there are cache busting query strings that are appended to GET requests, you may specify a list of these
query string names. The proxy will ignore these parameters when building the cache. Otherwise every request will be
different
```js
cacheBustingParams: ['time', 'dc', 'cacheSlayer', '_']
```

## Controlling the Proxy
Once the proxy has started, you may point your browser to the following urls to affect the state of the proxy:
```
http://localhost:3001/proxy/playback?enabled=[true|false] - Start/Stop replaying persisted JSON from the cache.
http://localhost:3001/proxy/record?enabled=[true|false] - Start/Stop recording JSON to file system.
http://localhost:3001/proxy/clear - The HAR data structure that is the in-memory cache will be emptied
http://localhost:3001/proxy/har - Download the cache as a HAR json file. The file weill be named json-caching-proxy.har
```

## License

MIT
