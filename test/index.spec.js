import assert from 'assert';
import express from 'express';
import fs from "fs";
import fetch from 'node-fetch';
import zlib from "zlib";

import JsonCachingProxy from '../index.js';

const npmPackage = JSON.parse(fs.readFileSync('./package.json'));
const mockServerPort = 8118;
const proxyPort = 8119;
const proxyServerUrl = 'http://localhost:'+ proxyPort;
const proxyTimeout = 500000;

function jsonFetch(url) {
  return fetch(url, { headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json'} });
}

describe('json-caching-proxy', () => {
  let proxy;
  let mockOptions;

  before(() => {
    mockOptions = {
      remoteServerUrl: 'http://localhost:' + mockServerPort,
      proxyPort: proxyPort,
      harObject: null,
      commandPrefix: 'proxy',
      proxyHeaderIdentifier: 'caching-proxy-playback',
      middlewareList: [
        {route: '/test2', handle: (req, res, next) => res.send('test2')},
        {route: '/test3', handle: (req, res, next) => res.send('test3')}
      ],
      excludedRouteMatchers: [new RegExp('excluded1'), new RegExp('excluded2')],
      excludedStatusMatchers: [new RegExp('503')],
      cacheBustingParams: ['_', 'dc'],
      cacheEverything: false,
      dataPlayback: true,
      dataRecord: true,
      showConsoleOutput: false,
      proxyTimeout: proxyTimeout,
      deleteCookieDomain: false,
      overrideCors: false,
      useCorsCredentials: false
    };
  });

  describe('Constructor', () => {    
    it('initializes the proxy correctly', () => {
      proxy = new JsonCachingProxy(mockOptions);
      assert.deepStrictEqual(proxy.isRouteCacheEmpty(), true, 'Start off with an empty route cache');
      assert.strictEqual(proxy.getServer(), null, 'Server does nto exist until app start');
      assert.strictEqual(typeof proxy.getApp(), 'function', 'App is defined as the express() function');
    });

    it('passes defined options which override defaults', () => {
      proxy = new JsonCachingProxy(mockOptions);
      let options = proxy.getOptions();
      assert.deepStrictEqual(options, mockOptions, 'options will override defaults');
      assert.deepStrictEqual(proxy.getExcludedParamMap(), {_:true, dc: true}, 'param array becomes an object map');
    });

    it('passes undefined options which do NOT override defaults', () => {
      proxy = new JsonCachingProxy({cacheBustinParams: null});
      let options = proxy.getOptions();
      let defaultOptions = proxy.getDefaultOptions();
      assert.deepStrictEqual(options, defaultOptions, 'options will fall back to defaults');
    });
  });

  describe('Utility methods',() => {
    proxy = new JsonCachingProxy();

    it('removeCookiesDomain - Removes the domain attr from cookie headers', () => {
      let mockCookies = [
        'myCookie1=TEST;domain=facebook.com;random=2323',
        'myCookie2=TEST;random=4545',
        'myCookie3=TEST;domain=google.com;random=454545',
      ];

     assert.deepStrictEqual(proxy.removeCookiesDomain(mockCookies), [
        'myCookie1=TEST;random=2323',
        'myCookie2=TEST;random=4545',
        'myCookie3=TEST;random=454545',
      ]);
    });

    it('convertToNameValueList - Generate a unique hash key from a har file entry request object', () => {
      let nameValues = proxy.convertToNameValueList({one: 1, two: 2, three: 3});
      assert.deepStrictEqual(nameValues, [{name:'one', value:1}, {name: 'two', value: 2}, {name: 'three', value: 3}]);
    });

    it('genKeyFromHarReq - create a unique md5 hash from a har entry GET request method/url/querystring/postdata', () => {
      let harEntryRequest = {
        method: 'GET',
        url: 'http://sleepy:3001/',
        headers: [
          {name: 'Pragma', value: 'no-cache'},
          {name: 'DNT', value: '1'},
          {name: 'Accept-Encoding', value: 'gzip, deflate'}
        ],
        queryString: [],
        cookies: [
          {name: 'cook', value: '1', expires: null, httpOnly: false, secure: false},
          {name: 'cook', value: '2', expires: null, httpOnly: false, secure: false}
        ],
        headersSize: 42,
        bodySize: 8,
        postData: {
          text: 'Original'
        }
      };

      let keyHash = proxy.genKeyFromHarReq(harEntryRequest);

      harEntryRequest.method = 'POST';
      assert.notStrictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing method changes the hash');
      harEntryRequest.method = 'GET';
      assert.strictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing method back should generate the same hash');

      harEntryRequest.url = 'localhost';
      assert.notStrictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing url changes the hash');
      harEntryRequest.url = 'http://sleepy:3001/';
      assert.strictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing url back should generate the same hash');

      harEntryRequest.queryString = [{name: '660', value: ''}];
      assert.notStrictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing query string changes the hash');
      harEntryRequest.queryString = [];
      assert.strictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing query string back should generate the same hash');

      harEntryRequest.postData = {text: 'Changed'};
      assert.notStrictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing post data changes the hash');
      harEntryRequest.postData = {text: 'Original'};
      assert.strictEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing post data back should generate the same hash');
    });

    it('genKeyFromExpressReq - create a unique md5 hash from a basic express request (IncomingMessage)', () => {
      let req = {
        query: {},
        method: 'GET',
        url: 'http://sleepy:3001/',
        body: 'Original'
      };

      let keyHash = proxy.genKeyFromExpressReq(req);

      req.method = 'POST';
      assert.notStrictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing method changes the hash');
      req.method = 'GET';
      assert.strictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing method back should generate the same hash');

      req.url = 'localhost';
      assert.notStrictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing url changes the hash');
      req.url = 'http://sleepy:3001/';
      assert.strictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing url back should generate the same hash');

      req.query = {param1: 1, param2: 2, param3: 'three'};
      assert.notStrictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing query string changes the hash');
      req.query = {};
      assert.strictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing query string back should generate the same hash');

      req.body = 'Changed';
      assert.notStrictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing post data changes the hash');
      req.body = 'Original';
      assert.strictEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing post data back should generate the same hash');
    });

    it('genKeyFromExpressReq - create a unique md5 hash from a complex express request with data, cookies, and headers (IncomingMessage)', async () => {
      let actualEntry = null;
      let expectedEntry = {
        request: {
          startedDateTime: '2017-07-25T21:03:55.962Z',
          method: 'GET',
          url: 'http://sleepy:3001/',
          cookies: [{name:'cookie1', value:1}, {name: 'cookie2', value: 2}, {name: 'cookie3', value: 'three'}],
          headers: [{name:'header1', value:1}, {name: 'header2', value: 2}, {name: 'header3', value: 'three'}],
          queryString: [{name:'param1', value:1}, {name: 'param2', value: 2}, {name: 'param3', value: 'three'}],
          headersSize: -1,
          bodySize: -1,
          postData: { mimeType: 'application/json', text: '{"Original": 42}' }
        },
        response: {
          status: 200,
          statusText: 'OK',
          cookies: [{name:'cookie1', value:1}, {name: 'cookie2', value: 2}, {name: 'cookie3', value: 'three'}],
          headers: [{name:'header1', value:1}, {name: 'header2', value: 2}, {name: 'header3', value: 'three'}],
          content: {
            size: -1,
            mimeType: 'application/json',
            text: '{"Response": 42}',
            encoding: 'utf8'
          },
          headersSize: -1,
          bodySize: -1
        }
      };

      let mockReq = {
        query: {param1: 1, param2: 2, param3: 'three'},
        cookies: {cookie1: 1, cookie2: 2, cookie3: 'three'},
        headers: {header1: 1, header2: 2, header3: 'three'},
        method: 'GET',
        url: 'http://sleepy:3001/',
        body: '{"Original": 42}',
        'get': () => 'application/json'
      };

      let mockRes = {
        statusCode: 200,
        statusMessage: 'OK',
        cookies: {cookie1: 1, cookie2: 2, cookie3: 'three'},
        getHeaders: () => ({header1: 1, header2: 2, header3: 'three', 'content-encoding': 'gzip'})
      };

      mockRes.get = () => 'application/json';
      actualEntry = await proxy.createHarEntry(new Date('2017-07-25T21:03:55.962Z').toISOString(), mockReq, mockRes, '{"Response": 42}');
      assert.deepStrictEqual(actualEntry, expectedEntry, 'Generate a Valid HAR entry that filters out content-encoding response header');
      assert.deepStrictEqual(actualEntry.response.content.encoding, 'utf8', 'utf8 encode the response body if the mime type is application/json format');

      mockRes.get = () => 'text/plain';
      actualEntry = await proxy.createHarEntry(new Date('2017-07-25T21:03:55.962Z').toISOString(), mockReq, mockRes, '{"Response": 42}');
      assert.deepStrictEqual(actualEntry.response.content.encoding, 'utf8', 'utf8 encode the response body if the mime type is plain/text format');

      mockRes.get = () => 'obscure_mimetype';
      actualEntry = await proxy.createHarEntry(new Date('2017-07-25T21:03:55.962Z').toISOString(), mockReq, mockRes, '{"Response": 42}');
      assert.deepStrictEqual(actualEntry.response.content.encoding, 'base64', 'base64 encode the response body if the mimetype is not a text format');

      mockRes.get = () => 'text/plain';
      mockRes.getHeaders = () => ({'content-encoding': 'br'});
      actualEntry = await proxy.createHarEntry(new Date('2017-07-25T21:03:55.962Z').toISOString(), mockReq, mockRes, zlib.brotliCompressSync('hello there!'));
      assert.deepStrictEqual(actualEntry.response.content.text, 'hello there!','utf8 encode the response body with brotli compression');
    });
  });

  describe('Express Routes', () => {
    let mockApp = express();
    let mockRemoteServer, proxy;
    let mockJson, mockText;

    before(() => {
      mockJson = {a: 1, b: 'Some Value'};
      mockText = '<div>My Div</div>';

      mockRemoteServer = mockApp.listen(mockServerPort);
      mockApp.use('/test', (req, res) => res.json(mockJson));
      mockApp.use('/excluded1', (req, res) => res.send(mockText));
      mockApp.use('/excluded2', (req, res) => res.send(mockText));
      mockApp.use('/excluded503', (req, res) => res.status(503).send(mockJson));
    });

    after(done => {
      mockRemoteServer.close(done);
    });

    describe('Admin', () => {
      beforeEach(done => {
        proxy = new JsonCachingProxy(mockOptions);
        proxy.start(done);
      });

      afterEach(done => {
        proxy.stop(done);
      });

      it('disables playback from cache', () => {
        return jsonFetch(`${proxyServerUrl}/test`)
          .then(() => jsonFetch(`${proxyServerUrl}/test`)) // Causes a cache the request
          .then((res) => {
            assert(res.headers.get(mockOptions.proxyHeaderIdentifier), 'Sets the special cache header on responses');
            assert.strictEqual(proxy.isRouteCacheEmpty(), false, 'Route cache not empty');
            assert(proxy.isReplaying(), 'Replay option is enabled');
          })
          .then(() => jsonFetch(`${proxyServerUrl}/${mockOptions.commandPrefix}/playback?enabled=false`))
          .then(() => jsonFetch(`${proxyServerUrl}/test`))
          .then((res) => {
            assert(!res.headers.get(mockOptions.proxyHeaderIdentifier), 'Disabling playback removes the special cache header on responses');
            assert(!proxy.isReplaying(), 'Replay option is disabled');
          });
      });

      it('disables recording to the cache', () => {
        return jsonFetch(`${proxyServerUrl}/${mockOptions.commandPrefix}/record?enabled=false`)
          .then(() => jsonFetch(`${proxyServerUrl}/test`)) // Make the first request to fill the cache
          .then((res) => {
            assert(!res.headers.get(mockOptions.proxyHeaderIdentifier), 'special cache header not sent');
            assert(!proxy.isRecording(), 'Record option is disabled');
            assert.strictEqual(proxy.isRouteCacheEmpty(), true, 'Route cache empty');
          });
      });

      it('generates a har response', () => {
        let expectedHarObject = {
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
            }]
          }
        };

        return jsonFetch(`${proxyServerUrl}/test`)
          .then(() => jsonFetch(`${proxyServerUrl}/${mockOptions.commandPrefix}/har`))
          .then(res => res.json())
          .then((harObject) => {
            // Avoid any dynamic time. Avoid library specific properties of the fetch client lib.
            // Avoid library specific properties of the mock express server
            harObject.log.entries[0].request.startedDateTime = '';
            harObject.log.entries[0].request.headers = [];
            harObject.log.entries[0].response.headers = [];

            assert.deepStrictEqual(harObject, expectedHarObject);
          });
      });

      it('clears cache', () => {
        return jsonFetch(`${proxyServerUrl}/test`)
          .then(() => jsonFetch(`${proxyServerUrl}/test`)) // Causes a cache the request
          .then((res) => {
            assert(res.headers.get(mockOptions.proxyHeaderIdentifier), 'Sets the special cache header on responses');
            assert.strictEqual(proxy.isRouteCacheEmpty(), false, 'Route cache not empty');
            assert(proxy.isReplaying(), 'Replay options is enabled');
          })
          .then(() => jsonFetch(`${proxyServerUrl}/${mockOptions.commandPrefix}/clear`))
          .then(() => assert.strictEqual(proxy.isRouteCacheEmpty(), true, 'Route cache empty'))
          .then(() => jsonFetch(`${proxyServerUrl}/test`))
          .then((res) => assert(!res.headers.get(mockOptions.proxyHeaderIdentifier), 'special cache header not sent on first get'));
      });
    });

    describe('Core', () => {
      describe('HAR', () => {
        it('hydrates the cache with HAR entry routes', (done) => {
          let mockHarObject = {
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
  
          let proxy = new JsonCachingProxy({
            remoteServerUrl: 'http://localhost:' + mockServerPort + 1000,
            proxyPort: proxyPort,
            harObject: mockHarObject
          });
  
          proxy.start(() => {
            assert.strictEqual(proxy.getTotalCachedRoutes(), 2);
            proxy.stop();
            done()
          });
        });
      });

      describe('General', () => {
        beforeEach(done => {
          proxy = new JsonCachingProxy(mockOptions);
          proxy.start(done);
        });
  
        afterEach(done => {
          proxy.stop(done);
        });
  
        it('cache overwrites response body if request generated key is the same', () => {
          return jsonFetch(`${proxyServerUrl}/test`) // Make the first request to fill the cache
            .then(() => mockJson.a = mockJson.a + 10) // Increment the value and see if it comes back from the cache
            .then(() => jsonFetch(proxyServerUrl + '/test')) // Make the same request with different value
            .then(res => res.json())
            .then(json => assert(json.a < mockJson.a, 'Should be less than because cache has the old value'))
            .then(() => jsonFetch(`${proxyServerUrl}/test`))
        });
  
        it('proxies and caches JSON', () => {
          return jsonFetch(`${proxyServerUrl}/test`)
            .then(res => res.json())
            .then(json => assert.deepStrictEqual(json, mockJson))
            .then(() => jsonFetch(`${proxyServerUrl}/test`))
            .then(res => res.json())
            .then(json => assert.deepStrictEqual(json, mockJson))
            .then(() => assert.strictEqual(proxy.getTotalCachedRoutes(), 1));
        });
  
        it('excludes routes by regexp', () => {
          return jsonFetch(`${proxyServerUrl}/excluded1`)
            .then(() => jsonFetch(`${proxyServerUrl}/excluded2`))
            .then(() => assert.strictEqual(proxy.getTotalCachedRoutes(), 0))
            .then(() => jsonFetch(`${proxyServerUrl}/test`))
            .then(() => assert.strictEqual(proxy.getTotalCachedRoutes(), 1));
        });

        it('excludes routes with response status by regexp', () => {
          return jsonFetch(`${proxyServerUrl}/excluded503`)
          .then(() => jsonFetch(`${proxyServerUrl}/excluded503`))
          .then(() => assert.strictEqual(proxy.getTotalCachedRoutes(), 0))
          .then(() => jsonFetch(`${proxyServerUrl}/test`))
          .then(() => assert.strictEqual(proxy.getTotalCachedRoutes(), 1));
        });

        it('calls user-defined express middleware', () => {
          return jsonFetch(`${proxyServerUrl}/test2`)
            .then(res => res.text())
            .then(text => assert.strictEqual(text, 'test2'))
            .then(() => jsonFetch(`${proxyServerUrl}/test3`))
            .then(res => res.text())
            .then(text => assert.strictEqual(text, 'test3'));
        });
      });
    });
  });
});
