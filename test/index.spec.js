// This has to be the last require or else the fs is screwed up

const assert = require('assert');
const fetch = require('node-fetch');
const express = require('express');
const JsonCachingProxy = require('./../index');

const mockServerPort = 8118;
const proxyPort = 8119;
const proxyServerUrl = 'http://localhost:'+ proxyPort;
const cacheDataDirectory = './cache';

function jsonFetch(url) {
  return fetch(url, { headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json'} });
}

describe('JSON-caching-proxy', () => {
  let mockApp = express();
  let mockRemoteServer, proxy;
  let mockJson, mockText, mockOptions;

  before(() => {
    mockJson = { a: 1, b: 'Some Value' };
    mockText = '<div>My Div</div>';

    mockRemoteServer = mockApp.listen(mockServerPort);
    mockApp.use('/test', (req, res) => res.json(mockJson));
    mockApp.use('/test_no_json', (req, res) => res.send(mockText));

    mockOptions = {
      remoteServerUrl: 'http://localhost:' + mockServerPort,
      proxyPort: proxyPort,
      harObject: null,
      commandPrefix: 'proxy',
      proxyHeaderIdentifier: 'caching-proxy-playback',
      middlewareList: [
        {route: '/what', handle: (req, res, next) => res.send('what')},
        {route: '/hello', handle: (req, res, next) => res.send('hello')}
      ],
      excludedRouteMatchers: [new RegExp('hello'), new RegExp('what')],
      cacheBustingParams: ['_', 'dc'],
      cacheEverything: false,
      dataPlayback: true,
      dataRecord: true,
      showConsoleOutput: false
    };
  });

  after(() => {
    mockRemoteServer.close();
  });

  beforeEach(() => {
  });

  afterEach(() => {
  });

  describe('Constructor', () => {
    it('Initializes the proxy correctly', () => {
      proxy = new JsonCachingProxy(mockOptions);
      assert.deepEqual(proxy.getRouteCache(), {}, 'Start off with an empty route cache');
      assert.equal(proxy.getServer(), null, 'Server does nto exist until app start');
      assert.equal(typeof proxy.getApp(), 'function', 'App is defined as the express() function');
    });

    it('Passes defined options which override defaults', () => {
      proxy = new JsonCachingProxy(mockOptions);
      let options = proxy.getOptions();
      assert.deepEqual(options, mockOptions, 'options will override defaults');
      assert.deepEqual(proxy.getExcludedParamMap(), {_:true, dc: true}, 'param array becomes an object map');
    });

    it('Passes undefined options which do NOT override defaults', () => {
      proxy = new JsonCachingProxy({cacheBustinParams: null});
      let options = proxy.getOptions();
      let defaultOptions = proxy.getDefaultOptions();
      assert.deepEqual(options, defaultOptions, 'options will fall back to defaults');
    });
  });

  describe('Utility methods', () => {
    proxy = new JsonCachingProxy();

    it('convertToNameValueList - Generate a unique hash key from a har file entry request object', () => {
      let nameValues = proxy.convertToNameValueList({one: 1, two: 2, three: 3});
      assert.deepEqual(nameValues, [{name:'one', value:1}, {name: 'two', value: 2}, {name: 'three', value: 3}]);
    });

    it('genKeyFromHarReq - create a unique md5 hash from a har entry request  method/url/querystring/postdata', () => {
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
          {name: '__utmt', value: '1', expires: null, httpOnly: false, secure: false},
          {name: '__utma', value: '181355237.272625869.1500999480.1500999480.1500999480.1', expires: null, httpOnly: false, secure: false}
        ],
        headersSize: 672,
        bodySize: 0,
        postData: {
          text: 'Original'
        }
      };

      let keyHash = proxy.genKeyFromHarReq(harEntryRequest);

      harEntryRequest.method = 'POST';
      assert.notEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing method changes the hash');
      harEntryRequest.method = 'GET';
      assert.equal(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing method back should generate the same hash');

      harEntryRequest.url = 'localhost';
      assert.notEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing url changes the hash');
      harEntryRequest.url = 'http://sleepy:3001/';
      assert.equal(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing url back should generate the same hash');

      harEntryRequest.queryString = [{name: '660', value: ''}];
      assert.notEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing query string changes the hash');
      harEntryRequest.queryString = [];
      assert.equal(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing query string back should generate the same hash');

      harEntryRequest.postData = {text: 'Changed'};
      assert.notEqual(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing post data changes the hash');
      harEntryRequest.postData = {text: 'Original'};
      assert.equal(proxy.genKeyFromHarReq(harEntryRequest).hash, keyHash.hash, 'Changing post data back should generate the same hash');
    });

    it('genKeyFromExpressReq - create a unique md5 hash from an express request (IncomingMessage)', () => {
      let req = {
        query: {},
        method: 'GET',
        url: 'http://sleepy:3001/',
        body: 'Original'
      };

      let keyHash = proxy.genKeyFromExpressReq(req);

      req.method = 'POST';
      assert.notEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing method changes the hash');
      req.method = 'GET';
      assert.equal(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing method back should generate the same hash');

      req.url = 'localhost';
      assert.notEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing url changes the hash');
      req.url = 'http://sleepy:3001/';
      assert.equal(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing url back should generate the same hash');

      req.query = {param1: 1, param2: 2, param3: 'three'};
      assert.notEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing query string changes the hash');
      req.query = {};
      assert.equal(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing query string back should generate the same hash');

      req.body = 'Changed';
      assert.notEqual(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing post data changes the hash');
      req.body = 'Original';
      assert.equal(proxy.genKeyFromExpressReq(req).hash, keyHash.hash, 'Changing post data back should generate the same hash');

    });
  });

  //it('proxies and caches JSON', done => {
  //  jsonFetch(proxyServerUrl +'/test')
  //    .then(res => res.json())
  //    .then(json => assert.deepEqual(json, mockJson))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => res.json())
  //    .then(json => assert.deepEqual(json, mockJson))
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('does not proxy non-JSON content types', done => {
  //  jsonFetch(proxyServerUrl +'/test_no_json')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, mockText))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/test_no_json/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('calls user-defined express middleware: /what', done => {
  //  jsonFetch(proxyServerUrl +'/what')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, 'what'))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/what/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('calls user-defined express middleware: /hello', done => {
  //  jsonFetch(proxyServerUrl +'/hello')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, 'hello'))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/hello/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('disables playback from cache', () => {
  //  return jsonFetch(proxyServerUrl + '/test')
  //    .then(() => jsonFetch(proxyServerUrl + '/test')) // Cached the request
  //    .then((res) => {
  //      assert(res.headers.get(proxyHeaderIdentifier)); // Special Proxy cached header sent
  //      assert(proxy.isReplaying());
  //    })
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/playback?enabled=false'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then((res) => {
  //      // Special Proxy cached header not sent
  //      assert(!res.headers.get(proxyHeaderIdentifier));
  //      assert(!proxy.isReplaying());
  //    });
  //});
	//
  //it('clears cache', done => {
  //  jsonFetch(proxyServerUrl + '/test')
  //    .then(() => jsonFetch(proxyServerUrl + '/test')) // Cached the request
  //    .then((res) => {
  //      // Special Proxy cached header sent to signify playback from file
  //      assert(res.headers.get(proxyHeaderIdentifier));
  //      assert(proxy.isReplaying());
  //    })
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/clear'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then((res) => {
  //      assert(!res.headers.get(proxyHeaderIdentifier));  // Special Proxy cached header not sent
  //    })
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('enables cache overwriting', done => {
  //  jsonFetch(proxyServerUrl + '/test')
  //    .then(() => mockJson.a = mockJson.a + 10) // Increment the value and sees if it comes back from the cache
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => res.json())
  //    .then(json => assert(json.a < mockJson.a)) // Should be less than because cache has old value
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/overwrite?enabled=true'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => {
  //      assert(!res.headers.get(proxyHeaderIdentifier));  // Special Proxy cached header not sent
  //      return res.json();
  //    })
  //    .then((json) => {
  //      assert(proxy.isOverwriting());
  //      assert(json.a === mockJson.a); // Should be equal because it's using the updated mockJson
  //    })
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});

});