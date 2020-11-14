# json-caching-proxy [![Build Status](https://travis-ci.org/sonyseng/json-caching-proxy.svg?branch=master)](https://travis-ci.org/sonyseng/json-caching-proxy) [![NPM Version](http://img.shields.io/npm/v/json-caching-proxy.svg?style=flat)](https://www.npmjs.org/package/json-caching-proxy) [![NPM Downloads](https://img.shields.io/npm/dm/json-caching-proxy.svg?style=flat)](https://www.npmjs.org/package/json-caching-proxy)

Node caching HTTP proxy built on top of [express-http-proxy](https://github.com/villadora/express-http-proxy). Persists requests and responses to an in-memory HAR-like data structure based on [HAR1.2](http://www.softwareishard.com/blog/har-12-spec/) . Caches JSON content-type responses by default with the ability to cache an entire site; including content-types describing images. Useful for testing front end code, mocking api, and saving the cache to a HAR file which can be used for further tests.
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

    -h, --help                output usage information
    -V, --version             output the version number
    -c, --config [path]       load a config file of options. Command line args will be overridden
    -u, --url [url]           remote server (e.g. https://network:8080)
    -p, --port [number]       port for the local proxy server
    -H, --har [path]          load entries from a HAR file and hydrate the cache
    -b, --bust [list]         a list of cache busting query params to ignore. (e.g. --bust _:cacheSlayer:time:dc)
    -e, --exclude [regex]     exclude specific routes from cache, (e.g. --exclude "GET /api/keep-alive/.*")
    -a, --all                 cache everything from the remote server (Default is to cache just JSON responses)
    -P, --disablePlayback     disables cache playback
    -R, --disableRecord       disables recording to cache
    -C, --cmdPrefix [prefix]  change the prefix for the proxy's web admin endpoints
    -I, --header [header]     change the response header property for identifying cached responses
    -l, --log                 print log output to console
    -t, --timeout             change the timeout for proxy server
    -d, --deleteCookieDomain  remove the Domain portion of all cookies
    -o, --overrideCors [url]  override Access-Control-Allow-Origin
    -z, --useCorsCredentials  set Access-Control-Allow-Credentials to true

```

#### Example - basic JSON caching with output
```
$ json-caching-proxy -u http://remote:8080 -l
```

#### Example - bypassing CORS when proxying to a 3rd party api server
```
$ json-caching-proxy -u http://cors-api.example.com -o localhost:9000 -z
```
This use case occurs when developing a browser application against an api server on a different host with CORS restrictions.
In this example we might be running a dev server that's hosting a frontend application on http://localhost:9000 and there is
browser javascript that needs to fetch from http://cors-api.example.com. The `-z` option tells the proxy to set up auth headers
in case the code uses cookies or tokens (e.g. Bearer tokens)

#### Example - hydrating the cache
```
$ json-caching-proxy -u http://remote:8080 -p 3001 -H chromeDevTools.har -l
```
You may have a HAR file that was generated elsewhere (e.g. Chrome Developer tools). You can load this file and initialize the cache

#### Example - advanced arguments
```
$ json-caching-proxy -u http://remote:8080 -p 3001 -b time:dc -e '/keepalive' -H hydrate.har -a -l
```

* Routes requests to `http://remote:8080`
* Runs the proxy on port `3001` on the host machine
* Removes matching query parameters `time` or `dc`. (e.g. /rest/status?time=1234567). `:` is the delimiter
* Excludes any `/keepalive` requests from the proxy. Any valid js regular expression works here
* Loads an existing HAR file and hydrates the cache. Supports any HAR file that conforms to HAR spec 1.2
* Caches everything. This includes JSON as well as other content-types such as images. It's essentially a site backup.
* Logs output to the console

#### Example - loading options from a config file

```js
/* Complete list of config.json options for the caching proxy */

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
  "proxyHeaderIdentifier": "proxy-cache-playback",
  "proxyTimeout": 500000,
  "deleteCookieDomain": true,
  "overrideCors": "localhost:8080",
  "useCorsCredentials": true
}
```
```
$ json-caching-proxy --config config.json
```

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
    showConsoleOutput: false,
    proxyTimeout: 500000,
    deleteCookieDomain: true,
    overrideCors: "localhost:8080",
    useCorsCredentials: true
});

jsonCachingProxy.start();
```

#### Example - passing in a HAR object
If you have a method of generating a HAR object, the proxy can load the HAR entries and hydrate the cache. The proxy has a commandline
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
Bypasses the remote server and allows your own middleware to be executed:
```js
let middlewareList = [
  { route: '/what', handle: (req, res, next) => res.send('what') },
  { route: '/hello', handle: (req, res, next) => res.send('hello') }
];
```

#### Example - excluding specific routes
You can specify a list of regular expressions to match against. Currently supports matching against the `method` and `uri`:
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
http://localhost:3001/proxy/playback?enabled=[true|false] - Start/Stop replaying cached requests.
http://localhost:3001/proxy/record?enabled=[true|false] - Start/Stop recording request/responses to the cache.
http://localhost:3001/proxy/har - Download cache to json-caching-proxy.har
http://localhost:3001/proxy/clear - Empty the in-memory cache.
```

## License

MIT
